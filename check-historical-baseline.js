require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBaseline() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  // Get older metrics (20-30 days ago) for true baseline
  const { data: allMetrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(50);

  if (!allMetrics || allMetrics.length === 0) {
    console.log('No metrics found');
    return;
  }

  console.log('=== BASELINE ANALYSIS ===\n');
  console.log('Total executions:', allMetrics.length, '\n');

  // Group by date to see pattern
  const byDate = {};
  allMetrics.forEach(m => {
    const date = new Date(m.executed_at).toISOString().split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(m);
  });

  console.log('Executions per day:');
  Object.keys(byDate).sort().reverse().slice(0, 10).forEach(date => {
    const dayMetrics = byDate[date];
    const avgTotal = dayMetrics.reduce((sum, m) => sum + m.total_items, 0) / dayMetrics.length;

    // Look at step metrics to find the filter step
    const firstExec = dayMetrics[0];
    if (firstExec.step_metrics) {
      const filterStep = firstExec.step_metrics.find(s =>
        s.step_name.includes('Filter') || s.step_name.includes('New Items')
      );

      const filtered = filterStep ? filterStep.count : 'N/A';
      console.log(date + ': ' + dayMetrics.length + ' runs, avg total=' + avgTotal.toFixed(1) + ', filtered=' + filtered);
    } else {
      console.log(date + ': ' + dayMetrics.length + ' runs, avg total=' + avgTotal.toFixed(1));
    }
  });

  // Check if there's a clear pattern in filtered results
  console.log('\n=== FILTERED RESULTS ANALYSIS ===');
  const withFiltered = allMetrics.filter(m =>
    m.step_metrics && m.step_metrics.some(s => s.step_name.includes('Filter'))
  );

  if (withFiltered.length > 0) {
    const recentFiltered = withFiltered.slice(0, 7).map(m => {
      const step = m.step_metrics.find(s => s.step_name.includes('Filter'));
      return step ? step.count : 0;
    });

    const oldFiltered = withFiltered.slice(20, 27).map(m => {
      const step = m.step_metrics.find(s => s.step_name.includes('Filter'));
      return step ? step.count : 0;
    });

    const recentAvg = recentFiltered.reduce((a,b) => a+b, 0) / recentFiltered.length;
    const oldAvg = oldFiltered.reduce((a,b) => a+b, 0) / oldFiltered.length;

    console.log('Recent (last 7): avg=' + recentAvg.toFixed(1) + ' filtered items');
    console.log('Historical (days 20-27): avg=' + oldAvg.toFixed(1) + ' filtered items');

    if (oldAvg > 0) {
      const change = ((recentAvg / oldAvg - 1) * 100);
      console.log('Change: ' + change.toFixed(1) + '%');

      if (Math.abs(change) > 50) {
        console.log('\n⚠️  SIGNIFICANT CHANGE DETECTED in filtered items!');
        console.log('This is the real business signal, not total items.');
      }
    }
  }

  // Show what step names exist
  console.log('\n=== STEP NAMES IN WORKFLOW ===');
  if (allMetrics[0] && allMetrics[0].step_metrics) {
    allMetrics[0].step_metrics.forEach((step, i) => {
      console.log((i + 1) + '. ' + step.step_name + ' (' + step.plugin + '.' + step.action + ')');
    });
  }
}

checkBaseline().catch(console.error);
