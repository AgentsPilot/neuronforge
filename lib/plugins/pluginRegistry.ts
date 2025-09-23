import { gmailStrategy } from './strategies/gmailPluginStrategy'
import { gmailDataStrategy } from './strategies/gmailDataStrategy' 
import { chatgptResearchStrategy } from './strategies/chatgptResearchStrategy'
import { googleDriveDataStrategy } from './strategies/googleDriveDataStrategy'
import { googleDriveStrategy } from './strategies/googleDrivePluginStrategy'
import { slackStrategy } from './strategies/slackPluginStrategy'
import { slackDataStrategy } from './strategies/slackDataStrategy'
import { universalPlugins } from './v2/registry'

export interface PluginStrategy {
  pluginKey: string
  name: string
  connect(params: { supabase: any; popup: Window; userId: string }): Promise<void>
  handleOAuthCallback?(params: { code: string; state: string; supabase?: any }): Promise<any>
  run?(params: { connection: any; userId: string; input_variables: Record<string, any> }): Promise<any>
  refreshToken?(connection: any): Promise<any>
}

// Combined registry supporting both v1 (custom strategies) and v2 (universal)
export const pluginRegistry: Record<string, PluginStrategy> = {
  // V1 - Existing custom strategies
  'google-mail': gmailDataStrategy,
  'gmail': gmailDataStrategy,
  'chatgpt-research': chatgptResearchStrategy,
  'google-drive': googleDriveDataStrategy,
  'slack': slackDataStrategy,
  
  // V1 - OAuth strategies
  'google-mail-connect': gmailStrategy,
  'google-drive-connect': googleDriveStrategy,
  'slack-connect': slackStrategy,
  
  // V2 - Universal plugins
  ...universalPlugins,
}

export const isPluginAvailable = (pluginKey: string): boolean => {
  return pluginKey in pluginRegistry && !!pluginRegistry[pluginKey].connect
}

export const getAvailablePlugins = (): string[] => {
  return Object.keys(pluginRegistry).filter(key => isPluginAvailable(key))
}

// Feature flag to gradually migrate plugins
export const PLUGIN_VERSION_MAP: Record<string, 'v1' | 'v2'> = {
  'google-mail': 'v1',
  'google-drive': 'v1', // Can change to 'v2' when ready to test
  'google-drive-v2': 'v2',
  'slack': 'v1'
}

console.log('Plugin Registry Loaded:', {
  v1Plugins: Object.keys(pluginRegistry).filter(k => !k.includes('-v2')),
  v2Plugins: Object.keys(pluginRegistry).filter(k => k.includes('-v2')),
  totalPlugins: Object.keys(pluginRegistry).length
})