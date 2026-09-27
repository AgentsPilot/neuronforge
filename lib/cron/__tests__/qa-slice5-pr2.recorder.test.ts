/**
 * QA probe (slice 5 PR-2, uncommitted): the recorder never changes a job's
 * behaviour, and a hung or failing record write costs at most one deadline.
 * Real timers, measured wall time.
 */

const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: (...a: unknown[]) => mockWarn(...a), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { NextRequest, NextResponse } from 'next/server';
import {
  RECORD_WRITE_DEADLINE_MS,
  extractCounts,
  resetCronRunRecorderState,
  withCronRunRecord,
} from '@/lib/cron/cronRunRecorder';
import { BOS_CRON_JOBS } from '@/lib/cron/bosCronJobs';

const SECRET = 'qa-recorder-secret';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV, CRON_SECRET: env.CRON_SECRET };

const hang = () => new Promise<never>(() => undefined);
const ok = async () => ({ data: true as const, error: null });

function request() {
  return new NextRequest('http://localhost/api/cron/lead-response', {
    headers: { authorization: `Bearer ${SECRET}`, 'user-agent': 'vercel-cron/1.0' },
  });
}

function repo(overrides: Partial<Record<'startRun' | 'finishRun' | 'deleteRunsStartedBefore', jest.Mock>> = {}) {
  return {
    startRun: overrides.startRun ?? jest.fn(ok),
    finishRun: overrides.finishRun ?? jest.fn(ok),
    deleteRunsStartedBefore: overrides.deleteRunsStartedBefore ?? jest.fn(ok),
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

beforeEach(() => {
  env.NODE_ENV = 'production';
  env.VERCEL_ENV = 'production';
  env.CRON_SECRET = SECRET;
  resetCronRunRecorderState();
  mockWarn.mockReset();
});
afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.VERCEL_ENV = saved.VERCEL_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

const SLACK = 400;

describe('a hung record write delays the response by at most one deadline, and never changes it', () => {
  it.each(['startRun', 'finishRun', 'deleteRunsStartedBefore'] as const)('%s hangs', async (which) => {
    const response = NextResponse.json({ success: true, reaped: 0, enqueued: 0, claimed: 0, sent: 1, skipped: 0 });
    const handler = jest.fn(async () => response);
    const r = repo({ [which]: jest.fn(hang) });
    const { value, ms } = await timed(() => withCronRunRecord('lead-response', handler, r)(request()));
    expect(value).toBe(response);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ms).toBeGreaterThanOrEqual(RECORD_WRITE_DEADLINE_MS - 50);
    expect(ms).toBeLessThan(RECORD_WRITE_DEADLINE_MS + SLACK);
    expect(await value.json()).toEqual({ success: true, reaped: 0, enqueued: 0, claimed: 0, sent: 1, skipped: 0 });
  });

  it('start AND finish both hang (a dead database): two deadlines, ~3 s, response unchanged', async () => {
    const response = NextResponse.json({ success: true });
    const r = repo({ startRun: jest.fn(hang), finishRun: jest.fn(hang) });
    const { value, ms } = await timed(() => withCronRunRecord('lead-response', async () => response, r)(request()));
    expect(value).toBe(response);
    expect(ms).toBeGreaterThanOrEqual(2 * RECORD_WRITE_DEADLINE_MS - 50);
    expect(ms).toBeLessThan(2 * RECORD_WRITE_DEADLINE_MS + SLACK);
    expect(r.deleteRunsStartedBefore).not.toHaveBeenCalled();
  });

  it.each(['startRun', 'finishRun', 'deleteRunsStartedBefore'] as const)('%s rejects: no delay, response unchanged', async (which) => {
    const response = NextResponse.json({ success: true });
    const r = repo({ [which]: jest.fn(async () => Promise.reject(new Error('boom: a@b.c'))) });
    const { value, ms } = await timed(() => withCronRunRecord('lead-response', async () => response, r)(request()));
    expect(value).toBe(response);
    expect(ms).toBeLessThan(SLACK);
    // No log argument carries the error message.
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('a@b.c');
  });

  it.each(['startRun', 'finishRun', 'deleteRunsStartedBefore'] as const)('%s throws synchronously: no delay, response unchanged', async (which) => {
    const response = NextResponse.json({ success: true });
    const r = repo({
      [which]: jest.fn(() => {
        throw new Error('sync boom');
      }),
    });
    const { value, ms } = await timed(() => withCronRunRecord('lead-response', async () => response, r)(request()));
    expect(value).toBe(response);
    expect(ms).toBeLessThan(SLACK);
  });
});

describe('a job that throws still throws the same error', () => {
  it('recorded: the very same error object, after the failure is recorded', async () => {
    const error = new TypeError('job exploded');
    const r = repo();
    await expect(
      withCronRunRecord('lead-response', async () => {
        throw error;
      }, r)(request())
    ).rejects.toBe(error);
    expect(r.finishRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'failed', errorClass: 'exception', httpStatus: null, counts: {} }),
      expect.anything()
    );
  });

  it('recorded, with the finish hanging: still the same error, within one deadline', async () => {
    const error = new Error('x');
    const r = repo({ finishRun: jest.fn(hang) });
    const start = Date.now();
    await expect(
      withCronRunRecord('lead-response', async () => {
        throw error;
      }, r)(request())
    ).rejects.toBe(error);
    expect(Date.now() - start).toBeLessThan(RECORD_WRITE_DEADLINE_MS + SLACK);
  });

  it('unrecorded (wrong secret): the same error, and no write at all', async () => {
    const error = new Error('y');
    const r = repo();
    const req = new NextRequest('http://localhost/x', { headers: { authorization: 'Bearer nope' } });
    await expect(
      withCronRunRecord('lead-response', async () => {
        throw error;
      }, r)(req)
    ).rejects.toBe(error);
    expect(r.startRun).not.toHaveBeenCalled();
  });

  it('a TimeoutError is classed timeout', async () => {
    const error = new Error('t');
    error.name = 'TimeoutError';
    const r = repo();
    await expect(withCronRunRecord('lead-response', async () => { throw error; }, r)(request())).rejects.toBe(error);
    expect(r.finishRun).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errorClass: 'timeout' }), expect.anything());
  });
});

