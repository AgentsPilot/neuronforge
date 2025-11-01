// scripts/backfill-intensity-from-history.ts
// Analyze historical agent execution logs and populate intensity metrics retroactively

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

interface HistoricalExecution {
  agent_id: string;
  logs: any;
  execution_duration_ms?: number;
  created_at: string;
}

async function backfillIntensityFromHistory() {
  console.log('🔍 Analyzing historical execution data...\n');

  try {
    // 1. Get all agents with intensity metrics
    const { data: agents, error: agentsError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id, user_id');

    if (agentsError) throw new Error(`Failed to fetch agents: ${agentsError.message}`);

    console.log(`📊 Found ${agents?.length || 0} agents with intensity metrics\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    // 2. For each agent, analyze their execution history
    for (const agent of agents || []) {
      console.log(`\n🔎 Analyzing agent: ${agent.agent_id}`);

      // Get execution history from agent_executions (newer table)
      const { data: executions, error: execError } = await supabase
        .from('agent_executions')
        .select('logs, execution_duration_ms, created_at, status')
        .eq('agent_id', agent.agent_id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(50); // Analyze last 50 executions

      if (execError) {
        console.log(`   ⚠️  Could not fetch agent_executions: ${execError.message}`);
      }

      // Only use agent_logs if agent_executions is empty (fallback to avoid double-counting)
      let logs = null;
      if (!executions || executions.length === 0) {
        const { data: logsData, error: logsError } = await supabase
          .from('agent_logs')
          .select('full_output, created_at')
          .eq('agent_id', agent.agent_id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (logsError) {
          console.log(`   ⚠️  Could not fetch agent_logs: ${logsError.message}`);
        } else {
          logs = logsData;
        }
      }

      const executionCount = (executions?.length || 0) + (logs?.length || 0);

      if (executionCount === 0) {
        console.log(`   ℹ️  No execution history found - skipping`);
        skippedCount++;
        continue;
      }

      console.log(`   📝 Found ${executionCount} historical executions`);

      // Analyze the historical data
      let totalTokens = 0;
      let totalDuration = 0;
      let successfulRuns = 0;
      let totalRuns = 0;
      let peakTokens = 0;
      let toolCallsTotal = 0;

      // Parse agent_executions data
      for (const exec of executions || []) {
        totalRuns++;
        if (exec.status === 'completed') successfulRuns++;

        if (exec.execution_duration_ms) {
          totalDuration += exec.execution_duration_ms;
        }

        // Try to extract token data from logs
        if (exec.logs?.tokensUsed) {
          const tokens = exec.logs.tokensUsed.total || exec.logs.tokensUsed;
          totalTokens += tokens;
          peakTokens = Math.max(peakTokens, tokens);
        }

        if (exec.logs?.toolCalls) {
          toolCallsTotal += exec.logs.toolCalls.length || exec.logs.toolCallsCount || 0;
        }
      }

      // Parse agent_logs data (legacy format)
      for (const log of logs || []) {
        totalRuns++;
        successfulRuns++; // If it's in logs, assume it succeeded

        // Try to extract metadata from full_output
        if (log.full_output?.agentkit_metadata?.tokensUsed) {
          const tokens = log.full_output.agentkit_metadata.tokensUsed.total;
          totalTokens += tokens;
          peakTokens = Math.max(peakTokens, tokens);
        }

        if (log.full_output?.agentkit_metadata?.toolCalls) {
          toolCallsTotal += log.full_output.agentkit_metadata.toolCalls.length || 0;
        }
      }

      if (totalRuns === 0) {
        console.log(`   ℹ️  No valid execution data - skipping`);
        skippedCount++;
        continue;
      }

      // Calculate averages
      const avgTokens = totalTokens / totalRuns;
      const avgDuration = totalDuration / totalRuns;
      const successRate = (successfulRuns / totalRuns) * 100;

      // Calculate component scores
      const tokenScore = calculateTokenScore(avgTokens, peakTokens);
      const executionScore = calculateExecutionScore(avgDuration, successRate);
      const pluginScore = calculatePluginScore(toolCallsTotal / totalRuns);
      const workflowScore = 5.0; // Default, can't determine from logs

      // Calculate overall intensity
      const intensityScore = (
        tokenScore * 0.35 +
        executionScore * 0.25 +
        pluginScore * 0.25 +
        workflowScore * 0.15
      );

      console.log(`   📊 Calculated metrics:`);
      console.log(`      - Total Runs: ${totalRuns}`);
      console.log(`      - Avg Tokens: ${avgTokens.toFixed(0)}`);
      console.log(`      - Peak Tokens: ${peakTokens}`);
      console.log(`      - Success Rate: ${successRate.toFixed(1)}%`);
      console.log(`      - Intensity Score: ${intensityScore.toFixed(1)}/10`);

      // Update the database
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
          total_plugin_calls: toolCallsTotal,
          avg_plugins_per_run: Number((toolCallsTotal / totalRuns).toFixed(2)),
          success_rate: Number(successRate.toFixed(2)),
          last_calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('agent_id', agent.agent_id);

      if (updateError) {
        console.log(`   ❌ Failed to update: ${updateError.message}`);
      } else {
        console.log(`   ✅ Successfully updated intensity metrics`);
        updatedCount++;
      }

      // Small delay to avoid overwhelming DB
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Historical Backfill Summary');
    console.log('='.repeat(60));
    console.log(`Total agents analyzed: ${agents?.length || 0}`);
    console.log(`✅ Successfully updated: ${updatedCount}`);
    console.log(`⏭️  Skipped (no history): ${skippedCount}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Helper functions for score calculation
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

function calculatePluginScore(avgPluginCalls: number): number {
  return Math.min(10, normalizeScore(avgPluginCalls, 0, 8));
}

// Run the backfill
backfillIntensityFromHistory()
  .then(() => {
    console.log('\n✨ Historical backfill complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Unhandled error:', error);
    process.exit(1);
  });
