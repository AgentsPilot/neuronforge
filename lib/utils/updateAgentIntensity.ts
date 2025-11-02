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
 *
 * @returns Object with success status and calculated scores, or false if failed
 */
export async function updateAgentIntensityMetrics(
  supabase: SupabaseClient,
  executionData: AgentExecutionData
): Promise<{ success: true; execution_score: number; combined_score: number; creation_score: number } | { success: false }> {
  try {
    // 1. Get existing metrics or create if not exists
    const { data: existing, error: fetchError } = await supabase
      .from('agent_intensity_metrics')
      .select('*')
      .eq('agent_id', executionData.agent_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Error fetching intensity metrics:', fetchError);
      return { success: false };
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
        return { success: false };
      }

      // Fetch the newly created record
      const { data: newMetrics } = await supabase
        .from('agent_intensity_metrics')
        .select('*')
        .eq('agent_id', executionData.agent_id)
        .single();

      if (!newMetrics) return { success: false };

      // Use the newly created record as existing
      return await updateExistingMetrics(supabase, newMetrics as AgentIntensityMetrics, executionData);
    }

    // 2. Update existing metrics
    return await updateExistingMetrics(supabase, existing as AgentIntensityMetrics, executionData);
  } catch (error) {
    console.error('Exception in updateAgentIntensityMetrics:', error);
    return { success: false };
  }
}

/**
 * Update existing metrics with new execution data
 */
