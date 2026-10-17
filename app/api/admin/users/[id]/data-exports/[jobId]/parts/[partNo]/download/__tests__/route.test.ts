/**
 * POST /api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download
 * (data export DE-10a, workplan §5.3, §9 T-1 ... T-8, T-12, T-13, T-14;
 * SA-5, SA-7, SA-11, W10-1, W10-2, W10-3, W10-5, W10-9).
 *
 * The gate is REAL over a mocked `getUser` and admin check. Every effect is
 * recorded in ONE ordered log, so the fixed order of W10-3 (gate, path, body,
 * throttle, own account, job read, the write-ahead audit, the name, the
 * signature) is a single assertion, and the 503 branch proves nothing was
 * signed. The audit input comes from the real builder module.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

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
const mockFindById = jest.fn();
const mockMarkOwnerDownloaded = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  businessOsDataExportJobRepository: {
    findById: (...a: unknown[]) => (order.push('findById'), mockFindById(...a)),
    markOwnerDownloaded: (...a: unknown[]) => (order.push('markOwnerDownloaded'), mockMarkOwnerDownloaded(...a)),
  },
}));
const mockSign = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportStorageRepository', () => ({
  businessOsDataExportStorageRepository: { sign: (...a: unknown[]) => (order.push('sign'), mockSign(...a)) },
}));
const mockNames = jest.fn();
jest.mock('@/lib/business-os/data-export/downloadName', () => ({
  exportDownloadNames: (...a: unknown[]) => (order.push('names'), mockNames(...a)),
}));
const mockWriteNow = jest.fn();
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ writeNow: (...a: unknown[]) => (order.push('writeNow'), mockWriteNow(...a)) }) },
  AuditTrail: { log: (...a: unknown[]) => (order.push('audit.log'), mockAuditLog(...a)) },
}));

import { POST } from '../route';
import type { AuditLogInput } from '@/lib/audit/types';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: 'cccccccc-2222-4222-8222-222222222222', email: 'customer@example.com' };
const TARGET_UPPER = 'ABCDEF99-9999-4999-8999-99999999999F';
const TARGET = TARGET_UPPER.toLowerCase();
const OTHER = 'bbbbbbbb-3333-4333-8333-333333333333';
const JOB = 'dddddddd-4444-4444-8444-444444444444';
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/p/1.zip?token=SECRET-TOKEN';
const FILE = 'planted-bakery-data-export-2026-10-17-0930.zip';
const REASON = 'Hand over before the account is deleted';

const READY_JOB = {
  id: JOB,
  user_id: TARGET,
  requested_by: TARGET,
  requested_by_kind: 'owner',
  status: 'ready',
  created_at: '2026-10-17T06:30:00.000Z',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  owner_downloaded_at: null,
};

const call = (opts: { id?: string; jobId?: string; partNo?: string; body?: string } = {}) => {
  const id = opts.id ?? TARGET_UPPER;
  const jobId = opts.jobId ?? JOB;
  const partNo = opts.partNo ?? '1';
  const body = 'body' in opts ? opts.body : JSON.stringify({ reason: REASON });
  return POST(
    new NextRequest(`http://localhost/api/admin/users/${id}/data-exports/${jobId}/parts/${partNo}/download`, {
      method: 'POST',
      ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
    }),
    { params: { id, jobId, partNo } }
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  logged.length = 0;
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockFindById.mockResolvedValue({ data: READY_JOB, error: null });
  mockWriteNow.mockResolvedValue({ written: true });
  mockNames.mockResolvedValue({ fileName: FILE, asciiFileName: FILE });
  mockSign.mockResolvedValue({ data: SIGNED, error: null });
});

describe('T-12 / W10-3: the fixed order, audit before the link', () => {
  it('200: gate, throttle, job read, write-ahead row, name, 60 s link, in exactly that order', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(order).toEqual(['getUser', 'isAdmin', 'rateLimit', 'findById', 'writeNow', 'names', 'sign']);
    expect(await response.json()).toEqual({
      success: true,
      data: { downloadUrl: SIGNED, fileName: FILE, asciiFileName: FILE, expiresAt: READY_JOB.expires_at, linkSeconds: 60 },
    });
    expect(mockFindById).toHaveBeenCalledWith(JOB, TARGET);
    expect(mockNames).toHaveBeenCalledWith(TARGET, READY_JOB.created_at, expect.anything());
    expect(mockSign).toHaveBeenCalledWith(TARGET, JOB, 60, FILE);
  });

  it('SA-11: throttled on the WRITE rule, under its own key', async () => {
    await call();
    expect(mockRateLimit.mock.calls[0][1]).toBe('admin-data-export-download');
    expect(mockRateLimit.mock.calls[0][2]).toEqual({ limit: 20, failureLimit: 10, windowSeconds: 300 });
    mockRateLimit.mockResolvedValueOnce({ allowed: false, hits: 21, degraded: false });
    expect((await call()).status).toBe(429);
  });

  it('the row: DATA_EXPORT_DOWNLOADED_BY_ADMIN, critical (W10-9), admin-owned, the target as entity, the reason and the job kind', async () => {
    await call();
    expect(mockWriteNow).toHaveBeenCalledTimes(1);
    const entry = mockWriteNow.mock.calls[0][0] as AuditLogInput;
    expect(entry).toMatchObject({
      action: 'DATA_EXPORT_DOWNLOADED_BY_ADMIN',
      severity: 'critical',
      complianceFlags: ['GDPR', 'SOC2'],
      entityType: 'user',
      entityId: TARGET,
      userId: ADMIN.id,
      actorId: ADMIN.id,
    });
    expect(entry.details).toMatchObject({ job_id: JOB, part_no: 1, requested_by_kind: 'owner', reason: REASON, target_user_id: TARGET, surface: 'admin' });
    expect(entry.userId).not.toBe(TARGET);
  });

  it.each([
    ['not written', () => mockWriteNow.mockResolvedValueOnce({ written: false })],
    ['a throw', () => mockWriteNow.mockRejectedValueOnce(new Error('db down'))],
  ])('the audit %s is 503 audit_unavailable and NOTHING is signed', async (_label, arrange) => {
    arrange();
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'audit_unavailable' });
    expect(order).toEqual(['getUser', 'isAdmin', 'rateLimit', 'findById', 'writeNow']);
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockNames).not.toHaveBeenCalled();
  });

  it('SA-7: a signing failure after the row was written is a 500, with no second row', async () => {
    mockSign.mockResolvedValueOnce({ data: null, error: new Error('storage down') });
    const response = await call();
    expect(response.status).toBe(500);
    expect(mockWriteNow).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).not.toHaveBeenCalled();
    const failure = logged.find((args) => String(args[1]).includes('link could not be made'));
    expect(failure?.[0]).toMatchObject({ targetUserId: TARGET, jobId: JOB });
  });

  it('BC-2: an admin-prepared job is downloadable the same way, its kind in the row', async () => {
    mockFindById.mockResolvedValueOnce({ data: { ...READY_JOB, requested_by: OTHER, requested_by_kind: 'admin' }, error: null });
    expect((await call()).status).toBe(200);
    expect((mockWriteNow.mock.calls[0][0] as AuditLogInput).details).toMatchObject({ requested_by_kind: 'admin' });
  });
});

describe('T-6 tenant isolation and T-13 not ready', () => {
  it("another account's job on this path is 404: read scoped by the PATH account, no audit, no sign", async () => {
    mockFindById.mockResolvedValueOnce({ data: null, error: null });
    const response = await call();
    expect(response.status).toBe(404);
    expect(mockFindById).toHaveBeenCalledWith(JOB, TARGET);
    expect(mockWriteNow).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('a job read error is a 500; nothing written or signed', async () => {
    mockFindById.mockResolvedValueOnce({ data: null, error: new Error('down') });
    expect((await call()).status).toBe(500);
    expect(mockWriteNow).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { ...READY_JOB, status: 'expired' }],
    ['running', { ...READY_JOB, status: 'running' }],
    ['failed', { ...READY_JOB, status: 'failed' }],
    ['past expires_at', { ...READY_JOB, expires_at: new Date(Date.now() - 1000).toISOString() }],
    ['no expires_at', { ...READY_JOB, expires_at: null }],
  ])('%s is 410 export_expired; no audit, no sign', async (_label, job) => {
    mockFindById.mockResolvedValueOnce({ data: job, error: null });
    const response = await call();
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'export_expired' });
    expect(mockWriteNow).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
  });
});

describe('T-1 ... T-8 the gate and the input (W10-1, W10-2)', () => {
  it('signed out is 401 and nothing else ran', async () => {
    mockGetUser.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    expect(order).toEqual(['getUser']);
  });

  it('a signed-in non-admin is 403 and nothing else ran', async () => {
    mockGetUser.mockResolvedValueOnce(CUSTOMER);
    mockIsAdmin.mockResolvedValueOnce(false);
    expect((await call()).status).toBe(403);
    expect(order).toEqual(['getUser', 'isAdmin']);
  });

  it.each([
    ['a target that is not a uuid', { id: 'nope' }],
    ['a job id that is not a uuid', { jobId: '../1' }],
    ['part 2', { partNo: '2' }],
    ['part 0', { partNo: '0' }],
    ['no body', { body: undefined }],
    ['an empty object', { body: '{}' }],
    ['a short reason', { body: JSON.stringify({ reason: 'abcd' }) }],
    ['a blank reason', { body: JSON.stringify({ reason: '      ' }) }],
    ['a long reason', { body: JSON.stringify({ reason: 'x'.repeat(501) }) }],
    ['malformed JSON', { body: '{"reason":' }],
    ['an injected userId (T-7)', { body: JSON.stringify({ reason: REASON, userId: OTHER }) }],
    ['an injected jobId', { body: JSON.stringify({ reason: REASON, jobId: JOB }) }],
  ])('%s is 400 before the throttle, any read, write or sign', async (_label, opts) => {
    expect((await call(opts)).status).toBe(400);
    expect(order).toEqual(['getUser', 'isAdmin']);
  });

  it('T-8 (BC-6): the admin own account is 403 own_account; nothing read, written or signed', async () => {
    const response = await call({ id: ADMIN.id.toUpperCase() });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'own_account' });
    expect(order).toEqual(['getUser', 'isAdmin', 'rateLimit']);
  });
});

describe('SA-5 / W10-3 / W10-5 source and records', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download/route.ts'),
    'utf8'
  ).replace(/\r\n/g, '\n');

  it("the admin route never names the owner's download marker, comments included (source pin)", () => {
    expect(source).not.toContain('markOwnerDownloaded');
    expect(mockMarkOwnerDownloaded).not.toHaveBeenCalled();
  });

  it('requireAdmin is the first statement; the audit input comes only from the builder', () => {
    const at = source.indexOf('export async function POST(');
    const bodyStart = source.indexOf('{\n', source.indexOf(')', at)) + 2;
    expect(source.slice(bodyStart).trimStart().startsWith('const gate = await requireAdmin(')).toBe(true);
    expect(source).toContain("from '@/lib/business-os/data-export/adminExportAudit'");
    expect(source).not.toMatch(/AUDIT_EVENTS|entityType:|audit_trail|AdminAccessService|profiles\.role/);
  });

  it('the write-ahead call comes before the sign call in the source too', () => {
    expect(source.indexOf('.writeNow(')).toBeGreaterThan(0);
    expect(source.indexOf('.writeNow(')).toBeLessThan(source.indexOf('.sign('));
  });

  it('W10-5: the URL, its token, the file name and any email reach no log and no audit row', async () => {
    await call();
    mockSign.mockResolvedValueOnce({ data: null, error: new Error('x') });
    await call();
    mockWriteNow.mockResolvedValueOnce({ written: false });
    await call();
    const text = JSON.stringify([logged, mockWriteNow.mock.calls.map((c) => ({ ...(c[0] as AuditLogInput), request: undefined })), mockAuditLog.mock.calls]);
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('supabase.co');
    expect(text).not.toContain(FILE);
    expect(text).not.toContain('1.zip');
    expect(text).not.toContain(ADMIN.email);
  });
});
