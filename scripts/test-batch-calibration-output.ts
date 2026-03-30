import { config } from 'dotenv';

// CRITICAL: Load environment variables BEFORE importing WorkflowPilot
// WorkflowPilot imports StateManager which creates Supabase client at module load time
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { WorkflowPilot } from '../lib/pilot/WorkflowPilot';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get the agent
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (!agent) {
    console.error('Agent not found');
    return;
  }

  // Get user
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', agent.user_id)
    .single();

  if (!user) {
    console.error('User not found');
    return;
  }

  console.log('=== TESTING BATCH CALIBRATION OUTPUT ===\n');
  console.log('Agent ID:', agent.id);
  console.log('Running workflow in batch_calibration mode...\n');

  // Execute workflow in batch calibration mode
  const pilot = new WorkflowPilot(supabase);
  const result = await pilot.execute(
    agent,
    user.id,
    '', // userInput
    {}, // inputValues
    crypto.randomUUID(), // sessionId
    undefined, // stepEmitter
    false, // debugMode
    undefined, // debugRunId
    undefined, // providedExecutionId
    'batch_calibration' // ← CRITICAL: This should trigger all step outputs to be returned
  );

  console.log('Execution completed:');
  console.log('Success:', result.success);
  console.log('Steps completed:', result.stepsCompleted);
  console.log('Steps failed:', result.stepsFailed);
  console.log('\nOutput keys:', Object.keys(result.output || {}));

  // Check step4 output specifically
  const step4Output = result.output?.step4;
  console.log('\n=== STEP4 OUTPUT (scatter-gather) ===');
  console.log('Type:', Array.isArray(step4Output) ? 'array' : typeof step4Output);

  if (Array.isArray(step4Output)) {
    console.log('Length:', step4Output.length);
    console.log('\nFirst 2 items:');
    step4Output.slice(0, 2).forEach((item, i) => {
      console.log(`\nItem ${i}:`);
      if (item && typeof item === 'object') {
        console.log('  Keys:', Object.keys(item));
        if ('error' in item) {
          console.log('  ❌ HAS ERROR FIELD');
          console.log('  Error message:', item.error);
          console.log('  Item index:', item.item);
        }
        // Show full first item
        if (i === 0) {
          console.log('  Full object:', JSON.stringify(item, null, 2));
        }
      } else {
        console.log('  Value:', item);
      }
    });
  } else if (step4Output && typeof step4Output === 'object') {
    console.log('Is object with keys:', Object.keys(step4Output));
    console.log('Full object:', JSON.stringify(step4Output, null, 2));
  } else {
    console.log('Value:', step4Output);
  }

  // Also check step2 and step3 to understand the data flow
  console.log('\n=== STEP2 OUTPUT (flatten emails -> attachments) ===');
  const step2Output = result.output?.step2;
  console.log('Type:', Array.isArray(step2Output) ? 'array' : typeof step2Output);
  if (Array.isArray(step2Output)) {
    console.log('Length:', step2Output.length);
    console.log('First item keys:', step2Output[0] ? Object.keys(step2Output[0]) : 'none');
  }

  console.log('\n=== STEP3 OUTPUT (filter PDFs) ===');
  const step3Output = result.output?.step3;
  console.log('Type:', Array.isArray(step3Output) ? 'array' : typeof step3Output);
  if (Array.isArray(step3Output)) {
    console.log('Length:', step3Output.length);
    console.log('First item keys:', step3Output[0] ? Object.keys(step3Output[0]) : 'none');
  }
}

main().catch(console.error);
