/**
 * Check if agent has enough executions for business insights
 * Run with: node check-insights-readiness.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkInsightsReadiness(agentId) {
  console.log('🔍 Checking insights readiness for agent:', agentId);
  console.log('='.repeat(70));

  // Count execution metrics
  const { data: metrics, error } = await supabase
    .from('execution_metrics')
    .select('id, executed_at, total_items, has_empty_results, failed_step_count')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false });

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log(`\n📊 Execution Metrics Summary:`);
  console.log(`   Total executions: ${metrics.length}`);
  console.log(`   Required for business insights: 7`);
  console.log(`   Status: ${metrics.length >= 7 ? '✅ READY' : `⏳ NEED ${7 - metrics.length} MORE`}`);

  if (metrics.length > 0) {
    const avgItems = metrics.reduce((sum, m) => sum + (m.total_items || 0), 0) / metrics.length;
    const emptyCount = metrics.filter(m => m.has_empty_results).length;
    const failedCount = metrics.filter(m => m.failed_step_count > 0).length;

    console.log(`\n📈 Execution Statistics:`);
    console.log(`   Average items per execution: ${avgItems.toFixed(1)}`);
    console.log(`   Empty results: ${emptyCount} (${(emptyCount / metrics.length * 100).toFixed(1)}%)`);
    console.log(`   Failed steps: ${failedCount} (${(failedCount / metrics.length * 100).toFixed(1)}%)`);
  }

  console.log(`\n📋 Recent Executions (last 10):`);
  metrics.slice(0, 10).forEach((m, i) => {
    const date = new Date(m.executed_at).toLocaleString();
    const status = m.has_empty_results ? '❌ Empty' : m.failed_step_count > 0 ? '⚠️  Failed' : '✅ Success';
    console.log(`   ${i + 1}. ${date} - ${m.total_items} items ${status}`);
  });

  if (metrics.length >= 7) {
    console.log(`\n✅ Business insights are READY to be generated!`);
    console.log(`   Run the agent page to see insights in the UI.`);
    console.log(`   API endpoint: GET /api/v6/insights?agentId=${agentId}`);
  } else {
    console.log(`\n⏳ Need ${7 - metrics.length} more execution(s) for business insights`);
    console.log(`   Current: ${metrics.length}/7`);
    console.log(`   Once you reach 7, business insights will automatically generate.`);
  }

  console.log('\n' + '='.repeat(70));
}

// Get agent ID from command line or use default
const agentId = process.argv[2] || '408d16ab-fe92-46ac-8aa4-55b016dd42df';

checkInsightsReadiness(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