describe('the gate', () => {
  it.each([
    ['wrong secret, same length', { authorization: `Bearer ${'z'.repeat(SECRET.length)}` }, {}],
    ['secret of a different length', { authorization: 'Bearer a' }, {}],
    ['no header', {}, {}],
    ['secret unset', { authorization: 'Bearer undefined' }, { CRON_SECRET: undefined }],
    ['non-production NODE_ENV', { authorization: `Bearer ${SECRET}` }, { NODE_ENV: 'development' }],
    ['preview VERCEL_ENV', { authorization: `Bearer ${SECRET}` }, { VERCEL_ENV: 'preview' }],
  ] as const)('%s: nothing recorded, the same response object', async (_n, headers, envPatch) => {
    for (const [k, v] of Object.entries(envPatch)) {
      if (v === undefined) delete env[k];
      else env[k] = v as string;
    }
    const response = NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const r = repo();
    const out = await withCronRunRecord('lead-response', async () => response, r)(
      new NextRequest('http://localhost/x', { headers: headers as Record<string, string> })
    );
    expect(out).toBe(response);
    expect(r.startRun).not.toHaveBeenCalled();
    expect(r.finishRun).not.toHaveBeenCalled();
    expect(r.deleteRunsStartedBefore).not.toHaveBeenCalled();
  });
});

describe('the counts allow-list', () => {
  const poison = {
    success: true,
    totalValueImpact: 999,
    amount: 5,
    revenue: 7,
    note: 'Owner text a@b.c',
    data: {
      totalValueImpact: 12345.67,
      amountDue: 10,
      usersProcessed: 'three',
      errors: Number.NaN,
      metricsComputed: [1, 2],
      insightsCreated: { n: 1 },
      reminders: { processed: 1, sent: Infinity, failed: true, amount: 3 },
      retryStats: { processedInvoices: 2, successCount: 1, failureCount: 1, totalAmount: 500 },
    },
    failed: false,
    hitLimit: true,
  };

  it.each(BOS_CRON_JOBS.map((j) => [j.id, j] as const))('%s keeps only its own registry keys, finite numbers only', (_id, job) => {
    const counts = extractCounts(poison, job.counts);
    const allowed = new Set(job.counts.map((c) => c.key));
    for (const [key, value] of Object.entries(counts)) {
      expect(allowed.has(key)).toBe(true);
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
      expect(key).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);
      expect(key).not.toMatch(/value|amount|usd|price|revenue|cost|impact|total(Value|Amount)/i);
    }
    expect(JSON.stringify(counts)).not.toMatch(/12345|500|Owner|a@b\.c/);
  });

  it('registry: no count path or key names money, anywhere', () => {
    for (const job of BOS_CRON_JOBS) {
      for (const spec of job.counts) {
        for (const seg of [spec.key, ...spec.path]) {
          expect(seg).not.toMatch(/value|amount|usd|price|revenue|cost|impact|total(Value|Amount)/i);
        }
      }
    }
  });
});
