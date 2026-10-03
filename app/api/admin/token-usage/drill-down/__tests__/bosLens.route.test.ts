/**
 * GET /api/admin/token-usage/drill-down — ADMIN_BOS_CLEANUP slice 3.
 *
 * 1. Business OS scope refuses the AgentsPilot-only views (C3-3): agent and
 *    execution group-bys, any agent or execution id, any category. The refusal
 *    happens before any read, and "All" scope is unchanged.
 * 2. The "All" scope execution detail reads metadata only (C3-5, NF-3/TA-8):
 *    the database mock deliberately RETURNS the owner-text columns with
 *    planted SECRET- markers, so these tests prove the route's own selects and
 *    mapping, not the mock. The step-name lookup is retired (W3-1).
 * 3. Failed execution-detail reads are logged on the request logger (C3-7),
 *    and no log line carries a planted marker (W3-4).
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

// Two distinct loggers, so a test can tell the request logger (child, carries
// the correlation id) from the module logger. Built inside the factory because
// route.ts calls createLogger while it is being imported.
jest.mock('@/lib/logger', () => {
  const methods = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
  const child: Record<string, unknown> = methods();
  child.child = () => child;
  const moduleLogger: Record<string, unknown> = methods();
  moduleLogger.child = () => child;
  return { createLogger: () => moduleLogger, __loggers: { moduleLogger, child } };
});

type QueryRecord = { table: string; select?: string; eqs: Array<[string, unknown]> };
type TableResult = { data: unknown; error: unknown };

const mockQueries: QueryRecord[] = [];
let mockTableResults: Record<string, TableResult> = {};
const mockFrom = jest.fn();

// Per-table recording mock: every chain method records and returns the chain;
// awaiting the chain resolves to the result the test set for that table.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      mockFrom(table);
      const record: QueryRecord = { table, eqs: [] };
      mockQueries.push(record);
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.select = (cols: string) => {
        record.select = cols;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        record.eqs.push([col, val]);
        return chain;
      };
      for (const m of ['in', 'order', 'single', 'limit', 'range', 'gte', 'lte', 'neq', 'is', 'not', 'or', 'maybeSingle']) {
        chain[m] = passthrough;
      }
      chain.then = (resolve: (v: TableResult) => void) => resolve(mockTableResults[table] ?? { data: [], error: null });
      return chain;
    },
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  }),
}));

const mockListRows = jest.fn();
jest.mock('@/lib/repositories/AdminTokenUsageAnalyticsRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/AdminTokenUsageAnalyticsRepository');
  return {
    ...actual,
    adminTokenUsageAnalyticsRepository: {
      listRowsAllAccountsInWindow: (...args: unknown[]) => mockListRows(...args),
    },
  };
});

import { GET } from '../route';

type MockLogger = { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
const { moduleLogger, child } = jest.requireMock('@/lib/logger').__loggers as {
  moduleLogger: MockLogger;
  child: MockLogger;
};

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const EXEC = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';
const TOKEN_ROW_ID = '55555555-5555-4555-8555-555555555555';

const call = (query: string) => GET(new NextRequest(`http://localhost/api/admin/token-usage/drill-down${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const allLoggerCalls = (): unknown[][] =>
  [moduleLogger, child].flatMap((l) => [l.info, l.warn, l.error, l.debug].flatMap((fn) => fn.mock.calls));

const OWNER_TEXT_KEYS = ['userPrompt', 'systemPrompt', 'pilotSteps', 'inputSchema', 'outputSchema', 'inputData', 'outputData'];

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockListRows.mockReset();
  mockListRows.mockResolvedValue({ data: [], error: null });
  mockFrom.mockClear();
  mockQueries.length = 0;
  mockTableResults = {};
  for (const l of [moduleLogger, child]) {
    l.info.mockClear();
    l.warn.mockClear();
    l.error.mockClear();
    l.debug.mockClear();
  }
});

// --- 5.1 Business OS refusals and "All" unchanged ---------------------------

const REFUSED: Array<[string, string, string]> = [
  ['B-1', 'breakdownBy=agent', 'breakdownBy'],
  ['B-2', 'breakdownBy=execution', 'breakdownBy'],
  ['B-3', `execution=${EXEC}`, 'execution'],
  ['B-4', `execution=single-${TOKEN_ROW_ID}`, 'execution'],
  ['B-5', `agent=${AGENT}`, 'agent'],
  ['B-6', 'category=memory', 'category'],
];

describe('scope=bos refuses the AgentsPilot-only views (C3-3)', () => {
  it.each(REFUSED)('%s: 400 for scope=bos&%s, before any read', async (_id, param, name) => {
    asAdmin();
    const res = await call(`?scope=bos&${param}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid query parameters' });
    expect(mockListRows).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    // The 400 came from the Business OS refinement, not a field check (W3-6).
    expect(child.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rejectedForBosScope: [name] }),
      expect.any(String)
    );
  });

  it('B-7: agent=no-agent is refused; category=all is allowed', async () => {
    asAdmin();
    expect((await call('?scope=bos&agent=no-agent')).status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
    expect((await call('?scope=bos&category=all')).status).toBe(200);
  });

  it('B-8: the refusal log names the parameters, never their values', async () => {
    asAdmin();
    await call(`?scope=bos&breakdownBy=execution&execution=single-${TOKEN_ROW_ID}&agent=${AGENT}`);
    const warns = child.warn.mock.calls;
    expect(warns).toHaveLength(1);
    expect(warns[0][0].rejectedForBosScope.sort()).toEqual(['agent', 'breakdownBy', 'execution']);
    const logged = JSON.stringify(allLoggerCalls());
    expect(logged).not.toContain(TOKEN_ROW_ID);
    expect(logged).not.toContain(AGENT);
    expect(logged).not.toContain('single-');
  });

  it('B-9: the body is the same generic shape whatever caused the 400', async () => {
    asAdmin();
    const fieldCheck = await (await call('?scope=bos&agent=abc')).text();
    const bosRefusal = await (await call(`?scope=bos&agent=${AGENT}`)).text();
    expect(bosRefusal).toBe(fieldCheck);
    expect(JSON.parse(bosRefusal)).toEqual({ success: false, error: 'Invalid query parameters' });
  });

  it.each(['feature', 'component', 'user', 'model', 'provider', 'activity'])(
    'A-8: scope=bos&breakdownBy=%s is still allowed',
    async (dim) => {
      asAdmin();
      expect((await call(`?scope=bos&breakdownBy=${dim}`)).status).toBe(200);
    }
  );
});

describe('"All" scope is unchanged (S3-3)', () => {
  it.each(REFUSED)('A-1..A-6 (%s): 200 for scope=all&%s', async (_id, param) => {
    asAdmin();
    expect((await call(`?scope=all&${param}`)).status).toBe(200);
  });

  it.each(REFUSED)('A-7 (%s): 200 for %s with no scope (route default "all")', async (_id, param) => {
    asAdmin();
    expect((await call(`?${param}`)).status).toBe(200);
  });
});

// --- 5.2 The execution detail reads metadata only ---------------------------

function tokenRow(id: string, workflowStep: string | null, cost: string) {
  return {
    id,
    created_at: '2026-09-03T10:00:00.000Z',
    user_id: '99999999-9999-4999-8999-999999999999',
    execution_id: EXEC,
    provider: 'openai',
    model_name: 'gpt-4o',
    activity_type: null,
    activity_name: null,
    activity_step: null,
    workflow_step: workflowStep,
    category: null,
    request_type: null,
    feature: null,
    component: null,
    endpoint: null,
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: cost,
    latency_ms: 100,
    success: true,
    call_id: null,
  };
}

/** Every table returns MORE than the route should ask for, owner text included. */
function seedExecution(overrides: Partial<Record<string, TableResult>> = {}) {
  mockTableResults = {
    token_usage: { data: [tokenRow('t1', 'step1', '0.002'), tokenRow('t2', null, '0.001')], error: null },
    workflow_executions: {
      data: {
        agent_id: AGENT,
        started_at: '2026-09-03T10:00:00.000Z',
        completed_at: '2026-09-03T10:01:00.000Z',
        status: 'completed',
        input_data: 'SECRET-input',
        output_data: 'SECRET-output',
      },
      error: null,
    },
    agents: {
      data: {
        id: AGENT,
        agent_name: 'Invoice chaser',
        user_prompt: 'SECRET-user-prompt',
        system_prompt: 'SECRET-system-prompt',
        pilot_steps: [{ id: 'step1', name: 'SECRET-pilot-step' }],
        input_schema: { field: 'SECRET-input-schema' },
        output_schema: { field: 'SECRET-output-schema' },
        connected_plugins: ['google-mail'],
        mode: 'on_demand',
        status: 'active',
      },
      error: null,
    },
    workflow_step_executions: { data: [{ step_id: 'step1', step_name: 'SECRET-step-name' }], error: null },
    ...overrides,
  } as Record<string, TableResult>;
}

