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
 */
function mockApplyNotFilters(rows: Array<Record<string, unknown>>, calls: Call[]): Array<Record<string, unknown>> {
  return rows.filter((row) =>
    calls.every((c) => {
      if (c[0] !== 'not') return true;
      const value = String(row[c[1] as string] ?? '');
      if (c[2] === 'in') return !String(c[3]).slice(1, -1).split(',').includes(value);
      if (c[2] === 'like') return !value.startsWith(String(c[3]).replace(/%$/, ''));
      throw new Error(`unsupported not filter ${String(c[2])}`);
    })
  );
}

function mockBuilder(key: string) {
  const table = key.startsWith('anon:') ? key.slice('anon:'.length) : key;
  const calls: Call[] = (mockCalls[key] = mockCalls[key] ?? []);
  const seeded = mockSeeds[table] ?? [];
  // Resolved lazily so the filters recorded on the chain are applied.
  const result = () =>
    mockErrors[table] ? { data: null, error: mockErrors[table] } : { data: mockApplyNotFilters(seeded, calls), error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'gte', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.single = () => {
    calls.push(['single']);
    return Promise.resolve({ data: null, error: null });
  };
  // DE-1: the profile read is maybeSingle. It honours the select, as PostgREST
  // does, so a seeded column the route does not select (e.g. `plan`) cannot
  // reach the body through the mock.
  builder.maybeSingle = () => {
    calls.push(['maybeSingle']);
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

  it('exports only the allow-listed provider profile strings, never the raw profile_data (SA C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.plugin_connections = [
      {
        user_id: OWNER.id,
        plugin_key: 'outlook',
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
        profile_data: {
          displayName: 'Ada Owner',
          businessPhones: ['+1 555 0100'],
          jobTitle: 'Founder',
          token: 'secret-profile-token',
          signed_access_token: 'secret-signed-token',
          id: 'provider-user-id',
          sub: 'provider-subject',
          address: { street: 'nested-street' },
          locale: { language: 'nested-locale' },
          nickname: ['mixed-array-value', 5],
          brandNewProviderField: 'unknown-key-value',
        },
      },
    ];
    const res = await GET(request());
    const text = await res.text();
    const body = JSON.parse(text);
    // DE-1: the connections are the rows of the plugin_connections section.
    const connections = sectionOf(body, 'plugin_connections').rows;
    expect(connections).toHaveLength(1);
    expect(connections[0].account_profile).toEqual({
      displayName: 'Ada Owner',
      businessPhones: ['+1 555 0100'],
      jobTitle: 'Founder',
    });
    // The raw column never reaches the body, and nothing outside the allow-list does.
    expect(text).not.toContain('profile_data');
    for (const leaked of ['secret-profile-token', 'secret-signed-token', 'provider-user-id', 'provider-subject', 'nested-street', 'nested-locale', 'mixed-array-value', 'unknown-key-value']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('gives an empty account_profile when profile_data is not an object', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.plugin_connections = [null, 'a string', ['name']].map((profile_data, i) => ({
      user_id: OWNER.id,
      plugin_key: `p${i}`,
      profile_data,
    }));
    const body = JSON.parse(await (await GET(request())).text());
    expect(sectionOf(body, 'plugin_connections').rows.map((c) => c.account_profile)).toEqual([{}, {}, {}]);
  });

  it('reads nothing on the browser anon client (C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(Object.keys(mockCalls).filter((k) => k.startsWith('anon:'))).toEqual([]);
    // DE-1: was agent_executions, the read that used to default to the anon client.
    expect(mockCalls.plugin_connections).toBeDefined();
    expect(mockCalls.profiles).toBeDefined();
  });

  it('holds none of the parts DE-1 removed, as a key or as a section (DX-1, BQ-SA-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    const body = JSON.parse(await (await GET(request())).text());
    const sectionIds = body.sections.map((s: ExportSection) => s.id);
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(Object.keys(body)).not.toContain(removed);
      expect(sectionIds).not.toContain(removed);
    }
    expect(sectionIds).toEqual(['account_identity', 'user_profile', 'plugin_connections']);
    expect(Object.keys(mockCalls).sort()).toEqual(['plugin_connections', 'profiles']);
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

  it('marks a failed plugin_connections read as failed, still 200, with no error text (FR-E12)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockErrors.plugin_connections = { message: 'relation "secret_table" does not exist', code: '42P01' };
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(sectionOf(body, 'plugin_connections')).toMatchObject({ status: 'failed', row_count: 0, rows: [] });
    expect(body.summary.failed_sections).toEqual(['plugin_connections']);
    expect(text).not.toContain('secret_table');
    expect(text).not.toContain('42P01');
  });
});

describe('DE-0a: plugin_connections tokens never reach the export body (QA)', () => {
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
    // DE-1: accessor only, the connections are the rows of the plugin_connections section.
    expect(sectionOf(body, 'plugin_connections').rows).toHaveLength(1);
    expect(sectionOf(body, 'plugin_connections').rows[0].account_profile).toEqual({ name: 'Ada' });
    for (const key of ['access_token', 'refresh_token', 'credentials', 'profile_data', 'id_token', 'expires_at', 'settings']) {
      expect(text).not.toContain(`"${key}"`);
    }
    for (const secret of ['QA-ACCESS-TOKEN-SECRET', 'QA-REFRESH-TOKEN-SECRET', 'QA-CREDENTIALS-SECRET', 'QA-SETTINGS-SECRET', 'QA-PROFILE-ACCESS', 'QA-PROFILE-REFRESH', 'QA-PROFILE-ID']) {
      expect(text).not.toContain(secret);
    }
  });
});
