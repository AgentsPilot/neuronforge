/**
 * @deprecated This entire file is deprecated and should not be used.
 * Please use the v2 plugin system instead.
 */

// app/api/plugin-connections/disconnect/route.ts

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'

/** @deprecated Use v2 plugin system instead */
export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: async (key) => (await cookieStore).get(key)?.value ?? '',
        set: () => {},
        remove: () => {},
      },
    }
  )

  const { plugin_key } = await req.json()

  if (!plugin_key) {
    return NextResponse.json({ error: 'Missing plugin key' }, { status: 400 })
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const strategy = pluginRegistry[plugin_key]

  if (!strategy?.disconnect) {
    return NextResponse.json({ error: 'Disconnect method not implemented' }, { status: 501 })
  }

  try {
    await strategy.disconnect({ supabase, onUpdate: () => {} })

    // Soft delete instead of removing the row
    const { error: updateError } = await supabase
      .from('plugin_connections')
      .update({ disconnected_at: new Date().toISOString() })
      .eq('plugin_key', plugin_key)
      .eq('user_id', user.id)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to mark plugin as disconnected' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Disconnect failed:', err)
    return NextResponse.json({ error: 'Disconnect failed' }, { status: 500 })
  }
}