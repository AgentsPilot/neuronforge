/**
 * Check agent production_ready status
 * Run with: node check-agent-production-status.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAgentStatus(agentId) {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('agent_name, production_ready, insights_enabled')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('🔍 Agent Status Check');
  console.log('='.repeat(80));
  console.log(`\nAgent: ${agent.agent_name}`);
  console.log(`Agent ID: ${agentId}`);
  console.log(`\nproduction_ready: ${agent.production_ready || false}`);
  console.log(`insights_enabled: ${agent.insights_enabled !== false}`);

  console.log(`\n${'─'.repeat(80)}`);
  console.log('INSIGHTS GENERATION REQUIREMENTS');
  console.log('─'.repeat(80));

  const prodReady = agent.production_ready || false;
  const insightsEnabled = agent.insights_enabled !== false;

  console.log(`\n✅ Required for insights generation:`);
  console.log(`   1. production_ready = true  ${prodReady ? '✅' : '❌ (currently: false)'}`);
  console.log(`   2. insights_enabled = true  ${insightsEnabled ? '✅' : '❌ (currently: false)'}`);

  console.log(`\n${'─'.repeat(80)}`);
  console.log('DIAGNOSIS & SOLUTION');
  console.log('─'.repeat(80));

  if (!prodReady) {
    console.log(`
❌ ISSUE: Agent is in CALIBRATION mode

   From your logs:
   "💡 [WorkflowPilot] Insights NOT collected. Reasons: production_ready=false"

   In calibration mode, insights are intentionally disabled because:
   - The agent is still being tested
   - Patterns may not be representative
   - Workflow may still have issues

✅ SOLUTION:
   1. Go to the agent page in the UI
   2. Approve the agent to move it to production
   3. Run the agent again
   4. Insights will be generated automatically

   After approval:
   - production_ready will be set to true
   - Insights will be generated after each execution
   - Business intelligence will analyze your 30 execution_metrics records
    `);
  } else if (!insightsEnabled) {
    console.log(`
❌ ISSUE: Insights are disabled for this agent

✅ SOLUTION:
   1. Go to agent settings in the UI
   2. Enable insights
   3. Run the agent again
    `);
  } else {
    console.log(`
✅ Agent is properly configured for insights!

   Insights should be generated on next execution.
   If they're still not generating, check server logs for errors.
    `);
  }

  console.log('='.repeat(80));
}

const agentId = process.argv[2] || '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
checkAgentStatus(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
