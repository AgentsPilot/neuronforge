/**
 * GET /api/user/data-export (SA W26-7; DE-1).
 *
 * The route's logging is Pino (no console), with a correlation id, `userId` as
 * a field and counts only. The plugin connection's provider profile is
 * allow-listed; the 500 body carries no error text outside development
 * (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md SA C-1, FU-P2).
 *
 * DE-1 (BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §6.3): the export holds the
 * account sections only. The audit-read cases (BD-26 exclusions, FU-1 audit
 * rows) went with the audit section (DX-1d); BD-26 itself stays covered by
 * lib/audit/__tests__/ownerAuditReads.guard.test.ts, which now also proves this
 * route reads no audit rows. The `DATA_EXPORTED` entry goes through the real
 * `logAndFlush` here, with the AuditTrail singleton mocked, so its
 * never-rejects contract is exercised end to end.
 * The reads now go through repositories (DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md);
 * the per-method checks live in lib/repositories/__tests__/userDataExportReads.test.ts
 * and the full behaviour pin in route.characterization.test.ts.
 *
 * Supabase, the session cookies and the audit service are mocked; what is
 * asserted is the query the route builds and what it logs. The service-role
 * client (`createClient`, which `supabaseServer` is built with) records under
 * the table name; the browser anon client (`createBrowserClient`, imported via
 * ExecutionRepository's default) records under `anon:<table>` (SA C-1).
 *
 * DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §8 U-9): the eight
 * client_records sections are paged reads, so the mock now honours
 * `.gt('id')`, `.order('id')` and `.limit()`, and strips the quotes of a
 * PostgREST `in` list. The Phase 1 limits are a mutable mock so a test can
 * lower one: over the row ceiling or the body cap the route answers 413 with
 * no file and no DATA_EXPORTED entry.
 *
 * DE-4 (user 2026-10-15): connected apps left the export. The
 * `plugin_connections` profile allow-list cases went with the section; the
 * DE-0a token test stays, now proving the table is never read and no token
 * reaches the body. The file name carries the time on the owner's clock
 * (`user_preferences.timezone`); NULL, invalid or unreadable gives UTC.
 */

import { NextRequest } from 'next/server';

type Call = [string, ...unknown[]];
const mockCalls: Record<string, Call[]> = {};
/** Per-test table rows; when unset a table returns []. */
const mockSeeds: Record<string, Array<Record<string, unknown>>> = {};
/** Per-test PostgREST errors by table (DE-1, FR-E12). */
const mockErrors: Record<string, unknown> = {};

/**
 * Applies the recorded `.not(column, 'in', '(a,b)')` and `.not(column, 'like',
 * 'PREFIX%')` filters to the rows, as PostgREST would, so a test can prove a
 * hidden row seeded into the table never reaches the export.
 * DE-4: an `in` value may be quoted (`("deleted")`); `.gt`, `.order` and
 * `.limit` are applied too, so the paged reader ends on an empty page.
 */
function mockApplyNotFilters(rows: Array<Record<string, unknown>>, calls: Call[]): Array<Record<string, unknown>> {
  let out = rows.filter((row) =>
    calls.every((c) => {
      if (c[0] === 'gt') return String(row[c[1] as string] ?? '') > String(c[2]);
      if (c[0] !== 'not') return true;
      const value = String(row[c[1] as string] ?? '');
      if (c[2] === 'in') return !String(c[3]).slice(1, -1).split(',').map((v) => v.replace(/^"|"$/g, '')).includes(value);
      if (c[2] === 'like') return !value.startsWith(String(c[3]).replace(/%$/, ''));
      throw new Error(`unsupported not filter ${String(c[2])}`);
    })
  );
  const order = calls.find((c) => c[0] === 'order');
  if (order) out = [...out].sort((a, b) => (String(a[order[1] as string]) < String(b[order[1] as string]) ? -1 : 1));
  const limit = calls.find((c) => c[0] === 'limit');
  return limit ? out.slice(0, Number(limit[1])) : out;
}

