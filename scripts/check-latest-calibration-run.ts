import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  console.log('=== LATEST CALIBRATION SESSION ===\n');

  // Get latest calibration session
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.log('No calibration sessions found');
    return;
  }

  const session = sessions[0];
  console.log('Session ID:', session.id);
  console.log('Status:', session.status);
  console.log('Created:', session.created_at);
  console.log('Execution ID:', session.execution_id);
  console.log('Total iterations:', session.total_iterations);
  console.log('Fixes applied:', session.fixes_applied);

  console.log('\n=== ISSUES FOUND ===');
  if (session.issues_found && Array.isArray(session.issues_found)) {
    console.log(`Total: ${session.issues_found.length} issues\n`);
    session.issues_found.forEach((issue: any, i: number) => {
      console.log(`${i + 1}. ${issue.title || issue.type}`);
      console.log(`   Category: ${issue.category}`);
      console.log(`   Severity: ${issue.severity}`);
      if (issue.details) {
        console.log(`   Details: ${issue.details}`);
      }
    });
  } else {
    console.log('No issues found');
  }

  // Get execution details
  if (session.execution_id) {
    console.log('\n=== EXECUTION DETAILS ===');
    const { data: execution } = await supabase
      .from('agent_executions')
      .select('*')
      .eq('id', session.execution_id)
      .single();

    if (execution) {
      console.log('Status:', execution.status);
      console.log('Steps completed:', execution.logs?.stepsCompleted);
      console.log('Steps failed:', execution.logs?.stepsFailed);
      console.log('Error:', execution.error_message || execution.logs?.error);
      console.log('Execution time:', execution.logs?.executionTime, 'ms');
    }
  }

  console.log('\n=== CHECKING WORKFLOW STEP EXECUTIONS ===');
  if (session.execution_id) {
    const { data: stepExecs } = await supabase
      .from('workflow_step_executions')
      .select('step_id, status, error, output')
      .eq('execution_id', session.execution_id)
      .order('created_at', { ascending: true });

    if (stepExecs && stepExecs.length > 0) {
      console.log(`Found ${stepExecs.length} step executions:\n`);
      stepExecs.forEach((step: any, i: number) => {
        console.log(`${i + 1}. ${step.step_id}: ${step.status}`);
        if (step.error) {
          console.log(`   Error: ${step.error}`);
        }
        if (step.output) {
          const output = typeof step.output === 'string' ? JSON.parse(step.output) : step.output;
          if (output.data) {
            if (Array.isArray(output.data)) {
              console.log(`   Output: array[${output.data.length}]`);
            } else if (typeof output.data === 'object') {
              console.log(`   Output: ${Object.keys(output.data).slice(0, 3).join(', ')}`);
            }
          }
        }
      });
    } else {
      console.log('No step executions found in workflow_step_executions table');
    }
  }
}

main();
