/**
 * BaselineService
 *
 * Manages execution baselines for per-agent performance tracking.
 * Baselines are used by AnomalyDetector to identify deviations.
 *
 * Part of Phase 6: Execution Optimization (Memory System Enhancement)
 *
 * @module lib/services/BaselineService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { getInsightsConfigService, BaselineConfig } from './InsightsConfigService';

const logger = createLogger({ service: 'BaselineService' });

// Default config used when async config fetch isn't possible
const DEFAULT_BASELINE_CONFIG: BaselineConfig = {
  enabled: true,
  min_samples: 5,
  zscore_threshold: 2.0,
  zscore_warning: 2.5,
  zscore_critical: 4.0,
  step_deviation_threshold: 50,
  retry_deviation_threshold: 100,
  duration_spike_factor: 2.0,
};

// ============ Types ============

export interface ExecutionBaseline {
  id: string;
  agent_id: string;
  user_id: string;
  avg_duration_ms: number;
  stddev_duration_ms: number;
  avg_token_usage: number;
  stddev_token_usage: number;
  avg_step_count: number;
  avg_retry_count: number;
  success_rate: number;
  sample_count: number;
  plugin_baselines: Record<string, PluginBaseline>;
  window_start: string;
  window_end: string;
}

export interface PluginBaseline {
  avg_duration_ms: number;
  stddev_duration_ms: number;
  avg_token_usage: number;
  success_rate: number;
  sample_count: number;
}

export interface UpdateBaselineInput {
  agentId: string;
  userId: string;
  durationMs: number;
  tokenUsage: number;
  stepCount: number;
  retryCount: number;
  success: boolean;
}

export interface BaselineComparison {
  metric: string;
  baselineValue: number;
  actualValue: number;
  deviationPercent: number;
  zScore: number | null;
  isAnomaly: boolean;
}

// ============ Service ============

export class BaselineService {
  private configCache: BaselineConfig | null = null;
  private configCacheExpiry: number = 0;
  private readonly CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private supabase: SupabaseClient) {}

  /**
   * Get baseline configuration (cached)
   */
  private async getConfig(): Promise<BaselineConfig> {
    const now = Date.now();
    if (this.configCache && now < this.configCacheExpiry) {
      return this.configCache;
    }

    try {
      const configService = getInsightsConfigService(this.supabase);
      this.configCache = await configService.getBaselineConfig();
      this.configCacheExpiry = now + this.CONFIG_CACHE_TTL_MS;
      return this.configCache;
    } catch (err) {
      logger.error({ err }, 'Failed to load baseline config, using defaults');
      return DEFAULT_BASELINE_CONFIG;
    }
  }

  /**
   * Update baseline after an execution completes
   *
   * Uses Welford's online algorithm for running mean and variance.
   * Called from WorkflowPilot after each execution.
   *
   * @param input - Execution metrics
   */
  async updateBaseline(input: UpdateBaselineInput): Promise<void> {
    try {
      const { error } = await this.supabase.rpc('update_execution_baseline', {
        p_agent_id: input.agentId,
        p_user_id: input.userId,
        p_duration_ms: input.durationMs,
        p_token_usage: input.tokenUsage,
        p_step_count: input.stepCount,
        p_retry_count: input.retryCount,
        p_success: input.success,
      });

      if (error) {
        logger.debug({ err: error }, 'Failed to update baseline (non-blocking)');
      }
    } catch (err) {
      // Non-blocking - don't fail execution
      logger.debug({ err }, 'Baseline update failed (non-blocking)');
    }
  }

  /**
   * Get baseline for an agent
   *
   * @param agentId - Agent ID
   * @param userId - User ID for security
   */
  async getBaseline(agentId: string, userId: string): Promise<ExecutionBaseline | null> {
    try {
      const { data, error } = await this.supabase
        .from('execution_baselines')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return null;
      }

      return data as ExecutionBaseline;
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to get baseline');
      return null;
    }
  }

  /**
   * Compare execution metrics against baseline
   *
   * Returns comparison details for each metric.
   * Uses cached config values for thresholds.
   *
   * @param baseline - The baseline to compare against
   * @param metrics - Current execution metrics
   */
  compareToBaseline(
    baseline: ExecutionBaseline,
    metrics: {
      durationMs: number;
      tokenUsage: number;
      stepCount: number;
      retryCount: number;
    }
  ): BaselineComparison[] {
    const comparisons: BaselineComparison[] = [];

    // Use cached config or defaults
    const config = this.configCache ?? DEFAULT_BASELINE_CONFIG;
    const zscoreThreshold = config.zscore_threshold;
    const stepDeviationThreshold = config.step_deviation_threshold;
    const retryDeviationThreshold = config.retry_deviation_threshold;

    // Duration comparison
    if (baseline.stddev_duration_ms > 0) {
      const zScore = (metrics.durationMs - baseline.avg_duration_ms) / baseline.stddev_duration_ms;
      const deviationPercent =
        ((metrics.durationMs - baseline.avg_duration_ms) / baseline.avg_duration_ms) * 100;

      comparisons.push({
        metric: 'duration_ms',
        baselineValue: baseline.avg_duration_ms,
        actualValue: metrics.durationMs,
        deviationPercent,
        zScore,
        isAnomaly: zScore > zscoreThreshold,
      });
    }

    // Token usage comparison
    if (baseline.stddev_token_usage > 0) {
      const zScore = (metrics.tokenUsage - baseline.avg_token_usage) / baseline.stddev_token_usage;
      const deviationPercent =
        ((metrics.tokenUsage - baseline.avg_token_usage) / baseline.avg_token_usage) * 100;

      comparisons.push({
        metric: 'token_usage',
        baselineValue: baseline.avg_token_usage,
        actualValue: metrics.tokenUsage,
        deviationPercent,
        zScore,
        isAnomaly: zScore > zscoreThreshold,
      });
    }

    // Step count comparison
    if (baseline.avg_step_count > 0) {
      const deviationPercent =
        ((metrics.stepCount - baseline.avg_step_count) / baseline.avg_step_count) * 100;

      comparisons.push({
        metric: 'step_count',
        baselineValue: baseline.avg_step_count,
        actualValue: metrics.stepCount,
        deviationPercent,
        zScore: null,
        isAnomaly: deviationPercent > stepDeviationThreshold,
      });
    }

    // Retry count comparison
    if (baseline.avg_retry_count > 0) {
      const deviationPercent =
        ((metrics.retryCount - baseline.avg_retry_count) / baseline.avg_retry_count) * 100;

      comparisons.push({
        metric: 'retry_count',
        baselineValue: baseline.avg_retry_count,
        actualValue: metrics.retryCount,
        deviationPercent,
        zScore: null,
        isAnomaly: deviationPercent > retryDeviationThreshold,
      });
    }

    return comparisons;
  }

  /**
   * Get all baselines for a user
   *
   * @param userId - User ID
   * @param limit - Maximum number of baselines
   */
  async getUserBaselines(userId: string, limit: number = 50): Promise<ExecutionBaseline[]> {
    try {
      const { data, error } = await this.supabase
        .from('execution_baselines')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error || !data) {
        return [];
      }

      return data as ExecutionBaseline[];
    } catch (err) {
      logger.error({ err }, 'Failed to get user baselines');
      return [];
    }
  }

  /**
   * Reset baseline for an agent
   *
   * Use after significant workflow changes that invalidate the baseline.
   *
   * @param agentId - Agent ID
   * @param userId - User ID
   */
  async resetBaseline(agentId: string, userId: string): Promise<void> {
    try {
      await this.supabase
        .from('execution_baselines')
        .delete()
        .eq('agent_id', agentId)
        .eq('user_id', userId);

      logger.info({ agentId }, 'Baseline reset');
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to reset baseline');
    }
  }

  /**
   * Check if baseline has enough samples for anomaly detection
   *
   * @param baseline - The baseline to check
   * @param minSamples - Minimum samples required (uses config default if not provided)
   */
  async hasStatisticalSignificance(baseline: ExecutionBaseline | null, minSamples?: number): Promise<boolean> {
    if (!baseline) return false;

    const config = await this.getConfig();
    const threshold = minSamples ?? config.min_samples;
    return baseline.sample_count >= threshold;
  }

  /**
   * Synchronous check for statistical significance (uses cached config or default)
   * Use this when async isn't possible (e.g., in compareToBaseline)
   */
  hasStatisticalSignificanceSync(baseline: ExecutionBaseline | null, minSamples: number = 5): boolean {
    if (!baseline) return false;
    const threshold = this.configCache?.min_samples ?? minSamples;
    return baseline.sample_count >= threshold;
  }

  /**
   * Format baseline summary for display
   */
  formatBaselineSummary(baseline: ExecutionBaseline): string {
    const lines: string[] = [];

    lines.push(`📊 Execution Baseline (${baseline.sample_count} executions)`);
    lines.push(`  Duration: ${baseline.avg_duration_ms.toFixed(0)}ms ± ${baseline.stddev_duration_ms.toFixed(0)}ms`);
    lines.push(`  Tokens: ${baseline.avg_token_usage.toFixed(0)} ± ${baseline.stddev_token_usage.toFixed(0)}`);
    lines.push(`  Steps: ${baseline.avg_step_count.toFixed(1)} avg`);
    lines.push(`  Success Rate: ${(baseline.success_rate * 100).toFixed(1)}%`);

    return lines.join('\n');
  }
}

// Singleton factory
let _instance: BaselineService | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getBaselineService(supabase: SupabaseClient): BaselineService {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new BaselineService(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
