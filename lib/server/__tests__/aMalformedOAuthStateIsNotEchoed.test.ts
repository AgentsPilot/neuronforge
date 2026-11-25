/**
 * handleOAuthCallback — a malformed `state` fails as "Invalid state".
 *
 * `JSON.parse` throws a SyntaxError whose message quotes the start of its
 * input. That message used to reach the logger, the audit row and (through the
 * callback route) the client. The state value must appear in none of them.
 *
 * Every seam is mocked: no repository, no token exchange, no network.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...a: unknown[]) => mockLog.info(...a),
    warn: (...a: unknown[]) => mockLog.warn(...a),
    error: (...a: unknown[]) => mockLog.error(...a),
    debug: (...a: unknown[]) => mockLog.debug(...a),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

jest.mock('@/lib/repositories', () => ({
  PluginConnectionRepository: class {},
  pluginConnectionRepository: {},
}));

const mockExchange = jest.fn();
const mockFetchProfile = jest.fn();
jest.mock('@/lib/services/OAuthTokenService', () => ({
  exchangeCodeForTokens: (...a: unknown[]) => mockExchange(...a),
  fetchUserProfile: (...a: unknown[]) => mockFetchProfile(...a),
  calculateExpiresAt: () => null,
  refreshAccessToken: jest.fn(),
  refreshAccessTokenDetailed: jest.fn(),
}));

const mockAudit = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAudit(...a) },
}));

import { UserPluginConnections } from '../user-plugin-connections';
import type { PluginConnectionRepository } from '@/lib/repositories';
import type { PluginAuthConfig } from '@/lib/types/plugin-types';

// Ten characters: V8's SyntaxError quotes about this much of its input.
const PLANTED = 'pl4nted9c1';

const authConfig = {
  auth_type: 'oauth2',
  client_id: 'id',
  client_secret: 'secret',
} as PluginAuthConfig;

const repo = {
  existsByUserAndPlugin: jest.fn(),
  upsert: jest.fn(),
};

function connections() {
  return new UserPluginConnections(repo as unknown as PluginConnectionRepository);
}

/** Every argument of every logger and audit call, serialised. */
function everythingRecorded(): string {
  return JSON.stringify(
    [mockLog.info, mockLog.warn, mockLog.error, mockLog.debug, mockAudit].map((fn) => fn.mock.calls),
    (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAudit.mockResolvedValue(undefined);
  mockExchange.mockResolvedValue({ access_token: 'at', expires_in: 3600 });
  mockFetchProfile.mockResolvedValue({ email: 'owner@example.test' });
  repo.existsByUserAndPlugin.mockResolvedValue({ data: false });
  repo.upsert.mockResolvedValue({ data: { id: 'conn-1', user_id: 'user-1', plugin_key: 'example' }, error: null });
});

describe('handleOAuthCallback — malformed state', () => {
  it.each([
    ['text that is not JSON', `${PLANTED}-not-json`],
    ['a JSON null', 'null'],
    ['a JSON number', '42'],
    ['a bad percent-escape', `%E0%A4%A-${PLANTED}`],
    ['a non-string code_verifier', JSON.stringify({ user_id: 'u', plugin_key: 'p', code_verifier: 7 })],
  ])('rejects %s with a generic "Invalid state"', async (_label, state) => {
    await expect(connections().handleOAuthCallback('code', state, authConfig)).rejects.toThrow(
      new Error('Invalid state')
    );
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('keeps the state value out of the logs and the audit row', async () => {
    await expect(
      connections().handleOAuthCallback('code', `${PLANTED}-not-json`, authConfig)
    ).rejects.toThrow('Invalid state');

    expect(everythingRecorded()).not.toContain(PLANTED);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLUGIN_AUTH_FAILED',
        details: expect.objectContaining({ error_message: 'Invalid state' }),
      })
    );
  });

  it('still accepts a well-formed state', async () => {
    const state = encodeURIComponent(
      JSON.stringify({ user_id: 'user-1', plugin_key: 'example', code_verifier: 'v' })
    );

    await connections().handleOAuthCallback('code', state, authConfig);

    expect(mockExchange).toHaveBeenCalledWith('code', authConfig, 'v');
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', plugin_key: 'example' })
    );
  });
});