const selectOf = (table: string) => mockQueries.find((q) => q.table === table)?.select;

function expectNoMarkerInLogs() {
  // W3-4: neither the request logger nor the module logger carries owner text.
  expect(JSON.stringify(allLoggerCalls())).not.toContain('SECRET-');
}

describe('the execution detail reads metadata only (C3-5, W3-1)', () => {
  it('E-1: workflow_executions select names no payload column', async () => {
    asAdmin();
    seedExecution();
    await call(`?scope=all&execution=${EXEC}`);
    const cols = selectOf('workflow_executions');
    expect(cols).toBe('agent_id, started_at, completed_at, status');
    expect(cols).not.toContain('input_data');
    expect(cols).not.toContain('output_data');
  });

  it('E-2: agents select names no prompt, step or schema column', async () => {
    asAdmin();
    seedExecution();
    await call(`?scope=all&execution=${EXEC}`);
    const cols = selectOf('agents');
    expect(cols).toBe('id, agent_name, connected_plugins, mode, status');
    for (const banned of ['user_prompt', 'system_prompt', 'pilot_steps', 'input_schema', 'output_schema']) {
      expect(cols).not.toContain(banned);
    }
  });

  it('E-3: the step-name lookup is retired; the call row keeps its fallback label', async () => {
    asAdmin();
    seedExecution();
    const body = await (await call(`?scope=all&execution=${EXEC}`)).json();
    expect(mockFrom).not.toHaveBeenCalledWith('workflow_step_executions');
    const row = body.items.find((i: { id: string }) => i.id === 't1');
    expect(row.label).toBe('Step 1');
  });

  it('E-4: the serialised response carries no owner-text key and no planted marker', async () => {
    asAdmin();
    seedExecution();
    const res = await call(`?scope=all&execution=${EXEC}`);
    const text = await res.text();
    for (const key of OWNER_TEXT_KEYS) expect(text).not.toContain(key);
    expect(text).not.toContain('SECRET-');
    expectNoMarkerInLogs();
  });

  it('E-5: timing, status and the agent summary come through', async () => {
    asAdmin();
    seedExecution();
    const body = await (await call(`?scope=all&execution=${EXEC}`)).json();
    expect(body.executionDetails).toEqual({
      executionId: EXEC,
      startedAt: '2026-09-03T10:00:00.000Z',
      completedAt: '2026-09-03T10:01:00.000Z',
      status: 'completed',
      agent: { id: AGENT, name: 'Invoice chaser', connectedPlugins: ['google-mail'], mode: 'on_demand', status: 'active' },
    });
    expect(body.items).toHaveLength(2);
    expectNoMarkerInLogs();
  });
});

