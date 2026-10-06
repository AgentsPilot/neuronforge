/**
 * GET /api/user/data-export (BD-26, SA W26-7).
 *
 * The owner's export leaves out internal admin audit entries: the audit query
 * carries the owner-hidden entity types and the AI action prefix exclusion,
 * after the select. The route's logging is Pino (no console), with a
 * correlation id, `userId` as a field and counts only. The audit read filters
 * on `created_at`, so audit history now reaches the export, still without the
 * hidden entries; the plugin connection's provider profile is allow-listed;
 * the 500 body carries no error text outside development
 * (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-1, SA C-1, FU-P2).
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
/** Per-test table rows; when unset a table returns [] (audit_trail one visible row). */
const mockSeeds: Record<string, Array<Record<string, unknown>>> = {};

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
  const seeded = mockSeeds[table] ?? (table === 'audit_trail' ? [{ id: 'row-1', action: 'USER_LOGIN' }] : []);
  // Resolved lazily so the filters recorded on the chain are applied.
  const result = () => ({ data: mockApplyNotFilters(seeded, calls), error: null });
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

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
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

const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' };

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/user/data-export', { headers });
}

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  for (const key of Object.keys(mockCalls)) delete mockCalls[key];
  for (const key of Object.keys(mockSeeds)) delete mockSeeds[key];
  mockGetUser.mockReset();
  mockAuditLog.mockReset();
  mockAuditLog.mockResolvedValue(undefined);
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

  it('leaves owner-hidden audit entries out of the export query (BD-26), after the select', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    const res = await GET(request());
    expect(res.status).toBe(200);

    const audit = mockCalls.audit_trail;
    expect(audit).toBeDefined();
    const notIn = audit.findIndex(
      (c) =>
        c[0] === 'not' &&
        c[1] === 'entity_type' &&
        c[2] === 'in' &&
        // ADMIN_BOS_CLEANUP slice 7b added bos_queue_item (migration 20261035).
        c[3] === '(ai_action,bos_queue_item,business_os_account_plan,business_os_credit_lot,business_os_credit_period)'
    );
    const notLike = audit.findIndex((c) => c[0] === 'not' && c[1] === 'action' && c[2] === 'like' && c[3] === 'BUSINESS_AI_ACTION_%');
    const select = audit.findIndex((c) => c[0] === 'select');
    expect(select).toBe(0);
    // FU-P1: an explicit list, never `*`, and never the tamper hash or the email copy.
    expect(audit[select][1]).not.toBe('*');
    expect(String(audit[select][1]).split(', ')).not.toContain('hash');
    expect(String(audit[select][1]).split(', ')).not.toContain('user_email');
    expect(notIn).toBeGreaterThan(select);
    expect(notLike).toBeGreaterThan(select);
    expect(audit).toContainEqual(['eq', 'user_id', OWNER.id]);
    // FU-1 (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md): `created_at`, never the non-existent `timestamp`.
    expect(audit.some((c) => c[0] === 'gte' && c[1] === 'created_at')).toBe(true);
    expect(audit).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(audit.some((c) => c[1] === 'timestamp')).toBe(false);

    const body = JSON.parse(await res.text());
    expect(body.audit_logs).toEqual([{ id: 'row-1', action: 'USER_LOGIN' }]);
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="neuronforge-data-export-');
  });

  it('still records the export in the audit trail, as before', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
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
    expect(completed?.fields).toMatchObject({ userId: OWNER.id, totalAuditLogs: 1 });
    for (const value of Object.entries(completed?.fields ?? {}).filter(([key]) => key !== 'userId').map(([, v]) => v)) {
      expect(typeof value).toBe('number');
    }
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

  it('logs a failed audit write as an error with { err } and still returns the export', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockAuditLog.mockRejectedValue(new Error('queue full'));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const failed = mockLogged.find((l) => l.msg === 'Data export audit logging failed (non-critical)');
    expect(failed).toMatchObject({ level: 'error', fields: { err: { message: 'queue full' }, userId: OWNER.id } });
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

  it('exports the audit rows the read returns, counted in the summary (FU-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.audit_trail = [
      { id: 'row-1', action: 'USER_LOGIN', entity_type: 'user' },
      { id: 'row-2', action: 'AGENT_CREATED', entity_type: 'agent' },
    ];
    const body = JSON.parse(await (await GET(request())).text());
    expect(body.audit_logs.map((r: { id: string }) => r.id)).toEqual(['row-1', 'row-2']);
    expect(body.summary.total_audit_logs).toBe(2);
  });

  it('still leaves owner-hidden audit rows out when the read returns them (BD-26)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    mockSeeds.audit_trail = [
      { id: 'visible', action: 'USER_LOGIN', entity_type: 'user' },
      { id: 'hidden-type', action: 'ADMIN_CREDIT_LOT_GRANTED', entity_type: 'business_os_credit_lot' },
      { id: 'hidden-ai', action: 'BUSINESS_AI_ACTION_COMPLETED', entity_type: 'business_os_contact' },
    ];
    const body = JSON.parse(await (await GET(request())).text());
    expect(body.audit_logs.map((r: { id: string }) => r.id)).toEqual(['visible']);
    expect(body.summary.total_audit_logs).toBe(1);
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
    expect(body.plugin_connections).toHaveLength(1);
    expect(body.plugin_connections[0].account_profile).toEqual({
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
    expect(body.plugin_connections.map((c: { account_profile: unknown }) => c.account_profile)).toEqual([{}, {}, {}]);
  });

  it('reads nothing on the browser anon client (C-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    await GET(request());
    expect(Object.keys(mockCalls).filter((k) => k.startsWith('anon:'))).toEqual([]);
    expect(mockCalls.agent_executions).toBeDefined();
  });
});
