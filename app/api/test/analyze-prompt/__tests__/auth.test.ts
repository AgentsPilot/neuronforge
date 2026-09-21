/**
 * Identity lock for POST /api/test/analyze-prompt (identity sweep, Slice 0).
 *
 * The route took `userId` from the request body and passed it to
 * `analyzePromptDirectAgentKit`, which calls `convertPluginsToTools(userId, …)` and
 * `getPluginContextPrompt(userId, …)` — so an anonymous caller who knew a user id got
 * that account's connected-plugin inventory and action catalogue summarised back by an
 * LLM.
 *
 * NOTE: SA's Slice 0 ruling was to delete this route as callerless. It has a caller —
 * `app/test-plugins-v2/page.tsx` dispatches it dynamically via
 * `fetch(`/api/${selectedAIService}`)`, so the path never appears as a literal. It is
 * gated instead; see the route header.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const analyzePromptDirectAgentKit = jest.fn();
jest.mock('@/lib/agentkit/analyzePrompt-v3-direct', () => ({
  analyzePromptDirectAgentKit: (...args: unknown[]) => analyzePromptDirectAgentKit(...args),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/test/analyze-prompt/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/test/analyze-prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  analyzePromptDirectAgentKit.mockResolvedValue({ steps: [] });
});

describe('POST /api/test/analyze-prompt — identity is server-derived', () => {
  it('401s with no session, and never reads anyone’s plugins', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      post({ userId: VICTIM_USER_ID, prompt: 'do a thing', availablePlugins: ['google-mail'] })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(analyzePromptDirectAgentKit).not.toHaveBeenCalled();
  });

  it('401s when only an x-user-id header is supplied', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ prompt: 'do a thing' }, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(analyzePromptDirectAgentKit).not.toHaveBeenCalled();
  });

  it('analyses against the session user, never the supplied id', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    const res = await POST(
      post(
        { userId: VICTIM_USER_ID, prompt: 'do a thing', availablePlugins: ['google-mail'] },
        { 'x-user-id': VICTIM_USER_ID }
      )
    );

    expect(res.status).toBe(200);
    expect(analyzePromptDirectAgentKit).toHaveBeenCalledWith(
      SESSION_USER_ID,
      'do a thing',
      ['google-mail']
    );
    expect(JSON.stringify(analyzePromptDirectAgentKit.mock.calls)).not.toContain(VICTIM_USER_ID);
  });
});
