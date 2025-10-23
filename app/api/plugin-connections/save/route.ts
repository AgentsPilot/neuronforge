// /app/api/plugin-connections/save/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const body = await req.json()

  const {
    user_id,
    plugin_key,
    username,
    access_token,
    refresh_token,
    expires_at,
    credentials,
  } = body

  const { data, error } = await supabase
    .from('plugin_connections')
    .upsert(
      [
        {
          user_id,
          plugin_key,
          access_token,
          refresh_token,
          expires_at,
          credentials,
          username,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: 'user_id,plugin_key' }
    )

  if (error) {
    console.error('🔴 Supabase upsert failed:', error)
    return new NextResponse(`Supabase error: ${error.message}`, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}