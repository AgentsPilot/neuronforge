/**
 * POST /api/admin/archiving/runs (Slice 2b): P-1 to P-15.
 *
 * The gate's fail-closed cases (admin check throws, auth throws) are proven by
 * `app/api/admin/__tests__/adminGate.writes.test.ts`; here one 401 and one 403
 * show the repository is never reached. The runner is the REAL one, over a
 * mocked repository, so "Continue uses the stored cutoff" is proven through the
 * code path that actually moves rows.
 *
 * `ARCHIVE_RUNS_ENABLED` is read through a getter over `mockRunsEnabled`,
 * default false, which is the real value (pinned by `config.test.ts`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

let mockRunsEnabled = false;
jest.mock('@/lib/archiving/config', () => {
  // defineProperty, not `{ ...actual, get X() {} }`: the ES2017 target lowers a
  // spread to Object.assign, which reads the getter once and freezes its value.
  const mocked = { ...jest.requireActual('@/lib/archiving/config') };
  Object.defineProperty(mocked, 'ARCHIVE_RUNS_ENABLED', { get: () => mockRunsEnabled });
  return mocked;
});

const order: string[] = [];
const takeOver = jest.fn();
const createRun = jest.fn();
const claimRun = jest.fn();
const runBatch = jest.fn();
const finishRun = jest.fn();
const record =
  (name: string, fn: jest.Mock) =>
  (...args: unknown[]) => {
    order.push(name);
    return fn(...args);
  };
jest.mock('@/lib/repositories/ArchiveRepository', () => ({
  archiveRepository: {
    takeOverStaleRuns: record('takeOverStaleRuns', takeOver),
    createRun: record('createRun', createRun),
    claimRunForContinue: record('claimRunForContinue', claimRun),
    runBatchAllAccounts: record('runBatchAllAccounts', runBatch),
    finishRun: record('finishRun', finishRun),
  },
}));

const auditLog = jest.fn();
const auditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: (input: unknown) => {
        order.push('audit.log');
        return auditLog(input);
      },
      flush: () => {
        order.push('audit.flush');
        return auditFlush();
      },
    }),
  },
}));

import { POST } from '../route';
import { cutoffFor } from '@/lib/archiving/config';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'ops@example.com' };
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const STORED_CUTOFF = '2025-01-01T00:00:00.123+00:00';
const NOW = new Date('2026-09-26T12:00:00.000Z');

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    source: 'audit_trail',
    status: 'running',
    retention_days: 365,
    cutoff: STORED_CUTOFF,
    rows_archived: 0,
    batches: 0,
    started_by: ADMIN.id,
    started_at: NOW.toISOString(),
    last_batch_at: null,
    finished_at: null,
    error_code: null,
    ...overrides,
  };
}

const counts = (n: number) => ({ data: { selected: n, inserted: n, deleted: n }, error: null });

function post(body: unknown, raw?: string) {
  return new NextRequest('http://localhost/api/admin/archiving/runs', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const START = { action: 'start', source: 'audit_trail', retentionDays: 365 };
const CONTINUE = { action: 'continue', runId: RUN_ID };

function asAdmin() {
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
}

const repoTouched = () => order.filter((name) => !name.startsWith('audit.'));
const auditActions = () => auditLog.mock.calls.map((call) => (call[0] as { action: string }).action);

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  mockRunsEnabled = false;
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  auditLog.mockResolvedValue(undefined);
  auditFlush.mockResolvedValue(undefined);
  takeOver.mockResolvedValue({ data: [], error: null });
  createRun.mockImplementation(async (input: { cutoff: Date }) => ({
    kind: 'created',
    run: runRow({ cutoff: input.cutoff.toISOString() }),
  }));
  claimRun.mockResolvedValue({ kind: 'claimed', run: runRow({ status: 'running' }) });
  runBatch.mockResolvedValueOnce(counts(1000)).mockResolvedValue(counts(0));
  finishRun.mockImplementation(async (_id: string, outcome: { status: string; errorCode: string | null }) => ({
    data: runRow({ status: outcome.status, error_code: outcome.errorCode, rows_archived: '1000', batches: 1 }),
    error: null,
  }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the gate', () => {
  it('P-1: 401 when signed out, and reaches nothing', async () => {
    getUser.mockResolvedValue(null);
    const res = await POST(post(START));
    expect(res.status).toBe(401);
    expect(order).toEqual([]);
  });

  it('P-2: 403 for a signed-in non-admin, and reaches nothing', async () => {
    getUser.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(false);
    const res = await POST(post(START));
    expect(res.status).toBe(403);
    expect(order).toEqual([]);
  });
});

describe('P-4: invalid bodies are 400 invalid_body and reach nothing', () => {
  it.each([
    ['retentionDays 30', { ...START, retentionDays: 30 }],
    ['retentionDays as a string', { ...START, retentionDays: '365' }],
    ['an unknown source', { ...START, source: 'agent_logs' }],
    ['no action', { source: 'audit_trail', retentionDays: 365 }],
    ['a runId that is not a uuid', { action: 'continue', runId: 'x' }],
    ['an injected cutoff', { ...START, cutoff: '2020-01-01T00:00:00.000Z' }],
    ['an injected startedBy', { ...START, startedBy: RUN_ID }],
    ['an injected status', { ...START, status: 'succeeded' }],
    ['an injected batchSize', { ...START, batchSize: 5000 }],
  ])('%s', async (_label, body) => {
    asAdmin();
    mockRunsEnabled = true;
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(order).toEqual([]);
  });

  it('malformed JSON', async () => {
    asAdmin();
    const res = await POST(post(undefined, '{not json'));
    expect(res.status).toBe(400);
    expect(order).toEqual([]);
  });
});

describe('P-5: runs switched off (the real value)', () => {
  it.each([
    ['start', START],
    ['continue', CONTINUE],
  ])('%s is 409 runs_not_enabled, with no repository call at all', async (_label, body) => {
    asAdmin();
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('runs_not_enabled');
    expect(order).toEqual([]);
  });

  it('an invalid body is still a 400 while runs are off (Zod first)', async () => {
    asAdmin();
    const res = await POST(post({ ...START, retentionDays: 30 }));
    expect(res.status).toBe(400);
  });
});

describe('runs switched on', () => {
  beforeEach(() => {
    asAdmin();
    mockRunsEnabled = true;
  });

  it('P-6: a start that drains is 200 succeeded, with a server cutoff, the admin as starter, STARTED + COMPLETED, flushed', async () => {
    const res = await POST(post(START));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ runId: RUN_ID, outcome: 'succeeded', rowsArchived: 1000, batches: 1 });
    expect(createRun).toHaveBeenCalledWith({
      source: 'audit_trail',
      retentionDays: 365,
      cutoff: cutoffFor(365, NOW),
      startedBy: ADMIN.id,
    });
    expect(auditActions()).toEqual(['ARCHIVE_RUN_STARTED', 'ARCHIVE_RUN_COMPLETED']);
    for (const [entry] of auditLog.mock.calls as Array<[Record<string, unknown>]>) {
      expect(entry).toMatchObject({ entityType: 'archive_run', entityId: RUN_ID, userId: ADMIN.id, actorId: ADMIN.id });
    }
    expect(order[order.length - 1]).toBe('audit.flush');
  });

  it('P-7: a start that runs out of budget is 200 partial, with STARTED only', async () => {
    let clock = NOW.getTime();
    jest.spyOn(Date, 'now').mockImplementation(() => (clock += 20_000));
    runBatch.mockReset();
    runBatch.mockResolvedValue(counts(1000));

    const res = await POST(post(START));

    expect(res.status).toBe(200);
    expect((await res.json()).data.outcome).toBe('partial');
    expect(finishRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ status: 'partial' }));
    expect(auditActions()).toEqual(['ARCHIVE_RUN_STARTED']);
  });

  it.each([
    ['start, a run is already running', START, () => createRun.mockResolvedValue({ kind: 'conflict' }), 'run_in_progress'],
    ['continue, the run is not continuable', CONTINUE, () => claimRun.mockResolvedValue({ kind: 'not_continuable' }), 'run_not_continuable'],
    ['continue, another run is running', CONTINUE, () => claimRun.mockResolvedValue({ kind: 'conflict' }), 'run_in_progress'],
  ])('P-8: %s is 409, with no batch and no audit', async (_label, body, arrange, code) => {
    arrange();
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(code);
    expect(runBatch).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  // Which statuses may be continued (partial, failed) is the claim's filter,
  // pinned by the repository test R-7; the route only ever sees the claimed row.
  it('P-11: continue uses the STORED cutoff, not a fresh one, and writes no STARTED', async () => {
    claimRun.mockResolvedValue({ kind: 'claimed', run: runRow({ status: 'running', retention_days: 90 }) });

    const res = await POST(post(CONTINUE));

    expect(res.status).toBe(200);
    expect(claimRun).toHaveBeenCalledWith(RUN_ID, NOW);
    for (const call of runBatch.mock.calls) expect(call[2]).toBe(STORED_CUTOFF);
    expect(auditActions()).toEqual(['ARCHIVE_RUN_COMPLETED']);
  });

  it('P-12: a failed batch is 500 archive_batch_failed with the run id, recorded failed, FAILED audited', async () => {
    runBatch.mockReset();
    runBatch.mockResolvedValue({ data: null, error: new Error('lock timeout') });

    const res = await POST(post(START));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'archive_batch_failed', runId: RUN_ID });
    expect(finishRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ status: 'failed', errorCode: 'batch_failed' }));
    expect(auditActions()).toEqual(['ARCHIVE_RUN_STARTED', 'ARCHIVE_RUN_FAILED']);
  });

  it('P-13 (O-1): rows moved but the finish was not recorded is 500 run_unfinished, no terminal audit', async () => {
    finishRun.mockResolvedValue({ data: null, error: new Error('network') });

    const res = await POST(post(START));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'run_unfinished', runId: RUN_ID });
    expect(auditActions()).toEqual(['ARCHIVE_RUN_STARTED']);
    expect(auditFlush).toHaveBeenCalled();
  });

  it('P-13: a repository error is a 500 with no details outside development', async () => {
    takeOver.mockResolvedValue({ data: null, error: new Error('db down') });

    const res = await POST(post(START));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    expect(body.details).toBeUndefined();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('P-14: the takeover runs before create and before claim', async () => {
    await POST(post(START));
    expect(order.indexOf('takeOverStaleRuns')).toBeLessThan(order.indexOf('createRun'));

    order.length = 0;
    await POST(post(CONTINUE));
    expect(order.indexOf('takeOverStaleRuns')).toBeLessThan(order.indexOf('claimRunForContinue'));
    expect(repoTouched()[0]).toBe('takeOverStaleRuns');
  });
});

// ── P-15: source rules ──────────────────────────────────────────────────────

const ROUTE_REL = 'app/api/admin/archiving/runs/route.ts';
const RUNNER_REL = 'lib/archiving/server/runArchive.ts';

/** Source with comments removed, so prose about a rule cannot satisfy or break it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const routeSource = fs.readFileSync(path.join(process.cwd(), ROUTE_REL), 'utf8');
const routeCode = codeOf(routeSource);

/** Every non-test TypeScript source file under the given top-level folders. */
function sourceFiles(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__tests__', '__mocks__', '.next'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(path.relative(process.cwd(), full).split(path.sep).join('/'));
      }
    }
  };
  for (const root of roots) walk(path.join(process.cwd(), root));
  return found;
}

