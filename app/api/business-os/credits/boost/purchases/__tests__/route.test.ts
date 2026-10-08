/**
 * `GET /api/business-os/credits/boost/purchases?sessionId=` (credits boost
 * slice 5b.1; SA C-1, C-3). The real route, view and catalogue run; the
 * session, the logger and the repository's one read are faked.
 */

import { NextRequest } from 'next/server';

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SESSION = 'cs_test_abc123';

const state = {
  user: { id: ACCOUNT } as { id: string } | null,
  rows: new Map<string, Record<string, unknown>>(),
  readError: null as Error | null,
  calls: [] as Array<[string, string]>,
  listCalls: [] as Array<[string, { livemode: boolean; limit?: number }]>,
};
const logs = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/logger', () => ({ createLogger: () => ({ ...logs, child: () => logs }) }));
jest.mock('@/lib/repositories/BusinessOsBoostPurchaseRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/BusinessOsBoostPurchaseRepository');
  return {
    ...actual,
    businessOsBoostPurchaseRepository: {
      // Emulates the scoped read: the row is found only for its own account.
      // 5b.2: emulates the scoped list: this account's rows in this mode, newest first, limited.
      listForAccount: async (accountId: string, options: { livemode: boolean; limit?: number }) => {
        state.listCalls.push([accountId, options]);
        if (state.readError) return { data: null, error: state.readError };
        const rows = [...state.rows.values()]
          .filter((row) => row.accountId === accountId && row.livemode === options.livemode)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, options.limit ?? 50);
        return { data: rows, error: null };
      },
      findForAccountBySessionId: async (accountId: string, sessionId: string) => {
        state.calls.push([accountId, sessionId]);
        if (state.readError) return { data: null, error: state.readError };
        const row = state.rows.get(sessionId);
        return { data: row && row.accountId === accountId ? row : null, error: null };
      },
    },
  };
});

import { GET } from '@/app/api/business-os/credits/boost/purchases/route';
import { purchaseRow } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

const get = (query: string) => new NextRequest(`http://localhost/api/business-os/credits/boost/purchases${query}`, { method: 'GET' });

beforeEach(() => {
  state.user = { id: ACCOUNT };
  state.rows = new Map([
    [SESSION, purchaseRow({ accountId: ACCOUNT, stripeCheckoutSessionId: SESSION, status: 'pending', stripePaymentIntentId: 'pi_test_1' }) as never],
    ['cs_test_other', purchaseRow({ accountId: OTHER, stripeCheckoutSessionId: 'cs_test_other', status: 'paid' }) as never],
  ]);
  state.readError = null;
  state.calls = [];
  state.listCalls = [];
  process.env.STRIPE_SECRET_KEY = 'sk_test_list';
  jest.clearAllMocks();
});

