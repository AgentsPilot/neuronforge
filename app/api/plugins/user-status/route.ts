// app/api/plugins/user-status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// GET /api/plugins/user-status?userId={userId}
// Returns user's plugin connection status (connected vs available)
export async function GET(request: NextRequest) {
  try {
    // Get userId from query parameters
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Missing userId parameter'
      }, { status: 400 });
    }

    console.log(`DEBUG: API - Getting plugin status for user ${userId}`);

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Get user's actionable plugins (connected with valid tokens)
    // Enable token refresh to ensure we show accurate connection status
    const actionablePlugins = await pluginManager.getUserActionablePlugins(userId, { skipTokenRefresh: false });

    // Get disconnected plugins (available but not connected)
    const disconnectedPlugins = await pluginManager.getDisconnectedPlugins(userId);
        
    // Format connected plugins with connection details
    const connected = Object.entries(actionablePlugins).map(([key, actionablePlugin]) => {
      const { definition, connection } = actionablePlugin;      
      console.log(`DEBUG: API - Formatting plugin ${key} with connection details`);      
      return {
        key,
        name: definition.plugin.name,
        description: definition.plugin.description,
        context: definition.plugin.context,
        version: definition.plugin.version,
        auth_type: definition.plugin.auth_config.auth_type,
        status: 'connected',
        actions: Object.keys(definition.actions),
        action_count: Object.keys(definition.actions).length,
        // Connection details
        username: connection.username,
        email: connection.email,
        connected_at: connection.connected_at,
        last_used: connection.last_used
      };
    });

    // Format disconnected plugins
    const disconnected = Object.entries(disconnectedPlugins).map(([key, data]) => ({
      key,
      name: data.plugin.plugin.name,
      description: data.plugin.plugin.description,
      status: 'disconnected',
      reason: data.reason,
      auth_url: data.auth_url,
      actions: Object.keys(data.plugin.actions),
      action_count: Object.keys(data.plugin.actions).length
    }));

    console.log(`DEBUG: API - User ${userId} has ${connected.length} connected, ${disconnected.length} disconnected plugins`);

    return NextResponse.json({
      success: true,
      user_id: userId,
      connected,
      disconnected,
      summary: {
        connected_count: connected.length,
        disconnected_count: disconnected.length,
        total_available: connected.length + disconnected.length
      }
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error getting user plugin status:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get user plugin status',
      message: error.message
    }, { status: 500 });
  }
}