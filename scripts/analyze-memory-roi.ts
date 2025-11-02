// Analyze memory system ROI: Is it saving money or costing money?
import { createClient } from '@supabase/supabase-js';

async function analyzeMemoryROI() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('💰 Memory System ROI Analysis\n');
  console.log('=' .repeat(60));

  // 1. Cost of creating memories (gpt-4o-mini summarization calls)
  const { data: memoryCreationCosts, error: creationError } = await supabase
    .from('ai_analytics')
    .select('cost_usd, input_tokens, output_tokens, created_at')
    .eq('activity_type', 'memory_creation')
    .eq('activity_name', 'summarize_execution');

  const totalMemoryCreationCost = memoryCreationCosts?.reduce((sum, call) => sum + (call.cost_usd || 0), 0) || 0;
  const totalMemoryCreationCalls = memoryCreationCosts?.length || 0;

  console.log('\n📊 MEMORY CREATION COSTS (What we pay):');
  console.log(`  Total summarization calls: ${totalMemoryCreationCalls}`);
  console.log(`  Total cost: $${totalMemoryCreationCost.toFixed(6)}`);
  console.log(`  Average cost per memory: $${totalMemoryCreationCalls > 0 ? (totalMemoryCreationCost / totalMemoryCreationCalls).toFixed(6) : 0}`);

  // 2. Agent execution costs and patterns
  const { data: executions, error: execError } = await supabase
    .from('ai_analytics')
    .select('agent_id, model_name, cost_usd, input_tokens, output_tokens, created_at, activity_name')
    .eq('activity_type', 'agent_execution')
    .order('created_at', { ascending: true })
    .limit(1000);

  if (execError || !executions || executions.length === 0) {
    console.log('\n❌ No agent execution data found');
    return;
  }

  // Group executions by agent
  const agentExecutions: Record<string, any[]> = {};
  executions.forEach(exec => {
    if (!agentExecutions[exec.agent_id]) {
      agentExecutions[exec.agent_id] = [];
    }
    agentExecutions[exec.agent_id].push(exec);
  });

  console.log(`\n🤖 AGENT EXECUTION ANALYSIS:`);
  console.log(`  Total executions analyzed: ${executions.length}`);
  console.log(`  Unique agents: ${Object.keys(agentExecutions).length}`);

  // 3. Check for efficiency patterns in agents with memory
  const { data: memories, error: memError } = await supabase
    .from('run_memories')
    .select('agent_id, run_number, ais_score, execution_time_ms, credits_consumed, created_at, sentiment')
    .order('created_at', { ascending: true });

  if (memories && memories.length > 0) {
    console.log(`\n🧠 MEMORY-ENHANCED AGENTS:`);
    console.log(`  Total memory records: ${memories.length}`);

    // Group by agent and analyze trends
    const agentMemories: Record<string, any[]> = {};
    memories.forEach(mem => {
      if (!agentMemories[mem.agent_id]) {
        agentMemories[mem.agent_id] = [];
      }
      agentMemories[mem.agent_id].push(mem);
    });

    for (const [agentId, agentMems] of Object.entries(agentMemories)) {
      if (agentMems.length < 3) continue; // Need at least 3 runs to see trends

      const sortedMems = agentMems.sort((a, b) => a.run_number - b.run_number);
      const firstRuns = sortedMems.slice(0, Math.ceil(sortedMems.length / 2));
      const laterRuns = sortedMems.slice(Math.ceil(sortedMems.length / 2));

      const avgTimeFirst = firstRuns.reduce((sum, m) => sum + (m.execution_time_ms || 0), 0) / firstRuns.length;
      const avgTimeLater = laterRuns.reduce((sum, m) => sum + (m.execution_time_ms || 0), 0) / laterRuns.length;

      const avgCreditsFirst = firstRuns.reduce((sum, m) => sum + (m.credits_consumed || 0), 0) / firstRuns.length;
      const avgCreditsLater = laterRuns.reduce((sum, m) => sum + (m.credits_consumed || 0), 0) / laterRuns.length;

      const avgAISFirst = firstRuns.reduce((sum, m) => sum + (m.ais_score || 0), 0) / firstRuns.length;
      const avgAISLater = laterRuns.reduce((sum, m) => sum + (m.ais_score || 0), 0) / laterRuns.length;

      const positiveRuns = sortedMems.filter(m => m.sentiment === 'positive').length;
      const negativeRuns = sortedMems.filter(m => m.sentiment === 'negative').length;

      console.log(`\n  Agent: ${agentId.substring(0, 8)}...`);
      console.log(`    Total runs: ${sortedMems.length}`);
      console.log(`    Success rate: ${((positiveRuns / sortedMems.length) * 100).toFixed(1)}%`);

      // Time improvement
      if (avgTimeFirst > 0 && avgTimeLater > 0) {
        const timeImprovement = ((avgTimeFirst - avgTimeLater) / avgTimeFirst) * 100;
        console.log(`    Execution time: ${avgTimeFirst.toFixed(0)}ms → ${avgTimeLater.toFixed(0)}ms (${timeImprovement > 0 ? '↓' : '↑'}${Math.abs(timeImprovement).toFixed(1)}%)`);
      }

      // Credit improvement
      if (avgCreditsFirst > 0 && avgCreditsLater > 0) {
        const creditImprovement = ((avgCreditsFirst - avgCreditsLater) / avgCreditsFirst) * 100;
        console.log(`    Credits/run: ${avgCreditsFirst.toFixed(2)} → ${avgCreditsLater.toFixed(2)} (${creditImprovement > 0 ? '↓' : '↑'}${Math.abs(creditImprovement).toFixed(1)}%)`);
      }

      // AIS score trend
      if (avgAISFirst > 0 && avgAISLater > 0) {
        const aisChange = ((avgAISLater - avgAISFirst) / avgAISFirst) * 100;
        console.log(`    AIS Score: ${avgAISFirst.toFixed(2)} → ${avgAISLater.toFixed(2)} (${aisChange > 0 ? '↑' : '↓'}${Math.abs(aisChange).toFixed(1)}%)`);
      }
    }
  }

  // 4. Calculate theoretical savings from model routing
  const { data: routingDecisions, error: routingError } = await supabase
    .from('ai_analytics')
    .select('model_name, cost_usd, metadata')
    .eq('activity_type', 'agent_execution');

  if (routingDecisions) {
    const cheapModelUses = routingDecisions.filter(r =>
      r.model_name.includes('mini') || r.model_name.includes('3.5')
    ).length;

    const expensiveModelUses = routingDecisions.filter(r =>
      r.model_name.includes('gpt-4') && !r.model_name.includes('mini')
    ).length;

    console.log(`\n🎯 MODEL ROUTING ANALYSIS:`);
    console.log(`  Cost-optimized models: ${cheapModelUses} (${((cheapModelUses / routingDecisions.length) * 100).toFixed(1)}%)`);
    console.log(`  Performance models: ${expensiveModelUses} (${((expensiveModelUses / routingDecisions.length) * 100).toFixed(1)}%)`);

    // Estimate savings if all used expensive model
    const avgCostCheap = routingDecisions
      .filter(r => r.model_name.includes('mini') || r.model_name.includes('3.5'))
      .reduce((sum, r) => sum + (r.cost_usd || 0), 0) / (cheapModelUses || 1);

    const avgCostExpensive = routingDecisions
      .filter(r => r.model_name.includes('gpt-4') && !r.model_name.includes('mini'))
      .reduce((sum, r) => sum + (r.cost_usd || 0), 0) / (expensiveModelUses || 1);

    if (avgCostExpensive > avgCostCheap && cheapModelUses > 0) {
      const savingsPerCheapCall = avgCostExpensive - avgCostCheap;
      const totalSavings = savingsPerCheapCall * cheapModelUses;

      console.log(`  Avg cost (cheap): $${avgCostCheap.toFixed(6)}`);
      console.log(`  Avg cost (expensive): $${avgCostExpensive.toFixed(6)}`);
      console.log(`  Estimated savings from routing: $${totalSavings.toFixed(6)}`);
    }
  }

  // 5. FINAL ROI CALCULATION
  console.log(`\n${'='.repeat(60)}`);
  console.log('💵 BOTTOM LINE:');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Memory system cost: -$${totalMemoryCreationCost.toFixed(6)}`);

  // Calculate theoretical savings (this is approximate)
  const totalExecutionCost = executions.reduce((sum, e) => sum + (e.cost_usd || 0), 0);
  console.log(`  Total execution cost: $${totalExecutionCost.toFixed(6)}`);

  // Memory represents 262 tokens of context - estimate token savings
  const avgMemoryTokens = 262; // from our test
  const avgTokenCost = 0.00000015; // approximate for gpt-4o-mini input
  const potentialSavingsPerExecution = avgMemoryTokens * avgTokenCost;

  // If memory prevents re-doing work or enables better routing
  // Conservative estimate: memory helps 30% of executions save 20% of tokens
  const executionsWithMemory = memories?.length || 0;
  const estimatedTokenSavings = executionsWithMemory * potentialSavingsPerExecution * 0.3 * 0.2;

  console.log(`  Estimated token savings: +$${estimatedTokenSavings.toFixed(6)}`);
  console.log(`  Net impact: ${estimatedTokenSavings > totalMemoryCreationCost ? '✅ POSITIVE' : '❌ NEGATIVE'} ($${(estimatedTokenSavings - totalMemoryCreationCost).toFixed(6)})`);

  console.log(`\n⚠️  NOTE: This is a preliminary analysis. For accurate ROI:`);
  console.log(`  1. Run A/B test: 50 executions with memory, 50 without`);
  console.log(`  2. Track: tokens used, model selected, execution time, success rate`);
  console.log(`  3. Compare: cost per execution, quality of results`);
  console.log(`  4. Measure: how often memory prevents repeated errors`);
}

analyzeMemoryROI().catch(console.error);
