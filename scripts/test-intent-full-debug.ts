#!/usr/bin/env npx tsx
// Full production test with injection debug output

import { config } from 'dotenv';
import { generateIntentContract } from '../lib/agentkit/v6/intent/generate-intent';
import { buildCoreVocabularyInjection } from '../lib/agentkit/v6/intent/core-vocabulary';
import { buildPluginVocabularyInjection } from '../lib/agentkit/v6/intent/plugin-vocabulary';
import { loadPluginRegistryFromDatabase } from '../lib/agentkit/v6/intent/plugin-semantic-catalog';
import { buildIntentSystemPrompt } from '../lib/agentkit/v6/intent/intent-system-prompt';
import type { EnhancedPrompt } from '../lib/agentkit/v6/intent/intent-user-prompt';
import fs from 'fs';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FULL PRODUCTION TEST: Intent Contract Generation');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load enhanced prompt
  const enhancedPromptPath = path.join(__dirname, '../enhanced-prompt-invoice-extraction.json');
  const enhancedPrompt: EnhancedPrompt = JSON.parse(fs.readFileSync(enhancedPromptPath, 'utf-8'));

  console.log('📋 Task:', enhancedPrompt.plan_title);
  console.log('📋 Plugins:', enhancedPrompt.specifics.services_involved.join(', '));
  console.log('');

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Show what gets injected
  // ══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 1: BUILDING VOCABULARY INJECTION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Build core vocabulary
  const coreVocabulary = buildCoreVocabularyInjection();
  console.log('✅ Core Vocabulary:');
  console.log('   - Step types:', coreVocabulary.core_step_types.length);
  console.log('   - Operator categories:', Object.keys(coreVocabulary.core_operators).length);
  console.log('');

  // Load plugin registry from database
  const pluginKeys = enhancedPrompt.specifics.services_involved;
  const registry = await loadPluginRegistryFromDatabase({ pluginKeys });

  // Build plugin vocabulary
  const pluginVocabulary = buildPluginVocabularyInjection({
    registry,
    plugins_involved: pluginKeys
  });

  console.log('✅ Plugin Vocabulary:');
  console.log('   - Total semantic ops (global):', pluginVocabulary.semantic_ops.length);
  console.log('   - Plugins with details:', pluginVocabulary.plugins.length);
  console.log('');

  // Show plugin details
  for (const plugin of pluginVocabulary.plugins) {
    console.log(`   📦 ${plugin.plugin_key}:`);
    console.log(`      - Operations: ${plugin.supported_ops.length}`);
    console.log(`      - Aliases: ${plugin.aliases?.join(', ') || 'none'}`);

    // Show first 2 operations as example
    for (let i = 0; i < Math.min(2, plugin.supported_ops.length); i++) {
      const op = plugin.supported_ops[i];
      console.log(`      - ${op.op}:`);
      console.log(`        params: [${op.params?.join(', ') || 'none'}]`);
      console.log(`        outputs: [${op.outputs?.join(', ') || 'none'}]`);
    }
    if (plugin.supported_ops.length > 2) {
      console.log(`      ... and ${plugin.supported_ops.length - 2} more operations`);
    }
    console.log('');
  }

  // Build system prompt
  const systemPrompt = buildIntentSystemPrompt({ coreVocabulary, pluginVocabulary });

  console.log('✅ System Prompt Statistics:');
  console.log('   - Total characters:', systemPrompt.length);
  console.log('   - Total lines:', systemPrompt.split('\n').length);
  console.log('   - Estimated tokens:', Math.ceil(systemPrompt.length / 4));
  console.log('');

  // ══════════════════════════════════════════════════════════════
  // STEP 2: Generate Intent Contract
  // ══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 2: GENERATING INTENT CONTRACT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('🤖 Calling Claude Sonnet 4.5...');
  const startTime = Date.now();

  const result = await generateIntentContract({
    enhancedPrompt,
  });

  const duration = Date.now() - startTime;
  console.log(`✅ Generated in ${(duration / 1000).toFixed(1)}s\n`);

  // ══════════════════════════════════════════════════════════════
  // STEP 3: Show results
  // ══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 3: INTENT CONTRACT RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📊 Contract Metadata:');
  console.log('   - Version:', result.intent.version);
  console.log('   - Goal:', result.intent.goal);
  console.log('   - Unit of work:', result.intent.unit_of_work);
  console.log('   - Plugins:', result.intent.plugins_involved.join(', '));
  console.log('   - Total steps:', result.intent.steps.length);
  console.log('   - Questions:', result.intent.questions?.length || 0);
  console.log('   - Constraints:', result.intent.constraints?.length || 0);
  console.log('   - Risks:', result.intent.risks?.length || 0);
  console.log('');

  // Analyze step types
  const stepTypes = result.intent.steps.reduce((acc, step) => {
    acc[step.type] = (acc[step.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('📊 Step Type Breakdown:');
  Object.entries(stepTypes).forEach(([type, count]) => {
    console.log(`   - ${type}: ${count}`);
  });
  console.log('');

  // Check for semantic operations used
  const semanticOpsUsed = new Set<string>();
  result.intent.steps.forEach(step => {
    if (step.type === 'fetch' && 'fetch' in step) {
      semanticOpsUsed.add(step.fetch.semantic_op);
    } else if (step.type === 'deliver' && 'deliver' in step) {
      semanticOpsUsed.add(step.deliver.semantic_op);
    }
  });

  console.log('📊 Semantic Operations Used:');
  Array.from(semanticOpsUsed).sort().forEach(op => {
    console.log(`   - ${op}`);
  });
  console.log('');

  // Save outputs
  const outputDir = path.join(__dirname, '../output');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'intent-contract.json');
  fs.writeFileSync(outputPath, JSON.stringify(result.intent, null, 2));

  const rawPath = path.join(outputDir, 'intent-contract-raw.txt');
  fs.writeFileSync(rawPath, result.rawText);

  console.log('💾 Files saved:');
  console.log('   - Intent Contract:', outputPath);
  console.log('   - Raw LLM Response:', rawPath);
  console.log('');

  // ══════════════════════════════════════════════════════════════
  // STEP 4: Show sample workflow steps
  // ══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 4: SAMPLE WORKFLOW STEPS (First 5)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (let i = 0; i < Math.min(5, result.intent.steps.length); i++) {
    const step = result.intent.steps[i];
    console.log(`${i + 1}. [${step.type.toUpperCase()}] ${step.id}`);
    console.log(`   Inputs: ${Object.keys(step.inputs).join(', ') || '(none)'}`);
    console.log(`   Outputs: ${Object.keys(step.outputs).join(', ') || '(none)'}`);

    if (step.type === 'fetch' && 'fetch' in step) {
      console.log(`   Semantic Op: ${step.fetch.semantic_op}`);
    } else if (step.type === 'deliver' && 'deliver' in step) {
      console.log(`   Semantic Op: ${step.deliver.semantic_op}`);
    } else if (step.type === 'loop' && 'loop' in step) {
      console.log(`   Loop: iterate over ${JSON.stringify(step.loop.iterate_over)}`);
      console.log(`   Item var: ${step.loop.item_var}`);
      console.log(`   Body steps: ${step.loop.body.length}`);
    } else if (step.type === 'transform' && 'transform' in step) {
      console.log(`   Transform kind: ${step.transform.kind}`);
    }

    if (step.note) {
      console.log(`   Note: ${step.note}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ FULL TEST COMPLETED SUCCESSFULLY!');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('\n❌ Test failed:');
  console.error(error);
  process.exit(1);
});
