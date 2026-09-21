/**
 * Identity lock for POST /api/analyze-workflow (identity sweep, Slice 0; supersedes F16).
 *
 * Recorded originally as Low ("spoofable attribution"). It is not: the route takes BOTH
 * `systemPrompt` and `userMessage` from the request body and passes them to gpt-4o with
 * `max_tokens: 2000` on the platform's key — an open, fully-controllable LLM proxy. The
 * assertion that matters is therefore that the model is never reached without a session,
 * not just that the status code is 401.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const chatCompletion = jest.fn();
jest.mock('@/lib/ai/providers/openaiProvider', () => ({
  OpenAIProvider: class {
    chatCompletion = (...args: unknown[]) => chatCompletion(...args);
  },
}));

jest.mock('@/lib/analytics/aiAnalytics', () => ({
  AIAnalyticsService: class {
    trackAICall = async () => undefined;
  },
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
// 'uuid' ships ESM only, which Jest will not transform inside node_modules.
jest.mock('uuid', () => ({ v4: () => '11111111-1111-4111-8111-111111111111' }));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/analyze-workflow/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const BODY = {
  systemPrompt: 'You are a helpful assistant',
  userMessage: 'Summarise my workflow',
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/analyze-workflow', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  chatCompletion.mockResolvedValue({
    choices: [{ message: { content: '{"workflowSteps":[{"id":"1"}]}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
});

describe('POST /api/analyze-workflow — identity is server-derived', () => {
  it('401s with no session, and never calls the model', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ ...BODY, userId: VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    // The open-LLM-proxy half of the bug.
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('401s when only an x-user-id header is supplied', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post(BODY, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('refuses before parsing the body', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/analyze-workflow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
    );

    expect(res.status).toBe(401);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('attributes the call to the session user, never the supplied id', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    const res = await POST(
      post({ ...BODY, userId: VICTIM_USER_ID }, { 'x-user-id': VICTIM_USER_ID })
    );

    expect(res.status).toBe(200);
    expect(chatCompletion).toHaveBeenCalledTimes(1);

    const attribution = chatCompletion.mock.calls[0][1];
    expect(attribution.userId).toBe(SESSION_USER_ID);
    expect(attribution.userId).not.toBe('anonymous');
    expect(JSON.stringify(attribution)).not.toContain(VICTIM_USER_ID);
  });
});