async function updateExistingMetrics(
  supabase: SupabaseClient,
  current: AgentIntensityMetrics,
  execution: AgentExecutionData
): Promise<{ success: true; execution_score: number; combined_score: number; creation_score: number } | { success: false }> {
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

  // Update output token statistics (NEW - for growth tracking)
  const currentOutputTokens = execution.output_tokens || 0;
  const total_output_tokens = (current.avg_output_tokens_per_run * current.total_executions) + currentOutputTokens;
  const avg_output_tokens_per_run = total_output_tokens / total_executions;

  // Update memory statistics (NEW - for memory complexity tracking)
  const currentMemoryTokens = execution.memory_tokens || 0;
  const total_memory_tokens = (current.avg_memory_tokens_per_run * current.total_executions) + currentMemoryTokens;
  const avg_memory_tokens_per_run = total_memory_tokens / total_executions;

  const memory_token_ratio = execution.input_tokens && execution.input_tokens > 0
    ? Math.min(currentMemoryTokens / execution.input_tokens, 1.0)
    : current.memory_token_ratio;

  const memory_entry_count = execution.memory_entry_count || 0;
  const memory_type_diversity = execution.memory_types ? execution.memory_types.length : 0;

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

  // Fetch min_executions_for_score threshold from database
  const minExecutionsForScore = await AISConfigService.getSystemConfig(
    supabase,
    'min_executions_for_score',
    5 // Default to 5 if not configured
  );

  // Calculate component scores using database-driven ranges
  const tokenComplexityResult = await calculateTokenComplexity(
    supabase,
    execution.agent_id,
    avg_tokens_per_run,
    peak_tokens_single_run,
    input_output_ratio,
    currentOutputTokens,
    aisRanges,
    success_rate,  // Add quality metrics for amplification
    retry_rate
  );
  const token_complexity_score = tokenComplexityResult.score;
  const output_token_growth_rate = tokenComplexityResult.growthData.growthRate;
  const output_token_baseline = tokenComplexityResult.baseline;
  const output_token_alert_level = tokenComplexityResult.growthData.alertLevel;

  const execution_complexity_score = await calculateExecutionComplexity(avg_iterations_per_run, avg_execution_duration_ms, success_rate, retry_rate, aisRanges);
  const plugin_complexity_score = await calculatePluginComplexity(unique_plugins_used, avg_plugins_per_run, tool_orchestration_overhead_ms, aisRanges);
  const workflow_complexity_score = await calculateWorkflowComplexity(workflow_steps_count, conditional_branches_count, loop_iterations_count, parallel_execution_count, aisRanges);

  // NEW: Calculate memory complexity score (5th component)
  const memory_complexity_score = await calculateMemoryComplexity(
    currentMemoryTokens,
    execution.input_tokens || 0,
    memory_entry_count,
    memory_type_diversity,
    aisRanges
  );

  // === THREE SCORE SYSTEM ===

  // 1. EXECUTION SCORE (0-10): Weighted average of 5 execution components (UPDATED)
  const execution_score = (
    token_complexity_score * EXECUTION_WEIGHTS.TOKEN_COMPLEXITY +
    execution_complexity_score * EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY +
    plugin_complexity_score * EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY +
    workflow_complexity_score * EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY +
    memory_complexity_score * EXECUTION_WEIGHTS.MEMORY_COMPLEXITY
  );

  // 2. CREATION SCORE (0-10): Fetch from existing metrics (unchanged during execution)
  // Use default of 5.0 if not set (for agents created before three-score migration)
  const creation_score = current.creation_score ?? 5.0;

  // 3. COMBINED SCORE (0-10): Intelligently blend creation & execution scores
  // - If executions < threshold: Use creation score only (trust design estimate)
  // - If executions >= threshold: Use weighted blend (30% creation + 70% execution)
  const combined_score = total_executions < minExecutionsForScore
    ? creation_score  // Not enough data - use creation score only
    : (
        creation_score * COMBINED_WEIGHTS.CREATION +
        execution_score * COMBINED_WEIGHTS.EXECUTION
      );

  console.log(`📊 [AIS] Score calculation for agent ${execution.agent_id}:`);
  console.log(`   Total executions: ${total_executions}, Threshold: ${minExecutionsForScore}`);
  console.log(`   Creation: ${creation_score.toFixed(2)}, Execution: ${execution_score.toFixed(2)}`);
  console.log(`   Combined: ${combined_score.toFixed(2)} (${total_executions < minExecutionsForScore ? 'creation-only' : 'weighted blend'})`);


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
      memory_complexity_score,  // NEW: 5th component

      // === EXECUTION STATISTICS ===
      total_executions,
      successful_executions,
      failed_executions,
      total_tokens_used,
      avg_tokens_per_run,
      peak_tokens_single_run,
      input_output_ratio,

      // === OUTPUT TOKEN GROWTH TRACKING (NEW) ===
      avg_output_tokens_per_run,
      output_token_growth_rate,
      output_token_baseline,
      output_token_alert_level,

      // === MEMORY COMPLEXITY TRACKING (NEW) ===
      avg_memory_tokens_per_run,
      memory_token_ratio,
      memory_entry_count,
      memory_type_diversity,

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
    return { success: false };
  }

  console.log(`✅ [AIS] Three-score system updated for agent ${execution.agent_id}:`);
  console.log(`   Creation: ${creation_score.toFixed(2)} | Execution: ${execution_score.toFixed(2)} | Combined: ${combined_score.toFixed(2)}`);

  return {
    success: true,
    execution_score,
    combined_score,
    creation_score
  };
}

// Helper functions for calculating component scores
function normalizeToScale(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) * (outMax - outMin)) / (inMax - inMin);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate output token growth patterns for intelligent model routing
 * Returns growth rate, alert level, and score adjustment based on user's table:
 *
 * Growth vs previous window | Meaning               | AIS Adjustment | Action
 * --------------------------|----------------------|----------------|----------
 * < 25%                     | Normal variance      | 0              | Ignore
 * 25-50%                    | Moderate rise        | +0.2 (max)     | Monitor
 * 50-100%                   | High sustained inc.  | +0.5 – +1.0    | Re-score
 * ≥ 100%                    | Extreme growth       | +1.0 – +1.5    | Upgrade tier
 */
interface OutputTokenGrowthResult {
  growthRate: number;
  alertLevel: 'none' | 'monitor' | 'rescore' | 'upgrade';
  adjustment: number;
}

