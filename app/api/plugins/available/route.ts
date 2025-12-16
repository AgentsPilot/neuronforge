// app/api/plugins/available/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', service: 'PluginsAvailable' });

// GET /api/plugins/available
// Returns all plugins available in the registry (regardless of user connections)
export async function GET(request: NextRequest) {
  try {
    logger.debug('Getting available plugins');

    // Get plugin manager instance (singleton with cold start handling)
    const pluginManager = await PluginManagerV2.getInstance();

    // Get all available plugins
    const availablePlugins = pluginManager.getAvailablePlugins();

    // Format response for client consumption
    const formatted = Object.entries(availablePlugins).map(([key, definition]) => ({
      key,
      name: definition.plugin.name,
      description: definition.plugin.description,
      context: definition.plugin.context,
      version: definition.plugin.version,
      auth_type: definition.plugin.auth_config.auth_type,
      auth_config: definition.plugin.auth_config, // Include processed auth config
      actions: Object.keys(definition.actions),
      action_count: Object.keys(definition.actions).length,
      isSystem: definition.plugin.isSystem || false // Include system flag
    }));

    logger.debug({ count: formatted.length }, 'Returning available plugins');

    return NextResponse.json({
      success: true,
      plugins: formatted,
      total: formatted.length
    });

  } catch (error: any) {
    logger.error({ err: error }, 'Error getting available plugins');

    return NextResponse.json({
      success: false,
      error: 'Failed to get available plugins',
      message: error.message
    }, { status: 500 });
  }
}