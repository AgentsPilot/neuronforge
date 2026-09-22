/**
 * Cross-route egress sweep: no plugin-facing route may serialise a secret.
 *
 * This is the test that catches a FUTURE route re-introducing the leak. Every handler
 * below is driven by one mocked PluginManagerV2 whose definitions have a sentinel value
 * in every excluded `auth_config` field, with the same sentinels also seeded into
 * `process.env` (see lib/testing/plugin-secret-matcher.ts). A response that carries any of them — or any
 * forbidden key name — fails.
 *
 * Two routes are covered because they leaked this way through a CLASS INSTANCE rather
 * than a literal `auth_config:` property (PluginDefinitionContext aliases the cached
 * definition, and NextResponse.json stringifies it):
 *   - the deprecated user-plugins route — DELETED in this branch (see the guard test);
 *   - analyze-prompt-clarity's two 500 fallbacks — projected, and asserted here.
 *
 * Workplan: docs/workplans/plugin-auth-config-exposure-workplan.md
 */

import { NextRequest } from 'next/server';

import { SENTINELS, assertNoSecrets, scanForSecrets, seedSecretEnv } from '@/lib/testing/plugin-secret-matcher';

// ── One definition factory, shared by every route under test ──────────────────────────
/** Shaped like a post-env-substitution definition: secrets present, as in production. */
const definition = (name: string, visibility = 'public') => ({
  plugin: {
    name,
    displayName: name,
    description: `${name} plugin`,
    context: `${name} context`,
    version: '1.0.0',
    category: 'productivity',
    visibility,
    auth_config: {
      auth_type: 'oauth2_google',
      client_id: 'public.apps.googleusercontent.com',
      client_secret: SENTINELS.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'https://app.example.com/oauth/callback',
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_url: 'https://oauth2.googleapis.com/token',
      refresh_url: 'https://oauth2.googleapis.com/token',
      profile_url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      profile_headers: { Authorization: `Bearer ${SENTINELS.SLACK_CLIENT_SECRET}` },
      required_scopes: ['gmail.readonly'],
      additional_params: { config_id: SENTINELS.WHATSAPP_CONFIG_ID },
    },
  },
  actions: {
    send_email: {
      name: 'send_email',
      description: 'Send an email',
      usage_context: 'when asked to email',
      parameters: { type: 'object', properties: {} },
    },
  },
});

const DEFINITIONS: Record<string, ReturnType<typeof definition>> = {
  'google-mail': definition('Gmail'),
  crm: definition('CRM', 'business_os'),
};

const CONNECTION = {
  user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  plugin_key: 'google-mail',
  plugin_name: 'Gmail',
  // If a route ever serialises a whole connection, the token must be caught too.
  access_token: SENTINELS.NOTION_CLIENT_SECRET,
  refresh_token: SENTINELS.STRIPE_SECRET_KEY,
  expires_at: null,
  status: 'active',
  connected_at: '2026-01-01T00:00:00.000Z',
  username: 'me@example.com',
  email: 'me@example.com',
};

const USER = { id: CONNECTION.user_id, email: 'me@example.com' };

// ── Mocks ─────────────────────────────────────────────────────────────────────────────
const generateLLMContext = jest.fn();
const getUserActionablePlugins = jest.fn();

jest.mock('@/lib/server/plugin-manager-v2', () => {
  const { PluginDefinitionContext } = jest.requireActual('@/lib/types/plugin-definition-context');
  return {
    PluginManagerV2: {
      getInstance: async () => ({
        getAvailablePlugins: () => DEFINITIONS,
        getPluginDefinition: (key: string) => DEFINITIONS[key],
        getActionDefinition: (key: string, action: string) =>
          (DEFINITIONS[key]?.actions as Record<string, unknown>)?.[action],
        getConnectedPlugins: async () => ({
          'google-mail': { definition: DEFINITIONS['google-mail'], connection: CONNECTION },
        }),
        getActiveExpiredPluginKeys: async () => [],
        getDisconnectedPlugins: async () => ({
          crm: { plugin: DEFINITIONS.crm, reason: 'not_connected', auth_url: 'https://example.com/auth' },
        }),
        getUserActionablePlugins: (...a: unknown[]) => getUserActionablePlugins(...a),
        generateLLMContext: (...a: unknown[]) => generateLLMContext(...a),
        convertToPluginDefinitionContext: (plugins: Record<string, { definition: unknown }>) =>
          Object.values(plugins).map((p) => new PluginDefinitionContext(p.definition)),
      }),
    },
  };
});

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/server/route-identity', () => ({
  resolveActingUserIdentity: async () => ({
    ok: true,
    userId: USER.id,
    actingAs: 'self',
    isAdmin: false,
  }),
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make(), clientLogger: make() };
});

