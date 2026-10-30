/**
 * DELETE /api/payments/stripe-connect/delete (self-service exit SX-5 / D5;
 * C-5, SA-14, BQ-19; SA W-5, W-8, W-9, W-10, W-12, W-13, W-18).
 *
 * The real route over mocked edges: the session, the two repositories, the
 * money / shared checks and the Stripe release. Every refusal asserts that no
 * row was deleted, and the earlier refusals that Stripe was never called.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = jest.fn();
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockFindConnect = jest.fn();
const mockDeleteConnect = jest.fn();
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  StripeConnectRepository: jest.fn().mockImplementation(() => ({
    findByUserId: (...args: unknown[]) => mockFindConnect(...args),
    delete: (...args: unknown[]) => mockDeleteConnect(...args),
  })),
}));

const mockFindPlugin = jest.fn();
const mockDeletePlugin = jest.fn();
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: {
    findByUserAndPlugin: (...args: unknown[]) => mockFindPlugin(...args),
    deleteByUserAndPlugin: (...args: unknown[]) => mockDeletePlugin(...args),
  },
}));

const mockInvalidate = jest.fn();
jest.mock('@/app/api/plugins/user-status/route', () => ({ pluginStatusCache: { invalidate: (...args: unknown[]) => mockInvalidate(...args) } }));

const mockCheck = jest.fn();
const mockShared = jest.fn();
jest.mock('@/lib/business-os/account-deletion/connectExitGuard', () => ({
  checkConnectExit: (...args: unknown[]) => mockCheck(...args),
  isStripeAccountShared: (...args: unknown[]) => mockShared(...args),
}));

const mockRelease = jest.fn();
jest.mock('@/lib/business-os/account-deletion/connectRelease', () => ({
  releaseConnectedAccount: (...args: unknown[]) => mockRelease(...args),
}));

const mockAuditLog = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...args: unknown[]) => mockAuditLog(...args), flush: () => mockFlush() }) },
}));

import { DELETE } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { refusalLines } from '@/components/payments/stripeConnectExitCopy';
import { en } from '@/lib/business-os/translations/en';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.org' };
const ACCOUNT = 'acct_1OwnAccount';
const CONNECT_ROW = { id: 'row-1', user_id: USER.id, stripe_account_id: ACCOUNT, stripe_account_type: 'express' };
const NO_PLUGIN = { data: null, error: { code: 'PGRST116', message: 'no rows' } };

function call(body?: string) {
  return DELETE(new NextRequest('http://localhost/api/payments/stripe-connect/delete', { method: 'DELETE', body }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockFindConnect.mockResolvedValue({ data: CONNECT_ROW, error: null });
  mockFindPlugin.mockResolvedValue(NO_PLUGIN);
  mockShared.mockResolvedValue('not_shared');
  mockCheck.mockResolvedValue({ kind: 'clear', source: 'check' });
  mockRelease.mockResolvedValue({ kind: 'released', how: 'deleted', accountKind: 'platform' });
  mockDeleteConnect.mockResolvedValue({ data: null, error: null });
  mockDeletePlugin.mockResolvedValue({ data: 1, error: null });
  mockAuditLog.mockResolvedValue(undefined);
  mockFlush.mockResolvedValue(undefined);
});

function expectNothingRemoved() {
  expect(mockDeleteConnect).not.toHaveBeenCalled();
  expect(mockDeletePlugin).not.toHaveBeenCalled();
}

describe('DELETE /api/payments/stripe-connect/delete', () => {
  it('401 without a session, and reads nothing', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockFindConnect).not.toHaveBeenCalled();
  });

  it('404 when neither table names an account', async () => {
    mockFindConnect.mockResolvedValue({ data: null, error: null });
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('Express success: Stripe first, then the row, then an awaited, flushed audit', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { how: 'deleted' } });
    expect(mockRelease).toHaveBeenCalledWith(ACCOUNT);
    expect(mockDeleteConnect).toHaveBeenCalledWith('row-1', USER.id);
    expect(mockDeletePlugin).not.toHaveBeenCalled();
    expect(mockRelease.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteConnect.mock.invocationCallOrder[0]);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_EVENTS.STRIPE_CONNECT_ACCOUNT_DELETED, entityId: ACCOUNT, details: expect.objectContaining({ how: 'deleted' }) })
    );
    expect(mockFlush).toHaveBeenCalled();
  });

  it('the healthy two-row case (Express placeholder) releases ONE account and removes both rows', async () => {
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { stripe_account_id: ACCOUNT } }, error: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockDeleteConnect).toHaveBeenCalled();
    expect(mockDeletePlugin).toHaveBeenCalledWith(USER.id, 'stripe');
    expect(mockInvalidate).toHaveBeenCalledWith(`plugin-status-${USER.id}`);
  });

  it('a Standard account linked only through the plugin path is released and its row removed (today: 404)', async () => {
    mockFindConnect.mockResolvedValue({ data: null, error: null });
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { id: 'acct_1PluginOnly' } }, error: null });
    mockRelease.mockResolvedValue({ kind: 'released', how: 'deauthorized', accountKind: 'standard' });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockRelease).toHaveBeenCalledWith('acct_1PluginOnly');
    expect(mockDeleteConnect).not.toHaveBeenCalled();
    expect(mockDeletePlugin).toHaveBeenCalledWith(USER.id, 'stripe');
  });

  it('already gone at Stripe: the rows go', async () => {
    mockRelease.mockResolvedValue({ kind: 'released', how: 'already_gone', accountKind: 'deleted' });
    expect((await call()).status).toBe(200);
    expect(mockDeleteConnect).toHaveBeenCalled();
  });

  it('K-4 regression: Stripe refuses → 409 stripe_refused and our row STAYS', async () => {
    mockRelease.mockResolvedValue({ kind: 'refused', reason: 'stripe_refused', step: 'delete', stripe: { type: 'StripeInvalidRequestError', code: null, statusCode: 400 } });
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('stripe_refused');
    expectNothingRemoved();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_EVENTS.STRIPE_CONNECT_DELETE_REFUSED, details: expect.objectContaining({ reason: 'stripe_refused', step: 'delete' }) })
    );
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it.each([
    ['not_available', 409],
    ['stripe_unreachable', 502],
  ])('a %s release answers %i and removes nothing', async (reason, status) => {
    mockRelease.mockResolvedValue({ kind: 'refused', reason, step: 'deauthorize' });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(reason);
    expectNothingRemoved();
  });

  it('D-2: client money in flight → 409 with blockers, and Stripe is never called', async () => {
    mockCheck.mockResolvedValue({ kind: 'blocked', blockers: [{ code: 'client_plans_running', count: 2 }], source: 'check' });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, error: 'client_money_in_flight', blockers: [{ code: 'client_plans_running', count: 2 }] });
    expect(mockCheck).toHaveBeenCalledWith({ id: USER.id, email: USER.email }, 'delete');
    expect(mockRelease).not.toHaveBeenCalled();
    expectNothingRemoved();
  });

  it('an unreadable money check → 503 check_failed, no Stripe call', async () => {
    mockCheck.mockResolvedValue({ kind: 'unreadable', reason: 'check_failed' });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('check_failed');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('W-8: a plugin-row read error (not "no row") → 503, no Stripe call, no delete', async () => {
    mockFindPlugin.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    const res = await call();
    expect(res.status).toBe(503);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
    expectNothingRemoved();
  });

  it('W-8: a Connect-row read error → 503', async () => {
    mockFindConnect.mockResolvedValue({ data: null, error: new Error('db') });
    expect((await call()).status).toBe(503);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('W-9: two different accounts → 409 not_available before any Stripe call', async () => {
    mockFindPlugin.mockResolvedValue({ data: { profile_data: { stripe_account_id: 'acct_1Different' } }, error: null });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expect(mockShared).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
    expectNothingRemoved();
  });

  it('a plugin row naming no account → 409 not_available', async () => {
    mockFindPlugin.mockResolvedValue({ data: { profile_data: {} }, error: null });
    expect((await call()).status).toBe(409);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('W-10: an account another business also names → 409 not_available, no Stripe call; audit says shared only', async () => {
    mockShared.mockResolvedValue('shared');
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('not_available');
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
    expectNothingRemoved();
    const audit = mockAuditLog.mock.calls[0][0] as { details: Record<string, unknown> };
    expect(audit.details.shared).toBe(true);
  });

  it('W-10: the shared check unreadable → 503', async () => {
    mockShared.mockResolvedValue('unreadable');
    expect((await call()).status).toBe(503);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it.each([
    ['Connect', () => mockDeleteConnect.mockResolvedValue({ data: null, error: new Error('db') })],
    [
      'plugin',
      () => {
        mockFindPlugin.mockResolvedValue({ data: { profile_data: { stripe_account_id: ACCOUNT } }, error: null });
        mockDeletePlugin.mockResolvedValue({ data: null, error: new Error('db') });
      },
    ],
  ])('F-1: Stripe released but our %s row could not be removed → 500 record_not_removed, and the owner is NOT told nothing changed', async (_row, arrange) => {
    arrange();
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('record_not_removed');
    // What both UIs show for this body (the real copy module over the real en dictionary).
    const t = (key: string) => (en as unknown as Record<string, string>)[key];
    const [line] = refusalLines(t, body);
    expect(line).toContain('Stripe has released the account');
    expect(line).not.toContain('Nothing was changed');
    expect(mockFlush).not.toHaveBeenCalled();
    // QA B-2: the Stripe-side release is recorded, non-blocking, as a refusal naming the stuck table.
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_EVENTS.STRIPE_CONNECT_DELETE_REFUSED,
        entityId: ACCOUNT,
        details: expect.objectContaining({
          reason: 'record_not_removed',
          table: _row === 'Connect' ? 'stripe_connect_accounts' : 'plugin_connections',
          how: 'deleted',
        }),
      })
    );
  });

  it('QA B-2: an audit failure on the record_not_removed path still answers 500 record_not_removed', async () => {
    mockDeleteConnect.mockResolvedValue({ data: null, error: new Error('db') });
    mockAuditLog.mockRejectedValue(new Error('audit down'));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('record_not_removed');
  });

  it('an audit failure does not fail the removal', async () => {
    mockAuditLog.mockRejectedValue(new Error('audit down'));
    expect((await call()).status).toBe(200);
  });

  it('W-13: no Stripe message and no details outside development', async () => {
    mockRelease.mockResolvedValue({ kind: 'refused', reason: 'stripe_refused', step: 'delete', stripe: { type: 'StripeInvalidRequestError', code: 'balance', statusCode: 400 } });
    const body = await (await call()).json();
    expect(body.details).toBeUndefined();
  });

  it('a request body is ignored', async () => {
    expect((await call(JSON.stringify({ stripe_account_id: 'acct_1Victim', user_id: 'other' }))).status).toBe(200);
    expect(mockRelease).toHaveBeenCalledWith(ACCOUNT);
  });
});