async function calculateOutputTokenGrowth(
  supabase: SupabaseClient,
  agentId: string,
  currentOutputTokens: number,
  ranges: AISRanges
): Promise<OutputTokenGrowthResult> {
  try {
    // Query ALL historical executions for this agent to calculate baseline
    // User specified: "Why the time is matter, let's average all"
    const { data: allExecutions, error } = await supabase
      .from('token_usage')
      .select('output_tokens')
      .eq('agent_id', agentId)
      .eq('activity_type', 'agent_execution')
      .not('output_tokens', 'is', null);

    if (error || !allExecutions || allExecutions.length === 0) {
      // No baseline data yet - return no growth
      return {
        growthRate: 0,
        alertLevel: 'none',
        adjustment: 0
      };
    }

    // Calculate baseline as average of all historical output tokens
    const totalOutputTokens = allExecutions.reduce((sum, e) => sum + (e.output_tokens || 0), 0);
    const baselineOutputTokens = totalOutputTokens / allExecutions.length;

    if (baselineOutputTokens === 0 || currentOutputTokens === 0) {
      return {
        growthRate: 0,
        alertLevel: 'none',
        adjustment: 0
      };
    }

    // Calculate growth rate as percentage
    const growthRate = ((currentOutputTokens - baselineOutputTokens) / baselineOutputTokens) * 100;

    // Get thresholds from AIS config (NO FALLBACKS - must be configured in database)
    const monitorThreshold = (ranges as any).output_token_growth_monitor_threshold;
    const rescoreThreshold = (ranges as any).output_token_growth_rescore_threshold;
    const upgradeThreshold = (ranges as any).output_token_growth_upgrade_threshold;

    const monitorAdjustment = (ranges as any).output_token_growth_monitor_adjustment;
    const rescoreAdjustment = (ranges as any).output_token_growth_rescore_adjustment;
    const upgradeAdjustment = (ranges as any).output_token_growth_upgrade_adjustment;

    // Validate thresholds exist
    if (monitorThreshold === undefined || rescoreThreshold === undefined || upgradeThreshold === undefined ||
        monitorAdjustment === undefined || rescoreAdjustment === undefined || upgradeAdjustment === undefined) {
      console.error('❌ Growth thresholds not configured in database. Please configure in Admin AIS Config.');
      throw new Error('Growth thresholds not configured. Please set thresholds in Admin AIS Config.');
    }

    // Apply user's growth table
    if (growthRate < monitorThreshold) {
      return { growthRate, alertLevel: 'none', adjustment: 0 };
    } else if (growthRate >= monitorThreshold && growthRate < rescoreThreshold) {
      return { growthRate, alertLevel: 'monitor', adjustment: monitorAdjustment };
    } else if (growthRate >= rescoreThreshold && growthRate < upgradeThreshold) {
      return { growthRate, alertLevel: 'rescore', adjustment: rescoreAdjustment };
    } else {
      return { growthRate, alertLevel: 'upgrade', adjustment: upgradeAdjustment };
    }
  } catch (error) {
    console.error('Error calculating output token growth:', error);
    return {
      growthRate: 0,
      alertLevel: 'none',
      adjustment: 0
    };
  }
}

