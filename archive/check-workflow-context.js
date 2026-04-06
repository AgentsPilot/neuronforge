require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkContext() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { data: agent } = await supabase
    .from('agents')
    .select('created_from_prompt, workflow_purpose, description')
    .eq('id', agentId)
    .single();

  console.log('\n📋 WORKFLOW CONTEXT SENT TO LLM:\n');
  console.log('created_from_prompt:');
  console.log(agent.created_from_prompt);
  console.log('\nworkflow_purpose:');
  console.log(agent.workflow_purpose || 'NULL');
  console.log('\ndescription:');
  console.log(agent.description || 'NULL');
}

checkContext().catch(console.error);
