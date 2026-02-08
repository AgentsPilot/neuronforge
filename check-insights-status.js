/**
 * Check execution_insights table population status
 * Run with: node check-insights-status.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkInsightsStatus(agentId) {
  console.log('📊 Checking execution_insights table');
  console.log('='.repeat(80));

  // Check all insights
  const { data: allInsights, error: allError } = await supabase
    .from('execution_insights')
    .select('agent_id, insight_type, category, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (allError) {
    console.error('❌ Error:', allError);
    return;
  }

  console.log(`\nTotal insights in database: ${allInsights?.length || 0}`);

  if (allInsights && allInsights.length > 0) {
    console.log('\nRecent insights (all agents):');
    allInsights.forEach((insight, idx) => {
      console.log(`   ${idx + 1}. [${insight.category}] ${insight.insight_type} - ${new Date(insight.created_at).toLocaleString()}`);
    });
  }

  // Check for specific agent
  const { data: agentInsights } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId);

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`Insights for agent ${agentId}: ${agentInsights?.length || 0}`);

  if (agentInsights && agentInsights.length > 0) {
    console.log('\nAgent insights:');
    agentInsights.forEach((insight, idx) => {
      console.log(`\n   ${idx + 1}. [${insight.severity.toUpperCase()}] ${insight.title}`);
      console.log(`      Type: ${insight.insight_type}`);
      console.log(`      Category: ${insight.category}`);
      console.log(`      Status: ${insight.status}`);
      console.log(`      Created: ${new Date(insight.created_at).toLocaleString()}`);
    });
  } else {
    console.log('   ⚠️  No insights found for this agent yet');
  }

  // Check if insights_enabled
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_name, insights_enabled')
    .eq('id', agentId)
    .single();

  if (agent) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Agent: ${agent.agent_name}`);
    const enabled = agent.insights_enabled !== false;
    console.log(`Insights Enabled: ${enabled ? '✅ Yes' : '❌ No'}`);

    if (!enabled) {
      console.log('\n⚠️  Insights are disabled for this agent!');
      console.log('   Enable insights in the agent settings to generate them.');
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('WHEN INSIGHTS ARE GENERATED');
  console.log('='.repeat(80));
  console.log(`
✅ Insights are generated automatically AFTER each agent execution completes.

The flow is:
1. Agent execution completes successfully
2. StateManager.finalizeExecution() is called
3. MetricsCollector.collectMetrics() stores execution_metrics ✅ Working
4. WorkflowPilot.collectInsights() is triggered
5. InsightAnalyzer.analyze() runs pattern detection + business intelligence
6. InsightGenerator.generate() creates insights from patterns
7. Insights are stored in execution_insights table

WHY NO INSIGHTS YET (if none found):
- Backfilled data doesn't trigger insight generation (it's a one-time script)
- Insights are only generated during LIVE agent executions
- Check if insights_enabled is true for the agent
- Check server logs for any errors during insight generation

NEXT STEP:
Run the agent ONE MORE TIME to trigger the insight generation with all the
historical data now available (30 execution_metrics records).

The system will:
- Analyze last 20 executions
- Calculate week-over-week trends (you have 30 data points)
- Generate business intelligence insights
- Generate technical pattern insights
- Store in execution_insights table
- Display on agent page
  `);

  console.log('='.repeat(80));
}

const agentId = process.argv[2] || '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
checkInsightsStatus(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
