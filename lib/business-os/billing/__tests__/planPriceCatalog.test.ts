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
  createPlanPriceCatalog,
  planPriceCatalog,
  type PriceLister,
} from '@/lib/business-os/billing/planPriceCatalog';

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
  it('P-1 ships an empty lookup-key list: nothing is recognised', () => {
    expect(BOS_PLAN_LOOKUP_KEYS).toEqual([]);
  });

  it('the process catalog returns an empty map without calling Stripe', async () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY; // a Stripe call would throw on the missing key
    try {
      const known = await planPriceCatalog.load();
      expect(known.byPriceId.size).toBe(0);
      expect(known.fromCache).toBe(false);
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
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
