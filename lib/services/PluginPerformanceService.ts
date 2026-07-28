/**
 * PluginPerformanceService
 *
 * Tracks per-agent plugin performance metrics for anomaly detection
 * and optimization suggestions.
 *
 * Part of Phase 2: Personalization (Memory System Enhancement)
 *
 * @module lib/services/PluginPerformanceService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'PluginPerformanceService' });

// ============ Types ============

export interface PluginMetrics {
  plugin: string;
  action: string;
  execution_count: number;
  success_count: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_tokens: number;
  error_breakdown: Record<string, number>;
  last_updated: string;
}

export interface StepExecutionData {
  plugin: string;
  action: string;
  success: boolean;
  duration_ms: number;
  tokens_used?: number;
  error_code?: string;
}

export interface PluginPerformanceAlert {
  plugin: string;
  action: string;
  alert_type: 'success_rate_drop' | 'duration_spike' | 'error_spike';
  message: string;
  current_value: number;
  baseline_value: number;
  severity: 'info' | 'warning' | 'critical';
}

// ============ Service ============

export class PluginPerformanceService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record a step execution result
   *
   * Call this from StepExecutor after each step completes.
   * Updates running metrics in plugin_performance table.
   *
   * @param agentId - Agent ID
   * @param userId - User ID
   * @param data - Step execution data
   */
  async recordExecution(
    agentId: string,
    userId: string,
    data: StepExecutionData
  ): Promise<void> {
    try {
      // Use RPC for atomic upsert with running averages
      const { error } = await this.supabase.rpc('upsert_plugin_performance', {
        p_agent_id: agentId,
        p_user_id: userId,
        p_plugin: data.plugin,
        p_action: data.action,
        p_success: data.success,
        p_duration_ms: data.duration_ms,
        p_tokens: data.tokens_used || 0,
        p_error_code: data.error_code || null,
      });

      if (error) {
        // Fall back to manual upsert if RPC doesn't exist
        await this.manualUpsert(agentId, userId, data);
      }
    } catch (err) {
      // Non-blocking - don't fail execution due to metrics
      logger.debug({ err }, 'Failed to record plugin performance (non-blocking)');
    }
  }

  /**
   * Get plugin metrics for an agent
   */
  async getMetrics(
    agentId: string,
    userId: string,
    options?: {
      plugin?: string;
      minExecutions?: number;
    }
  ): Promise<PluginMetrics[]> {
    try {
      let query = this.supabase
        .from('plugin_performance')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .order('execution_count', { ascending: false });

      if (options?.plugin) {
        query = query.eq('plugin', options.plugin);
      }

      if (options?.minExecutions) {
        query = query.gte('execution_count', options.minExecutions);
      }

      const { data, error } = await query;

      if (error || !data) {
        return [];
      }

      return data.map((row) => ({
        plugin: row.plugin,
        action: row.action,
        execution_count: row.execution_count,
        success_count: row.success_count,
        success_rate: row.success_count / row.execution_count,
        avg_duration_ms: row.avg_duration_ms,
        avg_tokens: row.avg_tokens,
        error_breakdown: row.error_breakdown || {},
        last_updated: row.last_updated,
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to get plugin metrics');
      return [];
    }
  }

  /**
   * Get user-wide plugin metrics (across all agents)
   */
  async getUserWideMetrics(
    userId: string,
    options?: {
      minExecutions?: number;
      limit?: number;
    }
  ): Promise<Array<PluginMetrics & { agent_count: number }>> {
    try {
      // Aggregate across agents
      const { data, error } = await this.supabase
        .from('plugin_performance')
        .select('plugin, action, execution_count, success_count, avg_duration_ms, avg_tokens, error_breakdown')
        .eq('user_id', userId)
        .gte('execution_count', options?.minExecutions || 1)
        .order('execution_count', { ascending: false })
        .limit(options?.limit || 100);

      if (error || !data) {
        return [];
      }

      // Aggregate by plugin+action
      const aggregated: Record<
        string,
        PluginMetrics & { agent_count: number; total_success: number; total_exec: number }
      > = {};

      for (const row of data) {
        const key = `${row.plugin}:${row.action}`;
        if (!aggregated[key]) {
          aggregated[key] = {
            plugin: row.plugin,
            action: row.action,
            execution_count: 0,
            success_count: 0,
            success_rate: 0,
            avg_duration_ms: 0,
            avg_tokens: 0,
            error_breakdown: {},
            last_updated: '',
            agent_count: 0,
            total_success: 0,
            total_exec: 0,
          };
        }

        const agg = aggregated[key];
        agg.agent_count += 1;
        agg.total_exec += row.execution_count;
        agg.total_success += row.success_count;
        agg.execution_count += row.execution_count;
        agg.success_count += row.success_count;

        // Weighted average for duration and tokens
        agg.avg_duration_ms =
          (agg.avg_duration_ms * (agg.agent_count - 1) + row.avg_duration_ms) /
          agg.agent_count;
        agg.avg_tokens =
          (agg.avg_tokens * (agg.agent_count - 1) + row.avg_tokens) / agg.agent_count;

        // Merge error breakdowns
        for (const [code, count] of Object.entries(row.error_breakdown || {})) {
          agg.error_breakdown[code] = (agg.error_breakdown[code] || 0) + (count as number);
        }
      }

      return Object.values(aggregated).map((agg) => ({
        ...agg,
        success_rate: agg.total_exec > 0 ? agg.total_success / agg.total_exec : 0,
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to get user-wide metrics');
      return [];
    }
  }

  /**
   * Check for performance anomalies compared to baselines
   *
   * @param agentId - Agent ID
   * @param userId - User ID
   * @returns List of alerts for anomalous plugins
   */
  async checkForAnomalies(
    agentId: string,
    userId: string
  ): Promise<PluginPerformanceAlert[]> {
    try {
      const metrics = await this.getMetrics(agentId, userId, { minExecutions: 10 });
      const userWideMetrics = await this.getUserWideMetrics(userId, { minExecutions: 20 });

      const alerts: PluginPerformanceAlert[] = [];

      for (const metric of metrics) {
        // Find user-wide baseline for this plugin+action
        const baseline = userWideMetrics.find(
          (m) => m.plugin === metric.plugin && m.action === metric.action
        );

        if (!baseline) continue;

        // Check success rate drop
        if (
          metric.success_rate < baseline.success_rate * 0.7 &&
          baseline.success_rate > 0.5
        ) {
          alerts.push({
            plugin: metric.plugin,
            action: metric.action,
            alert_type: 'success_rate_drop',
            message: `Success rate dropped to ${(metric.success_rate * 100).toFixed(0)}% (baseline: ${(baseline.success_rate * 100).toFixed(0)}%)`,
            current_value: metric.success_rate,
            baseline_value: baseline.success_rate,
            severity: metric.success_rate < 0.5 ? 'critical' : 'warning',
          });
        }

        // Check duration spike (2x baseline)
        if (metric.avg_duration_ms > baseline.avg_duration_ms * 2) {
          alerts.push({
            plugin: metric.plugin,
            action: metric.action,
            alert_type: 'duration_spike',
            message: `Duration increased to ${metric.avg_duration_ms.toFixed(0)}ms (baseline: ${baseline.avg_duration_ms.toFixed(0)}ms)`,
            current_value: metric.avg_duration_ms,
            baseline_value: baseline.avg_duration_ms,
            severity: metric.avg_duration_ms > baseline.avg_duration_ms * 3 ? 'warning' : 'info',
          });
        }
      }

      return alerts;
    } catch (err) {
      logger.error({ err }, 'Failed to check for anomalies');
      return [];
    }
  }

  /**
   * Get top error-prone plugins for a user
   */
  async getErrorPronePlugins(
    userId: string,
    limit: number = 5
  ): Promise<Array<{ plugin: string; action: string; error_rate: number; top_error: string }>> {
    try {
      const metrics = await this.getUserWideMetrics(userId, { minExecutions: 10 });

      return metrics
        .map((m) => {
          const errorRate = 1 - m.success_rate;
          const topError = Object.entries(m.error_breakdown)
            .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || 'unknown';

          return {
            plugin: m.plugin,
            action: m.action,
            error_rate: errorRate,
            top_error: topError,
          };
        })
        .filter((m) => m.error_rate > 0.1) // Only plugins with >10% error rate
        .sort((a, b) => b.error_rate - a.error_rate)
        .slice(0, limit);
    } catch (err) {
      logger.error({ err }, 'Failed to get error-prone plugins');
      return [];
    }
  }

  // ============ Private Methods ============

  /**
   * Manual upsert fallback if RPC doesn't exist
   */
  private async manualUpsert(
    agentId: string,
    userId: string,
    data: StepExecutionData
  ): Promise<void> {
    // Check if record exists
    const { data: existing } = await this.supabase
      .from('plugin_performance')
      .select('id, execution_count, success_count, avg_duration_ms, avg_tokens, error_breakdown')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .eq('plugin', data.plugin)
      .eq('action', data.action)
      .maybeSingle();

    if (existing) {
      // Update with running averages
      const newCount = existing.execution_count + 1;
      const newSuccessCount = existing.success_count + (data.success ? 1 : 0);
      const newAvgDuration =
        (existing.avg_duration_ms * existing.execution_count + data.duration_ms) / newCount;
      const newAvgTokens =
        (existing.avg_tokens * existing.execution_count + (data.tokens_used || 0)) / newCount;

      const errorBreakdown = existing.error_breakdown || {};
      if (data.error_code) {
        errorBreakdown[data.error_code] = (errorBreakdown[data.error_code] || 0) + 1;
      }

      await this.supabase
        .from('plugin_performance')
        .update({
          execution_count: newCount,
          success_count: newSuccessCount,
          avg_duration_ms: newAvgDuration,
          avg_tokens: newAvgTokens,
          error_breakdown: errorBreakdown,
          last_updated: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Insert new record
      const errorBreakdown: Record<string, number> = {};
      if (data.error_code) {
        errorBreakdown[data.error_code] = 1;
      }

      await this.supabase.from('plugin_performance').insert({
        agent_id: agentId,
        user_id: userId,
        plugin: data.plugin,
        action: data.action,
        execution_count: 1,
        success_count: data.success ? 1 : 0,
        avg_duration_ms: data.duration_ms,
        avg_tokens: data.tokens_used || 0,
        error_breakdown: errorBreakdown,
        time_window: '30d',
        last_updated: new Date().toISOString(),
      });
    }
  }
}

// Singleton factory
let _instance: PluginPerformanceService | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getPluginPerformanceService(
  supabase: SupabaseClient
): PluginPerformanceService {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new PluginPerformanceService(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
