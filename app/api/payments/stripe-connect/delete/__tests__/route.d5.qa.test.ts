/**
 * QA (D5 / SX-5, 2026-10-30): DELETE /api/payments/stripe-connect/delete with
 * the REAL release module (`connectRelease`) and the REAL guard
 * (`connectExitGuard`) wired in, so the route's mapping is exercised end to end.
 * Only the edges are faked: the session, the repositories, the deletion-check
 * engine, the local counts and the Stripe SDK wrapper (`getStripeService`).
 *
 * Edge cases the Dev suite mocks away: two rows naming one account in both
 * tables, a plugin-only Standard account, STRIPE_CLIENT_ID missing, a Stripe
 * timeout / network error at each step, the "unknown"-only and failed checks,
 * the unavailable-check fallback, and Stripe's message never leaving the route.
 */

import { NextRequest } from 'next/server';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ ...mockLog, child: () => mockLog }),
}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockFindConnect = jest.fn();
const mockDeleteConnect = jest.fn();
const mockConnectOwner = jest.fn();
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  StripeConnectRepository: jest.fn().mockImplementation(() => ({
    findByUserId: (...args: unknown[]) => mockFindConnect(...args),
    delete: (...args: unknown[]) => mockDeleteConnect(...args),
  })),
  stripeConnectRepository: { findOwnerIdByStripeAccountId: (...args: unknown[]) => mockConnectOwner(...args) },
}));

const mockFindPlugin = jest.fn();
const mockDeletePlugin = jest.fn();
const mockPluginOthers = jest.fn();
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: {
    findByUserAndPlugin: (...args: unknown[]) => mockFindPlugin(...args),
    deleteByUserAndPlugin: (...args: unknown[]) => mockDeletePlugin(...args),
    countOtherUsersNamingStripeAccount: (...args: unknown[]) => mockPluginOthers(...args),
  },
}));

jest.mock('@/app/api/plugins/user-status/route', () => ({ pluginStatusCache: { invalidate: jest.fn() } }));

const mockRunCheck = jest.fn();
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runAccountDeletionCheck: (...args: unknown[]) => mockRunCheck(...args),
}));
const mockCountLocal = jest.fn();
jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({
  businessPurgeRepository: { countLocalBlockingState: (...args: unknown[]) => mockCountLocal(...args) },
}));

const mockRetrieve = jest.fn();
const mockDeauthorize = jest.fn();
const mockDel = jest.fn();
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    retrieveConnectedAccountKind: (...args: unknown[]) => mockRetrieve(...args),
    deauthorizeConnectedAccount: (...args: unknown[]) => mockDeauthorize(...args),
    deleteConnectedAccount: (...args: unknown[]) => mockDel(...args),
  }),
}));

const mockAuditLog = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...args: unknown[]) => mockAuditLog(...args), flush: () => mockFlush() }) },
}));

import { DELETE } from '../route';
import { LOCAL_BLOCKING_CONDITIONS } from '@/lib/business-os/purge/localPrecondition';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.org' };
const ACCOUNT = 'acct_1QaOwnAccount';
const SECRET_MESSAGE = 'No such account acct_1QaOwnAccount on platform ca_PLATFORMSECRET sk_live_shouldnotleak';
const NO_PLUGIN = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
const ORIGINAL_CLIENT_ID = process.env.STRIPE_CLIENT_ID;

function stripeError(type: string | undefined, code: string | undefined, statusCode: number | undefined) {
  return Object.assign(new Error(SECRET_MESSAGE), { type, code, statusCode, raw: { message: SECRET_MESSAGE } });
}

function localCounts(byCondition: Partial<Record<'C1' | 'C2' | 'C3', number | null>>) {
  return LOCAL_BLOCKING_CONDITIONS.map((condition) => ({
    ...condition,
    count: condition.condition in byCondition ? (byCondition[condition.condition] as number | null) : 0,
  }));
}

function call() {
  return DELETE(new NextRequest('http://localhost/api/payments/stripe-connect/delete', { method: 'DELETE' }));
}