// DE-4: the Phase 1 limits, lowered per test.
const MOCK_DEFAULT_LIMITS = { ROW_CEILING: 100_000, PAGE_SIZE: 1_000, JSON_BODY_MAX_BYTES: 4_000_000 };
const mockLimits = { ...MOCK_DEFAULT_LIMITS };
jest.mock('@/lib/business-os/data-export/limits', () => ({ EXPORT_LIMITS: mockLimits }));

function mockBuilder(key: string) {
  const table = key.startsWith('anon:') ? key.slice('anon:'.length) : key;
  const recorded: Call[] = (mockCalls[key] = mockCalls[key] ?? []);
  // DE-4: this query's own chain. `recorded` spans every query on the table (a
  // paged read is several), so filters are applied from `calls` only.
  const calls: Call[] = [];
  const seeded = mockSeeds[table] ?? [];
  // Resolved lazily so the filters recorded on the chain are applied. DE-4:
  // the select is honoured, as PostgREST does.
  const result = () => {
    if (mockErrors[table]) return { data: null, error: mockErrors[table] };
    const select = calls.find((c) => c[0] === 'select');
    const columns = String(select?.[1] ?? '').split(',').map((c) => c.trim());
    const rows = mockApplyNotFilters(seeded, calls).map((row) =>
      row && typeof row === 'object' ? Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]])) : row
    );
    return { data: rows, error: null };
  };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'gt', 'gte', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      recorded.push([method, ...args]);
      return builder;
    };
  }
  builder.single = () => {
    recorded.push(['single']);
    return Promise.resolve({ data: null, error: null });
  };
  // DE-1: the profile read is maybeSingle. It honours the select, as PostgREST
  // does, so a seeded column the route does not select (e.g. `plan`) cannot
  // reach the body through the mock.
  builder.maybeSingle = () => {
    recorded.push(['maybeSingle']);
    if (mockErrors[table]) return Promise.resolve({ data: null, error: mockErrors[table] });
    const row = seeded[0];
    if (!row) return Promise.resolve({ data: null, error: null });
    const select = calls.find((c) => c[0] === 'select');
    const columns = String(select?.[1] ?? '').split(',').map((c) => c.trim());
    return Promise.resolve({ data: Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]])), error: null });
  };
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => mockBuilder(table) }),
}));

const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: () => mockGetUser() } }),
  createBrowserClient: () => ({ from: (table: string) => mockBuilder(`anon:${table}`) }),
}));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

// DE-1: the real logAndFlush runs; only the AuditTrail singleton it writes through is mocked.
const mockAuditLog = jest.fn();
const mockAuditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => mockAuditLog(...args),
    flush: () => mockAuditFlush(),
  },
}));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
const mockChildBindings: Array<Record<string, unknown>> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = (bindings: Record<string, unknown>) => {
      mockChildBindings.push(bindings);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

import { GET } from '../route';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' };

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/user/data-export', { headers });
}

type ExportSection = { id: string; status: string; row_count: number; rows: Array<Record<string, unknown>> };

