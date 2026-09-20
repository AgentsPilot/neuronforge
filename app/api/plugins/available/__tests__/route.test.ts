/**
 * GET /api/plugins/available — P0 secret-exposure locks.
 *
 * Before this fix the route was unauthenticated and returned each definition's full
 * `auth_config` after env substitution: real OAuth client secrets and the live
 * `STRIPE_SECRET_KEY`. The mocked definitions below carry sentinel values seeded through
 * `process.env`, exactly as PluginManagerV2 would substitute them, so a regression shows
 * up as a sentinel in the response body.
 *
 * Workplan: docs/workplans/plugin-auth-config-exposure-workplan.md
 */

import { NextRequest } from 'next/server';

import { SENTINELS, assertNoSecrets, seedSecretEnv } from '@/lib/testing/plugin-secret-matcher';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const getAvailablePlugins = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getAvailablePlugins: () => getAvailablePlugins(),
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

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'user@example.com' };

/** Mirrors a post-substitution definition: the secret fields hold real values. */
const definition = (overrides: Record<string, unknown> = {}) => ({
  plugin: {
    name: 'Stripe',
    description: 'Payments',
    context: 'payments',
    version: '2.0.0',
    category: 'finance',
    visibility: 'public',
    auth_config: {
      auth_type: 'oauth2_stripe_connect',
      client_id: 'ca_public_client_id',
      client_secret: SENTINELS.STRIPE_SECRET_KEY,
      redirect_uri: 'https://app.example.com/oauth/callback/stripe',
      auth_url: 'https://connect.stripe.com/oauth/authorize',
      token_url: 'https://connect.stripe.com/oauth/token',
      refresh_url: 'https://connect.stripe.com/oauth/token',
      profile_url: 'https://api.stripe.com/v1/accounts',
      required_scopes: ['read_write'],
    },
    ...overrides,
  },
  actions: { create_invoice: {}, list_charges: {} },
});

const req = (search = '') =>
  new NextRequest(`http://localhost/api/plugins/available${search}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  seedSecretEnv();
  getUser.mockResolvedValue(USER);
  getAvailablePlugins.mockReturnValue({
    stripe: definition(),
    'google-mail': definition({
      name: 'Gmail',
      auth_config: {
        auth_type: 'oauth2_google',
        client_id: 'public.apps.googleusercontent.com',
        client_secret: SENTINELS.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://app.example.com/oauth/callback/google-mail',
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        refresh_url: 'https://oauth2.googleapis.com/token',
        required_scopes: ['gmail.readonly'],
      },
    }),
    crm: definition({ name: 'CRM', visibility: 'business_os' }),
  });
});

describe('GET /api/plugins/available', () => {
  it('401 when signed out, and does not touch the registry', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Unauthorized' });
    expect(getAvailablePlugins).not.toHaveBeenCalled();
    assertNoSecrets(body);
  });

  it('returns no secret for an authenticated caller', async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The load-bearing assertion of this whole branch.
    assertNoSecrets(body);
  });

  it('emits only allow-listed auth_config fields', async () => {
    const res = await GET(req());
    const body = await res.json();

    const allowed = [
      'auth_type',
      'auth_url',
      'client_id',
      'redirect_uri',
      'required_scopes',
      'user_scopes',
      'requires_pkce',
    ];
    for (const plugin of body.plugins) {
      expect(Object.keys(plugin.auth_config).filter((k) => !allowed.includes(k))).toEqual([]);
      expect(plugin.auth_config.client_secret).toBeUndefined();
      expect(plugin.auth_config.token_url).toBeUndefined();
      expect(plugin.auth_config.profile_url).toBeUndefined();
    }
  });

  it('keeps the fields clients actually use', async () => {
    const res = await GET(req());
    const body = await res.json();
    const stripe = body.plugins.find((p: { key: string }) => p.key === 'stripe');

    expect(stripe).toMatchObject({
      key: 'stripe',
      name: 'Stripe',
      auth_type: 'oauth2_stripe_connect',
      action_count: 2,
      isSystem: false,
      visibility: 'public',
    });
    // The browser builds the authorize URL from these (lib/client/oauth-handler.ts).
    expect(stripe.auth_config).toMatchObject({
      auth_url: 'https://connect.stripe.com/oauth/authorize',
      client_id: 'ca_public_client_id',
      redirect_uri: 'https://app.example.com/oauth/callback/stripe',
      required_scopes: ['read_write'],
    });
    expect(stripe.actions).toEqual(['create_invoice', 'list_charges']);
  });

  it('hides business_os plugins by default and includes them on opt-in (PR #59 scoping)', async () => {
    const hidden = await (await GET(req())).json();
    expect(hidden.plugins.map((p: { key: string }) => p.key)).toEqual(['stripe', 'google-mail']);
    expect(hidden.total).toBe(2);

    const shown = await (await GET(req('?includeBusinessOs=true'))).json();
    expect(shown.plugins.map((p: { key: string }) => p.key)).toContain('crm');
    expect(shown.total).toBe(3);
    assertNoSecrets(shown);
  });

  it('400 on an invalid includeBusinessOs value instead of silently hiding plugins', async () => {
    const res = await GET(req('?includeBusinessOs=maybe'));
    expect(res.status).toBe(400);
    expect(getAvailablePlugins).not.toHaveBeenCalled();
  });

  it('marks the response private so no shared cache stores it', async () => {
    const res = await GET(req());
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
  });

  it('does not leak internals in a production 500 body', async () => {
    const original = process.env.NODE_ENV;
    // NODE_ENV is readonly in the Next types; the route reads it at call time.
    (process.env as Record<string, string>).NODE_ENV = 'production';
    getAvailablePlugins.mockImplementation(() => {
      throw new Error(`boom ${SENTINELS.STRIPE_SECRET_KEY}`);
    });

    try {
      const res = await GET(req());
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'Failed to get available plugins' });
      assertNoSecrets(body);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = original as string;
    }
  });
});
