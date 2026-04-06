require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLatestMetrics() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n📊 LATEST EXECUTION METRICS\n');
  console.log('='.repeat(80));

  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('❌ No executions found');
    return;
  }

  const latestExec = executions[0];
  console.log(`\n📋 Latest execution: ${latestExec.id}`);
  console.log(`   Status: ${latestExec.status}`);
  console.log(`   Created: ${latestExec.created_at}`);

  // Check execution_metrics
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', latestExec.id)
    .maybeSingle();

  console.log('\n📊 Execution Metrics:');
  if (metrics) {
    console.log(`   ✅ EXISTS`);
    console.log(`   total_items: ${metrics.total_items}`);
    console.log(`   items_by_field:`, JSON.stringify(metrics.items_by_field, null, 2));
    console.log(`   field_names:`, JSON.stringify(metrics.field_names));
    console.log(`   has_empty_results: ${metrics.has_empty_results}`);
  } else {
    console.log(`   ❌ NOT FOUND - MetricsCollector did not run!`);
  }

  // Check workflow_step_executions for field_names
  console.log('\n📋 Step Executions (checking field_names storage):');
  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, item_count, execution_metadata')
    .eq('workflow_execution_id', latestExec.id)
    .order('created_at', { ascending: true });

  steps?.forEach(step => {
    const fieldNames = step.execution_metadata?.field_names;
    console.log(`\n   ${step.step_id}: ${step.step_name}`);
    console.log(`      item_count: ${step.item_count}`);
    console.log(`      field_names: ${fieldNames ? '✅ ' + JSON.stringify(fieldNames) : '❌ MISSING'}`);
  });

  console.log('\n' + '='.repeat(80));
}

checkLatestMetrics().catch(console.error);
