import type { SupabaseClient } from '@supabase/supabase-js'

export interface PluginStrategyArgs {
  supabase: any
  popup?: Window
  onUpdate?: (data: any) => void
}

export interface PluginStrategy {
  connect: (args: PluginStrategyArgs) => Promise<void>
  disconnect: (args: PluginStrategyArgs) => Promise<void>

  // ✅ Add this line:
  handleOAuthCallback?: (args: { code: string, state: string }) => Promise<any>
}