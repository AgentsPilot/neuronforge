/**
 * The shared recording step (admin reorganisation slice 5, part B; SA SC-1,
 * SC-2, SC-11; FR-R3, FR-R4).
 *
 * Recording happens only for a proven Vercel cron call, never fails the job,
 * never changes its response, and writes numbers only.
 */

import { NextRequest } from 'next/server';

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLogInfo(...a),
      warn: (...a: unknown[]) => mockLogWarn(...a),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import {
  extractCounts,
  isPartlyDone,
  isProvenVercelCronCall,
  resetCronRunRecorderState,
  withCronRunRecord,
  RECORD_WRITE_DEADLINE_MS,
} from '../cronRunRecorder';
import { findBosCronJob } from '../bosCronJobs';

const SECRET = 'test-cron-secret';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV, CRON_SECRET: env.CRON_SECRET };

function production() {
  env.NODE_ENV = 'production';
  env.VERCEL_ENV = 'production';
  env.CRON_SECRET = SECRET;
}

function req(headers: Record<string, string> = { authorization: `Bearer ${SECRET}`, 'user-agent': 'vercel-cron/1.0' }) {
  return new NextRequest('http://localhost/api/cron/lead-response', { headers });
}

function repo(over: Partial<Record<'startRun' | 'finishRun' | 'deleteRunsStartedBefore', jest.Mock>> = {}) {
  return {
    startRun: over.startRun ?? jest.fn(async () => ({ data: true as const, error: null })),
    finishRun: over.finishRun ?? jest.fn(async () => ({ data: true as const, error: null })),
    deleteRunsStartedBefore: over.deleteRunsStartedBefore ?? jest.fn(async () => ({ data: true as const, error: null })),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  production();
  resetCronRunRecorderState();
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.VERCEL_ENV = saved.VERCEL_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe('SC-1: only a proven Vercel cron call is recorded', () => {
  const cases: Array<[string, () => void, Record<string, string>]> = [
    ['no authorization header', () => undefined, { 'user-agent': 'vercel-cron/1.0' }],
    ['a length-mismatched header', () => undefined, { authorization: 'Bearer x' }],
    ['a wrong secret of the same length', () => undefined, { authorization: `Bearer ${'y'.repeat(SECRET.length)}` }],
    ['"Bearer " with an empty secret', () => { env.CRON_SECRET = ''; }, { authorization: 'Bearer ' }],
    ['the right secret, but NODE_ENV=development', () => { env.NODE_ENV = 'development'; }, { authorization: `Bearer ${SECRET}` }],
    ['the right secret, but VERCEL_ENV=preview', () => { env.VERCEL_ENV = 'preview'; }, { authorization: `Bearer ${SECRET}` }],
    ['the right secret, but no VERCEL_ENV (local)', () => { delete env.VERCEL_ENV; }, { authorization: `Bearer ${SECRET}` }],
  ];

  it.each(cases)('%s → not recorded, the handler runs once, the same response object', async (_name, setup, headers) => {
    setup();
    const r = repo();
    const response = json({ success: true, sent: 1 });
    const handler = jest.fn(async () => response);
    const out = await withCronRunRecord('lead-response', handler, r)(req(headers));
    expect(out).toBe(response);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r.startRun).not.toHaveBeenCalled();
    expect(r.finishRun).not.toHaveBeenCalled();
    expect(r.deleteRunsStartedBefore).not.toHaveBeenCalled();
  });

  it('the gate never throws: a headers object that throws means "not proven"', () => {
    const broken = { headers: { get: () => { throw new Error('boom'); } } } as unknown as NextRequest;
    expect(isProvenVercelCronCall(broken)).toBe(false);
  });

  it('the proven case is recognised', () => {
    expect(isProvenVercelCronCall(req())).toBe(true);
  });
});

describe('a recorded run (happy path, including "nothing to do")', () => {
  it('start → the job → finish (succeeded, counts) → prune; the same response object', async () => {
    const r = repo();
    const response = json({ success: true, reaped: 0, enqueued: 0, claimed: 0, sent: 0, skipped: 0 });
    const out = await withCronRunRecord('lead-response', async () => response, r)(req());
    expect(out).toBe(response);

    const [start] = r.startRun.mock.calls[0] as [Record<string, unknown>];
    expect(start).toMatchObject({ job: 'lead-response', source: 'vercel_cron' });
    expect(start.id).toMatch(/^[0-9a-f-]{36}$/); // SC-2(a): generated here
    const deadlineMs = (start.deadlineAt as Date).getTime() - (start.startedAt as Date).getTime();
    expect(deadlineMs).toBe((findBosCronJob('lead-response')!.timeLimitSeconds + 60) * 1000);

    const [id, finish] = r.finishRun.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(start.id);
    expect(finish).toMatchObject({
      outcome: 'succeeded',
      httpStatus: 200,
      errorClass: null,
      counts: { reaped: 0, enqueued: 0, claimed: 0, sent: 0, skipped: 0 },
    });
    const [cutoff] = r.deleteRunsStartedBefore.mock.calls[0] as [Date];
    expect((start.startedAt as Date).getTime() - cutoff.getTime()).toBe(30 * 24 * 3600 * 1000);
  });

  it('the body is still readable by the caller after the recorder read it', async () => {
    const out = await withCronRunRecord('lead-response', async () => json({ success: true, sent: 3 }), repo())(req());
    expect(await out.json()).toEqual({ success: true, sent: 3 });
  });

  it('a manual authorised call is recorded as source "other"', async () => {
    const r = repo();
    await withCronRunRecord('lead-response', async () => json({ success: true }), r)(
      req({ authorization: `Bearer ${SECRET}`, 'user-agent': 'curl/8' })
    );
    expect((r.startRun.mock.calls[0] as [Record<string, unknown>])[0].source).toBe('other');
  });

  it('a partly-done run (failed items) is recorded as partial', async () => {
    const r = repo();
    await withCronRunRecord('calendar-sync', async () => json({ success: true, total: 3, synced: 2, failed: 1 }), r)(req());
    expect((r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1].outcome).toBe('partial');
  });

  it('Q-U2: payment-retry declines never make the run partial', async () => {
    const r = repo();
    await withCronRunRecord(
      'payment-retry',
      async () => json({ success: true, data: { retryStats: { processedInvoices: 2, processedInstallments: 0, successCount: 0, failureCount: 2 } } }),
      r
    )(req());
    const finish = (r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(finish.outcome).toBe('succeeded');
    expect(finish.counts).toMatchObject({ retriesDeclined: 2 });
  });
});

describe('SA-3: the handler runs exactly once, even when it throws synchronously', () => {
  const syncThrower = (error: Error) =>
    jest.fn((): Promise<Response> => {
      throw error; // not a rejected promise: a synchronous throw
    });

  it('unrecorded path (not a proven cron call): called once, the same error rethrown', async () => {
    env.VERCEL_ENV = 'preview';
    const error = new Error('sync boom');
    const handler = syncThrower(error);
    const r = repo();
    await expect(withCronRunRecord('lead-response', handler, r)(req())).rejects.toBe(error);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r.startRun).not.toHaveBeenCalled();
  });

  it('recorded path: called once, the failure recorded, the same error rethrown', async () => {
    const error = new Error('sync boom');
    const handler = syncThrower(error);
    const r = repo();
    await expect(withCronRunRecord('lead-response', handler, r)(req())).rejects.toBe(error);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      outcome: 'failed',
      errorClass: 'exception',
    });
  });

  it('while the missing-table backoff is on: called once, the same error rethrown', async () => {
    const missing = Object.assign(new Error('x'), { code: '42P01' });
    await withCronRunRecord('lead-response', async () => json({ success: true }), repo({
      startRun: jest.fn(async () => ({ data: null, error: missing })),
    }))(req());
    const error = new Error('sync boom');
    const handler = syncThrower(error);
    await expect(withCronRunRecord('lead-response', handler, repo())(req())).rejects.toBe(error);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('SA-4: a finish that matched no running row is not "recorded"', () => {
  it('logs a distinct, non-error diagnostic and never "Cron run recorded"', async () => {
    mockLogInfo.mockClear();
    const r = repo({ finishRun: jest.fn(async () => ({ data: 0, error: null })) });
    const response = json({ success: true });
    expect(await withCronRunRecord('lead-response', async () => response, r)(req())).toBe(response);
    const messages = mockLogInfo.mock.calls.map((c) => c[1]);
    expect(messages).toContain('Cron run finish matched no running row; the run is not recorded');
    expect(messages).not.toContain('Cron run recorded');
    const diagnostic = mockLogInfo.mock.calls.find((c) => String(c[1]).startsWith('Cron run finish matched'));
    expect(diagnostic?.[0]).toMatchObject({ job: 'lead-response', rowsUpdated: 0 });
  });

  it('one row updated is "Cron run recorded"', async () => {
    mockLogInfo.mockClear();
    const r = repo({ finishRun: jest.fn(async () => ({ data: 1, error: null })) });
    await withCronRunRecord('lead-response', async () => json({ success: true }), r)(req());
    expect(mockLogInfo.mock.calls.map((c) => c[1])).toContain('Cron run recorded');
  });
});

describe('FR-R4: recording never fails the job or changes its response', () => {
  it('a 500 is recorded as failed/http_error, and returned unchanged', async () => {
    const r = repo();
    const response = json({ success: false, error: 'Internal server error' }, 500);
    const out = await withCronRunRecord('lead-response', async () => response, r)(req());
    expect(out).toBe(response);
    expect((r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      outcome: 'failed',
      errorClass: 'http_error',
      httpStatus: 500,
      counts: {},
    });
  });

  it('a throwing job: the failure is recorded, then the SAME error is rethrown', async () => {
    const r = repo();
    const error = new Error('db down: a@b.c');
    await expect(withCronRunRecord('lead-response', async () => { throw error; }, r)(req())).rejects.toBe(error);
    const finish = (r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(finish).toMatchObject({ outcome: 'failed', errorClass: 'exception', httpStatus: null });
    expect(JSON.stringify(finish)).not.toContain('a@b.c');
  });

  it('an AbortError is classed "timeout"', async () => {
    const r = repo();
    const error = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(withCronRunRecord('lead-response', async () => { throw error; }, r)(req())).rejects.toBe(error);
    expect((r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1].errorClass).toBe('timeout');
  });

  it('table missing: the job runs, nothing else is written, and later runs skip recording for a while', async () => {
    const missing = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const r = repo({ startRun: jest.fn(async () => ({ data: null, error: missing })) });
    const response = json({ success: true });
    const handler = jest.fn(async () => response);
    const wrapped = withCronRunRecord('lead-response', handler, r);
    expect(await wrapped(req())).toBe(response);
    expect(r.finishRun).not.toHaveBeenCalled();
    expect(r.deleteRunsStartedBefore).not.toHaveBeenCalled();
    await wrapped(req());
    expect(r.startRun).toHaveBeenCalledTimes(1); // backoff: not retried on this instance
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('SC-2(b): a start that failed for another reason is still finished (it may have committed)', async () => {
    const r = repo({ startRun: jest.fn(async () => ({ data: null, error: new Error('network') })) });
    await withCronRunRecord('lead-response', async () => json({ success: true }), r)(req());
    expect(r.finishRun).toHaveBeenCalledTimes(1);
  });

  it('a start slower than its deadline: the job still runs, and the finish is still attempted', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      const r = repo({ startRun: jest.fn(() => new Promise(() => undefined)) });
      const response = json({ success: true });
      const handler = jest.fn(async () => response);
      const pending = withCronRunRecord('lead-response', handler, r)(req());
      await jest.advanceTimersByTimeAsync(RECORD_WRITE_DEADLINE_MS + 1);
      expect(await pending).toBe(response);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(r.finishRun).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a finish that fails skips the prune, and the response is unchanged', async () => {
    const r = repo({ finishRun: jest.fn(async () => ({ data: null, error: new Error('x') })) });
    const response = json({ success: true });
    expect(await withCronRunRecord('lead-response', async () => response, r)(req())).toBe(response);
    expect(r.deleteRunsStartedBefore).not.toHaveBeenCalled();
  });

  it('repository methods that throw synchronously never escape', async () => {
    const r = repo({
      startRun: jest.fn(() => { throw new Error('sync'); }),
      finishRun: jest.fn(() => { throw new Error('sync'); }),
    });
    const response = json({ success: true });
    expect(await withCronRunRecord('lead-response', async () => response, r)(req())).toBe(response);
  });

  it('a non-JSON 2xx body is recorded as succeeded with no counts', async () => {
    const r = repo();
    await withCronRunRecord('lead-response', async () => new Response('ok', { status: 200 }), r)(req());
    expect((r.finishRun.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ outcome: 'succeeded', counts: {} });
  });
});

describe('SC-11: count extraction', () => {
  const specs = [
    { key: 'sent', path: ['sent'], label: 'sent' },
    { key: 'nested', path: ['data', 'x', 'n'], label: 'n' },
    { key: 'flag', path: ['hitLimit'], label: 'f' },
    { key: 'text', path: ['note'], label: 't' },
    { key: 'inf', path: ['inf'], label: 'i' },
    { key: 'missing', path: ['nope'], label: 'm' },
  ];

  it('keeps finite numbers, turns booleans into 1/0, drops everything else', () => {
    expect(
      extractCounts({ sent: 2, data: { x: { n: 5 } }, hitLimit: true, note: 'a@b.c', inf: Infinity }, specs)
    ).toEqual({ sent: 2, nested: 5, flag: 1 });
  });

  it('never throws on odd bodies', () => {
    expect(extractCounts(null, specs)).toEqual({});
    expect(extractCounts('text', specs)).toEqual({});
    expect(extractCounts({ data: 3 }, specs)).toEqual({});
  });

  it('never records insight-automations\' money figure', () => {
    const job = findBosCronJob('insight-automations')!;
    const counts = extractCounts({ data: { automationsChecked: 1, totalValueImpact: 999.5 } }, job.counts);
    expect(Object.values(counts)).not.toContain(999.5);
  });

  it('partly done: atLeast and exceeds', () => {
    expect(isPartlyDone({ failed: 1 }, [{ kind: 'atLeast', key: 'failed', value: 1 }])).toBe(true);
    expect(isPartlyDone({ failed: 0 }, [{ kind: 'atLeast', key: 'failed', value: 1 }])).toBe(false);
    expect(isPartlyDone({ considered: 3, sent: 2 }, [{ kind: 'exceeds', key: 'considered', other: 'sent' }])).toBe(true);
    expect(isPartlyDone({ considered: 2, sent: 2 }, [{ kind: 'exceeds', key: 'considered', other: 'sent' }])).toBe(false);
    expect(isPartlyDone({}, [{ kind: 'atLeast', key: 'failed', value: 1 }])).toBe(false);
  });
});
