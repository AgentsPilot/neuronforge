import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get the most recent calibration session
  const { data: session } = await supabase
    .from('calibration_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    console.log('No calibration sessions found');
    return;
  }

  console.log('=== LAST CALIBRATION SESSION DETAILS ===\n');
  console.log('Session ID:', session.id);
  console.log('Status:', session.status);
  console.log('Created:', session.created_at);
  console.log('Updated:', session.updated_at);
  console.log('Iterations:', session.iterations_count);
  console.log('Summary:', session.summary);
  console.log('\nIssues Summary:', session.issues_summary);
  console.log('\n=== FULL SESSION DATA ===');
  console.log(JSON.stringify(session, null, 2));

  // Check the workflow execution for this session
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, status, created_at, output')
    .eq('agent_id', session.agent_id)
    .gte('created_at', session.created_at)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('\n=== WORKFLOW EXECUTIONS DURING CALIBRATION ===');
  executions?.forEach((exec, i) => {
    console.log(`\nExecution ${i + 1}:`);
    console.log('  ID:', exec.id);
    console.log('  Status:', exec.status);
    console.log('  Created:', exec.created_at);
    console.log('  Output keys:', exec.output ? Object.keys(exec.output) : 'none');

    if (exec.output && exec.output.step4) {
      console.log('  Step4 output preview:', JSON.stringify(exec.output.step4).slice(0, 200));
    }
  });
}

main().catch(console.error);
