/**
 * GET /api/admin/archiving (Slice 1: I-1 to I-10; Slice 2a: A-1 to A-8).
 *
 * The gate (401 → 403 → fail closed, nothing read before it answers), the
 * payload shape (three options, one `now`; since Slice 2a the archived total,
 * latest cutoff, last run and run history), the all-or-nothing 500, and the
 * source rules the CI guard cannot see: that
 * `requireAdmin` is the FIRST statement (OI-20), and that the route has no
 * write verb and no direct database access.
 *
 * There is no 400 case: the route takes no input. The route-level half of AC-3
 * belongs to Slice 2's POST.
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

const logs: Array<{ level: string; ctx: Record<string, unknown>; msg: unknown }> = [];
const childContexts: Array<Record<string, unknown>> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: Record<string, unknown>, msg: unknown) => logs.push({ level, ctx, msg });
    }
    logger.child = (ctx: Record<string, unknown>) => {
      childContexts.push(ctx);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

const countAll = jest.fn();
const oldest = jest.fn();
const countBefore = jest.fn();
const countArchived = jest.fn();
const latestCutoff = jest.fn();
const listRuns = jest.fn();
jest.mock('@/lib/repositories/ArchiveRepository', () => ({
  archiveRepository: {
    countAuditTrailAllAccounts: () => countAll(),
    getOldestAuditTrailCreatedAtAllAccounts: () => oldest(),
    countAuditTrailBeforeAllAccounts: (cutoff: Date) => countBefore(cutoff),
    countArchivedAllAccounts: (source: string) => countArchived(source),
    getLatestCutoff: (source: string) => latestCutoff(source),
    listRuns: (options: unknown) => listRuns(options),
  },
}));

const listActiveAdmins = jest.fn();
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: { listActive: () => listActiveAdmins() },
}));

// jest.mock calls are hoisted above this import, so the route loads with the fakes.
import { GET } from '../route';

const ROUTE_PATH = path.join(process.cwd(), 'app/api/admin/archiving/route.ts');
const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8');

/** Source with comments removed, so the header's prose cannot satisfy or break a rule. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const routeCode = codeOf(routeSource);

const DAY = 86_400_000;
const NOW = new Date('2026-09-26T12:00:00.000Z');

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/admin/archiving?retentionDays=30', { headers });
}

function asAdmin() {
  getUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  isAdmin.mockResolvedValue(true);
}

/** Eligible counts keyed by days before `NOW`, so each cutoff maps to a distinct number. */
function eligibleByCutoff(byDays: Record<number, number>) {
  countBefore.mockImplementation(async (cutoff: Date) => {
    const days = Math.round((NOW.getTime() - cutoff.getTime()) / DAY);
    return { data: byDays[days], error: null };
  });
}

const repoCalls = () =>
  countAll.mock.calls.length +
  oldest.mock.calls.length +
  countBefore.mock.calls.length +
  countArchived.mock.calls.length +
  latestCutoff.mock.calls.length +
  listRuns.mock.calls.length +
  listActiveAdmins.mock.calls.length;

const ADMIN_UUID = 'aaaaaaaa-1111-4111-8111-111111111111';
const FORMER_ADMIN_UUID = 'bbbbbbbb-2222-4222-8222-222222222222';

/** An archive_runs row as the repository returns it. */
function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    source: 'audit_trail',
    status: 'succeeded',
    retention_days: 365,
    cutoff: '2025-09-26T12:00:00.000Z',
    rows_archived: '1200',
    batches: 2,
    started_by: ADMIN_UUID,
    started_at: '2026-09-26T11:00:00.000Z',
    last_batch_at: '2026-09-26T11:00:30.000Z',
    finished_at: '2026-09-26T11:00:31.000Z',
    error_code: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  childContexts.length = 0;
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  countAll.mockResolvedValue({ data: 5000, error: null });
  oldest.mockResolvedValue({ data: '2024-03-01T08:00:00+00:00', error: null });
  eligibleByCutoff({ 365: 1200, 180: 2500, 90: 3900 });
  countArchived.mockResolvedValue({ data: 0, error: null });
  latestCutoff.mockResolvedValue({ data: null, error: null });
  listRuns.mockResolvedValue({ data: [], error: null });
  listActiveAdmins.mockResolvedValue({
    data: [{ id: 'row-1', user_id: ADMIN_UUID, email: 'ops@example.com', is_active: true }],
    error: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the gate', () => {
  it('I-1: 401 when signed out, and reads nothing', async () => {
    getUser.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(repoCalls()).toBe(0);
  });

  it('I-2: 403 for a signed-in non-admin, and reads nothing', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'someone@example.com' });
    isAdmin.mockResolvedValue(false);

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(repoCalls()).toBe(0);
  });

  it('I-3: fails closed (403) when the admin check throws', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'someone@example.com' });
    isAdmin.mockRejectedValue(new Error('supabase down'));

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(repoCalls()).toBe(0);
  });
});

