// Check for production executions specifically
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkProductionExecutions() {
  console.log('🔍 Checking PRODUCTION executions only...\n');

  // Get production executions (filtering out calibration)
  const { data: productionExecs, error } = await supabase
    .from('agent_executions')
    .select('id, agent_id, status, started_at, run_mode, execution_type')
    .neq('run_mode', 'calibration')  // Same filter as UI
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📋 Production executions (what UI shows in Recent Activity):');
  console.log('Total found:', productionExecs?.length || 0);

  if (productionExecs && productionExecs.length > 0) {
    console.table(productionExecs.map(e => ({
      id: e.id.slice(0, 8),
      agent_id: e.agent_id.slice(0, 8),
      status: e.status,
      run_mode: e.run_mode || 'null/production',
      started_at: e.started_at,
    })));
  } else {
    console.log('❌ No production executions found!');
    console.log('This is why Recent Activity only shows old data.\n');
  }

  // Show date of last production run
  if (productionExecs && productionExecs.length > 0) {
    const lastProductionDate = new Date(productionExecs[0].started_at);
    console.log(`\n📅 Last production run: ${lastProductionDate.toLocaleString()}`);
  }

  // Also check if there's a mix of run_mode values
  const { data: allModes, error: modesError } = await supabase
    .from('agent_executions')
    .select('run_mode')
    .order('started_at', { ascending: false })
    .limit(100);

  if (!modesError && allModes) {
    const modeCounts = {};
    allModes.forEach(e => {
      const mode = e.run_mode || 'null/production';
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;
    });

    console.log('\n📊 Run mode distribution (last 100 executions):');
    Object.entries(modeCounts).forEach(([mode, count]) => {
      console.log(`  ${mode}: ${count}`);
    });
  }
}

checkProductionExecutions().catch(console.error);
