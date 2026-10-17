/**
 * GET /api/cron/data-export (DE-8b, workplan §12): fail-closed CRON_SECRET,
 * the counts in the response, and the run's audit entries written with one
 * bounded flush.
 */
import { NextRequest } from 'next/server';

const mockRunExportSweep = jest.fn();
jest.mock('@/lib/business-os/data-export/exportSweep', () => ({ runExportSweep: (...a: unknown[]) => mockRunExportSweep(...a) }));
jest.mock('@/lib/business-os/data-export/fileManifest', () => ({ createExportFileSource: () => ({}) }));
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a) }));
// The run record wrapper is covered by runRecord.adoption.test.ts; here it is a pass-through.
jest.mock('@/lib/cron/cronRunRecorder', () => ({ withCronRunRecord: (_id: string, handler: unknown) => handler }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, CRON_SECRET: env.CRON_SECRET };

type RouteModule = { GET: (request: NextRequest) => Promise<Response> };
function load(): RouteModule {
  let mod: RouteModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the env is set
    mod = require('../route') as RouteModule;
  });
  return mod!;
}
const request = (authorization?: string) =>
  new NextRequest('http://localhost/api/cron/data-export', { headers: authorization ? { authorization } : {} });

const COUNTS = {
  staleReaped: 1,
  expired: 2,
  expireFailed: 0,
  orphansRemoved: 3,
  orphansKept: 4,
  orphansUnexpected: 0,
  accountsWatched: 5,
  accountsNearCeiling: 0,
  accountsOverCeiling: 0,
  incompleteSteps: 0,
};
const ENTRY = { action: 'DATA_EXPORT_EXPIRED', entityType: 'user', userId: 'u' };

beforeEach(() => {
  jest.clearAllMocks();
  env.NODE_ENV = 'production';
  env.CRON_SECRET = 'cron-secret';
  mockRunExportSweep.mockResolvedValue({ ...COUNTS, auditEntries: [ENTRY] });
  mockLogAndFlush.mockResolvedValue(undefined);
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

it('runs with the right bearer, returns the counts (no audit entries), flushes the audit once', async () => {
  const response = await load().GET(request('Bearer cron-secret'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data).toEqual(COUNTS);
  expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  expect(mockLogAndFlush.mock.calls[0][0]).toEqual([ENTRY]);
});

it('no secret configured in production: 401 and nothing runs (fail closed)', async () => {
  delete env.CRON_SECRET;
  const response = await load().GET(request('Bearer anything'));
  expect(response.status).toBe(401);
  expect(mockRunExportSweep).not.toHaveBeenCalled();
});

it('a wrong or missing bearer: 401 and nothing runs', async () => {
  expect((await load().GET(request('Bearer wrong'))).status).toBe(401);
  expect((await load().GET(request())).status).toBe(401);
  expect(mockRunExportSweep).not.toHaveBeenCalled();
});

it('a defect in the sweep is a 500, never an unhandled throw', async () => {
  mockRunExportSweep.mockRejectedValueOnce(new Error('defect'));
  expect((await load().GET(request('Bearer cron-secret'))).status).toBe(500);
});
