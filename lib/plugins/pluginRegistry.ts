import { gmailPluginStrategy } from './strategies/gmailPluginStrategy'
import type { PluginStrategy } from '@/lib/plugins/types'

export const pluginRegistry: Record<string, PluginStrategy> = {
  'google-mail': gmailPluginStrategy,
  // Add more plugins as needed
}