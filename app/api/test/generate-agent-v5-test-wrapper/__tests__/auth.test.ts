/**
 * Identity lock for POST /api/test/generate-agent-v5-test-wrapper (Slice 0, RF1).
 *
 * The same hole as its sibling `test/analyze-prompt`, in the same /test-plugins-v2
 * harness: no `getUser()` anywhere, `userId` taken from the request body and handed to
 * `pluginManager.getAllActivePluginKeys(userId)` — the victim's connected-plugin
 * inventory — plus a caller-chosen `provider` and `model` for the V5 generation, so an
 * anonymous caller also picked the price of the LLM call.
 *
 * Its own header documented all of that as intent ("This is a TEST API - no
 * authentication required"), which is the part worth remembering: `/api/test/*` ships to
 * production like any other route.
 *
 * Shape follows app/api/test/analyze-prompt/__tests__/auth.test.ts.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

/** The victim-data read. It must not happen without a session. */
const getAllActivePluginKeys = jest.fn();
const getPluginsDefinitionContext = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getAllActivePluginKeys: (...args: unknown[]) => getAllActivePluginKeys(...args),
      getPluginsDefinitionContext: (...args: unknown[]) => getPluginsDefinitionContext(...args),
    }),
  },
}));

/** The LLM spend. Also must not happen without a session. */
const generateWorkflow = jest.fn();
const generatorConstructedWith: unknown[] = [];
jest.mock('@/lib/agentkit/v4/v5-generator', () => ({
  V5WorkflowGenerator: class {
    constructor(_manager: unknown, options: unknown) {
      generatorConstructedWith.push(options);
    }
    generateWorkflow = (...args: unknown[]) => generateWorkflow(...args);
  },
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/test/generate-agent-v5-test-wrapper/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ENHANCED_PROMPT = JSON.stringify({
  plan_title: 'Daily summary',
  plan_description: 'Summarise and send',
  specifics: {
    services_involved: ['google-mail'],
    resolved_user_inputs: [{ key: 'recipient', value: 'me@example.com' }],
  },
});

const BODY = {
  enhancedPrompt: ENHANCED_PROMPT,
  provider: 'anthropic',
  model: 'claude-sonnet-test',
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/test/generate-agent-v5-test-wrapper', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  generatorConstructedWith.length = 0;
  getAllActivePluginKeys.mockResolvedValue(['google-mail']);
  getPluginsDefinitionContext.mockReturnValue([{ toShortLLMContext: () => ({ key: 'google-mail' }) }]);
  generateWorkflow.mockResolvedValue({ success: true, metadata: {}, warnings: [] });
});

describe('POST /api/test/generate-agent-v5-test-wrapper — identity is server-derived', () => {
  it('401s with no session, and never reads anyone’s plugins or runs a generation', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ ...BODY, userId: VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(getAllActivePluginKeys).not.toHaveBeenCalled();
    expect(generateWorkflow).not.toHaveBeenCalled();
  });

  it('401s when only an x-user-id header is supplied', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post(BODY, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(getAllActivePluginKeys).not.toHaveBeenCalled();
  });

  it('refuses before parsing the body, so a malformed body cannot slip past', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/test/generate-agent-v5-test-wrapper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
    );

    // 401, NOT a 400/500 from JSON.parse.
    expect(res.status).toBe(401);
    expect(getAllActivePluginKeys).not.toHaveBeenCalled();
  });

  it('loads the SESSION user’s plugins and ignores a body userId', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    await POST(post({ ...BODY, userId: VICTIM_USER_ID }, { 'x-user-id': VICTIM_USER_ID }));

    expect(getAllActivePluginKeys).toHaveBeenCalledWith(SESSION_USER_ID);
    expect(JSON.stringify(getAllActivePluginKeys.mock.calls)).not.toContain(VICTIM_USER_ID);

    // The generator is also constructed with the session id, not the claimed one — the
    // id is passed twice in this route and both sites have to be right.
    expect(generatorConstructedWith[0]).toEqual(
      expect.objectContaining({ userId: SESSION_USER_ID })
    );
    expect(JSON.stringify(generatorConstructedWith)).not.toContain(VICTIM_USER_ID);
  });

  it('no longer reports userId as a missing required field', async () => {
    // Pre-fix, an absent body `userId` produced a 400 naming it. Now it comes from the
    // session, so a signed-in caller who omits it must succeed rather than be told to
    // supply an identity.
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    const res = await POST(post(BODY));

    expect(res.status).toBe(200);
    expect(generateWorkflow).toHaveBeenCalledTimes(1);
  });
});
