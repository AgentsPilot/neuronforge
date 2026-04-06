/**
 * Check execution status values
 * Run with: node check-execution-statuses.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatuses(agentId) {
  console.log('🔍 Checking Execution Status Values');
  console.log('='.repeat(80));
  console.log(`\nAgent ID: ${agentId}`);

  const { data: all, error } = await supabase
    .from('workflow_executions')
    .select('status')
    .eq('agent_id', agentId)
    .limit(20);

  if (error) {
    console.error('\n❌ Error:', error);
    return;
  }

  const statuses = {};
  all.forEach(e => {
    statuses[e.status] = (statuses[e.status] || 0) + 1;
  });

  console.log('\n' + '─'.repeat(80));
  console.log('Status Distribution (last 20 executions):');
  console.log('─'.repeat(80));
  console.log('');
  Object.entries(statuses)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`  ${status.padEnd(15)} : ${count}`);
    });

  console.log('\n' + '─'.repeat(80));
  console.log('INSIGHT ANALYZER STATUS FILTER');
  console.log('─'.repeat(80));

  console.log('\nInsightAnalyzer queries for these statuses:');
  console.log('  .in(\'status\', [\'success\', \'failed\', \'timeout\'])');

  const hasSuccess = statuses['success'] > 0;
  const hasFailed = statuses['failed'] > 0;
  const hasTimeout = statuses['timeout'] > 0;
  const hasCompleted = statuses['completed'] > 0;

  console.log('\nYour executions have:');
  console.log(`  ✓ success:   ${hasSuccess ? 'YES' : 'NO'} (${statuses['success'] || 0})`);
  console.log(`  ✓ failed:    ${hasFailed ? 'YES' : 'NO'} (${statuses['failed'] || 0})`);
  console.log(`  ✓ timeout:   ${hasTimeout ? 'YES' : 'NO'} (${statuses['timeout'] || 0})`);
  console.log(`  ✗ completed: ${hasCompleted ? 'YES' : 'NO'} (${statuses['completed'] || 0})`);

  console.log('\n' + '─'.repeat(80));
  console.log('DIAGNOSIS');
  console.log('─'.repeat(80));

  if (hasCompleted && !hasSuccess) {
    console.log('\n❌ ISSUE FOUND: Status mismatch!');
    console.log('\n   Your executions have status="completed"');
    console.log('   but InsightAnalyzer only queries for status="success"');
    console.log('\n   This means InsightAnalyzer.fetchExecutionSummaries() returns 0 executions,');
    console.log('   so it can\'t detect any patterns, and no insights are generated!');
    console.log('\n✅ SOLUTION:');
    console.log('   Update InsightAnalyzer.ts line 171 to include "completed":');
    console.log('   .in(\'status\', [\'success\', \'completed\', \'failed\', \'timeout\'])');
  } else if (hasSuccess) {
    console.log('\n✅ Status values look correct');
    console.log('   InsightAnalyzer should be able to fetch executions');
    console.log('\n   If no insights generated, check server logs for:');
    console.log('   - Errors in InsightAnalyzer.analyze()');
    console.log('   - "No patterns detected" message');
    console.log('   - Errors in pattern detectors or insight generators');
  } else {
    console.log('\n⚠️  No executions found with expected status values');
    console.log('   This is unusual - check your execution flow');
  }

  console.log('\n' + '='.repeat(80));
}

const agentId = process.argv[2] || '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
checkStatuses(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
