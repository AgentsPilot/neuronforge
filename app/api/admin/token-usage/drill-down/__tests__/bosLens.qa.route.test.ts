/**
 * GET /api/admin/token-usage/drill-down — ADMIN_BOS_CLEANUP slice 3, QA edge cases.
 *
 * Locks branches bosLens.route.test.ts does not reach (QA report 2026-10-03):
 * Q-1 an "All" execution whose run record names no agent, Q-2 an execution id
 * with no ledger rows and no run record, Q-3 malformed values in a Business OS
 * request: the same generic 400, no read, and no value in any log line.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

jest.mock('@/lib/logger', () => {
  const methods = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
  const child: Record<string, unknown> = methods();
  child.child = () => child;
  const moduleLogger: Record<string, unknown> = methods();
  moduleLogger.child = () => child;
  return { createLogger: () => moduleLogger, __loggers: { moduleLogger, child } };
});

type TableResult = { data: unknown; error: unknown };
let mockTableResults: Record<string, TableResult> = {};
const mockFrom = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      mockFrom(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'single', 'limit', 'range', 'gte', 'lte', 'neq', 'is', 'not', 'or', 'maybeSingle']) {
        chain[m] = () => chain;
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

const EXEC = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';

const call = (query: string) => GET(new NextRequest(`http://localhost/api/admin/token-usage/drill-down${query}`));
const allLoggerCalls = (): unknown[][] =>
  [moduleLogger, child].flatMap((l) => [l.info, l.warn, l.error, l.debug].flatMap((fn) => fn.mock.calls));

const ledgerRow = {
  id: 't1',
  created_at: '2026-09-03T10:00:00.000Z',
  user_id: '99999999-9999-4999-8999-999999999999',
  execution_id: EXEC,
  provider: 'openai',
  model_name: 'gpt-4o',
  activity_type: null,
  activity_name: null,
  activity_step: null,
  workflow_step: 'step1',
  category: null,
  request_type: null,
  feature: null,
  component: null,
  endpoint: null,
  input_tokens: 10,
  output_tokens: 5,
  cost_usd: '0.002',
  latency_ms: 100,
  success: true,
  call_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockListRows.mockResolvedValue({ data: [], error: null });
  mockTableResults = {};
});

describe('execution detail edge cases (QA)', () => {
  it('Q-1: a run with no agent returns timing and status, agent null, and never reads agents', async () => {
    mockTableResults = {
      token_usage: { data: [ledgerRow], error: null },
      workflow_executions: {
        data: { agent_id: null, started_at: '2026-09-03T10:00:00.000Z', completed_at: null, status: 'failed' },
        error: null,
      },
    };
    const res = await call(`?scope=all&execution=${EXEC}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.executionDetails).toEqual({
      executionId: EXEC,
      startedAt: '2026-09-03T10:00:00.000Z',
      completedAt: null,
      status: 'failed',
      agent: null,
    });
    expect(body.items).toHaveLength(1);
    expect(mockFrom).not.toHaveBeenCalledWith('agents');
    expect(child.error).not.toHaveBeenCalled();
  });

  it('Q-2: an execution id with no ledger rows and no run record is an empty 200, not an error', async () => {
    mockTableResults = {
      token_usage: { data: [], error: null },
      workflow_executions: { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    };
    const res = await call(`?scope=all&execution=${EXEC}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.totals.calls).toBe(0);
    expect(body.executionDetails.agent).toBeNull();
    expect(child.error).not.toHaveBeenCalled();
    expect(moduleLogger.error).not.toHaveBeenCalled();
  });
});

describe('malformed Business OS requests (QA)', () => {
  it.each([
    ['scope=bos&execution=not-a-uuid', 'not-a-uuid'],
    ['scope=bos&execution=single-planted-value', 'planted-value'],
    ['scope=bos&category=planted-value', 'planted-value'],
    ['scope=bos&breakdownBy=planted-value', 'planted-value'],
    ['scope=bos&agent=planted-value', 'planted-value'],
    [`scope=BOS&agent=${AGENT}`, AGENT],
  ])('Q-3: %s is the generic 400, makes no read, and logs no value', async (qs, planted) => {
    const res = await call(`?${qs}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid query parameters' });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockListRows).not.toHaveBeenCalled();
    expect(JSON.stringify(allLoggerCalls())).not.toContain(planted);
  });
});
