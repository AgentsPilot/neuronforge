// Check what the UI API endpoint returns for executions
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUIExecutions() {
  console.log('🔍 Checking what UI fetches from agent_executions...\n');

  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c'; // The agent we're testing

  // This mimics what ExecutionRepository.findByAgentId does
  const { data: executions, error } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .neq('run_mode', 'calibration')  // Filter out calibration runs
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📋 Executions returned by API (what UI sees):');
  console.log('Total:', executions?.length || 0);

  if (executions && executions.length > 0) {
    console.table(executions.slice(0, 10).map(e => ({
      id: e.id.slice(0, 8),
      status: e.status,
      run_mode: e.run_mode || 'null',
      started_at: e.started_at,
    })));

    console.log('\n✅ Latest execution details:');
    const latest = executions[0];
    console.log({
      id: latest.id,
      status: latest.status,
      run_mode: latest.run_mode,
      started_at: latest.started_at,
      completed_at: latest.completed_at,
      execution_duration_ms: latest.execution_duration_ms,
    });
  } else {
    console.log('❌ No executions found for this agent!');
  }
}

checkUIExecutions().catch(console.error);
