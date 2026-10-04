/**
 * GET /api/admin/users/[id]/stats — the Plugins and AI spend cards of the
 * Businesses detail (ADMIN_BOS_CLEANUP slice 5a, SA conditions C-12, C-14,
 * SA-5a-5).
 *
 * Pins: two reads only (`token_usage`, `plugin_connections`); a failed read
 * comes back as `null` for its section, never as zeros; the id is a UUID
 * checked after the gate and before any read; no error text in the 500 outside
 * development; none of the phantom columns is selected.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

const mockRecordRefused = jest.fn();
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...a: unknown[]) => mockRecordRefused(...a),
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ ...mockLog, child: () => mockLog }),
}));

type ReadResult = { data: unknown; error: unknown };

const mockTablesTouched: string[] = [];
const mockSelects: string[] = [];
let mockResults: Record<string, ReadResult> = {};
let mockFromThrows = false;

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (mockFromThrows) throw new Error('connection reset by peer');
      mockTablesTouched.push(table);
      const result = mockResults[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = (columns: string) => {
        mockSelects.push(columns);
        return builder;
      };
      builder.eq = chain;
      builder.neq = chain;
      builder.gte = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.single = chain;
      builder.then = (resolve: (r: ReadResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  }),
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const TARGET = '99999999-9999-4999-8999-999999999999';

const call = (id: string = TARGET) =>
  GET(new NextRequest(`http://localhost/api/admin/users/${id}/stats`), { params: Promise.resolve({ id }) });

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const TOKEN_ROWS = [
  { model_name: 'gpt-x', provider: 'openai', input_tokens: 100, output_tokens: 50, cost_usd: '0.0100', created_at: '2026-09-20T00:00:00Z' },
  { model_name: 'gpt-x', provider: 'openai', input_tokens: 200, output_tokens: 20, cost_usd: '0.0200', created_at: '2026-09-21T00:00:00Z' },
  { model_name: 'claude-y', provider: 'anthropic', input_tokens: 10, output_tokens: 5, cost_usd: '0.0500', created_at: '2026-09-22T00:00:00Z' },
];
const PLUGIN_ROWS = [
  { plugin_key: 'google-mail', connected_at: '2026-09-01T00:00:00Z', status: 'active' },
  { plugin_key: 'slack', connected_at: '2026-09-02T00:00:00Z', status: 'expired' },
];

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockTablesTouched.length = 0;
  mockSelects.length = 0;
  mockFromThrows = false;
  mockResults = {
    token_usage: { data: TOKEN_ROWS, error: null },
    plugin_connections: { data: PLUGIN_ROWS, error: null },
  };
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV ?? 'test';
});

afterAll(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV ?? 'test';
});

describe('GET /api/admin/users/[id]/stats', () => {
  it('S-1: returns only tokens and plugins, aggregated, from exactly two tables', async () => {
    asAdmin();
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['plugins', 'tokens']);

    expect(body.data.tokens.total_input_tokens).toBe(310);
    expect(body.data.tokens.total_output_tokens).toBe(75);
    expect(body.data.tokens.total_calls).toBe(3);
    expect(body.data.tokens.total_cost_usd).toBeCloseTo(0.08, 10);
    // Ordered by cost, highest first.
    expect(body.data.tokens.by_model.map((m: { model: string }) => m.model)).toEqual([
      'anthropic/claude-y',
      'openai/gpt-x',
    ]);
    expect(body.data.tokens.by_model[1]).toMatchObject({ input: 300, output: 70, calls: 2 });

    expect(body.data.plugins.total).toBe(2);
    expect(body.data.plugins.active).toBe(1);
    expect(body.data.plugins.list[0]).toEqual({ plugin: 'google-mail', connected_at: '2026-09-01T00:00:00Z', is_active: true });

    expect([...mockTablesTouched].sort()).toEqual(['plugin_connections', 'token_usage']);
    for (const retired of ['agents', 'agent_executions', 'user_subscriptions']) {
      expect(mockTablesTouched).not.toContain(retired);
    }
  });

  it('S-2: a failed token_usage read returns tokens as null, never zeros, and logs the section', async () => {
    asAdmin();
    const readError = { code: '42703', message: 'column does not exist' };
    mockResults.token_usage = { data: null, error: readError };
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tokens).toBeNull();
    expect(body.data.plugins.total).toBe(2);
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: readError, section: 'tokens', targetUserId: TARGET }),
      expect.any(String)
    );
  });

  it('S-3: a failed plugin_connections read returns plugins as null, tokens intact', async () => {
    asAdmin();
    mockResults.plugin_connections = { data: null, error: { code: '57014', message: 'timeout' } };
    const body = await (await call()).json();
    expect(body.data.plugins).toBeNull();
    expect(body.data.tokens.total_calls).toBe(3);
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'plugins', targetUserId: TARGET }),
      expect.any(String)
    );
  });

  it('S-4: an id that is not a UUID is a 400 before any read', async () => {
    asAdmin();
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid user id' });
    expect(mockTablesTouched).toEqual([]);
  });

  it('S-5: a thrown error is a 500 with no error text outside development', async () => {
    asAdmin();
    mockFromThrows = true;
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch user statistics');
    expect(body.details).toBeUndefined();
    expect('message' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('connection reset');
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.any(String));
  });

  it('S-5b: in development the 500 carries the error message as details', async () => {
    asAdmin();
    mockFromThrows = true;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    const body = await (await call()).json();
    expect(body.details).toBe('connection reset by peer');
  });

  it('S-6: no phantom column is ever selected', async () => {
    asAdmin();
    await call();
    expect(mockSelects).toHaveLength(2);
    for (const select of mockSelects) {
      for (const phantom of ['total_tokens_used', 'plan_name', 'subscription_status']) {
        expect(select).not.toContain(phantom);
      }
    }
  });

  it('QA-S7: an account with no usage and no plugins gets real zeros, not null', async () => {
    asAdmin();
    mockResults = {
      token_usage: { data: [], error: null },
      plugin_connections: { data: [], error: null },
    };
    const body = await (await call()).json();
    expect(body.data.tokens).toEqual({
      total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0, total_calls: 0, by_model: [],
    });
    expect(body.data.plugins).toEqual({ total: 0, active: 0, list: [] });
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  it('QA-S8: both reads failing is still a 200 with both sections null', async () => {
    asAdmin();
    mockResults = {
      token_usage: { data: null, error: { code: '42P01', message: 'x' } },
      plugin_connections: { data: null, error: { code: '57014', message: 'y' } },
    };
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { tokens: null, plugins: null } });
    expect(mockLog.error).toHaveBeenCalledTimes(2);
  });

  it('401 with no session, before any read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockIsAdmin).not.toHaveBeenCalled();
    expect(mockTablesTouched).toEqual([]);
  });

  it('403 for a non-admin, before any read', async () => {
    mockGetUser.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', email: 'x@example.com' });
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockTablesTouched).toEqual([]);
  });
});
