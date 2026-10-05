/**
 * Characterization pin for GET /api/user/data-export
 * (DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md §4.1, SA C-1 / C-2).
 *
 * Written against the route BEFORE its reads moved into repositories, and kept
 * unedited afterwards: the refactor must not change what the export reads, in
 * what order, on which client, or what it returns.
 *
 * - `@supabase/supabase-js` createClient is the service-role client (the route's
 *   own client before the move, the `supabaseServer` singleton after it). It
 *   records under `service:<table>`.
 * - `@supabase/ssr` createBrowserClient is the anon browser client (what
 *   `@/lib/supabaseClient` builds). It records under `anon:<table>`, so a read
 *   that lands on it fails the pin (C-1). createServerClient carries auth only.
 * - Only the route's own log lines are asserted, never the total log count: the
 *   repositories add their own error log on a failed read (C-2).
 * - The clock is frozen, so the cut-off dates, `export_date`, the duration and
 *   the file name are deterministic.
 */

import { NextRequest } from 'next/server';

type Call = [string, ...unknown[]];
type Result = { data: unknown; error: unknown };

/** Recorded calls per `<client>:<table>`, and the order the tables were read in. */
const mockCalls: Record<string, Call[]> = {};
const mockReadOrder: string[] = [];
/** What each table resolves to; set per test. */
const mockResults: Record<string, Result> = {};

const mockChainMethods = ['select', 'eq', 'neq', 'not', 'in', 'is', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike', 'or', 'order', 'limit', 'range'];

function mockBuilder(client: string, table: string) {
  const key = `${client}:${table}`;
  mockReadOrder.push(key);
  const calls: Call[] = (mockCalls[key] = mockCalls[key] ?? []);
  const result = (): Result => mockResults[table] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of mockChainMethods) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = () => {
      calls.push([terminal]);
      return Promise.resolve(result());
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => mockBuilder('service', table) }),
}));

const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: () => mockGetUser() } }),
  createBrowserClient: () => ({ from: (table: string) => mockBuilder('anon', table) }),
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

const NOW = '2026-07-15T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
// No DST change between these dates and NOW in common zones, so the route's
// local-time setDate / setFullYear give these exact instants.
const NINETY_DAYS_AGO = '2026-04-16T12:00:00.000Z';
const ONE_YEAR_AGO = '2025-07-15T12:00:00.000Z';

const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' };
// ADMIN_BOS_CLEANUP slice 7b added bos_queue_item (migration 20261035).
const HIDDEN_TYPES = '(ai_action,bos_queue_item,business_os_account_plan,business_os_credit_lot,business_os_credit_period)';

const TABLES = [
  'profiles',
  'agents',
  'agent_executions',
  'agent_configurations',
  'plugin_connections',
  'user_subscriptions',
  'credit_transactions',
  'audit_trail',
] as const;
type Table = (typeof TABLES)[number];

const EXPECTED_CHAINS: Record<Table, Call[]> = {
  profiles: [['select', '*'], ['eq', 'id', OWNER.id], ['single']],
  agents: [['select', '*'], ['eq', 'user_id', OWNER.id], ['order', 'created_at', { ascending: false }]],
  agent_executions: [
    ['select', '*'],
    ['eq', 'user_id', OWNER.id],
    ['gte', 'created_at', NINETY_DAYS_AGO],
    ['order', 'created_at', { ascending: false }],
    ['limit', 1000],
  ],
  agent_configurations: [['select', '*'], ['eq', 'user_id', OWNER.id], ['order', 'created_at', { ascending: false }]],
  plugin_connections: [['select', 'user_id, plugin_key, created_at, updated_at, metadata'], ['eq', 'user_id', OWNER.id]],
  user_subscriptions: [['select', '*'], ['eq', 'user_id', OWNER.id], ['single']],
  credit_transactions: [
    ['select', '*'],
    ['eq', 'user_id', OWNER.id],
    ['gte', 'created_at', ONE_YEAR_AGO],
    ['order', 'created_at', { ascending: false }],
    ['limit', 5000],
  ],
  audit_trail: [
    ['select', '*'],
    ['eq', 'user_id', OWNER.id],
    ['not', 'entity_type', 'in', HIDDEN_TYPES],
    ['not', 'action', 'like', 'BUSINESS_AI_ACTION_%'],
    // FU-1, unchanged on purpose: `timestamp` does not exist.
    ['gte', 'timestamp', NINETY_DAYS_AGO],
    ['order', 'timestamp', { ascending: false }],
    ['limit', 10000],
  ],
};

