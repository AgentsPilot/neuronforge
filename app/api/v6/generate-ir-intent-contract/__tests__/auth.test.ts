/**
 * Identity lock for POST /api/v6/generate-ir-intent-contract (identity sweep, Slice 0).
 *
 * The route read `x-user-id` and enforced nothing — its own comment said "trust
 * pass-through, no auth enforcement". That id drove plugin vocabulary extraction, the
 * user's memory context, their extracted failure patterns and their stored intent
 * examples, all through the service-role `supabaseServer` client, and the results came
 * back in the response.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const extract = jest.fn();
jest.mock('@/lib/agentkit/v6/vocabulary/PluginVocabularyExtractor', () => ({
  PluginVocabularyExtractor: class {
    extract = (...args: unknown[]) => extract(...args);
  },
}));

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: { getInstance: async () => ({}) },
}));

const memoryBuild = jest.fn();
jest.mock('@/lib/memory/UserMemoryContextBuilder', () => ({
  getUserMemoryContextBuilder: () => ({ build: (...args: unknown[]) => memoryBuild(...args) }),
}));

jest.mock('@/lib/agentkit/v6/intent/generate-intent', () => ({
  generateGenericIntentContractV1: jest.fn(),
}));
jest.mock('@/lib/agentkit/v6/capability-binding/CapabilityBinderV2', () => ({
  CapabilityBinderV2: class {
    bind = jest.fn();
  },
}));
jest.mock('@/lib/agentkit/v6/compiler/IntentToIRConverter', () => ({
  IntentToIRConverter: class {},
}));
jest.mock('@/lib/agentkit/v6/compiler/ExecutionGraphCompiler', () => ({
  ExecutionGraphCompiler: class {},
}));
jest.mock('@/lib/services/PatternExtractor', () => ({ getPatternExtractor: () => ({}) }));
jest.mock('@/lib/services/GlobalFailureMonitor', () => ({ getGlobalFailureMonitor: () => ({}) }));
jest.mock('@/lib/repositories/IntentExampleRepository', () => ({
  getIntentExampleRepository: () => ({}),
}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/v6/generate-ir-intent-contract/route';

const SESSION_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ENHANCED_PROMPT = {
  enhanced_prompt: { specifics: { services_involved: ['google-mail'] } },
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/v6/generate-ir-intent-contract', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  // Enough to get past phase 0; the pipeline beyond it is not what this suite tests.
  extract.mockResolvedValue({ domains: [], capabilities: [], plugins: [] });
  memoryBuild.mockResolvedValue(null);
});

describe('POST /api/v6/generate-ir-intent-contract — identity is server-derived', () => {
  it('401s with a victim x-user-id, and never reads their vocabulary', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post(ENHANCED_PROMPT, { 'x-user-id': VICTIM_USER_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(extract).not.toHaveBeenCalled();
    expect(memoryBuild).not.toHaveBeenCalled();
  });

  it('401s rather than the old 400 "x-user-id header required"', async () => {
    // The pre-fix route answered 400 here, which told an anonymous caller exactly what
    // to send next.
    getUser.mockResolvedValue(null);

    const res = await POST(post(ENHANCED_PROMPT));

    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain('x-user-id');
  });

  it('refuses before parsing the body', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/v6/generate-ir-intent-contract', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': VICTIM_USER_ID },
        body: 'not-json',
      })
    );

    expect(res.status).toBe(401);
    expect(extract).not.toHaveBeenCalled();
  });

  it('scopes the vocabulary read to the session user, ignoring the header', async () => {
    getUser.mockResolvedValue({ id: SESSION_USER_ID, email: 'me@example.com' });

    await POST(post(ENHANCED_PROMPT, { 'x-user-id': VICTIM_USER_ID }));

    expect(extract).toHaveBeenCalledWith(SESSION_USER_ID, expect.anything());
    expect(JSON.stringify(extract.mock.calls)).not.toContain(VICTIM_USER_ID);
  });
});
