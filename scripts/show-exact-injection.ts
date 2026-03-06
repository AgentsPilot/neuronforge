#!/usr/bin/env npx tsx
// Show EXACT text injected into Intent LLM system prompt

import { config } from 'dotenv';
import { buildCoreVocabularyInjection } from '../lib/agentkit/v6/intent/core-vocabulary';
import { buildPluginVocabularyInjection } from '../lib/agentkit/v6/intent/plugin-vocabulary';
import { loadPluginRegistryFromDatabase } from '../lib/agentkit/v6/intent/plugin-semantic-catalog';
import { buildIntentSystemPrompt } from '../lib/agentkit/v6/intent/intent-system-prompt';
import path from 'path';
import fs from 'fs';

config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  // Load registry for the 4 plugins used in the test
  const pluginKeys = ['google-mail', 'google-drive', 'google-sheets', 'chatgpt-research'];

  console.log('Loading vocabularies...\n');

  // 1. Build core vocabulary (always the same)
  const coreVocabulary = buildCoreVocabularyInjection();

  // 2. Load plugin registry from database
  const registry = await loadPluginRegistryFromDatabase({ pluginKeys });

  // 3. Build plugin vocabulary injection
  const pluginVocabulary = buildPluginVocabularyInjection({
    registry,
    plugins_involved: pluginKeys
  });

  // 4. Build the complete system prompt
  const systemPrompt = buildIntentSystemPrompt({ coreVocabulary, pluginVocabulary });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('EXACT SYSTEM PROMPT SENT TO INTENT LLM');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(systemPrompt);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PROMPT STATISTICS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Total characters:', systemPrompt.length);
  console.log('Total lines:', systemPrompt.split('\n').length);
  console.log('Estimated tokens:', Math.ceil(systemPrompt.length / 4));

  // Save to file for inspection
  const outputPath = path.join(__dirname, '../output/intent-system-prompt-exact.txt');
  fs.writeFileSync(outputPath, systemPrompt);
  console.log('\n💾 Saved to:', outputPath);
}

main().catch(console.error);
