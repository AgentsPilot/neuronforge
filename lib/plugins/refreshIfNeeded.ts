import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { pluginRegistry } from './pluginRegistry'

export async function refreshIfNeeded(userId: string, pluginKey: string) {
  console.log('🔁 refreshIfNeeded: userId =', userId, 'pluginKey =', pluginKey)

  // 1. Fetch connection from Supabase
  const { data: connection, error } = await supabaseAdmin
    .from('plugin_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('plugin_key', pluginKey)
    .single()

  console.log('📦 Supabase returned connection:', connection)

  if (error || !connection) {
    throw new Error(`No ${pluginKey} connection found for user.`)
  }

  const { access_token, refresh_token, expires_at } = connection

  // 2. Check if expired
  const now = new Date()
  const expires = expires_at ? new Date(expires_at) : null
  const isExpired = expires && expires < now

  if (!isExpired) return connection // ✅ Still valid

  // 3. Check if plugin supports refresh
  const strategy = pluginRegistry[pluginKey]
  if (!strategy?.refreshToken) {
    throw new Error(`${pluginKey} plugin does not support token refresh.`)
  }

  // 4. Attempt refresh
  const refreshed = await strategy.refreshToken(connection)

  // 5. Save new values
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

  return {
    ...connection,
    ...update,
  }
}