/**
 * POST /api/admin/users/[id]/deletion/commit (admin delete AD-2a, T10; SA
 * AC2-6, AC2-11; AC-A1, AC-A4, AC-A6, AC-A7).
 *
 * The gate (`requireAdmin`) is REAL, over a mocked `getUser` and admin check.
 * The composition is mocked for the route's own concerns (who gets in, what is
 * validated before anything runs, how outcomes map to statuses), and run FOR
 * REAL once, with the off switch in its default state, to prove the shipped
 * behaviour: 409 `admin_delete_disabled`, nothing read.
 * The composition has its own suite (`AdminDeletionCommit.test.ts`).
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...a: unknown[]) => mockIsAdmin(...a) }) },
}));

const mockRecordRefused = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...a: unknown[]) => mockRecordRefused(...a),
}));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...args: unknown[]) => {
      logged.push(args);
    };
    const l: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockLogAndFlush = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a),
}));

const mockWriteNow = jest.fn().mockResolvedValue({ written: true });
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ writeNow: (...a: unknown[]) => mockWriteNow(...a) }) },
}));

const mockFindUserIdentity = jest.fn();
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: { findUserIdentity: (...a: unknown[]) => mockFindUserIdentity(...a) },
}));

const mockCommit = jest.fn();
jest.mock('@/lib/business-os/purge/AdminDeletionCommit', () => ({
  commitAdminDeletion: (...a: unknown[]) => mockCommit(...a),
}));

import { POST, dynamic, maxDuration, runtime } from '../route';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: 'cccccccc-2222-4222-8222-222222222222', email: 'customer@example.com' };
const TARGET_UPPER = 'ABCDEF99-9999-4999-8999-99999999999F';
const TARGET = TARGET_UPPER.toLowerCase();
const TOKEN = 'eyJ2IjoxfQ.c2lnbmF0dXJl';
const BUSINESS = 'Planted Bakery Name';

const body = (o: Record<string, unknown> = {}) => JSON.stringify({ token: TOKEN, confirmText: BUSINESS, ...o });

const call = (id: string, raw?: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest(`http://localhost/api/admin/users/${id}/deletion/commit`, { method: 'POST', body: raw, headers }), {
    params: { id },
  });

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const COMPLETED = {
  kind: 'completed',
  result: {
    targetId: TARGET,
    level: 'purge',
    options: { integrations: true, agents: false, activityHistory: false },
    snapshotPath: `${TARGET}/s.json`,
    rows: { total: 4, byTable: { crm_contacts: 4 } },
    storage: [],
    residue: [],
    invites: { revoked: 1, skippedMidSignup: 0 },
    kept: ['agents'],
    notes: [],
    auditRecorded: true,
    committedAt: '2026-10-06T00:00:00Z',
    durationMs: 5,
    correlationId: 'c',
    previewCorrelationId: 'p',
  },
};

const prevSwitch = process.env.ADMIN_BUSINESS_DELETE_ENABLED;
afterAll(() => {
  if (prevSwitch === undefined) delete process.env.ADMIN_BUSINESS_DELETE_ENABLED;
  else process.env.ADMIN_BUSINESS_DELETE_ENABLED = prevSwitch;
});

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockCommit.mockReset().mockResolvedValue(COMPLETED);
  mockLogAndFlush.mockClear();
  mockRecordRefused.mockClear();
  mockFindUserIdentity.mockReset();
  logged.length = 0;
  delete process.env.ADMIN_BUSINESS_DELETE_ENABLED;
});

describe('route config', () => {
  it('runs on node, never cached, with a 60 s budget', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(maxDuration).toBe(60);
  });
});

describe('the gate comes first (AC-A1)', () => {
  it('401 when signed out: nothing runs', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call(TARGET, body())).status).toBe(401);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('403 for a signed-in non-admin: nothing runs, the refusal is recorded', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call(TARGET, body())).status).toBe(403);
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockRecordRefused).toHaveBeenCalledTimes(1);
  });

  it('403 even with an invalid id and body: the gate answers before validation', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('not-a-uuid', '{"userId":"x"}')).status).toBe(403);
  });
});

describe('input validation, before anything runs (FR-A4, AC-A4)', () => {
  it('400 for a non-UUID id', async () => {
    asAdmin();
    const res = await call('not-a-uuid', body());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_user_id' });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it.each([
    ['a userId', { userId: CUSTOMER.id }],
    ['a level', { level: 'reset' }],
    ['options', { options: { agents: true } }],
    ['any other key', { extra: 1 }],
  ])('400 for a body carrying %s', async (_l, extra) => {
    asAdmin();
    expect((await call(TARGET, body(extra))).status).toBe(400);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('400 for malformed JSON, an empty body, a missing token or whitespace-only text', async () => {
    asAdmin();
    expect((await call(TARGET, '{not json')).status).toBe(400);
    expect((await call(TARGET)).status).toBe(400);
    expect((await call(TARGET, JSON.stringify({ confirmText: BUSINESS }))).status).toBe(400);
    expect((await call(TARGET, body({ confirmText: '   ' }))).status).toBe(400);
    expect((await call(TARGET, body({ token: 'x'.repeat(4097) }))).status).toBe(400);
    expect(mockCommit).not.toHaveBeenCalled();
  });
});

describe('the composition is called with the PATH target and the gate’s admin', () => {
  it('200 with the result on a completed deletion; the id is lower-cased', async () => {
    asAdmin();
    const res = await call(TARGET_UPPER, body(), { 'x-correlation-id': 'corr-9' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: COMPLETED.result });
    expect(mockCommit).toHaveBeenCalledWith(
      expect.objectContaining({ admin: ADMIN, targetId: TARGET, token: TOKEN, confirmText: BUSINESS, correlationId: 'corr-9' })
    );
  });

  it('a refusal maps to its status and code, with the refusal list', async () => {
    asAdmin();
    mockCommit.mockResolvedValue({
      kind: 'refused',
      httpStatus: 400,
      code: 'confirmation_mismatch',
      message: 'Confirmation did not match.',
      snapshotWritten: false,
      expectedKind: 'business name',
    });
    const res = await call(TARGET, body({ confirmText: 'wrong' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'confirmation_mismatch', expectedKind: 'business name', snapshotWritten: false });
  });

  it('500 on an unexpected throw; details only in development', async () => {
    asAdmin();
    mockCommit.mockRejectedValue(new Error('secret internal detail'));
    const env = process.env as Record<string, string | undefined>;
    const prevEnv = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      let res = await call(TARGET, body());
      expect(res.status).toBe(500);
      expect((await res.json()).details).toBeUndefined();
      env.NODE_ENV = 'development';
      res = await call(TARGET, body());
      expect((await res.json()).details).toBe('secret internal detail');
    } finally {
      env.NODE_ENV = prevEnv;
    }
  });

  it('logs no token, email or business name', async () => {
    asAdmin();
    await call(TARGET, body());
    const text = JSON.stringify(logged);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(BUSINESS);
    expect(text).not.toContain(ADMIN.email);
  });
});

describe('as shipped (inactive): the REAL composition with the off switch in its default state', () => {
  it('409 admin_delete_disabled, nothing read, one admin-owned blocked row', async () => {
    const actual = jest.requireActual<typeof import('@/lib/business-os/purge/AdminDeletionCommit')>(
      '@/lib/business-os/purge/AdminDeletionCommit'
    );
    mockCommit.mockImplementation((...a: Parameters<typeof actual.commitAdminDeletion>) => actual.commitAdminDeletion(...a));
    asAdmin();
    const res = await call(TARGET, body());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, error: 'admin_delete_disabled', snapshotWritten: false });
    expect(mockFindUserIdentity).not.toHaveBeenCalled();
    expect(mockWriteNow).not.toHaveBeenCalled();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(mockLogAndFlush.mock.calls[0][0]).toMatchObject({
      action: 'BUSINESS_DATA_PURGE_BLOCKED',
      entityType: 'user',
      entityId: TARGET,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      details: { reason: 'admin_delete_disabled', surface: 'admin' },
    });
  });
});
