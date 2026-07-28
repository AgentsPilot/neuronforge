/**
 * AnomalyDetector
 *
 * Detects execution anomalies by comparing against baselines.
 * Generates alerts and suggestions for optimization.
 *
 * Part of Phase 6: Execution Optimization (Memory System Enhancement)
 *
 * @module lib/services/AnomalyDetector
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { getBaselineService, ExecutionBaseline } from './BaselineService';
import { getInsightsConfigService, BaselineConfig } from './InsightsConfigService';

const logger = createLogger({ service: 'AnomalyDetector' });

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

export interface ExecutionAnomaly {
  id: string;
  agent_id: string;
  execution_id: string;
  user_id: string;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  baseline_value: number;
  actual_value: number;
  z_score: number | null;
  deviation_percent: number;
  plugin: string | null;
  action: string | null;
  step_index: number | null;
  probable_cause: string | null;
  suggested_fix: string | null;
  status: AnomalyStatus;
  resolved_at: string | null;
  resolution_notes: string | null;
  detected_at: string;
}

export type AnomalyType =
  | 'duration_spike'
  | 'token_spike'
  | 'error_rate_increase'
  | 'step_count_increase'
  | 'retry_spike';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnomalyStatus = 'detected' | 'acknowledged' | 'investigating' | 'resolved' | 'ignored';

export interface DetectAnomalyInput {
  agentId: string;
  executionId: string;
  userId: string;
  durationMs: number;
  tokenUsage: number;
  stepCount: number;
  retryCount: number;
  success: boolean;
  pluginMetrics?: Array<{
    plugin: string;
    action: string;
    stepIndex: number;
    durationMs: number;
    tokenUsage: number;
    success: boolean;
  }>;
}

export interface DetectedAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  baselineValue: number;
  actualValue: number;
  zScore: number | null;
  deviationPercent: number;
  plugin?: string;
  action?: string;
  stepIndex?: number;
}

// ============ Service ============

export class AnomalyDetector {
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
   * Detect anomalies in an execution
   *
   * Compares execution metrics against baseline and records anomalies.
   * Call this after each execution completes.
   *
   * @param input - Execution metrics
   * @returns List of detected anomalies
   */
  async detectAndRecord(input: DetectAnomalyInput): Promise<DetectedAnomaly[]> {
    try {
      // Check if anomaly detection is enabled
      const config = await this.getConfig();
      if (!config.enabled) {
        return [];
      }

      const baselineService = getBaselineService(this.supabase);
      const baseline = await baselineService.getBaseline(input.agentId, input.userId);

      // Need sufficient samples for detection
      const hasSignificance = await baselineService.hasStatisticalSignificance(baseline, config.min_samples);
      if (!hasSignificance) {
        return [];
      }

      const anomalies = this.detectAnomalies(baseline!, input, config);

      // Record each anomaly (fire-and-forget)
      for (const anomaly of anomalies) {
        this.recordAnomaly(input, anomaly).catch((err) => {
          logger.debug({ err }, 'Failed to record anomaly (non-blocking)');
        });
      }

      if (anomalies.length > 0) {
        logger.info(
          { agentId: input.agentId, executionId: input.executionId, count: anomalies.length },
          'Anomalies detected'
        );
      }

      return anomalies;
    } catch (err) {
      logger.error({ err }, 'Anomaly detection failed');
      return [];
    }
  }

  /**
   * Get unresolved anomalies for an agent
   */
  async getUnresolvedAnomalies(
    agentId: string,
    userId: string,
    limit: number = 10
  ): Promise<ExecutionAnomaly[]> {
    try {
      const { data, error } = await this.supabase
        .from('execution_anomalies')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .in('status', ['detected', 'investigating'])
        .order('detected_at', { ascending: false })
        .limit(limit);

      if (error || !data) {
        return [];
      }

      return data as ExecutionAnomaly[];
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to get unresolved anomalies');
      return [];
    }
  }

  /**
   * Get all anomalies for a user
   */
  async getUserAnomalies(
    userId: string,
    options: {
      status?: AnomalyStatus[];
      severity?: AnomalySeverity[];
      limit?: number;
    } = {}
  ): Promise<ExecutionAnomaly[]> {
    try {
      let query = this.supabase
        .from('execution_anomalies')
        .select('*')
        .eq('user_id', userId)
        .order('detected_at', { ascending: false })
        .limit(options.limit || 50);

      if (options.status && options.status.length > 0) {
        query = query.in('status', options.status);
      }

      if (options.severity && options.severity.length > 0) {
        query = query.in('severity', options.severity);
      }

      const { data, error } = await query;

      if (error || !data) {
        return [];
      }

      return data as ExecutionAnomaly[];
    } catch (err) {
      logger.error({ err }, 'Failed to get user anomalies');
      return [];
    }
  }

  /**
   * Update anomaly status
   */
  async updateStatus(
    anomalyId: string,
    userId: string,
    status: AnomalyStatus,
    notes?: string
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };

      if (status === 'resolved') {
        updates.resolved_at = new Date().toISOString();
      }

      if (notes) {
        updates.resolution_notes = notes;
      }

      await this.supabase
        .from('execution_anomalies')
        .update(updates)
        .eq('id', anomalyId)
        .eq('user_id', userId);
    } catch (err) {
      logger.error({ err, anomalyId }, 'Failed to update anomaly status');
    }
  }

  /**
   * Get anomaly summary for dashboard display
   */
  async getAnomalySummary(userId: string): Promise<{
    total: number;
    bySeverity: Record<AnomalySeverity, number>;
    byType: Record<string, number>;
    topAgents: Array<{ agentId: string; count: number }>;
  }> {
    try {
      const { data, error } = await this.supabase
        .from('execution_anomalies')
        .select('agent_id, severity, anomaly_type')
        .eq('user_id', userId)
        .in('status', ['detected', 'investigating'])
        .order('detected_at', { ascending: false })
        .limit(100);

      if (error || !data) {
        return {
          total: 0,
          bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
          byType: {},
          topAgents: [],
        };
      }

      const bySeverity: Record<AnomalySeverity, number> = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      };
      const byType: Record<string, number> = {};
      const byAgent: Record<string, number> = {};

      for (const anomaly of data) {
        bySeverity[anomaly.severity as AnomalySeverity]++;
        byType[anomaly.anomaly_type] = (byType[anomaly.anomaly_type] || 0) + 1;
        byAgent[anomaly.agent_id] = (byAgent[anomaly.agent_id] || 0) + 1;
      }

      const topAgents = Object.entries(byAgent)
        .map(([agentId, count]) => ({ agentId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        total: data.length,
        bySeverity,
        byType,
        topAgents,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get anomaly summary');
      return {
        total: 0,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        byType: {},
        topAgents: [],
      };
    }
  }

  /**
   * Format anomalies for user display
   */
  formatAnomaliesForUser(anomalies: DetectedAnomaly[]): string {
    if (anomalies.length === 0) {
      return '';
    }

    const lines: string[] = ['⚠️ Execution Anomalies Detected:'];

    for (const anomaly of anomalies) {
      const icon = this.getSeverityIcon(anomaly.severity);
      const typeLabel = this.getTypeLabel(anomaly.type);
      const deviation = anomaly.deviationPercent.toFixed(0);

      lines.push(`${icon} ${typeLabel}: ${deviation}% above baseline`);

      if (anomaly.plugin) {
        lines.push(`   Plugin: ${anomaly.plugin}${anomaly.action ? ` / ${anomaly.action}` : ''}`);
      }
    }

    return lines.join('\n');
  }

  // ============ Private Methods ============

  /**
   * Detect anomalies against baseline
   */
  private detectAnomalies(
    baseline: ExecutionBaseline,
    input: DetectAnomalyInput,
    config: BaselineConfig
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    const zscoreThreshold = config.zscore_threshold;
    const stepDeviationThreshold = config.step_deviation_threshold;
    const retryDeviationThreshold = config.retry_deviation_threshold;

    // Duration anomaly
    if (baseline.stddev_duration_ms > 0) {
      const zScore = (input.durationMs - baseline.avg_duration_ms) / baseline.stddev_duration_ms;
      const deviationPercent =
        ((input.durationMs - baseline.avg_duration_ms) / baseline.avg_duration_ms) * 100;

      if (zScore > zscoreThreshold) {
        anomalies.push({
          type: 'duration_spike',
          severity: this.getSeverityFromZScore(zScore, config),
          baselineValue: baseline.avg_duration_ms,
          actualValue: input.durationMs,
          zScore,
          deviationPercent,
        });
      }
    }

    // Token anomaly
    if (baseline.stddev_token_usage > 0) {
      const zScore = (input.tokenUsage - baseline.avg_token_usage) / baseline.stddev_token_usage;
      const deviationPercent =
        ((input.tokenUsage - baseline.avg_token_usage) / baseline.avg_token_usage) * 100;

      if (zScore > zscoreThreshold) {
        anomalies.push({
          type: 'token_spike',
          severity: this.getSeverityFromZScore(zScore, config),
          baselineValue: baseline.avg_token_usage,
          actualValue: input.tokenUsage,
          zScore,
          deviationPercent,
        });
      }
    }

    // Step count anomaly
    if (baseline.avg_step_count > 0) {
      const deviationPercent =
        ((input.stepCount - baseline.avg_step_count) / baseline.avg_step_count) * 100;

      if (deviationPercent > stepDeviationThreshold) {
        anomalies.push({
          type: 'step_count_increase',
          severity: this.getSeverityFromDeviation(deviationPercent),
          baselineValue: baseline.avg_step_count,
          actualValue: input.stepCount,
          zScore: null,
          deviationPercent,
        });
      }
    }

    // Retry spike
    if (baseline.avg_retry_count > 0) {
      const deviationPercent =
        ((input.retryCount - baseline.avg_retry_count) / baseline.avg_retry_count) * 100;

      if (deviationPercent > retryDeviationThreshold) {
        anomalies.push({
          type: 'retry_spike',
          severity: this.getSeverityFromDeviation(deviationPercent / 2),
          baselineValue: baseline.avg_retry_count,
          actualValue: input.retryCount,
          zScore: null,
          deviationPercent,
        });
      }
    }

    return anomalies;
  }

  /**
   * Record anomaly to database
   */
  private async recordAnomaly(
    input: DetectAnomalyInput,
    anomaly: DetectedAnomaly
  ): Promise<void> {
    await this.supabase.rpc('record_execution_anomaly', {
      p_agent_id: input.agentId,
      p_execution_id: input.executionId,
      p_user_id: input.userId,
      p_anomaly_type: anomaly.type,
      p_severity: anomaly.severity,
      p_baseline_value: anomaly.baselineValue,
      p_actual_value: anomaly.actualValue,
      p_z_score: anomaly.zScore,
      p_deviation_percent: anomaly.deviationPercent,
      p_plugin: anomaly.plugin || null,
      p_action: anomaly.action || null,
      p_step_index: anomaly.stepIndex || null,
    });
  }

  private getSeverityFromZScore(zScore: number, config: BaselineConfig): AnomalySeverity {
    if (zScore > config.zscore_critical) return 'critical';
    if (zScore > (config.zscore_critical + config.zscore_warning) / 2) return 'high';
    if (zScore > config.zscore_warning) return 'medium';
    return 'low';
  }

  private getSeverityFromDeviation(deviationPercent: number): AnomalySeverity {
    if (deviationPercent > 200) return 'high';
    if (deviationPercent > 100) return 'medium';
    return 'low';
  }

  private getSeverityIcon(severity: AnomalySeverity): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      default:
        return '🟢';
    }
  }

  private getTypeLabel(type: AnomalyType): string {
    switch (type) {
      case 'duration_spike':
        return 'Duration Spike';
      case 'token_spike':
        return 'Token Usage Spike';
      case 'error_rate_increase':
        return 'Error Rate Increase';
      case 'step_count_increase':
        return 'Step Count Increase';
      case 'retry_spike':
        return 'Retry Spike';
      default:
        return type;
    }
  }
}

// Singleton factory
let _instance: AnomalyDetector | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getAnomalyDetector(supabase: SupabaseClient): AnomalyDetector {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new AnomalyDetector(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
