// lib/utils/updateAgentIntensity.ts
// Server-side utility to update agent intensity metrics after execution

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentExecutionData, AgentIntensityMetrics } from '@/lib/types/intensity';
import {
  DEFAULT_INTENSITY_METRICS,
  EXECUTION_WEIGHTS,
  COMBINED_WEIGHTS,
} from '@/lib/types/intensity';
import { AISConfigService, type AISRanges } from '@/lib/services/AISConfigService';

/**
 * Update agent intensity metrics after execution (server-side only)
 * This is a standalone function that doesn't depend on AgentIntensityService
 */
export async function updateAgentIntensityMetrics(
  supabase: SupabaseClient,
  executionData: AgentExecutionData
): Promise<boolean> {
  try {
    // 1. Get existing metrics or create if not exists
    const { data: existing, error: fetchError } = await supabase
      .from('agent_intensity_metrics')
      .select('*')
      .eq('agent_id', executionData.agent_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching intensity metrics:', fetchError);
      return false;
    }

    if (!existing) {
      // Initialize with defaults
      const { error: insertError } = await supabase
        .from('agent_intensity_metrics')
        .insert({
          agent_id: executionData.agent_id,
          user_id: executionData.user_id,
          ...DEFAULT_INTENSITY_METRICS,
        });

      if (insertError) {
        console.error('Error initializing intensity metrics:', insertError);
        return false;
      }

      // Fetch the newly created record
      const { data: newMetrics } = await supabase
        .from('agent_intensity_metrics')
        .select('*')
        .eq('agent_id', executionData.agent_id)
        .single();

      if (!newMetrics) return false;

      // Use the newly created record as existing
      return await updateExistingMetrics(supabase, newMetrics as AgentIntensityMetrics, executionData);
    }

    // 2. Update existing metrics
    return await updateExistingMetrics(supabase, existing as AgentIntensityMetrics, executionData);
  } catch (error) {
    console.error('Exception in updateAgentIntensityMetrics:', error);
    return false;
  }
}

/**
 * Update existing metrics with new execution data
 */
