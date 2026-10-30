/**
 * GET /api/cron/data-export-modules (module export MX-3b,
 * BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §13.5 T-C1…T-C6; SA Workplan Review
 * 2026-10-28 C-5): fail-closed CRON_SECRET, the counts in the response, the
 * audit port wired to the bounded flush, the run record, and the one caller of
 * the worker.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { NextRequest } from 'next/server';

const mockRunWorker = jest.fn();
jest.mock('@/lib/business-os/data-export/moduleExportWorker', () => ({
  runModuleExportWorker: (...a: unknown[]) => mockRunWorker(...a),
}));
const WIRING = { jobs: { marker: 'jobs' }, now: () => 0 };
jest.mock('@/lib/business-os/data-export/moduleExportWorkerDeps', () => ({ moduleExportWorkerDeps: () => WIRING }));
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a) }));
const mockWithRecord = jest.fn((_id: string, handler: unknown) => handler);
jest.mock('@/lib/cron/cronRunRecorder', () => ({ withCronRunRecord: (id: string, handler: unknown) => mockWithRecord(id, handler) }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, CRON_SECRET: env.CRON_SECRET };

type RouteModule = { GET: (request: NextRequest) => Promise<Response>; maxDuration: number; runtime: string };
function load(): RouteModule {
  let mod: RouteModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the env is set
    mod = require('../route') as RouteModule;
  });
  return mod!;
}
const request = (authorization?: string) =>
  new NextRequest('http://localhost/api/cron/data-export-modules', { headers: authorization ? { authorization } : {} });

const COUNTS = {
  reaped: 1,
  claimed: 3,
  modulesSent: 2,
  partsSent: 4,
  modulesFailed: 1,
  modulesInterrupted: 0,
  retried: 0,
  noticesSent: 1,
  noticesFailed: 0,
  budgetStops: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  env.NODE_ENV = 'production';
  env.CRON_SECRET = 'cron-secret';
  mockRunWorker.mockResolvedValue(COUNTS);
  mockLogAndFlush.mockResolvedValue(undefined);
});

afterAll(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.CRON_SECRET = saved.CRON_SECRET;
});

describe('auth (T-C1, T-C2)', () => {
  it('production without CRON_SECRET: 401 and the worker never runs (fail closed)', async () => {
    delete env.CRON_SECRET;
    const response = await load().GET(request('Bearer anything'));
    expect(response.status).toBe(401);
    expect(mockRunWorker).not.toHaveBeenCalled();
  });

  it.each([['Bearer wrong'], [undefined]])('a wrong or missing bearer (%s): 401', async (authorization) => {
    const response = await load().GET(request(authorization));
    expect(response.status).toBe(401);
    expect(mockRunWorker).not.toHaveBeenCalled();
  });
});

describe('a run (T-C3 … T-C6)', () => {
  it('T-C3: the right bearer runs the worker once and returns its counts; maxDuration 300, nodejs', async () => {
    const mod = load();
    const response = await mod.GET(request('Bearer cron-secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: COUNTS });
    expect(mockRunWorker).toHaveBeenCalledTimes(1);
    expect(mod.maxDuration).toBe(300);
    expect(mod.runtime).toBe('nodejs');
  });

  it('T-C4: the worker throws: 500, no details outside development', async () => {
    mockRunWorker.mockRejectedValue(new Error('secret internals'));
    const response = await load().GET(request('Bearer cron-secret'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret internals');
  });

  it('T-C5: the audit port writes through logAndFlush (bounded), with the production wiring beside it', async () => {
    await load().GET(request('Bearer cron-secret'));
    const [deps] = mockRunWorker.mock.calls[0] as [Record<string, unknown>];
    expect(deps.jobs).toBe(WIRING.jobs);
    const entries = [{ action: 'DATA_EXPORT_MODULE_SENT', entityType: 'user', userId: 'u' }];
    await (deps.audit as (e: unknown[], r: string) => Promise<void>)(entries, 'module export job sent');
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(mockLogAndFlush.mock.calls[0][0]).toBe(entries);
    expect(mockLogAndFlush.mock.calls[0][2]).toMatchObject({ reason: 'module export job sent' });
  });

  it("T-C6: wrapped by withCronRunRecord('data-export-modules', …)", () => {
    load();
    expect(mockWithRecord).toHaveBeenCalledWith('data-export-modules', expect.any(Function));
  });
});

/**
 * SA C-5 (the drainLeaseInvariant pattern): the lease of 420 s is only safe
 * because the platform kills a run at maxDuration. So the worker must have ONE
 * runtime caller, this route, which awaits it and exports maxDuration = 300.
 * A second caller (a page, another cron, a script) could run it without that
 * kill, past the lease, while a reaper hands its jobs to someone else.
 */
describe('SA C-5: runModuleExportWorker has exactly one runtime caller', () => {
  const ROOT = process.cwd();
  const ROUTE = 'app/api/cron/data-export-modules/route.ts';
  const WORKER = 'lib/business-os/data-export/moduleExportWorker.ts';
  const SKIP = new Set(['node_modules', '.next', '.git', '__tests__', '__mocks__']);

  function walk(dir: string): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      if (SKIP.has(name)) return [];
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  const files = ['app', 'lib', 'components', 'hooks', 'scripts', 'pages']
    .flatMap((dir) => walk(join(ROOT, dir)))
    .map((file) => relative(ROOT, file).split(sep).join('/'));

  it('the scan ran over the code', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(ROUTE);
    expect(files).toContain(WORKER);
  });

  /** Source with comments removed: naming the worker in a comment is not calling it. */
  const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('only the route names it in code outside its own file, and the call is awaited', () => {
    const callers = files.filter((file) => file !== WORKER && /\brunModuleExportWorker\b/.test(codeOf(readFileSync(join(ROOT, file), 'utf8'))));
    expect(callers).toEqual([ROUTE]);
    const route = codeOf(readFileSync(join(ROOT, ROUTE), 'utf8'));
    const calls = route.match(/[^\n]*\brunModuleExportWorker\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/await\s+runModuleExportWorker\($/);
  });

  it('the route exports maxDuration = 300, the policy value, 120 s under the lease', () => {
    const route = readFileSync(join(ROOT, ROUTE), 'utf8');
    // `\r?`: a Windows CRLF checkout must pass too (`$` does not match before `\r`).
    expect(route).toMatch(/^export const maxDuration = 300;\r?$/m);
    expect(route).toMatch(/^export const runtime = 'nodejs';\r?$/m);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the real policy, not the mocked worker
    const { MODULE_EXPORT_POLICY } = jest.requireActual('@/lib/business-os/data-export/moduleExportPolicy');
    expect(MODULE_EXPORT_POLICY.WORKER_MAX_DURATION_SECONDS).toBe(300);
    expect(MODULE_EXPORT_POLICY.LEASE_SECONDS - 300).toBeGreaterThanOrEqual(60);
  });
});
