/**
 * @deprecated This entire file is deprecated and should not be used.
 * Please use the v2 plugin system instead.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import { savePluginConnection } from '@/lib/plugins/savePluginConnection'

/** @deprecated Use v2 plugin system instead */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  const cookieStore = cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (key) => cookieStore.get(key)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  try {
    // 🔍 Lookup plugin strategy from callback path
    const parsedState = JSON.parse(decodeURIComponent(state))
    const pluginKey = parsedState.plugin_key

    const strategy = pluginRegistry[pluginKey]
    if (!strategy) {
      return NextResponse.json({ error: `Unknown plugin "${pluginKey}"` }, { status: 404 })
    }

    // 🛠 Exchange code → token using plugin strategy
    const connection = await strategy.handleOAuthCallback({ code, state })

    // 💾 Save to Supabase
    await savePluginConnection(connection)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('OAuth token error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}