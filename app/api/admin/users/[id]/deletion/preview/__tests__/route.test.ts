/**
 * POST /api/admin/users/[id]/deletion/preview (admin delete AD-1b, T11/T12;
 * SA SC-1, SC-10, D-1; AC-A1, AC-A4).
 *
 * The gate (`requireAdmin`) is REAL, over a mocked `getUser` and admin check;
 * the composition and the audit writer are mocked, so this file is about the
 * route: who gets in, what is validated before anything is read, how each
 * outcome maps to a status, and what the audit row and the logs carry.
 * The composition has its own suite (`AdminDeletionPreview.test.ts`).
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

const mockLogAndFlush = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a),
}));

const mockBuild = jest.fn();
jest.mock('@/lib/business-os/purge/AdminDeletionPreview', () => ({
  buildAdminDeletionPreview: (...a: unknown[]) => mockBuild(...a),
}));

import { POST, maxDuration, runtime } from '../route';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: 'cccccccc-2222-4222-8222-222222222222', email: 'customer@example.com' };
// Upper-case hex on purpose: the route must lower-case it.
const TARGET_UPPER = 'ABCDEF99-9999-4999-8999-99999999999F';
const TARGET = TARGET_UPPER.toLowerCase();
const EMAIL = 'planted.owner@example.com';
const BUSINESS = 'Planted Bakery Name';

const refusals = [
  { id: 'R-1', status: 'clear', message: 'x' },
  { id: 'R-2', status: 'clear', message: 'x' },
  { id: 'R-3', status: 'applies', message: 'live plan' },
  { id: 'R-4', status: 'not_applicable', message: 'No cross-account payment relationship exists.' },
  { id: 'R-5', status: 'clear', message: 'x' },
  { id: 'R-6', status: 'clear', message: 'x' },
  { id: 'R-7', status: 'deferred', message: 'Checked at the moment of deletion.' },
  { id: 'R-8', status: 'clear', message: 'x' },
];

const preview = (overrides: Record<string, unknown> = {}) => ({
  target: { userId: TARGET, email: EMAIL, businessName: BUSINESS, joinedAt: '2026-05-01T10:00:00.000Z' },
  counted: true,
  level: 'purge',
  options: { integrations: true, agents: true, activityHistory: false },
  areas: [{ area: 'crm', rows: 3, tablesUnknown: 0, tables: [] }],
  storage: [],
  totals: { rows: 3, tablesWithRows: 1, tablesUnknown: 0 },
  keptTables: [],
  refusals,
  schema: { status: 'ok', unclassified: [], missingDeletable: [], missingNever: [], fingerprint: 'f' },
  resetLive: false,
  limitations: [],
  deletionAvailable: false,
  deletionUnavailableReason: 'live plan',
  correlationId: 'c',
  generatedAt: '2026-10-04T00:00:00.000Z',
  ...overrides,
});

const call = (id: string, body?: string, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost/api/admin/users/${id}/deletion/preview`, {
      method: 'POST',
      body,
      headers,
    }),
    { params: { id } }
  );

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockBuild.mockReset().mockResolvedValue({ kind: 'ok', preview: preview() });
  mockLogAndFlush.mockClear();
  mockRecordRefused.mockClear();
  logged.length = 0;
});

describe('route config (SC-1)', () => {
  it('runs on node with a 60 s budget', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });
});

describe('the gate comes first (AC-A1)', () => {
  it('401 when signed out: nothing built, nothing audited', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(TARGET, '{}');
    expect(res.status).toBe(401);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('403 for a signed-in non-admin: nothing built, no preview audit row', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(TARGET, '{}');
    expect(res.status).toBe(403);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockRecordRefused).toHaveBeenCalledTimes(1);
  });

  it('403 even with an invalid id: the gate answers before validation', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('not-a-uuid', '{"userId":"x"}')).status).toBe(403);
  });
});

describe('input validation, before any lookup (AC-A4)', () => {
  it('400 for a non-UUID id', async () => {
    asAdmin();
    const res = await call('not-a-uuid', '{}');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'invalid_user_id' });
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it('400 for a body carrying userId (or any key)', async () => {
    asAdmin();
    expect((await call(TARGET, JSON.stringify({ userId: CUSTOMER.id }))).status).toBe(400);
    expect((await call(TARGET, JSON.stringify({ level: 'reset' }))).status).toBe(400);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it('400 for malformed JSON and for a non-object body', async () => {
    asAdmin();
    expect((await call(TARGET, '{not json')).status).toBe(400);
    expect((await call(TARGET, '[]')).status).toBe(400);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it('accepts an empty body and {}', async () => {
    asAdmin();
    expect((await call(TARGET)).status).toBe(200);
    expect((await call(TARGET, '{}')).status).toBe(200);
  });
});

describe('outcomes', () => {
  it('200: the preview, built for the lower-cased path id and the gate admin', async () => {
    asAdmin();
    const res = await call(TARGET_UPPER, '{}', { 'x-correlation-id': 'corr-1' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.target).toEqual({ userId: TARGET, email: EMAIL, businessName: BUSINESS, joinedAt: '2026-05-01T10:00:00.000Z' });
    expect(json.data.deletionAvailable).toBe(false);
    expect(json.data.refusals.find((r: { id: string }) => r.id === 'R-4').status).toBe('not_applicable');
    expect(mockBuild).toHaveBeenCalledWith({ adminId: ADMIN.id, targetId: TARGET, correlationId: 'corr-1' });
  });

  it('200 for self with R-1 applying and counted: false', async () => {
    asAdmin();
    mockBuild.mockResolvedValue({
      kind: 'ok',
      preview: preview({ counted: false, areas: [], totals: null, refusals: [{ id: 'R-1', status: 'applies', message: 'own' }] }),
    });
    const res = await call(ADMIN.id, '{}');
    expect(res.status).toBe(200);
    expect((await res.json()).data.counted).toBe(false);
  });

  it('404 for an unknown target', async () => {
    asAdmin();
    mockBuild.mockResolvedValue({ kind: 'not_found' });
    const res = await call(TARGET, '{}');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'user_not_found' });
  });

  it('500, never 404, when the identity read failed (SA D-1)', async () => {
    asAdmin();
    mockBuild.mockResolvedValue({ kind: 'identity_error' });
    const res = await call(TARGET, '{}');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('identity_read_failed');
  });

  it('500 when the preview throws; details only in development', async () => {
    asAdmin();
    mockBuild.mockRejectedValue(new Error('secret internal detail'));
    const prev = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      let res = await call(TARGET, '{}');
      expect(res.status).toBe(500);
      expect((await res.json()).details).toBeUndefined();

      (process.env as Record<string, string>).NODE_ENV = 'development';
      res = await call(TARGET, '{}');
      expect((await res.json()).details).toBe('secret internal detail');
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev as string;
    }
  });
});

describe('audit row and logs (user-added 2026-10-04; SC-10)', () => {
  it('one BUSINESS_DELETION_PREVIEWED row: admin as user and actor, target as entity, refusal codes, no PII', async () => {
    asAdmin();
    await call(TARGET, '{}', { 'x-correlation-id': 'corr-2' });
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: 'BUSINESS_DELETION_PREVIEWED',
      entityType: 'user',
      entityId: TARGET,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'info',
      details: {
        correlationId: 'corr-2',
        outcome: 'previewed',
        targetId: TARGET,
        counted: true,
        deletionAvailable: false,
        refusals: refusals.map((r) => `${r.id}:${r.status}`),
      },
    });
    const details = JSON.stringify(entry.details);
    expect(details).not.toContain(EMAIL);
    expect(details).not.toContain(BUSINESS);
  });

  it('audits not_found and error outcomes too; never on a 400', async () => {
    asAdmin();
    mockBuild.mockResolvedValue({ kind: 'not_found' });
    await call(TARGET, '{}');
    expect(mockLogAndFlush.mock.calls[0][0].details.outcome).toBe('not_found');

    mockBuild.mockResolvedValue({ kind: 'identity_error' });
    await call(TARGET, '{}');
    expect(mockLogAndFlush.mock.calls[1][0].details.outcome).toBe('error');

    mockLogAndFlush.mockClear();
    await call('nope', '{}');
    await call(TARGET, '{"userId":"x"}');
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('an audit failure never fails the preview', async () => {
    asAdmin();
    // logAndFlush never rejects by contract; the route's catch keeps a rejection harmless anyway.
    mockLogAndFlush.mockRejectedValueOnce(new Error('audit down'));
    expect((await call(TARGET, '{}')).status).toBe(200);
  });

  it('no logger argument carries the email or the business name', async () => {
    asAdmin();
    await call(TARGET, '{}');
    const text = JSON.stringify(logged);
    expect(logged.length).toBeGreaterThan(0);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(BUSINESS);
  });
});
