import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('=== SCATTER-GATHER EXECUTION ANALYSIS ===\n');

  const executionId = '229b66ee-29ca-4944-8492-e25f3a822302';

  // Check workflow_step_executions table for step4 (scatter_gather)
  const { data: stepExecs } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .eq('execution_id', executionId)
    .order('created_at', { ascending: true });

  if (!stepExecs || stepExecs.length === 0) {
    console.log('No step executions found in workflow_step_executions table');

    // Try checking agent_executions for more details
    const { data: execution } = await supabase
      .from('agent_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (execution) {
      console.log('\n=== EXECUTION RECORD ===');
      console.log('Status:', execution.status);
      console.log('Error:', execution.error_message);
      console.log('Steps completed:', execution.logs?.stepsCompleted);
      console.log('Steps failed:', execution.logs?.stepsFailed);
      console.log('Execution time:', execution.logs?.executionTime, 'ms');
    }

    return;
  }

  console.log(`Found ${stepExecs.length} step execution records\n`);

  // Display all step executions
  stepExecs.forEach((exec: any, index: number) => {
    console.log(`\n[${index + 1}] Step: ${exec.step_id}`);
    console.log(`Status: ${exec.status}`);
    console.log(`Started: ${exec.started_at}`);
    console.log(`Completed: ${exec.completed_at}`);

    if (exec.output) {
      const output = typeof exec.output === 'string' ? JSON.parse(exec.output) : exec.output;
      console.log('Output keys:', Object.keys(output).join(', '));

      // Show data structure
      if (output.data) {
        if (Array.isArray(output.data)) {
          console.log(`Output data: array with ${output.data.length} items`);
        } else {
          console.log('Output data:', typeof output.data);
        }
      }
    }

    if (exec.error) {
      console.log('ERROR:', exec.error);
    }
  });

  // Find step4 (scatter_gather) specifically
  const step4 = stepExecs.find((e: any) => e.step_id === 'step4');
  if (step4) {
    console.log('\n\n=== STEP4 (SCATTER_GATHER) DETAILS ===');
    console.log(JSON.stringify(step4, null, 2));
  }

  // Check steps after scatter_gather
  console.log('\n\n=== STEPS AFTER SCATTER_GATHER ===');
  const step11 = stepExecs.find((e: any) => e.step_id === 'step11');
  const step12 = stepExecs.find((e: any) => e.step_id === 'step12');
  const step13 = stepExecs.find((e: any) => e.step_id === 'step13');
  const step15 = stepExecs.find((e: any) => e.step_id === 'step15');
  const step16 = stepExecs.find((e: any) => e.step_id === 'step16');

  [
    { step: 'step11', exec: step11, desc: 'Transform gathered results' },
    { step: 'step12', exec: step12, desc: 'Conditional check' },
    { step: 'step13', exec: step13, desc: 'Append to spreadsheet' },
    { step: 'step15', exec: step15, desc: 'AI email generation' },
    { step: 'step16', exec: step16, desc: 'Send email' }
  ].forEach(({ step, exec, desc }) => {
    if (exec) {
      console.log(`\n${step} (${desc}): ${exec.status}`);
      if (exec.error) {
        console.log(`  Error: ${exec.error}`);
      }
      if (exec.output) {
        const output = typeof exec.output === 'string' ? JSON.parse(exec.output) : exec.output;
        if (output.data) {
          if (Array.isArray(output.data)) {
            console.log(`  Output: array[${output.data.length}]`);
          } else if (typeof output.data === 'object') {
            console.log(`  Output keys: ${Object.keys(output.data).slice(0, 5).join(', ')}`);
          } else {
            console.log(`  Output: ${typeof output.data}`);
          }
        }
      }
    } else {
      console.log(`\n${step} (${desc}): NOT EXECUTED`);
    }
  });

  console.log('\n\n=== HYPOTHESIS ===');
  console.log('If files were NOT uploaded and spreadsheet NOT updated:');
  console.log('1. step4 (scatter_gather) might have returned empty results');
  console.log('2. OR nested steps inside scatter_gather failed');
  console.log('3. OR step3 (filter) returned 0 items, so scatter_gather had nothing to process');
}

main();
