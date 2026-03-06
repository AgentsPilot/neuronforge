#!/usr/bin/env npx tsx
// Test Generic Intent V1 Generation
// Uses the new system prompt that generates intent.v1 format

import { config } from 'dotenv';
import { generateGenericIntentContractV1 } from '../lib/agentkit/v6/intent/generate-intent';
import type { EnhancedPrompt } from '../lib/agentkit/v6/intent/intent-user-prompt';
import fs from 'fs';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('GENERIC INTENT V1 GENERATION TEST');
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

  console.log('2️⃣  GENERATING GENERIC INTENT V1 CONTRACT');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('⏳ Calling LLM with new Generic Intent V1 system prompt...\n');

  const startTime = Date.now();
  let result;

  try {
    result = await generateGenericIntentContractV1({
      enhancedPrompt
    });
    const duration = Date.now() - startTime;
    console.log(`✅ Generation completed in ${duration}ms\n`);
  } catch (error) {
    console.error('❌ Generation failed:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }

  // Save outputs
  console.log('3️⃣  SAVING OUTPUTS');
  console.log('─────────────────────────────────────────────────────────────');
  const outputDir = path.join(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const contractPath = path.join(outputDir, 'generic-intent-v1-contract.json');
  const rawPath = path.join(outputDir, 'generic-intent-v1-contract-raw.txt');

  fs.writeFileSync(contractPath, JSON.stringify(result.intent, null, 2));
  fs.writeFileSync(rawPath, result.rawText);

  console.log('📁 Files saved:');
  console.log(`   - ${contractPath}`);
  console.log(`   - ${rawPath}`);
  console.log('');

  // Display contract summary
  console.log('4️⃣  CONTRACT SUMMARY');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`Version: ${result.intent.version}`);
  console.log(`Goal: ${result.intent.goal}`);
  console.log(`Unit of Work: ${JSON.stringify(result.intent.unit_of_work)}`);
  console.log(`Total Steps: ${result.intent.steps.length}`);
  console.log('');

  // Display step kinds
  console.log('5️⃣  STEP KINDS DISTRIBUTION');
  console.log('─────────────────────────────────────────────────────────────');
  const stepKinds = result.intent.steps.map((s: any) => s.kind);
  const kindCounts = stepKinds.reduce((acc: any, kind: string) => {
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  Object.entries(kindCounts).forEach(([kind, count]) => {
    console.log(`   ${kind}: ${count}`);
  });
  console.log('');

  // List all steps
  console.log('6️⃣  ALL STEPS');
  console.log('─────────────────────────────────────────────────────────────');
  result.intent.steps.forEach((step: any, idx: number) => {
    console.log(`\n${idx + 1}. ${step.id} (${step.kind})`);
    console.log(`   Summary: ${step.summary}`);
    if (step.inputs && step.inputs.length > 0) {
      console.log(`   Inputs: [${step.inputs.join(', ')}]`);
    }
    if (step.output) {
      console.log(`   Output: ${step.output}`);
    }
    if (step.uses && step.uses.length > 0) {
      console.log(`   Uses:`);
      step.uses.forEach((use: any) => {
        console.log(`     - ${use.domain}.${use.capability}`);
        if (use.preferences) {
          console.log(`       preferences: ${JSON.stringify(use.preferences)}`);
        }
      });
    }
  });
  console.log('');

  // Validation checks
  console.log('7️⃣  FORMAT VALIDATION');
  console.log('─────────────────────────────────────────────────────────────');

  const checks = [
    {
      name: 'Version is "intent.v1"',
      pass: result.intent.version === 'intent.v1',
      value: result.intent.version
    },
    {
      name: 'All steps have "kind" field',
      pass: result.intent.steps.every((s: any) => s.kind),
      value: result.intent.steps.filter((s: any) => !s.kind).length + ' steps missing kind'
    },
    {
      name: 'All steps have "summary" field',
      pass: result.intent.steps.every((s: any) => s.summary),
      value: result.intent.steps.filter((s: any) => !s.summary).length + ' steps missing summary'
    },
    {
      name: 'No steps have "type" field (legacy)',
      pass: result.intent.steps.every((s: any) => !s.type),
      value: result.intent.steps.filter((s: any) => s.type).length + ' steps with legacy type'
    },
    {
      name: 'No steps have "semantic_op" field (legacy)',
      pass: result.intent.steps.every((s: any) => !s.fetch?.semantic_op && !s.deliver?.semantic_op),
      value: result.intent.steps.filter((s: any) => s.fetch?.semantic_op || s.deliver?.semantic_op).length + ' steps with semantic_op'
    },
    {
      name: 'No steps have "inputs" as object (legacy)',
      pass: result.intent.steps.every((s: any) => !s.inputs || Array.isArray(s.inputs)),
      value: result.intent.steps.filter((s: any) => s.inputs && !Array.isArray(s.inputs)).length + ' steps with object inputs'
    },
    {
      name: 'No steps have "outputs" as object (legacy)',
      pass: result.intent.steps.every((s: any) => !s.outputs || typeof s.outputs === 'string'),
      value: result.intent.steps.filter((s: any) => s.outputs && typeof s.outputs === 'object').length + ' steps with object outputs'
    }
  ];

  checks.forEach(check => {
    const status = check.pass ? '✅' : '❌';
    console.log(`${status} ${check.name}`);
    if (!check.pass) {
      console.log(`   Issue: ${check.value}`);
    }
  });
  console.log('');

  // Data flow check
  console.log('8️⃣  DATA FLOW VALIDATION');
  console.log('─────────────────────────────────────────────────────────────');

  // Check for symbolic refs (should NOT start with $.)
  const symbolicRefSteps = result.intent.steps.filter((s: any) =>
    s.output && typeof s.output === 'string' && !s.output.startsWith('$.')
  );
  console.log(`✅ Steps with symbolic RefName output: ${symbolicRefSteps.length}/${result.intent.steps.length}`);

  // Check for array inputs
  const arrayInputSteps = result.intent.steps.filter((s: any) =>
    s.inputs && Array.isArray(s.inputs)
  );
  console.log(`✅ Steps with array inputs: ${arrayInputSteps.length}/${result.intent.steps.filter((s: any) => s.inputs).length}`);

  // Check for CapabilityUse
  const capabilityUseSteps = result.intent.steps.filter((s: any) =>
    s.uses && Array.isArray(s.uses)
  );
  console.log(`✅ Steps with CapabilityUse: ${capabilityUseSteps.length}`);

  if (capabilityUseSteps.length > 0) {
    console.log('\n   Sample CapabilityUse:');
    capabilityUseSteps.slice(0, 3).forEach((s: any) => {
      console.log(`   - ${s.id}:`);
      s.uses.forEach((use: any) => {
        console.log(`     ${use.domain}.${use.capability}`);
      });
    });
  }
  console.log('');

  // Check for JSONPath refs (should NOT exist in new format)
  console.log('9️⃣  LEGACY PATTERN DETECTION');
  console.log('─────────────────────────────────────────────────────────────');

  const jsonPathRefs: string[] = [];
  const checkForJsonPath = (obj: any, path: string = '') => {
    if (typeof obj === 'string' && obj.startsWith('$.')) {
      jsonPathRefs.push(`${path}: ${obj}`);
    } else if (typeof obj === 'object' && obj !== null) {
      Object.entries(obj).forEach(([key, value]) => {
        checkForJsonPath(value, path ? `${path}.${key}` : key);
      });
    }
  };

  checkForJsonPath(result.intent);

  if (jsonPathRefs.length > 0) {
    console.log(`❌ Found ${jsonPathRefs.length} JSONPath references (should be symbolic):`);
    jsonPathRefs.slice(0, 10).forEach(ref => {
      console.log(`   ${ref}`);
    });
  } else {
    console.log('✅ No JSONPath references found (correct for Generic Intent V1)');
  }
  console.log('');

  // Final summary
  console.log('🎉 GENERATION TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const allPassed = checks.every(c => c.pass) && jsonPathRefs.length === 0;

  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED - Contract is valid Generic Intent V1 format');
    console.log('');
    console.log('Next steps:');
    console.log('   1. Review contract in output/generic-intent-v1-contract.json');
    console.log('   2. Test with CapabilityBinder');
    console.log('   3. Verify binding to plugin actions works');
  } else {
    console.log('⚠️  SOME CHECKS FAILED - Review output and adjust system prompt');
    console.log('');
    console.log('Issues to fix:');
    checks.filter(c => !c.pass).forEach(c => {
      console.log(`   - ${c.name}`);
    });
    if (jsonPathRefs.length > 0) {
      console.log(`   - Remove ${jsonPathRefs.length} JSONPath references`);
    }
  }
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
