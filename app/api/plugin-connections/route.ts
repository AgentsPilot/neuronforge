import { NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabaseServer'
import { encryptCredentials, decryptCredentials } from '@/lib/encryptCredentials'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

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

    return new Response(JSON.stringify({ success: true }), { status: 200 })
  } catch (err: any) {
    console.error('❌ POST crash:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

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

    return new Response(JSON.stringify({ success: true }), { status: 200 })
  } catch (err: any) {
    console.error('❌ DELETE crash:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()

  try {
    const { searchParams } = new URL(req.url)
    const plugin_key = searchParams.get('plugin_key')
    const user_id = searchParams.get('user_id')

    if (!plugin_key || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing plugin_key or user_id' }), { status: 400 })
    }

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
  } catch (err: any) {
    console.error('❌ GET crash:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}