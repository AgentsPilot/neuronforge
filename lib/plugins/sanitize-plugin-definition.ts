/**
 * Client-safe projection of plugin definitions.
 *
 * WHY THIS EXISTS
 * `PluginManagerV2` substitutes `${ENV_VAR}` placeholders inside every plugin
 * definition before caching it (`plugin-manager-v2.ts` → `processEnvironmentVariables`),
 * so a cached `plugin.auth_config` holds REAL secrets: the platform Google OAuth
 * client secret, and for Stripe the full-privilege `STRIPE_SECRET_KEY`. Handing such
 * an object to `NextResponse.json` leaks them. That is exactly what
 * `GET /api/plugins/available` did, unauthenticated.
 *
 * THE RULE
 * Only the fields in `CLIENT_SAFE_AUTH_CONFIG_FIELDS` may cross the server→client
 * boundary. This is an ALLOW-list built field by field — never a spread plus
 * `delete` — so a new secret-bearing field added to a definition tomorrow is
 * dropped by default instead of leaking by default.
 *
 * WHY THE BRAND
 * A merely *narrow* type enforces nothing: `PluginAuthConfig` is structurally
 * assignable to a 7-field subset, and TypeScript's excess-property check fires only
 * on fresh object literals — so `auth_config: definition.plugin.auth_config` would
 * still compile clean and still leak. `ClientSafeAuthConfig` therefore carries a
 * required, symbol-keyed brand that only `sanitizeAuthConfig()` produces, which makes
 * "I forgot to sanitise" a compile error. The brand is a `unique symbol` with no
 * runtime value, so it never appears in `JSON.stringify` output: the wire shape is
 * unchanged.
 *
 * See docs/workplans/plugin-auth-config-exposure-workplan.md.
 */

import type { PluginAuthConfig, PluginDefinition, PluginVisibility } from '@/lib/types/plugin-types';

/**
 * Type-only brand. `declare const` means there is no runtime value, so no code
 * outside this module can construct a branded object without an explicit cast.
 */
declare const CLIENT_SAFE_BRAND: unique symbol;

/**
 * The single source of truth for what may cross the boundary. Derived from the only
 * browser reader of `auth_config` in the repo — `lib/client/oauth-handler.ts`, which
 * reads exactly `auth_url`, `client_id`, `redirect_uri`, `required_scopes`,
 * `user_scopes`, `requires_pkce` — plus `auth_type`, which the UI branches on.
 *
 * Adding a field here requires SA sign-off (it widens the public contract).
 */
export const CLIENT_SAFE_AUTH_CONFIG_FIELDS = [
  'auth_type',
  'auth_url',
  'client_id',
  'redirect_uri',
  'required_scopes',
  'user_scopes',
  'requires_pkce',
] as const;

export type ClientSafeAuthConfigField = (typeof CLIENT_SAFE_AUTH_CONFIG_FIELDS)[number];

/** The wire shape, before branding. */
export interface ClientSafeAuthConfigFields {
  auth_type: string;
  /** Provider authorize endpoint. Empty string for internal/`platform_key` plugins. */
  auth_url: string;
  /** Public by OAuth 2.0 design (RFC 6749 §2.2); the browser needs it to build the authorize URL. */
  client_id: string;
  redirect_uri: string;
  required_scopes: string[];
  user_scopes?: string[];
  requires_pkce?: boolean;
}

/**
 * An `auth_config` that has provably passed through `sanitizeAuthConfig()`.
 * Unforgeable without an explicit cast — see "WHY THE BRAND" above.
 */
export type ClientSafeAuthConfig = ClientSafeAuthConfigFields & {
  readonly [CLIENT_SAFE_BRAND]: 'sanitized';
};

/** Plugin definition safe to serialise: identical, except `auth_config` is sanitised. */
export type ClientSafePluginDefinition = Omit<PluginDefinition, 'plugin'> & {
  plugin: Omit<PluginDefinition['plugin'], 'auth_config'> & {
    auth_config: ClientSafeAuthConfig;
  };
};

/**
 * Copy an array so a client-bound object can never be used to mutate the
 * process-cached definition. `PluginManagerV2` keeps definitions in a `Map` for the
 * lambda's lifetime and other code already mutates cached definitions in place, so
 * aliasing `required_scopes` would be a cross-request corruption vector.
 */
const copyStrings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice() : undefined;

/**
 * Project an `auth_config` down to the allow-list.
 *
 * Built field by field on purpose: no spread, no `delete`, no iteration over the
 * input's keys. Anything not named here cannot appear in the result, including keys
 * that do not exist yet.
 */
export function sanitizeAuthConfig(
  authConfig: Partial<PluginAuthConfig> | null | undefined
): ClientSafeAuthConfig {
  const source = authConfig ?? {};

  const safe: ClientSafeAuthConfigFields = {
    auth_type: typeof source.auth_type === 'string' ? source.auth_type : '',
    auth_url: typeof source.auth_url === 'string' ? source.auth_url : '',
    client_id: typeof source.client_id === 'string' ? source.client_id : '',
    redirect_uri: typeof source.redirect_uri === 'string' ? source.redirect_uri : '',
    required_scopes: copyStrings(source.required_scopes) ?? [],
  };

  // Optional fields are omitted entirely when absent, rather than serialised as null.
  const userScopes = copyStrings(source.user_scopes);
  if (userScopes) safe.user_scopes = userScopes;
  if (typeof source.requires_pkce === 'boolean') safe.requires_pkce = source.requires_pkce;

  // The one cast in this module: it is what mints the brand. Everything above is an
  // explicit allow-listed copy, which is the invariant the brand advertises.
  return safe as ClientSafeAuthConfig;
}

/** Sanitise the `auth_config` of a whole definition, leaving every other field intact. */
export function sanitizePluginDefinition(definition: PluginDefinition): ClientSafePluginDefinition {
  return {
    ...definition,
    plugin: {
      ...definition.plugin,
      auth_config: sanitizeAuthConfig(definition.plugin?.auth_config),
    },
  };
}

/** Client-facing plugin summary — the `/api/plugins/available` response element. */
export interface ClientPluginInfo {
  key: string;
  name: string;
  description: string;
  context: string;
  version: string;
  auth_type: string;
  auth_config: ClientSafeAuthConfig;
  actions: string[];
  action_count: number;
  /** `Footer.tsx` filters on this. */
  isSystem: boolean;
  /** `/test-business-os` filters on this (PR #59 discovery scoping). */
  visibility: PluginVisibility;
}

/**
 * Build the client-facing summary for one plugin. The only place
 * `/api/plugins/available` is allowed to shape its response.
 */
export function toClientPluginInfo(key: string, definition: PluginDefinition): ClientPluginInfo {
  const plugin = definition.plugin;

  return {
    key,
    name: plugin.name,
    description: plugin.description,
    context: plugin.context,
    version: plugin.version,
    auth_type: plugin.auth_config?.auth_type ?? '',
    auth_config: sanitizeAuthConfig(plugin.auth_config),
    actions: Object.keys(definition.actions ?? {}),
    action_count: Object.keys(definition.actions ?? {}).length,
    isSystem: plugin.isSystem || false,
    visibility: (plugin.visibility as PluginVisibility) || 'public',
  };
}
