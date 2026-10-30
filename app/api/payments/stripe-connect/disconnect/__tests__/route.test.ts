/**
 * POST /api/payments/stripe-connect/disconnect (self-service exit SX-5 / D5;
 * BQ-12 = block; SA W-12). The real route over mocked edges.
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

const mockFind = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  StripeConnectRepository: jest.fn().mockImplementation(() => ({
    findByUserId: (...args: unknown[]) => mockFind(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  })),
}));

const mockCheck = jest.fn();
jest.mock('@/lib/business-os/account-deletion/connectExitGuard', () => ({ checkConnectExit: (...args: unknown[]) => mockCheck(...args) }));

const mockAuditLog = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...args: unknown[]) => mockAuditLog(...args), flush: () => mockFlush() }) },
}));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.org' };
const ROW = { id: 'row-1', stripe_account_id: 'acct_1Own', stripe_account_type: 'express', country: 'US' };

const call = () => POST(new NextRequest('http://localhost/api/payments/stripe-connect/disconnect', { method: 'POST' }));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockFind.mockResolvedValue({ data: ROW, error: null });
  mockCheck.mockResolvedValue({ kind: 'clear', source: 'local' });
  mockUpdate.mockResolvedValue({ data: ROW, error: null });
  mockAuditLog.mockResolvedValue(undefined);
  mockFlush.mockResolvedValue(undefined);
});

describe('POST /api/payments/stripe-connect/disconnect', () => {
  it('401 without a session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('404 with no Connect row (a plugin-only account still cannot be soft-disconnected; noted in the as-built)', async () => {
    mockFind.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
  });

  it('a read error → 503, nothing updated', async () => {
    mockFind.mockResolvedValue({ data: null, error: new Error('db') });
    expect((await call()).status).toBe(503);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('BQ-12: running client plans → 409 client_plans_running with the count, nothing updated', async () => {
    mockCheck.mockResolvedValue({ kind: 'blocked', blockers: [{ code: 'client_plans_running', count: 3 }], source: 'local' });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'client_plans_running', blockers: [{ code: 'client_plans_running', count: 3 }] });
    expect(mockCheck).toHaveBeenCalledWith({ id: USER.id, email: USER.email }, 'disconnect');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_EVENTS.STRIPE_CONNECT_DISCONNECT_REFUSED }));
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('an unreadable check → 503 check_failed, nothing updated', async () => {
    mockCheck.mockResolvedValue({ kind: 'unreadable', reason: 'local_unreadable' });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('check_failed');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clear → the same literal four-field update as before, then an awaited, flushed audit', async () => {
    expect((await call()).status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(USER.id, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      onboarding_completed: false,
    });
    expect(mockCheck.mock.invocationCallOrder[0]).toBeLessThan(mockUpdate.mock.invocationCallOrder[0]);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_EVENTS.STRIPE_CONNECT_ACCOUNT_DISCONNECTED }));
    expect(mockFlush).toHaveBeenCalled();
  });
});
