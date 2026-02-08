/**
 * Check run_mode values in workflow_executions
 * Run with: node check-run-mode.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRunMode(agentId) {
  console.log('🔍 Checking run_mode in workflow_executions');
  console.log('='.repeat(80));
  console.log(`\nAgent ID: ${agentId}`);

  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select('id, run_mode, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('\n❌ Error:', error);
    return;
  }

  console.log('\n' + '─'.repeat(80));
  console.log('Last 10 Executions:');
  console.log('─'.repeat(80));
  console.log('\n   #   run_mode         | Status      | Created At');
  console.log('   ' + '─'.repeat(70));

  executions.forEach((e, idx) => {
    const mode = e.run_mode || 'NULL';
    const status = e.status || 'unknown';
    const date = new Date(e.created_at).toLocaleString();
    console.log(`   ${(idx + 1).toString().padStart(2)}. ${mode.padEnd(16)} | ${status.padEnd(11)} | ${date}`);
  });

  const prodCount = executions.filter(e => e.run_mode === 'production').length;
  const calibCount = executions.filter(e => e.run_mode === 'calibration').length;
  const testCount = executions.filter(e => e.run_mode === 'test').length;
  const nullCount = executions.filter(e => e.run_mode === null || e.run_mode === undefined).length;

  console.log('\n' + '─'.repeat(80));
  console.log('Summary:');
  console.log('─'.repeat(80));
  console.log(`\n  production:   ${prodCount}`);
  console.log(`  calibration:  ${calibCount}`);
  console.log(`  test:         ${testCount}`);
  console.log(`  NULL:         ${nullCount}`);
  console.log(`  Total:        ${executions.length}`);

  console.log('\n' + '─'.repeat(80));
  console.log('INSIGHT GENERATION');
  console.log('─'.repeat(80));

  if (prodCount === 0) {
    console.log('\n⚠️  No production runs found!');
    console.log('\n   This explains your log:');
    console.log('   "💡 [WorkflowPilot] Agent has 0 production runs"');
    console.log('\n   WorkflowPilot.collectInsights() checks:');
    console.log('   .eq(\'run_mode\', \'production\')');
    console.log('\n   Insights ONLY analyze executions with run_mode=\'production\'.');
    console.log('   Calibration/test runs are excluded to avoid false patterns.');
    console.log('\n✅ SOLUTION:');
    console.log('   Run the agent from the main agent page (not sandbox/test mode).');
    console.log('   OR check how run_mode is being set in the execution.');
  } else {
    console.log(`\n✅ Found ${prodCount} production run(s)`);
    console.log('   Insights should be generated if patterns are detected');
    console.log('\n   If no insights generated, check:');
    console.log('   1. InsightAnalyzer may have found no patterns (healthy agent)');
    console.log('   2. Check server logs for errors in InsightAnalyzer');
    console.log('   3. Need at least 7 production runs for business intelligence');
  }

  console.log('\n' + '='.repeat(80));
}

const agentId = process.argv[2] || '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
checkRunMode(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
