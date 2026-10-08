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
    ['no sessionId (the list is 5b.2)', ''],
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
    ['empty query', ''],
    ['an empty sessionId', '?sessionId='],
    ['a payment intent id', '?sessionId=pi_1'],
    ['a hyphen in the id', '?sessionId=cs_test_a-b'],
    ['a 191-character tail (too long)', `?sessionId=cs_test_${'a'.repeat(191)}`],
    ['an unknown mode prefix', '?sessionId=cs_other_abc'],
    ['an extra userId key', '?sessionId=cs_test_abc&userId=x'],
    ['an extra limit key (the list is 5b.2)', '?sessionId=cs_test_abc&limit=5'],
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