describe('the overview', () => {
  it('I-4: returns the audit-trail source with all three options, in order, plus the archive fields', async () => {
    asAdmin();

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.runsEnabled).toBe(false);
    expect(body.data.generatedAt).toBe(NOW.toISOString());
    expect(body.data.sources).toHaveLength(1);

    const source = body.data.sources[0];
    expect(source.key).toBe('audit_trail');
    expect(source.label).toBe('Audit trail');
    expect(source.totalRows).toBe(5000);
    expect(source.oldestRecordAt).toBe('2024-03-01T08:00:00+00:00');
    expect(source.options.map((o: { retentionDays: number }) => o.retentionDays)).toEqual([365, 180, 90]);
    expect(source.options.map((o: { eligibleRows: number }) => o.eligibleRows)).toEqual([1200, 2500, 3900]);

    // Slice 2a: the archive fields exist now, because M1's tables can be read.
    // Deliberate change of the Slice 1 pin, which asserted their absence (SA Q-3).
    expect(Object.keys(body.data).sort()).toEqual(['generatedAt', 'runs', 'runsEnabled', 'sources']);
    expect(Object.keys(source).sort()).toEqual([
      'archivedTotal',
      'key',
      'label',
      'lastRun',
      'latestCutoff',
      'oldestRecordAt',
      'options',
      'totalRows',
    ]);
    expect(source.archivedTotal).toBe(0);
    expect(source.latestCutoff).toBeNull();
    expect(source.lastRun).toBeNull();
    expect(body.data.runs).toEqual([]);
  });

  it('I-5: every cutoff is the same now minus N days, and that Date is what the repository gets', async () => {
    asAdmin();

    const body = await (await GET(req())).json();

    const expected = [365, 180, 90].map((days) => new Date(NOW.getTime() - days * DAY).toISOString());
    expect(body.data.sources[0].options.map((o: { cutoff: string }) => o.cutoff)).toEqual(expected);
    expect(countBefore.mock.calls.map(([cutoff]) => (cutoff as Date).toISOString())).toEqual(expected);
  });

  it('I-6: an empty table reads as zero rows and no oldest record', async () => {
    asAdmin();
    countAll.mockResolvedValue({ data: 0, error: null });
    oldest.mockResolvedValue({ data: null, error: null });
    eligibleByCutoff({ 365: 0, 180: 0, 90: 0 });

    const res = await GET(req());
    const source = (await res.json()).data.sources[0];

    expect(res.status).toBe(200);
    expect(source.totalRows).toBe(0);
    expect(source.oldestRecordAt).toBeNull();
    expect(source.options.map((o: { eligibleRows: number }) => o.eligibleRows)).toEqual([0, 0, 0]);
  });

  it('ignores the query string: a retentionDays parameter changes nothing', async () => {
    asAdmin();
    const body = await (await GET(req())).json();
    expect(body.data.sources[0].options).toHaveLength(3);
    expect(countBefore).toHaveBeenCalledTimes(3);
  });
});

