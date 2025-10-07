// app/api/user/plugins/route.ts

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { pluginList } from '@/lib/plugins/pluginList'
import { getConnectedPluginsWithMetadata } from '@/lib/plugins/pluginRegistry'

export async function GET() {
  console.log('API: /api/user/plugins called')
  
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  )

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return new Response(JSON.stringify({}), { status: 401 })
  }

  // Fetch all plugin connections for this user
  const { data: pluginRows, error } = await supabase
    .from('plugin_connections')
    .select('plugin_key')
    .eq('user_id', user.id)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // Flatten connected plugin keys
  const connectedPluginKeys = pluginRows?.map((row) => row.plugin_key) || []
  
  console.log(`User ${user.id} has connected plugins:`, connectedPluginKeys)

  // ENHANCED: Get full plugin metadata using the registry
  const connectedPluginData = getConnectedPluginsWithMetadata(connectedPluginKeys)
  
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
      name: plugin.label,
      displayName: plugin.displayName || plugin.label,
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