/**
 * POST /api/business-os/data-exports (data export DE-8b, workplan §5.1; SA
 * C-1, C-3, C-7, C-8, C-12, Q-15). The builder (runZipExport) is mocked: its
 * own suite covers the build. This suite pins the route: identity, input,
 * throttle, start limit, outcome -> HTTP, audit, signing, and that neither
 * the signed URL nor the file name nor the business name reaches a log or an
 * audit entry.
 */
import { NextRequest } from 'next/server';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.com', created_at: '2026-01-01T00:00:00Z' };
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BUSINESS = 'סטודיו נוגה';
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/p/1.zip?token=SECRET-TOKEN&download=x';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  ...jest.requireActual('@/lib/security/rateLimit'),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

const mockStartForOwner = jest.fn();
const mockMarkOwnerDownloaded = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  businessOsDataExportJobRepository: {
    startForOwner: (...a: unknown[]) => mockStartForOwner(...a),
    markOwnerDownloaded: (...a: unknown[]) => mockMarkOwnerDownloaded(...a),
  },
}));

const mockSign = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportStorageRepository', () => ({
  businessOsDataExportStorageRepository: { sign: (...a: unknown[]) => mockSign(...a) },
}));

const mockRunZipExport = jest.fn();
jest.mock('@/lib/business-os/data-export/zipExport', () => ({ runZipExport: (...a: unknown[]) => mockRunZipExport(...a) }));
jest.mock('@/lib/business-os/data-export/zipExportDeps', () => ({ zipExportDeps: () => ({}) }));

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) } }));
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a) }));

jest.mock('@/lib/logger', () => {
  const calls: unknown[][] = [];
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => calls.push(args);
  logger.child = () => logger;
  return { createLogger: () => logger, __calls: calls };
});
const logCalls = (jest.requireMock('@/lib/logger') as { __calls: unknown[][] }).__calls;

import { POST } from '../route';
import { exportZipFileNames } from '@/lib/business-os/data-export/fileName';

const READY = {
  kind: 'ready',
  job: { id: JOB, user_id: USER.id, created_at: '2026-10-17T06:30:00.000Z', expires_at: '2026-10-20T06:30:05.000Z', status: 'ready' },
  businessName: BUSINESS,
  timezone: 'Asia/Jerusalem',
  sectionCounts: { clients: 4 },
  failedSections: ['invoices'],
  missingFiles: 1,
  filesIncluded: 2,
  sizes: { bytes: 1234, fileCount: 2, rowCount: 5 },
  ceilingUsePct: 7,
  durationMs: 900,
  replacedJobIds: [] as string[],
};

const post = (body?: string) =>
  POST(new NextRequest('http://localhost/api/business-os/data-exports', { method: 'POST', ...(body === undefined ? {} : { body }) }));

/** Everything any logger or audit call received, as text (SA C-3). */
const sideChannels = () => JSON.stringify([logCalls, mockAuditLog.mock.calls, mockLogAndFlush.mock.calls.map((c) => c[0])]);

beforeEach(() => {
  jest.clearAllMocks();
  logCalls.length = 0;
  mockGetUser.mockResolvedValue(USER);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockStartForOwner.mockResolvedValue({ data: { outcome: 'started', jobId: JOB }, error: null });
  mockRunZipExport.mockResolvedValue({ ...READY });
  mockSign.mockResolvedValue({ data: SIGNED, error: null });
  mockMarkOwnerDownloaded.mockResolvedValue({ data: true, error: null });
  mockAuditLog.mockResolvedValue(undefined);
  mockLogAndFlush.mockResolvedValue(undefined);
});

