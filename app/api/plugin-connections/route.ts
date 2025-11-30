// app/api/plugin-connections/route.ts
import { NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabaseServer'
import { encryptCredentials, decryptCredentials } from '@/lib/encryptCredentials'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const body = await req.json()
    const { plugin_key, username, password, user_id, access_token } = body

    if (!plugin_key || !username || !password || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 })
    }

    if (plugin_key === 'google-mail' && !username.includes('@gmail.com')) {
      return new Response(
        JSON.stringify({ error: 'Gmail username must be a @gmail.com address' }),
        { status: 400 }
      )
    }

    const encrypted = encryptCredentials({ username, password })

    const { error } = await supabase.from('plugin_connections').insert({
      plugin_key,
      user_id,
      credentials: encrypted,
      access_token: access_token || null,
    })

    if (error) {
      console.error('❌ Supabase insert error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    // AUDIT TRAIL: Log plugin connection
    try {
      const { auditLog } = await import('@/lib/services/AuditTrailService');
      const { AUDIT_EVENTS } = await import('@/lib/audit/events');

      await auditLog({
        action: AUDIT_EVENTS.PLUGIN_CONNECTED,
        entityType: 'connection',
        entityId: plugin_key,
        userId: user_id,
        resourceName: plugin_key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        details: {
          plugin_key,
          has_access_token: !!access_token,
          connection_type: access_token ? 'oauth' : 'credentials'
        },
        severity: 'info',
        complianceFlags: ['SOC2', 'GDPR'], // Third-party data access
        request: req
      });

      console.log('✅ Audit trail logged for plugin connection');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 })
  } catch (err: any) {
    console.error('❌ POST crash:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const { searchParams } = new URL(req.url)
    const plugin_key = searchParams.get('plugin_key')
    const user_id = searchParams.get('user_id')

    if (!plugin_key || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing plugin_key or user_id' }), { status: 400 })
    }

    const { error } = await supabase
      .from('plugin_connections')
      .delete()
      .eq('plugin_key', plugin_key)
      .eq('user_id', user_id)

    if (error) {
      console.error('❌ Supabase delete error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    // AUDIT TRAIL: Log plugin disconnection
    try {
      const { auditLog } = await import('@/lib/services/AuditTrailService');
      const { AUDIT_EVENTS } = await import('@/lib/audit/events');

      await auditLog({
        action: AUDIT_EVENTS.PLUGIN_DISCONNECTED,
        entityType: 'connection',
        entityId: plugin_key,
        userId: user_id,
        resourceName: plugin_key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        details: {
          plugin_key,
          disconnected_at: new Date().toISOString()
        },
        severity: 'warning',
        complianceFlags: ['SOC2', 'GDPR'],
        request: req
      });

      console.log('✅ Audit trail logged for plugin disconnection');
    } catch (auditError) {
      console.error('⚠️ Audit logging failed (non-critical):', auditError);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 })
  } catch (err: any) {
    console.error('❌ DELETE crash:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const { searchParams } = new URL(req.url)
    const plugin_key = searchParams.get('plugin_key')
    const user_id = searchParams.get('user_id')

    // If both plugin_key and user_id are provided, return specific plugin credentials (existing behavior)
    if (plugin_key && user_id) {
      const { data, error } = await supabase
        .from('plugin_connections')
        .select('credentials')
        .eq('plugin_key', plugin_key)
        .eq('user_id', user_id)
        .single()

      if (error || !data) {
        console.error('❌ Supabase fetch error:', error)
        return new Response(JSON.stringify({ error: error?.message || 'Not found' }), { status: 404 })
      }

      const decrypted = decryptCredentials(data.credentials)
      return new Response(JSON.stringify({ credentials: decrypted }), { status: 200 })
    }

    // For getting all connected plugins, try multiple authentication approaches
    console.log('🔍 Attempting to get current user...')
    console.log('📋 Request headers:', Object.fromEntries(req.headers.entries()))
    
    let currentUserId = null
    
    // Method 1: Check for x-user-id header (from ConversationalAgentBuilder)
    const headerUserId = req.headers.get('x-user-id')
    if (headerUserId) {
      console.log('✅ Found user ID in header:', headerUserId)
      currentUserId = headerUserId
    } else {
      console.log('❌ No x-user-id header found')
      
      // Method 2: Try to get user from session
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        console.log('👤 Session auth attempt:', { user: user?.id, error: authError })
        
        if (user && !authError) {
          currentUserId = user.id
          console.log('✅ Got user from session:', currentUserId)
        } else {
          console.log('❌ Session auth failed:', authError)
        }
      } catch (e) {
        console.log('❌ Session auth exception:', e)
      }
    }
    
    if (!currentUserId) {
      console.log('❌ No user found after all auth attempts')
      return new Response(JSON.stringify({ 
        error: 'Unauthorized - could not authenticate user',
        debug: {
          hasHeaderUserId: !!headerUserId,
          hasCookies: req.headers.has('cookie'),
          hasAuth: req.headers.has('authorization')
        }
      }), { status: 401 })
    }

    console.log('✅ Using user ID:', currentUserId)

    const { data: pluginRows, error } = await supabase
      .from('plugin_connections')
      .select('plugin_key, created_at, access_token')
      .eq('user_id', currentUserId)

    if (error) {
      console.error('❌ Database error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    console.log('📊 Raw plugin rows:', pluginRows)

    // Format the plugins with display names
    const plugins = pluginRows?.map(row => ({
      plugin_key: row.plugin_key,
      plugin_name: formatPluginDisplayName(row.plugin_key),
      status: 'active',
      connected_at: row.created_at,
      has_access_token: !!row.access_token
    })) || []

    console.log('✅ Formatted plugins:', plugins)

    return new Response(JSON.stringify({ 
      plugins,
      count: plugins.length,
      debug: { userId: currentUserId, authMethod: headerUserId ? 'header' : 'session' }
    }), { status: 200 })

  } catch (err: any) {
    console.error('❌ GET crash:', err)
    return new Response(JSON.stringify({ 
      error: err.message,
      stack: err.stack 
    }), { status: 500 })
  }
}

function formatPluginDisplayName(pluginKey: string): string {
  // Map of plugin keys to display names
  const displayNames: Record<string, string> = {
    'google-mail': 'Google Mail',
    'google-drive': 'Google Drive',
    'google-calendar': 'Google Calendar',
    'notion': 'Notion',
    'slack': 'Slack',
    'discord': 'Discord',
    'trello': 'Trello',
    'asana': 'Asana',
    'salesforce': 'Salesforce',
    'hubspot': 'HubSpot',
    'teams': 'Microsoft Teams',
    'dropbox': 'Dropbox',
    'github': 'GitHub',
    'linear': 'Linear',
    'figma': 'Figma',
    'openai': 'OpenAI',
    'anthropic': 'Anthropic Claude',
    'chatgpt': 'ChatGPT'
  }

  return displayNames[pluginKey] || pluginKey
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}