/**
 * Finance slice 8.2: the nightly cron door (HS-FR-1, HS-FR-6, HS-FR-7, HS-FR-8b;
 * AC-278, AC-279, E-96, E-97).
 */

import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

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
// Not a Vercel cron call in these tests (no user agent), so the recorder passes straight through.
jest.mock('@/lib/repositories/BosCronRunRepository', () => ({
  ...jest.requireActual('@/lib/repositories/supabaseErrorCodes'),
  bosCronRunRepository: { startRun: jest.fn(), finishRun: jest.fn(), deleteRunsStartedBefore: jest.fn() },
}));
const mockNow = { value: new Date('2026-10-18T00:07:00.000Z') };
jest.mock('@/lib/business-os/finance/financeSnapshotClock', () => ({ financeSnapshotClock: { now: () => mockNow.value } }));
const mockDeps = jest.fn(() => ({ marker: 'deps' }));
jest.mock('@/lib/business-os/finance/financeSnapshotDeps', () => ({ financeSnapshotDeps: () => mockDeps() }));
const mockRun = jest.fn();
jest.mock('@/lib/business-os/finance/financeSnapshotJob', () => ({ runFinanceSnapshot: (...a: unknown[]) => mockRun(...a) }));

import { GET, maxDuration, runtime } from '../route';

const SECRET = 'route-test-secret';
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, CRON_SECRET: env.CRON_SECRET };
const call = (authorization: string | null = `Bearer ${SECRET}`) =>
  GET(new NextRequest('http://localhost/api/cron/finance-snapshot', { headers: authorization ? { authorization } : {} }));
const COUNTS = { metricsWritten: 31, metricsAlreadyThere: 0, metricsSkipped: 0, familiesSkipped: 0, accountsRead: 9, lateRun: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  env.NODE_ENV = 'production';
  env.CRON_SECRET = SECRET;
  mockNow.value = new Date('2026-10-18T00:07:00.000Z');
  mockRun.mockResolvedValue({ kind: 'done', asOfDate: '2026-10-17', counts: COUNTS });
});
afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe('AC-278: fail-closed secret', () => {
  it('production without CRON_SECRET: 401 and an error log; the job never runs', async () => {
    delete env.CRON_SECRET;
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockLog.error).toHaveBeenCalledWith('CRON_SECRET not configured - refusing cron request (fail-closed)');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it.each([['a wrong bearer', 'Bearer nope'], ['no header', null]])('%s: 401', async (_n, header) => {
    expect((await call(header)).status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('development runs without a secret', async () => {
    env.NODE_ENV = 'development';
    delete env.CRON_SECRET;
    expect((await call(null)).status).toBe(200);
  });
});

describe('results', () => {
  it('done: 200 with the day and the six counts, numbers only; the job got the clock’s start and the wiring', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { asOfDate: '2026-10-17', ...COUNTS } });
    expect(mockRun).toHaveBeenCalledWith({ startedAt: mockNow.value }, { marker: 'deps' }, expect.anything());
    const line = mockLog.info.mock.calls.find((c) => c[1] === 'Finance snapshot recorded');
    expect(line?.[0]).toEqual({ asOfDate: '2026-10-17', ...COUNTS, durationMs: 0 });
  });

  it('AC-279 late: 200 with lateRun 1 and a warn line', async () => {
    mockRun.mockResolvedValue({ kind: 'late', asOfDate: '2026-10-17', counts: { ...COUNTS, metricsWritten: 0, accountsRead: 0, lateRun: 1 } });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.lateRun).toBe(1);
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ asOfDate: '2026-10-17' }), 'Finance snapshot run started too late; nothing written');
  });

  it('E-96 not installed: 503 with the fixed message and one error line { tableMissing: true }', async () => {
    mockRun.mockResolvedValue({ kind: 'not_installed', asOfDate: '2026-10-17' });
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: 'The finance history table is not installed yet' });
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ tableMissing: true }), expect.any(String));
  });

  it.each(['probe_failed', 'insert_failed'])('%s: 500, generic error, no details', async (kind) => {
    mockRun.mockResolvedValue({ kind, asOfDate: '2026-10-17' });
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
  });

  it('a thrown defect: 500, details only in development', async () => {
    mockRun.mockRejectedValue(new Error('defect'));
    expect(await (await call()).json()).toEqual({ success: false, error: 'Internal server error' });
    env.NODE_ENV = 'development';
    expect((await (await call(null)).json()).details).toBe('defect');
  });
});

describe('source (HS-FR-1, 8.2-R4)', () => {
  const code = readFileSync(join(process.cwd(), 'app', 'api', 'cron', 'finance-snapshot', 'route.ts'), 'utf8');

  it('nodejs, 60 s, recorded, one clock, no console', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
    expect(code).toContain("export const GET = withCronRunRecord('finance-snapshot', runJob);");
    expect(code).not.toMatch(/new Date\(\s*\)|Date\.now\(/);
    expect(code).not.toMatch(/console\./);
  });
});
