/**
 * `GET /api/business-os/credits/boost/packages` (credits boost slice 5a,
 * workplan §6; SA C-3, C-4, Q-1, Q-2, Q-4).
 *
 * The real route, view mapper and shipped catalogue run; only the session and
 * the logger are faked, and the catalogue source is swapped per test to make it
 * reject. Figures are read from the catalogue itself, never typed here.
 */

import { NextRequest } from 'next/server';

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const state = {
  user: { id: ACCOUNT, email: 'owner@example.com' } as { id: string } | null,
  source: null as null | { listActive: () => Promise<unknown[]> },
  sourceCalls: 0,
};

const logs = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ ...logs, child: () => logs }),
}));
jest.mock('@/lib/business-os/entitlements/boostCatalogue', () => {
  const actual = jest.requireActual('@/lib/business-os/entitlements/boostCatalogue');
  return {
    ...actual,
    codeBoostPackageSource: () => {
      state.sourceCalls += 1;
      return state.source ?? actual.codeBoostPackageSource();
    },
  };
});

import { GET } from '@/app/api/business-os/credits/boost/packages/route';
const { codeBoostPackageSource, BoostCatalogueInvalidError } = jest.requireActual(
  '@/lib/business-os/entitlements/boostCatalogue'
) as typeof import('@/lib/business-os/entitlements/boostCatalogue');

const get = (query = '') =>
  new NextRequest(`http://localhost/api/business-os/credits/boost/packages${query}`, { method: 'GET' });

const ENV = { ...process.env };
const BOOST_ENV_KEYS = ['BUSINESS_OS_CREDITS_BOOST_ENABLED', 'BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY'];
afterAll(() => {
  process.env = ENV;
});

beforeEach(() => {
  process.env = { ...ENV };
  for (const key of BOOST_ENV_KEYS) delete process.env[key];
  state.user = { id: ACCOUNT };
  state.source = null;
  state.sourceCalls = 0;
  jest.clearAllMocks();
});

/** SA C-4: exactly these keys, so a field added to `BoostPackage` cannot leak by spread. */
const VIEW_KEYS = [
  'baseCredits',
  'bonusCredits',
  'bonusPercent',
  'currency',
  'id',
  'labels',
  'order',
  'priceMinor',
  'taxExclusive',
  'totalCredits',
  'version',
];

describe('GET /api/business-os/credits/boost/packages', () => {
  it('happy path: the active packages in order, the catalogue\'s own figures, purchaseAvailable false (switch off), private no-store (5b)', async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.purchaseAvailable).toBe(false);

    const expected = await codeBoostPackageSource().listActive();
    expect(body.data.packages.map((p: { id: string }) => p.id)).toEqual(expected.map((p) => p.id));
    expect(body.data.packages.map((p: { id: string }) => p.id)).toEqual(['starter', 'plus', 'max']);
    body.data.packages.forEach((view: Record<string, unknown>, index: number) => {
      const pkg = expected[index];
      expect(view).toMatchObject({
        priceMinor: pkg.priceMinor,
        currency: 'USD',
        taxExclusive: true,
        baseCredits: pkg.baseCredits,
        bonusCredits: pkg.bonusCredits,
        totalCredits: pkg.totalCredits,
        bonusPercent: pkg.bonusPercent,
        order: pkg.order,
        version: pkg.version,
      });
    });
  });

  it('C-4: every package view has exactly the allowed keys; nothing internal (active, versions, cost, rate)', async () => {
    const body = await (await GET(get())).json();
    for (const view of body.data.packages) {
      expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
      expect(Object.keys(view.labels).sort()).toEqual(['badge', 'description', 'name']);
    }
    const text = JSON.stringify(body);
    for (const word of ['retailVersion', 'creditValueVersion', 'active', 'cost', 'markup', 'rate']) {
      expect(text).not.toContain(`"${word}"`);
    }
  });

  it('Q-1: all three languages for every label; badges only where the catalogue has one', async () => {
    const body = await (await GET(get())).json();
    for (const view of body.data.packages) {
      for (const field of ['name', 'description'] as const) {
        expect(Object.keys(view.labels[field]).sort()).toEqual(['en', 'es', 'he']);
      }
    }
    const badges = body.data.packages.map((p: { labels: { badge: { en: string } | null } }) => p.labels.badge?.en ?? null);
    expect(badges).toEqual([null, 'Most popular', 'Best value']);
  });

  it('401 when signed out, and the catalogue is never read', async () => {
    state.user = null;
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(state.sourceCalls).toBe(0);
  });

  it('an invalid catalogue → 503 packages_unavailable; the issues are logged, never returned', async () => {
    state.source = { listActive: async () => Promise.reject(new BoostCatalogueInvalidError(['package "plus": secret issue'])) };
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'packages_unavailable' });
    expect(JSON.stringify(body)).not.toContain('secret issue');
    expect(logs.error).toHaveBeenCalledWith(
      expect.objectContaining({ issues: ['package "plus": secret issue'] }),
      expect.stringContaining('bos_boost_packages_unavailable')
    );
  });

  it('any other rejection (a plain Error) → 503 as well', async () => {
    state.source = { listActive: async () => Promise.reject(new Error('db down')) };
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: 'packages_unavailable' });
  });

  it('an empty list is never "nothing to sell": 503', async () => {
    state.source = { listActive: async () => [] };
    const res = await GET(get());
    expect(res.status).toBe(503);
  });

  it('a query string is ignored', async () => {
    const res = await GET(get('?purchaseAvailable=true&currency=EUR&packageId=max'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.purchaseAvailable).toBe(false);
    expect(body.data.packages).toHaveLength(3);
    for (const view of body.data.packages) expect(view.currency).toBe('USD');
  });
});

