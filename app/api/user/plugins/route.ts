// app/api/user/plugins/route.ts

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { pluginList } from '@/lib/plugins/pluginList'

export async function GET() {
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

  // Build status object using pluginList
  const pluginStatus = pluginList.reduce((acc, plugin) => {
    acc[plugin.pluginKey] = {
      connected: connectedPluginKeys.includes(plugin.pluginKey),
      pluginName: plugin.name,
      description: plugin.description,
      icon: plugin.icon,
    }
    return acc
  }, {} as Record<string, any>)

  return new Response(JSON.stringify(pluginStatus), { status: 200 })
}