/**
 * Identity lock for POST /api/help-bot-v2/feedback (F15 / CR1).
 *
 * Sibling of the parent route's hole: no getUser(), a module-level service-role client,
 * and a caller-supplied `cacheId` that moved thumbs_up/thumbs_down on the GLOBAL
 * support_cache — the signal deciding which cached answers keep being served to every
 * user. Not a cross-tenant read, but the same route family and the same threat class,
 * so it takes the same gate.
 *
 * Same shape as ../../__tests__/auth.test.ts.
 *
 * Out of scope here by SA's call: Zod (the route hand-validates), the console.* → Pino
 * conversion (F17), and the select→update lost-update race (F18, Low).
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

// Records every table touched and every write attempted, so "signed out" can assert the
// counter was never moved.
const fromCalls: string[] = [];
const updates: Array<Record<string, unknown>> = [];

let currentRow: Record<string, unknown> | null = { thumbs_up: 3, thumbs_down: 1 };

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    update: (patch: Record<string, unknown>) => {
      updates.push(patch);
      return builder;
    },
    eq: () => builder,
    single: async () => ({
      data: currentRow,
      error: currentRow ? null : { message: 'not found' },
    }),
    // The update chain is awaited at `.eq()`, the read chain terminates at `.single()`.
    then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
  };
  void table;
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      return makeBuilder(table);
    },
  }),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/help-bot-v2/feedback/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/help-bot-v2/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const BODY = { cacheId: 'cache-1', feedbackType: 'up' };

beforeEach(() => {
  jest.clearAllMocks();
  fromCalls.length = 0;
  updates.length = 0;
  currentRow = { thumbs_up: 3, thumbs_down: 1 };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
});

describe('POST /api/help-bot-v2/feedback — requires a session', () => {
  it('401s with no session and leaves the counter untouched', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post(BODY, { 'x-user-id': SESSION_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(fromCalls).not.toContain('support_cache');
    expect(updates).toHaveLength(0);
  });

  it('records the vote for a signed-in caller', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    const res = await POST(post(BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, feedback: 'up', newCount: 4 });
    expect(updates).toEqual([{ thumbs_up: 4 }]);
  });
});
