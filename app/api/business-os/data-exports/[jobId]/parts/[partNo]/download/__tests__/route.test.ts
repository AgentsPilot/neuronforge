/**
 * POST /api/business-os/data-exports/[jobId]/parts/[partNo]/download
 * (data export DE-8b, workplan §5.2; SA C-3, C-7, C-8).
 */
import { NextRequest } from 'next/server';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.com', created_at: '2026-01-01T00:00:00Z' };
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/p/1.zip?token=SECRET-TOKEN';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  ...jest.requireActual('@/lib/security/rateLimit'),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));
const mockFindById = jest.fn();
const mockMarkOwnerDownloaded = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  businessOsDataExportJobRepository: {
    // DE-10a (SA-5): the route reads owner-requested jobs only.
    findOwnerJobById: (...a: unknown[]) => mockFindById(...a),
    markOwnerDownloaded: (...a: unknown[]) => mockMarkOwnerDownloaded(...a),
  },
}));
const mockSign = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportStorageRepository', () => ({
  businessOsDataExportStorageRepository: { sign: (...a: unknown[]) => mockSign(...a) },
}));
const mockFindCompanyName = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findCompanyName: (...a: unknown[]) => mockFindCompanyName(...a) },
}));
const mockOwnerTimezone = jest.fn();
jest.mock('@/lib/business-os/data-export/ownerClock', () => ({ ownerTimezone: (...a: unknown[]) => mockOwnerTimezone(...a) }));
const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) } }));
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

const READY_JOB = {
  id: JOB,
  user_id: USER.id,
  status: 'ready',
  created_at: '2026-10-17T06:30:00.000Z',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

const call = (jobId: string, partNo: string, body?: string) =>
  POST(new NextRequest(`http://localhost/api/business-os/data-exports/${jobId}/parts/${partNo}/download`, { method: 'POST', ...(body === undefined ? {} : { body }) }), {
    params: { jobId, partNo },
  });

beforeEach(() => {
  jest.clearAllMocks();
  logCalls.length = 0;
  mockGetUser.mockResolvedValue(USER);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockFindById.mockResolvedValue({ data: READY_JOB, error: null });
  mockSign.mockResolvedValue({ data: SIGNED, error: null });
  mockMarkOwnerDownloaded.mockResolvedValue({ data: false, error: null });
  mockFindCompanyName.mockResolvedValue({ data: 'Acme Studio', error: null });
  mockOwnerTimezone.mockResolvedValue('Asia/Jerusalem');
  mockAuditLog.mockResolvedValue(undefined);
});

it('200 for the owner ready job: the name from created_at + clock + business name read again (C-8)', async () => {
  const response = await call(JOB, '1');
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const names = exportZipFileNames(new Date(READY_JOB.created_at), 'Asia/Jerusalem', 'Acme Studio');
  expect(names.fileName).toBe('acme-studio-data-export-2026-10-17-0930.zip');
  expect(await response.json()).toEqual({
    success: true,
    data: { downloadUrl: SIGNED, fileName: names.fileName, asciiFileName: names.asciiFileName, expiresAt: READY_JOB.expires_at },
  });
  expect(mockFindById).toHaveBeenCalledWith(JOB, USER.id);
  expect(mockFindCompanyName).toHaveBeenCalledWith(USER.id);
  expect(mockSign).toHaveBeenCalledWith(USER.id, JOB, 120, names.fileName);
  expect(mockMarkOwnerDownloaded).toHaveBeenCalledWith(JOB, USER.id);
  expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DATA_EXPORT_DOWNLOADED', userId: USER.id, details: { job_id: JOB, part_no: 1 } }));
  expect(mockRateLimit.mock.calls[0][2]).toEqual({ limit: 120, failureLimit: 20, windowSeconds: 300 });
});

it('C-3: the URL, token, file name and business name never reach a log or the audit', async () => {
  await call(JOB, '1');
  mockFindCompanyName.mockResolvedValueOnce({ data: null, error: new Error('x') });
  await call(JOB, '1');
  const text = JSON.stringify([logCalls, mockAuditLog.mock.calls]);
  expect(text).not.toContain('SECRET-TOKEN');
  expect(text).not.toContain('acme-studio');
  expect(text).not.toContain('Acme Studio');
});

it('a foreign job id is a 404, exactly like a missing one (scoped by the session id)', async () => {
  mockFindById.mockResolvedValueOnce({ data: null, error: null });
  const response = await call(JOB, '1');
  expect(response.status).toBe(404);
  expect(mockFindById).toHaveBeenCalledWith(JOB, USER.id);
  expect(mockSign).not.toHaveBeenCalled();
});

it.each([
  ['expired status', { ...READY_JOB, status: 'expired' }],
  ['failed status', { ...READY_JOB, status: 'failed' }],
  ['past expires_at', { ...READY_JOB, expires_at: new Date(Date.now() - 1000).toISOString() }],
  ['no expires_at', { ...READY_JOB, expires_at: null }],
])('410 export_expired for %s', async (_label, job) => {
  mockFindById.mockResolvedValueOnce({ data: job, error: null });
  const response = await call(JOB, '1');
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code: 'export_expired' });
  expect(mockSign).not.toHaveBeenCalled();
  expect(mockMarkOwnerDownloaded).not.toHaveBeenCalled();
});

