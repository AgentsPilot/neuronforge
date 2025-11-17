// app/api/plugins/refresh-token/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServer';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { pluginStatusCache } from '@/app/api/plugins/user-status/route';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// POST /api/plugins/refresh-token
// Body: { pluginKeys?: string[] } (optional - if not provided, refreshes all expired)
// Auth: Cookie-based (primary) or userId query param (backward compatibility)
//
// Refreshes OAuth tokens for user's plugins:
// - If pluginKeys provided: refresh those specific plugins (can be array of 1)
// - If no pluginKeys: refresh all plugins with expired tokens
export async function POST(request: NextRequest) {
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

    console.log(`DEBUG: API - Refreshing tokens for user ${userId} (auth: ${authMethod})`);

    // Parse request body for optional pluginKeys
    let pluginKeys: string[] | undefined;
    try {
      const body = await request.json();
      pluginKeys = body.pluginKeys;
    } catch {
      // Body is optional, so no error if parsing fails
      pluginKeys = undefined;
    }

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    if (pluginKeys && Array.isArray(pluginKeys) && pluginKeys.length > 0) {
      // Refresh specific plugin(s)
      console.log(`DEBUG: API - Refreshing specific plugins: ${pluginKeys.join(', ')}`);

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
          console.log(`DEBUG: Plugin ${currentPluginKey} not found in registry`);
          refreshResults.notFound.push(currentPluginKey);
          continue;
        }

        // Check if system plugin BEFORE checking connections (optimization)
        if (pluginDefinition.plugin.isSystem) {
          console.log(`DEBUG: Plugin ${currentPluginKey} is a system plugin, skipping`);
          refreshResults.skipped.push(currentPluginKey);
          continue;
        }

        // Find the connection for this plugin
        const connection = allActiveConnections.find(conn => conn.plugin_key === currentPluginKey);

        if (!connection) {
          console.log(`DEBUG: Plugin ${currentPluginKey} is not connected for this user`);
          refreshResults.failed.push(currentPluginKey);
          continue;
        }

        // Check if token is expired or needs refresh
        const isExpired = !pluginManager['userConnections'].isTokenValid(connection.expires_at);
        const shouldRefresh = pluginManager['userConnections'].shouldRefreshToken(connection.expires_at, 5);

        if (!isExpired && !shouldRefresh) {
          console.log(`DEBUG: Token for ${currentPluginKey} is still valid, no refresh needed`);
          refreshResults.skipped.push(currentPluginKey);
          continue;
        }

        // Attempt token refresh
        const authConfig = pluginDefinition.plugin.auth_config;
        const refreshedConnection = await pluginManager['userConnections'].refreshToken(connection, authConfig);

        if (refreshedConnection) {
          console.log(`DEBUG: Successfully refreshed token for ${currentPluginKey}`);
          refreshResults.refreshed.push(currentPluginKey);
        } else {
          console.log(`DEBUG: Failed to refresh token for ${currentPluginKey}`);
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
      console.log(`DEBUG: API - Refreshing all expired plugins`);

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
          console.log(`DEBUG: Plugin ${pluginKey} connected but not in registry, skipping`);
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
    console.error('DEBUG: API - Error refreshing tokens:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to refresh tokens',
      message: error.message
    }, { status: 500 });
  }
}