/** One section of the body, by id (DE-1: the body is a list of sections). */
function sectionOf(body: { sections: ExportSection[] }, id: string): ExportSection {
  const found = body.sections.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
}

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  for (const key of Object.keys(mockCalls)) delete mockCalls[key];
  for (const key of Object.keys(mockSeeds)) delete mockSeeds[key];
  for (const key of Object.keys(mockErrors)) delete mockErrors[key];
  Object.assign(mockLimits, MOCK_DEFAULT_LIMITS);
  mockGetUser.mockReset();
  mockAuditLog.mockReset();
  mockAuditLog.mockResolvedValue(undefined);
  mockAuditFlush.mockReset();
  mockAuditFlush.mockResolvedValue(undefined);
  __resetAuditFlushChainForTests();
  mockLogged.length = 0;
  mockChildBindings.length = 0;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('GET /api/user/data-export', () => {
  it('returns 401 with no session and reads nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(Object.keys(mockCalls)).toHaveLength(0);
  });

  it('still records the export in the audit trail, and flushes it before responding (WC-7)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditFlush).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.mock.calls[0][0]).toMatchObject({
      action: 'DATA_EXPORTED',
      entityType: 'user',
      entityId: OWNER.id,
      userId: OWNER.id,
      severity: 'info',
      complianceFlags: ['GDPR', 'SOC2'],
    });
  });

  it('logs with Pino: correlation id from the header, userId as a field, counts only (W26-7)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request({ 'x-correlation-id': 'corr-123' }));
    expect(mockChildBindings).toContainEqual({ correlationId: 'corr-123' });
    const started = mockLogged.find((l) => l.msg === 'Data export started');
    expect(started).toMatchObject({ level: 'info', fields: { userId: OWNER.id } });
    const completed = mockLogged.find((l) => l.msg === 'Data export completed');
    // DE-1: section counts and the failed list, was total_* counts.
    expect(completed?.fields).toMatchObject({ userId: OWNER.id, failedSections: [] });
    expect(Object.keys(completed?.fields ?? {}).sort()).toEqual(['durationMs', 'exportSizeKb', 'failedSections', 'sectionCounts', 'userId']);
    for (const value of Object.values(completed?.fields.sectionCounts as Record<string, unknown>)) {
      expect(typeof value).toBe('number');
    }
    expect(typeof completed?.fields.exportSizeKb).toBe('number');
    expect(typeof completed?.fields.durationMs).toBe('number');
    // No emoji anywhere in what is logged. The ranges are numeric code points so
    // this file carries no escape sequences (repo rule, QA26-1).
    const emojiRanges: Array<[number, number]> = [
      [0x1f300, 0x1faff],
      [0x2600, 0x27bf],
    ];
    const isEmoji = (ch: string): boolean => {
      const cp = ch.codePointAt(0) ?? 0;
      return emojiRanges.some(([lo, hi]) => cp >= lo && cp <= hi);
    };
    expect(Array.from(JSON.stringify(mockLogged)).filter(isEmoji)).toEqual([]);
    // Negative control: the scan does catch an emoji.
    expect(Array.from(`x${String.fromCodePoint(0x1f600)}y`).some(isEmoji)).toBe(true);
  });

  it('falls back to a generated correlation id', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(typeof mockChildBindings[0]?.correlationId).toBe('string');
    expect(String(mockChildBindings[0]?.correlationId).length).toBeGreaterThan(0);
  });

  // DE-1 (WC-7): logAndFlush logs the failure itself and never rejects.
  it('logs a failed audit write as an error with { err } and still returns the export', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockAuditFlush.mockRejectedValue(new Error('queue full'));
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(sectionOf(JSON.parse(await res.text()), 'account_identity').status).toBe('ok');
    const failed = mockLogged.find((l) => l.msg === 'Audit flush on data export failed; the export is still returned');
    expect(failed).toMatchObject({ level: 'error', fields: { err: { message: 'queue full' }, userId: OWNER.id, action: 'DATA_EXPORTED' } });
    expect(mockLogged.find((l) => l.msg === 'Data export failed')).toBeUndefined();
  });

  it('logs an unexpected failure with { err } and returns 500', async () => {
    // OP-4: a repository now catches a rejecting table read and returns
    // `{ error }`, so the only throw that reaches the route's catch is one
    // outside the reads. Driven by a rejecting getUser().
    mockGetUser.mockRejectedValue(new Error('relation "secret_table" does not exist'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    const failed = mockLogged.find((l) => l.msg === 'Data export failed');
    expect(failed).toMatchObject({ level: 'error', fields: { err: { message: 'relation "secret_table" does not exist' } } });
  });

  describe('the 500 body (FU-P2, DATA_EXPORT_FOLLOWUPS_WORKPLAN.md)', () => {
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;
    afterEach(() => {
      env.NODE_ENV = originalNodeEnv;
    });

    it('in production carries no message, no details and none of the error text', async () => {
      env.NODE_ENV = 'production';
      mockGetUser.mockRejectedValue(new Error('relation "secret_table" does not exist'));
      const res = await GET(request());
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ success: false, error: 'Data export failed' });
      expect(text).not.toContain('secret_table');
    });

    it('in development carries the message as details', async () => {
      env.NODE_ENV = 'development';
      mockGetUser.mockRejectedValue(new Error('relation "secret_table" does not exist'));
      const res = await GET(request());
      expect(res.status).toBe(500);
      expect(JSON.parse(await res.text())).toEqual({
        success: false,
        error: 'Data export failed',
        details: 'relation "secret_table" does not exist',
      });
    });
  });

  // DE-4 (user 2026-10-15): the two plugin_connections profile_data cases
  // ("exports only the allow-listed provider profile strings", "gives an empty
  // account_profile") were removed with the section; the DE-0a describe below
  // keeps the token assertions.

  it('reads nothing on the browser anon client (C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(Object.keys(mockCalls).filter((k) => k.startsWith('anon:'))).toEqual([]);
    // DE-1: was agent_executions, the read that used to default to the anon client.
    // DE-4 (user 2026-10-15): plugin_connections is never read; user_preferences is (the file name's clock).
    expect(mockCalls.plugin_connections).toBeUndefined();
    expect(mockCalls.profiles).toBeDefined();
    expect(mockCalls.user_preferences).toBeDefined();
  });

  it('holds none of the parts DE-1 removed, as a key or as a section (DX-1, BQ-SA-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    const body = JSON.parse(await (await GET(request())).text());
    const sectionIds = body.sections.map((s: ExportSection) => s.id);
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(Object.keys(body)).not.toContain(removed);
      expect(sectionIds).not.toContain(removed);
    }
    // DE-4: + the eight client_records sections and their tables.
    // DE-4 (user 2026-10-15): plugin_connections removed; + user_preferences (the file name's clock).
    expect(sectionIds).toEqual([
      'account_identity', 'user_profile',
      'pipeline_stages', 'clients', 'client_activities', 'client_tasks', 'client_documents', 'services', 'bookings', 'time_off',
    ]);
    expect(Object.keys(mockCalls).sort()).toEqual([
      'contact_documents', 'crm_activities', 'crm_contacts', 'crm_pipeline_stages', 'crm_tasks', 'profiles',
      'scheduling_availability_exceptions', 'scheduling_bookings', 'scheduling_services', 'user_preferences',
    ]);
    // BC-5: the calendar copy is never read.
    expect(mockCalls.external_calendar_events).toBeUndefined();
  });

  it('never exports profiles.plan, even when the row has one (DE-1, SA Q-3 / C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    // A sentinel, not a tier name: tier literals are forbidden outside the entitlements config.
    mockSeeds.profiles = [{ id: OWNER.id, full_name: 'Ada Owner', plan: 'qa-plan-value', hourly_rate_usd: 50 }];
    const text = await (await GET(request())).text();
    const profile = sectionOf(JSON.parse(text), 'user_profile');
    expect(profile.status).toBe('ok');
    expect(profile.rows).toEqual([{ id: OWNER.id, full_name: 'Ada Owner', hourly_rate_usd: 50 }]);
    expect(Object.keys(profile.rows[0])).not.toContain('plan');
    expect(text).not.toContain('"plan"');
    expect(text).not.toContain('qa-plan-value');
  });

  // DE-4 (user 2026-10-15): driven through profiles, was plugin_connections.
  it('marks a failed profiles read as failed, still 200, with no error text (FR-E12)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockErrors.profiles = { message: 'relation "secret_table" does not exist', code: '42P01' };
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(sectionOf(body, 'user_profile')).toMatchObject({ status: 'failed', row_count: 0, rows: [] });
    expect(body.summary.failed_sections).toEqual(['user_profile']);
    expect(text).not.toContain('secret_table');
    expect(text).not.toContain('42P01');
  });
});

