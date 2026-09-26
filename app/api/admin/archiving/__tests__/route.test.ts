/**
 * GET /api/admin/archiving (Slice 1): I-1 to I-10.
 *
 * The gate (401 → 403 → fail closed, nothing read before it answers), the
 * payload shape (three options, one `now`, no archived/run fields), the
 * all-or-nothing 500, and the source rules the CI guard cannot see: that
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
jest.mock('@/lib/repositories/ArchiveRepository', () => ({
  archiveRepository: {
    countAuditTrailAllAccounts: () => countAll(),
    getOldestAuditTrailCreatedAtAllAccounts: () => oldest(),
    countAuditTrailBeforeAllAccounts: (cutoff: Date) => countBefore(cutoff),
  },
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
  countAll.mock.calls.length + oldest.mock.calls.length + countBefore.mock.calls.length;

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  childContexts.length = 0;
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  countAll.mockResolvedValue({ data: 5000, error: null });
  oldest.mockResolvedValue({ data: '2024-03-01T08:00:00+00:00', error: null });
  eligibleByCutoff({ 365: 1200, 180: 2500, 90: 3900 });
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
  it('I-4: returns the audit-trail source with all three options, in order, and no run fields', async () => {
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

    // Absent, not zero: nothing can be known about archived rows or runs yet (SA Q-3).
    expect(Object.keys(body.data).sort()).toEqual(['generatedAt', 'runsEnabled', 'sources']);
    expect(Object.keys(source).sort()).toEqual(['key', 'label', 'oldestRecordAt', 'options', 'totalRows']);
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
