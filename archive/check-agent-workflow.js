require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWorkflowConfig() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { data: agentData } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (agentData) {
    console.log('\n✅ Agent found:');
    console.log('Name:', agentData.agent_name);
    console.log('Description:', agentData.description);

    if (agentData.workflow) {
      console.log('\n🔧 Workflow Steps:\n');

      const workflow = agentData.workflow;

      if (workflow.steps) {
        workflow.steps.forEach((step, index) => {
          console.log('Step', index + 1, ':', step.type, '(ID:', step.id + ')');

          if (step.label) {
            console.log('  Label:', step.label);
          }

          if (step.type === 'filter_group') {
            console.log('  Logic:', step.logic || 'AND');
            console.log('  Group Name:', step.groupName || 'N/A');
            console.log('  Conditions:');
            if (step.conditions) {
              step.conditions.forEach((cond, i) => {
                console.log('   ', i + 1 + '.', cond.field, cond.operator, '"' + cond.value + '"');
              });
            }
          }

          console.log('');
        });
      }
    }
  }
}

checkWorkflowConfig().catch(console.error);
