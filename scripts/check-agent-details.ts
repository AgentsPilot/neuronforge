import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = 'a27cf5db-915c-41dc-90d1-930a58b3f16c';

(async () => {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, connected_plugins, mode, user_prompt, system_prompt')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('🤖 Agent Details:');
    console.log('Name:', agent.agent_name);
    console.log('Mode:', agent.mode);
    console.log('Connected Plugins:', agent.connected_plugins);
    console.log('Plugin Count:', agent.connected_plugins?.length || 0);
    console.log('\nUser Prompt:', agent.user_prompt?.substring(0, 200));
    console.log('\nSystem Prompt:', agent.system_prompt?.substring(0, 300));
  }

  // Check execution logs
  const { data: logs } = await supabase
    .from('agent_logs')
    .select('id, execution_status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n\n📊 Recent Executions:');
  logs?.forEach(log => {
    console.log(`- ${log.created_at}: ${log.execution_status}`);
  });

  // Calculate what our model predicts
  const pluginCount = agent?.connected_plugins?.length || 0;
  console.log('\n\n🔮 Pricing Model Prediction:');
  console.log(`Plugin count: ${pluginCount}`);

  // AIS score based on plugin count (from our model)
  let aisScore = 2.2;
  if (pluginCount <= 1) aisScore = 1.2;
  else if (pluginCount === 2) aisScore = 1.6;
  else if (pluginCount <= 4) aisScore = 2.2;
  else if (pluginCount <= 6) aisScore = 2.8;
  else if (pluginCount <= 8) aisScore = 3.5;
  else aisScore = 4.0;

  console.log(`AIS Score: ${aisScore}`);

  // OpenAI Model formula
  const BASE = 250;
  const PLUGIN_OVERHEAD = 15;
  const SYS = 10;

  const predictedCreditsPerRun = Math.round(
    (BASE + (pluginCount * PLUGIN_OVERHEAD) + SYS) * aisScore
  );

  console.log(`Predicted credits per run: ${predictedCreditsPerRun}`);
  console.log(`Predicted tokens per run: ${predictedCreditsPerRun * 10}`);

  // Actual usage from token_usage table - ALL activities for ONE complete run
  const { data: allTokenData } = await supabase
    .from('token_usage')
    .select('activity_type, feature, input_tokens, output_tokens')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true });

  if (allTokenData && allTokenData.length > 0) {
    console.log('\n\n📈 Actual Usage Breakdown:');

    // Group by activity type
    const creationTokens: number[] = [];
    const executionTokens: number[] = [];

    allTokenData.forEach((record) => {
      const totalTokens = (record.input_tokens || 0) + (record.output_tokens || 0);
      const pilotCredits = Math.ceil(totalTokens / 10);

      if (record.activity_type === 'agent_creation' || record.activity_type === 'agent_generation') {
        creationTokens.push(totalTokens);
        console.log(`  [Creation] ${record.feature}: ${totalTokens} tokens = ${pilotCredits} Pilot Credits`);
      } else if (record.activity_type === 'agent_execution') {
        executionTokens.push(totalTokens);
        console.log(`  [Execution] ${record.feature}: ${totalTokens} tokens = ${pilotCredits} Pilot Credits`);
      }
    });

    const totalCreationTokens = creationTokens.reduce((sum, t) => sum + t, 0);
    const totalExecutionTokens = executionTokens.reduce((sum, t) => sum + t, 0);
    const totalAllTokens = totalCreationTokens + totalExecutionTokens;

    const creationCredits = Math.ceil(totalCreationTokens / 10);
    const executionCredits = Math.ceil(totalExecutionTokens / 10);
    const totalCredits = Math.ceil(totalAllTokens / 10);

    console.log('\n📊 Summary:');
    console.log(`  Agent Creation: ${totalCreationTokens} tokens = ${creationCredits} Pilot Credits`);
    console.log(`  Agent Execution (${executionTokens.length} steps): ${totalExecutionTokens} tokens = ${executionCredits} Pilot Credits`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  TOTAL PER RUN: ${totalAllTokens} tokens = ${totalCredits} Pilot Credits`);

    console.log(`\n⚠️  Model Prediction vs Reality:`);
    console.log(`  Predicted (execution only): ${predictedCreditsPerRun} Pilot Credits`);
    console.log(`  Actual (execution only): ${executionCredits} Pilot Credits`);
    console.log(`  Execution accuracy: ${(predictedCreditsPerRun / executionCredits * 100).toFixed(1)}%`);
    console.log(`\n  ❌ MISSING FROM MODEL: Agent creation (${creationCredits} credits)`);
    console.log(`  Total actual cost: ${totalCredits} Pilot Credits`);
    console.log(`  Factor: ${(totalCredits / predictedCreditsPerRun).toFixed(2)}x higher than predicted`);
  }
})();