// analyze-prompt-clarity dependencies: it is a legacy route with a wide import surface.
const chatCompletion = jest.fn();
jest.mock('@/lib/ai/providers/anthropicProvider', () => ({
  AnthropicProvider: class {
    chatCompletion = (...args: unknown[]) => chatCompletion(...args);
  },
  ANTHROPIC_MODELS: { CLAUDE_4_SONNET: 'claude-sonnet-test' },
}));
jest.mock('@/lib/analytics/aiAnalytics', () => ({
  AIAnalyticsService: class {
    trackAICall = async () => undefined;
  },
}));
// 'uuid' ships ESM only, which Jest will not transform inside node_modules.
// Mocking it keeps this suite about egress rather than about module formats.
jest.mock('uuid', () => ({ v4: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

import { GET as availableGET } from '@/app/api/plugins/available/route';
import { GET as llmContextGET } from '@/app/api/llm/context/route';
import { GET as userStatusGET } from '@/app/api/plugins/user-status/route';
import { GET as actionSchemaGET } from '@/app/api/plugins/action-schema/route';
import { GET as executeCatalogueGET } from '@/app/api/plugins/execute/route';
import { POST as analyzePromptPOST } from '@/app/api/analyze-prompt-clarity/route';

const get = (url: string) => new NextRequest(`http://localhost${url}`, { method: 'GET' });
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  seedSecretEnv();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  getUser.mockResolvedValue(USER);
  generateLLMContext.mockResolvedValue({
    connected_plugins: { 'google-mail': { name: 'Gmail', status: 'ready' } },
    available_plugins: {},
  });
  getUserActionablePlugins.mockResolvedValue({
    'google-mail': { definition: DEFINITIONS['google-mail'], connection: CONNECTION },
  });
});

describe('secret matcher self-test', () => {
  it('detects a leaked env value, a forbidden key and a secret-shaped value', () => {
    expect(scanForSecrets({ auth_config: { client_secret: SENTINELS.GOOGLE_CLIENT_SECRET } }).findings)
      .not.toEqual([]);
    expect(scanForSecrets({ token_url: 'https://x/token' }).findings).not.toEqual([]);
    expect(scanForSecrets({ key: 'sk_live_abcdefghijklmno' }).findings).not.toEqual([]);
    expect(scanForSecrets({ plugins: [{ key: 'google-mail', auth_type: 'oauth2' }] }).findings).toEqual([]);
  });
});

describe('no plugin route serialises a secret', () => {
  it('GET /api/plugins/available', async () => {
    assertNoSecrets(await (await availableGET(get('/api/plugins/available?includeBusinessOs=true'))).json());
  });

  it('GET /api/llm/context', async () => {
    assertNoSecrets(await (await llmContextGET(get('/api/llm/context'))).json());
  });

  it('GET /api/plugins/user-status', async () => {
    assertNoSecrets(await (await userStatusGET(get('/api/plugins/user-status'))).json());
  });

  it('GET /api/plugins/action-schema (metadata only)', async () => {
    assertNoSecrets(await (await actionSchemaGET(get('/api/plugins/action-schema?plugin=google-mail'))).json());
  });

  it('GET /api/plugins/execute (catalogue mode)', async () => {
    assertNoSecrets(await (await executeCatalogueGET(get('/api/plugins/execute'))).json());
    assertNoSecrets(await (await executeCatalogueGET(get('/api/plugins/execute?plugin=google-mail'))).json());
  });
});

describe('POST /api/analyze-prompt-clarity — the class-instance leak shape', () => {
  const body = { prompt: 'Summarise my last 10 emails and save them to Notion', userId: USER.id };

  it('500 path: LLM call fails', async () => {
    chatCompletion.mockRejectedValue(new Error('anthropic unreachable'));

    const res = await analyzePromptPOST(post('/api/analyze-prompt-clarity', body));
    const payload = await res.json();

    expect(res.status).toBe(500);
    // The plugin metadata is still returned — projected, not raw.
    expect(payload.connectedPluginsMetaData).toBeDefined();
    assertNoSecrets(payload);
  });

  it('500 path: LLM returns empty content', async () => {
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: '' } }] });

    const res = await analyzePromptPOST(post('/api/analyze-prompt-clarity', body));
    const payload = await res.json();

    expect(res.status).toBe(500);
    assertNoSecrets(payload);
  });

  it('success path', async () => {
    chatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              clarityScore: 80,
              questionsCount: 0,
              questions: [],
              missingRequirements: [],
              suggestions: [],
              readyToBuild: true,
            }),
          },
        },
      ],
    });

    const res = await analyzePromptPOST(post('/api/analyze-prompt-clarity', body));
    assertNoSecrets(await res.json());
  });
});

describe('PluginDefinitionContext.toJSON is the serialisation choke point', () => {
  it('sanitises auth_config even when an instance is stringified directly', () => {
    const { PluginDefinitionContext } = jest.requireActual('@/lib/types/plugin-definition-context');
    const context = new PluginDefinitionContext(DEFINITIONS['google-mail']);

    // This is precisely what NextResponse.json did on the leaking routes.
    assertNoSecrets(JSON.parse(JSON.stringify(context)));
    // Server-side access is unaffected: the token exchange still needs the real secret.
    expect(context.plugin.auth_config.client_secret).toBe(SENTINELS.GOOGLE_CLIENT_SECRET);
  });
});
