import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkStepOutputs() {
  // Get latest execution
  const { data: execution } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution) {
    console.log('❌ No execution found');
    return;
  }

  console.log('Execution ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Result:', execution.result ? 'yes' : 'no');

  // Check if result contains the actual data
  if (execution.result) {
    console.log('\n=== RESULT OBJECT ===');
    console.log(JSON.stringify(execution.result, null, 2));
  }

  // Get step execution records
  const { data: stepExecutions } = await supabase
    .from('step_executions')
    .select('*')
    .eq('execution_id', execution.id)
    .order('created_at', { ascending: true });

  console.log('\n=== STEP EXECUTIONS ===');
  console.log('Total steps executed:', stepExecutions?.length || 0);

  if (stepExecutions) {
    for (const stepExec of stepExecutions) {
      console.log(`\n--- ${stepExec.step_id} ---`);
      console.log('Status:', stepExec.status);
      console.log('Output variable:', stepExec.output_variable);

      if (stepExec.output) {
        const output = stepExec.output;
        console.log('Output type:', typeof output);

        if (Array.isArray(output)) {
          console.log('Array length:', output.length);
          if (output.length > 0) {
            console.log('First item:', JSON.stringify(output[0]).substring(0, 200));
          } else {
            console.log('⚠️  EMPTY ARRAY - This step produced no data!');
          }
        } else if (typeof output === 'object' && output !== null) {
          const keys = Object.keys(output);
          console.log('Object keys:', keys);

          // Check for nested arrays
          for (const key of keys) {
            if (Array.isArray(output[key])) {
              console.log(`  ${key}: array[${output[key].length}]`);
              if (output[key].length === 0) {
                console.log(`    ⚠️  EMPTY - ${key} has no items`);
              }
            }
          }
        } else {
          console.log('Output value:', String(output).substring(0, 100));
        }
      } else {
        console.log('⚠️  No output');
      }

      if (stepExec.error) {
        console.log('❌ Error:', stepExec.error);
      }
    }
  }

  // Check execution summary
  if (execution.execution_summary) {
    console.log('\n=== EXECUTION SUMMARY ===');
    console.log(JSON.stringify(execution.execution_summary, null, 2));
  }
}

checkStepOutputs().catch(console.error);
