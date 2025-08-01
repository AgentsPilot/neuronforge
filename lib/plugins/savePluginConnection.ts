// lib/plugins/savePluginConnection.ts
import { createClient } from '@supabase/supabase-js'

export async function savePluginConnection(connectionData: any) {
  console.log('💾 Saving plugin connection:', {
    pluginKey: connectionData.plugin_key,
    userId: connectionData.user_id,
    username: connectionData.username
  })

  try {
    // Create a fresh Supabase client for server-side operations
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role key for server operations
    )

    const { data, error } = await supabase
      .from('plugin_connections')
      .upsert({
        ...connectionData,
        connected_at: connectionData.connected_at || new Date().toISOString(),
        last_used: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,plugin_key'
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Database error saving connection:', error)
      throw new Error(`Failed to save connection: ${error.message}`)
    }

    console.log('✅ Plugin connection saved successfully:', data?.id)
    return data

  } catch (error) {
    console.error('❌ Error in savePluginConnection:', error)
    throw error
  }
}