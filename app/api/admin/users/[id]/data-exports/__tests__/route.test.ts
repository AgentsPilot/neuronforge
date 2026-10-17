/**
 * GET + POST /api/admin/users/[id]/data-exports (data export DE-10a, workplan
 * §5.1, §5.2, §9 T-1 ... T-11, T-14, T-21; SA-1, SA-8, SA-10, SA-11, W10-1,
 * W10-2, W10-4, W10-5).
 *
 * The gate (`requireAdmin`) is REAL over a mocked `getUser` and admin check,
 * as the gate oracle runs it. The repositories, the engine and the audit
 * writers are mocked; the audit INPUTS come from the real builder module, so
 * the placement assertions test what the route really writes.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

/** Every effect in order, so "the gate first" and "nothing before a 400" are one assertion. */
const order: string[] = [];

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => (order.push('getUser'), mockGetUser()) }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...a: unknown[]) => (order.push('isAdmin'), mockIsAdmin(...a)) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn().mockResolvedValue(undefined) }));

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const l: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) l[level] = (...args: unknown[]) => logged.push(args);
  l.child = () => l;
  return { createLogger: () => l };
});

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  ...jest.requireActual('@/lib/security/rateLimit'),
  rateLimit: (...a: unknown[]) => (order.push('rateLimit'), mockRateLimit(...a)),
}));

const mockList = jest.fn();
const mockLatestCompleted = jest.fn();
const mockStartForAdmin = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  businessOsDataExportJobRepository: {
    listForUser: (...a: unknown[]) => (order.push('listForUser'), mockList(...a)),
    findLatestCompletedForUser: (...a: unknown[]) => (order.push('findLatestCompletedForUser'), mockLatestCompleted(...a)),
    startForAdmin: (...a: unknown[]) => (order.push('startForAdmin'), mockStartForAdmin(...a)),
  },
}));
const mockIdentity = jest.fn();
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: { findUserIdentity: (...a: unknown[]) => (order.push('findUserIdentity'), mockIdentity(...a)) },
}));
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => (order.push('audit.log'), mockAuditLog(...a)) },
}));
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...a: unknown[]) => (order.push('logAndFlush'), mockLogAndFlush(...a)),
}));
const mockRunZipExport = jest.fn();
jest.mock('@/lib/business-os/data-export/zipExport', () => ({
  runZipExport: (...a: unknown[]) => (order.push('runZipExport'), mockRunZipExport(...a)),
}));
jest.mock('@/lib/business-os/data-export/zipExportDeps', () => ({ zipExportDeps: () => ({ fake: true }) }));

import { GET, POST, maxDuration, runtime } from '../route';
import type { AuditLogInput } from '@/lib/audit/types';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: 'cccccccc-2222-4222-8222-222222222222', email: 'customer@example.com' };
// Upper-case hex on purpose: the route must lower-case it.
const TARGET_UPPER = 'ABCDEF99-9999-4999-8999-99999999999F';
const TARGET = TARGET_UPPER.toLowerCase();
const OTHER = 'bbbbbbbb-3333-4333-8333-333333333333';
const JOB = 'dddddddd-4444-4444-8444-444444444444';
const OLD = 'eeeeeeee-5555-4555-8555-555555555555';
const EMAIL = 'planted.owner@example.com';
const REASON = 'Owner asked by phone, ticket 123';

const job = (over: Record<string, unknown> = {}) => ({
  id: JOB,
  user_id: TARGET,
  requested_by: TARGET,
  requested_by_kind: 'owner',
  status: 'ready',
  failure_reason: null,
  bytes: 2048,
  file_count: 3,
  row_count: 40,
  created_at: '2026-10-17T06:30:00.000Z',
  finished_at: '2026-10-17T06:30:05.000Z',
  ready_at: '2026-10-17T06:30:05.000Z',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  expired_at: null,
  owner_downloaded_at: null,
  updated_at: '2026-10-17T06:30:05.000Z',
  ...over,
});

