require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPatterns() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(30);

  if (!metrics || metrics.length === 0) {
    console.log('No execution metrics found');
    return;
  }

  console.log('Found ' + metrics.length + ' execution metrics\n');

  const recent7 = metrics.slice(0, 7);
  const historical = metrics.slice(7, 20);

  const recentAvg = recent7.reduce((sum, m) => sum + (m.total_items || 0), 0) / recent7.length;
  const historicalAvg = historical.reduce((sum, m) => sum + (m.total_items || 0), 0) / historical.length;
  const change = ((recentAvg / historicalAvg) - 1) * 100;

  console.log('VOLUME TREND:');
  console.log('  Recent avg: ' + recentAvg.toFixed(1) + ' items');
  console.log('  Historical avg: ' + historicalAvg.toFixed(1) + ' items');
  console.log('  Change: ' + (change > 0 ? '+' : '') + change.toFixed(1) + '%\n');

  const recentDuration = recent7.reduce((sum, m) => sum + (m.duration_ms || 0), 0) / recent7.length;
  const historicalDuration = historical.reduce((sum, m) => sum + (m.duration_ms || 0), 0) / historical.length;
  const durationChange = ((recentDuration / historicalDuration) - 1) * 100;

  console.log('PERFORMANCE TREND:');
  console.log('  Recent avg: ' + (recentDuration / 1000).toFixed(1) + 's');
  console.log('  Historical avg: ' + (historicalDuration / 1000).toFixed(1) + 's');
  console.log('  Change: ' + (durationChange > 0 ? '+' : '') + durationChange.toFixed(1) + '%\n');

  const emptyCount = recent7.filter(m => m.has_empty_results).length;
  const emptyRate = (emptyCount / recent7.length) * 100;

  console.log('EMPTY RESULTS:');
  console.log('  Recent empty rate: ' + emptyRate.toFixed(1) + '% (' + emptyCount + '/' + recent7.length + ')\n');

  console.log('EXPECTED INSIGHTS:');
  
  if (Math.abs(change) > 15) {
    console.log('  Volume change: ' + (change > 0 ? 'increased' : 'decreased') + ' ' + Math.abs(change).toFixed(1) + '%');
  }
  
  if (Math.abs(durationChange) > 10) {
    console.log('  Performance: ' + (durationChange > 0 ? 'slower' : 'faster') + ' by ' + Math.abs(durationChange).toFixed(1) + '%');
  }
  
  if (emptyRate > 50) {
    console.log('  High empty result rate: ' + emptyRate.toFixed(1) + '%');
  }
}

checkPatterns();
