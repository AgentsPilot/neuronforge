/**
 * QA probe (slice 5 PR-2, uncommitted): GET /api/admin/jobs-queues isolation
 * under a hung read, a generic failure, and parameter edge cases.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
const mockLogs: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...a: unknown[]) => mockLogs.push(a);
  logger.child = () => logger;
  return { createLogger: () => logger };
});
const mockCronSummary = jest.fn();
const mockQueueFigures = jest.fn();
jest.mock('@/lib/repositories/AdminJobsQueuesRepository', () => ({
  adminJobsQueuesRepository: {
    summariseCronRunsAllJobs: (...a: unknown[]) => mockCronSummary(...a),
    readQueueFiguresAllAccounts: (...a: unknown[]) => mockQueueFigures(...a),
  },
}));

import { GET } from '../route';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const req = (q = '') => new NextRequest(`http://localhost/api/admin/jobs-queues${q}`);

type View = {
  runsRead: string;
  runsReadMessage: string | null;
  jobs: Array<{ id: string; status: string }>;
  queues: Array<{ id: string; status: string; figures: unknown }>;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLogs.length = 0;
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockCronSummary.mockImplementation(async (_c: unknown, _j: unknown, now: Date) => ({ data: quietSummaryRows(now), error: null }));
  mockQueueFigures.mockResolvedValue({ data: quietQueueFigures(), error: null });
});

it('a generic run-summary failure: 200, jobs "Could not check" (read failed, NOT "not installed"), queues measured', async () => {
  mockCronSummary.mockResolvedValue({ data: null, error: Object.assign(new Error('connection reset for a@b.c'), { code: '08006' }) });
  const res = await GET(req());
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: View };
  expect(data.runsRead).toBe('failed');
  expect(data.runsReadMessage).toBe('Could not check: the run record could not be read just now.');
  expect(data.jobs.every((j) => j.status === 'could_not_check')).toBe(true);
  expect(data.queues.every((q) => q.status === 'clear')).toBe(true);
  expect(JSON.stringify(mockLogs)).not.toContain('a@b.c');
});

it('invalid RPC rows (a string where a count should be): the whole summary is refused, not half-used', async () => {
  mockCronSummary.mockImplementation(async (_c: unknown, _j: unknown, now: Date) => {
    const rows = quietSummaryRows(now) as unknown as Array<Record<string, unknown>>;
    rows[0] = { ...rows[0], runs_24h: 'lots' };
    return { data: rows, error: null };
  });
  const { data } = (await (await GET(req())).json()) as { data: View };
  expect(data.runsRead).toBe('failed');
});

it('a hung queue read: 200 after the 5 s deadline, only that queue "Could not check"', async () => {
  mockQueueFigures.mockImplementation(async (_c: unknown, queue: string) =>
    queue === 'lead_responses' ? new Promise(() => undefined) : { data: quietQueueFigures(), error: null }
  );
  const started = Date.now();
  const res = await GET(req());
  const ms = Date.now() - started;
  expect(res.status).toBe(200);
  expect(ms).toBeGreaterThanOrEqual(4900);
  expect(ms).toBeLessThan(6500);
  const { data } = (await res.json()) as { data: View };
  expect(data.queues.find((q) => q.id === 'lead_responses')!.status).toBe('could_not_check');
  expect(data.queues.filter((q) => q.id !== 'lead_responses').every((q) => q.status === 'clear')).toBe(true);
  expect(data.jobs.every((j) => j.status === 'healthy')).toBe(true);
}, 15000);

it('a hung run summary: 200, jobs "Could not check", queues measured', async () => {
  mockCronSummary.mockImplementation(() => new Promise(() => undefined));
  const res = await GET(req());
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: View };
  expect(data.runsRead).toBe('failed');
  expect(data.queues.every((q) => q.status === 'clear')).toBe(true);
}, 15000);

it.each(['?a=', '?a', '?=1', '?%20=1', '?success=true&data=1'])('parameter %s → 400, no read', async (q) => {
  const res = await GET(req(q));
  expect(res.status).toBe(400);
  expect(mockCronSummary).not.toHaveBeenCalled();
  expect(mockQueueFigures).not.toHaveBeenCalled();
});

it('a bare "?" carries no parameter → 200', async () => {
  expect((await GET(req('?'))).status).toBe(200);
});

it('non-admin with parameters and hung reads: 403 immediately, no read started', async () => {
  mockIsAdmin.mockResolvedValue(false);
  mockCronSummary.mockImplementation(() => new Promise(() => undefined));
  const started = Date.now();
  expect((await GET(req('?x=1'))).status).toBe(403);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(mockCronSummary).not.toHaveBeenCalled();
});
