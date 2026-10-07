jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BOS_PLAN_LOOKUP_KEYS,
  PLAN_PRICE_CACHE_TTL_MS,
  activePlanLookupKeys,
  createPlanPriceCatalog,
  planPriceCatalog,
  planTierForLookupKey,
  type PriceLister,
} from '@/lib/business-os/billing/planPriceCatalog';
import { allPlanLookupKeys, PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const FLAG = 'BUSINESS_OS_PLAN_PRICES_ENABLED';

/** Runs `fn` with the recognition switch set to `value` (or unset), then restores it. */
async function withFlag<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const saved = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env[FLAG];
    else process.env[FLAG] = saved;
  }
}

function fakeStripe(
  answer: () => Promise<{ data: Array<{ id: string; lookup_key: string | null }> }>
): { lister: PriceLister; list: jest.Mock; factory: jest.Mock } {
  const list = jest.fn(answer);
  const lister: PriceLister = { prices: { list } };
  const factory = jest.fn(() => lister);
  return { lister, list, factory };
}

const PRICES = {
  data: [
    { id: 'price_pro', lookup_key: 'bos_plan_pro_monthly' },
    { id: 'price_biz', lookup_key: 'bos_plan_business_monthly' },
  ],
};

describe('planPriceCatalog', () => {
  it('P-2b fills the configured list from the entitlements config (current and retired keys)', () => {
    expect(BOS_PLAN_LOOKUP_KEYS).toEqual(allPlanLookupKeys());
    expect(BOS_PLAN_LOOKUP_KEYS).toEqual(['bos_plan_basic_monthly_usd', 'bos_plan_pro_monthly_usd']);
  });

  it.each([[undefined], [''], ['false'], ['0'], ['yes']])(
    'with the recognition switch %p, the active list is EMPTY (P-1 behaviour)',
    async (value) => {
      await withFlag(value, () => expect(activePlanLookupKeys()).toEqual([]));
    }
  );

  it.each([['true'], ['1'], [' TRUE ']])('with the recognition switch %p, the active list is the configured one', async (value) => {
    await withFlag(value, () => expect(activePlanLookupKeys()).toEqual(BOS_PLAN_LOOKUP_KEYS));
  });

  it('switch off: the process catalog returns an empty map without calling Stripe', async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY; // a Stripe call would throw on the missing key
    try {
      await withFlag(undefined, async () => {
        const known = await planPriceCatalog.load();
        expect(known.byPriceId.size).toBe(0);
        expect(known.fromCache).toBe(false);
      });
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
  });

  it('switch on: the process catalog asks Stripe, and a failure THROWS (the webhook retries, never denies)', async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY; // the default client refuses to build without a key
    try {
      await withFlag('true', async () => {
        await expect(planPriceCatalog.load()).rejects.toThrow(/STRIPE_SECRET_KEY is not set/);
      });
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
  });

  it('the switch is read on every load: turning it on needs no new catalog', async () => {
    const { factory, list } = fakeStripe(() =>
      Promise.resolve({ data: [{ id: 'price_basic', lookup_key: 'bos_plan_basic_monthly_usd' }] })
    );
    const catalog = createPlanPriceCatalog({ stripe: factory });
    await withFlag(undefined, async () => expect((await catalog.load()).byPriceId.size).toBe(0));
    expect(factory).not.toHaveBeenCalled();
    await withFlag('true', async () => {
      const known = await catalog.load();
      expect(known.byPriceId.get('price_basic')).toBe('bos_plan_basic_monthly_usd');
    });
    expect(list.mock.calls[0][0]).toEqual({ lookup_keys: [...BOS_PLAN_LOOKUP_KEYS], limit: 100 });
  });

  it('a changed key list is never served from a map loaded for another list', async () => {
    let keys: readonly string[] = ['bos_plan_pro_monthly'];
    const { factory, list } = fakeStripe(() => Promise.resolve(PRICES));
    const catalog = createPlanPriceCatalog({ lookupKeys: () => keys, stripe: factory, now: () => 1 });
    await catalog.load();
    keys = ['bos_plan_pro_monthly', 'bos_plan_business_monthly'];
    expect((await catalog.load()).fromCache).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('a price behind a RETIRED key is recognised, and named by its tier (CF-1)', async () => {
    const retired = 'bos_plan_basic_monthly_usd_retired_20270101';
    const { factory } = fakeStripe(() => Promise.resolve({ data: [{ id: 'price_old', lookup_key: retired }] }));
    const catalog = createPlanPriceCatalog({ lookupKeys: [...BOS_PLAN_LOOKUP_KEYS, retired], stripe: factory });
    expect((await catalog.load()).byPriceId.get('price_old')).toBe(retired);
  });

  it('planTierForLookupKey names the tier of each configured key, and null for any other', () => {
    for (const tier of TIER_ORDER) {
      expect(planTierForLookupKey(PLAN_STRIPE_PRICES[tier].lookupKey)).toBe(tier);
    }
    expect(planTierForLookupKey('bos_router_fixture_probe_a')).toBeNull();
    expect(planTierForLookupKey('')).toBeNull();
  });

  it('an empty list never constructs a Stripe client', async () => {
    const { factory } = fakeStripe(() => Promise.resolve(PRICES));
    const catalog = createPlanPriceCatalog({ lookupKeys: [], stripe: factory });
    expect((await catalog.load()).byPriceId.size).toBe(0);
    expect(factory).not.toHaveBeenCalled();
  });

  it('listed keys: one prices.list call with no active filter, map built', async () => {
    const { factory, list } = fakeStripe(() => Promise.resolve(PRICES));
    const catalog = createPlanPriceCatalog({
      lookupKeys: ['bos_plan_pro_monthly', 'bos_plan_business_monthly'],
      stripe: factory,
    });
    const known = await catalog.load();
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toEqual({
      lookup_keys: ['bos_plan_pro_monthly', 'bos_plan_business_monthly'],
      limit: 100,
    });
    expect(list.mock.calls[0][0]).not.toHaveProperty('active');
    expect([...known.byPriceId]).toEqual([
      ['price_pro', 'bos_plan_pro_monthly'],
      ['price_biz', 'bos_plan_business_monthly'],
    ]);
    expect(known.fromCache).toBe(false);
  });

  it('serves the cache within the TTL, refetches after it, and bypassCache forces a refetch', async () => {
    let t = 1_000_000;
    const { factory, list } = fakeStripe(() => Promise.resolve(PRICES));
    const catalog = createPlanPriceCatalog({ lookupKeys: ['bos_plan_pro_monthly'], stripe: factory, now: () => t });

    await catalog.load();
    t += PLAN_PRICE_CACHE_TTL_MS - 1;
    const cached = await catalog.load();
    expect(cached.fromCache).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);

    const forced = await catalog.load({ bypassCache: true });
    expect(forced.fromCache).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);

    t += PLAN_PRICE_CACHE_TTL_MS;
    expect((await catalog.load()).fromCache).toBe(false);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('a Stripe error throws; it never degrades to an empty map', async () => {
    const { factory } = fakeStripe(() => Promise.reject(new Error('stripe down')));
    const catalog = createPlanPriceCatalog({ lookupKeys: ['bos_plan_pro_monthly'], stripe: factory });
    await expect(catalog.load()).rejects.toThrow('stripe down');
  });

  it('a failed load does not poison the cache: the next load asks Stripe again', async () => {
    let fail = true;
    const { factory, list } = fakeStripe(() => (fail ? Promise.reject(new Error('blip')) : Promise.resolve(PRICES)));
    const catalog = createPlanPriceCatalog({ lookupKeys: ['bos_plan_pro_monthly'], stripe: factory });
    await expect(catalog.load()).rejects.toThrow('blip');
    fail = false;
    expect((await catalog.load()).byPriceId.get('price_pro')).toBe('bos_plan_pro_monthly');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('refuses more keys than one Stripe call accepts', async () => {
    const keys = Array.from({ length: 11 }, (_, i) => `k${i}`);
    const { factory } = fakeStripe(() => Promise.resolve({ data: [] }));
    await expect(createPlanPriceCatalog({ lookupKeys: keys, stripe: factory }).load()).rejects.toThrow(/accepts 10/);
  });
});
