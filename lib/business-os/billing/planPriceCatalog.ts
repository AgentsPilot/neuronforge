/**
 * The Stripe prices that ARE Business OS plan prices.
 *
 * Plan prices are identified by their Stripe lookup keys (identities we
 * control), never by metadata (which whoever creates an object can write). The
 * keys are the same in test and live mode (Q-T1), so this list is not per
 * environment.
 *
 * P-1: the list is EMPTY, so nothing is recognised and every platform
 * subscription invoice is denied by the router. That is the intended state:
 * protective only. P-2 fills the list when it creates the prices.
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

const logger = createLogger({ module: 'business-os-billing' });

/** Lookup keys of Business OS plan prices. Empty until P-2 creates the prices. */
export const BOS_PLAN_LOOKUP_KEYS: readonly string[] = [];

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
  lookupKeys?: readonly string[];
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
  const lookupKeys = deps.lookupKeys ?? BOS_PLAN_LOOKUP_KEYS;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? PLAN_PRICE_CACHE_TTL_MS;
  const getStripe = deps.stripe ?? defaultStripe;

  let cached: { map: ReadonlyMap<string, string>; loadedAt: number } | null = null;

  return {
    async load(options = {}) {
      // Nothing configured: nothing to recognise, and no reason to call Stripe.
      if (lookupKeys.length === 0) return EMPTY;

      if (lookupKeys.length > STRIPE_MAX_LOOKUP_KEYS) {
        throw new Error(
          `BOS_PLAN_LOOKUP_KEYS has ${lookupKeys.length} keys; one prices.list call accepts ${STRIPE_MAX_LOOKUP_KEYS}`
        );
      }

      if (!options.bypassCache && cached && now() - cached.loadedAt < ttlMs) {
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

      cached = { map, loadedAt: now() };
      return { byPriceId: map, fromCache: false };
    },
  };
}

/** The process-wide catalog the webhook router uses. */
export const planPriceCatalog: PlanPriceCatalog = createPlanPriceCatalog();
