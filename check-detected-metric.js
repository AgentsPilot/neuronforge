require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMetric() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  
  // Get latest insight pattern_data to see detected metric
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('pattern_data')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (insights && insights[0] && insights[0].pattern_data) {
    console.log('LATEST INSIGHT PATTERN DATA:');
    console.log(JSON.stringify(insights[0].pattern_data, null, 2));
  } else {
    console.log('No insights found with pattern_data');
  }

  // Check execution_metrics step_metrics
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(3);

  if (metrics && metrics.length > 0) {
    console.log('\nLATEST EXECUTION METRICS:');
    metrics.forEach((m, i) => {
      console.log('\n#' + (i+1) + ' - ' + m.executed_at);
      console.log('  total_items: ' + m.total_items);
      if (m.step_metrics && m.step_metrics.length > 0) {
        console.log('  step_metrics:');
        m.step_metrics.forEach(s => {
          console.log('    - ' + s.step_name + ': ' + s.count + ' items');
        });
      } else {
        console.log('  step_metrics: MISSING');
      }
    });
  }
}

checkMetric();