describe('failures', () => {
  it.each([
    ['the total', () => countAll.mockResolvedValue({ data: null, error: new Error('total failed') })],
    ['the oldest record', () => oldest.mockResolvedValue({ data: null, error: new Error('oldest failed') })],
    [
      'one eligible count',
      () =>
        countBefore.mockImplementation(async (cutoff: Date) =>
          Math.round((NOW.getTime() - cutoff.getTime()) / DAY) === 180
            ? { data: null, error: new Error('eligible failed') }
            : { data: 1, error: null }
        ),
    ],
  ])('I-7: a failed read of %s is a 500 with no partial data and no details', async (_label, fail) => {
    asAdmin();
    fail();
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';

    try {
      const res = await GET(req());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'Could not read the archiving overview' });
      expect(body).not.toHaveProperty('data');
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous as string;
    }
  });

  it.each([
    ['the total', () => countAll.mockResolvedValue({ data: null, error: null })],
    [
      'one eligible count',
      () =>
        countBefore.mockImplementation(async (cutoff: Date) =>
          Math.round((NOW.getTime() - cutoff.getTime()) / DAY) === 90
            ? { data: null, error: null }
            : { data: 1, error: null }
        ),
    ],
  ])('CR-3: a null count for %s with no error is a 500, never a zero', async (_label, fail) => {
    asAdmin();
    fail();

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('data');
  });

  it('I-7: development shows the details', async () => {
    asAdmin();
    countAll.mockResolvedValue({ data: null, error: new Error('total failed') });
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'development';

    try {
      const body = await (await GET(req())).json();
      expect(body.details).toBe('total failed');
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous as string;
    }
  });

  it('I-8: a repository that throws is a 500, logged with err', async () => {
    asAdmin();
    countAll.mockRejectedValue(new Error('exploded'));

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Could not read the archiving overview');
    const errorLog = logs.find((entry) => entry.level === 'error');
    expect(errorLog?.ctx.err).toBeInstanceOf(Error);
  });
});