describe('DE-4: client records and the Phase 1 ceiling (U-9)', () => {
  const C1 = '10000000-0000-4000-8000-000000000001';
  const C2 = '20000000-0000-4000-8000-000000000002';

  function seedClients(): void {
    mockSeeds.crm_contacts = [
      {
        id: C1,
        user_id: OWNER.id,
        first_name: 'Dana',
        source_metadata: { capture_channel: 'website', ip_hash: 'QA-IP-HASH', user_agent: 'QA-UA', session_id: 'QA-SESSION' },
      },
      { id: C2, user_id: OWNER.id, first_name: 'Noa', source_metadata: null },
    ];
    mockSeeds.contact_documents = [
      { id: '30000000-0000-4000-8000-000000000003', user_id: OWNER.id, name: 'kept-archived-doc', status: 'archived' },
      { id: '40000000-0000-4000-8000-000000000004', user_id: OWNER.id, name: 'QA-DELETED-DOC', status: 'deleted', storage_path: 'QA-STORAGE-PATH' },
    ];
  }

  it('exports the client records: deleted documents out, archived in, only the BC-4 source keys', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(sectionOf(body, 'clients').rows.map((r) => r.first_name)).toEqual(['Dana', 'Noa']);
    expect(sectionOf(body, 'clients').rows[0].source_metadata).toEqual({ capture_channel: 'website' });
    expect(sectionOf(body, 'client_documents').rows.map((r) => r.name)).toEqual(['kept-archived-doc']);
    for (const leaked of ['QA-IP-HASH', 'QA-UA', 'QA-SESSION', 'QA-DELETED-DOC', 'QA-STORAGE-PATH', '"storage_path"']) {
      expect(text).not.toContain(leaked);
    }
    expect(body.export_metadata.groups.client_records).toMatchObject({ gdpr_role: 'processor', controller: 'account_holder' });
    // The audit entry gains the eight counts, counts only.
    const details = mockAuditLog.mock.calls[0][0].details;
    expect(details.section_counts).toMatchObject({ clients: 2, client_documents: 1, bookings: 0 });
    expect(JSON.stringify(details)).not.toContain('Dana');
  });

  it('ignores a planted ?userId= and x-user-id: every read is keyed on the session id', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    const OTHER = '99999999-9999-4999-8999-999999999999';
    const res = await GET(new NextRequest(`http://localhost/api/user/data-export?userId=${OTHER}`, { headers: { 'x-user-id': OTHER } }));
    expect(res.status).toBe(200);
    const eqCalls = Object.values(mockCalls).flat().filter((c) => c[0] === 'eq');
    expect(eqCalls.length).toBeGreaterThan(10);
    for (const c of eqCalls) expect(c[2]).toBe(OWNER.id);
    expect(JSON.stringify(mockCalls)).not.toContain(OTHER);
  });

  const TOO_LARGE = {
    success: false,
    error: 'Your account holds more than the on-screen download can package. Nothing was downloaded. Please contact support and we will prepare your export.',
    code: 'export_too_large',
  };

  it('over the row ceiling: 413, the pinned body, no-store, no file, no DATA_EXPORTED; warn with counts only', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    // identity 1 + clients 2 = 3 > 2.
    mockLimits.ROW_CEILING = 2;
    const res = await GET(request());
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(TOO_LARGE);
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(text).not.toContain('Dana');
    expect(mockAuditLog).not.toHaveBeenCalled();
    const warn = mockLogged.find((l) => l.msg === 'Data export refused: over the Phase 1 ceiling');
    expect(warn).toMatchObject({ level: 'warn', fields: { event: 'data_export_over_ceiling', userId: OWNER.id, limit: 'rows', rowCeiling: 2, atSection: 'clients' } });
    expect(Object.keys(warn?.fields ?? {}).sort()).toEqual(['atSection', 'durationMs', 'event', 'limit', 'rowCeiling', 'sectionCounts', 'userId']);
    expect(JSON.stringify(mockLogged)).not.toContain('Dana');
    expect(mockLogged.find((l) => l.msg === 'Data export completed')).toBeUndefined();
  });

  it('over the body cap: the same 413, measured on the exact bytes (negative control: a 1 KB cap refuses a normal export)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seedClients();
    // A frozen Date.now, so export_duration_ms (and so the byte count) is the same on every call.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-15T12:00:00.000Z'));
    try {
      const normal = await GET(request());
      expect(normal.status).toBe(200);
      const bytes = Buffer.byteLength(await normal.text(), 'utf8');
      expect(bytes).toBeGreaterThan(1024);

      mockAuditLog.mockClear();
      mockLimits.JSON_BODY_MAX_BYTES = 1024;
      const res = await GET(request());
      expect(res.status).toBe(413);
      expect(JSON.parse(await res.text())).toEqual(TOO_LARGE);
      expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
      expect(mockAuditLog).not.toHaveBeenCalled();
      const warn = mockLogged.filter((l) => l.msg === 'Data export refused: over the Phase 1 ceiling').pop();
      expect(warn).toMatchObject({ level: 'warn', fields: { event: 'data_export_over_ceiling', limit: 'body', bodyBytes: bytes, bodyMaxBytes: 1024 } });

      // Exactly at the cap is sent: the check is "over", on the same string.
      mockLimits.JSON_BODY_MAX_BYTES = bytes;
      expect((await GET(request())).status).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('DE-0a: plugin_connections tokens never reach the export body (QA)', () => {
  // SA DE-4 F-4: this mock honours `select`, so it would drop a token column the
  // route did not select before any mapper saw it. The raw-row token check, a
  // mock that returns every seeded column unprojected, lives in
  // route.characterization.test.ts (its CONNECTIONS seed and `never-exported`
  // assertions). Keep that mock raw.
  // DE-4 (user 2026-10-15): connected apps left the export. This case now
  // proves the table is never read at all, and that no token string, key or
  // connection field appears anywhere in the body; was "exports one
  // connection with only account_profile { name }".
  it('a connection row carrying access_token / refresh_token / credentials / token-bearing profile_data exports none of them', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.plugin_connections = [
      {
        user_id: OWNER.id,
        plugin_key: 'google-mail',
        plugin_name: 'Gmail',
        username: 'Ada',
        email: 'a@example.com',
        status: 'active',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
        access_token: 'QA-ACCESS-TOKEN-SECRET',
        refresh_token: 'QA-REFRESH-TOKEN-SECRET',
        credentials: { api_key: 'QA-CREDENTIALS-SECRET' },
        expires_at: '2099-01-01',
        settings: { webhook_secret: 'QA-SETTINGS-SECRET' },
        profile_data: { name: 'Ada', access_token: 'QA-PROFILE-ACCESS', refresh_token: 'QA-PROFILE-REFRESH', id_token: 'QA-PROFILE-ID' },
      },
    ];
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    // DE-4 (user 2026-10-15): never read, on any client; no section.
    expect(mockCalls.plugin_connections).toBeUndefined();
    expect(mockCalls['anon:plugin_connections']).toBeUndefined();
    expect(body.sections.map((x: ExportSection) => x.id)).not.toContain('plugin_connections');
    for (const key of ['access_token', 'refresh_token', 'credentials', 'profile_data', 'id_token', 'expires_at', 'settings', 'plugin_key', 'account_profile']) {
      expect(text).not.toContain(`"${key}"`);
    }
    for (const secret of ['QA-ACCESS-TOKEN-SECRET', 'QA-REFRESH-TOKEN-SECRET', 'QA-CREDENTIALS-SECRET', 'QA-SETTINGS-SECRET', 'QA-PROFILE-ACCESS', 'QA-PROFILE-REFRESH', 'QA-PROFILE-ID']) {
      expect(text).not.toContain(secret);
    }
    // DE-4 (user 2026-10-15): nor any connection field (the connection had a name and an account).
    expect(text).not.toContain('Gmail');
    expect(text).not.toContain('google-mail');
    // Nor in the audit entry or the logs.
    expect(JSON.stringify(mockAuditLog.mock.calls)).not.toContain('QA-ACCESS-TOKEN-SECRET');
    expect(JSON.stringify(mockLogged)).not.toContain('QA-ACCESS-TOKEN-SECRET');
  });
});

describe("DE-4 (user 2026-10-15): the file name's clock never fails the export", () => {
  it('the owner timezone is read through the repository, keyed on the session id, one explicit column', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.user_preferences = [{ user_id: OWNER.id, timezone: 'Asia/Jerusalem', preferred_language: 'he' }];
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(mockCalls.user_preferences).toEqual([['select', 'timezone'], ['eq', 'user_id', OWNER.id], ['maybeSingle']]);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="agentpilot-data-export-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/);
  });

  // SA Low (DE-4 review): a `Date.now` spy does not reach the route's
  // `new Date()`, so the name was never pinned here. A frozen system clock
  // fixes both, and the UTC name is asserted.
  const UTC_NAME = 'attachment; filename="agentpilot-data-export-2026-07-15-2230.json"';
  const freezeClock = () =>
    jest.useFakeTimers({ now: Date.parse('2026-07-15T22:30:00.000Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  const TZ_WARN = 'Data export: timezone unreadable, file name in UTC';

  it('a timezone read error: still 200 with a UTC name, the error text in no body, a warn line', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockErrors.user_preferences = { message: 'relation "secret_prefs" does not exist', code: '42P01' };
    freezeClock();
    try {
      const res = await GET(request());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toBe(UTC_NAME);
      const text = await res.text();
      expect(text).not.toContain('secret_prefs');
      expect(JSON.parse(text).summary.failed_sections).toEqual([]);
      expect(mockAuditLog).toHaveBeenCalledTimes(1);
      expect(mockLogged.find((l) => l.msg === TZ_WARN)).toMatchObject({ level: 'warn', fields: { userId: OWNER.id } });
      expect(mockLogged.find((l) => l.msg === 'Data export failed')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // QA delta DE-4 Edge case 1: `findTimezone` never throws by contract, so the
  // catch in `ownerTimezone` is defensive. A throw still gives the export, in UTC.
  it('a timezone read that throws: still 200, the UTC name, the same body as a stored UTC, one warn, no failure line', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    freezeClock();
    const throwSpy = jest.spyOn(userPreferencesRepository, 'findTimezone');
    try {
      // Baseline: a stored UTC, at the same frozen instant.
      mockSeeds.user_preferences = [{ user_id: OWNER.id, timezone: 'UTC' }];
      const baseline = await GET(request());
      expect(baseline.status).toBe(200);
      expect(baseline.headers.get('Content-Disposition')).toBe(UTC_NAME);
      const baselineText = await baseline.text();

      mockLogged.length = 0;
      throwSpy.mockRejectedValueOnce(new Error('prefs exploded: relation "secret_prefs"'));
      const res = await GET(request());
      expect(throwSpy).toHaveBeenCalledWith(OWNER.id);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toBe(UTC_NAME);
      const text = await res.text();
      expect(text).toBe(baselineText);
      expect(text).not.toContain('secret_prefs');
      const warns = mockLogged.filter((l) => l.msg === TZ_WARN);
      expect(warns).toHaveLength(1);
      // The catch logs { err, userId }: ids and the error object, nothing else.
      expect(warns[0]).toMatchObject({ level: 'warn', fields: { userId: OWNER.id } });
      expect(Object.keys(warns[0].fields).sort()).toEqual(['err', 'userId']);
      expect(mockLogged.find((l) => l.msg === 'Data export failed')).toBeUndefined();
    } finally {
      throwSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
