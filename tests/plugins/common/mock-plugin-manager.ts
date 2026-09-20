/**
 * Stub PluginManagerV2 for tests.
 *
 * Loads the real plugin definition JSON files from disk so that
 * validateActionParameters() runs against real schemas. Does NOT
 * use the singleton / globalThis pattern to avoid cross-test
 * contamination.
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { getPluginProfile } from '@/lib/server/plugin-profile';
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
  // Pin the 'all' profile: the per-plugin suites cover every plugin, not just the
  // ones the committed (Business OS) profile loads. Explicit profile, no env var.
  await pm.initializeWithCorePlugins(getPluginProfile('all'));

  cachedInstance = pm;
  return pm;
}
