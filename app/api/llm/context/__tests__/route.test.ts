/**
 * GET /api/llm/context — IDOR + egress locks.
 *
 * The route was unauthenticated and generated the context for whatever `?userId=` the
 * caller supplied, so anyone could enumerate any user's connected plugins. The critical
 * lock: a caller-supplied userId must never reach the plugin manager.
 *
 * Workplan: docs/workplans/plugin-auth-config-exposure-workplan.md
 */

import { NextRequest } from 'next/server';

import { assertNoSecrets, seedSecretEnv, SENTINELS } from '@/lib/testing/plugin-secret-matcher';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const generateLLMContext = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      generateLLMContext: (...args: unknown[]) => generateLLMContext(...args),
    }),
  },
}));

const logs: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg: unknown) => logs.push({ level, ctx, msg });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { GET } from '../route';

const SESSION_USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'me@example.com' };
const VICTIM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const req = (search = '') =>
  new NextRequest(`http://localhost/api/llm/context${search}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  seedSecretEnv();
  getUser.mockResolvedValue(SESSION_USER);
  generateLLMContext.mockResolvedValue({
    connected_plugins: { 'google-mail': { name: 'Gmail', status: 'ready' } },
    available_plugins: { stripe: { name: 'Stripe', auth_url: 'https://connect.stripe.com/oauth/authorize' } },
  });
});

describe('GET /api/llm/context', () => {
  it('401 when signed out, and never builds a context', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(req(`?userId=${VICTIM_ID}`));

    expect(res.status).toBe(401);
    expect(generateLLMContext).not.toHaveBeenCalled();
  });

  it('ignores a caller-supplied userId and serves the session user (IDOR lock)', async () => {
    const res = await GET(req(`?userId=${VICTIM_ID}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(generateLLMContext).toHaveBeenCalledWith(SESSION_USER.id);
    expect(generateLLMContext).not.toHaveBeenCalledWith(VICTIM_ID);
    expect(body.user_id).toBe(SESSION_USER.id);
    // The attempt is recorded so it is detectable in logs.
    expect(logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('works with no userId at all', async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.connected_plugins).toEqual(['google-mail']);
    expect(generateLLMContext).toHaveBeenCalledWith(SESSION_USER.id);
  });

  it('400 on a malformed userId parameter', async () => {
    const res = await GET(req('?userId='));
    expect(res.status).toBe(400);
    expect(generateLLMContext).not.toHaveBeenCalled();
  });

  it('carries no secret, and is not shared-cacheable', async () => {
    const res = await GET(req());
    assertNoSecrets(await res.json());
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not leak internals in a production 500 body', async () => {
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    generateLLMContext.mockRejectedValue(new Error(`boom ${SENTINELS.GOOGLE_CLIENT_SECRET}`));

    try {
      const res = await GET(req());
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'Failed to generate LLM context' });
      assertNoSecrets(body);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original as string;
    }
  });
});
