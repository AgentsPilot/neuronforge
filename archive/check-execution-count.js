/**
 * Check how many executions exist for an agent
 * Run with: node check-execution-count.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkExecutionCount(agentId) {
  console.log('📊 Checking execution count for agent:', agentId);
  console.log('='.repeat(70));

  // Check execution_metrics (what business intelligence uses)
  const { data: metrics, error } = await supabase
    .from('execution_metrics')
    .select('id, executed_at, total_items, step_metrics')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false });

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log(`\n📈 Execution Metrics Count: ${metrics?.length || 0}`);
  console.log(`   Required for Business Intelligence: 7`);
  console.log(`   Status: ${(metrics?.length || 0) >= 7 ? '✅ READY' : `⏳ NEED ${7 - (metrics?.length || 0)} MORE`}`);

  if (metrics && metrics.length > 0) {
    console.log(`\n📋 Recent Executions (last 10):\n`);
    metrics.slice(0, 10).forEach((m, i) => {
      const date = new Date(m.executed_at).toLocaleString();
      const hasStepMetrics = m.step_metrics && Array.isArray(m.step_metrics) && m.step_metrics.length > 0;
      const stepMetricsInfo = hasStepMetrics
        ? `${m.step_metrics.length} steps, counts: [${m.step_metrics.map(s => s.count).join(', ')}]`
        : 'No step_metrics';

      console.log(`   ${i + 1}. ${date}`);
      console.log(`      Total items: ${m.total_items || 0}`);
      console.log(`      Step metrics: ${stepMetricsInfo}`);
      console.log();
    });

    // Check if latest execution has step_metrics
    const latest = metrics[0];
    const hasNewArchitecture = latest.step_metrics &&
                                Array.isArray(latest.step_metrics) &&
                                latest.step_metrics.length > 0 &&
                                latest.step_metrics.some(s => s.count > 0);

    if (hasNewArchitecture) {
      console.log('✅ Latest execution has new architecture (step_metrics with counts)');
      console.log('   You are ready to test business intelligence!');
    } else {
      console.log('⏳ Latest execution does NOT have new architecture');
      console.log('   Run the agent once more to collect step-level metrics');
    }

    if (metrics.length >= 7) {
      console.log('\n🎉 You have enough data for business intelligence!');
      console.log('   View the agent page or call POST /api/v6/insights to generate insights');
    }
  }

  console.log('\n' + '='.repeat(70));
}

const agentId = process.argv[2] || '408d16ab-fe92-46ac-8aa4-55b016dd42df';
checkExecutionCount(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
