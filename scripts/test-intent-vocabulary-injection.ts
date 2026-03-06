#!/usr/bin/env npx tsx
// Production test: Intent Contract Generation with vocabulary from DATABASE
// PRODUCTION MODE - loads semantic ops from plugin_semantic_ops table (golden source)

import { config } from 'dotenv';
import { generateIntentContract } from '../lib/agentkit/v6/intent/generate-intent';
import type { EnhancedPrompt } from '../lib/agentkit/v6/intent/intent-user-prompt';
import fs from 'fs';
import path from 'path';

// Load environment variables
config({ path: path.join(__dirname, '../.env.local') });

// Load enhanced prompt from file
const enhancedPromptPath = path.join(__dirname, '../enhanced-prompt-invoice-extraction.json');
const enhancedPrompt: EnhancedPrompt = JSON.parse(fs.readFileSync(enhancedPromptPath, 'utf-8'));

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PRODUCTION TEST: Intent Contract Generation');
  console.log('MODE: Database-driven (plugin_semantic_ops table)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📋 Enhanced Prompt:', enhancedPrompt.plan_title);
  console.log('📋 Services Involved:', enhancedPrompt.specifics.services_involved.join(', '));
  console.log('');

  console.log('🔧 Loading plugin semantic operations from database...');
  console.log('   (Querying plugin_semantic_ops table - golden source)\n');

  // Call generateIntentContract WITHOUT specLoader
  // It will automatically load semantic ops from database table
  const result = await generateIntentContract({
    enhancedPrompt,
    // NO specLoader - uses database by default
  });

  console.log('\n✅ Intent Contract Generated!\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Version:', result.intent.version);
  console.log('Goal:', result.intent.goal);
  console.log('Summary:', result.intent.summary || '(none)');
  console.log('Unit of Work:', result.intent.unit_of_work);
  console.log('Plugins Involved:', result.intent.plugins_involved.join(', '));
  console.log('Total Steps:', result.intent.steps.length);
  console.log('Questions:', result.intent.questions?.length || 0);
  console.log('Constraints:', result.intent.constraints?.length || 0);
  console.log('');

  // Save output
  const outputDir = path.join(__dirname, '../output');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'intent-contract.json');
  fs.writeFileSync(outputPath, JSON.stringify(result.intent, null, 2));
  console.log('💾 Intent Contract saved to:', outputPath);

  const rawPath = path.join(outputDir, 'intent-contract-raw.txt');
  fs.writeFileSync(rawPath, result.rawText);
  console.log('💾 Raw LLM response saved to:', rawPath);

  // Display steps
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('WORKFLOW STEPS');
  console.log('═══════════════════════════════════════════════════════════════');
  for (let i = 0; i < result.intent.steps.length; i++) {
    const step = result.intent.steps[i];
    console.log(`\n${i + 1}. [${step.type.toUpperCase()}] ${step.id}`);
    console.log(`   Inputs:`, Object.keys(step.inputs).join(', ') || '(none)');
    console.log(`   Outputs:`, Object.keys(step.outputs).join(', ') || '(none)');

    if (step.type === 'fetch' && 'fetch' in step) {
      console.log(`   Semantic Op: ${step.fetch.semantic_op}`);
    } else if (step.type === 'deliver' && 'deliver' in step) {
      console.log(`   Semantic Op: ${step.deliver.semantic_op}`);
    }
  }

  console.log('\n✅ Test completed successfully!');
}

main().catch((error) => {
  console.error('\n❌ Test failed:');
  console.error(error);
  process.exit(1);
});
