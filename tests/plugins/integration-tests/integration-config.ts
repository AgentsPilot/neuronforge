/**
 * Integration test configuration helper.
 *
 * Reads real API credentials from environment variables and provides
 * skip guards and connection builders for integration tests.
 *
 * Integration tests are designed to skip gracefully when credentials
 * are not available -- this is by design for local development and CI
 * environments without secrets configured.
 */

export interface IntegrationCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Plugin-specific extra fields (e.g., spreadsheet ID, channel ID) */
  extras: Record<string, string>;
}

/**
 * Credential mapping per plugin key.
 *
 * Each entry defines:
 * - `tokenEnv`: the environment variable holding the access/API token
 * - `refreshEnv`: optional env var for refresh token
 * - `extras`: map of logical name -> env var name for plugin-specific config
 */
const CREDENTIAL_MAP: Record<string, {
  tokenEnv: string;
  refreshEnv?: string;
  extras: Record<string, string>;
}> = {
  'google-mail': {
    tokenEnv: 'GOOGLE_MAIL_TEST_TOKEN',
    refreshEnv: 'GOOGLE_MAIL_TEST_REFRESH_TOKEN',
    extras: {},
  },
  'google-sheets': {
    tokenEnv: 'GOOGLE_SHEETS_TEST_TOKEN',
    refreshEnv: 'GOOGLE_SHEETS_TEST_REFRESH_TOKEN',
    extras: {
      spreadsheetId: 'GOOGLE_SHEETS_TEST_SPREADSHEET_ID',
    },
  },
  'slack': {
    tokenEnv: 'SLACK_TEST_TOKEN',
    extras: {
      channelId: 'SLACK_TEST_CHANNEL_ID',
    },
  },
  'notion': {
    tokenEnv: 'NOTION_TEST_TOKEN',
    extras: {
      parentPageId: 'NOTION_TEST_PARENT_PAGE_ID',
    },
  },
  'google-drive': {
    tokenEnv: 'GOOGLE_DRIVE_TEST_TOKEN',
    refreshEnv: 'GOOGLE_DRIVE_TEST_REFRESH_TOKEN',
    extras: {
      folderId: 'GOOGLE_DRIVE_TEST_FOLDER_ID',
    },
  },
};

/**
 * Check whether credentials are available for a given plugin.
 * Returns true only if the required token env var is set and non-empty.
 */
export function hasCredentials(pluginKey: string): boolean {
  const config = CREDENTIAL_MAP[pluginKey];
  if (!config) return false;
  const token = process.env[config.tokenEnv];
  return typeof token === 'string' && token.length > 0;
}

/**
 * Read credentials from environment variables for a given plugin.
 * Returns null if the required token is not set.
 */
export function getCredentials(pluginKey: string): IntegrationCredentials | null {
  const config = CREDENTIAL_MAP[pluginKey];
  if (!config) return null;

  const accessToken = process.env[config.tokenEnv];
  if (!accessToken) return null;

  const refreshToken = config.refreshEnv ? process.env[config.refreshEnv] : undefined;

  const extras: Record<string, string> = {};
  for (const [key, envVar] of Object.entries(config.extras)) {
    const val = process.env[envVar];
    if (val) {
      extras[key] = val;
    }
  }

  return { accessToken, refreshToken, extras };
}

/**
 * Build a mock connection object suitable for passing to an executor,
 * using real credentials from environment variables.
 *
 * Returns null if credentials are not available.
 */
export function getTestConnection(pluginKey: string): Record<string, unknown> | null {
  const creds = getCredentials(pluginKey);
  if (!creds) return null;

  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return {
    id: `integration-test-${pluginKey}`,
    user_id: 'integration-test-user',
    plugin_key: pluginKey,
    plugin_name: pluginKey,
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken || null,
    expires_at: futureExpiry,
    scope: null,
    username: 'integration-test',
    email: 'integration-test@example.com',
    profile_data: null,
    settings: {},
    status: 'active',
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Helper to generate a unique test identifier for cleanup tracking.
 * Prefixed with "agentpilot-test-" so test artifacts are easy to identify.
 */
export function generateTestId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `agentpilot-test-${ts}-${rand}`;
}

/**
 * Conditional describe helper.
 * Returns `describe.skip` when credentials are not available,
 * allowing the test file to be included in all test runs without
 * failing when secrets are not configured.
 */
export function describeIfCredentials(
  pluginKey: string
): typeof describe | typeof describe.skip {
  return hasCredentials(pluginKey) ? describe : describe.skip;
}
