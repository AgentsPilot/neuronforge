/**
 * Check execution types in workflow_executions
 * Run with: node check-execution-types.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkExecutionTypes(agentId) {
  console.log('🔍 Checking Execution Types');
  console.log('='.repeat(80));
  console.log(`\nAgent ID: ${agentId}`);

  // Check workflow_executions table for execution_type
  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select('id, execution_type, status, created_at')
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
  console.log('\n   Type          | Status      | Created At');
  console.log('   ' + '─'.repeat(70));

  executions.forEach((e, idx) => {
    const type = e.execution_type || 'NULL';
    const status = e.status || 'unknown';
    const date = new Date(e.created_at).toLocaleString();
    console.log(`   ${(idx + 1 + '.').padEnd(3)} ${type.padEnd(12)} | ${status.padEnd(11)} | ${date}`);
  });

  const prodCount = executions.filter(e => e.execution_type === 'production').length;
  const calibCount = executions.filter(e => e.execution_type === 'calibration').length;
  const nullCount = executions.filter(e => e.execution_type === null || e.execution_type === undefined).length;

  console.log('\n' + '─'.repeat(80));
  console.log('Summary:');
  console.log('─'.repeat(80));
  console.log(`\n  Production:   ${prodCount}`);
  console.log(`  Calibration:  ${calibCount}`);
  console.log(`  NULL/Other:   ${nullCount}`);
  console.log(`  Total:        ${executions.length}`);

  console.log('\n' + '─'.repeat(80));
  console.log('INSIGHT GENERATION REQUIREMENTS');
  console.log('─'.repeat(80));

  if (prodCount === 0) {
    console.log('\n⚠️  No production executions found!');
    console.log('\n   From your logs:');
    console.log('   "💡 [WorkflowPilot] Agent has 0 production runs"');
    console.log('\n   Insight generation only analyzes PRODUCTION runs.');
    console.log('   Calibration/test runs are excluded to avoid false patterns.');
    console.log('\n✅ SOLUTION:');
    console.log('   Your agent has production_ready=true, but executions are being');
    console.log('   marked as calibration/test instead of production.');
    console.log('\n   Check the execution_type parameter in /api/run-agent route.');
    console.log('   It should be "production" for normal runs, not "calibration".');
  } else {
    console.log(`\n✅ Found ${prodCount} production execution(s)`);
    console.log('   Insights should be generated if patterns are detected');
    console.log('\n   If no insights yet, possible reasons:');
    console.log('   1. No patterns detected (healthy agent)');
    console.log('   2. Error during InsightAnalyzer (check logs)');
    console.log('   3. Need more production runs for trends (min 7 for BI)');
  }

  console.log('\n' + '='.repeat(80));
}

const agentId = process.argv[2] || '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
checkExecutionTypes(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
