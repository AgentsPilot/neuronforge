// lib/plugins/savePluginConnection.ts

import { createServerSupabaseClient } from '@/lib/supabaseServer'

export async function savePluginConnection({
  user_id,
  plugin_key,
  username,
  access_token,
  refresh_token,
  expires_at,
  credentials,
}: {
  user_id: string
  plugin_key: string
  username: string
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  credentials: any
}) {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('plugin_connections')
    .upsert(
      [
        {
          user_id,
          plugin_key,
          username,
          access_token,
          refresh_token,
          expires_at,
          credentials,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: 'user_id,plugin_key' }
    )

  if (error) {
    console.error('🔴 savePluginConnection failed:', error)
    throw error
  }

  return data
}