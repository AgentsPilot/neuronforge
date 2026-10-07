/**
 * The Stripe prices that ARE Business OS plan prices.
 *
 * Plan prices are identified by their Stripe lookup keys (identities we
 * control), never by metadata (which whoever creates an object can write). The
 * keys are the same in test and live mode (Q-T1), so this list is not per
 * environment.
 *
 * P-1 shipped the list EMPTY, so nothing was recognised and every platform
 * subscription invoice was denied by the router. P-2b fills the list from
 * `entitlements/config/planPrices.ts` (current and retired keys, CF-1).
 *
 * MERGE SAFETY (P-2b). The process catalog uses the configured keys only
 * while `BUSINESS_OS_PLAN_PRICES_ENABLED` is on (`planPricesFlag.ts`, default
 * off). Off is P-1's state exactly: no key, no Stripe call, every plan invoice
 * denied. It is turned on per environment once `check-bos-plan-prices` passes
 * against that environment's Stripe account, so production never asks an
 * account that lacks the prices.
 *
 * FAILURE RULE. A Stripe error while loading THROWS. It must never degrade to
 * "nothing recognised": the router would then deny a paying customer's invoice
 * for good. Throwing releases the webhook claim and Stripe retries.
 *
 * No `active` filter: an archived price that still holds its lookup key is
 * still a plan price for renewals already running on it.
 *
 * Reads nothing from the database (SA P1-C6).
 *
 * @module lib/business-os/billing/planPriceCatalog
 */

import Stripe from 'stripe';

import { createLogger } from '@/lib/logger';
import {
  allPlanLookupKeys,
  tierForPlanLookupKey,
} from '@/lib/business-os/entitlements/config/planPrices';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';

const logger = createLogger({ module: 'business-os-billing' });

/** Every configured plan lookup key, current and retired (from the entitlements config). */
export const BOS_PLAN_LOOKUP_KEYS: readonly string[] = allPlanLookupKeys();

/**
 * The keys the process catalog looks up now: the configured ones while
 * plan-price recognition is switched on, none while it is off (see MERGE SAFETY).
 * Read on every load, so a flipped variable needs no module reload.
 */
export function activePlanLookupKeys(enabled: boolean = isPlanPriceRecognitionEnabled()): readonly string[] {
  return enabled ? BOS_PLAN_LOOKUP_KEYS : [];
}

/**
 * The tier a plan lookup key sells (current or retired), or `null`. P-3b reads
 * tiers from here rather than from the entitlements config directly.
 */
export function planTierForLookupKey(lookupKey: string): TierId | null {
  return tierForPlanLookupKey(lookupKey);
}

/** How long a loaded map is served before Stripe is asked again. */
export const PLAN_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Stripe accepts at most this many lookup keys in one `prices.list` call. */
const STRIPE_MAX_LOOKUP_KEYS = 10;

export interface KnownPlanPrices {
  /** price id → the lookup key it was found under */
  readonly byPriceId: ReadonlyMap<string, string>;
  /**
   * True when the map came from the cache rather than a fresh Stripe call. A
   * caller that finds a price missing from a cached map must reload with
   * `bypassCache` before denying (SA P1-C3).
   */
  readonly fromCache: boolean;
}

/** The slice of the Stripe client the catalog uses; injectable for tests. */
export interface PriceLister {
  prices: {
    list(params: { lookup_keys: string[]; limit?: number }): Promise<{
      data: ReadonlyArray<{ id: string; lookup_key: string | null }>;
    }>;
  };
}

export interface PlanPriceCatalog {
  load(options?: { bypassCache?: boolean }): Promise<KnownPlanPrices>;
}

export interface PlanPriceCatalogDeps {
  /** A fixed list, or a function read on every load. Default: `activePlanLookupKeys`. */
  lookupKeys?: readonly string[] | (() => readonly string[]);
  /** Called lazily, only when there is something to look up. */
  stripe?: () => PriceLister;
  now?: () => number;
  ttlMs?: number;
}

function defaultStripe(): PriceLister {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set; plan prices cannot be resolved');
  // Same API version as StripeService, so the price shape matches.
  return new Stripe(key, { apiVersion: '2025-10-29.clover' });
}

const EMPTY: KnownPlanPrices = { byPriceId: new Map(), fromCache: false };

export function createPlanPriceCatalog(deps: PlanPriceCatalogDeps = {}): PlanPriceCatalog {
  const keysSource = deps.lookupKeys ?? (() => activePlanLookupKeys());
  const currentKeys = (): readonly string[] => (typeof keysSource === 'function' ? keysSource() : keysSource);
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? PLAN_PRICE_CACHE_TTL_MS;
  const getStripe = deps.stripe ?? defaultStripe;

  // `keys` records which list the map answers, so a changed list (the switch
  // turned on, a retired key added) is never served from an older map.
  let cached: { map: ReadonlyMap<string, string>; loadedAt: number; keys: string } | null = null;

  return {
    async load(options = {}) {
      const lookupKeys = currentKeys();
      // Nothing configured: nothing to recognise, and no reason to call Stripe.
      if (lookupKeys.length === 0) return EMPTY;
      // Lookup keys hold no spaces, so this joins them unambiguously.
      const keysId = lookupKeys.join(' ');

      if (lookupKeys.length > STRIPE_MAX_LOOKUP_KEYS) {
        throw new Error(
          `BOS_PLAN_LOOKUP_KEYS has ${lookupKeys.length} keys; one prices.list call accepts ${STRIPE_MAX_LOOKUP_KEYS}`
        );
      }

      if (!options.bypassCache && cached && cached.keys === keysId && now() - cached.loadedAt < ttlMs) {
        return { byPriceId: cached.map, fromCache: true };
      }

      // Deliberately not caught: see FAILURE RULE above.
      const result = await getStripe().prices.list({ lookup_keys: [...lookupKeys], limit: 100 });

      const map = new Map<string, string>();
      for (const price of result.data) {
        if (price.lookup_key) map.set(price.id, price.lookup_key);
      }

      const found = new Set(map.values());
      const missing = lookupKeys.filter((k) => !found.has(k));
      if (missing.length > 0) {
        // A configured key with no price behind it is a setup gap, not an event
        // problem. Invoices on that plan will be denied until it is fixed.
        logger.error(
          { event: 'bos_billing_lookup_key_missing', missingLookupKeys: missing, alert: true },
          'Configured Business OS plan lookup keys resolve to no Stripe price'
        );
      }

      cached = { map, loadedAt: now(), keys: keysId };
      return { byPriceId: map, fromCache: false };
    },
  };
}

/** The process-wide catalog the webhook router uses. */
export const planPriceCatalog: PlanPriceCatalog = createPlanPriceCatalog();