it.each([
  [JOB, '2', undefined],
  [JOB, '../1', undefined],
  [JOB, '0', undefined],
  ['not-a-uuid', '1', undefined],
  [JOB, '1', '{"userId":"x"}'],
  [JOB, '1', 'nope'],
])('400 for jobId %s partNo %s body %s; nothing is read', async (jobId, partNo, body) => {
  const response = await call(jobId, partNo, body);
  expect(response.status).toBe(400);
  expect(mockFindById).not.toHaveBeenCalled();
});

it('401 without a session', async () => {
  mockGetUser.mockResolvedValueOnce(null);
  expect((await call(JOB, '1')).status).toBe(401);
  expect(mockFindById).not.toHaveBeenCalled();
});

it('429 from the throttle', async () => {
  mockRateLimit.mockResolvedValueOnce({ allowed: false, hits: 121, degraded: false });
  expect((await call(JOB, '1')).status).toBe(429);
  expect(mockFindById).not.toHaveBeenCalled();
});

it('C-8: an unreadable business name gives the fallback name, never a failed download', async () => {
  mockFindCompanyName.mockResolvedValueOnce({ data: null, error: new Error('down') });
  const response = await call(JOB, '1');
  expect(response.status).toBe(200);
  expect((await response.json()).data.fileName).toBe('agentpilot-data-export-2026-10-17-0930.zip');
});

it('a signing failure is a 500 and records no download', async () => {
  mockSign.mockResolvedValueOnce({ data: null, error: new Error('down') });
  expect((await call(JOB, '1')).status).toBe(500);
  expect(mockMarkOwnerDownloaded).not.toHaveBeenCalled();
  expect(mockAuditLog).not.toHaveBeenCalled();
});

it('exports POST only (SA C-7: no GET with side effects)', async () => {
  const route = await import('../route');
  expect((route as Record<string, unknown>).GET).toBeUndefined();
});

describe('DE-10a (SA-5, T-17): an admin-prepared job is not the owner\'s to download', () => {
  it('the owner-only read answers null for an admin job: 404, no link, no download stamp, no audit', async () => {
    // findOwnerJobById filters requested_by_kind = 'owner' (pinned in the repository test).
    mockFindById.mockResolvedValueOnce({ data: null, error: null });
    const response = await call(JOB, '1');
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty('code');
    expect(mockFindById).toHaveBeenCalledWith(JOB, USER.id);
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockMarkOwnerDownloaded).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('the route reads through findOwnerJobById, never the kind-blind findById, and names the file through downloadName.ts (source pin)', () => {
    const { readFileSync } = jest.requireActual<typeof import('fs')>('fs');
    const { join } = jest.requireActual<typeof import('path')>('path');
    const source = readFileSync(join(process.cwd(), 'app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('businessOsDataExportJobRepository.findOwnerJobById(jobId, user.id)');
    expect(code).not.toMatch(/\.findById\(/);
    expect(code).toContain("from '@/lib/business-os/data-export/downloadName'");
    expect(code).not.toContain('findCompanyName');
  });
});