const PROFILE = { id: OWNER.id, email: 'profile@example.com', full_name: 'Ada Owner', company: 'Acme' };
const AGENTS = [
  { id: 'agent-2', status: 'deleted' },
  { id: 'agent-1', status: 'active' },
];
const EXECUTIONS = [{ id: 'exec-1', agent_id: 'agent-1' }];
const CONFIGURATIONS = [{ id: 'cfg-1', agent_id: 'agent-1' }];
const CONNECTIONS = [
  {
    user_id: OWNER.id,
    plugin_key: 'google-mail',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    metadata: { email: 'a@example.com' },
    access_token: 'never-exported',
  },
  { user_id: OWNER.id, plugin_key: 'slack', created_at: '2026-02-02T00:00:00Z', updated_at: '2026-03-02T00:00:00Z', metadata: null },
];
const SUBSCRIPTION = { user_id: OWNER.id, status: 'active', balance: 100 };
const TRANSACTIONS = [{ id: 'tx-1', amount: 5 }];
const AUDIT_ROWS = [{ id: 'row-1', action: 'USER_LOGIN' }];

const POSTGREST_ERROR = { message: 'boom', code: 'XX000', details: null, hint: null };

function seed(): void {
  mockResults.profiles = { data: PROFILE, error: null };
  mockResults.agents = { data: AGENTS, error: null };
  mockResults.agent_executions = { data: EXECUTIONS, error: null };
  mockResults.agent_configurations = { data: CONFIGURATIONS, error: null };
  mockResults.plugin_connections = { data: CONNECTIONS, error: null };
  mockResults.user_subscriptions = { data: SUBSCRIPTION, error: null };
  mockResults.credit_transactions = { data: TRANSACTIONS, error: null };
  mockResults.audit_trail = { data: AUDIT_ROWS, error: null };
}

/** The export body the route builds for given sections, in the route's key order. */
function expectedBody(sections: {
  profile: Record<string, unknown> | null;
  agents: unknown[];
  executions: unknown[];
  configurations: unknown[];
  connections: Array<Record<string, unknown>>;
  subscriptions: unknown[];
  transactions: unknown[];
  audit: unknown[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    export_metadata: {
      user_id: OWNER.id,
      export_date: NOW,
      export_format: 'JSON',
      gdpr_article: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
      data_controller: 'NeuronForge',
    },
    user_profile: { id: OWNER.id, email: OWNER.email, created_at: OWNER.created_at, ...(sections.profile ?? {}) },
    agents: sections.agents,
    agent_executions: sections.executions,
    agent_configurations: sections.configurations,
    plugin_connections: sections.connections,
    subscriptions: sections.subscriptions,
    transactions: sections.transactions,
    audit_logs: sections.audit,
  };
  body.summary = {
    total_agents: sections.agents.length,
    total_executions: sections.executions.length,
    total_configurations: sections.configurations.length,
    total_plugin_connections: sections.connections.length,
    total_transactions: sections.transactions.length,
    total_audit_logs: sections.audit.length,
    export_size_kb: Math.round(JSON.stringify(body).length / 1024),
    export_duration_ms: 0,
  };
  return body;
}

const MAPPED_CONNECTIONS = [
  { plugin_key: 'google-mail', connected_at: '2026-02-01T00:00:00Z', last_updated: '2026-03-01T00:00:00Z', metadata: { email: 'a@example.com' } },
  { plugin_key: 'slack', connected_at: '2026-02-02T00:00:00Z', last_updated: '2026-03-02T00:00:00Z', metadata: null },
];

const FULL_SECTIONS = {
  profile: PROFILE as Record<string, unknown> | null,
  agents: AGENTS,
  executions: EXECUTIONS,
  configurations: CONFIGURATIONS,
  connections: MAPPED_CONNECTIONS,
  subscriptions: [SUBSCRIPTION],
  transactions: TRANSACTIONS,
  audit: AUDIT_ROWS,
};

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/user/data-export', { headers });
}

const routeLine = (msg: string) => mockLogged.find((l) => l.msg === msg);

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_MS, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  for (const key of Object.keys(mockCalls)) delete mockCalls[key];
  for (const key of Object.keys(mockResults)) delete mockResults[key];
  mockReadOrder.length = 0;
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
  jest.useRealTimers();
});

