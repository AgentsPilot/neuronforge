require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSettings() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { data: agent } = await supabase
    .from('agents')
    .select('agent_name, production_ready, insights_enabled, created_from_prompt')
    .eq('id', agentId)
    .single();

  console.log('\n⚙️  AGENT SETTINGS\n');
  console.log('Name:', agent.agent_name);
  console.log('production_ready:', agent.production_ready);
  console.log('insights_enabled:', agent.insights_enabled);
  console.log('created_from_prompt:', agent.created_from_prompt ? agent.created_from_prompt.slice(0, 100) + '...' : 'NULL');

  // Count executions
  const { count } = await supabase
    .from('workflow_executions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'completed');

  console.log('\n📊 EXECUTION COUNT:', count);
  console.log('Minimum for insights: 7');
  console.log('Has enough data?', count >= 7 ? '✅ YES' : '❌ NO');
}

checkSettings().catch(console.error);
