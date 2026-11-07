/**
 * GET /oauth/callback/[plugin] — what reaches the logger.
 *
 * The callback carries a one-time authorization code and the state value.
 * Neither may be handed to the logger, on any branch: log key names, never
 * parameter values. The leak check runs on every argument of every logger call,
 * so it holds whatever the logger's redaction list happens to contain.
 *
 * Every seam is mocked: no plugin manager, no Supabase, no network.
 */

import { NextRequest } from 'next/server';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockGetPluginDefinition = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({ getPluginDefinition: (...a: unknown[]) => mockGetPluginDefinition(...a) }),
  },
}));

const mockHandleOAuthCallback = jest.fn();
const mockUpdateProfileData = jest.fn();
jest.mock('@/lib/server/user-plugin-connections', () => ({
  UserPluginConnections: {
    getInstance: () => ({
      handleOAuthCallback: (...a: unknown[]) => mockHandleOAuthCallback(...a),
      updateConnectionProfileData: (...a: unknown[]) => mockUpdateProfileData(...a),
    }),
  },
}));

import { GET } from '../route';

const PLANTED_CODE = 'planted-auth-code-7f3a9c';
const PLANTED_STATE = 'planted-state-value-b81d42';
const PLANTED_PROFILE_VALUE = 'planted-profile-value-e05c17';

function callback(query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return GET(new NextRequest(`http://localhost/oauth/callback/example?${qs}`), {
    params: Promise.resolve({ plugin: 'example' }),
  });
}

/** Every argument of every logger call, serialised. */
function everythingLogged(): string {
  return JSON.stringify(
    [mockLog.info, mockLog.warn, mockLog.error, mockLog.debug].map((fn) => fn.mock.calls)
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPluginDefinition.mockReturnValue({
    plugin: { auth_config: { oauth_callback_profile_params: ['shop'] } },
  });
  mockHandleOAuthCallback.mockResolvedValue({
    user_id: 'user-1',
    plugin_key: 'example',
    plugin_name: 'Example',
    username: '',
    connected_at: '2026-11-07T00:00:00.000Z',
  });
  mockUpdateProfileData.mockResolvedValue(undefined);
});

describe('GET /oauth/callback/[plugin] — callback parameter values never reach the logger', () => {
  it('logs the received key names, not the code or state, when the expected profile params are missing', async () => {
    await callback({ code: PLANTED_CODE, state: PLANTED_STATE });

    const logged = everythingLogged();
    expect(logged).not.toContain(PLANTED_CODE);
    expect(logged).not.toContain(PLANTED_STATE);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ expectedParams: ['shop'], receivedKeys: ['code', 'state'] }),
      'OAuth callback missing expected profile params'
    );
  });

  it('logs the stored profile param names, not their values', async () => {
    await callback({ code: PLANTED_CODE, state: PLANTED_STATE, shop: PLANTED_PROFILE_VALUE });

    expect(mockUpdateProfileData).toHaveBeenCalledWith('user-1', 'example', { shop: PLANTED_PROFILE_VALUE });
    const logged = everythingLogged();
    expect(logged).not.toContain(PLANTED_CODE);
    expect(logged).not.toContain(PLANTED_STATE);
    expect(logged).not.toContain(PLANTED_PROFILE_VALUE);
    expect(mockLog.info).toHaveBeenCalledWith({ storedParams: ['shop'] }, 'Stored plugin profile data');
  });

  it('does not log the code or state on the provider-error branch', async () => {
    await callback({ code: PLANTED_CODE, state: PLANTED_STATE, error: 'access_denied' });

    const logged = everythingLogged();
    expect(logged).not.toContain(PLANTED_CODE);
    expect(logged).not.toContain(PLANTED_STATE);
  });

  it('does not log the code or state when the token exchange throws', async () => {
    mockHandleOAuthCallback.mockRejectedValue(new Error('exchange failed'));

    await callback({ code: PLANTED_CODE, state: PLANTED_STATE });

    const logged = everythingLogged();
    expect(logged).not.toContain(PLANTED_CODE);
    expect(logged).not.toContain(PLANTED_STATE);
  });
});
