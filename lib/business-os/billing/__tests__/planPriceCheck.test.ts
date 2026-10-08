/**
 * The plan price check (plan payments P-2b, workplan §3.4, §7; SA-P12 a).
 *
 * Tier names are never written as literals here (FR-12 tier-literal guard):
 * every tier is read from TIER_ORDER and its key from the config.
 */

import {
  checkPlanPrices,
  displayMonthlyPricesUsd,
  displayPriceInCents,
  groupPricesByLookupKey,
  planPricesPass,
  type StripePriceLike,
} from '@/lib/business-os/billing/planPriceCheck';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';

const [CHEAPER, DEARER] = TIER_ORDER;
const keyOf = (tier: TierId) => PLAN_STRIPE_PRICES[tier].lookupKey;
const cents = (tier: TierId) => Math.round(TIER_MATRIX.presentation[tier].monthlyPriceUsd * 100);

function goodPrice(tier: TierId, overrides: Partial<StripePriceLike> = {}): StripePriceLike {
  return {
    id: `price_${tier}`,
    lookup_key: keyOf(tier),
    active: true,
    currency: 'usd',
    unit_amount: cents(tier),
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    livemode: false,
    ...overrides,
  };
}

function check(prices: StripePriceLike[], extra: { expectedLivemode?: boolean; displayPricesUsd?: Record<TierId, number> } = {}) {
  return checkPlanPrices({
    pricesByLookupKey: groupPricesByLookupKey(prices),
    expectedLivemode: extra.expectedLivemode ?? false,
    displayPricesUsd: extra.displayPricesUsd,
  });
}

const good = () => TIER_ORDER.map((tier) => goodPrice(tier));

describe('checkPlanPrices', () => {
  it('the display prices it compares with are the tier matrix ones ($79 and $129 today)', () => {
    expect(displayMonthlyPricesUsd()).toEqual({ [CHEAPER]: 79, [DEARER]: 129 });
  });

  it('passes when every current price matches its display price', () => {
    const findings = check(good());
    expect(findings.map((f) => [f.tier, f.status, f.priceId, f.expectedUnitAmount])).toEqual([
      [CHEAPER, 'pass', `price_${CHEAPER}`, 7900],
      [DEARER, 'pass', `price_${DEARER}`, 12900],
    ]);
    expect(planPricesPass(findings)).toBe(true);
  });

  it.each<[string, Partial<StripePriceLike>, RegExp]>([
    ['inactive', { active: false }, /not active/],
    ['one-time', { type: 'one_time', recurring: null }, /not recurring/],
    ['yearly', { recurring: { interval: 'year', interval_count: 1 } }, /interval year/],
    ['every two months', { recurring: { interval: 'month', interval_count: 2 } }, /interval_count 2/],
    ['in euros', { currency: 'eur' }, /currency eur/],
    ['a different amount', { unit_amount: 7800 }, /unit_amount 7800 differs from display 7900/],
    ['no amount', { unit_amount: null }, /unit_amount none/],
    ['tax inclusive', { tax_behavior: 'inclusive' }, /tax_behavior inclusive/],
    ['tax unspecified', { tax_behavior: 'unspecified' }, /tax_behavior unspecified/],
    ['in live mode against a test key', { livemode: true }, /livemode true but the key is test/],
  ])('fails a price that is %s', (_label, override, problem) => {
    const findings = check([goodPrice(CHEAPER, override), goodPrice(DEARER)]);
    expect(findings[0].status).toBe('fail');
    expect(findings[0].problems.join('; ')).toMatch(problem);
    expect(findings[1].status).toBe('pass');
    expect(planPricesPass(findings)).toBe(false);
  });

  it('a test-mode price fails against a live key', () => {
    const findings = check(good(), { expectedLivemode: true });
    expect(findings.every((f) => f.status === 'fail')).toBe(true);
  });

  it('fails a tier with no price, and one with two prices under its key', () => {
    const findings = check([goodPrice(DEARER), goodPrice(DEARER, { id: 'price_dup' })]);
    expect(findings[0]).toMatchObject({ tier: CHEAPER, status: 'fail', problems: ['no price has this lookup key'] });
    expect(findings[1]).toMatchObject({ tier: DEARER, status: 'fail', problems: ['2 prices have this lookup key'] });
  });

  it('a changed DISPLAY price makes the check fail (Stripe must follow the tier matrix)', () => {
    const findings = check(good(), { displayPricesUsd: { [CHEAPER]: 80, [DEARER]: 129 } as Record<TierId, number> });
    expect(findings[0].status).toBe('fail');
    expect(findings[0].problems).toEqual(['unit_amount 7900 differs from display 8000']);
  });

  it('a display price with sub-cent precision fails rather than being rounded', () => {
    const findings = check(good(), { displayPricesUsd: { [CHEAPER]: 79.005, [DEARER]: 129 } as Record<TierId, number> });
    expect(findings[0]).toMatchObject({ status: 'fail', problems: ['display price 79.005 has sub-cent precision'] });
  });

  it('a retired key is INFO, found or not, and never fails the check (CF-1)', () => {
    const retired = `${keyOf(CHEAPER)}_retired_20270101`;
    const planPrices = {
      [CHEAPER]: { lookupKey: keyOf(CHEAPER), retiredLookupKeys: [retired] },
      [DEARER]: { lookupKey: keyOf(DEARER), retiredLookupKeys: [] },
    } as Record<TierId, { lookupKey: string; retiredLookupKeys: string[] }>;

    const missing = checkPlanPrices({ pricesByLookupKey: groupPricesByLookupKey(good()), expectedLivemode: false, planPrices });
    expect(missing[1]).toMatchObject({ kind: 'retired', status: 'info', lookupKey: retired });
    expect(planPricesPass(missing)).toBe(true);

    const archivedOld = goodPrice(CHEAPER, { id: 'price_old', lookup_key: retired, active: false, unit_amount: 6900 });
    const found = checkPlanPrices({
      pricesByLookupKey: groupPricesByLookupKey([...good(), archivedOld]),
      expectedLivemode: false,
      planPrices,
    });
    expect(found[1]).toMatchObject({ kind: 'retired', status: 'info', priceId: 'price_old' });
    expect(planPricesPass(found)).toBe(true);
  });
});

describe('helpers', () => {
  it('displayPriceInCents: whole cents, or null for sub-cent precision', () => {
    expect(displayPriceInCents(79)).toBe(7900);
    expect(displayPriceInCents(129)).toBe(12900);
    expect(displayPriceInCents(64.5)).toBe(6450);
    expect(displayPriceInCents(0.1 + 0.2)).toBe(30); // float noise is not sub-cent precision
    expect(displayPriceInCents(79.005)).toBeNull();
  });

  it('groupPricesByLookupKey drops prices with no key', () => {
    const grouped = groupPricesByLookupKey([goodPrice(CHEAPER), goodPrice(CHEAPER, { id: 'price_x', lookup_key: null })]);
    expect([...grouped.keys()]).toEqual([keyOf(CHEAPER)]);
  });
});
