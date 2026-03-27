/**
 * Mock UserPluginConnections class for plugin executor tests.
 *
 * Provides a minimal implementation of getConnection() that returns
 * the mock connection created by mock-connection.ts, bypassing all
 * database and OAuth logic.
 */

import { createMockConnection, type MockConnection } from './mock-connection';

/**
 * Create a mock UserPluginConnections instance.
 *
 * The returned object satisfies the interface expected by both
 * BasePluginExecutor (this.userConnections.getConnection()) and
 * PluginManagerV2 constructor (which stores but rarely calls it
 * during validation-only usage).
 */
export function createMockUserConnections(
  pluginKey?: string,
  connectionOverrides?: Partial<MockConnection>
) {
  const connection = pluginKey
    ? createMockConnection(pluginKey, connectionOverrides)
    : null;

  return {
    getConnection: jest.fn().mockResolvedValue(connection),
    getConnectionStatus: jest.fn().mockResolvedValue({ connected: true, reason: 'connected' }),
    getConnectedPlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
    getConnectedPluginKeys: jest.fn().mockResolvedValue(pluginKey ? [pluginKey] : []),
    getAllActivePlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
    getDisconnectedPluginKeys: jest.fn().mockResolvedValue([]),
    isTokenValid: jest.fn().mockReturnValue(true),
    shouldRefreshToken: jest.fn().mockReturnValue(false),
    refreshToken: jest.fn().mockResolvedValue(connection),
  } as any;
}
