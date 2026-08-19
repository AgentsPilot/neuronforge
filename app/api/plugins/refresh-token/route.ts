// app/api/plugins/refresh-token/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { resolveActingUserIdentity } from '@/lib/server/route-identity';
import { createLogger } from '@/lib/logger';
import { pluginStatusCache } from '@/app/api/plugins/user-status/route';

const logger = createLogger({ module: 'PluginRefreshTokenAPI' });

const BodySchema = z.object({
  pluginKeys: z.array(z.string().min(1)).optional(),
  // Optional act-as target; identity still comes from the session.
  userId: z.string().optional(),
});

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// POST /api/plugins/refresh-token
// Body: { pluginKeys?: string[] } (optional - if not provided, refreshes all expired)
//
// IDENTITY: resolved from the SESSION. The previous "fall back to the userId query
// param for backward compatibility" branch let an unauthenticated caller drive a token
// refresh for any user, and is gone. A `userId` is now only an act-as request, honoured
// for platform admins and audited. See
// docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.
//
// Refreshes OAuth tokens for user's plugins:
// - If pluginKeys provided: refresh those specific plugins (can be array of 1)
// - If no pluginKeys: refresh all plugins with expired tokens
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Body is optional on this route.
    const rawBody = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed');
      return NextResponse.json({
        success: false,
        error: 'Invalid request',
        details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
      }, { status: 400 });
    }

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: 'POST /api/plugins/refresh-token',
      request,
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;
    const pluginKeys = parsed.data.pluginKeys;

    requestLogger.info({ userId, actingAs: identity.actingAs }, 'Refreshing plugin tokens');

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    if (pluginKeys && Array.isArray(pluginKeys) && pluginKeys.length > 0) {
      // Refresh specific plugin(s)
      requestLogger.debug({ pluginKeys }, 'Refreshing specific plugins');

      const refreshResults = {
        refreshed: [] as string[],
        skipped: [] as string[],
        failed: [] as string[],
        notFound: [] as string[]
      };

      // Fetch all active connections once
      const allActiveConnections = await pluginManager['userConnections'].getAllActivePlugins(userId);

      // Process each plugin key
      for (const currentPluginKey of pluginKeys) {
        // Check if plugin exists in registry first
        const pluginDefinition = pluginManager.getPluginDefinition(currentPluginKey);
        if (!pluginDefinition) {
          requestLogger.debug({ pluginKey: currentPluginKey }, 'Plugin not found in registry');
          refreshResults.notFound.push(currentPluginKey);
          continue;
        }

        // Check if system plugin BEFORE checking connections (optimization)
        if (pluginDefinition.plugin.isSystem) {
          requestLogger.debug({ pluginKey: currentPluginKey }, 'System plugin — skipping refresh');
          refreshResults.skipped.push(currentPluginKey);
          continue;
        }

        // Find the connection for this plugin
        const connection = allActiveConnections.find(conn => conn.plugin_key === currentPluginKey);

        if (!connection) {
          requestLogger.debug({ pluginKey: currentPluginKey, userId }, 'Plugin not connected for this user');
          refreshResults.failed.push(currentPluginKey);
          continue;
        }

        // Check if token is expired or needs refresh
        const isExpired = !pluginManager['userConnections'].isTokenValid(connection.expires_at);
        const shouldRefresh = pluginManager['userConnections'].shouldRefreshToken(connection.expires_at, 5);

        if (!isExpired && !shouldRefresh) {
          requestLogger.debug({ pluginKey: currentPluginKey }, 'Token still valid — no refresh needed');
          refreshResults.skipped.push(currentPluginKey);
          continue;
        }

        // Attempt token refresh
        const authConfig = pluginDefinition.plugin.auth_config;
        const refreshedConnection = await pluginManager['userConnections'].refreshToken(connection, authConfig);

        if (refreshedConnection) {
          requestLogger.info({ pluginKey: currentPluginKey, userId }, 'Token refreshed');
          refreshResults.refreshed.push(currentPluginKey);
        } else {
          requestLogger.warn({ pluginKey: currentPluginKey, userId }, 'Token refresh failed');
          refreshResults.failed.push(currentPluginKey);
        }
      }

      // Invalidate cache after refresh
      const cacheKey = `plugin-status-${userId}`;
      pluginStatusCache.invalidate(cacheKey);

      const totalProcessed = refreshResults.refreshed.length + refreshResults.skipped.length +
                            refreshResults.failed.length + refreshResults.notFound.length;
      const hasErrors = refreshResults.failed.length > 0 || refreshResults.notFound.length > 0;

      return NextResponse.json({
        success: !hasErrors,
        message: `Processed ${totalProcessed} plugin(s): ${refreshResults.refreshed.length} refreshed, ${refreshResults.skipped.length} skipped, ${refreshResults.failed.length} failed, ${refreshResults.notFound.length} not found`,
        refreshed: refreshResults.refreshed,
        skipped: refreshResults.skipped,
        failed: refreshResults.failed,
        notFound: refreshResults.notFound
      }, { status: hasErrors ? 207 : 200 }); // 207 Multi-Status for partial success

    } else {
      // Refresh all expired plugins
      requestLogger.debug({ userId }, 'Refreshing all expired plugins');

      // Get all active plugins (including expired)
      const allActiveConnections = await pluginManager['userConnections'].getAllActivePlugins(userId);

      const refreshResults = {
        refreshed: [] as string[],
        skipped: [] as string[],
        failed: [] as string[]
      };

      for (const conn of allActiveConnections) {
        const pluginKey = conn.plugin_key;
        const definition = pluginManager.getPluginDefinition(pluginKey);

        if (!definition) {
          requestLogger.debug({ pluginKey }, 'Plugin connected but not in registry — skipping');
          refreshResults.skipped.push(pluginKey);
          continue;
        }

        // System plugins don't need refresh
        if (definition.plugin.isSystem) {
          refreshResults.skipped.push(pluginKey);
          continue;
        }

        // Check if token is expired or needs refresh
        if (conn.expires_at) {
          const isExpired = !pluginManager['userConnections'].isTokenValid(conn.expires_at);
          const shouldRefresh = pluginManager['userConnections'].shouldRefreshToken(conn.expires_at, 5);

          if (!isExpired && !shouldRefresh) {
            refreshResults.skipped.push(pluginKey);
            continue;
          }

          // Attempt to refresh the token
          const authConfig = definition.plugin.auth_config;
          const refreshedConnection = await pluginManager['userConnections'].refreshToken(conn, authConfig);

          if (refreshedConnection) {
            refreshResults.refreshed.push(pluginKey);
          } else {
            refreshResults.failed.push(pluginKey);
          }
        } else {
          // No expiration - skip
          refreshResults.skipped.push(pluginKey);
        }
      }

      // Invalidate cache after refresh
      const cacheKey = `plugin-status-${userId}`;
      pluginStatusCache.invalidate(cacheKey);

      const totalProcessed = refreshResults.refreshed.length + refreshResults.skipped.length + refreshResults.failed.length;

      return NextResponse.json({
        success: true,
        message: `Processed ${totalProcessed} plugins: ${refreshResults.refreshed.length} refreshed, ${refreshResults.skipped.length} skipped, ${refreshResults.failed.length} failed`,
        refreshed: refreshResults.refreshed,
        skipped: refreshResults.skipped,
        failed: refreshResults.failed
      });
    }

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Error refreshing tokens');

    return NextResponse.json({
      success: false,
      error: 'Failed to refresh tokens',
      // Internal error text must not reach the client in production.
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}
