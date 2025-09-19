// app/api/plugins/[plugin]/refresh/route.ts
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(
  req: Request,
  context: { params: Promise<{ plugin: string }> }
): Promise<Response> {
  try {
    // Check environment variables first
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl) {
      console.error('❌ Missing Supabase URL environment variable')
      return NextResponse.json({ 
        error: 'Server configuration error: Missing SUPABASE_URL',
        details: 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL environment variable is required'
      }, { status: 500 })
    }

    if (!supabaseServiceKey) {
      console.error('❌ Missing Supabase service key environment variable')
      return NextResponse.json({ 
        error: 'Server configuration error: Missing SUPABASE_SERVICE_ROLE_KEY',
        details: 'SUPABASE_SERVICE_ROLE_KEY environment variable is required'
      }, { status: 500 })
    }

    // Create supabase client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

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

    // Dynamically import pluginRegistry to avoid build-time issues
    let pluginRegistry
    try {
      const registryModule = await import('@/lib/plugins/pluginRegistry')
      pluginRegistry = registryModule.pluginRegistry
    } catch (importError) {
      console.error('❌ Failed to import plugin registry:', importError)
      return NextResponse.json({ 
        error: 'Plugin registry unavailable',
        details: 'Failed to load plugin registry'
      }, { status: 500 })
    }

    const strategy = pluginRegistry[plugin]
    if (!strategy) {
      return NextResponse.json({ error: `No strategy found for plugin: ${plugin}` }, { status: 404 })
    }

    // Get existing connection
    const { data: connection, error } = await supabaseAdmin
      .from('plugin_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('plugin_key', plugin)
      .single()

    if (error || !connection) {
      console.warn('❌ No connection found in Supabase:', { plugin, userId, error })
      return NextResponse.json({ error: `No connection found for ${plugin}` }, { status: 404 })
    }

    // Check if token is expired
    const now = new Date()
    const expires = connection.expires_at ? new Date(connection.expires_at) : null
    const isExpired = expires && expires < now

    if (!isExpired) {
      console.log('✅ Token still valid, returning existing connection')
      return NextResponse.json({ pluginData: connection })
    }

    // Token is expired, attempt refresh
    if (!strategy.refreshToken) {
      return NextResponse.json({ error: 'This plugin does not support token refresh' }, { status: 400 })
    }

    console.log('🔄 Attempting token refresh for plugin:', plugin)
    const refreshed = await strategy.refreshToken(connection)

    // Update connection with new tokens
    const update = {
      access_token: refreshed.access_token,
      ...(refreshed.refresh_token && { refresh_token: refreshed.refresh_token }),
      ...(refreshed.expires_at && { expires_at: refreshed.expires_at }),
      updated_at: new Date().toISOString()
    }

    const { error: updateError } = await supabaseAdmin
      .from('plugin_connections')
      .update(update)
      .eq('user_id', userId)
      .eq('plugin_key', plugin)

    if (updateError) {
      console.error('❌ Failed to update connection:', updateError)
      return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 })
    }

    // Fetch updated connection
    const { data: refreshedConnection, error: fetchError } = await supabaseAdmin
      .from('plugin_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('plugin_key', plugin)
      .single()

    if (fetchError || !refreshedConnection) {
      console.error('❌ Failed to retrieve updated connection:', fetchError)
      return NextResponse.json({ error: 'Failed to retrieve updated connection' }, { status: 500 })
    }

    console.log('✅ Token refresh successful for plugin:', plugin)
    return NextResponse.json({ pluginData: refreshedConnection })
    
  } catch (error) {
    console.error('❌ Unexpected error in refresh route:', error)
    
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}