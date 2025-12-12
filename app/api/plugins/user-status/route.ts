// app/api/plugins/user-status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// Simple in-memory response cache with automatic cleanup
class ResponseCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private TTL = 30000; // 30 seconds cache TTL

  get(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key: string, data: any) {
    this.cache.set(key, { data, timestamp: Date.now() });

    // Cleanup old entries to prevent memory leaks
    if (this.cache.size > 100) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now - v.timestamp > this.TTL) {
          this.cache.delete(k);
        }
      }
    }
  }

  invalidate(key: string) {
    this.cache.delete(key);
    console.log(`DEBUG: Cache invalidated for key: ${key}`);
  }

  clear() {
    this.cache.clear();
    console.log('DEBUG: All cache entries cleared');
  }
}

// Export cache instance for use in other routes (connect/disconnect)
export const pluginStatusCache = new ResponseCache();

// GET /api/plugins/user-status?userId={userId} (optional)
// Returns user's plugin connection status (connected vs available)
// Auth: Cookie-based (primary) or userId query param (backward compatibility)
export async function GET(request: NextRequest) {
  try {
    // Try cookie-based authentication first (preferred method)
    let userId: string | null = null;
    let authMethod = 'query-param'; // for logging

    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (user && !authError) {
      // Cookie auth successful
      userId = user.id;
      authMethod = 'cookie';
    } else {
      // Fall back to query parameter for backward compatibility
      const { searchParams } = new URL(request.url);
      userId = searchParams.get('userId');

      if (!userId) {
        return NextResponse.json({
          success: false,
          error: 'Authentication required. Please log in or provide userId parameter.'
        }, { status: 401 });
      }
    }

    // Check cache first before doing any expensive operations
    const cacheKey = `plugin-status-${userId}`;
    const cachedResponse = pluginStatusCache.get(cacheKey);

    if (cachedResponse) {
      console.log(`DEBUG: API - Returning CACHED plugin status for user ${userId}`);
      return NextResponse.json(cachedResponse, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60'
        }
      });
    }

    console.log(`DEBUG: API - Getting plugin status for user ${userId} (auth: ${authMethod})`);

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Get user's connected plugins (status display - no token refresh needed)
    // Using getConnectedPlugins() for fast status checks without OAuth operations
    const connectedPlugins = await pluginManager.getConnectedPlugins(userId);

    // Extract connected plugin keys to pass to getDisconnectedPlugins (avoid duplicate DB query)
    const connectedKeys = Object.keys(connectedPlugins);

    // Get plugins with expired tokens (active in DB but need refresh)
    const activeExpiredKeys = await pluginManager.getActiveExpiredPluginKeys(userId);

    // Get disconnected plugins, passing all active keys to avoid counting expired as disconnected
    const allActiveKeys = [...connectedKeys, ...activeExpiredKeys];
    const disconnectedPlugins = await pluginManager.getDisconnectedPlugins(userId, allActiveKeys);
        
    // Format connected plugins with connection details
    const connected = Object.entries(connectedPlugins).map(([key, connectedPlugin]) => {
      const { definition, connection } = connectedPlugin;
      console.log(`DEBUG: API - Formatting plugin ${key} with connection details`);

      // Check if this is a system plugin
      const isSystemPlugin = definition.plugin.isSystem || false;

      return {
        key,
        name: definition.plugin.name,
        description: definition.plugin.description,
        context: definition.plugin.context,
        version: definition.plugin.version,
        auth_type: definition.plugin.auth_config.auth_type,
        status: 'connected',
        is_system: isSystemPlugin,
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

    console.log(`DEBUG: API - User ${userId} has ${connected.length} connected, ${activeExpiredKeys.length} active expired, ${disconnected.length} disconnected plugins`);

    // Build response data
    const responseData = {
      success: true,
      user_id: userId,
      connected,
      active_expired: activeExpiredKeys,
      disconnected,
      summary: {
        connected_count: connected.length,
        active_expired_count: activeExpiredKeys.length,
        disconnected_count: disconnected.length,
        total_available: connected.length + disconnected.length
      }
    };

    // Store in cache for future requests
    pluginStatusCache.set(cacheKey, responseData);

    return NextResponse.json(responseData, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60'
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