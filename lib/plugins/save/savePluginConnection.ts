import { SupabaseClient } from '@supabase/supabase-js'

type SavePluginConnectionParams = {
  user_id: string
  plugin_key: string
  username?: string | null
  access_token: string
  refresh_token?: string | null
  expires_at?: string | null
  credentials?: any
}

/**
 * Upserts a plugin connection and optionally reactivates agents if previously marked inactive.
 */
export async function savePluginConnection(
  supabase: SupabaseClient,
  {
    user_id,
    plugin_key,
    username,
    access_token,
    refresh_token = null,
    expires_at = null,
    credentials = null,
  }: SavePluginConnectionParams
) {
  // Save or update plugin connection
  const { error: upsertError } = await supabase
    .from('plugin_connections')
    .upsert({
      user_id,
      plugin_key,
      access_token,
      refresh_token,
      expires_at,
      username,
      credentials,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,plugin_key' })

  if (upsertError) throw new Error(`Failed to save plugin connection: ${upsertError.message}`)

  // 🔄 Reactivate any agents that use this plugin
  const { error: updateError } = await supabase
    .from('agents')
    .update({ status: 'active', deactivation_reason: null })
    .contains('connected_plugins', { [plugin_key]: true })
    .eq('user_id', user_id)

  if (updateError) {
    console.warn('⚠️ Failed to reactivate dependent agents:', updateError.message)
  }
}