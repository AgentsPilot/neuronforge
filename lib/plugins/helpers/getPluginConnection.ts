// lib/plugins/helpers/getPluginConnection.ts
// Helper to get plugin connection with auto-refresh (server-side only)

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

/**
 * Get plugin connection with automatic token refresh
 * This function can only be used server-side (API routes, server components, server actions)
 * For client-side usage, call via an API route
 */
export async function getPluginConnection(userId: string, pluginKey: string) {
  const pluginManager = await PluginManagerV2.getInstance()
  const pluginDefinition = pluginManager.getPluginDefinition(pluginKey)

  if (!pluginDefinition) {
    throw new Error(`Plugin ${pluginKey} not found in registry`)
  }

  const connection = await pluginManager['userConnections'].getConnection(
    userId,
    pluginKey,
    pluginDefinition.plugin.auth_config
  )

  if (!connection) {
    throw new Error(`No active connection found for ${pluginKey}. Please connect in Settings.`)
  }

  return connection
}
