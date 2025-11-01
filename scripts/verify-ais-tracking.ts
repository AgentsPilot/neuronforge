import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 VERIFYING AIS SYSTEM DATA TRACKING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check if agent_intensity_metrics table has data
  const { data: aisData, error: aisError } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .limit(5);

  if (aisError) {
    console.error('❌ Error querying agent_intensity_metrics:', aisError);
    return;
  }

  if (!aisData || aisData.length === 0) {
    console.log('⚠️  No data in agent_intensity_metrics table!');
    console.log('   The AIS system is NOT tracking any agents.\n');
  } else {
    console.log(`✅ Found ${aisData.length} agents in AIS system:\n`);

    aisData.forEach((agent: any) => {
      console.log(`Agent ID: ${agent.agent_id}`);
      console.log(`  Intensity Score: ${agent.intensity_score}`);
      console.log(`  Total Executions: ${agent.total_executions}`);
      console.log(`  Total Tokens: ${agent.total_tokens_used}`);
      console.log(`  Avg Tokens/Run: ${agent.avg_tokens_per_run}`);
      console.log(`  Plugins Used: ${agent.unique_plugins_used}`);
      console.log(`  Avg Plugins/Run: ${agent.avg_plugins_per_run}`);
      console.log(`  Workflow Steps: ${agent.workflow_steps_count}`);
      console.log(`  Last Calculated: ${agent.last_calculated_at || 'Never'}`);
      console.log();
    });
  }

  // Now let's compare with actual token_usage data
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 COMPARING WITH ACTUAL TOKEN USAGE DATA');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const testAgentId = 'a27cf5db-915c-41dc-90d1-930a58b3f16c';

  // Get AIS data for this agent
  const { data: aisAgent } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', testAgentId)
    .single();

  // Get actual token usage
  const { data: tokenUsage } = await supabase
    .from('token_usage')
    .select('activity_type, input_tokens, output_tokens')
    .eq('agent_id', testAgentId);

  console.log(`Test Agent: ${testAgentId}\n`);

  if (aisAgent) {
    console.log('AIS System Reports:');
    console.log(`  Total Tokens: ${aisAgent.total_tokens_used}`);
    console.log(`  Avg Tokens/Run: ${aisAgent.avg_tokens_per_run}`);
    console.log(`  Total Executions: ${aisAgent.total_executions}`);
    console.log(`  Workflow Steps: ${aisAgent.workflow_steps_count}`);
  } else {
    console.log('❌ AIS System: No data tracked for this agent!');
  }

  console.log();

  if (tokenUsage && tokenUsage.length > 0) {
    const creationTokens = tokenUsage
      .filter(t => t.activity_type === 'agent_creation' || t.activity_type === 'agent_generation')
      .reduce((sum, t) => sum + (t.input_tokens || 0) + (t.output_tokens || 0), 0);

    const executionTokens = tokenUsage
      .filter(t => t.activity_type === 'agent_execution')
      .reduce((sum, t) => sum + (t.input_tokens || 0) + (t.output_tokens || 0), 0);

    const executionCount = tokenUsage.filter(t => t.activity_type === 'agent_execution').length;

    console.log('Actual Token Usage:');
    console.log(`  Creation Tokens: ${creationTokens}`);
    console.log(`  Execution Tokens: ${executionTokens}`);
    console.log(`  Execution Steps: ${executionCount}`);
    console.log(`  Total Tokens: ${creationTokens + executionTokens}`);

    if (aisAgent) {
      console.log('\n⚠️  DISCREPANCY CHECK:');
      console.log(`  AIS Total: ${aisAgent.total_tokens_used}`);
      console.log(`  Actual Total: ${creationTokens + executionTokens}`);
      console.log(`  Difference: ${Math.abs(aisAgent.total_tokens_used - (creationTokens + executionTokens))}`);

      if (aisAgent.total_tokens_used !== creationTokens + executionTokens) {
        console.log('  ❌ MISMATCH - AIS is not tracking correctly!');
      } else {
        console.log('  ✅ MATCH - AIS is tracking correctly');
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎯 AIS SYSTEM USAGE CHECK');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check where AIS is being updated
  console.log('Checking if AIS is being updated during agent execution...\n');

  const { data: recentLogs } = await supabase
    .from('agent_logs')
    .select('agent_id, execution_status, created_at')
    .eq('execution_status', 'completed')
    .order('created_at', { ascending: false })
    .limit(3);

  if (recentLogs && recentLogs.length > 0) {
    console.log('Recent completed agent executions:');
    for (const log of recentLogs) {
      const { data: hasAIS } = await supabase
        .from('agent_intensity_metrics')
        .select('agent_id, last_calculated_at')
        .eq('agent_id', log.agent_id)
        .single();

      console.log(`  Agent ${log.agent_id}:`);
      console.log(`    Executed: ${log.created_at}`);
      console.log(`    AIS Updated: ${hasAIS ? hasAIS.last_calculated_at : '❌ Never'}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📋 RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!aisData || aisData.length === 0) {
    console.log('❌ AIS system is NOT tracking agents!');
    console.log('   Action: Integrate AgentIntensityService.updateMetricsFromExecution()');
    console.log('           into agent execution flow');
  } else if (aisAgent && aisAgent.total_tokens_used !== creationTokens + executionTokens) {
    console.log('❌ AIS is tracking, but calculations are wrong!');
    console.log('   Action: Fix the calculation logic in AgentIntensityService');
  } else {
    console.log('✅ AIS system appears to be working correctly');
    console.log('   Next: Verify UI displays this data properly');
  }
})();
