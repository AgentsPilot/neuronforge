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
 *
 * Deliberately re-pinned by DATA_EXPORT_FOLLOWUPS_WORKPLAN.md (SA C-2): the
 * eight selects (FU-P1), the audit `created_at` filter and order (FU-1), the
 * plugin connection seed and mapping (NF-1, SA C-1) and the 500 body (FU-P2).
 * Each changed expectation carries a comment naming that workplan; everything
 * else is unchanged.
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

// DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P1 (intended change): every read names
// its columns instead of `*`. Written out literally so a list change is a
// visible diff here.
const SELECTS: Record<Table, string> = {
  profiles:
    'id, full_name, avatar_url, plan, company, job_title, timezone, language, created_at, updated_at, ' +
    'role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data, hourly_rate_usd, org_id',
  agents:
    'id, agent_name, user_prompt, user_id, created_at, system_prompt, description, is_archived, ' +
    'input_schema, output_schema, connected_plugins, status, mode, schedule_cron, trigger_conditions, ' +
    'plugins_required, deactivation_reason, workflow_steps, generated_plan, ai_reasoning, ai_confidence, ' +
    'detected_categories, created_from_prompt, ai_generated_at, agent_config, last_run, next_run, timezone, ' +
    'updated_at, schedule_enabled, intensity_score, last_intensity_update, pilot_steps, deleted_at, ' +
    'production_ready, production_ready_at, calibration_run_count, insights_enabled, workflow_purpose, ' +
    'is_calibrated, pilot_steps_original, business_entity_type, entity_detection_confidence, ' +
    'entity_desirability, manual_time_per_item_seconds, items_per_week_baseline, org_id, tags, ' +
    'calibration_prompt_decision, calibration_prompt_decided_at, hourly_rate_usd, calibration_status',
  agent_executions:
    'id, agent_id, execution_type, scheduled_at, started_at, completed_at, status, result, error_message, ' +
    'execution_duration_ms, retry_count, next_retry_at, created_at, updated_at, progress, user_id, ' +
    'cron_expression, next_scheduled_run, logs, run_mode, primary_model, primary_provider, routing_tier, ' +
    'complexity_score',
  agent_configurations:
    'id, agent_id, user_id, status, input_values, input_schema, total_logs, confidence, quality_score, ' +
    'duration_ms, plugins_used, business_context, data_processed, completed_at, created_at, updated_at',
  plugin_connections:
    'user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, ' +
    'created_at, updated_at, last_used, disconnected_at, profile_data',
  user_subscriptions:
    'id, user_id, balance, total_earned, total_spent, created_at, updated_at, status, ' +
    'current_period_start, current_period_end, next_billing_date, credits_used_this_cycle, ' +
    'credits_carried_over, payment_method_last4, payment_method_brand, billing_cycle, ' +
    'pilot_credits_allocated_this_cycle, pilot_credits_used_this_cycle, pilot_credits_carried_over, ' +
    'total_lifetime_credits, cancel_at_period_end, canceled_at, trial_ends_at, monthly_amount_usd, ' +
    'monthly_credits, subscription_type, free_trial_used, trial_credits_granted, last_calculator_inputs, ' +
    'agents_paused, payment_retry_count, last_payment_attempt, storage_quota_mb, storage_used_mb, ' +
    'storage_alert_threshold, executions_quota, executions_used, executions_alert_threshold, ' +
    'free_tier_granted_at, free_tier_expires_at, free_tier_initial_amount, account_frozen, ' +
    'stripe_customer_id, stripe_subscription_id, stripe_price_id',
  credit_transactions:
    'id, user_id, credits_delta, transaction_type, description, related_agent_id, created_at, ' +
    'token_usage_id, activity_type, balance_before, balance_after, boost_pack_id, reward_config_id, ' +
    'stripe_payment_intent_id, metadata, activity_name, agent_id, session_id',
  audit_trail:
    'id, user_id, actor_id, action, entity_type, entity_id, resource_name, changes, details, ' +
    'ip_address, user_agent, session_id, severity, compliance_flags, created_at',
};

