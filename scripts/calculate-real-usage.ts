// scripts/calculate-real-usage.ts
// Calculate what a user can really run with 270,000 LLM tokens/month

import { createClient } from '@supabase/supabase-js';

async function calculateRealUsage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('📊 Real Usage Analysis: 270,000 LLM Tokens/Month\n');
  console.log('═'.repeat(80));

  // Get production execution data
  const { data: executionData, error } = await supabase
    .from('token_usage')
    .select('*')
    .eq('activity_type', 'agent_execution')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!executionData || executionData.length === 0) {
    console.log('⚠️ No execution data found');
    return;
  }

  // Calculate statistics from real production data
  const executionStats = executionData.map(e => ({
    total_tokens: (e.input_tokens || 0) + (e.output_tokens || 0),
    agent_id: e.agent_id
  }));

  const totalTokens = executionStats.reduce((sum, e) => sum + e.total_tokens, 0);
  const avgTokensPerExecution = Math.round(totalTokens / executionStats.length);
  const minTokens = Math.min(...executionStats.map(e => e.total_tokens));
  const maxTokens = Math.max(...executionStats.map(e => e.total_tokens));

  // Calculate median
  const sortedTokens = executionStats.map(e => e.total_tokens).sort((a, b) => a - b);
  const medianTokens = sortedTokens[Math.floor(sortedTokens.length / 2)];

  // Calculate percentiles
  const p25 = sortedTokens[Math.floor(sortedTokens.length * 0.25)];
  const p75 = sortedTokens[Math.floor(sortedTokens.length * 0.75)];
  const p95 = sortedTokens[Math.floor(sortedTokens.length * 0.95)];

  console.log('\n📊 PRODUCTION DATA ANALYSIS');
  console.log('─'.repeat(80));
  console.log(`Sample Size: ${executionStats.length} real agent executions`);
  console.log(`\nTokens per Execution:`);
  console.log(`  Average:    ${avgTokensPerExecution.toLocaleString()} tokens`);
  console.log(`  Median:     ${medianTokens.toLocaleString()} tokens`);
  console.log(`  Min:        ${minTokens.toLocaleString()} tokens`);
  console.log(`  Max:        ${maxTokens.toLocaleString()} tokens`);
  console.log(`  25th %ile:  ${p25.toLocaleString()} tokens`);
  console.log(`  75th %ile:  ${p75.toLocaleString()} tokens`);
  console.log(`  95th %ile:  ${p95.toLocaleString()} tokens`);

  const monthlyBudget = 270000;

  console.log('\n\n💡 WHAT YOU CAN REALLY RUN WITH 270,000 TOKENS/MONTH');
  console.log('═'.repeat(80));

  // Scenario 1: Using Average
  const executionsAvg = Math.floor(monthlyBudget / avgTokensPerExecution);
  const executionsPerDayAvg = Math.floor(executionsAvg / 30);
  console.log(`\n📈 AVERAGE USAGE SCENARIO (${avgTokensPerExecution} tokens/exec)`);
  console.log(`─`.repeat(80));
  console.log(`  Total Executions/Month:  ${executionsAvg.toLocaleString()} runs`);
  console.log(`  Executions/Day:          ${executionsPerDayAvg.toLocaleString()} runs/day`);
  console.log(`  Executions/Week:         ${Math.floor(executionsAvg / 4).toLocaleString()} runs/week`);

  // Scenario 2: Using Median (more realistic)
  const executionsMedian = Math.floor(monthlyBudget / medianTokens);
  const executionsPerDayMedian = Math.floor(executionsMedian / 30);
  console.log(`\n📊 MEDIAN USAGE SCENARIO (${medianTokens} tokens/exec) - MOST REALISTIC`);
  console.log(`─`.repeat(80));
  console.log(`  Total Executions/Month:  ${executionsMedian.toLocaleString()} runs`);
  console.log(`  Executions/Day:          ${executionsPerDayMedian.toLocaleString()} runs/day`);
  console.log(`  Executions/Week:         ${Math.floor(executionsMedian / 4).toLocaleString()} runs/week`);

  // Scenario 3: Conservative (75th percentile - heavier usage)
  const executionsP75 = Math.floor(monthlyBudget / p75);
  const executionsPerDayP75 = Math.floor(executionsP75 / 30);
  console.log(`\n🔥 HEAVY USAGE SCENARIO (${p75} tokens/exec - 75th percentile)`);
  console.log(`─`.repeat(80));
  console.log(`  Total Executions/Month:  ${executionsP75.toLocaleString()} runs`);
  console.log(`  Executions/Day:          ${executionsPerDayP75.toLocaleString()} runs/day`);
  console.log(`  Executions/Week:         ${Math.floor(executionsP75 / 4).toLocaleString()} runs/week`);

  // Scenario 4: Worst case (95th percentile)
  const executionsP95 = Math.floor(monthlyBudget / p95);
  const executionsPerDayP95 = Math.floor(executionsP95 / 30);
  console.log(`\n⚠️  WORST CASE SCENARIO (${p95} tokens/exec - 95th percentile)`);
  console.log(`─`.repeat(80));
  console.log(`  Total Executions/Month:  ${executionsP95.toLocaleString()} runs`);
  console.log(`  Executions/Day:          ${executionsPerDayP95.toLocaleString()} runs/day`);
  console.log(`  Executions/Week:         ${Math.floor(executionsP95 / 4).toLocaleString()} runs/week`);

  // Multi-agent scenarios
  console.log('\n\n🤖 MULTI-AGENT SCENARIOS (using median: ${medianTokens} tokens/exec)');
  console.log('═'.repeat(80));

  const agentCounts = [1, 3, 5, 10, 20];
  agentCounts.forEach(agentCount => {
    const executionsPerAgent = Math.floor(executionsMedian / agentCount);
    const executionsPerAgentPerDay = Math.floor(executionsPerAgent / 30);
    console.log(`\n  ${agentCount} Agent${agentCount > 1 ? 's' : ' '}:`);
    console.log(`    ${executionsPerAgent.toLocaleString()} total runs/month (${executionsPerAgentPerDay}/day per agent)`);
  });

  // Real-world usage patterns
  console.log('\n\n🌍 REAL-WORLD USAGE PATTERNS');
  console.log('═'.repeat(80));
  console.log(`\nLight User (1-2 agents, daily checks):`);
  console.log(`  2 agents × 30 runs/month = 60 runs → ${(60 * medianTokens).toLocaleString()} tokens`);
  console.log(`  Budget Remaining: ${(monthlyBudget - (60 * medianTokens)).toLocaleString()} tokens (${Math.floor((monthlyBudget - (60 * medianTokens)) / monthlyBudget * 100)}%)`);

  console.log(`\nMedium User (5 agents, regular automation):`);
  console.log(`  5 agents × 30 runs/month = 150 runs → ${(150 * medianTokens).toLocaleString()} tokens`);
  console.log(`  Budget Remaining: ${(monthlyBudget - (150 * medianTokens)).toLocaleString()} tokens (${Math.floor((monthlyBudget - (150 * medianTokens)) / monthlyBudget * 100)}%)`);

  console.log(`\nHeavy User (10 agents, daily automation):`);
  console.log(`  10 agents × 45 runs/month = 450 runs → ${(450 * medianTokens).toLocaleString()} tokens`);
  console.log(`  Budget Remaining: ${(monthlyBudget - (450 * medianTokens)).toLocaleString()} tokens (${Math.floor((monthlyBudget - (450 * medianTokens)) / monthlyBudget * 100)}%)`);

  console.log(`\nPower User (20 agents, hourly automation):`);
  console.log(`  20 agents × 60 runs/month = 1,200 runs → ${(1200 * medianTokens).toLocaleString()} tokens`);
  if ((1200 * medianTokens) > monthlyBudget) {
    console.log(`  ⚠️  OVER BUDGET by ${((1200 * medianTokens) - monthlyBudget).toLocaleString()} tokens!`);
  } else {
    console.log(`  Budget Remaining: ${(monthlyBudget - (1200 * medianTokens)).toLocaleString()} tokens (${Math.floor((monthlyBudget - (1200 * medianTokens)) / monthlyBudget * 100)}%)`);
  }

  console.log('\n\n💰 PILOT CREDITS CONVERSION');
  console.log('═'.repeat(80));
  console.log(`270,000 LLM tokens = ${(monthlyBudget / 10).toLocaleString()} Pilot Credits`);
  console.log(`At $0.001 per credit = $${(monthlyBudget / 10 * 0.001).toFixed(2)}/month\n`);
}

calculateRealUsage().catch(console.error);
