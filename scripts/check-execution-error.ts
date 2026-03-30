import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkExecutionError() {
  // Get latest execution with all fields
  const { data: execution, error } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.log('❌ Error fetching execution:', error);
    return;
  }

  if (!execution) {
    console.log('❌ No execution found');
    return;
  }

  console.log('=== FULL EXECUTION RECORD ===');
  console.log('ID:', execution.id);
  console.log('Agent ID:', execution.agent_id);
  console.log('Status:', execution.status);
  console.log('Created:', execution.created_at);
  console.log('Started:', execution.started_at);
  console.log('Completed:', execution.completed_at);
  console.log('Error message:', execution.error_message || 'none');
  console.log('Steps completed:', execution.steps_completed);
  console.log('Steps failed:', execution.steps_failed);
  console.log('Steps skipped:', execution.steps_skipped);

  console.log('\n=== RAW DATA ===');
  console.log('Has execution_trace:', !!execution.execution_trace);
  console.log('Has result:', !!execution.result);
  console.log('Has execution_summary:', !!execution.execution_summary);

  if (execution.execution_trace) {
    console.log('\nExecution trace keys:', Object.keys(execution.execution_trace));
    console.log('Full trace:', JSON.stringify(execution.execution_trace, null, 2).substring(0, 2000));
  }

  if (execution.result) {
    console.log('\nResult:', JSON.stringify(execution.result, null, 2));
  }

  if (execution.execution_summary) {
    console.log('\nExecution summary:', JSON.stringify(execution.execution_summary, null, 2));
  }

  // Get the agent's workflow to see what should have executed
  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, pilot_steps')
    .eq('id', execution.agent_id)
    .single();

  if (agent) {
    console.log('\n=== AGENT INFO ===');
    console.log('Name:', agent.name);
    console.log('Has pilot_steps:', !!agent.pilot_steps);
    if (agent.pilot_steps) {
      const steps = agent.pilot_steps as any[];
      console.log('Workflow step count:', steps.length);
      console.log('\nFirst 3 steps:');
      steps.slice(0, 3).forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.step_id || step.id} (${step.type})`);
      });
    }
  }

  // Check if there's a calibration session
  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', execution.agent_id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (sessions && sessions.length > 0) {
    const session = sessions[0];
    console.log('\n=== CALIBRATION SESSION ===');
    console.log('Session ID:', session.id);
    console.log('Status:', session.status);
    console.log('Iterations:', session.iterations);
    console.log('Fixes applied:', session.fixes_applied);
    console.log('Has issues:', !!session.issues);
    if (session.issues) {
      console.log('Issue count:', (session.issues as any[]).length);
    }
  }
}

checkExecutionError().catch(console.error);
