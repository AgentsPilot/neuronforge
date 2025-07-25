import { NextResponse } from 'next/server'
import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: Request, { params }: { params: { plugin: string } }) {
  const pluginKey = params.plugin
  const { userId } = await req.json()

  if (!userId || !pluginKey) {
    return NextResponse.json({ error: 'Missing userId or pluginKey' }, { status: 400 })
  }

  const strategy = pluginRegistry[pluginKey]
  if (!strategy) {
    return NextResponse.json({ error: `No strategy found for plugin: ${pluginKey}` }, { status: 404 })
  }

  const { data: connection, error } = await supabaseAdmin
    .from('plugin_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('plugin_key', pluginKey)
    .single()

  if (error || !connection) {
    return NextResponse.json({ error: `No connection found for ${pluginKey}` }, { status: 404 })
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
    .eq('plugin_key', pluginKey)

  return NextResponse.json({ pluginData: { ...connection, ...update } })
}