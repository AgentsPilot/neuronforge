/**
 * GET /api/cron/credit-leak-check — the nightly door of the leak check
 * (credit deduction slice 4b, workplan §5.4, §10.2).
 *
 * Fail-closed without CRON_SECRET in production (401 and an error log), 401 on
 * a wrong bearer with no read, the previous UTC day as the window, counts only
 * in the response (no money: nothing the run record keeps may be money), and
 * `withCronRunRecord` around it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

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

jest.mock('@/lib/repositories/BosCronRunRepository', () => ({
  ...jest.requireActual('@/lib/repositories/supabaseErrorCodes'),
  bosCronRunRepository: {
    startRun: async () => ({ data: true, error: null }),
    finishRun: async () => ({ data: true, error: null }),
    deleteRunsStartedBefore: async () => ({ data: true, error: null }),
  },
}));

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const GROUP = 'aaaaaaaa-0000-4000-8000-000000000001';

const mockReads = {
  pagePlanAnchors: jest.fn(),
  findPlanAnchor: jest.fn(),
  listTotalsForPeriodsInRange: jest.fn(),
  listLedgerRowsForAccount: jest.fn(),
  listUsageCallsForAccount: jest.fn(),
  countPlatformCalls: jest.fn(),
};
jest.mock('@/lib/business-os/credits/creditLeakCheckDeps', () => ({
  creditLeakCheckDeps: () => ({ ...mockReads, now: () => new Date() }),
}));

import { GET } from '../route';
import { findBosCronJob } from '@/lib/cron/bosCronJobs';
import { extractCounts } from '@/lib/cron/cronRunRecorder';

const SECRET = 'leak-cron-secret';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV, CRON_SECRET: env.CRON_SECRET };

const call = (authorization: string | null) => {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return GET(new NextRequest('http://localhost/api/cron/credit-leak-check', { headers }));
};

const noReadHappened = () => {
  for (const fn of Object.values(mockReads)) expect(fn).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  env.NODE_ENV = 'production';
  env.VERCEL_ENV = 'preview'; // the recorder stays out of the way; its own tests cover it
  env.CRON_SECRET = SECRET;
  const yesterdayNoon = new Date(Date.now() - 86_400_000);
  yesterdayNoon.setUTCHours(12, 0, 0, 0);
  mockReads.pagePlanAnchors.mockResolvedValue({ data: [{ user_id: ACCOUNT, period_anchor: null }], error: null });
  mockReads.listTotalsForPeriodsInRange.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockReads.listLedgerRowsForAccount.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockReads.listUsageCallsForAccount.mockResolvedValue({
    data: {
      rows: [
        {
          id: 'u1', created_at: yesterdayNoon.toISOString(), feature: 'business-os-chat', component: 'planner',
          session_id: GROUP, input_tokens: 100, output_tokens: 20, cost_usd: 0.0009, success: true, error_code: null,
        },
      ],
      reachedCeiling: false,
    },
    error: null,
  });
  mockReads.countPlatformCalls.mockResolvedValue({ data: 0, error: null });
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.VERCEL_ENV = saved.VERCEL_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe('fail-closed', () => {
  it('production without CRON_SECRET: 401, an error log, and no read', async () => {
    delete env.CRON_SECRET;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(401);
    expect(mockLog.error).toHaveBeenCalledWith('CRON_SECRET not configured - refusing cron request (fail-closed)');
    noReadHappened();
  });

  it.each([
    ['a wrong bearer', 'Bearer wrong'],
    ['no authorization header', null],
    ['the secret without "Bearer "', SECRET],
  ])('%s: 401 and no read', async (_name, header) => {
    const res = await call(header);
    expect(res.status).toBe(401);
    noReadHappened();
  });
});

describe('an authorised run', () => {
  it('checks the previous whole UTC day and returns counts only', async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(body.data.windowStart).toBe(`${yesterday}T00:00:00.000Z`);
    expect(body.data.windowEnd).toBe(`${today}T00:00:00.000Z`);
    expect(body.data).toMatchObject({ accountsChecked: 1, accountsWithLeak: 1, unchargedGroups: 1, accountsRemaining: 0, listingFailed: false });
    // No money anywhere in the response.
    expect(JSON.stringify(body)).not.toMatch(/usd|cost|0\.0009|amount|price/i);
    // The leak itself is the error log (BQ-2), with the account and the period (S-4).
    const leak = mockLog.error.mock.calls.find(([fields]) => (fields as { event?: string }).event === 'bos_credit_leak_found');
    expect(leak?.[0]).toMatchObject({ accountId: ACCOUNT, trigger: 'nightly', periodStart: `${yesterday.slice(0, 8)}01T00:00:00.000Z` });
  });

  it('every registered count is present in the response, as a number', async () => {
    const body = await (await call(`Bearer ${SECRET}`)).json();
    const job = findBosCronJob('credit-leak-check')!;
    const counts = extractCounts(body, job.counts);
    expect(Object.keys(counts).sort()).toEqual(job.counts.map((c) => c.key).sort());
    expect(counts.listingFailed).toBe(0);
  });

  it('a read failure is "not checked" and colours the run partly done, never clean', async () => {
    mockReads.listUsageCallsForAccount.mockResolvedValue({ data: null, error: new Error('db down') });
    const body = await (await call(`Bearer ${SECRET}`)).json();
    expect(body.data).toMatchObject({ accountsNotChecked: 1, accountsWithLeak: 0 });
    const job = findBosCronJob('credit-leak-check')!;
    expect(job.partlyDoneWhen).toContainEqual({ kind: 'atLeast', key: 'accountsNotChecked', value: 1 });
  });
});

describe('source', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');

  it('is wrapped by the run recorder and exports maxDuration 60', () => {
    expect(code).toMatch(/export const GET = withCronRunRecord\('credit-leak-check', runJob\);/);
    expect(code).toMatch(/export const maxDuration = 60;/);
  });

  it('writes nothing: no write verb, no audit, no email', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/AuditTrail|sendEmail|Resend|nodemailer/);
  });
});
