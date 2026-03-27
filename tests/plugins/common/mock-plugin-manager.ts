/**
 * Stub PluginManagerV2 for tests.
 *
 * Loads the real plugin definition JSON files from disk so that
 * validateActionParameters() runs against real schemas. Does NOT
 * use the singleton / globalThis pattern to avoid cross-test
 * contamination.
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createMockUserConnections } from './mock-user-connections';

let cachedInstance: PluginManagerV2 | null = null;

/**
 * Returns a PluginManagerV2 instance backed by real JSON definitions.
 *
 * The instance is created once and cached for the entire test run
 * (JSON definitions do not change between tests). The mock
 * UserPluginConnections passed to the constructor is a bare stub;
 * only validation and definition-related methods are called.
 */
export async function createTestPluginManager(): Promise<PluginManagerV2> {
  if (cachedInstance && cachedInstance.initialized) {
    return cachedInstance;
  }

  const mockUserConnections = createMockUserConnections();
  const pm = new PluginManagerV2(mockUserConnections);
  await pm.initializeWithCorePlugins();

  cachedInstance = pm;
  return pm;
}
