// app/api/plugins/[plugin]/refresh/route.ts
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Lazy import pluginRegistry to avoid build-time issues
async function getPluginRegistry() {
  try {
    const { pluginRegistry } = await import('@/lib/plugins/pluginRegistry')
    return pluginRegistry
  } catch (error) {
    console.error('❌ Failed to load plugin registry:', error)
    return {}
  }
}

// Create supabase admin client with error handling - only when needed
function createSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL environment variable')
  }

  if (!supabaseServiceKey) {
    throw new Error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

export async function POST(
  req: Request,
  context: { params: Promise<{ plugin: string }> }
): Promise<Response> {
  try {
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

    // Lazy load plugin registry
    const pluginRegistry = await getPluginRegistry()
    const strategy = pluginRegistry[plugin]
    if (!strategy) {
      return NextResponse.json({ error: `No strategy found for plugin: ${plugin}` }, { status: 404 })
    }

    // Create supabase admin client only when needed
    const supabaseAdmin = createSupabaseAdmin()

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
    
  } catch (error) {
    console.error('❌ Error in refresh route:', error)
    
    // Handle specific environment variable errors
    if (error instanceof Error && error.message.includes('Missing')) {
      return NextResponse.json({ 
        error: 'Server configuration error: Missing required environment variables',
        details: error.message 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}