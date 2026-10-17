/**
 * GET /api/business-os/data-exports: "Last export …" (data export DE-9,
 * workplan §3.1 / §6.2; SA DE-9 Q3, C-4). The repository is mocked; its own
 * suite pins the query (owner-requested, ready or expired, newest).
 *
 * Pinned here: the session id is the only account (a `?userId=` is ignored),
 * the three answer shapes, a job id only while the export can be downloaded,
 * no counts, no audit, the throttle, and no internal detail on a 500.
 */
import { NextRequest } from 'next/server';

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.com', created_at: '2026-01-01T00:00:00Z' };
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  ...jest.requireActual('@/lib/security/rateLimit'),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

const mockFindLatestCompleted = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  businessOsDataExportJobRepository: {
    findLatestCompletedForUser: (...a: unknown[]) => mockFindLatestCompleted(...a),
  },
}));
jest.mock('@/lib/repositories/BusinessOsDataExportStorageRepository', () => ({ businessOsDataExportStorageRepository: {} }));
jest.mock('@/lib/business-os/data-export/zipExport', () => ({ runZipExport: jest.fn() }));
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

import { GET } from '../route';

const HOUR = 3_600_000;
const job = (overrides: Record<string, unknown>) => ({
  id: JOB,
  user_id: USER.id,
  requested_by: USER.id,
  requested_by_kind: 'owner',
  status: 'ready',
  bytes: 1234,
  file_count: 2,
  row_count: 50,
  created_at: '2026-10-17T06:30:00.000Z',
  expires_at: new Date(Date.now() + 24 * HOUR).toISOString(),
  ...overrides,
});

const get = (query = '') => GET(new NextRequest(`http://localhost/api/business-os/data-exports${query}`));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockFindLatestCompleted.mockResolvedValue({ data: null, error: null });
});

describe('GET /api/business-os/data-exports: the three answers', () => {
  it('no completed export: lastExport null, no-store', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(await res.json()).toEqual({ success: true, data: { lastExport: null } });
    expect(mockFindLatestCompleted).toHaveBeenCalledWith(USER.id);
  });

  it('a ready export inside its 72 hours: createdAt + downloadable { jobId, expiresAt }, and no counts', async () => {
    const row = job({});
    mockFindLatestCompleted.mockResolvedValue({ data: row, error: null });
    const body = await (await get()).json();
    expect(body).toEqual({
      success: true,
      data: { lastExport: { createdAt: row.created_at, downloadable: { jobId: JOB, expiresAt: row.expires_at } } },
    });
    expect(JSON.stringify(body)).not.toMatch(/bytes|file_count|row_count|1234/);
  });

  it('an expired export: createdAt, downloadable null, no job id leaves the server', async () => {
    mockFindLatestCompleted.mockResolvedValue({ data: job({ status: 'expired', expires_at: '2026-10-01T00:00:00.000Z' }), error: null });
    const body = await (await get()).json();
    expect(body).toEqual({ success: true, data: { lastExport: { createdAt: '2026-10-17T06:30:00.000Z', downloadable: null } } });
    expect(JSON.stringify(body)).not.toContain(JOB);
  });

  it('a ready row past expires_at (the sweep has not run yet) is not downloadable', async () => {
    mockFindLatestCompleted.mockResolvedValue({ data: job({ expires_at: new Date(Date.now() - 1000).toISOString() }), error: null });
    expect((await (await get()).json()).data.lastExport.downloadable).toBeNull();
  });

  it('a ready row with no expires_at is not downloadable', async () => {
    mockFindLatestCompleted.mockResolvedValue({ data: job({ expires_at: null }), error: null });
    expect((await (await get()).json()).data.lastExport.downloadable).toBeNull();
  });

  it('writes no audit entry (a read of the owner\'s own status)', async () => {
    mockFindLatestCompleted.mockResolvedValue({ data: job({}), error: null });
    await get();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });
});

describe('GET /api/business-os/data-exports: identity, throttle, errors', () => {
  it('401 without a session, and the repository is never asked', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(mockFindLatestCompleted).not.toHaveBeenCalled();
  });

  it('a ?userId= of another account is ignored: the session id is the only one used', async () => {
    await get(`?userId=${OTHER}&user_id=${OTHER}`);
    expect(mockFindLatestCompleted).toHaveBeenCalledTimes(1);
    expect(mockFindLatestCompleted).toHaveBeenCalledWith(USER.id);
  });

  it('throttled: 429 with Retry-After, on the read rule under its own key', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 999, degraded: false });
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('300');
    expect(mockRateLimit.mock.calls[0][1]).toBe('data-export-status');
    expect(mockRateLimit.mock.calls[0][2]).toMatchObject({ limit: 120, windowSeconds: 300 });
    expect(mockFindLatestCompleted).not.toHaveBeenCalled();
  });

  it('a repository error: 500 with a plain message and no detail', async () => {
    mockFindLatestCompleted.mockResolvedValue({ data: null, error: new Error('relation secret_internal_name does not exist') });
    const res = await get();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('secret_internal_name');
  });

  it('an unexpected throw outside development: 500 with no detail', async () => {
    mockFindLatestCompleted.mockRejectedValue(new Error('internal stack detail'));
    const res = await get();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Internal server error' });
    expect(body.details).toBeUndefined();
  });
});
