// app/api/plugins/available/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// GET /api/plugins/available
// Returns all plugins available in the registry (regardless of user connections)
export async function GET(request: NextRequest) {
  try {
    console.log('DEBUG: API - Getting available plugins');
    
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

    console.log(`DEBUG: API - Returning ${formatted.length} available plugins`);

    return NextResponse.json({
      success: true,
      plugins: formatted,
      total: formatted.length
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error getting available plugins:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get available plugins',
      message: error.message
    }, { status: 500 });
  }
}