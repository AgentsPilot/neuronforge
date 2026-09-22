/**
 * Shared secret matcher for the plugin-route egress tests.
 *
 * Two complementary checks, because either alone can pass vacuously:
 *
 *   1. VALUE check — every secret env var is seeded with a unique sentinel before the
 *      route runs, and no sentinel may appear anywhere in the response. This is stronger
 *      than prefix regexes: it catches a leak regardless of the value's shape.
 *   2. KEY-NAME check — the response must not contain the secret field *names* either.
 *      On a dev box with an empty env, PluginManagerV2 leaves `${STRIPE_SECRET_KEY}`
 *      verbatim in the definition, so a value-only assertion would pass while the route
 *      still shipped `client_secret` to the browser.
 *
 * Lives in lib/testing/ rather than under a __tests__ directory: jest.config.js
 * testMatch collects EVERY .ts file under __tests__, so a helper placed there is
 * reported as a suite with no tests (verified — that is why it moved here).
 */

/** Sentinels are deliberately not secret-shaped, so only a real leak matches them. */
export const SENTINELS = {
  STRIPE_SECRET_KEY: 'SENTINEL_STRIPE_SECRET_VALUE',
  GOOGLE_CLIENT_SECRET: 'SENTINEL_GOOGLE_SECRET_VALUE',
  NOTION_CLIENT_SECRET: 'SENTINEL_NOTION_SECRET_VALUE',
  SLACK_CLIENT_SECRET: 'SENTINEL_SLACK_SECRET_VALUE',
  WHATSAPP_CONFIG_ID: 'SENTINEL_WHATSAPP_CONFIG_VALUE',
} as const;

/**
 * Seed the env the way production does, so anything the manager substitutes — or any
 * route that reads an env var directly — is traceable in the response body.
 */
export function seedSecretEnv(): void {
  for (const [key, value] of Object.entries(SENTINELS)) {
    process.env[key] = value;
  }
}

/** Field names that must never appear in a client-bound payload. */
const FORBIDDEN_KEYS = [
  'client_secret',
  'token_url',
  'refresh_url',
  'profile_url',
  'profile_headers',
  'api_key',
  'private_key',
  'signing_secret',
  'webhook_secret',
  'access_token',
  'refresh_token',
];

/** Value shapes that are secrets regardless of the key they hide behind. */
const FORBIDDEN_VALUE_PATTERNS: Array<[string, RegExp]> = [
  ['stripe live/test key', /\bsk_(live|test)_[A-Za-z0-9]/],
  ['openai-style key', /\bsk-[A-Za-z0-9]{20,}/],
  ['google client secret', /GOCSPX-[A-Za-z0-9_-]+/],
  ['unsubstituted secret placeholder', /\$\{[A-Z0-9_]*SECRET[A-Z0-9_]*\}/],
];

export interface SecretScanResult {
  findings: string[];
}

/** Scan any serialisable payload for secrets. Returns findings rather than throwing. */
export function scanForSecrets(payload: unknown): SecretScanResult {
  const serialised = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  const findings: string[] = [];

  for (const [key, value] of Object.entries(SENTINELS)) {
    if (serialised.includes(value)) findings.push(`env value leaked: ${key}`);
  }
  for (const key of FORBIDDEN_KEYS) {
    if (serialised.includes(`"${key}"`)) findings.push(`forbidden key present: ${key}`);
  }
  for (const [label, pattern] of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(serialised)) findings.push(`forbidden value shape: ${label}`);
  }

  return { findings };
}

/** Assert a payload carries no secret. Use in every route egress test. */
export function assertNoSecrets(payload: unknown): void {
  expect(scanForSecrets(payload).findings).toEqual([]);
}
