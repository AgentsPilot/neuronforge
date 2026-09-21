/**
 * Identity lock for GET /api/agent-executions/stats (identity sweep, Slice 0).
 *
 * The route was anonymous, built a service-role client inline, and selected
 * `agent_executions` for the last 24h with NO `user_id` filter — returning up to 50 full
 * rows per status (`user_id`, `agent_id`, `error_message`, `result`) across every tenant,
 * plus platform-wide metrics. It is cross-tenant by design, so the only correct gate is
 * `requireAdmin`; there is no user-scoped mode to fall back to.
 *
 * Shape follows app/api/enhance-prompt/__tests__/auth.test.ts.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({ isAdmin: (...args: unknown[]) => isAdmin(...args) }),
  },
}));

/**
 * One spy on the table read. If the gate ever lets a caller through, `from` is called —
 * that is the assertion that actually matters, not the status code.
 */
const from = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args: unknown[]) => from(...args) }),
}));

import { NextRequest } from 'next/server';

import { GET } from '@/app/api/agent-executions/stats/route';

const ADMIN_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAIN_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const get = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/agent-executions/stats', { method: 'GET', headers });

/** Minimal stand-in for the PostgREST builder chain the route uses. */
const stubQuery = (rows: unknown[]) => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.gte = () => chain;
  chain.order = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  from.mockImplementation(() => stubQuery([]));
});

describe('GET /api/agent-executions/stats — admin only', () => {
  it('401s with no session, and never reads agent_executions', async () => {
    getUser.mockResolvedValue(null);

    const res = await GET(get({ 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(from).not.toHaveBeenCalled();
  });

  it('403s a signed-in non-admin, and never reads agent_executions', async () => {
    // The point of requireAdmin over getUser: a session alone must not open a
    // cross-tenant read.
    getUser.mockResolvedValue({ id: PLAIN_USER_ID, email: 'user@example.com' });
    isAdmin.mockResolvedValue(false);

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed when the admin check throws', async () => {
    getUser.mockResolvedValue({ id: PLAIN_USER_ID, email: 'user@example.com' });
    isAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('serves an admin, and projects columns explicitly rather than select(*)', async () => {
    getUser.mockResolvedValue({ id: ADMIN_USER_ID, email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);

    // Typed explicitly: an untyped `jest.fn(() => …)` infers a zero-length argument
    // tuple, so reading `mock.calls[0][0]` below would not compile under `tsc --noEmit`.
    const select = jest.fn((columns: string) => {
      void columns;
      const chain: Record<string, unknown> = {};
      chain.gte = () => chain;
      chain.order = () => chain;
      chain.limit = async () => ({ data: [], error: null });
      return chain;
    });
    from.mockImplementation(() => ({ select }));

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('agent_executions');

    // `select('*')` is what let a future column start flowing cross-tenant the moment
    // its migration landed. Lock the allow-list in.
    const projection = select.mock.calls[0][0];
    expect(projection).not.toBe('*');
    expect(projection).toContain('status');
    expect(projection).toContain('user_id');
  });
});