function expectNoStripeCall() {
  expect(mockRetrieve).not.toHaveBeenCalled();
  expect(mockDeauthorize).not.toHaveBeenCalled();
  expect(mockDel).not.toHaveBeenCalled();
}

function expectNothingRemoved() {
  expect(mockDeleteConnect).not.toHaveBeenCalled();
  expect(mockDeletePlugin).not.toHaveBeenCalled();
}

/** Every argument any logger level or the audit received, serialised. */
function everythingWritten(): string {
  const calls = [
    ...mockLog.info.mock.calls,
    ...mockLog.warn.mock.calls,
    ...mockLog.error.mock.calls,
    ...mockLog.debug.mock.calls,
    ...mockAuditLog.mock.calls.map(([entry]) => [{ ...(entry as Record<string, unknown>), request: undefined }]),
  ];
  return JSON.stringify(calls, (_key, value) => (value instanceof Error ? { name: value.name, message: value.message } : value));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_CLIENT_ID = 'ca_QaPlatform';
  mockGetUser.mockResolvedValue(USER);
  mockFindConnect.mockResolvedValue({
    data: { id: 'row-1', user_id: USER.id, stripe_account_id: ACCOUNT, stripe_account_type: 'express' },
    error: null,
  });
  mockFindPlugin.mockResolvedValue(NO_PLUGIN);
  mockConnectOwner.mockResolvedValue({ data: { user_id: USER.id }, error: null });
  mockPluginOthers.mockResolvedValue({ data: 0, error: null });
  mockRunCheck.mockResolvedValue({ kind: 'checked', canDelete: true, targetUserId: USER.id, blockers: [], notes: [], guards: [], serverMs: 1 });
  mockCountLocal.mockResolvedValue(localCounts({}));
  mockRetrieve.mockResolvedValue('platform');
  mockDeauthorize.mockResolvedValue({ stripeUserId: ACCOUNT });
  mockDel.mockResolvedValue({ id: ACCOUNT, deleted: true });
  mockDeleteConnect.mockResolvedValue({ data: null, error: null });
  mockDeletePlugin.mockResolvedValue({ data: 1, error: null });
  mockAuditLog.mockResolvedValue(undefined);
  mockFlush.mockResolvedValue(undefined);
});

afterAll(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env.STRIPE_CLIENT_ID;
  else process.env.STRIPE_CLIENT_ID = ORIGINAL_CLIENT_ID;
});

describe('QA D5: both tables name the same account', () => {
  it('Express named by stripe_account_id in Connect and by `id` in the plugin row: one retrieve, one delete, both rows go', async () => {
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { id: ACCOUNT } }, error: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { how: 'deleted' } });
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
    expect(mockDel).toHaveBeenCalledTimes(1);
    expect(mockDel).toHaveBeenCalledWith(ACCOUNT);
    expect(mockDeauthorize).not.toHaveBeenCalled();
    expect(mockDeleteConnect).toHaveBeenCalledWith('row-1', USER.id);
    expect(mockDeletePlugin).toHaveBeenCalledWith(USER.id, 'stripe');
    // Our own Connect row does not make the account "shared"; the plugin count excludes us.
    expect(mockPluginOthers).toHaveBeenCalledWith(ACCOUNT, USER.id);
    // Both deletes happen only after Stripe's positive answer.
    expect(mockDel.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteConnect.mock.invocationCallOrder[0]);
    expect(mockDel.mock.invocationCallOrder[0]).toBeLessThan(mockDeletePlugin.mock.invocationCallOrder[0]);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('the plugin row names the account under BOTH keys, but stripe_account_id wins and is malformed → not_available, no Stripe call', async () => {
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { stripe_account_id: 'not-an-acct', id: ACCOUNT } }, error: null });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expectNoStripeCall();
    expectNothingRemoved();
  });

  it('another business names the same account in its plugin row → not_available, no Stripe call, nothing removed', async () => {
    mockPluginOthers.mockResolvedValue({ data: 1, error: null });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expectNoStripeCall();
    expectNothingRemoved();
    expect(mockRunCheck).not.toHaveBeenCalled();
  });

  it('another business owns the Connect row naming the account the plugin row names → not_available', async () => {
    mockFindConnect.mockResolvedValue({ data: null, error: null });
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { stripe_account_id: ACCOUNT } }, error: null });
    mockConnectOwner.mockResolvedValue({ data: { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, error: null });
    const res = await call();
    expect(res.status).toBe(409);
    expectNoStripeCall();
    expectNothingRemoved();
    // Nothing about the other business reaches the response or the audit.
    expect(JSON.stringify(await res.json())).not.toContain('bbbbbbbb');
    expect(everythingWritten()).not.toContain('bbbbbbbb');
  });
});

