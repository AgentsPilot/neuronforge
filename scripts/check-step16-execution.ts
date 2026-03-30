import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const executionId = '229b66ee-29ca-4944-8492-e25f3a822302';

  // Get execution details
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) {
    console.log('Execution not found');
    return;
  }

  console.log('=== EXECUTION DETAILS ===');
  console.log('Status:', execution.status);
  console.log('Error:', execution.error);
  console.log('Steps completed:', execution.logs?.stepsCompleted);
  console.log('Steps failed:', execution.logs?.stepsFailed);

  console.log('\n=== STEP RESULTS ===');
  if (execution.step_results && Array.isArray(execution.step_results)) {
    console.log(`Total step results: ${execution.step_results.length}\n`);

    // Display all step results
    execution.step_results.forEach((result: any, index: number) => {
      console.log(`\nStep ${index + 1}: ${result.stepId}`);
      console.log(`Status: ${result.status}`);
      if (result.error) {
        console.log(`Error: ${result.error}`);
      }
      if (result.data) {
        console.log('Has data:', typeof result.data === 'object' ? Object.keys(result.data).join(', ') : 'scalar value');
      }
    });

    // Find step16 specifically
    const step16Result = execution.step_results.find((r: any) => r.stepId === 'step16');
    if (step16Result) {
      console.log('\n=== STEP16 (send_email) RESULT ===');
      console.log(JSON.stringify(step16Result, null, 2));
    } else {
      console.log('\n=== STEP16 NOT FOUND IN RESULTS ===');
      console.log('This suggests step16 failed before execution or during validation');
    }
  } else {
    console.log('No step_results array found');
  }

  // Check execution_summary
  if (execution.execution_summary) {
    console.log('\n=== EXECUTION SUMMARY ===');
    console.log(JSON.stringify(execution.execution_summary, null, 2));
  }
}

main();
