// app/api/user/plugins/route.ts
// ⚠️ DEPRECATED: This endpoint is deprecated and will be removed in a future version.
// Please use /api/plugins/user-status instead for:
// - Better performance (~90% faster)
// - Cookie-based authentication
// - Richer plugin data (connection details, action lists)
// - Clean V2 response format

import { createAuthenticatedServerClient } from '@/lib/supabaseServer'
import { pluginList } from '@/lib/plugins/pluginList'

// Import PluginManagerV2 for enhanced plugin management
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context'

export async function GET() {
  console.warn('⚠️ DEPRECATED: /api/user/plugins is deprecated. Please migrate to /api/plugins/user-status')
  console.log('API: /api/user/plugins called')

  const supabase = await createAuthenticatedServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return new Response(JSON.stringify({}), { status: 401 })
  }

  let connectedPluginKeys: string[] = [];
  let connectedPluginMetaData: PluginDefinitionContext[] = []
  try {
    const userId = user.id;

    // Fetch all plugin connections for this user
    const pluginManager = await PluginManagerV2.getInstance();
    const userConnectedPlugins = await pluginManager.getConnectedPlugins(userId);
    connectedPluginKeys = Object.keys(userConnectedPlugins);
    
    // Get full plugin metadata for LLM context    
    connectedPluginMetaData = pluginManager.getPluginsDefinitionContext(connectedPluginKeys);
  } catch (e) {
    console.error('Error logging user info:', e)
    return new Response(JSON.stringify({ error: e }), { status: 500 })
  }
  
  console.log(`User ${user.id} has connected plugins:`, connectedPluginKeys)

  // ENHANCED: Get full plugin metadata using the registry
  const connectedPluginData = connectedPluginMetaData;

  // Build status object using pluginList (maintain backward compatibility)
  const pluginStatus = pluginList.reduce((acc, plugin) => {
    acc[plugin.pluginKey] = {
      connected: connectedPluginKeys.includes(plugin.pluginKey),
      pluginName: plugin.name,
      description: plugin.description,
      icon: plugin.icon,
    }
    return acc
  }, {} as Record<string, any>)

  // NEW: Build enhanced user plugins object with metadata
  const userConnectedPlugins = connectedPluginData.reduce((acc, plugin) => {
    acc[plugin.key] = {
      key: plugin.key,
      name: plugin.getName(),
      displayName: plugin.displayName,
      label: plugin.label,
      isConnected: true,
      capabilities: plugin.capabilities,
      category: plugin.category,
      icon: plugin.icon
    }
    return acc
  }, {} as Record<string, any>)

  console.log(`Built user plugins object with ${Object.keys(userConnectedPlugins).length} connected plugins`)

  // ENHANCED RESPONSE: Include both legacy format and new enhanced data
  return new Response(
    JSON.stringify({
      // Legacy format for backward compatibility
      ...pluginStatus,
      
      // New enhanced data for frontend user context
      _meta: {
        connectedPlugins: userConnectedPlugins,
        connectedPluginData: connectedPluginData,
        connectedPluginKeys: connectedPluginKeys,
        totalConnected: connectedPluginData.length
      }
    }),
    { 
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
}