const EXPECTED_CHAINS: Record<Table, Call[]> = {
  // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P1: every ['select', SELECTS.x] below was ['select', '*'].
  profiles: [['select', SELECTS.profiles], ['eq', 'id', OWNER.id], ['single']],
  agents: [['select', SELECTS.agents], ['eq', 'user_id', OWNER.id], ['order', 'created_at', { ascending: false }]],
  agent_executions: [
    ['select', SELECTS.agent_executions],
    ['eq', 'user_id', OWNER.id],
    ['gte', 'created_at', NINETY_DAYS_AGO],
    ['order', 'created_at', { ascending: false }],
    ['limit', 1000],
  ],
  agent_configurations: [['select', SELECTS.agent_configurations], ['eq', 'user_id', OWNER.id], ['order', 'created_at', { ascending: false }]],
  // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md NF-1 / SA C-1: was 'user_id, plugin_key, created_at, updated_at, metadata' (`metadata` does not exist).
  plugin_connections: [['select', SELECTS.plugin_connections], ['eq', 'user_id', OWNER.id]],
  user_subscriptions: [['select', SELECTS.user_subscriptions], ['eq', 'user_id', OWNER.id], ['single']],
  credit_transactions: [
    ['select', SELECTS.credit_transactions],
    ['eq', 'user_id', OWNER.id],
    ['gte', 'created_at', ONE_YEAR_AGO],
    ['order', 'created_at', { ascending: false }],
    ['limit', 5000],
  ],
  audit_trail: [
    ['select', SELECTS.audit_trail],
    ['eq', 'user_id', OWNER.id],
    ['not', 'entity_type', 'in', HIDDEN_TYPES],
    ['not', 'action', 'like', 'BUSINESS_AI_ACTION_%'],
    // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-1 (intended change): was `timestamp`, which does not exist.
    ['gte', 'created_at', NINETY_DAYS_AGO],
    ['order', 'created_at', { ascending: false }],
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
// DATA_EXPORT_FOLLOWUPS_WORKPLAN.md NF-1 / SA C-1 (intended change): the seed
// carries the newly read columns instead of the non-existent `metadata`, and a
// `profile_data` holding a token, a provider id and a nested object.
const CONNECTIONS = [
  {
    user_id: OWNER.id,
    plugin_key: 'google-mail',
    plugin_name: 'Gmail',
    username: 'Ada Owner',
    email: 'a@example.com',
    scope: 'gmail.readonly',
    status: 'active',
    connected_at: '2026-01-31T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    last_used: '2026-03-05T00:00:00Z',
    disconnected_at: null,
    profile_data: { name: 'Ada Owner', sub: 'provider-id-1', token: 'never-exported-profile-token', address: { city: 'X' } },
    access_token: 'never-exported',
  },
  {
    user_id: OWNER.id,
    plugin_key: 'slack',
    plugin_name: null,
    username: null,
    email: null,
    scope: null,
    status: 'disconnected',
    connected_at: null,
    created_at: '2026-02-02T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    last_used: null,
    disconnected_at: '2026-03-02T00:00:00Z',
    profile_data: null,
  },
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

// DATA_EXPORT_FOLLOWUPS_WORKPLAN.md NF-1 / OP-2 / SA C-1 (intended change): the
// new per-connection keys; `metadata` dropped; `connected_at` falls back to
// `created_at`; only allow-listed profile strings.
const MAPPED_CONNECTIONS = [
  {
    plugin_key: 'google-mail',
    plugin_name: 'Gmail',
    account_username: 'Ada Owner',
    account_email: 'a@example.com',
    account_profile: { name: 'Ada Owner' },
    scope: 'gmail.readonly',
    status: 'active',
    connected_at: '2026-01-31T00:00:00Z',
    last_updated: '2026-03-01T00:00:00Z',
    last_used: '2026-03-05T00:00:00Z',
    disconnected_at: null,
  },
  {
    plugin_key: 'slack',
    plugin_name: null,
    account_username: null,
    account_email: null,
    account_profile: {},
    scope: null,
    status: 'disconnected',
    connected_at: '2026-02-02T00:00:00Z',
    last_updated: '2026-03-02T00:00:00Z',
    last_used: null,
    disconnected_at: '2026-03-02T00:00:00Z',
  },
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

  // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P2 (intended change): the body no longer carries the error message outside development.
  it('an unexpected throw gives 500 with the pinned body (FU-P2: no message, no details outside development)', async () => {
    mockGetUser.mockRejectedValue(new Error('auth service down'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P2: was { error: 'Data export failed', message: 'auth service down' }.
    expect(JSON.parse(await res.text())).toEqual({ success: false, error: 'Data export failed' });
    expect(routeLine('Data export failed')).toEqual({
      level: 'error',
      msg: 'Data export failed',
      fields: { err: { name: 'Error', message: 'auth service down' } },
    });
    expect(mockReadOrder).toEqual([]);
  });
});
