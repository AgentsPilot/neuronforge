import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AgentAnalysis {
  agentId: string;
  agentName: string;
  pluginCount: number;
  aisScore: number;
  predictedCreditsPerRun: number;
  actualCreationCredits: number;
  actualExecutionCredits: number;
  actualTotalCredits: number;
  executionSteps: number;
}

const getAisScore = (pluginCount: number): number => {
  if (pluginCount <= 1) return 1.2;
  if (pluginCount === 2) return 1.6;
  if (pluginCount <= 4) return 2.2;
  if (pluginCount <= 6) return 2.8;
  if (pluginCount <= 8) return 3.5;
  return 4.0;
};

(async () => {
  console.log('🔍 Analyzing all agents with token usage data...\n');

  // Get all agents that have token usage records
  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, agent_name, connected_plugins')
    .not('connected_plugins', 'is', null);

  if (agentsError || !agents) {
    console.error('Error fetching agents:', agentsError);
    return;
  }

  console.log(`Found ${agents.length} agents with plugins configured.\n`);

  const analyses: AgentAnalysis[] = [];

  for (const agent of agents) {
    const pluginCount = agent.connected_plugins?.length || 0;

    // Get token usage for this agent
    const { data: tokenData } = await supabase
      .from('token_usage')
      .select('activity_type, feature, input_tokens, output_tokens')
      .eq('agent_id', agent.id)
      .order('created_at', { ascending: true });

    if (!tokenData || tokenData.length === 0) {
      continue; // Skip agents without usage data
    }

    // Separate creation and execution tokens
    let creationTokens = 0;
    let executionTokens = 0;
    let executionSteps = 0;

    tokenData.forEach((record) => {
      const totalTokens = (record.input_tokens || 0) + (record.output_tokens || 0);

      if (record.activity_type === 'agent_creation' || record.activity_type === 'agent_generation') {
        creationTokens += totalTokens;
      } else if (record.activity_type === 'agent_execution') {
        executionTokens += totalTokens;
        executionSteps++;
      }
    });

    const aisScore = getAisScore(pluginCount);
    const BASE = 250;
    const PLUGIN_OVERHEAD = 15;
    const SYS = 10;
    const predictedCreditsPerRun = Math.round((BASE + (pluginCount * PLUGIN_OVERHEAD) + SYS) * aisScore);

    analyses.push({
      agentId: agent.id,
      agentName: agent.agent_name,
      pluginCount,
      aisScore,
      predictedCreditsPerRun,
      actualCreationCredits: Math.ceil(creationTokens / 10),
      actualExecutionCredits: Math.ceil(executionTokens / 10),
      actualTotalCredits: Math.ceil((creationTokens + executionTokens) / 10),
      executionSteps
    });
  }

  if (analyses.length === 0) {
    console.log('❌ No agents found with token usage data.');
    return;
  }

  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  analyses.forEach((analysis, i) => {
    console.log(`Agent ${i + 1}: ${analysis.agentName}`);
    console.log(`  ID: ${analysis.agentId}`);
    console.log(`  Plugins: ${analysis.pluginCount} | AIS Score: ${analysis.aisScore}`);
    console.log(`  Execution Steps: ${analysis.executionSteps}`);
    console.log(`\n  💰 Cost Breakdown:`);
    console.log(`    Creation (one-time): ${analysis.actualCreationCredits} Pilot Credits`);
    console.log(`    Execution: ${analysis.actualExecutionCredits} Pilot Credits`);
    console.log(`    Total: ${analysis.actualTotalCredits} Pilot Credits`);
    console.log(`\n  📊 Model Comparison:`);
    console.log(`    Predicted (execution only): ${analysis.predictedCreditsPerRun} credits`);
    console.log(`    Actual execution: ${analysis.actualExecutionCredits} credits`);
    console.log(`    Execution accuracy: ${((analysis.predictedCreditsPerRun / analysis.actualExecutionCredits) * 100).toFixed(1)}%`);
    console.log(`    Multiplier: ${(analysis.actualExecutionCredits / analysis.predictedCreditsPerRun).toFixed(2)}x`);
    console.log('\n───────────────────────────────────────────────────────────────────────────\n');
  });

  // Calculate averages
  const avgCreationCredits = Math.round(
    analyses.reduce((sum, a) => sum + a.actualCreationCredits, 0) / analyses.length
  );
  const avgExecutionMultiplier =
    analyses.reduce((sum, a) => sum + (a.actualExecutionCredits / a.predictedCreditsPerRun), 0) / analyses.length;
  const avgExecutionSteps =
    analyses.reduce((sum, a) => sum + a.executionSteps, 0) / analyses.length;

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('📈 SUMMARY STATISTICS');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
  console.log(`  Total agents analyzed: ${analyses.length}`);
  console.log(`  Average creation cost: ${avgCreationCredits} Pilot Credits`);
  console.log(`  Average execution steps: ${avgExecutionSteps.toFixed(1)}`);
  console.log(`  Average execution multiplier: ${avgExecutionMultiplier.toFixed(2)}x`);
  console.log(`\n  📐 Recommended Formula:`);
  console.log(`    Creation cost = ${avgCreationCredits} credits (one-time)`);
  console.log(`    Execution cost = ((BASE + plugins×15 + 10) × AIS) × ${avgExecutionMultiplier.toFixed(2)}`);
  console.log(`\n  💡 Example (5 agents, 3 plugins, 15 runs/month):`);

  const examplePlugins = 3;
  const exampleAIS = getAisScore(examplePlugins);
  const exampleBase = (250 + (examplePlugins * 15) + 10) * exampleAIS;
  const exampleExecution = Math.round(exampleBase * avgExecutionMultiplier);
  const exampleMonthly = avgCreationCredits + (15 * exampleExecution);

  console.log(`    Creation: ${avgCreationCredits} credits`);
  console.log(`    Per execution: ${exampleExecution} credits`);
  console.log(`    Monthly (1 agent): ${exampleMonthly} credits`);
  console.log(`    Monthly (5 agents): ${exampleMonthly * 5} credits`);
  console.log(`    Monthly cost: $${(exampleMonthly * 5 * 0.00048).toFixed(2)}`);
})();
