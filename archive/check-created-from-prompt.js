require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCreatedFromPrompt() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🔍 Checking created_from_prompt column\n');

  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, description, created_from_prompt, workflow_purpose')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('Agent:', agent.agent_name);
  console.log('\n' + '='.repeat(80) + '\n');

  console.log('📝 Description (current):\n');
  console.log(agent.description);
  console.log('\n' + '='.repeat(80) + '\n');

  if (agent.created_from_prompt) {
    console.log('💡 Created From Prompt (ORIGINAL USER INTENT):\n');
    console.log(agent.created_from_prompt);
    console.log('\n' + '='.repeat(80) + '\n');
  } else {
    console.log('⚠️  created_from_prompt is NULL\n');
  }

  if (agent.workflow_purpose) {
    console.log('🎯 Workflow Purpose:\n');
    console.log(agent.workflow_purpose);
    console.log('\n' + '='.repeat(80) + '\n');
  } else {
    console.log('⚠️  workflow_purpose is NULL\n');
  }

  console.log('\n📊 RECOMMENDATION:\n');
  console.log('For LLM injection, priority order:');
  console.log('  1. created_from_prompt (user\'s original intent in natural language) ⭐ BEST');
  console.log('  2. workflow_purpose (if manually set)');
  console.log('  3. description (fallback)');
  console.log('');
  console.log('Why created_from_prompt is better:');
  console.log('  ✅ Contains user\'s original business language');
  console.log('  ✅ Describes WHAT they want to track (complaints, leads, etc.)');
  console.log('  ✅ Includes business context (not just technical steps)');
  console.log('  ✅ More detailed than description');
}

checkCreatedFromPrompt().catch(console.error);
