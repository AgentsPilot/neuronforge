/**
 * `POST /api/business-os/credits/boost/checkout` (credits boost slice 3,
 * workplan §6.1; SA C-1 to C-7).
 *
 * The real route and orchestrator run. Faked: the session (`getUser`), the
 * dependency wiring (hold readers, catalogue, repository, Stripe) and the audit
 * service. Pinned:
 *   - the happy path, with the audit entry and its flush before the answer;
 *   - flag off → 404 before the session is read; a test-account list;
 *   - 401 without a session; 400 for invalid input or extra fields, with
 *     nothing reserved (FR-8: the client sends only `packageId`);
 *   - the account is the session's, never the body's;
 *   - refusals mapped to statuses; Stripe failure → the reservation abandoned;
 *   - production answers never carry error details.
 */

import { NextRequest } from 'next/server';

import type { BoostCheckoutDeps } from '@/lib/business-os/boost/boostCheckout';

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const EXPIRES_AT = Math.floor(Date.now() / 1000) + 1860;

const state = {
  user: { id: ACCOUNT, email: 'owner@example.com' } as { id: string; email: string | null } | null,
  getUserCalls: 0,
  reserveCalls: [] as unknown[],
  createCalls: [] as unknown[],
  abandonCalls: [] as unknown[],
  reserveResult: null as unknown,
  createThrows: false,
  holdHeld: false,
  pkgNull: false,
  auditLogs: [] as unknown[],
  auditFlushes: 0,
  order: [] as string[],
};

jest.mock('@/lib/auth', () => ({
  getUser: async () => {
    state.getUserCalls += 1;
    return state.user;
  },
}));

jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  // SA CR-3: the route writes its audit entry out through the bounded helper.
  logAndFlush: async (entry: unknown) => {
    state.auditLogs.push(entry);
    state.auditFlushes += 1;
    state.order.push('logAndFlush');
  },
}));

jest.mock('@/lib/business-os/boost/boostCheckoutDeps', () => ({
  boostCheckoutDeps: (): BoostCheckoutDeps => ({
    holdReaders: {
      lineage: {
        findHoldFactsForAccount: async () =>
          ({ data: state.holdHeld ? { source: 'account_invite', first_paid_at: null, invite_id: null } : null, error: null }) as never,
      },
      invites: { findHoldFactsById: async () => ({ data: null, error: null }) as never },
    },
    packageSource: {
      listActive: async () => [],
      getActive: async (id: string) =>
        state.pkgNull
          ? null
          : ({
              id,
              version: 1,
              priceMinor: 2500,
              currency: 'USD',
              taxExclusive: true,
              baseCredits: 12500,
              bonusCredits: 1250,
              totalCredits: 13750,
              bonusPercent: 10,
              active: true,
              order: 2,
              labels: { name: { en: 'Plus', he: 'Plus', es: 'Plus' }, description: { en: 'd', he: 'd', es: 'd' }, badge: null },
              retailVersion: 1,
              creditValueVersion: 1,
            } as never),
    },
    cap: { amountMinor: 15000, currency: 'USD', windowDays: 30 },
    repo: {
      reserve: async (input: unknown) => {
        state.reserveCalls.push(input);
        return (state.reserveResult ?? { data: { outcome: 'reserved', purchaseId: PURCHASE, capMinor: 15000, countedMinor: 0 }, error: null }) as never;
      },
      attachCheckout: async () => ({ data: { status: 'attached' }, error: null }) as never,
      abandon: async (input: unknown) => {
        state.abandonCalls.push(input);
        return { data: { status: 'abandoned' }, error: null } as never;
      },
    } as never,
    stripe: () =>
      ({
        checkout: {
          sessions: {
            create: async (params: unknown) => {
              state.createCalls.push(params);
              if (state.createThrows) throw Object.assign(new Error('bad request'), { type: 'StripeInvalidRequestError' });
              return {
                id: 'cs_test_one',
                livemode: false,
                amount_subtotal: 2500,
                currency: 'usd',
                client_reference_id: PURCHASE,
                client_secret: 'cs_test_one_secret_abc',
                expires_at: EXPIRES_AT,
              };
            },
            expire: async () => ({}),
          },
        },
      }) as never,
    mode: () => 'test',
    now: () => new Date(),
  }),
}));

