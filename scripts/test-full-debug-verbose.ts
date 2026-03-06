#!/usr/bin/env npx tsx
// Complete verbose debug output for Intent Contract generation

import { config } from 'dotenv';
import { generateIntentContract } from '../lib/agentkit/v6/intent/generate-intent';
import { buildCoreVocabularyInjection } from '../lib/agentkit/v6/intent/core-vocabulary';
import { buildPluginVocabularyInjection } from '../lib/agentkit/v6/intent/plugin-vocabulary';
import { loadPluginRegistryFromDatabase } from '../lib/agentkit/v6/intent/plugin-semantic-catalog';
import { buildIntentSystemPrompt } from '../lib/agentkit/v6/intent/intent-system-prompt';
import { buildIntentUserPrompt } from '../lib/agentkit/v6/intent/intent-user-prompt';
import type { EnhancedPrompt } from '../lib/agentkit/v6/intent/intent-user-prompt';
import fs from 'fs';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FULL VERBOSE DEBUG OUTPUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load enhanced prompt
  const enhancedPromptPath = path.join(__dirname, '../enhanced-prompt-invoice-extraction.json');
  const enhancedPrompt: EnhancedPrompt = JSON.parse(fs.readFileSync(enhancedPromptPath, 'utf-8'));

  console.log('1️⃣  ENHANCED PROMPT');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Plan Title:', enhancedPrompt.plan_title);
  console.log('Services Involved:', enhancedPrompt.specifics.services_involved);
  console.log('Plan Description:', enhancedPrompt.plan_description.substring(0, 200) + '...');
  console.log('');

  // Build vocabularies
  console.log('2️⃣  CORE VOCABULARY');
  console.log('─────────────────────────────────────────────────────────────');
  const coreVocabulary = buildCoreVocabularyInjection();
  console.log('Step Types:', coreVocabulary.core_step_types);
  console.log('Operator Categories:', Object.keys(coreVocabulary.core_operators));
  console.log('Total Operators:', Object.values(coreVocabulary.core_operators).flat().length);
  console.log('');

  console.log('3️⃣  PLUGIN REGISTRY (from database)');
  console.log('─────────────────────────────────────────────────────────────');
  const pluginKeys = enhancedPrompt.specifics.services_involved;
  const registry = await loadPluginRegistryFromDatabase({ pluginKeys });

  for (const [pluginKey, pluginData] of Object.entries(registry)) {
    console.log(`\n📦 ${pluginKey.toUpperCase()}`);
    console.log(`   Aliases: ${pluginData.aliases?.join(', ') || 'none'}`);
    console.log(`   Operations: ${pluginData.semantic_ops.length}`);

    // Show ALL operations
    pluginData.semantic_ops.forEach((semOp, idx) => {
      console.log(`   ${idx + 1}. ${semOp.op}`);
      if (semOp.param_hints && semOp.param_hints.length > 0) {
        console.log(`      params: [${semOp.param_hints.join(', ')}]`);
      }
      if (semOp.output_hints && semOp.output_hints.length > 0) {
        console.log(`      outputs: [${semOp.output_hints.join(', ')}]`);
      }
    });
  }
  console.log('');

  console.log('4️⃣  PLUGIN VOCABULARY INJECTION');
  console.log('─────────────────────────────────────────────────────────────');
  const pluginVocabulary = buildPluginVocabularyInjection({
    registry,
    plugins_involved: pluginKeys
  });

  console.log('Total Semantic Ops (global):', pluginVocabulary.semantic_ops.length);
  console.log('Plugins with Details:', pluginVocabulary.plugins.length);
  console.log('Rules:', pluginVocabulary.rules.length);
  console.log('');

  console.log('Plugin Details in Injection:');
  pluginVocabulary.plugins.forEach(plugin => {
    console.log(`\n  ${plugin.plugin_key}:`);
    console.log(`    Operations: ${plugin.supported_ops.length}`);
    console.log(`    Sample ops:`);
    plugin.supported_ops.slice(0, 3).forEach(op => {
      console.log(`      - ${op.op}`);
      console.log(`        params: [${op.params?.join(', ') || 'none'}]`);
      console.log(`        outputs: [${op.outputs?.join(', ') || 'none'}]`);
    });
  });
  console.log('');

  console.log('5️⃣  SYSTEM PROMPT');
  console.log('─────────────────────────────────────────────────────────────');
  const systemPrompt = buildIntentSystemPrompt({ coreVocabulary, pluginVocabulary });
  console.log('Total Characters:', systemPrompt.length);
  console.log('Total Lines:', systemPrompt.split('\n').length);
  console.log('Estimated Tokens:', Math.ceil(systemPrompt.length / 4));
  console.log('');
  console.log('System Prompt Preview (first 50 lines):');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(systemPrompt.split('\n').slice(0, 50).join('\n'));
  console.log('... (truncated)');
  console.log('');

  console.log('6️⃣  USER PROMPT');
  console.log('─────────────────────────────────────────────────────────────');
  const userPrompt = buildIntentUserPrompt({ enhancedPrompt });
  console.log('Total Characters:', userPrompt.length);
  console.log('Total Lines:', userPrompt.split('\n').length);
  console.log('');
  console.log('User Prompt Preview (first 30 lines):');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(userPrompt.split('\n').slice(0, 30).join('\n'));
  console.log('... (truncated)');
  console.log('');

  console.log('7️⃣  CALLING LLM');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Model: Claude Sonnet 4.5');
  console.log('Max Tokens: 16000');
  console.log('Temperature: 0.0');
  console.log('Calling...');

  const startTime = Date.now();
  const result = await generateIntentContract({ enhancedPrompt });
  const duration = Date.now() - startTime;

  console.log(`✅ Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log('');

  console.log('8️⃣  RAW LLM RESPONSE');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Response Length:', result.rawText.length);
  console.log('First 500 characters:');
  console.log(result.rawText.substring(0, 500));
  console.log('...');
  console.log('Last 200 characters:');
  console.log(result.rawText.substring(result.rawText.length - 200));
  console.log('');

  console.log('9️⃣  PARSED INTENT CONTRACT');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Version:', result.intent.version);
  console.log('Goal:', result.intent.goal);
  console.log('Unit of Work:', result.intent.unit_of_work);
  console.log('Plugins Involved:', result.intent.plugins_involved);
  console.log('Total Steps:', result.intent.steps.length);
  console.log('Questions:', result.intent.questions?.length || 0);
  console.log('Constraints:', result.intent.constraints?.length || 0);
  console.log('Risks:', result.intent.risks?.length || 0);
  console.log('');

  console.log('🔟 STEP-BY-STEP WORKFLOW');
  console.log('─────────────────────────────────────────────────────────────');

  result.intent.steps.forEach((step, idx) => {
    console.log(`\n${idx + 1}. [${step.type.toUpperCase()}] ${step.id}`);
    console.log(`   Inputs: {${Object.keys(step.inputs).join(', ')}}`);
    console.log(`   Outputs: {${Object.keys(step.outputs).join(', ')}}`);

    if (step.type === 'fetch' && 'fetch' in step) {
      console.log(`   ✓ Fetch: ${step.fetch.semantic_op}`);
      console.log(`   ✓ Params: ${JSON.stringify(step.fetch.params, null, 0)}`);
    } else if (step.type === 'deliver' && 'deliver' in step) {
      console.log(`   ✓ Deliver: ${step.deliver.semantic_op}`);
      console.log(`   ✓ Params: ${JSON.stringify(step.deliver.params, null, 0).substring(0, 100)}...`);
    } else if (step.type === 'loop' && 'loop' in step) {
      console.log(`   ✓ Loop over: ${JSON.stringify(step.loop.iterate_over)}`);
      console.log(`   ✓ Item var: ${step.loop.item_var}`);
      console.log(`   ✓ Collect: ${step.loop.collect} as "${step.loop.collect_as}"`);
      console.log(`   ✓ Body steps: ${step.loop.body.length}`);

      // Show nested steps
      step.loop.body.forEach((nestedStep, nestedIdx) => {
        console.log(`      ${nestedIdx + 1}. [${nestedStep.type}] ${nestedStep.id}`);
        if (nestedStep.type === 'fetch' && 'fetch' in nestedStep) {
          console.log(`         semantic_op: ${nestedStep.fetch.semantic_op}`);
        }
      });
    } else if (step.type === 'transform' && 'transform' in step) {
      console.log(`   ✓ Transform: ${step.transform.kind}`);
      console.log(`   ✓ Source: ${JSON.stringify(step.transform.source)}`);
    } else if (step.type === 'aggregate' && 'aggregate' in step) {
      console.log(`   ✓ Aggregate source: ${JSON.stringify(step.aggregate.source)}`);
      console.log(`   ✓ Metrics: ${step.aggregate.metrics.map(m => m.metric).join(', ')}`);
    } else if (step.type === 'ai_extract' && 'ai_extract' in step) {
      console.log(`   ✓ AI Extract input: ${JSON.stringify(step.ai_extract.input)}`);
      console.log(`   ✓ Output schema: ${Object.keys(step.ai_extract.output_schema.properties || {}).join(', ')}`);
    } else if (step.type === 'ai_generate' && 'ai_generate' in step) {
      console.log(`   ✓ AI Generate input: ${JSON.stringify(step.ai_generate.input)}`);
    }

    if (step.note) {
      console.log(`   Note: ${step.note}`);
    }
  });

  console.log('');
  console.log('1️⃣1️⃣  VALIDATION & QUALITY CHECKS');
  console.log('─────────────────────────────────────────────────────────────');

  // Check for correct structure
  const loopSteps = result.intent.steps.filter(s => s.type === 'loop');
  console.log(`✓ Loop steps: ${loopSteps.length}`);
  loopSteps.forEach(step => {
    if ('loop' in step) {
      const hasBody = 'body' in step.loop;
      const hasSteps = 'steps' in step.loop;
      console.log(`  - ${step.id}: uses "${hasBody ? 'body' : 'steps'}" ${hasBody ? '✅' : '❌'}`);
    }
  });

  // Check semantic ops
  const semanticOpsUsed = new Set<string>();
  result.intent.steps.forEach(step => {
    if (step.type === 'fetch' && 'fetch' in step) {
      semanticOpsUsed.add(step.fetch.semantic_op);
    } else if (step.type === 'deliver' && 'deliver' in step) {
      semanticOpsUsed.add(step.deliver.semantic_op);
    }
  });

  console.log(`✓ Unique semantic ops used: ${semanticOpsUsed.size}`);
  Array.from(semanticOpsUsed).forEach(op => {
    const isValid = pluginVocabulary.semantic_ops.includes(op);
    console.log(`  - ${op} ${isValid ? '✅' : '❌ NOT IN VOCABULARY'}`);
  });

  // Check ref paths
  let totalRefs = 0;
  let validRefs = 0;
  result.intent.steps.forEach(step => {
    const checkRefs = (obj: any) => {
      if (typeof obj === 'object' && obj !== null) {
        if ('ref' in obj && typeof obj.ref === 'string') {
          totalRefs++;
          // Simple validation: should start with $.
          if (obj.ref.startsWith('$.')) {
            validRefs++;
          }
        }
        Object.values(obj).forEach(checkRefs);
      }
    };
    checkRefs(step);
  });

  console.log(`✓ Total refs: ${totalRefs}`);
  console.log(`✓ Valid ref format: ${validRefs}/${totalRefs} ${validRefs === totalRefs ? '✅' : '⚠️'}`);

  console.log('');
  console.log('1️⃣2️⃣  SAVE FILES');
  console.log('─────────────────────────────────────────────────────────────');

  const outputDir = path.join(__dirname, '../output');
  fs.mkdirSync(outputDir, { recursive: true });

  // Save outputs
  const contractPath = path.join(outputDir, 'intent-contract.json');
  fs.writeFileSync(contractPath, JSON.stringify(result.intent, null, 2));
  console.log('✓ Intent Contract:', contractPath);

  const rawPath = path.join(outputDir, 'intent-contract-raw.txt');
  fs.writeFileSync(rawPath, result.rawText);
  console.log('✓ Raw LLM Response:', rawPath);

  const systemPromptPath = path.join(outputDir, 'intent-system-prompt-full.txt');
  fs.writeFileSync(systemPromptPath, systemPrompt);
  console.log('✓ System Prompt:', systemPromptPath);

  const userPromptPath = path.join(outputDir, 'intent-user-prompt.txt');
  fs.writeFileSync(userPromptPath, userPrompt);
  console.log('✓ User Prompt:', userPromptPath);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ FULL DEBUG COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('\n❌ ERROR:');
  console.error(error);
  console.error('\nStack trace:');
  console.error(error.stack);
  process.exit(1);
});