describe('QA D5: plugin-only Standard account', () => {
  beforeEach(() => {
    mockFindConnect.mockResolvedValue({ data: null, error: null });
    mockConnectOwner.mockResolvedValue({ data: null, error: null });
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { stripe_account_id: ACCOUNT } }, error: null });
    mockRetrieve.mockResolvedValue('standard');
  });

  it('deauthorize with OUR account and the server client id; only the plugin row goes; never `del`', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { how: 'deauthorized' } });
    expect(mockDeauthorize).toHaveBeenCalledWith({ clientId: 'ca_QaPlatform', accountId: ACCOUNT });
    expect(mockDel).not.toHaveBeenCalled();
    expect(mockDeleteConnect).not.toHaveBeenCalled();
    expect(mockDeletePlugin).toHaveBeenCalledWith(USER.id, 'stripe');
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: ACCOUNT, details: expect.objectContaining({ account_type: 'plugin', account_kind: 'standard', how: 'deauthorized' }) })
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('STRIPE_CLIENT_ID %s → 409 not_available, no deauthorize, an alerting error log, nothing removed', async (_label, value) => {
    if (value === undefined) delete process.env.STRIPE_CLIENT_ID;
    else process.env.STRIPE_CLIENT_ID = value;
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expect(mockDeauthorize).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
    expectNothingRemoved();
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.stringContaining('STRIPE_CLIENT_ID'));
  });

  it('a deauthorize that echoes another account id is not a confirmation', async () => {
    mockDeauthorize.mockResolvedValue({ stripeUserId: 'acct_1SomeoneElse' });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expectNothingRemoved();
  });

  it('Stripe refusing the deauthorize (invalid_client) is not_available, never stripe_refused (W-11)', async () => {
    mockDeauthorize.mockRejectedValue(stripeError('StripeInvalidGrantError', 'invalid_client', 400));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expectNothingRemoved();
  });
});

describe('QA D5: Stripe timeout and network errors refuse at every step', () => {
  const steps: Array<[string, () => void]> = [
    ['retrieve', () => mockRetrieve.mockRejectedValueOnce(stripeError('StripeConnectionError', undefined, undefined))],
    [
      'deauthorize',
      () => {
        mockRetrieve.mockResolvedValueOnce('standard');
        mockDeauthorize.mockRejectedValueOnce(stripeError('StripeConnectionError', undefined, undefined));
      },
    ],
    ['delete', () => mockDel.mockRejectedValueOnce(stripeError('StripeConnectionError', undefined, undefined))],
    ['delete (Stripe 503)', () => mockDel.mockRejectedValueOnce(stripeError('StripeAPIError', undefined, 503))],
    ['delete (rate limited)', () => mockDel.mockRejectedValueOnce(stripeError('StripeRateLimitError', 'rate_limit', 429))],
  ];

  it.each(steps)('%s: 502 stripe_unreachable, nothing removed, no success audit', async (_step, arrange) => {
    arrange();
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('stripe_unreachable');
    expectNothingRemoved();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('a raw network error with no Stripe type (fetch failed / socket timeout) is a refusal, never a release', async () => {
    mockDel.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed: ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expectNothingRemoved();
  });

  it('a retrieve "resource_missing" (no shape recorded) refuses instead of clearing G-8', async () => {
    mockRetrieve.mockRejectedValueOnce(stripeError('StripeInvalidRequestError', 'resource_missing', 404));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expect(mockDel).not.toHaveBeenCalled();
    expectNothingRemoved();
  });

  it('a delete answer without deleted:true is a refusal', async () => {
    mockDel.mockResolvedValueOnce({ id: ACCOUNT, deleted: false });
    expect((await call()).status).toBe(409);
    expectNothingRemoved();
  });
});

describe("QA D5: Stripe's message never leaves the route", () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV;
  });

  it.each(['production', 'development'])('%s: the body, the logs and the audit carry no Stripe message', async (env) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = env;
    mockDel.mockRejectedValueOnce(stripeError('StripeInvalidRequestError', 'balance_insufficient', 400));
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('stripe_refused');
    const text = JSON.stringify(body);
    expect(text).not.toContain('ca_PLATFORMSECRET');
    expect(text).not.toContain('sk_live');
    expect(text).not.toContain('No such account');
    if (env === 'development') expect(body.details).toEqual({ type: 'StripeInvalidRequestError', code: 'balance_insufficient' });
    else expect(body.details).toBeUndefined();
    const written = everythingWritten();
    expect(written).not.toContain('ca_PLATFORMSECRET');
    expect(written).not.toContain('sk_live');
    expect(written).not.toContain('No such account');
    // The client id never appears in any log either.
    expect(written).not.toContain('ca_QaPlatform');
  });
});

