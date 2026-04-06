// Check recent executions to see what's available
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentExecutions() {
  console.log('🔍 Checking recent executions...\n');

  // Check agent_executions (what UI shows)
  const { data: agentExecs, error: agentError } = await supabase
    .from('agent_executions')
    .select('id, agent_id, status, started_at, run_mode, execution_type')
    .order('started_at', { ascending: false })
    .limit(10);

  if (agentError) {
    console.error('❌ Error fetching agent_executions:', agentError);
    return;
  }

  console.log('📋 Recent agent_executions (what UI shows):');
  console.log('Total found:', agentExecs?.length || 0);
  console.table(agentExecs?.map(e => ({
    id: e.id.slice(0, 8),
    agent_id: e.agent_id.slice(0, 8),
    status: e.status,
    run_mode: e.run_mode || 'null',
    started_at: e.started_at,
  })));

  // Check workflow_executions (backend tracking)
  const { data: workflowExecs, error: workflowError } = await supabase
    .from('workflow_executions')
    .select('id, agent_id, status, started_at, run_mode')
    .order('started_at', { ascending: false })
    .limit(10);

  if (workflowError) {
    console.error('❌ Error fetching workflow_executions:', workflowError);
    return;
  }

  console.log('\n📋 Recent workflow_executions (backend tracking):');
  console.log('Total found:', workflowExecs?.length || 0);
  console.table(workflowExecs?.map(e => ({
    id: e.id.slice(0, 8),
    agent_id: e.agent_id.slice(0, 8),
    status: e.status,
    run_mode: e.run_mode || 'null',
    started_at: e.started_at,
  })));

  // Check for specific agent (the one you're testing)
  console.log('\n🔍 Filtering for specific agents...');

  // Find agents with recent executions
  const agentCounts = {};
  agentExecs?.forEach(e => {
    agentCounts[e.agent_id] = (agentCounts[e.agent_id] || 0) + 1;
  });

  console.log('\nAgent execution counts:');
  Object.entries(agentCounts).forEach(([agentId, count]) => {
    console.log(`  ${agentId.slice(0, 8)}: ${count} executions`);
  });

  // Show production vs calibration breakdown
  const productionCount = agentExecs?.filter(e => !e.run_mode || e.run_mode === 'production').length || 0;
  const calibrationCount = agentExecs?.filter(e => e.run_mode === 'calibration').length || 0;

  console.log('\n📊 Run mode breakdown:');
  console.log(`  Production: ${productionCount}`);
  console.log(`  Calibration: ${calibrationCount}`);
}

checkRecentExecutions().catch(console.error);
