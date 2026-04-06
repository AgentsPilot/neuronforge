require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkInsightData() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('=== CHECKING INSIGHT DATA SOURCE ===\n');

  // Get the insight
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .eq('title', 'Customer Service Email Volume Surged 420% Recently')
    .single();

  if (!insights) {
    console.log('No insight found');
    return;
  }

  console.log('INSIGHT PATTERN DATA:');
  console.log(JSON.stringify(insights.pattern_data, null, 2));

  // Check execution_metrics to see what was collected
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(10);

  console.log('\n\nRECENT EXECUTION METRICS:');
  if (metrics && metrics.length > 0) {
    metrics.forEach((m, i) => {
      const date = new Date(m.executed_at).toISOString();
      console.log(`\n${i+1}. ${date}`);
      console.log(`   Total items: ${m.total_items}`);
      if (m.step_metrics && m.step_metrics.length > 0) {
        console.log(`   Step breakdown:`);
        m.step_metrics.forEach(step => {
          console.log(`      - ${step.step_name} (${step.plugin}.${step.action}): ${step.count} items`);
        });
      }
    });

    console.log('\n\nSUMMARY:');
    console.log(`Recent average (last 5): ${(metrics.slice(0, 5).reduce((sum, m) => sum + m.total_items, 0) / 5).toFixed(1)} items`);
    console.log(`Historical average (5-10): ${(metrics.slice(5, 10).reduce((sum, m) => sum + m.total_items, 0) / 5).toFixed(1)} items`);
  }
}

checkInsightData().catch(console.error);