/** Files that CALL the named function (its declaration does not count). */
function callers(name: string): string[] {
  const call = new RegExp(`(?<!function\\s+|async\\s+)\\b${name}\\(`);
  return sourceFiles(['app', 'lib', 'components', 'hooks', 'scripts']).filter((file) =>
    call.test(codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8')))
  );
}

describe('P-15: source rules', () => {
  it('the first statement of POST is `await requireAdmin(` (C-1, OI-20)', () => {
    const opener = /export async function POST\s*\([^)]*\)\s*\{/.exec(routeCode);
    expect(opener).not.toBeNull();
    const body = routeCode.slice((opener?.index ?? 0) + (opener?.[0].length ?? 0)).trim();
    expect(body).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('exports POST only, with maxDuration 60', () => {
    expect(routeCode).toMatch(/export const maxDuration = 60;/);
    expect(routeCode).not.toMatch(/export\s+(async\s+)?function\s+(GET|PUT|PATCH|DELETE|HEAD)\b/);
  });

  it('never decides admin-ness itself, never touches the database directly, never logs through console', () => {
    expect(routeCode).not.toMatch(/AdminAccessService|profiles|app_metadata/);
    expect(routeCode).not.toMatch(/supabase/i);
    expect(routeSource).not.toMatch(/console\./);
  });

  it('R-1: the batch is called only by the runner, and the runner only by this route', () => {
    expect(callers('runBatchAllAccounts')).toEqual([RUNNER_REL]);
    expect(callers('runArchive')).toEqual([ROUTE_REL]);
  });

  it('the batch function is named only in the server-only repository (SA Q-6, optional check)', () => {
    const naming = sourceFiles(['app', 'lib', 'components', 'hooks', 'scripts']).filter((file) =>
      codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8')).includes('archive_audit_trail_batch')
    );
    expect(naming).toEqual(['lib/repositories/ArchiveRepository.ts']);
  });

  it('R-1: in this route, runs-off is checked before any repository call and before the runner', () => {
    const flag = routeCode.indexOf('if (!ARCHIVE_RUNS_ENABLED)');
    expect(flag).toBeGreaterThan(-1);
    for (const call of ['takeOverStaleRuns(', 'createRun(', 'claimRunForContinue(', 'runArchive(']) {
      const at = routeCode.indexOf(call);
      expect({ call, after: at > flag }).toEqual({ call, after: true });
    }
  });
});