async function calculateTokenComplexity(
  supabase: SupabaseClient,
  agentId: string,
  avgTokens: number,
  peakTokens: number,
  ioRatio: number,
  currentOutputTokens: number,
  ranges: AISRanges,
  successRate: number,
  retryRate: number
): Promise<{ score: number; growthData: OutputTokenGrowthResult; baseline: number }> {
  // Calculate output token growth pattern (NEW - replaces absolute thresholds)
  const growthResult = await calculateOutputTokenGrowth(supabase, agentId, currentOutputTokens, ranges);

  // Calculate baseline from all executions
  const { data: allExecutions } = await supabase
    .from('token_usage')
    .select('output_tokens')
    .eq('agent_id', agentId)
    .eq('activity_type', 'agent_execution')
    .not('output_tokens', 'is', null);

  const totalOutputTokens = (allExecutions || []).reduce((sum, e) => sum + (e.output_tokens || 0), 0);
  const baseline = allExecutions && allExecutions.length > 0 ? totalOutputTokens / allExecutions.length : 0;

  // Token efficiency score (I/O ratio - lower ratio = more efficient)
  // Inverted scale: higher ratio (verbose output) = lower efficiency score
  const tokenEfficiencyScore = normalizeToScale(
    ioRatio,
    ranges.token_io_ratio_min,
    ranges.token_io_ratio_max,
    10,
    0  // Inverted: high ratio = low score
  );

  // Base token complexity from efficiency
  const baseComplexity = tokenEfficiencyScore * 0.7;

  // Apply growth adjustment (0 to +1.5 based on growth tier)
  let growthAdjustment = growthResult.adjustment;

  // === QUALITY METRICS AMPLIFICATION (NEW) ===
  // Amplify adjustment if quality metrics indicate struggle
  let qualityMultiplier = 1.0;

  // Get quality thresholds from AIS config (NO FALLBACKS - must be configured in database)
  const qualitySuccessThreshold = (ranges as any).quality_success_threshold;
  const qualityRetryThreshold = (ranges as any).quality_retry_threshold;
  const qualitySuccessMultiplier = (ranges as any).quality_success_multiplier;
  const qualityRetryMultiplier = (ranges as any).quality_retry_multiplier;

  // Validate quality thresholds exist
  if (qualitySuccessThreshold === undefined || qualityRetryThreshold === undefined ||
      qualitySuccessMultiplier === undefined || qualityRetryMultiplier === undefined) {
    console.error('❌ Quality metric thresholds not configured in database. Please configure in Admin AIS Config.');
    throw new Error('Quality metric thresholds not configured. Please set in Admin AIS Config.');
  }

  if (successRate < qualitySuccessThreshold) {
    // Low success rate = agent struggling
    qualityMultiplier += qualitySuccessMultiplier;
  }

  if (retryRate > qualityRetryThreshold) {
    // High retry rate = agent struggling
    qualityMultiplier += qualityRetryMultiplier;
  }

  // Apply quality multiplier to growth adjustment
  growthAdjustment = growthAdjustment * qualityMultiplier;

  // Final token complexity: base efficiency + amplified growth adjustment
  const score = clamp(baseComplexity + growthAdjustment, 0, 10);

  return {
    score,
    growthData: growthResult,
    baseline
  };
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

/**
 * Calculate memory complexity score (NEW - 5th execution component)
 *
 * Considers three dimensions:
 * 1. Memory token ratio (50% weight): How much of input is memory context
 * 2. Memory type diversity (30% weight): Variety of memory types used
 * 3. Memory volume (20% weight): Number of memory entries
 *
 * @param memoryTokens - Number of memory tokens injected
 * @param totalInputTokens - Total input tokens (including memory)
 * @param memoryEntryCount - Number of memory entries loaded
 * @param memoryTypeDiversity - Number of distinct memory types used
 * @param ranges - AIS normalization ranges
 * @returns Memory complexity score (0-10)
 */
async function calculateMemoryComplexity(
  memoryTokens: number,
  totalInputTokens: number,
  memoryEntryCount: number,
  memoryTypeDiversity: number,
  ranges: AISRanges
): Promise<number> {
  // If no memory used, return 0
  if (memoryTokens === 0 || totalInputTokens === 0) {
    return 0;
  }

  // 1. Memory Ratio Score (50% weight)
  // How much of the input is memory context (0.0 - 1.0)
  const memoryRatio = Math.min(memoryTokens / totalInputTokens, 1.0);
  const ratioRange = { min: 0.0, max: 0.9 }; // High memory ratio (>90%) is unusual
  const ratioScore = AISConfigService.normalize(memoryRatio, ratioRange);

  // 2. Memory Type Diversity Score (30% weight)
  // More types = more sophisticated memory usage
  const diversityRange = { min: 0, max: 3 }; // 0-3 types (user_context, summaries, patterns)
  const diversityScore = AISConfigService.normalize(memoryTypeDiversity, diversityRange);

  // 3. Memory Volume Score (20% weight)
  // Number of memory entries loaded
  const volumeRange = { min: 0, max: 20 }; // 0-20 memory entries
  const volumeScore = AISConfigService.normalize(memoryEntryCount, volumeRange);

  // Weighted combination
  const score = clamp(
    ratioScore * 0.5 +
    diversityScore * 0.3 +
    volumeScore * 0.2,
    0,
    10
  );

  console.log(`🧠 [Memory Complexity] Tokens: ${memoryTokens}/${totalInputTokens} (${(memoryRatio * 100).toFixed(1)}%), ` +
    `Entries: ${memoryEntryCount}, Types: ${memoryTypeDiversity}, Score: ${score.toFixed(2)}/10`);

  return score;
}
