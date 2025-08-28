// app/api/plugins/[plugin]/refresh/route.ts
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(
  req: Request,
  context: { params: Promise<{ plugin: string }> }
): Promise<Response> {
  const { plugin } = await context.params
  const body = await req.json()

  const userId =
    typeof body.userId === 'string'
      ? body.userId
      : typeof body.userId === 'object'
      ? body.userId?.userId
      : undefined

  console.log('🔍 Plugin param received:', plugin)
  console.log('👤 Normalized user ID:', userId)

  if (!userId || !plugin) {
    return NextResponse.json({ error: 'Missing userId or pluginKey' }, { status: 400 })
  }

  const strategy = pluginRegistry[plugin]
  if (!strategy) {
    return NextResponse.json({ error: `No strategy found for plugin: ${plugin}` }, { status: 404 })
  }

  const { data: connection, error } = await supabaseAdmin
    .from('plugin_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('plugin_key', plugin)
    .single()

  if (error || !connection) {
    console.warn('❌ No connection found in Supabase:', { plugin, userId })
    return NextResponse.json({ error: `No connection found for ${plugin}` }, { status: 404 })
  }

  const now = new Date()
  const expires = connection.expires_at ? new Date(connection.expires_at) : null
  const isExpired = expires && expires < now

  if (!isExpired) {
    return NextResponse.json({ pluginData: connection })
  }

  if (!strategy.refreshToken) {
    return NextResponse.json({ error: 'This plugin does not support refresh' }, { status: 400 })
  }

  const refreshed = await strategy.refreshToken(connection)

  const update = {
    access_token: refreshed.access_token,
    ...(refreshed.refresh_token && { refresh_token: refreshed.refresh_token }),
    ...(refreshed.expires_at && { expires_at: refreshed.expires_at }),
  }

  await supabaseAdmin
    .from('plugin_connections')
    .update(update)
    .eq('user_id', userId)
    .eq('plugin_key', plugin)

  const { data: refreshedConnection, error: fetchError } = await supabaseAdmin
    .from('plugin_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('plugin_key', plugin)
    .single()

  if (fetchError || !refreshedConnection) {
    return NextResponse.json({ error: 'Failed to retrieve updated connection' }, { status: 500 })
  }

  return NextResponse.json({ pluginData: refreshedConnection })
}