// lib/business-os/entitlements/config/planPrices.ts
//
// THE PLAN PRICES IN STRIPE — which Stripe price each paid tier is sold at.
//
// Business OS plan payments P-2b (workplan §3.1, §3.2; reuse plan Q-T1; SA
// P-1 ruling Q-4: the lookup key → tier mapping lives in the entitlements
// config, the one folder allowed to name a tier).
//
// ── LOOKUP KEYS, NOT PRICE IDS ──────────────────────────────────────────────
// A price is named by its Stripe LOOKUP KEY, which we choose and which is the
// same in every Stripe account and mode. Price ids differ between the sandbox,
// test mode and live mode, so a list of ids would be a per-environment table.
// Nothing here, and nothing in app code, may hold a price, product or account id.
//
// `satisfies Record<TierId, …>` means a new tier does not compile without an
// entry here. Cohorts (`trial`, `champion`) have none: they are not sold.
//
// ── CHANGING A PRICE (CF-1) ─────────────────────────────────────────────────
// A subscriber renews on the price they bought, so the old price must stay
// recognised after a new one takes over. The procedure, in this order:
//
//   1. In a PR that also changes the display price in `tierMatrix.ts`, add
//      `<lookupKey>_retired_<yyyymmdd>` to that tier's `retiredLookupKeys`.
//      Deploy it.
//   2. In Stripe, give the CURRENT price that retired key
//      (`prices.update({ lookup_key })`). This frees the main key.
//   3. Create the new price with the main key (`scripts/setup-bos-plan-prices.ts`
//      does this; it refuses to touch a price whose amount differs).
//   4. `npm run check-bos-plan-prices` must PASS.
//
// Between steps 2 and 3 the main key resolves to nothing: the catalog logs
// `bos_billing_lookup_key_missing` and checkouts fail closed; renewals on the
// old price still resolve through the retired key.
//
// ── THE TEN-KEY LIMIT ───────────────────────────────────────────────────────
// The catalog reads every key in ONE `prices.list` call, which accepts at most
// ten. A test keeps `allPlanLookupKeys()` within it, so going over fails CI
// instead of throwing on every platform invoice webhook.
//
// Data and two pure lookups only. No Stripe client, no environment read.

import type { TierId } from './tierMatrix';

export interface PlanStripePrice {
  /** The lookup key of the price we sell now. The same in every Stripe account and mode (Q-T1). */
  readonly lookupKey: string;
  /** Lookup keys of earlier prices whose subscribers may still renew on them (CF-1). */
  readonly retiredLookupKeys: readonly string[];
}

export const PLAN_STRIPE_PRICES = {
  basic: { lookupKey: 'bos_plan_basic_monthly_usd', retiredLookupKeys: [] },
  pro: { lookupKey: 'bos_plan_pro_monthly_usd', retiredLookupKeys: [] },
} as const satisfies Record<TierId, PlanStripePrice>;

/** The shape callers may rely on (the literal above is narrower). */
export type PlanStripePrices = Readonly<Record<TierId, PlanStripePrice>>;

/** Every plan lookup key, current and retired, deduplicated, in tier order. */
export function allPlanLookupKeys(prices: PlanStripePrices = PLAN_STRIPE_PRICES): readonly string[] {
  const keys: string[] = [];
  for (const entry of Object.values(prices) as PlanStripePrice[]) {
    for (const key of [entry.lookupKey, ...entry.retiredLookupKeys]) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** The tier a lookup key sells, current or retired. `null` for any other key. */
export function tierForPlanLookupKey(
  key: string,
  prices: PlanStripePrices = PLAN_STRIPE_PRICES
): TierId | null {
  for (const [tier, entry] of Object.entries(prices) as Array<[TierId, PlanStripePrice]>) {
    if (entry.lookupKey === key || entry.retiredLookupKeys.includes(key)) return tier;
  }
  return null;
}
