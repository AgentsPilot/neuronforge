/**
 * The runtime price check of the plan checkout (plan payments P-3a, workplan
 * T7; SA-P12 b; CF-1). Tiers and prices come from the config; nothing here
 * names a tier.
 */

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { displayMonthlyPricesUsd, displayPriceInCents, type StripePriceLike } from '@/lib/business-os/billing/planPriceCheck';
import {
  PLAN_CHECKOUT_PRICE_CACHE_TTL_MS,
  createPlanCheckoutPriceResolver,
} from '@/lib/business-os/billing/planCheckoutPrice';

const TIER = TIER_ORDER[0];
const OTHER = TIER_ORDER[1];
const KEY = PLAN_STRIPE_PRICES[TIER].lookupKey;
const CENTS = displayPriceInCents(displayMonthlyPricesUsd()[TIER]) as number;

function price(overrides: Partial<StripePriceLike> = {}): StripePriceLike {
  return {
    id: 'price_ok',
    lookup_key: KEY,
    active: true,
    currency: 'usd',
    unit_amount: CENTS,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    livemode: false,
    ...overrides,
  };
}

function setup(prices: () => Promise<readonly StripePriceLike[]>) {
  let clock = 1_000_000;
  const list = jest.fn<Promise<readonly StripePriceLike[]>, [readonly string[]]>(() => prices());
  const logger = { error: jest.fn() };
  const resolver = createPlanCheckoutPriceResolver({ listPricesByLookupKeys: list, now: () => clock });
  return { resolver, list, logger, advance: (ms: number) => (clock += ms) };
}

describe('createPlanCheckoutPriceResolver', () => {
  it('exactly one price equal to the display price → ok, asked by the CURRENT lookup key', async () => {
    const { resolver, list, logger } = setup(async () => [price()]);
    await expect(resolver.resolve(TIER, false, logger)).resolves.toEqual({ ok: true, priceId: 'price_ok', lookupKey: KEY, unitAmount: CENTS });
    expect(list).toHaveBeenCalledWith([KEY]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['no price (the CF-1 window)', [] as StripePriceLike[]],
    ['two prices', [price(), price({ id: 'price_two' })]],
    ['a price under another key only', [price({ lookup_key: 'something_else' })]],
  ])('%s → price_unavailable, alert', async (_label, found) => {
    const { resolver, logger } = setup(async () => found);
    const result = await resolver.resolve(TIER, false, logger);
    expect(result).toMatchObject({ ok: false, code: 'price_unavailable', lookupKey: KEY });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('a Stripe error → price_unavailable', async () => {
    const { resolver, logger } = setup(async () => {
      throw new Error('stripe down');
    });
    await expect(resolver.resolve(TIER, false, logger)).resolves.toMatchObject({ ok: false, code: 'price_unavailable' });
  });

  it.each([
    ['a different amount', { unit_amount: CENTS + 100 }],
    ['another currency', { currency: 'eur' }],
    ['a yearly interval', { recurring: { interval: 'year', interval_count: 1 } }],
    ['a two-month interval', { recurring: { interval: 'month', interval_count: 2 } }],
    ['tax inclusive', { tax_behavior: 'inclusive' }],
    ['another mode', { livemode: true }],
    ['an archived price', { active: false }],
    ['a one-off price', { type: 'one_time', recurring: null }],
  ])('%s → price_mismatch, logged at error with an alert', async (_label, overrides) => {
    const { resolver, logger } = setup(async () => [price(overrides as Partial<StripePriceLike>)]);
    const result = await resolver.resolve(TIER, false, logger);
    expect(result).toMatchObject({ ok: false, code: 'price_mismatch' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bos_billing_checkout_price_mismatch', alert: true }),
      expect.any(String)
    );
  });

  it('caches a PASSING price within the TTL and asks again after it', async () => {
    const { resolver, list, logger, advance } = setup(async () => [price()]);
    await resolver.resolve(TIER, false, logger);
    advance(PLAN_CHECKOUT_PRICE_CACHE_TTL_MS - 1);
    await resolver.resolve(TIER, false, logger);
    expect(list).toHaveBeenCalledTimes(1);
    advance(2);
    await resolver.resolve(TIER, false, logger);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('never caches a refusal: a fixed price is picked up at once', async () => {
    let answer: StripePriceLike[] = [];
    const { resolver, list, logger } = setup(async () => answer);
    await expect(resolver.resolve(TIER, false, logger)).resolves.toMatchObject({ ok: false });
    answer = [price()];
    await expect(resolver.resolve(TIER, false, logger)).resolves.toMatchObject({ ok: true });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not serve one key from another key's cache, nor one mode from the other's", async () => {
    const otherKey = PLAN_STRIPE_PRICES[OTHER].lookupKey;
    const otherCents = displayPriceInCents(displayMonthlyPricesUsd()[OTHER]) as number;
    const { resolver, list, logger } = setup(async () => {
      const keys = list.mock.calls[list.mock.calls.length - 1][0];
      return keys[0] === otherKey ? [price({ id: 'price_other', lookup_key: otherKey, unit_amount: otherCents })] : [price()];
    });
    await resolver.resolve(TIER, false, logger);
    await expect(resolver.resolve(OTHER, false, logger)).resolves.toMatchObject({ ok: true, priceId: 'price_other' });
    await resolver.resolve(TIER, true, logger); // live: a separate entry (and a mode mismatch here)
    expect(list).toHaveBeenCalledTimes(3);
  });
});
