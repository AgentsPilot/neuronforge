// Test execution_id fix - verify all steps from same run have same execution_id
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testExecutionIdFix() {
  const agentId = '38469634-354d-4655-ac0b-5c446112430d';

  console.log('🔍 Testing execution_id fix...\n');

  // Get latest execution
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('id, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution) {
    console.log('❌ No executions found. Please run the agent first.');
    return;
  }

  console.log(`📊 Latest Execution: ${execution.id}`);
  console.log(`   Status: ${execution.status}`);
  console.log(`   Created: ${execution.created_at}\n`);

  // Get step executions
  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, step_type, workflow_execution_id, created_at')
    .eq('workflow_execution_id', execution.id)
    .order('created_at');

  if (!steps || steps.length === 0) {
    console.log('⚠️  No step execution records found');
    return;
  }

  console.log(`📋 Found ${steps.length} step execution records:\n`);

  // Group by execution_id
  const executionIds = new Set();
  steps.forEach((step, index) => {
    executionIds.add(step.workflow_execution_id);
    console.log(`  ${index + 1}. ${step.step_name}`);
    console.log(`     Step ID: ${step.step_id}`);
    console.log(`     Type: ${step.step_type}`);
    console.log(`     Execution ID: ${step.workflow_execution_id}`);
    console.log(`     Created: ${step.created_at}`);
    console.log('');
  });

  // Validation
  console.log('🔍 Validation:');
  console.log(`   Expected execution_id: ${execution.id}`);
  console.log(`   Unique execution_ids found: ${executionIds.size}`);
  console.log('');

  if (executionIds.size === 1 && executionIds.has(execution.id)) {
    console.log('✅ SUCCESS! All steps have the same execution_id');
    console.log(`   All ${steps.length} steps use: ${execution.id}`);
  } else {
    console.log('❌ FAILURE! Steps have different execution_ids:');
    executionIds.forEach(id => {
      const count = steps.filter(s => s.workflow_execution_id === id).length;
      const match = id === execution.id ? '✅ CORRECT' : '❌ WRONG';
      console.log(`   ${id}: ${count} step(s) ${match}`);
    });
  }
}

testExecutionIdFix()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
