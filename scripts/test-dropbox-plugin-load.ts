// Test script to verify Dropbox plugin loads correctly
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2';

async function testDropboxPlugin() {
  console.log('Testing Dropbox plugin loading...\n');

  try {
    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Get all available plugins
    const availablePlugins = pluginManager.getAvailablePlugins();

    console.log(`Total plugins loaded: ${Object.keys(availablePlugins).length}`);
    console.log('Plugin keys:', Object.keys(availablePlugins).sort().join(', '));

    // Check if dropbox is loaded
    if (availablePlugins['dropbox']) {
      console.log('\n✅ Dropbox plugin found!');
      console.log('Name:', availablePlugins['dropbox'].plugin.name);
      console.log('Description:', availablePlugins['dropbox'].plugin.description);
      console.log('Actions:', Object.keys(availablePlugins['dropbox'].actions).length);
      console.log('Auth type:', availablePlugins['dropbox'].plugin.auth_config.auth_type);
    } else {
      console.log('\n❌ Dropbox plugin NOT found!');
      console.log('Available plugins:', Object.keys(availablePlugins).sort());
    }

  } catch (error) {
    console.error('Error testing plugin:', error);
  }
}

testDropboxPlugin();
