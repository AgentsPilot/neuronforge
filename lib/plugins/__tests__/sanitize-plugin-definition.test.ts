/**
 * Allow-list enforcement for the client-safe plugin projection.
 *
 * The bug this locks down: `GET /api/plugins/available` returned each definition's full
 * `auth_config` *after* PluginManagerV2 substituted `${ENV_VAR}` placeholders, so an
 * unauthenticated caller received the platform Google OAuth client secret and the live
 * `STRIPE_SECRET_KEY`.
 *
 * The generic guard below is the important one: it feeds the sanitiser every secret-ish
 * key we can think of, plus a key that does not exist yet, and asserts none survives.
 * That is what makes the design allow-list-by-default rather than deny-list-by-memory.
 *
 * Workplan: docs/workplans/plugin-auth-config-exposure-workplan.md
 */

import fs from 'fs';
import path from 'path';

import {
  CLIENT_SAFE_AUTH_CONFIG_FIELDS,
  sanitizeAuthConfig,
  sanitizePluginDefinition,
  toClientPluginInfo,
} from '@/lib/plugins/sanitize-plugin-definition';
import type { PluginDefinition } from '@/lib/types/plugin-types';

const SENTINEL = (key: string) => `SENTINEL_${key.toUpperCase()}`;

/** Every key seen across the 28 shipped definitions, plus invented secret-bearing ones. */
const EXCLUDED_KEYS = [
  // real definition keys that must never cross the boundary
  'client_secret',
  'token_url',
  'refresh_url',
  'profile_url',
  'profile_method',
  'profile_headers',
  'token_expiry_seconds',
  'oauth_callback_profile_params',
  'additional_params',
  'uses_basic_auth',
  'token_format',
  'supports_express_account',
  '_scope_note',
  // invented: a future field must be excluded by default, not by memory
  'api_key',
  'secret',
  'password',
  'token',
  'private_key',
  'signing_secret',
  'webhook_secret',
  'access_token',
  'refresh_token',
  'bearer',
  'credentials',
  'future_secret_field',
];

const kitchenSinkAuthConfig = (): Record<string, unknown> => {
  const config: Record<string, unknown> = {
    // allow-listed
    auth_type: 'oauth2_google',
    auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    client_id: 'public-client-id.apps.googleusercontent.com',
    redirect_uri: 'https://app.example.com/oauth/callback/google-mail',
    required_scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    user_scopes: ['chat:write'],
    requires_pkce: true,
  };
  for (const key of EXCLUDED_KEYS) config[key] = SENTINEL(key);
  return config;
};

describe('sanitizeAuthConfig — allow-list', () => {
  it('drops every excluded field, including ones that do not exist yet', () => {
    const result = sanitizeAuthConfig(kitchenSinkAuthConfig() as never);
    const serialised = JSON.stringify(result);

    const leaked = EXCLUDED_KEYS.filter(
      (key) => serialised.includes(SENTINEL(key)) || Object.prototype.hasOwnProperty.call(result, key)
    );
    expect(leaked).toEqual([]);
    expect(serialised).not.toMatch(/SENTINEL_/);
  });

  it('emits only allow-listed keys', () => {
    const result = sanitizeAuthConfig(kitchenSinkAuthConfig() as never);
    const unexpected = Object.keys(result).filter(
      (key) => !(CLIENT_SAFE_AUTH_CONFIG_FIELDS as readonly string[]).includes(key)
    );
    expect(unexpected).toEqual([]);
  });

  it('preserves every allow-listed value', () => {
    const input = kitchenSinkAuthConfig();
    const result = sanitizeAuthConfig(input as never);

    expect(result.auth_type).toBe(input.auth_type);
    expect(result.auth_url).toBe(input.auth_url);
    expect(result.client_id).toBe(input.client_id);
    expect(result.redirect_uri).toBe(input.redirect_uri);
    expect(result.required_scopes).toEqual(input.required_scopes);
    expect(result.user_scopes).toEqual(input.user_scopes);
    expect(result.requires_pkce).toBe(true);
  });

  it('omits absent optional fields rather than emitting undefined/null keys', () => {
    const result = sanitizeAuthConfig({ auth_type: 'platform_key' } as never);
    expect(Object.prototype.hasOwnProperty.call(result, 'user_scopes')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'requires_pkce')).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      auth_type: 'platform_key',
      auth_url: '',
      client_id: '',
      redirect_uri: '',
      required_scopes: [],
    });
  });

  it('copies arrays so the process-cached definition cannot be mutated through the wire object', () => {
    const scopes = ['scope.read'];
    const userScopes = ['user.read'];
    const result = sanitizeAuthConfig({
      auth_type: 'oauth2',
      required_scopes: scopes,
      user_scopes: userScopes,
    } as never);

    expect(result.required_scopes).not.toBe(scopes);
    expect(result.user_scopes).not.toBe(userScopes);

    result.required_scopes.push('injected');
    result.user_scopes?.push('injected');
    expect(scopes).toEqual(['scope.read']);
    expect(userScopes).toEqual(['user.read']);
  });

  it('tolerates a missing or malformed auth_config', () => {
    expect(() => sanitizeAuthConfig(undefined)).not.toThrow();
    expect(() => sanitizeAuthConfig(null)).not.toThrow();
    // Arrays typed as strings, scopes typed as a string: never crash a route over bad data.
    const result = sanitizeAuthConfig({ auth_type: 1, required_scopes: 'nope' } as never);
    expect(result.auth_type).toBe('');
    expect(result.required_scopes).toEqual([]);
  });

  it('is what the branded type demands — an un-sanitised auth_config will not type-check', () => {
    // The compile-time half of the guarantee. If the brand is ever weakened, the
    // suppression directive below becomes an unused-directive error (TS2578) and this
    // suite stops compiling. (Prose must not start a line with the directive name:
    // TypeScript would read it as a second, genuinely unused directive.)
    const raw = {
      auth_type: 'oauth2',
      auth_url: 'https://example.com',
      client_id: 'id',
      client_secret: 'SUPER-SECRET',
      redirect_uri: 'https://app/cb',
      token_url: 'https://example.com/token',
      refresh_url: '',
      required_scopes: [],
    };
    // @ts-expect-error - a raw PluginAuthConfig is NOT assignable to ClientSafeAuthConfig
    const shouldNotCompile: import('@/lib/plugins/sanitize-plugin-definition').ClientSafeAuthConfig = raw;
    expect(shouldNotCompile).toBeDefined();
  });
});

