// lib/plugins/pluginRegistry.ts
import { gmailStrategy } from './strategies/gmailPluginStrategy'

export interface PluginStrategy {
  pluginKey: string
  name: string
  connect(params: { supabase: any; popup: Window; userId: string }): Promise<void>
  handleOAuthCallback?(params: { code: string; state: string; supabase?: any }): Promise<any>
}

// Plugin registry - add your strategies here
export const pluginRegistry: Record<string, PluginStrategy> = {
  'google-mail': gmailStrategy,
  'gmail': gmailStrategy, // Alias for gmail
  
  // Add other plugins as you implement them
  // 'github': githubStrategy,
  // 'slack': slackStrategy,
  // 'google-calendar': googleCalendarStrategy,
}

// Helper function to check if a plugin is available
export const isPluginAvailable = (pluginKey: string): boolean => {
  return pluginKey in pluginRegistry && !!pluginRegistry[pluginKey].connect
}

// Get available plugin keys
export const getAvailablePlugins = (): string[] => {
  return Object.keys(pluginRegistry).filter(key => isPluginAvailable(key))
}