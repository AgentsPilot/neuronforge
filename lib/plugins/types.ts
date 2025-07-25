import type { SupabaseClient } from '@supabase/supabase-js'

export interface PluginStrategyArgs {
  supabase: SupabaseClient
  popup?: Window
  onUpdate?: (data: any) => void
}

export interface PluginStrategy {
  connect: (args: PluginStrategyArgs) => Promise<void>
  disconnect: (args: PluginStrategyArgs) => Promise<void>
  handleOAuthCallback?: (args: { code: string; state: string }) => Promise<any>

  // ✅ Generic run method to inject plugin-specific data during agent execution
  run?: (args: {
    supabase: SupabaseClient
    connection: any
    input: Record<string, any>
  }) => Promise<Record<string, any>>
}