/**
 * Check status of latest execution
 * Run with: node check-latest-execution-status.js <executionId>
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLatestExecution(executionId) {
  console.log('🔍 Checking Execution Status');
  console.log('='.repeat(80));
  console.log(`\nExecution ID: ${executionId}`);

  // Check execution_metrics
  const { data: metrics, error: metricsError } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', executionId)
    .single();

  console.log('\n' + '─'.repeat(80));
  console.log('STEP 1: Execution Metrics');
  console.log('─'.repeat(80));

  if (metricsError && metricsError.code !== 'PGRST116') {
    console.log('❌ Error:', metricsError);
  } else if (!metrics) {
    console.log('❌ No execution_metrics found');
    console.log('   MetricsCollector may not have run yet');
  } else {
    console.log('✅ execution_metrics created');
    console.log(`   Total items: ${metrics.total_items}`);
    console.log(`   Step metrics count: ${metrics.step_metrics?.length || 0}`);
    console.log(`   Duration: ${metrics.duration_ms}ms`);
    console.log(`   Empty results: ${metrics.has_empty_results ? 'Yes' : 'No'}`);
  }

  // Check insights for this agent (recent ones)
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();

  const { data: recentInsights, error: insightsError } = await supabase
    .from('execution_insights')
    .select('id, insight_type, category, severity, title, created_at')
    .eq('agent_id', agentId)
    .gte('created_at', oneMinuteAgo);

  console.log('\n' + '─'.repeat(80));
  console.log('STEP 2: Insights Generated (last 60 seconds)');
  console.log('─'.repeat(80));

  if (insightsError) {
    console.log('❌ Error:', insightsError);
  } else if (!recentInsights || recentInsights.length === 0) {
    console.log('⚠️  No insights generated in last 60 seconds');
    console.log('   Insight generation may still be processing (async)');
    console.log('   Or no patterns were detected');
  } else {
    console.log(`✅ ${recentInsights.length} insight(s) generated:\n`);
    recentInsights.forEach((insight, idx) => {
      const categoryLabel = insight.category === 'business_intelligence' ? '📊 Business' : '⚙️ Technical';
      console.log(`   ${idx + 1}. ${categoryLabel} [${insight.severity.toUpperCase()}]`);
      console.log(`      ${insight.title}`);
      console.log(`      Type: ${insight.insight_type}`);
      console.log(`      Created: ${new Date(insight.created_at).toLocaleString()}`);
      console.log();
    });
  }

  // Overall status
  console.log('─'.repeat(80));
  console.log('OVERALL STATUS');
  console.log('─'.repeat(80));

  if (metrics && recentInsights && recentInsights.length > 0) {
    console.log('\n✅ COMPLETE - Execution metrics AND insights created');
    console.log('   The business intelligence system is working end-to-end!');
  } else if (metrics && (!recentInsights || recentInsights.length === 0)) {
    console.log('\n⏳ PARTIAL - Execution metrics created, but insights not yet generated');
    console.log('\nPossible reasons:');
    console.log('   1. Insight generation is async and still processing (wait 5-10 seconds)');
    console.log('   2. No patterns detected (healthy agent with no issues)');
    console.log('   3. Error during insight generation (check server logs)');
    console.log('\nTo check:');
    console.log('   - Wait a few seconds and run: node check-insights-status.js');
    console.log('   - Check server logs for insight generation errors');
    console.log('   - Verify InsightAnalyzer completed successfully');
  } else {
    console.log('\n❌ FAILED - No execution metrics found');
    console.log('   MetricsCollector did not run or failed');
  }

  console.log('\n' + '='.repeat(80));
}

const executionId = process.argv[2] || 'bdadec9c-8606-4789-be4a-94279919ce52';
checkLatestExecution(executionId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
