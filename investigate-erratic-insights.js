require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigateErraticInsights() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🚨 INVESTIGATING "ERRATIC BEHAVIOR" INSIGHTS\n');
  console.log('='.repeat(80));

  // Get the two erratic insights
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .ilike('title', '%Inconsistent%')
    .order('created_at', { ascending: false });

  console.log('\n📝 Erratic Insights Found:', insights.length);
  console.log('');

  insights.forEach((insight, idx) => {
    console.log('Insight', idx + 1, ':', insight.title);
    console.log('  Created:', insight.created_at);
    console.log('  Severity:', insight.severity);
    console.log('  Description:', insight.description);
    console.log('');

    if (insight.pattern_data) {
      console.log('  Pattern Data:');
      console.log('    detected_metric:', insight.pattern_data.detected_metric?.step?.step_name);
      console.log('    metric_value_recent:', insight.pattern_data.metric_value_recent);
      console.log('    metric_value_historical:', insight.pattern_data.metric_value_historical);
      console.log('    volume_change_7d:', insight.pattern_data.volume_change_7d);
      console.log('');
    }
  });

  // Check recent execution_metrics to see what data LLM received
  console.log('='.repeat(80));
  console.log('\n📊 What Was in execution_metrics at that time:\n');

  const { data: recentMetrics } = await supabase
    .from('execution_metrics')
    .select('execution_id, executed_at, total_items, step_metrics')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(15);

  console.log('Recent execution_metrics entries:');
  console.log('');

  recentMetrics.forEach((m, idx) => {
    const hasFilterGroup = m.step_metrics?.some(s =>
      s.step_name && s.step_name.toLowerCase().includes('filter group')
    );

    console.log(idx + 1, '.', m.executed_at);
    console.log('   total_items:', m.total_items);
    console.log('   step_metrics count:', m.step_metrics?.length || 0);
    console.log('   Has Filter Group?', hasFilterGroup ? 'YES ✅' : 'NO ❌ (MISSING!)');
    console.log('');
  });

  console.log('='.repeat(80));
  console.log('\n🔍 ROOT CAUSE:\n');
  console.log('If "Filter Group" is MISSING from step_metrics:');
  console.log('  → MetricsCollector is still skipping 0-count steps');
  console.log('  → Our fix was NOT deployed yet');
  console.log('  → LLM sees total_items (95) instead of Filter Group 1 (0)');
  console.log('  → Generates misleading "erratic behavior" insight');
  console.log('');
  console.log('If "Filter Group" is PRESENT:');
  console.log('  → Fix is deployed');
  console.log('  → But insight was generated BEFORE deployment');
  console.log('  → Old cached insight is being shown');
}

investigateErraticInsights().catch(console.error);