describe('QA D5: the money check with the real guard', () => {
  it('a check that returns only `unknown` → 503 check_failed, no Stripe call', async () => {
    mockRunCheck.mockResolvedValue({ kind: 'checked', canDelete: false, targetUserId: USER.id, blockers: [{ guard: 'unknown' }], notes: [], guards: [], serverMs: 1 });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('check_failed');
    expectNoStripeCall();
    expectNothingRemoved();
  });

  it('a FAILED check → 503 and never the local fallback', async () => {
    mockRunCheck.mockResolvedValue({ kind: 'failed', reason: 'rpc_error' });
    const res = await call();
    expect(res.status).toBe(503);
    expect(mockCountLocal).not.toHaveBeenCalled();
    expectNoStripeCall();
  });

  it('G-9 rows → 409 client_money_in_flight with counts, no Stripe call', async () => {
    mockRunCheck.mockResolvedValue({
      kind: 'checked',
      canDelete: false,
      targetUserId: USER.id,
      blockers: [
        { guard: 'G-8', item: 'stripe connect', found: 1 },
        { guard: 'G-9', item: 'payment plan subscriptions running', found: 2 },
        { guard: 'G-9', item: 'payments still pending', found: 1 },
      ],
      notes: [],
      guards: [],
      serverMs: 1,
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'client_money_in_flight',
      blockers: [
        { code: 'client_plans_running', count: 2 },
        { code: 'client_payments_pending', count: 1 },
      ],
    });
    expectNoStripeCall();
  });

  it('an UNAVAILABLE check uses the local counts: running plans block', async () => {
    mockRunCheck.mockResolvedValue({ kind: 'unavailable', reason: 'not_configured' });
    mockCountLocal.mockResolvedValue(localCounts({ C1: 1 }));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('client_money_in_flight');
    expect(mockCountLocal).toHaveBeenCalledWith(USER.id);
    expectNoStripeCall();
  });

  it('an UNAVAILABLE check with only sent invoices (C3) lets Stripe decide', async () => {
    mockRunCheck.mockResolvedValue({ kind: 'unavailable', reason: 'not_configured' });
    mockCountLocal.mockResolvedValue(localCounts({ C3: 4 }));
    expect((await call()).status).toBe(200);
    expect(mockDel).toHaveBeenCalledWith(ACCOUNT);
  });

  it('a login with no email never calls the engine and uses the local counts', async () => {
    mockGetUser.mockResolvedValue({ id: USER.id, email: undefined });
    mockCountLocal.mockResolvedValue(localCounts({ C2: null }));
    const res = await call();
    expect(res.status).toBe(503);
    expect(mockRunCheck).not.toHaveBeenCalled();
    expectNoStripeCall();
  });
});