describe('GET /api/user/data-export: characterization pin', () => {
  it('401 with no session, and reads nothing on any client', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(JSON.parse(await res.text())).toEqual({ error: 'Unauthorized' });
    expect(mockReadOrder).toEqual([]);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('401 on an auth error, and reads nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: { message: 'jwt expired' } });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockReadOrder).toEqual([]);
  });

  it('reads the eight tables once each, in order, all on the service-role client', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request());
    expect(mockReadOrder).toEqual(TABLES.map((t) => `service:${t}`));
    expect(Object.keys(mockCalls).filter((k) => k.startsWith('anon:'))).toEqual([]);
  });

  it.each(TABLES)('pins the full query chain on %s', async (table) => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request());
    expect(mockCalls[`service:${table}`]).toEqual(EXPECTED_CHAINS[table]);
  });

  it('returns the full export body for a seeded account (profile spread, plugin mapping, summary)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    // Exact text: key order and the 2-space indentation are part of the export.
    expect(text).toBe(JSON.stringify(expectedBody(FULL_SECTIONS), null, 2));
    const body = JSON.parse(text);
    // Profile keys override the auth fields.
    expect(body.user_profile.email).toBe('profile@example.com');
    // Credentials never reach the export.
    expect(text).not.toContain('never-exported');
  });

  it('sets the download headers', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const res = await GET(request());
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="neuronforge-data-export-${OWNER.id}-${NOW_MS}.json"`);
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="neuronforge-data-export-');
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
  });

  it('exports [] subscriptions and the bare auth profile when there is no profile or subscription row', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockResults.profiles = { data: null, error: null };
    mockResults.user_subscriptions = { data: null, error: null };
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedBody({ ...FULL_SECTIONS, profile: null, subscriptions: [] }), null, 2));
  });

  const EMPTY_SECTION: Record<Table, Partial<typeof FULL_SECTIONS>> = {
    profiles: { profile: null },
    agents: { agents: [] },
    agent_executions: { executions: [] },
    agent_configurations: { configurations: [] },
    plugin_connections: { connections: [] },
    user_subscriptions: { subscriptions: [] },
    credit_transactions: { transactions: [] },
    audit_trail: { audit: [] },
  };

  it.each(TABLES)('a PostgREST error on %s gives an empty section and still a 200', async (table) => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockResults[table] = { data: null, error: POSTGREST_ERROR };
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedBody({ ...FULL_SECTIONS, ...EMPTY_SECTION[table] }), null, 2));
    expect(routeLine('Data export failed')).toBeUndefined();
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
  });

  it('every table failing still gives a 200 with every section empty', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    for (const table of TABLES) mockResults[table] = { data: null, error: POSTGREST_ERROR };
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      JSON.stringify(
        expectedBody({ profile: null, agents: [], executions: [], configurations: [], connections: [], subscriptions: [], transactions: [], audit: [] }),
        null,
        2
      )
    );
  });

  it('records the export in the audit trail with the summary and request details', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'pin-agent' }));
    const body = expectedBody(FULL_SECTIONS);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog.mock.calls[0][0]).toEqual({
      action: 'DATA_EXPORTED',
      entityType: 'user',
      entityId: OWNER.id,
      userId: OWNER.id,
      resourceName: OWNER.email,
      details: {
        export_timestamp: NOW,
        export_format: 'JSON',
        data_categories: [
          'user_profile',
          'agents',
          'agent_executions',
          'agent_configurations',
          'plugin_connections',
          'subscriptions',
          'transactions',
          'audit_logs',
        ],
        summary: body.summary,
        gdpr_basis: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
        ip_address: '203.0.113.7',
        user_agent: 'pin-agent',
      },
      severity: 'info',
      complianceFlags: ['GDPR', 'SOC2'],
    });
  });

  it("logs the route's own lines: started, completed (counts only), audit logged; correlation id from the header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request({ 'x-correlation-id': 'corr-pin' }));
    expect(mockChildBindings).toContainEqual({ correlationId: 'corr-pin' });
    expect(routeLine('Data export started')).toEqual({ level: 'info', fields: { userId: OWNER.id }, msg: 'Data export started' });
    const summary = expectedBody(FULL_SECTIONS).summary as Record<string, number>;
    expect(routeLine('Data export completed')).toEqual({
      level: 'info',
      msg: 'Data export completed',
      fields: {
        userId: OWNER.id,
        totalAgents: 2,
        totalExecutions: 1,
        totalConfigurations: 1,
        totalPluginConnections: 2,
        totalTransactions: 1,
        totalAuditLogs: 1,
        exportSizeKb: summary.export_size_kb,
        durationMs: 0,
      },
    });
    expect(routeLine('Data export audit logged')).toEqual({ level: 'info', fields: { userId: OWNER.id }, msg: 'Data export audit logged' });
    expect(routeLine('Data export failed')).toBeUndefined();
  });

  it('a failed audit write is logged as an error and the export is still returned', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockAuditLog.mockRejectedValue(new Error('queue full'));
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedBody(FULL_SECTIONS), null, 2));
    expect(routeLine('Data export audit logging failed (non-critical)')).toEqual({
      level: 'error',
      msg: 'Data export audit logging failed (non-critical)',
      fields: { err: { name: 'Error', message: 'queue full' }, userId: OWNER.id },
    });
    expect(routeLine('Data export audit logged')).toBeUndefined();
  });

  it('an unexpected throw gives 500 with the pinned body (FU-P2: message is exposed as is)', async () => {
    mockGetUser.mockRejectedValue(new Error('auth service down'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(JSON.parse(await res.text())).toEqual({ error: 'Data export failed', message: 'auth service down' });
    expect(routeLine('Data export failed')).toEqual({
      level: 'error',
      msg: 'Data export failed',
      fields: { err: { name: 'Error', message: 'auth service down' } },
    });
    expect(mockReadOrder).toEqual([]);
  });
});
