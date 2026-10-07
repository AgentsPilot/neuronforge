/**
 * The Stripe price a plan checkout sells, checked against the price we SHOW
 * (plan payments P-3a, workplan §3.3 step 10; SA-P12 b; CF-1).
 *
 * Tier → its CURRENT lookup key (`PLAN_STRIPE_PRICES`) → exactly one Stripe
 * price → `priceProblems` against the tier matrix's display price and the
 * server key's mode. Any doubt refuses:
 *
 * - no price, more than one, or a Stripe error → `price_unavailable` (this is
 *   also the CF-1 window, between "retire the old key" and "create the new
 *   price", when the main key resolves to nothing);
 * - any difference (amount, currency, interval, tax behaviour, mode, inactive),
 *   or a display price with sub-cent precision → `price_mismatch`, logged at
 *   `error` with an alert.
 *
 * Only a PASSING price is cached, per instance, for 60 s, keyed on mode and
 * lookup key, so one buyer's click does not cost every next buyer a Stripe
 * call, and a fixed price is picked up at once.
 *
 * Refuses nothing by plan: it compares two prices. No tier name is written here.
 *
 * @module lib/business-os/billing/planCheckoutPrice
 */

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import type { PlanStripePrices } from '@/lib/business-os/entitlements/config/planPrices';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  displayMonthlyPricesUsd,
  displayPriceInCents,
  priceProblems,
  type StripePriceLike,
} from '@/lib/business-os/billing/planPriceCheck';

export const PLAN_CHECKOUT_PRICE_CACHE_TTL_MS = 60 * 1000;

export type PlanCheckoutPrice =
  | { ok: true; priceId: string; lookupKey: string; unitAmount: number }
  | { ok: false; code: 'price_unavailable' | 'price_mismatch'; lookupKey: string; problems: readonly string[] };

export interface PlanCheckoutPriceLogger {
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface PlanCheckoutPriceDeps {
  listPricesByLookupKeys: (lookupKeys: readonly string[]) => Promise<readonly StripePriceLike[]>;
  now?: () => number;
  ttlMs?: number;
  /** Injectable for tests; default: the configured lookup keys. */
  planPrices?: PlanStripePrices;
  /** Injectable for tests; default: the tier matrix's display prices. */
  displayPricesUsd?: Readonly<Record<TierId, number>>;
}

export interface PlanCheckoutPriceResolver {
  resolve(tier: TierId, livemode: boolean, logger: PlanCheckoutPriceLogger): Promise<PlanCheckoutPrice>;
}

export function createPlanCheckoutPriceResolver(deps: PlanCheckoutPriceDeps): PlanCheckoutPriceResolver {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? PLAN_CHECKOUT_PRICE_CACHE_TTL_MS;
  const cache = new Map<string, { price: Extract<PlanCheckoutPrice, { ok: true }>; storedAt: number }>();

  return {
    async resolve(tier, livemode, logger) {
      const lookupKey = (deps.planPrices ?? PLAN_STRIPE_PRICES)[tier].lookupKey;
      const cacheKey = `${livemode ? 'live' : 'test'}:${lookupKey}`;
      const cached = cache.get(cacheKey);
      if (cached && now() - cached.storedAt < ttlMs) return cached.price;

      const expected = displayPriceInCents((deps.displayPricesUsd ?? displayMonthlyPricesUsd())[tier]);
      if (expected === null) {
        logger.error(
          { event: 'bos_billing_checkout_price_mismatch', tier, lookupKey, alert: true },
          'Display price has sub-cent precision; plan checkout refused'
        );
        return { ok: false, code: 'price_mismatch', lookupKey, problems: ['display price has sub-cent precision'] };
      }

      let prices: readonly StripePriceLike[];
      try {
        prices = await deps.listPricesByLookupKeys([lookupKey]);
      } catch (err) {
        logger.error({ err, tier, lookupKey }, 'Stripe price lookup failed; plan checkout refused');
        return { ok: false, code: 'price_unavailable', lookupKey, problems: ['stripe price lookup failed'] };
      }

      const matching = prices.filter((price) => price.lookup_key === lookupKey);
      if (matching.length !== 1) {
        logger.error(
          { event: 'bos_billing_lookup_key_missing', tier, lookupKey, found: matching.length, alert: true },
          'Plan lookup key does not resolve to exactly one Stripe price; plan checkout refused'
        );
        return {
          ok: false,
          code: 'price_unavailable',
          lookupKey,
          problems: [matching.length === 0 ? 'no price has this lookup key' : `${matching.length} prices have this lookup key`],
        };
      }

      const problems = priceProblems(matching[0], expected, livemode);
      if (problems.length > 0) {
        logger.error(
          { event: 'bos_billing_checkout_price_mismatch', tier, lookupKey, priceId: matching[0].id, problems, alert: true },
          'Stripe plan price differs from the display price; plan checkout refused'
        );
        return { ok: false, code: 'price_mismatch', lookupKey, problems };
      }

      const price = { ok: true as const, priceId: matching[0].id, lookupKey, unitAmount: expected };
      cache.set(cacheKey, { price, storedAt: now() });
      return price;
    },
  };
}
