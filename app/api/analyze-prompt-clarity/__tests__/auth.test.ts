/**
 * Identity lock for POST /api/analyze-prompt-clarity.
 *
 * The route used to derive identity from `body.userId` / the `x-user-id` header /
 * the literal string 'anonymous', then hand that id to
 * PluginManagerV2.getUserActionablePlugins — i.e. an unauthenticated caller could
 * read which plugins any user id had connected.
 *
 * Locks the same shape as app/api/plugins/__tests__/identity-hardening.test.ts:
 * no session ⇒ 401 AND the lookup never runs; session present ⇒ the SESSION id is
 * used even when the body asks for someone else's.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const getUserActionablePlugins = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getUserActionablePlugins: (...args: unknown[]) => getUserActionablePlugins(...args),
      convertToPluginDefinitionContext: () => [],
    }),
  },
}));

// The LLM call is irrelevant here — fail it so the route takes its 500 fallback
// without reaching Anthropic.
jest.mock('@/lib/ai/providers/anthropicProvider', () => ({
  AnthropicProvider: class {
    chatCompletion = async () => {
      throw new Error('not exercised by this suite');
    };
  },
  ANTHROPIC_MODELS: { CLAUDE_4_SONNET: 'claude-sonnet-test' },
}));
jest.mock('@/lib/analytics/aiAnalytics', () => ({
  AIAnalyticsService: class {
    trackAICall = async () => undefined;
  },
}));
// 'uuid' ships ESM only, which Jest will not transform inside node_modules.
jest.mock('uuid', () => ({ v4: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/analyze-prompt-clarity/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/analyze-prompt-clarity', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  getUserActionablePlugins.mockResolvedValue({});
});

describe('POST /api/analyze-prompt-clarity — identity is server-derived', () => {
  it('401s with no session, and never looks up any user plugins', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ prompt: 'Summarise my email', userId: VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(getUserActionablePlugins).not.toHaveBeenCalled();
  });

  it('401s when only an x-user-id header is supplied', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      post({ prompt: 'Summarise my email' }, { 'x-user-id': VICTIM_USER_ID })
    );

    expect(res.status).toBe(401);
    expect(getUserActionablePlugins).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied userId and uses the session user', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    await POST(post({ prompt: 'Summarise my email', userId: VICTIM_USER_ID }, { 'x-user-id': VICTIM_USER_ID }));

    expect(getUserActionablePlugins).toHaveBeenCalledWith(SESSION_USER_ID);
  });
});
