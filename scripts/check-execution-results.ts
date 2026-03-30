// Check workflow execution results directly
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkExecutionResults() {
  console.log('=== CHECKING LATEST EXECUTION ===\n');

  // Get latest execution with all data
  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error fetching executions:', error);
    return;
  }

  if (!executions || executions.length === 0) {
    console.log('❌ No executions found');
    return;
  }

  const execution = executions[0];
  console.log(`Execution ID: ${execution.id}`);
  console.log(`Workflow ID: ${execution.workflow_id}`);
  console.log(`Status: ${execution.status}`);
  console.log(`Started: ${execution.started_at}`);
  console.log(`Completed: ${execution.completed_at}`);
  console.log(`Duration: ${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`);

  if (execution.error) {
    console.log(`\n❌ ERROR: ${execution.error}`);
  }

  if (execution.result) {
    console.log('\n=== EXECUTION RESULT ===');
    console.log(JSON.stringify(execution.result, null, 2));
  }

  if (execution.metadata) {
    console.log('\n=== METADATA ===');
    console.log(JSON.stringify(execution.metadata, null, 2));
  }

  // Check for step executions
  const { data: steps } = await supabase
    .from('step_executions')
    .select('*')
    .eq('execution_id', execution.id)
    .order('created_at', { ascending: true });

  if (steps && steps.length > 0) {
    console.log(`\n=== STEP EXECUTIONS (${steps.length} steps) ===`);
    for (const step of steps) {
      const status = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⚠️';
      console.log(`${status} ${step.step_name || step.step_id}: ${step.status}`);

      if (step.output && Object.keys(step.output).length > 0) {
        console.log(`   Output keys: ${Object.keys(step.output).join(', ')}`);

        // Show sample output for key steps
        if (step.step_id === 'step8' || step.step_id === 'step9') {
          console.log(`   Sample output:`, JSON.stringify(step.output, null, 2).substring(0, 500));
        }
      }

      if (step.error) {
        console.log(`   Error: ${step.error}`);
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(execution.status === 'completed' ? '✅ Workflow completed successfully!' : `⚠️ Status: ${execution.status}`);
}

checkExecutionResults().catch(console.error);
