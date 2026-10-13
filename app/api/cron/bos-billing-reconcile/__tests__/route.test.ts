/**
 * GET /api/cron/bos-billing-reconcile (credits boost slice 4b.2; workplan §3.3).
 *
 *   - fail-closed `CRON_SECRET`: production with no secret refuses with 401 and
 *     an `error` log; a missing or wrong bearer refuses with 401; nothing runs;
 *   - the passes run in order on one 45 s deadline, and the response carries
 *     their counters flattened (counts only), plus passes run / failed;
 *   - the seam: a second pass runs after boost, and a pass that throws is
 *     counted without failing the run.
 *
 * The run record itself (start, finish, counts) is pinned for every job by
 * app/api/cron/__tests__/runRecord.adoption.test.ts.
 */

import { NextRequest } from 'next/server';

const SECRET = 'reconcile-test-secret';
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

type Pass = { name: string; run: (context: { deadlineAt: number; now: Date; trigger: string }) => Promise<Record<string, number>> };
const mockPasses: Pass[] = [];
jest.mock('@/lib/business-os/billing/reconcilePasses', () => ({
  get RECONCILE_PASSES() {
    return mockPasses;
  },
  RECONCILE_RUN_DEADLINE_MS: 45 * 1000,
}));

import * as route from '@/app/api/cron/bos-billing-reconcile/route';

function request(authorization: string | null) {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return new NextRequest('http://localhost/api/cron/bos-billing-reconcile', { headers });
}

beforeEach(() => {
  env.NODE_ENV = 'production';
  env.VERCEL_ENV = 'preview';
  env.CRON_SECRET = SECRET;
  logged.length = 0;
  mockPasses.length = 0;
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.VERCEL_ENV = saved.VERCEL_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe('fail-closed cron auth', () => {
  it.each([
    ['no authorization header', null],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['the secret without Bearer', SECRET],
  ])('%s → 401 and no pass runs', async (_name, authorization) => {
    const run = jest.fn(async () => ({ examined: 1 }));
    mockPasses.push({ name: 'boost', run });
    const response = await route.GET(request(authorization));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('production with NO CRON_SECRET refuses every call (401) and logs an error', async () => {
    delete env.CRON_SECRET;
    const run = jest.fn(async () => ({ examined: 1 }));
    mockPasses.push({ name: 'boost', run });
    const response = await route.GET(request('Bearer undefined'));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    expect(logged.some((entry) => entry.level === 'error' && String(entry.args[0]).includes('CRON_SECRET not configured'))).toBe(true);
  });

  it('QA R-4: an EMPTY CRON_SECRET in production refuses "Bearer " and everything else', async () => {
    env.CRON_SECRET = '';
    const run = jest.fn(async () => ({ examined: 1 }));
    mockPasses.push({ name: 'boost', run });
    for (const authorization of ['Bearer ', 'Bearer', 'Bearer undefined', 'Bearer null', null]) {
      expect((await route.GET(request(authorization))).status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('QA R-4: a lower-case "bearer" scheme is refused (401)', async () => {
    const run = jest.fn(async () => ({ examined: 1 }));
    mockPasses.push({ name: 'boost', run });
    expect((await route.GET(request(`bearer ${SECRET}`))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('local development runs without a secret (manual trigger)', async () => {
    env.NODE_ENV = 'development';
    delete env.CRON_SECRET;
    mockPasses.push({ name: 'boost', run: async () => ({ examined: 0 }) });
    expect((await route.GET(request(null))).status).toBe(200);
  });
});

describe('an authorised run', () => {
  it('runs the passes in order on one 45 s deadline and answers counts only, flattened', async () => {
    const order: string[] = [];
    const contexts: Array<{ deadlineAt: number; now: Date; trigger: string }> = [];
    mockPasses.push(
      {
        name: 'boost',
        run: async (context) => {
          order.push('boost');
          contexts.push(context);
          return { examined: 3, credited: 1 };
        },
      },
      {
        name: 'plan',
        run: async (context) => {
          order.push('plan');
          contexts.push(context);
          return { periodsApplied: 2 };
        },
      }
    );
    const before = Date.now();
    const response = await route.GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: Record<string, number>; duration_ms: number };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ boostExamined: 3, boostCredited: 1, planPeriodsApplied: 2, passesRun: 2, passesFailed: 0 });
    expect(order).toEqual(['boost', 'plan']);
    expect(contexts[0]).toBe(contexts[1]);
    expect(contexts[0].trigger).toBe('nightly');
    expect(contexts[0].deadlineAt - contexts[0].now.getTime()).toBe(45 * 1000);
    expect(contexts[0].now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('a pass that throws is counted; the next pass runs and the job still answers 200', async () => {
    const plan = jest.fn(async () => ({ periodsApplied: 0 }));
    mockPasses.push(
      {
        name: 'boost',
        run: async () => {
          throw new Error('defect');
        },
      },
      { name: 'plan', run: plan }
    );
    const response = await route.GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, number> };
    expect(body.data).toMatchObject({ passesRun: 2, passesFailed: 1 });
    expect(plan).toHaveBeenCalledTimes(1);
  });
});

describe('the route shape', () => {
  it('runs on Node with a 60 s limit, above the 45 s deadline', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBe(60);
  });
});
