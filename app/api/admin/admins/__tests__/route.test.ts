/**
 * GET /api/admin/admins (ADMIN_BOS_CLEANUP slice 1; conditions C-1, C-3, C-8;
 * SA W-4, W-10).
 *
 * The gate first (no read on any denial), the table/env split with a
 * case-insensitive overlap, a failed read as a 500 that carries no list, and
 * the leak check on the serialised body and every logger argument.
 *
 * The full four-case denial matrix also runs against this route through the
 * shared list in `app/api/admin/__tests__/adminGate.writes.test.ts`.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

// Mocked so the 403 case does not depend on the real audit path's bounded flush.
const mockRecordRefused = jest.fn();
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...a: unknown[]) => mockRecordRefused(...a),
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockListActive = jest.fn();
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: { listActive: (...a: unknown[]) => mockListActive(...a) },
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'caller@example.com' };
const PLANTED_USER_ID = '99999999-9999-4999-8999-999999999999';
const PLANTED_GRANTER = '88888888-8888-4888-8888-888888888888';

function row(over: Partial<Record<string, unknown>>) {
  return {
    id: 'row-id-default',
    user_id: null,
    email: 'someone@example.com',
    granted_by: PLANTED_GRANTER,
    notes: null,
    is_active: true,
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

/** Two rows: one bound with notes, one unbound. `ops@example.com` is also in the env in R-1. */
const ROWS = [
  row({ id: 'row-id-aaaa', user_id: PLANTED_USER_ID, email: 'ops@example.com', notes: 'Founder', created_at: '2026-07-01T10:00:00.000Z' }),
  row({ id: 'row-id-bbbb', user_id: null, email: 'new.admin@example.com', notes: null, created_at: '2026-08-15T09:30:00.000Z' }),
];

function req(query = '') {
  return new NextRequest(`http://localhost/api/admin/admins${query}`, {
    headers: { 'x-correlation-id': 'corr-admins' },
  });
}

type Body = {
  success: boolean;
  error?: string;
  details?: string;
  data?: {
    tableAdmins: Array<{ email: string; linkedToLogin: boolean; addedAt: string; notes: string | null; alsoInEnv: boolean }>;
    envOnlyAdmins: Array<{ email: string }>;
  };
};

const savedEnv = process.env.ADMIN_EMAILS;
const savedNodeEnv = process.env.NODE_ENV;
const setNodeEnv = (value: string) => {
  // NODE_ENV is typed read-only; tests need to flip it.
  (process.env as Record<string, string>).NODE_ENV = value;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockRecordRefused.mockResolvedValue(undefined);
  mockListActive.mockResolvedValue({ data: ROWS, error: null });
  process.env.ADMIN_EMAILS = 'Ops@Example.com; extra@x.io';
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = savedEnv;
  setNodeEnv(savedNodeEnv as string);
});

describe('R-9: the gate, and nothing before it', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListActive).not.toHaveBeenCalled();
  });

  it('403 when signed in but not an admin, with no read and no list in the body', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockListActive).not.toHaveBeenCalled();
    expect(mockRecordRefused).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as Body;
    expect(body.data).toBeUndefined();
  });
});