const READY = {
  kind: 'ready',
  job: job({ id: JOB, requested_by: ADMIN.id, requested_by_kind: 'admin' }),
  businessName: 'Planted Bakery Name',
  timezone: 'UTC',
  sectionCounts: { crm_contacts: 2 },
  failedSections: [],
  missingFiles: 1,
  filesIncluded: 3,
  sizes: { bytes: 2048, fileCount: 3, rowCount: 40 },
  ceilingUsePct: 5,
  durationMs: 1200,
  replacedJobIds: [OLD],
};

const ctx = (id = TARGET_UPPER) => ({ params: { id } });
const getReq = (id = TARGET_UPPER, query = '') => GET(new NextRequest(`http://localhost/api/admin/users/${id}/data-exports${query}`), ctx(id));
const postReq = (body: string | undefined, id = TARGET_UPPER) =>
  POST(
    new NextRequest(`http://localhost/api/admin/users/${id}/data-exports`, {
      method: 'POST',
      ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
    }),
    ctx(id)
  );
const reasonBody = (reason: unknown = REASON, extra: Record<string, unknown> = {}) => JSON.stringify({ reason, ...extra });

/** Every audit input either writer received. */
const auditInputs = (): AuditLogInput[] => [
  ...mockAuditLog.mock.calls.map((call) => call[0] as AuditLogInput),
  ...mockLogAndFlush.mock.calls.map((call) => call[0] as AuditLogInput),
];

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  logged.length = 0;
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockList.mockResolvedValue({ data: [], error: null });
  mockLatestCompleted.mockResolvedValue({ data: null, error: null });
  mockStartForAdmin.mockResolvedValue({ data: { outcome: 'started', jobId: JOB }, error: null });
  mockIdentity.mockResolvedValue({ data: { id: TARGET, email: EMAIL, createdAt: '2026-01-01T00:00:00.000Z' }, error: null });
  mockAuditLog.mockResolvedValue(undefined);
  mockLogAndFlush.mockResolvedValue(undefined);
  mockRunZipExport.mockResolvedValue(READY);
});

it('runs on Node, at most 60 s (below the 90 s stale rule)', () => {
  expect(runtime).toBe('nodejs');
  expect(maxDuration).toBeLessThanOrEqual(60);
});

