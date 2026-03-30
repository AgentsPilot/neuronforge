import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Try old table
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('id, status, created_at, error, execution_summary')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('=== RECENT EXECUTIONS (agent_executions table) ===');
  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  executions.forEach((ex, i) => {
    console.log(`\n${i+1}. ${ex.id}`);
    console.log(`   Status: ${ex.status}`);
    console.log(`   Created: ${ex.created_at}`);
    if (ex.error) console.log(`   Error: ${ex.error.substring(0, 150)}`);
    if (ex.execution_summary) {
      console.log(`   Summary: ${JSON.stringify(ex.execution_summary).substring(0, 200)}`);
    }
  });

  // Get full details of latest
  const latest = executions[0];
  const { data: fullExec } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', latest.id)
    .single();

  console.log('\n=== LATEST EXECUTION FULL DETAILS ===');
  if (fullExec?.step_results) {
    const steps = Object.keys(fullExec.step_results);
    console.log('Steps executed:', steps.length);
    console.log('Step IDs:', steps.join(', '));

    steps.slice(0, 10).forEach(stepId => {
      const result = fullExec.step_results[stepId];
      console.log(`\n${stepId}:`);
      console.log(`  Status: ${result.status}`);
      if (result.error) console.log(`  Error: ${result.error.substring(0, 100)}`);
      if (result.data) {
        const dataStr = JSON.stringify(result.data);
        console.log(`  Data (first 150 chars): ${dataStr.substring(0, 150)}`);
      }
    });
  }
}

main();
