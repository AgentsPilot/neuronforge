require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFilterGroups() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id')
    .eq('agent_id', agentId)
    .eq('run_mode', 'production')
    .order('started_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  const executionId = executions[0].id;

  // Get ALL step executions to see the complete flow
  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, item_count, status, execution_metadata')
    .eq('workflow_execution_id', executionId)
    .order('created_at', { ascending: true });

  console.log('\n🔍 Complete Step Flow:\n');

  steps.forEach((step, index) => {
    const groupInfo = step.step_name.includes('Filter Group') ? ' ⚠️ GROUP FILTER' : '';
    const newItems = step.step_name.includes('Filter New Items') ? ' ✅ NEW ITEMS' : '';
    const append = step.step_name.includes('Send Summary') ? ' 📤 OUTPUT' : '';

    console.log(`Step ${index + 1}: ${step.step_name}${groupInfo}${newItems}${append}`);
    console.log(`  → Count: ${step.item_count}`);
    console.log(`  → Status: ${step.status}`);
    console.log('');
  });

  // Get agent details to understand the filtering logic
  const { data: agent } = await supabase
    .from('agents')
    .select('workflow, description')
    .eq('id', agentId)
    .single();

  if (agent && agent.workflow) {
    console.log('\n📋 Workflow Configuration:');
    console.log('Description:', agent.description);
    console.log('\nWorkflow steps:');

    const workflow = agent.workflow;
    if (workflow.steps) {
      workflow.steps.forEach((step, index) => {
        if (step.type === 'filter_group') {
          console.log(`\nStep ${index + 1}: ${step.type} (ID: ${step.id})`);
          console.log('  Logic:', step.logic);
          console.log('  Conditions:', JSON.stringify(step.conditions, null, 4));
        }
      });
    }
  }
}

checkFilterGroups().catch(console.error);
