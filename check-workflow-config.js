require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWorkflowConfig() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { data: agent } = await supabase
    .from('agents')
    .select('workflow, description, agent_name')
    .eq('id', agentId)
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  console.log('\n📋 Agent Configuration:');
  console.log('Name:', agent.agent_name);
  console.log('Description:', agent.description);
  console.log('\n');

  const workflow = agent.workflow;

  console.log('🔧 Workflow Steps:\n');

  workflow.steps.forEach((step, index) => {
    console.log(`Step ${index + 1}: ${step.type} (ID: ${step.id})`);

    if (step.label) {
      console.log(`  Label: ${step.label}`);
    }

    if (step.type === 'filter_group') {
      console.log(`  Logic: ${step.logic}`);
      console.log(`  Group Name: ${step.groupName || 'N/A'}`);
      console.log('  Conditions:');
      step.conditions.forEach((cond, i) => {
        console.log(`    ${i + 1}. ${cond.field} ${cond.operator} ${cond.value}`);
      });
    }

    console.log('');
  });
}

checkWorkflowConfig().catch(console.error);