async function updateExistingMetrics(
  supabase: SupabaseClient,
  current: AgentIntensityMetrics,
  execution: AgentExecutionData
): Promise<boolean> {
  // Update execution counts
  const total_executions = current.total_executions + 1;
  const successful_executions = current.successful_executions + (execution.was_successful ? 1 : 0);
  const failed_executions = current.failed_executions + (execution.was_successful ? 0 : 1);

  // Update token statistics
  const total_tokens_used = current.total_tokens_used + execution.tokens_used;
  const avg_tokens_per_run = total_tokens_used / total_executions;
  const peak_tokens_single_run = Math.max(current.peak_tokens_single_run, execution.tokens_used);

  const input_output_ratio = execution.input_tokens && execution.output_tokens
    ? execution.output_tokens / execution.input_tokens
    : current.input_output_ratio;

  // Update execution statistics
  const total_iterations = current.total_iterations + execution.iterations_count;
  const avg_iterations_per_run = total_iterations / total_executions;

  const avg_execution_duration_ms = Math.round(
    (current.avg_execution_duration_ms * current.total_executions + execution.execution_duration_ms) / total_executions
  );
  const peak_execution_duration_ms = Math.max(current.peak_execution_duration_ms, execution.execution_duration_ms);

  // Update plugin statistics
  const total_plugin_calls = current.total_plugin_calls + execution.tool_calls_count;
  const unique_plugins_used = Math.max(current.unique_plugins_used, execution.plugins_used.length);
  const avg_plugins_per_run = execution.plugins_used.length > 0
    ? ((current.avg_plugins_per_run * current.total_executions) + execution.plugins_used.length) / total_executions
    : current.avg_plugins_per_run;

  const tool_orchestration_overhead_ms = execution.tool_orchestration_time_ms
    ? Math.round(((current.tool_orchestration_overhead_ms * current.total_executions) + execution.tool_orchestration_time_ms) / total_executions)
    : current.tool_orchestration_overhead_ms;

  // Update workflow statistics
  const workflow_steps_count = execution.workflow_steps
    ? Math.max(current.workflow_steps_count, execution.workflow_steps)
    : current.workflow_steps_count;
  const conditional_branches_count = execution.conditional_branches
    ? Math.max(current.conditional_branches_count, execution.conditional_branches)
    : current.conditional_branches_count;
  const loop_iterations_count = execution.loop_iterations
    ? current.loop_iterations_count + execution.loop_iterations
    : current.loop_iterations_count;
  const parallel_execution_count = execution.parallel_executions
    ? Math.max(current.parallel_execution_count, execution.parallel_executions)
    : current.parallel_execution_count;

  // Calculate reliability metrics
  const success_rate = (successful_executions / total_executions) * 100;
  const retry_rate = execution.retry_count
    ? ((current.retry_rate * current.total_executions) + execution.retry_count) / total_executions
    : current.retry_rate;
  const error_recovery_count = execution.retry_count && execution.was_successful
    ? current.error_recovery_count + 1
    : current.error_recovery_count;

  // Fetch active AIS ranges from database (using centralized config service)
  const aisRanges = await AISConfigService.getRanges(supabase);

  // Calculate component scores using database-driven ranges
  const token_complexity_score = await calculateTokenComplexity(avg_tokens_per_run, peak_tokens_single_run, input_output_ratio, aisRanges);
  const execution_complexity_score = await calculateExecutionComplexity(avg_iterations_per_run, avg_execution_duration_ms, success_rate, retry_rate, aisRanges);
  const plugin_complexity_score = await calculatePluginComplexity(unique_plugins_used, avg_plugins_per_run, tool_orchestration_overhead_ms, aisRanges);
  const workflow_complexity_score = await calculateWorkflowComplexity(workflow_steps_count, conditional_branches_count, loop_iterations_count, parallel_execution_count, aisRanges);

  // === THREE SCORE SYSTEM ===

  // 1. EXECUTION SCORE (0-10): Weighted average of 4 execution components
  const execution_score = (
    token_complexity_score * EXECUTION_WEIGHTS.TOKEN_COMPLEXITY +
    execution_complexity_score * EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY +
    plugin_complexity_score * EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY +
    workflow_complexity_score * EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY
  );

  // 2. CREATION SCORE (0-10): Fetch from existing metrics (unchanged during execution)
  // Use default of 5.0 if not set (for agents created before three-score migration)
  const creation_score = current.creation_score ?? 5.0;

  // 3. COMBINED SCORE (0-10): Weighted blend of creation (30%) + execution (70%)
  const combined_score = (
    creation_score * COMBINED_WEIGHTS.CREATION +
    execution_score * COMBINED_WEIGHTS.EXECUTION
  );

  // DEPRECATED: Keep intensity_score synced with combined_score for backward compatibility
  const intensity_score = combined_score;

  // Update database
  const { error: updateError } = await supabase
    .from('agent_intensity_metrics')
    .update({
      // === THREE SCORES ===
      execution_score,
      combined_score,
      intensity_score, // DEPRECATED: kept in sync with combined_score
      // creation_score is NOT updated here (only set during agent creation)

      // === COMPONENT SCORES ===
      token_complexity_score,
      execution_complexity_score,
      plugin_complexity_score,
      workflow_complexity_score,

      // === EXECUTION STATISTICS ===
      total_executions,
      successful_executions,
      failed_executions,
      total_tokens_used,
      avg_tokens_per_run,
      peak_tokens_single_run,
      input_output_ratio,
      total_iterations,
      avg_iterations_per_run,
      avg_execution_duration_ms,
      peak_execution_duration_ms,
      total_plugin_calls,
      unique_plugins_used,
      avg_plugins_per_run,
      tool_orchestration_overhead_ms,
      workflow_steps_count,
      conditional_branches_count,
      loop_iterations_count,
      parallel_execution_count,
      success_rate,
      retry_rate,
      error_recovery_count,

      // === METADATA ===
      last_calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('agent_id', execution.agent_id);

  if (updateError) {
    console.error('Error updating intensity metrics:', updateError);
    return false;
  }

  console.log(`✅ [AIS] Three-score system updated for agent ${execution.agent_id}:`);
  console.log(`   Creation: ${creation_score.toFixed(2)} | Execution: ${execution_score.toFixed(2)} | Combined: ${combined_score.toFixed(2)}`);
  return true;
}

// Helper functions for calculating component scores
function normalizeToScale(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) * (outMax - outMin)) / (inMax - inMin);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function calculateTokenComplexity(
  avgTokens: number,
  peakTokens: number,
  ioRatio: number,
  ranges: AISRanges
): Promise<number> {
  const tokenVolumeScore = AISConfigService.normalize(avgTokens, ranges.token_volume);
  const tokenPeakScore = AISConfigService.normalize(peakTokens, ranges.token_peak);
  const tokenEfficiencyScore = normalizeToScale(ioRatio, ranges.token_io_ratio_min, ranges.token_io_ratio_max, 10, 0);
  return clamp(tokenVolumeScore * 0.5 + tokenPeakScore * 0.3 + tokenEfficiencyScore * 0.2, 0, 10);
}

async function calculateExecutionComplexity(
  avgIterations: number,
  avgDuration: number,
  successRate: number,
  retryRate: number,
  ranges: AISRanges
): Promise<number> {
  const iterationScore = AISConfigService.normalize(avgIterations, ranges.iterations);
  const durationScore = AISConfigService.normalize(avgDuration, ranges.duration_ms);
  const failureRateScore = AISConfigService.normalize(100 - successRate, ranges.failure_rate);
  const retryScore = AISConfigService.normalize(retryRate, ranges.retry_rate);
  return clamp(iterationScore * 0.35 + durationScore * 0.30 + failureRateScore * 0.20 + retryScore * 0.15, 0, 10);
}

async function calculatePluginComplexity(
  uniquePlugins: number,
  avgPluginsPerRun: number,
  orchestrationOverhead: number,
  ranges: AISRanges
): Promise<number> {
  const pluginCountScore = AISConfigService.normalize(uniquePlugins, ranges.plugin_count);
  const pluginFrequencyScore = AISConfigService.normalize(avgPluginsPerRun, ranges.plugins_per_run);
  const orchestrationScore = AISConfigService.normalize(orchestrationOverhead, ranges.orchestration_overhead_ms);
  return clamp(pluginCountScore * 0.4 + pluginFrequencyScore * 0.35 + orchestrationScore * 0.25, 0, 10);
}

async function calculateWorkflowComplexity(
  steps: number,
  branches: number,
  loops: number,
  parallel: number,
  ranges: AISRanges
): Promise<number> {
  const stepsScore = AISConfigService.normalize(steps, ranges.workflow_steps);
  const branchScore = AISConfigService.normalize(branches, ranges.branches);
  const loopScore = AISConfigService.normalize(loops, ranges.loops);
  const parallelScore = AISConfigService.normalize(parallel, ranges.parallel);
  return clamp(stepsScore * 0.4 + branchScore * 0.25 + loopScore * 0.20 + parallelScore * 0.15, 0, 10);
}
