/**
 * Identity lock for POST /api/enhance-prompt (F13).
 *
 * The route was unauthenticated and derived identity from `body.userId` /
 * `x-user-id` / the literal `'anonymous'`, then handed it to
 * PluginManagerV2.getUserActionablePlugins — and unlike its sibling it RETURNS the
 * result (`connectedPluginData`, `metadata.connectedPlugins`), so an anonymous caller
 * could enumerate any user id's connected plugins.
 *
 * Same shape as app/api/analyze-prompt-clarity/__tests__/auth.test.ts.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const getUserActionablePlugins = jest.fn();
const getPluginsDefinitionContext = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getUserActionablePlugins: (...args: unknown[]) => getUserActionablePlugins(...args),
      getPluginsDefinitionContext: (...args: unknown[]) => getPluginsDefinitionContext(...args),
    }),
  },
}));

// The LLM call is irrelevant here — fail it so the route takes its 500 path without
// reaching Anthropic.
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

import { POST } from '@/app/api/enhance-prompt/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/enhance-prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const BODY = { prompt: 'Send my daily summary', clarificationAnswers: {} };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  getUserActionablePlugins.mockResolvedValue({});
  getPluginsDefinitionContext.mockReturnValue([]);
});

describe('POST /api/enhance-prompt — identity is server-derived', () => {
  it('401s with no session, and never looks up any user plugins', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ ...BODY, userId: VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(getUserActionablePlugins).not.toHaveBeenCalled();
  });

  it('401s when only an x-user-id header is supplied', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post(BODY, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(getUserActionablePlugins).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied userId and uses the session user', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    await POST(post({ ...BODY, userId: VICTIM_USER_ID }, { 'x-user-id': VICTIM_USER_ID }));

    expect(getUserActionablePlugins).toHaveBeenCalledWith(SESSION_USER_ID);
  });
});
