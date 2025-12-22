// lib/services/PluginTokenService.ts
// Common service for preparing and refreshing plugin tokens before execution

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PluginTokenService', service: 'plugin-tokens' });

export interface PluginTokenResult {
  ready: string[];
  failed: string[];
}

/**
 * Prepares plugin tokens for execution by checking and refreshing OAuth tokens as needed.
 * This should be called before executing any workflow that uses plugins.
 *
 * @param userId - The user ID to prepare tokens for
 * @param pluginsRequired - Array of plugin keys that need to be prepared
 * @returns Object with ready and failed plugin lists
 */
export async function preparePluginTokens(
  userId: string,
  pluginsRequired: string[]
): Promise<PluginTokenResult> {
  const result: PluginTokenResult = { ready: [], failed: [] };

  if (!pluginsRequired || !Array.isArray(pluginsRequired) || pluginsRequired.length === 0) {
    logger.debug({ userId }, 'No plugins required - skipping token preparation');
    return result;
  }

  logger.info({ userId, plugins: pluginsRequired }, 'Preparing plugin tokens');

  try {
    const pluginManager = await PluginManagerV2.getInstance();
    // Access userConnections through the plugin manager
    // Note: Using bracket notation to access private member for token refresh
    const userConnections = pluginManager['userConnections'];

    for (const pluginKey of pluginsRequired) {
      try {
        const pluginDefinition = pluginManager.getPluginDefinition(pluginKey);

        if (!pluginDefinition) {
          logger.warn({ pluginKey }, 'Plugin definition not found');
          result.failed.push(pluginKey);
          continue;
        }

        // System plugins don't need token refresh
        if (pluginDefinition.plugin.isSystem) {
          logger.debug({ pluginKey }, 'System plugin - no token refresh needed');
          result.ready.push(pluginKey);
          continue;
        }

        // getConnection handles: fetch + check expiry + refresh if needed
        const connection = await userConnections.getConnection(
          userId,
          pluginKey,
          pluginDefinition.plugin.auth_config
        );

        if (connection) {
          logger.debug({ pluginKey }, 'Plugin connection ready');
          result.ready.push(pluginKey);
        } else {
          logger.warn({ pluginKey }, 'Plugin connection not available - user may need to reconnect');
          result.failed.push(pluginKey);
        }
      } catch (pluginError) {
        logger.error({ err: pluginError, pluginKey }, 'Error preparing plugin token');
        result.failed.push(pluginKey);
      }
    }

    logger.info({
      userId,
      readyCount: result.ready.length,
      failedCount: result.failed.length,
      ready: result.ready,
      failed: result.failed
    }, 'Plugin token preparation complete');

    return result;
  } catch (error) {
    logger.error({ err: error, userId }, 'Plugin token preparation failed');
    // Return all plugins as failed if we couldn't even initialize
    return {
      ready: [],
      failed: [...pluginsRequired]
    };
  }
}

/**
 * Checks if all required plugins are ready (have valid tokens).
 * Returns true if all plugins are ready, false otherwise.
 */
export function areAllPluginsReady(result: PluginTokenResult): boolean {
  return result.failed.length === 0;
}

/**
 * Gets a human-readable message about plugin preparation status.
 */
export function getPluginStatusMessage(result: PluginTokenResult): string {
  if (result.failed.length === 0) {
    return `All ${result.ready.length} plugins ready`;
  }

  if (result.ready.length === 0) {
    return `All ${result.failed.length} plugins failed to prepare`;
  }

  return `${result.ready.length} plugins ready, ${result.failed.length} failed: ${result.failed.join(', ')}`;
}
