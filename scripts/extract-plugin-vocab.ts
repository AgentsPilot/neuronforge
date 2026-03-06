#!/usr/bin/env npx tsx
// Extract the actual plugin vocabulary injection object

import { config } from 'dotenv';
import { buildPluginVocabularyInjection } from '../lib/agentkit/v6/intent/plugin-vocabulary';
import { loadPluginRegistryFromDatabase } from '../lib/agentkit/v6/intent/plugin-semantic-catalog';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  // Load registry for the 4 plugins used in the test
  const pluginKeys = ['google-mail', 'google-drive', 'google-sheets', 'chatgpt-research'];

  console.log('Loading plugin registry from database...\n');
  const registry = await loadPluginRegistryFromDatabase({ pluginKeys });

  console.log('Building plugin vocabulary injection...\n');
  const pluginVocabulary = buildPluginVocabularyInjection({
    registry,
    plugins_involved: pluginKeys
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PLUGIN VOCABULARY INJECTION OBJECT');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(pluginVocabulary, null, 2));
}

main().catch(console.error);
