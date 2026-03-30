import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('=== CONFIG RESOLUTION ANALYSIS ===\n');

  // Get agent
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps, input_schema')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  // Find step16
  const steps = agent.pilot_steps || [];
  const step16 = steps.find((s: any) => s.step_id === 'step16');

  if (!step16) {
    console.log('Step16 not found in workflow');
    return;
  }

  console.log('STEP16 CONFIG (from workflow):');
  console.log(JSON.stringify(step16.config, null, 2));

  console.log('\n=== WHAT SHOULD RESOLVE ===');
  console.log('recipients.to: ["{{config.digest_recipient}}"]');
  console.log('Should resolve to: ["offir.omer@gmail.com"]');

  console.log('\n=== INPUT SCHEMA (where config comes from) ===');
  if (agent.input_schema && Array.isArray(agent.input_schema)) {
    agent.input_schema.forEach((field: any) => {
      if (field.name === 'digest_recipient') {
        console.log('Found digest_recipient field:');
        console.log(JSON.stringify(field, null, 2));
      }
    });
  }

  console.log('\n=== POSSIBLE ISSUES ===');

  // Check if config reference format is correct
  const configStr = JSON.stringify(step16.config);
  const configRefs = configStr.match(/\{\{config\.\w+\}\}/g);

  if (configRefs) {
    console.log('\n1. Config Variable Format: ✓ Correct');
    console.log('   Found:', configRefs.join(', '));
  } else {
    console.log('\n1. Config Variable Format: ✗ ISSUE');
    console.log('   No {{config.X}} variables found');
  }

  // Check if it's inside an array
  if (step16.config?.recipients?.to && Array.isArray(step16.config.recipients.to)) {
    console.log('\n2. Recipients Array: ✓ Correct structure');
    console.log('   Type: array');
    console.log('   Length:', step16.config.recipients.to.length);
    console.log('   Values:', step16.config.recipients.to);

    // Check if array is empty OR has config variable
    if (step16.config.recipients.to.length === 0) {
      console.log('   ✗ ISSUE: Empty array!');
    } else if (step16.config.recipients.to[0].includes('{{config.')) {
      console.log('   ✓ Contains config variable');
    } else {
      console.log('   ⚠️ No config variable - hardcoded value');
    }
  } else {
    console.log('\n2. Recipients Array: ✗ ISSUE');
    console.log('   recipients.to is not an array or is missing');
  }

  console.log('\n=== HYPOTHESIS ===');
  console.log('If execution failed with "Recipient address required":');
  console.log('');
  console.log('LIKELY CAUSE: {{config.digest_recipient}} resolved to empty string or undefined');
  console.log('Result: recipients.to = [""] or [undefined] or []');
  console.log('');
  console.log('WHY: Config extraction happens AFTER pre-flight validation but might fail during execution');
  console.log('');
  console.log('NEXT STEPS:');
  console.log('1. Check ExecutionContext logs for config extraction');
  console.log('2. Verify workflowConfig passed to ExecutionContext');
  console.log('3. Check if resolveVariable() handles config.X correctly');
}

main();