describe('R-4: every failure is 503, never a list', () => {
  it.each([
    ['an empty catalogue', async () => []],
    ['a thrown string', async () => Promise.reject('boom')],
    ['a thrown undefined', async () => Promise.reject(undefined)],
  ] as Array<[string, () => Promise<unknown[]>]>)('%s → 503 packages_unavailable', async (_name, listActive) => {
    state.source = { listActive };
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ success: false, error: 'packages_unavailable' });
  });

  it('getUser throwing → 503 with no details in production', async () => {
    jest.resetModules();
    jest.doMock('@/lib/auth', () => ({ getUser: async () => { throw new Error('session store down'); } }));
    const original = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { GET: isolatedGet } = await import('@/app/api/business-os/credits/boost/packages/route');
      const res = await isolatedGet(get());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ success: false, error: 'packages_unavailable' });
    } finally {
      Object.assign(process.env, { NODE_ENV: original });
      jest.dontMock('@/lib/auth');
    }
  });
});

describe('5b.1: purchaseAvailable is decided on the server (SA C-2)', () => {
  const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const open = (env: Record<string, string>) => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_server';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_browser';
    Object.assign(process.env, env);
  };
  const available = async () => (await (await GET(get())).json()).data.purchaseAvailable;

  it('switch off → false (even with matching keys)', async () => {
    open({});
    expect(await available()).toBe(false);
  });

  it('switch on, no allow-list, matching test keys → true', async () => {
    open({ BUSINESS_OS_CREDITS_BOOST_ENABLED: 'true' });
    expect(await available()).toBe(true);
  });

  it('switch on, allow-list without this account → false; with it → true', async () => {
    open({ BUSINESS_OS_CREDITS_BOOST_ENABLED: 'true', BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS: OTHER });
    expect(await available()).toBe(false);
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = `${OTHER},${ACCOUNT}`;
    expect(await available()).toBe(true);
  });

  it.each([
    ['no publishable key', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '' }],
    ['a live publishable key beside a test server key', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_browser' }],
    ['a test publishable key beside a live server key', { STRIPE_SECRET_KEY: 'sk_live_server' }],
    ['a publishable key that is not one', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_test_oops' }],
  ])('%s → false, and no log line contains a key', async (_name, env) => {
    open({ BUSINESS_OS_CREDITS_BOOST_ENABLED: 'true', ...env });
    expect(await available()).toBe(false);
    const logged = JSON.stringify(logs.error.mock.calls);
    for (const secret of ['pk_live_browser', 'sk_test_oops', 'sk_live_server', 'pk_test_browser']) expect(logged).not.toContain(secret);
  });

  it('matching live keys → true', async () => {
    open({ BUSINESS_OS_CREDITS_BOOST_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_live_server', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_browser' });
    expect(await available()).toBe(true);
  });

  it('a query string cannot switch it on', async () => {
    open({});
    const body = await (await GET(get('?purchaseAvailable=true'))).json();
    expect(body.data.purchaseAvailable).toBe(false);
  });
});

describe('QA R-1: the full key-mode availability matrix (SA C-2)', () => {
  const OTHER_ACCOUNT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const base: Record<string, string | undefined> = {
    BUSINESS_OS_CREDITS_BOOST_ENABLED: 'true',
    BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS: undefined,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    STRIPE_SECRET_KEY: 'sk_test_x',
  };
  it.each<[string, Record<string, string | undefined>, boolean]>([
    ['all good (test)', {}, true],
    ['all good (live)', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_x', STRIPE_SECRET_KEY: 'sk_live_x' }, true],
    ['switch unset', { BUSINESS_OS_CREDITS_BOOST_ENABLED: undefined }, false],
    ['switch "false"', { BUSINESS_OS_CREDITS_BOOST_ENABLED: 'false' }, false],
    ['allow-list without this account', { BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS: OTHER_ACCOUNT }, false],
    ['allow-list with this account (upper case)', { BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS: `${OTHER_ACCOUNT},${ACCOUNT.toUpperCase()}` }, true],
    ['malformed allow-list (closes)', { BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS: 'oops' }, false],
    ['publishable key missing', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined }, false],
    ['publishable key empty', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '' }, false],
    ['publishable key is a secret key', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'sk_test_x' }, false],
    ['pk_live beside a test secret', { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }, false],
    ['pk_test beside a live secret', { STRIPE_SECRET_KEY: 'sk_live_x' }, false],
    ['server secret key missing', { STRIPE_SECRET_KEY: undefined }, false],
    ['restricted test key (rk_test) beside pk_test', { STRIPE_SECRET_KEY: 'rk_test_x' }, true],
  ])('%s → purchaseAvailable %p, private no-store', async (_name, over, expected) => {
    for (const [key, value] of Object.entries({ ...base, ...over })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const res = await GET(get('?purchaseAvailable=true'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.purchaseAvailable).toBe(expected);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
