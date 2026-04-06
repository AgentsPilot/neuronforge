require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLatestExecution() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  // Get latest execution
  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select('*')
    .eq('agent_id', agentId)
    .eq('run_mode', 'production')
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  const execution = executions[0];
  console.log('\n📋 Latest Execution Details:');
  console.log('Execution ID:', execution.id);
  console.log('Started at:', execution.started_at);
  console.log('Status:', execution.status);
  console.log('\n');

  // Get execution metrics
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', execution.id)
    .single();

  if (metrics) {
    console.log('📊 Execution Metrics:');
    console.log('Total items:', metrics.total_items);
    console.log('Step metrics:', JSON.stringify(metrics.step_metrics, null, 2));
    console.log('\n');
  }

  // Get step executions
  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('step_name, item_count, status, execution_metadata')
    .eq('workflow_execution_id', execution.id)
    .order('created_at', { ascending: true });

  if (steps) {
    console.log('🔢 Step Execution Details:');
    steps.forEach((step, index) => {
      console.log(`\nStep ${index + 1}: ${step.step_name}`);
      console.log(`  Count: ${step.item_count}`);
      console.log(`  Status: ${step.status}`);
      if (step.execution_metadata?.field_names) {
        console.log(`  Fields: ${step.execution_metadata.field_names.join(', ')}`);
      }
    });
  }

  // Get execution results
  const { data: results } = await supabase
    .from('execution_results')
    .select('*')
    .eq('execution_id', execution.id)
    .single();

  if (results) {
    console.log('\n\n📝 Execution Results:');
    console.log('Total Items:', results.totalItems);
    console.log('Summary:', results.summary);
    console.log('Results:', JSON.stringify(results.results, null, 2));
  }
}

checkLatestExecution().catch(console.error);