describe('T-1 / T-2 the gate first (W10-1)', () => {
  it.each([
    ['GET', () => getReq()],
    ['POST', () => postReq(reasonBody())],
  ])('%s: signed out is 401 and nothing else ran', async (_m, call) => {
    mockGetUser.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    expect(order).toEqual(['getUser']);
  });

  it.each([
    ['GET', () => getReq()],
    ['POST', () => postReq(reasonBody())],
  ])('%s: a signed-in non-admin is 403 and nothing else ran', async (_m, call) => {
    mockGetUser.mockResolvedValueOnce(CUSTOMER);
    mockIsAdmin.mockResolvedValueOnce(false);
    expect((await call()).status).toBe(403);
    expect(order).toEqual(['getUser', 'isAdmin']);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('source: requireAdmin is the first statement of both handlers', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/admin/users/[id]/data-exports/route.ts'), 'utf8').replace(/\r\n/g, '\n');
    for (const handler of ['GET', 'POST']) {
      const at = source.indexOf(`export async function ${handler}(`);
      const bodyStart = source.indexOf('{\n', source.indexOf(')', at)) + 2;
      expect(source.slice(bodyStart).trimStart().startsWith('const gate = await requireAdmin(')).toBe(true);
    }
    expect(source).not.toMatch(/AdminAccessService|profiles\.role/);
  });
});

describe('GET: the status list (§5.1, SA-8)', () => {
  it('lists the last 10 of the PATH account, metadata only, no link, not audited; throttled on the read rule', async () => {
    mockList.mockResolvedValueOnce({
      data: [
        job({ id: JOB, requested_by: ADMIN.id, requested_by_kind: 'admin' }),
        job({ id: OLD, requested_by: OTHER, requested_by_kind: 'admin', status: 'expired', expires_at: '2026-10-01T00:00:00.000Z' }),
        job({ id: 'ffffffff-6666-4666-8666-666666666666', status: 'failed', failure_reason: 'over_ceiling', expires_at: null, ready_at: null }),
      ],
      error: null,
    });
    const response = await getReq(TARGET_UPPER, `?userId=${OTHER}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mockList).toHaveBeenCalledWith(TARGET, { limit: 10 });
    const body = await response.json();
    expect(body.data.exports).toHaveLength(3);
    expect(body.data.exports[0]).toMatchObject({
      jobId: JOB,
      requestedByKind: 'admin',
      requestedByShort: ADMIN.id.slice(0, 8),
      isRequestedByYou: true,
      status: 'ready',
      isDownloadable: true,
      bytes: 2048,
      fileCount: 3,
    });
    expect(body.data.exports[1]).toMatchObject({ requestedByShort: OTHER.slice(0, 8), isRequestedByYou: false, isDownloadable: false });
    expect(body.data.exports[2]).toMatchObject({ requestedByKind: 'owner', requestedByShort: null, failureReason: 'over_ceiling' });
    expect(body.data).toMatchObject({ ownerDownloadedLatest: false, isOwnAccount: false, dailyLimit: 3 });
    const text = JSON.stringify(body);
    expect(text).not.toContain(ADMIN.id.slice(9)); // never the full admin id
    expect(text).not.toMatch(/downloadUrl|fileName|https?:/);
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockRateLimit.mock.calls[0][1]).toBe('admin-data-export-status');
    expect(mockRateLimit.mock.calls[0][2]).toEqual({ limit: 120, failureLimit: 20, windowSeconds: 300 });
  });

  it('BC-4: ownerDownloadedLatest follows the newest DELIVERED owner export only', async () => {
    mockList.mockResolvedValueOnce({
      data: [
        job({ id: JOB, requested_by: ADMIN.id, requested_by_kind: 'admin', owner_downloaded_at: null }),
        job({ id: OLD, owner_downloaded_at: '2026-10-17T06:31:00.000Z' }),
      ],
      error: null,
    });
    expect((await (await getReq()).json()).data.ownerDownloadedLatest).toBe(true);
    mockList.mockResolvedValueOnce({ data: [job({ owner_downloaded_at: null }), job({ id: OLD, owner_downloaded_at: '2026-10-01T00:00:00Z' })], error: null });
    expect((await (await getReq()).json()).data.ownerDownloadedLatest).toBe(false);
    expect(mockLatestCompleted).not.toHaveBeenCalled();
  });

  it('BC-4: a full page with no owner export reads the newest one on its own', async () => {
    mockList.mockResolvedValueOnce({ data: Array.from({ length: 10 }, () => job({ requested_by: ADMIN.id, requested_by_kind: 'admin' })), error: null });
    mockLatestCompleted.mockResolvedValueOnce({ data: job({ owner_downloaded_at: '2026-09-01T00:00:00Z' }), error: null });
    expect((await (await getReq()).json()).data.ownerDownloadedLatest).toBe(true);
    expect(mockLatestCompleted).toHaveBeenCalledWith(TARGET);
  });

  it('a failed read is a 500, never an empty list', async () => {
    mockList.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const response = await getReq();
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('data');
  });

  it("the admin's own account is flagged so the box hides its actions (BC-6)", async () => {
    expect((await (await getReq(ADMIN.id)).json()).data.isOwnAccount).toBe(true);
  });

  it('T-3: a path id that is not a uuid is 400 before any read', async () => {
    expect((await getReq('not-a-uuid')).status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});

describe('POST: input (T-3, T-4, T-5, T-7, W10-2)', () => {
  it.each([
    ['missing reason', '{}'],
    ['empty body', undefined],
    ['blank reason', reasonBody('   ')],
    ['4 characters', reasonBody('abcd')],
    ['501 characters', reasonBody('x'.repeat(501))],
    ['a number', reasonBody(12345)],
    ['malformed JSON', '{"reason":'],
    ['an injected userId', reasonBody(REASON, { userId: OTHER })],
    ['an injected targetUserId', reasonBody(REASON, { targetUserId: OTHER })],
    ['an injected jobId', reasonBody(REASON, { jobId: JOB })],
  ])('%s is 400 before any throttle, repository or audit call', async (_label, body) => {
    const response = await postReq(body);
    expect(response.status).toBe(400);
    expect(order).toEqual(['getUser', 'isAdmin']);
  });

  it.each([
    ['5 characters', 'abcde'],
    ['500 characters', 'y'.repeat(500)],
  ])('%s is accepted', async (_label, reason) => {
    expect((await postReq(reasonBody(reason))).status).toBe(200);
  });

  it('a path id that is not a uuid is 400', async () => {
    expect((await postReq(reasonBody(), 'nope')).status).toBe(400);
    expect(order).toEqual(['getUser', 'isAdmin']);
  });
});

describe('POST: prepare (§5.2)', () => {
  it('T-9 / T-10: the path target and the SESSION admin; ready is 200 with no link; throttled on the create rule', async () => {
    const response = await postReq(reasonBody());
    expect(response.status).toBe(200);
    expect(mockStartForAdmin).toHaveBeenCalledWith(TARGET, ADMIN.id);
    expect(mockIdentity).toHaveBeenCalledWith(TARGET);
    const [input, , ] = mockRunZipExport.mock.calls[0] as [{ ctx: { userId: string; authUser: { id: string; email: string | null } }; jobId: string }];
    expect(input.ctx).toEqual({ userId: TARGET, authUser: { id: TARGET, email: EMAIL, created_at: '2026-01-01T00:00:00.000Z' } });
    expect(input.jobId).toBe(JOB);
    const body = await response.json();
    expect(body.data).toEqual({
      jobId: JOB,
      expiresAt: READY.job.expires_at,
      bytes: 2048,
      fileCount: 3,
      rowCount: 40,
      failedSections: [],
      missingFiles: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/downloadUrl|fileName|https?:/);
    expect(mockRateLimit.mock.calls[0][1]).toBe('admin-data-export-start');
    expect(mockRateLimit.mock.calls[0][2]).toEqual({ limit: 10, failureLimit: 10, windowSeconds: 900 });
    expect(order).toEqual([
      'getUser', 'isAdmin', 'rateLimit', 'findUserIdentity', 'startForAdmin', 'audit.log', 'runZipExport', 'logAndFlush', 'audit.log',
    ]);
  });

  it('T-10 (SA-10): the route cannot mint a link: it does not import the storage repository or sign', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/admin/users/[id]/data-exports/route.ts'), 'utf8');
    expect(source).not.toMatch(/StorageRepository|\.sign\(|markOwnerDownloaded/);
  });

  it('T-8 (BC-6): the admin own account is 403 own_account; nothing is started', async () => {
    const response = await postReq(reasonBody(), ADMIN.id.toUpperCase());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'own_account' });
    expect(mockIdentity).not.toHaveBeenCalled();
    expect(mockStartForAdmin).not.toHaveBeenCalled();
  });

  it('T-11: no such account is 404; an identity error or no created_at is 500 (never 404)', async () => {
    mockIdentity.mockResolvedValueOnce({ data: null, error: null });
    expect((await postReq(reasonBody())).status).toBe(404);
    mockIdentity.mockResolvedValueOnce({ data: null, error: new Error('auth down') });
    const failed = await postReq(reasonBody());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: 'identity_read_failed' });
    mockIdentity.mockResolvedValueOnce({ data: { id: TARGET, email: EMAIL, createdAt: null }, error: null });
    expect((await postReq(reasonBody())).status).toBe(500);
    expect(mockStartForAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['in_progress', 'export_in_progress'],
    ['daily_limit', 'export_daily_limit'],
  ])('T-9 / T-21 (DX-4): the account %s is 409 %s with retryAt; nothing built, nothing audited', async (outcome, code) => {
    mockStartForAdmin.mockResolvedValueOnce({ data: { outcome, retryAt: '2026-10-18T06:30:00.000Z' }, error: null });
    const response = await postReq(reasonBody());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code, retryAt: '2026-10-18T06:30:00.000Z' });
    expect(mockRunZipExport).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('a start error is a 500', async () => {
    mockStartForAdmin.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect((await postReq(reasonBody())).status).toBe(500);
    expect(mockRunZipExport).not.toHaveBeenCalled();
  });

  it.each([
    ['over_ceiling', 413, 'export_too_large'],
    ['timeout', 503, 'export_timeout'],
    ['error', 500, 'export_failed'],
  ])('T-11: a %s build is %i %s, with an admin-owned FAILED row', async (reason, status, code) => {
    mockRunZipExport.mockResolvedValueOnce({ kind: reason === 'over_ceiling' ? 'refused' : 'failed', reason, measured: { fileCount: 200 }, over: ['fileCount'], durationMs: 9 });
    const response = await postReq(reasonBody());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    const failed = mockLogAndFlush.mock.calls[0][0] as AuditLogInput;
    expect(failed).toMatchObject({ action: 'DATA_EXPORT_FAILED', userId: ADMIN.id, actorId: ADMIN.id, entityId: TARGET });
    expect(failed.details).toMatchObject({ job_id: JOB, reason, file_count: 200, target_user_id: TARGET });
  });

  it('a throw is a 500 without details outside development', async () => {
    mockRunZipExport.mockRejectedValueOnce(new Error('internal secret'));
    const response = await postReq(reasonBody());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('internal secret');
  });
});

describe('T-14 placement of every row the route writes (SA-1, SA-3, W10-4)', () => {
  it('requested, ready and replaced on a ready run; failed on a failed run: all admin-owned, the target as entity', async () => {
    await postReq(reasonBody());
    mockRunZipExport.mockResolvedValueOnce({ kind: 'failed', reason: 'error', measured: {}, over: [], durationMs: 1 });
    await postReq(reasonBody());
    const inputs = auditInputs();
    expect(inputs.map((entry) => entry.action).sort()).toEqual(
      ['DATA_EXPORT_EXPIRED', 'DATA_EXPORT_FAILED', 'DATA_EXPORT_READY', 'DATA_EXPORT_REQUESTED', 'DATA_EXPORT_REQUESTED'].sort()
    );
    for (const entry of inputs) {
      expect({ action: entry.action, userId: entry.userId, actorId: entry.actorId, entityId: entry.entityId }).toEqual({
        action: entry.action,
        userId: ADMIN.id,
        actorId: ADMIN.id,
        entityId: TARGET,
      });
      expect(entry.userId).not.toBe(TARGET);
      expect((entry.details as Record<string, unknown>).target_user_id).toBe(TARGET);
    }
    const requested = inputs.find((entry) => entry.action === 'DATA_EXPORT_REQUESTED');
    expect(requested?.details).toMatchObject({ reason: REASON, requested_by_kind: 'admin', job_id: JOB });
    const replaced = inputs.find((entry) => entry.action === 'DATA_EXPORT_EXPIRED');
    expect(replaced?.details).toMatchObject({ job_id: OLD, reason: 'replaced' });
  });

  it('the route builds no audit input inline: every one comes from adminExportAudit.ts (source pin)', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/admin/users/[id]/data-exports/route.ts'), 'utf8');
    expect(source).toContain("from '@/lib/business-os/data-export/adminExportAudit'");
    expect(source).not.toMatch(/action:\s*AUDIT_EVENTS|entityType:|AUDIT_EVENTS/);
    expect(source).not.toContain('audit_trail');
  });

  it('W10-5: no log line or audit row carries the email or the business name', async () => {
    await postReq(reasonBody());
    await getReq();
    const text = JSON.stringify([logged, mockAuditLog.mock.calls, mockLogAndFlush.mock.calls.map((call) => call[0])]);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(ADMIN.email);
    expect(text).not.toContain('Planted Bakery Name');
  });
});
