/**
 * Does each plan's Stripe price equal the price we SHOW? (plan payments P-2b,
 * workplan §3.4; SA-P12 a. P-3a's checkout reuses it at runtime, SA-P12 b.)
 *
 * Pure: it takes the prices Stripe returned and compares them with the display
 * price in the tier matrix (`presentation.<tier>.monthlyPriceUsd`). No Stripe
 * client and no environment read, so the scripts and the checkout share it.
 *
 * For each configured tier, the price behind its CURRENT lookup key must be:
 * exactly one price; active; recurring monthly (interval `month`, count 1);
 * `usd` (SR-15); `unit_amount` equal to the display price in cents; tax
 * `exclusive` (BQ-P5, "excluding tax"); and in the expected mode. A display
 * price with sub-cent precision fails rather than being rounded.
 *
 * RETIRED keys (CF-1) are reported as `info`, found or not, and never fail:
 * an old price may be archived or deleted once nobody renews on it.
 *
 * Refuses nothing by plan: it compares two prices.
 *
 * @module lib/business-os/billing/planPriceCheck
 */

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import type { PlanStripePrice } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';

/** The fields of a Stripe price the check reads. `Stripe.Price` satisfies it. */
export interface StripePriceLike {
  readonly id: string;
  readonly lookup_key: string | null;
  readonly active: boolean;
  readonly currency: string;
  readonly unit_amount: number | null;
  readonly type: string;
  readonly recurring: { readonly interval: string; readonly interval_count: number } | null;
  readonly tax_behavior: string | null;
  readonly livemode: boolean;
}

export interface PlanPriceFinding {
  readonly tier: TierId;
  readonly lookupKey: string;
  /** `current`: the key we sell under. `retired`: an earlier price (CF-1). */
  readonly kind: 'current' | 'retired';
  /** `info` only for retired keys. */
  readonly status: 'pass' | 'fail' | 'info';
  readonly problems: readonly string[];
  readonly priceId?: string;
  /** The display price in cents, when it is a whole number of cents. */
  readonly expectedUnitAmount?: number;
}

export interface PlanPriceCheckInput {
  /** Every price Stripe returned, grouped by lookup key. */
  readonly pricesByLookupKey: ReadonlyMap<string, readonly StripePriceLike[]>;
  /** `false` for a test-mode or sandbox key, `true` for a live key. */
  readonly expectedLivemode: boolean;
  /** Injectable for tests; default: the tier matrix's display prices. */
  readonly displayPricesUsd?: Readonly<Record<TierId, number>>;
  /** Injectable for tests; default: the configured lookup keys. */
  readonly planPrices?: Readonly<Record<TierId, PlanStripePrice>>;
}

/** The tier matrix's display price per tier, in USD. */
export function displayMonthlyPricesUsd(): Readonly<Record<TierId, number>> {
  const out = {} as Record<TierId, number>;
  for (const tier of TIER_ORDER) out[tier] = TIER_MATRIX.presentation[tier].monthlyPriceUsd;
  return out;
}

/** Whole cents for a USD display price, or `null` when it has sub-cent precision. */
export function displayPriceInCents(usd: number): number | null {
  const cents = usd * 100;
  const rounded = Math.round(cents);
  return Math.abs(cents - rounded) < 1e-9 ? rounded : null;
}

/** Groups prices by lookup key; prices with no key are dropped. */
export function groupPricesByLookupKey(
  prices: readonly StripePriceLike[]
): ReadonlyMap<string, readonly StripePriceLike[]> {
  const map = new Map<string, StripePriceLike[]>();
  for (const price of prices) {
    if (!price.lookup_key) continue;
    const list = map.get(price.lookup_key) ?? [];
    list.push(price);
    map.set(price.lookup_key, list);
  }
  return map;
}

/** Everything wrong with one price, compared with the display price. Empty means equal. */
export function priceProblems(
  price: StripePriceLike,
  expectedUnitAmount: number,
  expectedLivemode: boolean
): string[] {
  const problems: string[] = [];
  if (!price.active) problems.push('price is not active');
  if (price.type !== 'recurring' || !price.recurring) {
    problems.push(`type ${price.type} is not recurring`);
  } else {
    if (price.recurring.interval !== 'month') problems.push(`interval ${price.recurring.interval} is not month`);
    if (price.recurring.interval_count !== 1) {
      problems.push(`interval_count ${price.recurring.interval_count} is not 1`);
    }
  }
  if (price.currency !== 'usd') problems.push(`currency ${price.currency} is not usd`);
  if (price.unit_amount !== expectedUnitAmount) {
    problems.push(`unit_amount ${price.unit_amount ?? 'none'} differs from display ${expectedUnitAmount}`);
  }
  if (price.tax_behavior !== 'exclusive') problems.push(`tax_behavior ${price.tax_behavior ?? 'none'} is not exclusive`);
  if (price.livemode !== expectedLivemode) {
    problems.push(`livemode ${price.livemode} but the key is ${expectedLivemode ? 'live' : 'test'} mode`);
  }
  return problems;
}

export function checkPlanPrices(input: PlanPriceCheckInput): PlanPriceFinding[] {
  const display = input.displayPricesUsd ?? displayMonthlyPricesUsd();
  const planPrices = input.planPrices ?? PLAN_STRIPE_PRICES;
  const findings: PlanPriceFinding[] = [];

  for (const tier of TIER_ORDER) {
    const { lookupKey, retiredLookupKeys } = planPrices[tier];
    const found = input.pricesByLookupKey.get(lookupKey) ?? [];
    const expected = displayPriceInCents(display[tier]);

    if (expected === null) {
      findings.push({
        tier,
        lookupKey,
        kind: 'current',
        status: 'fail',
        problems: [`display price ${display[tier]} has sub-cent precision`],
        priceId: found.length === 1 ? found[0].id : undefined,
      });
    } else if (found.length !== 1) {
      findings.push({
        tier,
        lookupKey,
        kind: 'current',
        status: 'fail',
        problems: [found.length === 0 ? 'no price has this lookup key' : `${found.length} prices have this lookup key`],
        expectedUnitAmount: expected,
      });
    } else {
      const problems = priceProblems(found[0], expected, input.expectedLivemode);
      findings.push({
        tier,
        lookupKey,
        kind: 'current',
        status: problems.length === 0 ? 'pass' : 'fail',
        problems,
        priceId: found[0].id,
        expectedUnitAmount: expected,
      });
    }

    for (const retired of retiredLookupKeys) {
      const old = input.pricesByLookupKey.get(retired) ?? [];
      findings.push({
        tier,
        lookupKey: retired,
        kind: 'retired',
        status: 'info',
        problems: [old.length === 0 ? 'retired key: no price found' : `retired key: ${old.length} price(s) found`],
        priceId: old.length === 1 ? old[0].id : undefined,
      });
    }
  }

  return findings;
}

/** True when no finding failed. */
export function planPricesPass(findings: readonly PlanPriceFinding[]): boolean {
  return findings.every((finding) => finding.status !== 'fail');
}
