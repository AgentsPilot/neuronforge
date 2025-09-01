import { UniversalPlugin } from './core/UniversalPlugin'
import googleDriveConfig from './configs/google-drive.json'

// Factory function to create universal plugins
export function createUniversalPlugin(config: UniversalPluginConfig): UniversalPlugin {
  return new UniversalPlugin(config)
}

// Universal plugin instances
export const universalPlugins = {
  'google-drive-v2': createUniversalPlugin(googleDriveConfig as UniversalPluginConfig),
}