describe('failed execution-detail reads (C3-7)', () => {
  it('E-6: a failed executions read is logged on the request logger; still 200, agents never read', async () => {
    asAdmin();
    seedExecution({ workflow_executions: { data: null, error: { code: '42703', message: 'column does not exist' } } });
    const res = await call(`?scope=all&execution=${EXEC}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.executionDetails.agent).toBeNull();
    expect(body).not.toHaveProperty('details');
    expect(body).not.toHaveProperty('message');
    expect(JSON.stringify(body)).not.toContain('42703');
    expect(child.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ code: '42703' }), executionId: EXEC }),
      expect.any(String)
    );
    expect(mockFrom).not.toHaveBeenCalledWith('agents');
    expectNoMarkerInLogs();
  });

  it('E-7: no executions row (PGRST116) is not an error', async () => {
    asAdmin();
    seedExecution({ workflow_executions: { data: null, error: { code: 'PGRST116', message: 'no rows' } } });
    const res = await call(`?scope=all&execution=${EXEC}`);
    expect(res.status).toBe(200);
    expect(child.error).not.toHaveBeenCalled();
    expect(moduleLogger.error).not.toHaveBeenCalled();
    expect(child.info).toHaveBeenCalledWith(expect.objectContaining({ executionId: EXEC }), expect.any(String));
    expectNoMarkerInLogs();
  });

  it('E-8: a failed agents read is logged; still 200 with the calls', async () => {
    asAdmin();
    seedExecution({ agents: { data: null, error: { code: 'XX000', message: 'boom' } } });
    const res = await call(`?scope=all&execution=${EXEC}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.executionDetails.agent).toBeNull();
    expect(body.executionDetails.status).toBe('completed');
    expect(child.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ code: 'XX000' }), executionId: EXEC }),
      expect.any(String)
    );
    expectNoMarkerInLogs();
  });

  it('E-9: a failed ledger read is still a 500 without detail, logged on the request logger', async () => {
    asAdmin();
    seedExecution({ token_usage: { data: null, error: { code: 'XX000', message: 'down' } } });
    const res = await call(`?scope=all&execution=${EXEC}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to fetch data' });
    expect(child.error).toHaveBeenCalledWith(expect.objectContaining({ executionId: EXEC }), expect.any(String));
    expectNoMarkerInLogs();
  });

  it('E-10: the single-call path is unchanged', async () => {
    asAdmin();
    mockTableResults = { token_usage: { data: { ...tokenRow(TOKEN_ROW_ID, 'step2', '0.003') }, error: null } };
    const res = await call(`?scope=all&execution=single-${TOKEN_ROW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe('Step 2');
    expect(body.executionDetails).toBeUndefined();
  });
});