describe('200', () => {
  it('returns the URL and names, no-store; starts for the SESSION id only', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const names = exportZipFileNames(new Date(READY.job.created_at), 'Asia/Jerusalem', BUSINESS);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        jobId: JOB,
        downloadUrl: SIGNED,
        fileName: names.fileName,
        asciiFileName: names.asciiFileName,
        expiresAt: READY.job.expires_at,
        failedSections: ['invoices'],
        missingFiles: 1,
      },
    });
    expect(mockStartForOwner).toHaveBeenCalledWith(USER.id);
    expect(mockRunZipExport.mock.calls[0][0]).toMatchObject({ jobId: JOB, ctx: { userId: USER.id } });
    // C-8: the name is stamped from the job's created_at.
    expect(mockSign).toHaveBeenCalledWith(USER.id, JOB, 120, names.fileName);
    expect(mockMarkOwnerDownloaded).toHaveBeenCalledWith(JOB, USER.id);
  });

  it('writes REQUESTED (non-blocking) and READY (logAndFlush) with counts only', async () => {
    await post();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DATA_EXPORT_REQUESTED', userId: USER.id, details: { job_id: JOB, requested_by_kind: 'owner' } }));
    const ready = mockLogAndFlush.mock.calls[0][0];
    expect(ready).toMatchObject({
      action: 'DATA_EXPORT_READY',
      entityType: 'user',
      entityId: USER.id,
      details: { job_id: JOB, bytes: 1234, file_count: 2, row_count: 5, missing_files: 1, ceiling_use_pct: 7, format_version: 2, failed_sections: ['invoices'] },
    });
    expect(mockAuditLog.mock.calls.some((c) => (c[0] as { action: string }).action === 'DATA_EXPORTED')).toBe(false);
  });

  it('C-12: each replaced export gets DATA_EXPORT_EXPIRED with reason replaced', async () => {
    mockRunZipExport.mockResolvedValueOnce({ ...READY, replacedJobIds: [OLD] });
    await post();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DATA_EXPORT_EXPIRED', details: { job_id: OLD, reason: 'replaced' } }));
  });

  it('C-3: the signed URL, its token, the file names and the business name never reach a log or an audit entry', async () => {
    const response = await post();
    const body = await response.json();
    const text = sideChannels();
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('token=');
    expect(text).not.toContain(body.data.downloadUrl);
    expect(text).not.toContain(body.data.fileName);
    expect(text).not.toContain(body.data.asciiFileName);
    expect(text).not.toContain(BUSINESS);
    expect(text).not.toContain('סטודיו');
    expect(text).not.toContain(USER.email);
  });

  it('a missing body and {} are both accepted (C-7)', async () => {
    expect((await post()).status).toBe(200);
    expect((await post('{}')).status).toBe(200);
  });
});

describe('refusals', () => {
  it('401 without a session, and nothing else runs', async () => {
    mockGetUser.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    expect(mockStartForOwner).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it.each([[JSON.stringify({ userId: OTHER })], ['{"x":1}'], ['[]'], ['null'], ['not json']])('400 for body %s, and the start RPC is never called', async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(mockStartForOwner).not.toHaveBeenCalled();
  });

  it('429 from the throttle (the existing create rule, Q-15)', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, hits: 11, degraded: false });
    const response = await post();
    expect(response.status).toBe(429);
    expect(mockRateLimit.mock.calls[0][1]).toBe('data-export-start');
    expect(mockRateLimit.mock.calls[0][2]).toEqual({ limit: 10, failureLimit: 10, windowSeconds: 900 });
    expect(mockStartForOwner).not.toHaveBeenCalled();
  });

  it.each([
    ['in_progress', 'export_in_progress'],
    ['daily_limit', 'export_daily_limit'],
  ])('409 %s -> %s with retryAt', async (outcome, code) => {
    mockStartForOwner.mockResolvedValueOnce({ data: { outcome, retryAt: '2026-10-17T07:00:00Z' }, error: null });
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code, retryAt: '2026-10-17T07:00:00Z' });
    expect(mockRunZipExport).not.toHaveBeenCalled();
  });

  it('500 when the start cannot be read', async () => {
    mockStartForOwner.mockResolvedValueOnce({ data: null, error: new Error('down') });
    expect((await post()).status).toBe(500);
    expect(mockRunZipExport).not.toHaveBeenCalled();
  });
});

describe('build outcomes -> HTTP (failure audit via logAndFlush)', () => {
  const notReady = (kind: string, reason: string) => ({ kind, reason, measured: { fileCount: 151, fileBytes: 10, rows: 3 }, over: reason === 'over_ceiling' ? ['fileCount'] : [], durationMs: 5 });

  it('413 export_too_large, no downloadUrl, nothing signed', async () => {
    mockRunZipExport.mockResolvedValueOnce(notReady('refused', 'over_ceiling'));
    const response = await post();
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'export_too_large' });
    expect(body.error).toMatch(/40 MB/);
    expect(body.data).toBeUndefined();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockLogAndFlush.mock.calls[0][0]).toMatchObject({
      action: 'DATA_EXPORT_FAILED',
      severity: 'warning',
      details: { job_id: JOB, reason: 'over_ceiling', ceiling_over: ['fileCount'], file_count: 151, row_count: 3 },
    });
  });

  it('503 export_timeout', async () => {
    mockRunZipExport.mockResolvedValueOnce(notReady('failed', 'timeout'));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'export_timeout' });
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('500 export_failed', async () => {
    mockRunZipExport.mockResolvedValueOnce(notReady('failed', 'error'));
    expect((await post()).status).toBe(500);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('C-1: ready but signing fails -> 500 export_ready_sign_failed; READY still written, no download recorded', async () => {
    mockSign.mockResolvedValueOnce({ data: null, error: new Error('sign down') });
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'export_ready_sign_failed', jobId: JOB });
    expect(mockLogAndFlush.mock.calls[0][0]).toMatchObject({ action: 'DATA_EXPORT_READY' });
    expect(mockMarkOwnerDownloaded).not.toHaveBeenCalled();
  });

  it('an audit failure never fails the request', async () => {
    mockAuditLog.mockRejectedValue(new Error('audit down'));
    expect((await post()).status).toBe(200);
  });
});
