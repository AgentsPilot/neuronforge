/**
 * T0-7 (Layer 2 Step 0, AC-1): the shared admin gate, tested once.
 *
 * 401 signed out, 403 for a non-admin, 403 (fail closed) when the admin check
 * throws, `{ user }` for an admin, and the caller's email never reaches a log.
 *
 * Plus, since the refusal became audited: exactly one row when the check
 * ANSWERED NO, zero when it THREW, and a 403 that is unchanged however the
 * audit write behaves. Those cases live here rather than in a sibling file —
 * this module has one canonical test file and two files asserting on one gate
 * is how coverage drifts apart.
 *
 * The audit service is mocked for a reason beyond convenience: `AuditTrail` is
 * constructed at module scope against the jest env stubs, so without this mock
 * the non-admin case below would attempt a real insert at a stub URL from
 * inside a pure unit test.
 */

import { NextResponse } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const auditLog = jest.fn();
const auditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => auditLog(...args),
    flush: (...args: unknown[]) => auditFlush(...args),
  },
}));

import { requireAdmin } from '../requireAdminRoute';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };

const logs: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
const testLogger = {
  warn: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'warn', ctx, msg }),
  error: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'error', ctx, msg }),
};

beforeEach(() => {
  jest.clearAllMocks();
  auditLog.mockResolvedValue(undefined);
  auditFlush.mockResolvedValue(undefined);
  logs.length = 0;
});

describe('requireAdmin', () => {
  it('returns 401 when signed out, without calling the admin service', async () => {
    getUser.mockResolvedValue(null);

    const result = await requireAdmin(testLogger);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  // D-Q3: an auth outage used to escape as a 500.
  it('returns 401 when the auth lookup throws, without calling the admin service', async () => {
    getUser.mockRejectedValue(new Error('auth service unreachable'));

    const result = await requireAdmin(testLogger);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' });
    expect(isAdmin).not.toHaveBeenCalled();
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('returns 403 for a signed-in non-admin', async () => {
    getUser.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    isAdmin.mockResolvedValue(false);

    const result = await requireAdmin(testLogger);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Forbidden' });
    expect(logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('fails closed with 403 when the admin check throws', async () => {
    getUser.mockResolvedValue(ADMIN);
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const result = await requireAdmin(testLogger);

    expect((result as NextResponse).status).toBe(403);
    expect(logs.some((l) => l.level === 'error' && l.msg.includes('denying access'))).toBe(true);
  });

  it('returns the user for an admin, and asks AdminAccessService (never profiles.role)', async () => {
    getUser.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(true);

    const result = await requireAdmin(testLogger);

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toEqual({ user: { id: ADMIN.id, email: ADMIN.email } });
    expect(isAdmin).toHaveBeenCalledWith({ id: ADMIN.id, email: ADMIN.email });
  });

  it('never logs the caller email', async () => {
    getUser.mockResolvedValue({ id: 'user-1', email: 'leaky@example.com' });
    isAdmin.mockResolvedValue(false);
    await requireAdmin(testLogger);

    getUser.mockResolvedValue({ id: 'user-2', email: 'alsoleaky@example.com' });
    isAdmin.mockRejectedValue(new Error('boom'));
    await requireAdmin(testLogger);

    expect(logs.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(logs);
    expect(serialised).not.toContain('leaky@example.com');
    expect(serialised).not.toContain('alsoleaky@example.com');
    for (const entry of logs) {
      expect(Object.keys(entry.ctx)).not.toContain('email');
    }
  });
});

/**
 * The refusal is recorded (security-audit-events slice). Everything the admin
 * trail, the Health landing and /monitoring already READ about unauthorised
 * access was structurally empty until this write existed.
 */
describe('requireAdmin records a refusal', () => {
  const CUSTOMER = { id: '44444444-4444-4444-8444-444444444444', email: 'customer@example.com' };

  it('writes exactly one row when the check ANSWERED NO, and still returns 403', async () => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockResolvedValue(false);

    const result = await requireAdmin(testLogger);

    expect((result as NextResponse).status).toBe(403);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditFlush).toHaveBeenCalledTimes(1); // flushed before the handler returns
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS,
      entityType: 'system',
      entityId: null,
      userId: CUSTOMER.id,
      actorId: CUSTOMER.id,
      details: { surface: 'admin_api', reason: 'not_an_admin' },
    });
  });

  it('the row carries no request, no severity and no flags', async () => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockResolvedValue(false);
    await requireAdmin(testLogger);

    const entry = auditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty('request'); // session_id must stay null
    expect(entry).not.toHaveProperty('severity');
    expect(entry).not.toHaveProperty('complianceFlags');
    expect(JSON.stringify(entry)).not.toContain(CUSTOMER.email);
  });

  it('writes NOTHING when the admin check THREW — a database outage is not a probe', async () => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const result = await requireAdmin(testLogger);

    expect((result as NextResponse).status).toBe(403); // still fails closed
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('writes nothing for an anonymous caller — there was no identity to refuse', async () => {
    getUser.mockResolvedValue(null);
    const result = await requireAdmin(testLogger);
    expect((result as NextResponse).status).toBe(401);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('writes nothing when the auth lookup threw', async () => {
    getUser.mockRejectedValue(new Error('auth service unreachable'));
    expect(((await requireAdmin(testLogger)) as NextResponse).status).toBe(401);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('writes nothing for an admin', async () => {
    getUser.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(true);
    await requireAdmin(testLogger);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('a REJECTING audit write still returns 403, not 500', async () => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockResolvedValue(false);
    auditFlush.mockRejectedValue(new Error('database unreachable'));

    const result = await requireAdmin(testLogger);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    await expect((result as NextResponse).json()).resolves.toEqual({ success: false, error: 'Forbidden' });
  });

  it('a HANGING audit write still returns 403, after the bounded wait', async () => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockResolvedValue(false);
    let release: () => void = () => undefined;
    auditFlush.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    const started = Date.now();
    const result = await requireAdmin(testLogger);
    const elapsed = Date.now() - started;

    expect((result as NextResponse).status).toBe(403);
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(5000);
    expect(logs.some((l) => l.level === 'warn' && l.msg.includes('timed out'))).toBe(true);
    release(); // do not leave the shared flush chain blocked for later tests
  }, 10_000);
});
