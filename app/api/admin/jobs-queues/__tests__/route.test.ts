/**
 * GET /api/admin/jobs-queues (admin reorganisation slice 5; SA SC-10).
 *
 * The gate first (401/403 beat 400, and no read on any denial), strict Zod,
 * per-group isolation, "not installed", and the leak check on the serialised
 * body and every logger argument, with marker strings planted in the mocks.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
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

function req(query = '') {
  return new NextRequest(`http://localhost/api/admin/jobs-queues${query}`, {
    headers: { 'x-correlation-id': 'corr-jobs' },
  });
}

type Body = {
  success: boolean;
  error?: string;
  details?: string;
  data?: {
    runsRead: string;
    runsReadMessage: string | null;
    jobs: Array<{ id: string; status: string }>;
    queues: Array<{ id: string; status: string; figures: Record<string, unknown> | null }>;
  };
};
const json = async (res: Response) => (await res.json()) as Body;
const reads = () => [mockCronSummary, mockQueueFigures];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockCronSummary.mockImplementation(async (_c: unknown, _jobs: unknown, now: Date) => ({ data: quietSummaryRows(now), error: null }));
  mockQueueFigures.mockResolvedValue({ data: quietQueueFigures(), error: null });
});

describe('the gate, and nothing before it', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('401 when the auth lookup throws', async () => {
    mockGetUser.mockRejectedValue(new Error('supabase down'));
    expect((await GET(req())).status).toBe(401);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('403 when signed in but not an admin, with no read', async () => {
    mockIsAdmin.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('403 when the admin check throws (fail closed)', async () => {
    mockIsAdmin.mockRejectedValue(new Error('boom'));
    expect((await GET(req())).status).toBe(403);
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });
});

describe('strict Zod', () => {
  it('400 on any parameter, fixed message, no read', async () => {
    const res = await GET(req('?cacheBust=1'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('This endpoint takes no parameters');
    for (const r of reads()) expect(r).not.toHaveBeenCalled();
  });

  it('401 and 403 still win over 400', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await GET(req('?x=1'))).status).toBe(401);
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockResolvedValue(false);
    expect((await GET(req('?x=1'))).status).toBe(403);
  });
});

describe('happy path', () => {
  it('12 jobs healthy and 5 queues clear, read with the admin context', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data!.jobs).toHaveLength(12);
    expect(body.data!.queues).toHaveLength(5);
    expect(body.data!.jobs.every((j) => j.status === 'healthy')).toBe(true);
    expect(body.data!.queues.every((q) => q.status === 'clear')).toBe(true);
    expect(mockCronSummary.mock.calls[0][0]).toEqual({ correlationId: 'corr-jobs', adminId: ADMIN.id });
    expect(mockQueueFigures.mock.calls[0][0]).toEqual({ correlationId: 'corr-jobs', adminId: ADMIN.id });
    const served = mockLog.info.mock.calls.find(([, msg]) => msg === 'Jobs and queues served');
    expect(served?.[0]).toMatchObject({ adminUserId: ADMIN.id, runsRead: 'ok' });
  });
});

describe('failure isolation', () => {
  it('the run record not installed: 200, jobs "Could not check" with the fixed sentence, queues measured', async () => {
    mockCronSummary.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code: 'PGRST202' }) });
    const body = await json(await GET(req()));
    expect(body.data!.runsRead).toBe('not_installed');
    expect(body.data!.runsReadMessage).toBe('Could not check: run recording is not installed yet.');
    expect(body.data!.jobs.every((j) => j.status === 'could_not_check')).toBe(true);
    expect(body.data!.queues.every((q) => q.status === 'clear')).toBe(true);
  });

  it('one queue failing makes only that queue "Could not check"', async () => {
    mockQueueFigures.mockImplementation(async (_c: unknown, queue: string) =>
      queue === 'insight_actions' ? { data: null, error: new Error('relation "secret_table" does not exist') } : { data: quietQueueFigures(), error: null }
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data!.queues.find((q) => q.id === 'insight_actions')?.status).toBe('could_not_check');
    expect(body.data!.queues.filter((q) => q.status === 'clear')).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain('secret_table');
  });
});

describe('SC-10: nothing leaks', () => {
  const PLANTED = ['a@b.c', 'dead-letter: max attempts', 'payload-secret', 'Dear Dana', 'skip-reason-secret'];

  it('the body and every log argument carry no planted owner text, message or marker', async () => {
    // Plant markers everywhere a careless mapping could carry them through.
    mockCronSummary.mockImplementation(async (_c: unknown, _jobs: unknown, now: Date) => ({
      data: quietSummaryRows(now).map((row) => ({
        ...row,
        error_message: 'a@b.c',
        payload: 'payload-secret',
        recent: row.recent.map((run) => ({ ...run, error_message: 'dead-letter: max attempts', note: 'Dear Dana' })),
      })),
      error: null,
    }));
    mockQueueFigures.mockResolvedValue({
      data: { ...quietQueueFigures(), skip_reason: 'skip-reason-secret', recommendation: 'Dear Dana' },
      error: null,
    });
    const res = await GET(req());
    const text = JSON.stringify(await json(res));
    for (const marker of PLANTED) expect(text).not.toContain(marker);
    const logged = JSON.stringify([...mockLog.info.mock.calls, ...mockLog.warn.mock.calls, ...mockLog.error.mock.calls]);
    for (const marker of PLANTED) expect(logged).not.toContain(marker);
    expect(text).not.toMatch(/payload|recommendation|error_message|skip_reason/);
  });

  it('500 on an unexpected throw, with no details in production', async () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    mockLog.info.mockImplementationOnce(() => {
      throw new Error('internal detail');
    });
    try {
      const res = await GET(req());
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.error).toBe('Could not build the jobs and queues view');
      expect(body.details).toBeUndefined();
    } finally {
      env.NODE_ENV = original;
    }
  });
});
