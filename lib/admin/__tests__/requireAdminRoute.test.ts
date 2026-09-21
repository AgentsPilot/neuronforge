/**
 * T0-7 (Layer 2 Step 0, AC-1): the shared admin gate, tested once.
 *
 * 401 signed out, 403 for a non-admin, 403 (fail closed) when the admin check
 * throws, `{ user }` for an admin, and the caller's email never reaches a log.
 */

import { NextResponse } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

import { requireAdmin } from '../requireAdminRoute';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };

const logs: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
const testLogger = {
  warn: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'warn', ctx, msg }),
  error: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'error', ctx, msg }),
};

beforeEach(() => {
  jest.clearAllMocks();
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
