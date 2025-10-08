// app/api/plugins/disconnect/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';

// POST /api/plugins/disconnect
// Disconnects a plugin for a user
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { userId, pluginKey } = body;

    // Validate required fields
    if (!userId || !pluginKey) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields',
        message: 'userId and pluginKey are required'
      }, { status: 400 });
    }

    console.log(`DEBUG: API - Disconnecting plugin ${pluginKey} for user ${userId}`);

    // Get user connections instance
    const userConnections = UserPluginConnections.getInstance();
    
    // Disconnect the plugin
    const success = await userConnections.disconnectPlugin(userId, pluginKey);
    
    if (success) {
      console.log(`DEBUG: API - Successfully disconnected ${pluginKey} for user ${userId}`);
      
      return NextResponse.json({
        success: true,
        message: `${pluginKey} disconnected successfully`,
        plugin_key: pluginKey,
        user_id: userId,
        disconnected_at: new Date().toISOString()
      });
    } else {
      console.error(`DEBUG: API - Failed to disconnect ${pluginKey} for user ${userId}`);
      
      return NextResponse.json({
        success: false,
        error: 'Disconnect failed',
        message: `Failed to disconnect ${pluginKey}. The plugin may not be connected or there was a database error.`
      }, { status: 400 });
    }

  } catch (error: any) {
    console.error('DEBUG: API - Error disconnecting plugin:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Disconnect failed',
      message: error.message
    }, { status: 500 });
  }
}

// GET /api/plugins/disconnect?userId={userId}&pluginKey={pluginKey}
// Check if a plugin can be disconnected (for UI state)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const pluginKey = searchParams.get('pluginKey');

    if (!userId || !pluginKey) {
      return NextResponse.json({
        success: false,
        error: 'Missing required parameters',
        message: 'userId and pluginKey are required'
      }, { status: 400 });
    }

    console.log(`DEBUG: API - Checking disconnect status for ${pluginKey}, user ${userId}`);

    // Get user connections instance
    const userConnections = UserPluginConnections.getInstance();
    
    // Check connection status
    const status = await userConnections.getConnectionStatus(userId, pluginKey);
    
    return NextResponse.json({
      success: true,
      plugin_key: pluginKey,
      user_id: userId,
      can_disconnect: status.connected,
      current_status: status.reason,
      expires_at: status.expires_at
    });

  } catch (error: any) {
    console.error('DEBUG: API - Error checking disconnect status:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Status check failed',
      message: error.message
    }, { status: 500 });
  }
}