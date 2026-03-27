/**
 * Fake OAuth connection factory for plugin executor tests.
 *
 * Returns UserConnection-shaped objects with canned tokens and metadata.
 * Plugin-specific overrides (e.g. WhatsApp phone_number_id) are handled
 * via the overrides parameter.
 */

export interface MockConnection {
  id: string;
  user_id: string;
  plugin_key: string;
  plugin_name: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  username: string;
  email: string | null;
  profile_data: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  status: string;
  connected_at: string;
  updated_at: string;
}

const PLUGIN_DEFAULTS: Record<string, Partial<MockConnection>> = {
  'whatsapp-business': {
    profile_data: {
      phone_number_id: 'mock-phone-number-id-123',
      waba_id: 'mock-waba-id-456',
    },
  },
  linkedin: {
    profile_data: {
      sub: 'mock-linkedin-sub-789',
    },
  },
};

/**
 * Create a mock connection object for a given plugin key.
 * Token expiry is set 1 hour in the future by default.
 */
export function createMockConnection(
  pluginKey: string,
  overrides?: Partial<MockConnection>
): MockConnection {
  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const defaults = PLUGIN_DEFAULTS[pluginKey] ?? {};

  return {
    id: 'test-connection-id',
    user_id: 'test-user-id',
    plugin_key: pluginKey,
    plugin_name: pluginKey,
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_at: futureExpiry,
    scope: null,
    username: 'test-user',
    email: 'test@example.com',
    profile_data: null,
    settings: {},
    status: 'active',
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...defaults,
    ...overrides,
  };
}
