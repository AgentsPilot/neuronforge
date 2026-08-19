// app/api/plugins/user-status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { resolveActingUserIdentity } from '@/lib/server/route-identity';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', service: 'PluginUserStatus' });

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
    logger.debug({ key }, 'Cache invalidated');
  }

  clear() {
    this.cache.clear();
    logger.debug('All cache entries cleared');
  }
}

// Export cache instance for use in other routes (connect/disconnect)
export const pluginStatusCache = new ResponseCache();

const QuerySchema = z.object({
  // Optional act-as target; identity still comes from the session.
  userId: z.string().optional(),
});

// GET /api/plugins/user-status
// Returns the acting user's plugin connection status (connected vs available).
//
// IDENTITY: resolved from the SESSION. A `?userId=` query param is not an identity
// claim — it is an act-as request, honoured only for platform admins and audited. The
// previous "fall back to the userId query param for backward compatibility" branch made
// this endpoint an unauthenticated disclosure of any user's connected plugins, and is
// gone. See docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      userId: searchParams.get('userId') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request',
        details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
      }, { status: 400 });
    }

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: 'GET /api/plugins/user-status',
      request,
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;

    // Check cache first before doing any expensive operations
    const cacheKey = `plugin-status-${userId}`;
    const cachedResponse = pluginStatusCache.get(cacheKey);

    if (cachedResponse) {
      logger.debug({ userId }, 'Returning cached plugin status');
      return NextResponse.json(cachedResponse, {
        headers: {
          'X-Cache': 'HIT',
          // User-specific data varying only by cookie: a shared/CDN cache must never
          // store it. The in-process pluginStatusCache above still absorbs the cost.
          'Cache-Control': 'private, no-store',
          'Vary': 'Cookie'
        }
      });
    }

    logger.debug({ userId, actingAs: identity.actingAs }, 'Getting plugin status');

    // Get plugin manager instance
    let pluginManager;
    try {
      pluginManager = await PluginManagerV2.getInstance();
    } catch (err: any) {
      logger.error({ err, message: err.message }, 'Failed to get PluginManager instance');
      throw new Error(`PluginManager initialization failed: ${err.message}`);
    }

    // Run independent plugin queries in parallel for performance
    // getConnectedPlugins and getActiveExpiredPluginKeys are independent
    const [connectedPlugins, activeExpiredKeys] = await Promise.all([
      // Get user's connected plugins (status display - no token refresh needed)
      pluginManager.getConnectedPlugins(userId),
      // Get plugins with expired tokens (active in DB but need refresh)
      pluginManager.getActiveExpiredPluginKeys(userId),
    ]);

    // Extract connected plugin keys to pass to getDisconnectedPlugins (avoid duplicate DB query)
    const connectedKeys = Object.keys(connectedPlugins);

    // Get disconnected plugins, passing all active keys to avoid counting expired as disconnected
    // This must be sequential as it depends on results from above
    const allActiveKeys = [...connectedKeys, ...activeExpiredKeys];
    const disconnectedPlugins = await pluginManager.getDisconnectedPlugins(userId, allActiveKeys);
        
    // Format connected plugins with connection details
    const connected = Object.entries(connectedPlugins).map(([key, connectedPlugin]) => {
      const { definition, connection } = connectedPlugin;

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
        'Cache-Control': 'private, no-store',
        'Vary': 'Cookie'
      }
    });

  } catch (error: any) {
    logger.error({
      err: error,
      message: error.message,
      stack: error.stack,
      name: error.name
    }, 'Error getting user plugin status');

    return NextResponse.json({
      success: false,
      error: 'Failed to get user plugin status',
      // Internal error text must not reach the client in production.
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}