describe('sanitizePluginDefinition / toClientPluginInfo', () => {
  const definition = (): PluginDefinition =>
    ({
      plugin: {
        name: 'Stripe',
        description: 'Payments',
        context: 'payments',
        version: '2.0.0',
        category: 'finance',
        isSystem: false,
        visibility: 'public',
        auth_config: kitchenSinkAuthConfig(),
      },
      actions: { create_invoice: {}, list_charges: {} },
    }) as unknown as PluginDefinition;

  it('sanitizePluginDefinition keeps everything except the excluded auth_config fields', () => {
    const result = sanitizePluginDefinition(definition());
    expect(JSON.stringify(result)).not.toMatch(/SENTINEL_/);
    expect(result.plugin.name).toBe('Stripe');
    expect(result.actions).toHaveProperty('create_invoice');
  });

  it('toClientPluginInfo returns the documented wire shape with no secrets', () => {
    const info = toClientPluginInfo('stripe', definition());

    expect(JSON.stringify(info)).not.toMatch(/SENTINEL_/);
    expect(Object.keys(info).sort()).toEqual(
      [
        'action_count',
        'actions',
        'auth_config',
        'auth_type',
        'context',
        'description',
        'isSystem',
        'key',
        'name',
        'version',
        'visibility',
      ].sort()
    );
    // Regression: Footer filters on isSystem, /test-business-os filters on visibility (PR #59).
    expect(info.isSystem).toBe(false);
    expect(info.visibility).toBe('public');
    expect(info.action_count).toBe(2);
  });

  it('defaults visibility to public and isSystem to false when absent', () => {
    const bare = {
      plugin: { name: 'X', description: '', context: '', version: '1', category: 'c', auth_config: {} },
      actions: {},
    } as unknown as PluginDefinition;
    const info = toClientPluginInfo('x', bare);
    expect(info.visibility).toBe('public');
    expect(info.isSystem).toBe(false);
  });
});

describe('every shipped plugin definition survives sanitisation without leaking', () => {
  const definitionsDir = path.join(__dirname, '..', 'definitions');
  const files = fs.existsSync(definitionsDir)
    ? fs.readdirSync(definitionsDir).filter((f) => f.endsWith('.json'))
    : [];

  it('found the definitions directory', () => {
    // Fail closed: an empty list would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s exposes no excluded auth_config field', (file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(definitionsDir, file), 'utf-8')) as PluginDefinition;
    const authConfig = raw.plugin?.auth_config as unknown as Record<string, unknown> | undefined;
    const sanitised = sanitizeAuthConfig(authConfig as never);

    for (const key of Object.keys(authConfig ?? {})) {
      if (!(CLIENT_SAFE_AUTH_CONFIG_FIELDS as readonly string[]).includes(key)) {
        expect(Object.prototype.hasOwnProperty.call(sanitised, key)).toBe(false);
      }
    }
    // Definitions carry ${ENV} placeholders for secrets; none may reach the wire shape.
    const serialised = JSON.stringify(sanitised);
    expect(serialised).not.toMatch(/SECRET/i);
    expect(serialised).not.toMatch(/\$\{[A-Z0-9_]*SECRET[A-Z0-9_]*\}/);
  });
});