describe('Slice 2a: the archive side', () => {
  it('A-1: reads the archived total and latest cutoff for audit_trail, and 20 runs', async () => {
    asAdmin();
    countArchived.mockResolvedValue({ data: 4321, error: null });
    latestCutoff.mockResolvedValue({ data: '2025-09-26T12:00:00.000Z', error: null });

    const source = (await (await GET(req())).json()).data.sources[0];

    expect(countArchived).toHaveBeenCalledWith('audit_trail');
    expect(latestCutoff).toHaveBeenCalledWith('audit_trail');
    expect(listRuns).toHaveBeenCalledWith({ limit: 20 });
    expect(source.archivedTotal).toBe(4321);
    expect(source.latestCutoff).toBe('2025-09-26T12:00:00.000Z');
  });

  it('A-2: maps each run, newest first, with the admin email and a numeric count', async () => {
    asAdmin();
    listRuns.mockResolvedValue({
      data: [
        runRow({ id: 'run-2', status: 'partial', started_at: '2026-09-26T11:30:00.000Z', finished_at: '2026-09-26T11:30:46.000Z' }),
        runRow(),
      ],
      error: null,
    });

    const data = (await (await GET(req())).json()).data;

    expect(data.runs.map((run: { id: string }) => run.id)).toEqual(['run-2', 'run-1']);
    expect(data.runs[1]).toEqual({
      id: 'run-1',
      source: 'audit_trail',
      status: 'succeeded',
      retentionDays: 365,
      cutoff: '2025-09-26T12:00:00.000Z',
      rowsArchived: 1200,
      batches: 2,
      startedBy: ADMIN_UUID,
      startedByLabel: 'ops@example.com',
      startedAt: '2026-09-26T11:00:00.000Z',
      lastBatchAt: '2026-09-26T11:00:30.000Z',
      finishedAt: '2026-09-26T11:00:31.000Z',
      errorCode: null,
      isStale: false,
    });
    expect(data.sources[0].lastRun.id).toBe('run-2');
  });

  it('A-3: a former admin shows a short id, not a guess', async () => {
    asAdmin();
    listRuns.mockResolvedValue({ data: [runRow({ started_by: FORMER_ADMIN_UUID })], error: null });

    const run = (await (await GET(req())).json()).data.runs[0];

    expect(run.startedByLabel).toBe('Admin bbbbbbbb');
  });

  it('A-4: an unreadable admin list only costs the labels, not the page', async () => {
    asAdmin();
    listRuns.mockResolvedValue({ data: [runRow()], error: null });
    listActiveAdmins.mockResolvedValue({ data: null, error: new Error('admin_users down') });

    const res = await GET(req());
    const run = (await res.json()).data.runs[0];

    expect(res.status).toBe(200);
    expect(run.startedByLabel).toBe('Admin aaaaaaaa');
    expect(logs.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('A-5: the admin list is not read when there are no runs', async () => {
    asAdmin();
    await GET(req());
    expect(listActiveAdmins).not.toHaveBeenCalled();
  });

  it.each([
    ['silent for more than 5 minutes', { last_batch_at: new Date(NOW.getTime() - 5 * 60_000 - 1).toISOString() }, true],
    ['silent for exactly 5 minutes', { last_batch_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() }, false],
    ['never batched, started 6 minutes ago', { last_batch_at: null, started_at: new Date(NOW.getTime() - 6 * 60_000).toISOString() }, true],
    ['never batched, started 1 minute ago', { last_batch_at: null, started_at: new Date(NOW.getTime() - 60_000).toISOString() }, false],
  ])('A-6: a running run %s is stale = %p', async (_label, overrides, stale) => {
    asAdmin();
    listRuns.mockResolvedValue({
      data: [runRow({ status: 'running', finished_at: null, ...overrides })],
      error: null,
    });

    const run = (await (await GET(req())).json()).data.runs[0];

    expect(run.isStale).toBe(stale);
  });

  it('A-6: a finished run is never stale, however old', async () => {
    asAdmin();
    listRuns.mockResolvedValue({
      data: [runRow({ status: 'failed', last_batch_at: '2020-01-01T00:00:00.000Z', error_code: 'batch_failed' })],
      error: null,
    });
    const run = (await (await GET(req())).json()).data.runs[0];
    expect(run.isStale).toBe(false);
    expect(run.errorCode).toBe('batch_failed');
  });

  it.each([
    ['the archived count errors', () => countArchived.mockResolvedValue({ data: null, error: new Error('x') })],
    ['the archived count is null with no error', () => countArchived.mockResolvedValue({ data: null, error: null })],
    ['the latest cutoff errors', () => latestCutoff.mockResolvedValue({ data: null, error: new Error('x') })],
    ['the run list errors', () => listRuns.mockResolvedValue({ data: null, error: new Error('x') })],
    ['a run has an unknown status', () => listRuns.mockResolvedValue({ data: [runRow({ status: 'weird' })], error: null })],
    ['a run count is not a number', () => listRuns.mockResolvedValue({ data: [runRow({ rows_archived: 'lots' })], error: null })],
  ])('A-7: 500 with no partial data when %s', async (_label, fail) => {
    asAdmin();
    fail();

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('data');
  });

  it('A-8: GET never writes: it reports staleness but takes nothing over', () => {
    expect(routeCode).not.toMatch(/takeOver|createRun|claimRun|finishRun|runBatch|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  });
});

describe('I-9: correlation id', () => {
  it('uses the x-correlation-id header when present', async () => {
    asAdmin();
    await GET(req({ 'x-correlation-id': 'corr-123' }));
    expect(childContexts).toContainEqual({ correlationId: 'corr-123', adminId: 'admin-1' });
  });

  it('generates a UUID when absent', async () => {
    asAdmin();
    await GET(req());
    const ctx = childContexts.find((c) => 'correlationId' in c);
    expect(String(ctx?.correlationId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('logs counts only, never the email', async () => {
    asAdmin();
    await GET(req());
    expect(JSON.stringify(logs)).not.toContain('admin@example.com');
  });
});

describe('I-10: source rules', () => {
  it('the first statement of GET is `await requireAdmin(` (gate position, OI-20)', () => {
    const opener = /export async function GET\s*\([^)]*\)\s*\{/.exec(routeCode);
    expect(opener).not.toBeNull();
    const body = routeCode.slice((opener?.index ?? 0) + (opener?.[0].length ?? 0)).trim();
    expect(body).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('exports GET only: no write verb', () => {
    expect(routeCode).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/);
    expect(routeCode).not.toMatch(/export\s+const\s+(POST|PUT|PATCH|DELETE)\b/);
  });

  it('never decides admin-ness itself and never touches the database directly', () => {
    expect(routeCode).not.toMatch(/AdminAccessService|profiles|app_metadata/);
    expect(routeCode).not.toMatch(/supabase/i);
    expect(routeCode).not.toMatch(/\.from\(/);
  });

  it('does not log through console', () => {
    expect(routeSource).not.toMatch(/console\./);
  });
});
