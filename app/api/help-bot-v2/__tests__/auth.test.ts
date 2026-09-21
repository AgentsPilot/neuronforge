/**
 * Identity lock for POST /api/help-bot-v2 (F15).
 *
 * The route had no getUser() at all. It holds a module-level service-role client
 * (RLS bypassed) and took its identity from `x-user-id`, which flowed into
 * searchAgents → .from('agents').eq('user_id', userId).ilike('agent_name', …) and
 * came back to the caller as agent names, ids and statuses in the bot's reply. Any
 * anonymous caller could enumerate any user's agents.
 *
 * Same shape as app/api/enhance-prompt/__tests__/auth.test.ts.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

// Records every table the service-role client touches, and every .eq() filter, so a
// test can assert both "no user-owned table was read" and "it was scoped to the
// session id".
const fromCalls: string[] = [];
const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];

const agentRow = { id: 'agent-1', agent_name: 'Invoice Chaser', status: 'active' };

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      eqCalls.push({ table, column, value });
      return builder;
    },
    ilike: () => builder,
    // Terminal calls — searchAgents awaits .limit(), searchFAQ awaits .order().
    limit: async () => ({ data: table === 'agents' ? [agentRow] : [], error: null }),
    order: async () => ({ data: [], error: null }),
    single: async () => ({ data: null, error: { message: 'not found' } }),
    update: () => builder,
    insert: async () => ({ error: null }),
  };
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      return makeBuilder(table);
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

// The paid layers are irrelevant here — a session-less caller must never reach them,
// and the authenticated assertions stop at the agent-search branch.
const chatCompletion = jest.fn();
jest.mock('@/lib/ai/providers/groqProvider', () => ({
  GroqProvider: class {
    chatCompletion = (...args: unknown[]) => chatCompletion(...args);
  },
}));
jest.mock('@/lib/analytics/aiAnalytics', () => ({
  AIAnalyticsService: class {
    trackAICall = async () => undefined;
  },
}));
const generateEmbedding = jest.fn();
jest.mock('@/lib/services/EmbeddingService', () => ({
  EmbeddingService: class {
    generateEmbedding = (...args: unknown[]) => generateEmbedding(...args);
  },
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/help-bot-v2/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/help-bot-v2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

// Matches detectAgentSearchQuery, so the route takes its agent-search branch.
const AGENT_SEARCH_BODY = {
  messages: [{ role: 'user', content: 'find my Invoice Chaser agent' }],
  pageContext: { path: '/v2/dashboard', title: 'Dashboard' },
};

const agentQueries = () => eqCalls.filter((call) => call.table === 'agents');

beforeEach(() => {
  jest.clearAllMocks();
  fromCalls.length = 0;
  eqCalls.length = 0;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

describe('POST /api/help-bot-v2 — identity is server-derived', () => {
  it('401s with no session, and never reads the agents table', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post(AGENT_SEARCH_BODY, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(fromCalls).not.toContain('agents');
    expect(agentQueries()).toHaveLength(0);
  });

  it('401s when a victim id is supplied in the body instead', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ ...AGENT_SEARCH_BODY, userId: VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(fromCalls).not.toContain('agents');
  });

  it('ignores the x-user-id header and scopes the agent search to the session user', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    const res = await POST(post(AGENT_SEARCH_BODY, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: 'AgentSearch' });

    // Exactly one user_id filter, and it is the session id — not the header value.
    expect(agentQueries()).toEqual([
      { table: 'agents', column: 'user_id', value: SESSION_USER_ID },
    ]);
    expect(eqCalls.some((call) => call.value === VICTIM_USER_ID)).toBe(false);
  });

  it('401s anonymously in input_help mode too, without calling the model', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      post(
        {
          messages: [{ role: 'user', content: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
          context: { mode: 'input_help', agentId: 'agent-1', fieldName: 'spreadsheetId' },
        },
        { 'x-user-id': VICTIM_USER_ID }
      )
    );

    expect(res.status).toBe(401);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