describe('GET …/boost/purchases?sessionId= (5b.1)', () => {
  it('the owner\'s own session → the view (exact keys), status processing, private no-store', async () => {
    const res = await GET(get(`?sessionId=${SESSION}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['success', 'data']);
    expect(Object.keys(body.data)).toEqual(['purchase']);
    expect(Object.keys(body.data.purchase).sort()).toEqual(
      ['createdAt', 'creditsBonus', 'creditsTotal', 'currency', 'id', 'kind', 'name', 'packageId', 'paidAt', 'priceMinor', 'receiptUrl', 'status', 'taxExclusive']
    );
    expect(body.data.purchase).toMatchObject({ status: 'processing', packageId: 'plus', kind: 'bought', name: { en: 'Plus' } });
    const text = JSON.stringify(body);
    for (const secret of [SESSION, 'pi_test_1', 'livemode', 'flagReason']) expect(text).not.toContain(secret);
    // The account is the session's.
    expect(state.calls).toEqual([[ACCOUNT, SESSION]]);
  });

  it('SA C-3: another owner\'s session answers exactly like a missing one: { purchase: null }', async () => {
    const res = await GET(get('?sessionId=cs_test_other'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { purchase: null } });
    const missing = await GET(get('?sessionId=cs_test_nothing'));
    expect(await missing.json()).toEqual({ success: true, data: { purchase: null } });
  });

  it('a user id in the query is not accepted (400) and never used', async () => {
    const res = await GET(get(`?sessionId=cs_test_other&userId=${OTHER}`));
    expect(res.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('401 when signed out; nothing is read', async () => {
    state.user = null;
    expect((await GET(get(`?sessionId=${SESSION}`))).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it.each([
    ['a payment intent id', '?sessionId=pi_test_1'],
    ['a session id with punctuation', '?sessionId=cs_test_a%3Bdrop'],
    ['an unknown key', `?sessionId=${SESSION}&extra=1`],
  ])('%s → 400, nothing read', async (_name, query) => {
    const res = await GET(get(query));
    expect(res.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('a failed read → 500 with no details in production', async () => {
    const original = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      state.readError = new Error('connection reset');
      const res = await GET(get(`?sessionId=${SESSION}`));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Could not load the purchase' });
    } finally {
      Object.assign(process.env, { NODE_ENV: original });
    }
  });

  it.each([
    ['paid', 'credited'],
    ['awaiting_payment', 'awaiting_payment'],
    ['failed', 'failed'],
    ['expired', 'expired'],
    ['flagged_mismatch', 'under_review'],
  ] as const)('row %s → owner status %s', async (status, owner) => {
    state.rows.set(SESSION, purchaseRow({ accountId: ACCOUNT, stripeCheckoutSessionId: SESSION, status }) as never);
    const body = await (await GET(get(`?sessionId=${SESSION}`))).json();
    expect(body.data.purchase.status).toBe(owner);
  });
});

describe('QA R-4: the status read refuses anything but one well-formed sessionId, before any read', () => {
  it.each([
    ['an empty sessionId', '?sessionId='],
    ['a payment intent id', '?sessionId=pi_1'],
    ['a hyphen in the id', '?sessionId=cs_test_a-b'],
    ['a 191-character tail (too long)', `?sessionId=cs_test_${'a'.repeat(191)}`],
    ['an unknown mode prefix', '?sessionId=cs_other_abc'],
    ['an extra userId key', '?sessionId=cs_test_abc&userId=x'],
    ['a limit beside a sessionId (limit is for the list only)', '?sessionId=cs_test_abc&limit=5'],
    ['an injection attempt', "?sessionId=cs_test_abc'--"],
  ])('%s → 400 with no repository call', async (_name, query) => {
    const res = await GET(get(query));
    expect(res.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('a 190-character tail is the longest accepted', async () => {
    const res = await GET(get(`?sessionId=cs_test_${'a'.repeat(190)}`));
    expect(res.status).toBe(200);
    expect(state.calls).toHaveLength(1);
  });
});

describe('5b.2: the Purchases list (GET without sessionId)', () => {
  const LIST_KEYS = ['createdAt', 'creditsBonus', 'creditsTotal', 'currency', 'id', 'kind', 'name', 'packageId', 'paidAt', 'priceMinor', 'receiptUrl', 'status', 'taxExclusive'];
  const row = (id: string, patch: Record<string, unknown>) => purchaseRow({ id, accountId: ACCOUNT, ...patch } as never) as never;

  beforeEach(() => {
    state.rows = new Map([
      ['cs_test_a', row('11111111-0000-4000-8000-000000000001', { createdAt: '2026-10-01T10:00:00.000Z', status: 'paid', stripeCheckoutSessionId: 'cs_test_a', stripePaymentIntentId: 'pi_test_a', receiptUrl: 'https://pay.stripe.com/r/a' })],
      ['cs_test_b', row('11111111-0000-4000-8000-000000000002', { createdAt: '2026-10-05T10:00:00.000Z', status: 'pending', stripeCheckoutSessionId: 'cs_test_b' })],
      ['live', row('11111111-0000-4000-8000-000000000003', { createdAt: '2026-10-06T10:00:00.000Z', status: 'paid', livemode: true })],
      ['other', purchaseRow({ id: '22222222-0000-4000-8000-000000000009', accountId: OTHER, createdAt: '2026-10-07T10:00:00.000Z', status: 'paid' } as never) as never],
    ]);
  });

  it('the signed-in owner\'s purchases, current (test) mode only, newest first, exact keys, private no-store', async () => {
    const res = await GET(get(''));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(Object.keys(body.data)).toEqual(['purchases']);
    expect(body.data.purchases.map((p: { id: string }) => p.id)).toEqual(['11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001']);
    for (const view of body.data.purchases) expect(Object.keys(view).sort()).toEqual(LIST_KEYS);
    expect(body.data.purchases.map((p: { status: string }) => p.status)).toEqual(['processing', 'credited']);
    expect(body.data.purchases[1]).toMatchObject({ receiptUrl: 'https://pay.stripe.com/r/a', kind: 'bought', name: { en: 'Plus' } });
    const text = JSON.stringify(body);
    for (const secret of ['cs_test_a', 'cs_test_b', 'pi_test_a', 'livemode', '22222222']) expect(text).not.toContain(secret);
    // The account is the session's; the mode is the server key's; the default limit.
    expect(state.listCalls).toEqual([[ACCOUNT, { livemode: false, limit: 50 }]]);
  });

  it('a live server key lists live rows only (R-10)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_list';
    const body = await (await GET(get(''))).json();
    expect(body.data.purchases.map((p: { id: string }) => p.id)).toEqual(['11111111-0000-4000-8000-000000000003']);
  });

  it('another owner\'s purchases never appear; an owner with none gets an empty list', async () => {
    state.user = { id: OTHER };
    const theirs = await (await GET(get(''))).json();
    expect(theirs.data.purchases.map((p: { id: string }) => p.id)).toEqual(['22222222-0000-4000-8000-000000000009']);
    state.user = { id: '33333333-3333-4333-8333-333333333333' };
    expect(await (await GET(get(''))).json()).toEqual({ success: true, data: { purchases: [] } });
  });

  it('?limit narrows the list; out-of-range or junk limits → 400 with no read', async () => {
    const body = await (await GET(get('?limit=1'))).json();
    expect(body.data.purchases).toHaveLength(1);
    for (const query of ['?limit=0', '?limit=51', '?limit=abc', '?limit=2.5', '?userId=x']) {
      state.listCalls = [];
      expect((await GET(get(query))).status).toBe(400);
      expect(state.listCalls).toEqual([]);
    }
  });

  it('401 signed out, no read', async () => {
    state.user = null;
    expect((await GET(get(''))).status).toBe(401);
    expect(state.listCalls).toEqual([]);
  });

  it('a failed read or an unknown Stripe mode → 500, no details in production', async () => {
    const original = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      state.readError = new Error('connection reset');
      expect(await (await GET(get(''))).json()).toEqual({ success: false, error: 'Could not load the purchases' });
      state.readError = null;
      delete process.env.STRIPE_SECRET_KEY;
      const res = await GET(get(''));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Could not load the purchases' });
    } finally {
      Object.assign(process.env, { NODE_ENV: original });
    }
  });

  it('the sessionId branch is unchanged (5b.1)', async () => {
    const body = await (await GET(get('?sessionId=cs_test_b'))).json();
    expect(body.data.purchase).toMatchObject({ status: 'processing' });
  });
});

describe('QA 5b.2 R-1: the list follows the server key\'s mode, and refuses when it cannot tell', () => {
  it.each([
    ['missing', undefined],
    ['garbage', 'garbage'],
    ['empty', ''],
  ])('server key %s → 500, no read, no details', async (_name, key) => {
    if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = key;
    const res = await GET(get(''));
    expect(res.status).toBe(500);
    expect(state.listCalls).toEqual([]);
    expect((await res.json()).details).toBeUndefined();
  });

  it.each([
    ['sk_test_', 'sk_test_x', false],
    ['sk_live_', 'sk_live_x', true],
    ['rk_test_', 'rk_test_x', false],
  ])('a %s key reads livemode %p (account from the session, default limit)', async (_name, key, live) => {
    process.env.STRIPE_SECRET_KEY = key;
    await GET(get(''));
    expect(state.listCalls).toEqual([[ACCOUNT, { livemode: live, limit: 50 }]]);
  });
});
