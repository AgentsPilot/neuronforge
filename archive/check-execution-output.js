// Check what data structure is in execution output
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkExecutionOutput() {
  console.log('🔍 Checking execution output structure...\n');

  // First, check what columns exist
  const { data: sample, error: sampleError } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  if (sampleError) {
    console.error('❌ Error fetching sample:', sampleError);
    return;
  }

  if (!sample || sample.length === 0) {
    console.log('❌ No executions found');
    return;
  }

  console.log('📋 Available columns:');
  console.log(Object.keys(sample[0]).join(', '));
  console.log('\n');

  // Get a recent execution
  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!executions || executions.length === 0) {
    console.log('❌ No executions with output found');
    return;
  }

  const execution = executions[0];

  console.log('📋 Execution ID:', execution.id);
  console.log('📋 Agent ID:', execution.agent_id);
  console.log('📋 Status:', execution.status);
  console.log('📋 Total Steps:', execution.total_steps);
  console.log('📋 Completed Steps:', execution.completed_steps_count);

  console.log('\n📦 Input Values:');
  console.log(JSON.stringify(execution.input_values, null, 2));

  console.log('\n📦 Final Output (This is the result metadata like "10 emails read"):');
  console.log(JSON.stringify(execution.final_output, null, 2));

  console.log('\n📦 Execution Trace (What happened during execution):');
  if (execution.execution_trace) {
    const trace = JSON.stringify(execution.execution_trace, null, 2);
    console.log(trace.length > 500 ? trace.substring(0, 500) + '...\n[truncated]' : trace);
  } else {
    console.log('null');
  }
}

checkExecutionOutput().catch(console.error);
