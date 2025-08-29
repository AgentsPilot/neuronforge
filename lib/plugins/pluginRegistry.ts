// lib/plugins/pluginRegistry.ts
import { gmailStrategy } from './strategies/gmailPluginStrategy'
import { gmailDataStrategy } from './strategies/gmailDataStrategy'
import { chatgptResearchStrategy } from './strategies/chatgptResearchStrategy'
import { googleDriveDataStrategy } from './strategies/googleDriveDataStrategy'
import { googleDriveStrategy } from './strategies/googleDrivePluginStrategy'

export interface PluginStrategy {
  pluginKey: string
  name: string
  connect(params: { supabase: any; popup: Window; userId: string }): Promise<void>
  handleOAuthCallback?(params: { code: string; state: string; supabase?: any }): Promise<any>
  run?(params: { connection: any; userId: string; input_variables: Record<string, any> }): Promise<any>
  refreshToken?(connection: any): Promise<any>
}

// Plugin registry
export const pluginRegistry: Record<string, PluginStrategy> = {
  'google-mail': gmailDataStrategy,
  'gmail': gmailDataStrategy,
  'chatgpt-research': chatgptResearchStrategy,
  'google-drive': googleDriveDataStrategy,
  
  // Keep OAuth connection available if needed separately
  'google-mail-connect': gmailStrategy,
  'google-drive-connect': googleDriveStrategy,
}

export const isPluginAvailable = (pluginKey: string): boolean => {
  return pluginKey in pluginRegistry && !!pluginRegistry[pluginKey].connect
}

export const getAvailablePlugins = (): string[] => {
  return Object.keys(pluginRegistry).filter(key => isPluginAvailable(key))
}

// Debug logging
console.log('=== DEBUGGING PLUGIN REGISTRY ===')
console.log('All plugins in registry:', Object.keys(pluginRegistry))
console.log('ChatGPT plugin exists:', 'chatgpt-research' in pluginRegistry)
console.log('Google Drive plugin exists:', 'google-drive' in pluginRegistry)
console.log('ChatGPT plugin details:', pluginRegistry['chatgpt-research'])
console.log('ChatGPT has connect method:', !!pluginRegistry['chatgpt-research']?.connect)
console.log('Google Drive has connect method:', !!pluginRegistry['google-drive']?.connect)
console.log('isPluginAvailable ChatGPT:', isPluginAvailable('chatgpt-research'))
console.log('isPluginAvailable Google Drive:', isPluginAvailable('google-drive'))
console.log('Available plugins:', getAvailablePlugins())

// Test the specific functions
const availablePlugins = getAvailablePlugins()
console.log('Filtered available plugins:', availablePlugins.map(key => ({
  key,
  name: pluginRegistry[key].name
})))