import { POST } from '@/app/api/business-os/credits/boost/checkout/route';

const ENV = { ...process.env };

function post(body: unknown) {
  return new NextRequest('http://localhost/api/business-os/credits/boost/checkout', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env = { ...ENV, BUSINESS_OS_CREDITS_BOOST_ENABLED: 'true', NEXT_PUBLIC_APP_URL: 'https://app.example.com' };
  delete process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS;
  // The return URL comes from the address resolver; keep Vercel's own variables out of it.
  for (const key of ['VERCEL', 'VERCEL_ENV', 'NEXT_PUBLIC_VERCEL_ENV', 'VERCEL_URL', 'NEXT_PUBLIC_VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL']) {
    delete process.env[key];
  }
  Object.assign(state, {
    user: { id: ACCOUNT, email: 'owner@example.com' },
    getUserCalls: 0,
    reserveCalls: [],
    createCalls: [],
    abandonCalls: [],
    reserveResult: null,
    createThrows: false,
    holdHeld: false,
    pkgNull: false,
    auditLogs: [],
    auditFlushes: 0,
    order: [],
  });
});

afterAll(() => {
  process.env = { ...ENV };
});

describe('happy path', () => {
  it('answers the client secret, never cached, and writes the audit entry out through logAndFlush first (C-4, CR-3)', async () => {
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      success: true,
      data: { clientSecret: 'cs_test_one_secret_abc', purchaseId: PURCHASE, expiresAt: new Date(EXPIRES_AT * 1000).toISOString() },
    });
    expect(state.reserveCalls).toHaveLength(1);
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      action: 'BOS_BOOST_CHECKOUT_STARTED',
      entityType: 'business_os_boost_purchase',
      entityId: PURCHASE,
      userId: ACCOUNT,
      details: { package_id: 'plus', package_version: 1, price_minor: 2500, currency: 'USD', livemode: false },
    });
    expect(JSON.stringify(state.auditLogs)).not.toContain('secret');
    expect(state.auditFlushes).toBe(1);
    expect(state.order).toEqual(['logAndFlush']);
  });

  it('the account is the session\'s: reserve gets user.id and the return URL comes from NEXT_PUBLIC_APP_URL', async () => {
    await POST(post({ packageId: 'plus' }));
    expect(state.reserveCalls[0]).toMatchObject({ accountId: ACCOUNT });
    expect(state.createCalls[0]).toMatchObject({
      return_url: 'https://app.example.com/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}',
      customer_email: 'owner@example.com',
    });
  });

  it('C-5: a user with no email gets a session without customer_email', async () => {
    state.user = { id: ACCOUNT, email: null };
    expect((await POST(post({ packageId: 'plus' }))).status).toBe(200);
    expect(state.createCalls[0]).not.toHaveProperty('customer_email');
  });
});

describe('the flag and the list (C-1, C-7)', () => {
  it('flag off → 404 before the session is read', async () => {
    delete process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED;
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(404);
    expect(state.getUserCalls).toBe(0);
    expect(state.reserveCalls).toHaveLength(0);
  });

  it('a test-account list without the caller → 404, with the caller → 200', async () => {
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = OTHER;
    expect((await POST(post({ packageId: 'plus' }))).status).toBe(404);
    expect(state.reserveCalls).toHaveLength(0);
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = `${OTHER},${ACCOUNT}`;
    expect((await POST(post({ packageId: 'plus' }))).status).toBe(200);
  });
});