describe('happy path', () => {
  it('R-1: table rows in repository order, the env split, one overlap listed once', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      tableAdmins: [
        { email: 'ops@example.com', linkedToLogin: true, addedAt: '2026-07-01T10:00:00.000Z', notes: 'Founder', alsoInEnv: true },
        { email: 'new.admin@example.com', linkedToLogin: false, addedAt: '2026-08-15T09:30:00.000Z', notes: null, alsoInEnv: false },
      ],
      envOnlyAdmins: [{ email: 'extra@x.io' }],
    });
    expect(mockListActive).toHaveBeenCalledTimes(1);
  });

  it('R-2: a mixed-case table row matches a lowercase env address, both ways', async () => {
    mockListActive.mockResolvedValue({ data: [row({ email: 'Ops@Example.com' })], error: null });
    process.env.ADMIN_EMAILS = 'ops@example.com';
    let body = (await (await GET(req())).json()) as Body;
    expect(body.data!.tableAdmins).toHaveLength(1);
    // The stored email is shown unchanged.
    expect(body.data!.tableAdmins[0]).toMatchObject({ email: 'Ops@Example.com', alsoInEnv: true });
    expect(body.data!.envOnlyAdmins).toEqual([]);

    mockListActive.mockResolvedValue({ data: [row({ email: 'ops@example.com' })], error: null });
    process.env.ADMIN_EMAILS = 'OPS@EXAMPLE.COM';
    body = (await (await GET(req())).json()) as Body;
    expect(body.data!.tableAdmins[0]).toMatchObject({ email: 'ops@example.com', alsoInEnv: true });
    expect(body.data!.envOnlyAdmins).toEqual([]);
  });

  it('R-2b: a table row with surrounding whitespace still matches', async () => {
    mockListActive.mockResolvedValue({ data: [row({ email: ' Ops@Example.com ' })], error: null });
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const body = (await (await GET(req())).json()) as Body;
    expect(body.data!.tableAdmins[0].alsoInEnv).toBe(true);
    expect(body.data!.envOnlyAdmins).toEqual([]);
  });

  it('R-3: an env address whose row is deactivated (not returned) is listed as env-only', async () => {
    // listActive() does not return the deactivated row; the access check still grants it via the env.
    mockListActive.mockResolvedValue({ data: [row({ email: 'ops@example.com' })], error: null });
    process.env.ADMIN_EMAILS = 'ops@example.com, revoked@example.com';
    const body = (await (await GET(req())).json()) as Body;
    expect(body.data!.envOnlyAdmins).toEqual([{ email: 'revoked@example.com' }]);
  });

  it('R-3b: env-only addresses are sorted', async () => {
    mockListActive.mockResolvedValue({ data: [], error: null });
    process.env.ADMIN_EMAILS = 'zed@x.io,amy@x.io;mid@x.io';
    const body = (await (await GET(req())).json()) as Body;
    expect(body.data!.envOnlyAdmins.map((e) => e.email)).toEqual(['amy@x.io', 'mid@x.io', 'zed@x.io']);
    expect(body.data!.tableAdmins).toEqual([]);
  });

  it('R-4: ADMIN_EMAILS unset or empty', async () => {
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = value;
      const body = (await (await GET(req())).json()) as Body;
      expect(body.data!.envOnlyAdmins).toEqual([]);
      expect(body.data!.tableAdmins.every((e) => e.alsoInEnv === false)).toBe(true);
      expect(body.data!.tableAdmins).toHaveLength(2);
    }
  });

  it('R-10: a query string is ignored, not parsed', async () => {
    const plain = (await (await GET(req())).json()) as Body;
    const res = await GET(req('?x=1&role=admin'));
    expect(res.status).toBe(200);
    expect((await res.json()) as Body).toEqual(plain);
  });
});

describe('a failed read is an error, never an empty list', () => {
  const failRead = () => mockListActive.mockResolvedValue({ data: null, error: new Error('relation exploded') });

  it('R-5: repository error gives 500 with no list fields, and is logged with { err }', async () => {
    failRead();
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = (await res.json()) as Body & Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to load admin list');
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/tableAdmins|envOnlyAdmins/);
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to load admin list'
    );
  });

  it('R-5b: data null without an error is still a 500', async () => {
    mockListActive.mockResolvedValue({ data: null, error: null });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as Body).data).toBeUndefined();
  });

  it('R-5c: a throwing repository is a 500, not an empty list', async () => {
    mockListActive.mockRejectedValue(new Error('network'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as Body).error).toBe('Failed to load admin list');
  });

  it('R-6: details only in development', async () => {
    failRead();
    setNodeEnv('production');
    let body = (await (await GET(req())).json()) as Body;
    expect(body.details).toBeUndefined();

    setNodeEnv('development');
    body = (await (await GET(req())).json()) as Body;
    expect(body.details).toBe('relation exploded');
  });
});

describe('nothing leaks', () => {
  it('R-7: the serialised body carries no row id, user_id, granted_by, updated_at or is_active', async () => {
    const text = JSON.stringify(await (await GET(req())).json());
    for (const forbidden of ['user_id', 'granted_by', 'updated_at', 'is_active', 'row-id-aaaa', 'row-id-bbbb', PLANTED_USER_ID, PLANTED_GRANTER, '"id"']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('R-8: every logger argument is counts only, with no address', async () => {
    await GET(req());
    const calls = [...mockLog.info.mock.calls, ...mockLog.warn.mock.calls, ...mockLog.error.mock.calls, ...mockLog.debug.mock.calls];
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(JSON.stringify(args)).not.toContain('@');
    expect(mockLog.info).toHaveBeenCalledWith({ tableCount: 2, envOnlyCount: 1, overlapCount: 1 }, 'Admin list served');
  });
});
