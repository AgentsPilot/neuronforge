/**
 * QA: GET /api/cron/bos-plan-cancel-reminders (account deletion lifecycle D4b /
 * SX-3 part 2; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * D4b addendum R-A, R-B; §13 QA report).
 *
 * Dev shipped no route test (the pass test reads `maxDuration` from source).
 * This pins, through the REAL route with the run and its wiring faked:
 *   - fail-closed `CRON_SECRET`: missing / wrong / unschemed / lower-case /
 *     empty secret → 401 and NOTHING runs (no deps built, no pass run);
 *   - production with `CRON_SECRET` unset → 401 and an `error` log;
 *   - an authorised call runs the pass once on a 45 s deadline and answers
 *     counts only; a defect throw → 500 with no details;
 *   - `runtime = 'nodejs'`, `maxDuration = 60`, `withCronRunRecord` with the
 *     job id, `vercel.json` "53 5 * * *", one registry entry.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const SECRET = 'plan-reminder-qa-secret';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV, CRON_SECRET: env.CRON_SECRET };

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec =
      (level: string) =>
      (...args: unknown[]) =>
        logged.push({ level, args });
    const logger: Record<string, unknown> = { info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockBuildDeps = jest.fn((_logger: unknown) => ({ fake: 'deps' }));
jest.mock('@/lib/business-os/billing/planCancelReminderPassDeps', () => ({
  buildPlanCancelReminderDeps: (logger: unknown) => mockBuildDeps(logger),
}));

const mockRun = jest.fn();
jest.mock('@/lib/business-os/billing/planCancelReminderPass', () => ({
  ...jest.requireActual('@/lib/business-os/billing/planCancelReminderPass'),
  runPlanCancelReminderPass: (...args: unknown[]) => mockRun(...args),
}));

import * as route from '@/app/api/cron/bos-plan-cancel-reminders/route';
import { BOS_CRON_JOBS, findBosCronJob } from '@/lib/cron/bosCronJobs';

const ROOT = process.cwd();

function request(authorization: string | null) {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return new NextRequest('http://localhost/api/cron/bos-plan-cancel-reminders', { headers });
}

const COUNTS = {
  examined: 2,
  sent: 1,
  notSent: 0,
  notCancelling: 1,
  periodMismatch: 0,
  mismatch: 0,
  covered: 0,
  deferred: 0,
  deadlineHit: 0,
  skipped: 0,
};

beforeEach(() => {
  env.NODE_ENV = 'production';
  env.VERCEL_ENV = 'preview'; // the recorder records only real Vercel production calls
  env.CRON_SECRET = SECRET;
  logged.length = 0;
  mockBuildDeps.mockClear();
  mockRun.mockReset();
  mockRun.mockResolvedValue(COUNTS);
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.VERCEL_ENV = saved.VERCEL_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe('QA: fail-closed cron auth', () => {
  it.each([
    ['no authorization header', null],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['the secret without Bearer', SECRET],
    ['a lower-case bearer scheme', `bearer ${SECRET}`],
    // (A trailing space is not a case: the Fetch Headers API trims header values before the route sees them.)
    ['the secret with a suffix', `Bearer ${SECRET}x`],
    ['a prefix of the secret', `Bearer ${SECRET.slice(0, -1)}`],
  ])('%s → 401, no deps built, the run never starts', async (_label, authorization) => {
    const response = await route.GET(request(authorization));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockBuildDeps).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('production with CRON_SECRET UNSET refuses every call (401), logs an error, nothing runs', async () => {
    delete env.CRON_SECRET;
    for (const authorization of ['Bearer undefined', 'Bearer ', null, `Bearer ${SECRET}`]) {
      expect((await route.GET(request(authorization))).status).toBe(401);
    }
    expect(mockRun).not.toHaveBeenCalled();
    expect(logged.some((entry) => entry.level === 'error' && String(entry.args[0]).includes('CRON_SECRET not configured'))).toBe(true);
  });

  it('production with an EMPTY CRON_SECRET refuses "Bearer " and everything else', async () => {
    env.CRON_SECRET = '';
    for (const authorization of ['Bearer ', 'Bearer', 'Bearer undefined', 'Bearer null', null]) {
      expect((await route.GET(request(authorization))).status).toBe(401);
    }
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('a non-production, non-development NODE_ENV (test) still requires the secret', async () => {
    env.NODE_ENV = 'test';
    expect((await route.GET(request(null))).status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('QA: an authorised run', () => {
  it('runs the pass once, on a 45 s deadline, with the correlation id, and answers counts only', async () => {
    const before = Date.now();
    const response = await route.GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: Record<string, number>; duration_ms: number };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(COUNTS);
    expect(Object.keys(body).sort()).toEqual(['data', 'duration_ms', 'success']);
    expect(mockRun).toHaveBeenCalledTimes(1);
    const [deps, context] = mockRun.mock.calls[0] as [unknown, { deadlineAt: number; correlationId: string }];
    expect(deps).toEqual({ fake: 'deps' });
    expect(context.deadlineAt - before).toBeGreaterThanOrEqual(45_000);
    expect(context.deadlineAt - Date.now()).toBeLessThanOrEqual(45_000);
    expect(typeof context.correlationId).toBe('string');
    expect(context.correlationId.length).toBeGreaterThan(0);
  });

  it('a defect throw from the run → 500, generic message, no details, logged', async () => {
    mockRun.mockRejectedValueOnce(new Error('secret internal detail'));
    const response = await route.GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
  });

  it('local development runs without a secret (manual trigger, copied from the reconcile shell)', async () => {
    env.NODE_ENV = 'development';
    delete env.CRON_SECRET;
    expect((await route.GET(request(null))).status).toBe(200);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});

describe('QA: the route shape and its registrations', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'cron', 'bos-plan-cancel-reminders', 'route.ts'), 'utf8');

  it('runtime nodejs, maxDuration 60', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBe(60);
  });

  it('GET is wrapped by withCronRunRecord with its own job id, and exports nothing else callable', () => {
    expect(src).toMatch(/export const GET = withCronRunRecord\('bos-plan-cancel-reminders', runJob\);/);
    expect(src).not.toMatch(/export (async )?function (POST|PUT|DELETE|PATCH)|export const (POST|PUT|DELETE|PATCH)/);
    expect(src).not.toMatch(/console\./);
  });

  it('vercel.json schedules it once at "53 5 * * *", and the registry has exactly one matching entry', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    const entries = vercel.crons.filter((c) => c.path === '/api/cron/bos-plan-cancel-reminders');
    expect(entries).toEqual([{ path: '/api/cron/bos-plan-cancel-reminders', schedule: '53 5 * * *' }]);
    expect(vercel.crons.filter((c) => c.schedule.startsWith('53 ')).length).toBe(1);
    const job = findBosCronJob('bos-plan-cancel-reminders');
    expect(job).toMatchObject({ path: '/api/cron/bos-plan-cancel-reminders', schedule: '53 5 * * *', drainsQueue: null });
    expect(BOS_CRON_JOBS.filter((j) => j.id === 'bos-plan-cancel-reminders')).toHaveLength(1);
  });
});