describe('auth and input', () => {
  it('no session → 401, nothing reserved', async () => {
    state.user = null;
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(401);
    expect(state.reserveCalls).toHaveLength(0);
  });

  it.each([
    ['no packageId', {}],
    ['a bad slug', { packageId: 'Plus Pack' }],
    ['a price in the body', { packageId: 'plus', price: 1 }],
    ['credits in the body', { packageId: 'plus', credits: 999999 }],
    ['an account in the body', { packageId: 'plus', accountId: OTHER }],
    ['a user id in the body', { packageId: 'plus', userId: OTHER }],
    ['not JSON', '{nope'],
  ])('%s → 400, nothing reserved, no details in production', async (_name, body) => {
    process.env = { ...process.env, NODE_ENV: 'production' };
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: 'Invalid input' });
    expect(state.reserveCalls).toHaveLength(0);
  });

  it('C-6: production where the resolver gives a loopback address → payments_unavailable, nothing reserved', async () => {
    process.env = { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' };
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'payments_unavailable' });
    expect(state.reserveCalls).toHaveLength(0);
  });
});

describe('refusals', () => {
  it('held account → 409 awaiting_payment, nothing reserved (R-1)', async () => {
    state.holdHeld = true;
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'awaiting_payment' });
    expect(state.reserveCalls).toHaveLength(0);
  });

  it('unknown package → 404 unknown_package', async () => {
    state.pkgNull = true;
    const res = await POST(post({ packageId: 'nope' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'unknown_package' });
  });

  it('cap reached → 409 cap_reached, no Stripe call, no audit', async () => {
    state.reserveResult = { data: { outcome: 'cap_reached', capMinor: 15000, countedMinor: 14500 }, error: null };
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(409);
    // 5b SA C-5: the cap and its window (server figures), never the counted amount.
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'cap_reached', capMinor: 15000, windowDays: expect.any(Number) });
    expect(body.windowDays).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('14500');
    expect(state.createCalls).toHaveLength(0);
    expect(state.auditLogs).toHaveLength(0);
  });

  it('no plan row → 403 not_eligible', async () => {
    state.reserveResult = { data: { outcome: 'no_plan_row' }, error: null };
    expect((await POST(post({ packageId: 'plus' }))).status).toBe(403);
  });

  it('a definite Stripe rejection → 502 checkout_unavailable and the reservation abandoned, no audit', async () => {
    state.createThrows = true;
    const res = await POST(post({ packageId: 'plus' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: 'checkout_unavailable' });
    expect(state.abandonCalls).toEqual([{ accountId: ACCOUNT, purchaseId: PURCHASE }]);
    expect(state.auditLogs).toHaveLength(0);
  });
});

describe('QA follow-ups (R-6, R-7)', () => {
  it('R-6: production with a plain-http address → payments_unavailable; a hostile Host is never used', async () => {
    process.env = { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://app.example.com' };
    const hostile = new NextRequest('https://evil.example.com/api/business-os/credits/boost/checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId: 'plus' }),
      headers: { 'content-type': 'application/json', host: 'evil.example.com' },
    });
    const res = await POST(hostile);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'payments_unavailable' });
    expect(state.reserveCalls).toHaveLength(0);
    expect(JSON.stringify(state.createCalls)).not.toContain('evil.example.com');
  });

  it('R-6: a hostile Host on a valid production request → the return URL is the resolver\'s, never the Host', async () => {
    process.env = { ...process.env, NODE_ENV: 'production' };
    const hostile = new NextRequest('https://evil.example.com/api/business-os/credits/boost/checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId: 'plus' }),
      headers: { 'content-type': 'application/json', host: 'evil.example.com' },
    });
    const res = await POST(hostile);
    expect(res.status).toBe(200);
    expect(JSON.stringify(state.createCalls)).not.toContain('evil.example.com');
    expect(JSON.stringify(state.createCalls)).toContain('https://app.example.com/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}');
  });

  it.each([
    ['33 characters', 'a'.repeat(33)],
    ['100,000 characters', 'a'.repeat(100000)],
    ['a non-ASCII letter', 'plüs'],
  ])('R-7: a packageId of %s → 400, nothing reserved', async (_name, packageId) => {
    const res = await POST(post({ packageId }));
    expect(res.status).toBe(400);
    expect(state.reserveCalls).toHaveLength(0);
  });
});
