// scripts/sync-intensity-from-analytics.ts
// Sync intensity metrics from the comprehensive token_usage analytics table

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function syncIntensityFromAnalytics() {
  console.log('🔄 Syncing intensity metrics from token_usage analytics...\n');

  try {
    // Get all agents with intensity metrics
    const { data: agents, error: agentsError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, user_id');

    if (agentsError) throw new Error(`Failed to fetch agents: ${agentsError.message}`);

    console.log(`📊 Found ${agents?.length || 0} agents to sync\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const agent of agents || []) {
      console.log(`\n🔎 Analyzing agent: ${agent.agent_id}`);

      // Fetch agent details for workflow complexity
      const { data: agentDetails, error: agentError } = await supabase
        .from('agents')
        .select('workflow_steps, plugins_required')
        .eq('id', agent.agent_id)
        .single();

      if (agentError) {
        console.log(`   ⚠️  Could not fetch agent details: ${agentError.message}`);
        skippedCount++;
        continue;
      }

      // Query token_usage for this agent's execution data
      const { data: analytics, error: analyticsError } = await supabase
        .from('token_usage')
        .select('input_tokens, output_tokens, cost_usd, activity_type, latency_ms, success, created_at')
        .eq('agent_id', agent.agent_id)
        .in('activity_type', ['agent_run', 'agent_execution'])
        .order('created_at', { ascending: false })
        .limit(100); // Last 100 executions

      if (analyticsError) {
        console.log(`   ⚠️  Could not fetch analytics: ${analyticsError.message}`);
        skippedCount++;
        continue;
      }

      if (!analytics || analytics.length === 0) {
        console.log(`   ℹ️  No execution analytics found - skipping`);
        skippedCount++;
        continue;
      }

      console.log(`   📝 Found ${analytics.length} execution records in token_usage`);

      // Aggregate the data
      let totalTokens = 0;
      let totalDuration = 0;
      let successfulRuns = 0;
      let totalRuns = analytics.length;
      let peakTokens = 0;
      let totalCost = 0;

      for (const record of analytics) {
        const tokens = (record.input_tokens || 0) + (record.output_tokens || 0);
        totalTokens += tokens;
        peakTokens = Math.max(peakTokens, tokens);
        totalCost += parseFloat(record.cost_usd || 0);

        if (record.success !== false) successfulRuns++;
        if (record.latency_ms) totalDuration += record.latency_ms;
      }

      const avgTokens = totalTokens / totalRuns;
      const avgDuration = totalDuration / totalRuns;
      const successRate = (successfulRuns / totalRuns) * 100;

      // Parse workflow complexity from agent definition
      const workflowSteps = agentDetails.workflow_steps || [];
      const workflowComplexity = {
        steps: workflowSteps.length,
        branches: workflowSteps.filter((s: any) => s.type === 'conditional' || s.type === 'branch').length,
        loops: workflowSteps.filter((s: any) => s.type === 'loop' || s.type === 'iteration').length,
        parallel: workflowSteps.filter((s: any) => s.parallel === true).length,
      };

      // Calculate component scores
      const tokenScore = calculateTokenScore(avgTokens, peakTokens);
      const executionScore = calculateExecutionScore(avgDuration, successRate);
      const pluginScore = calculatePluginScore(agentDetails.plugins_required?.length || 0);
      const workflowScore = calculateWorkflowScore(
        workflowComplexity.steps,
        workflowComplexity.branches,
        workflowComplexity.loops,
        workflowComplexity.parallel
      );

      const intensityScore = (
        tokenScore * 0.35 +
        executionScore * 0.25 +
        pluginScore * 0.25 +
        workflowScore * 0.15
      );

      console.log(`   📊 Calculated from analytics:`);
      console.log(`      - Total Runs: ${totalRuns}`);
      console.log(`      - Avg Tokens: ${avgTokens.toFixed(0)}`);
      console.log(`      - Peak Tokens: ${peakTokens}`);
      console.log(`      - Total Cost: $${totalCost.toFixed(4)}`);
      console.log(`      - Success Rate: ${successRate.toFixed(1)}%`);
      console.log(`      - Intensity Score: ${intensityScore.toFixed(1)}/10`);

      // Update intensity metrics
      const { error: updateError } = await supabase
        .from('agent_intensity_metrics')
        .update({
          intensity_score: Number(intensityScore.toFixed(1)),
          token_complexity_score: Number(tokenScore.toFixed(1)),
          execution_complexity_score: Number(executionScore.toFixed(1)),
          plugin_complexity_score: Number(pluginScore.toFixed(1)),
          workflow_complexity_score: Number(workflowScore.toFixed(1)),
          total_executions: totalRuns,
          successful_executions: successfulRuns,
          failed_executions: totalRuns - successfulRuns,
          total_tokens_used: totalTokens,
          avg_tokens_per_run: Number(avgTokens.toFixed(2)),
          peak_tokens_single_run: peakTokens,
          avg_execution_duration_ms: Math.round(avgDuration),
          success_rate: Number(successRate.toFixed(2)),
          unique_plugins_used: agentDetails.plugins_required?.length || 0,
          workflow_steps_count: workflowComplexity.steps,
          conditional_branches_count: workflowComplexity.branches,
          loop_iterations_count: workflowComplexity.loops,
          parallel_execution_count: workflowComplexity.parallel,
          last_calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('agent_id', agent.agent_id);

      if (updateError) {
        console.log(`   ❌ Failed to update: ${updateError.message}`);
      } else {
        console.log(`   ✅ Successfully synced from analytics`);
        updatedCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Analytics Sync Summary');
    console.log('='.repeat(60));
    console.log(`Total agents: ${agents?.length || 0}`);
    console.log(`✅ Successfully synced: ${updatedCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log('='.repeat(60));
    console.log('\n💡 Tip: This pulls data from your token_usage analytics table,');
    console.log('   which includes ALL agent executions with accurate token counts!');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Helper functions
function normalizeScore(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 10;
}

function calculateTokenScore(avgTokens: number, peakTokens: number): number {
  const volumeScore = normalizeScore(avgTokens, 0, 5000);
  const peakScore = normalizeScore(peakTokens, 0, 10000);
  return Math.min(10, volumeScore * 0.7 + peakScore * 0.3);
}

function calculateExecutionScore(avgDuration: number, successRate: number): number {
  const durationScore = normalizeScore(avgDuration, 0, 30000);
  const failureScore = normalizeScore(100 - successRate, 0, 50);
  return Math.min(10, durationScore * 0.6 + failureScore * 0.4);
}

function calculatePluginScore(pluginCount: number): number {
  return normalizeScore(pluginCount, 0, 10);
}

function calculateWorkflowScore(steps: number, branches: number, loops: number, parallel: number): number {
  const stepsScore = normalizeScore(steps, 0, 20);
  const branchScore = normalizeScore(branches, 0, 10);
  const loopScore = normalizeScore(loops, 0, 50);
  const parallelScore = normalizeScore(parallel, 0, 5);
  return Math.min(10, stepsScore * 0.4 + branchScore * 0.25 + loopScore * 0.20 + parallelScore * 0.15);
}

syncIntensityFromAnalytics()
  .then(() => {
    console.log('\n✨ Sync complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
