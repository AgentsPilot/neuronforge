/**
 * TrendAnalyzer - Statistical trend analysis for business intelligence
 *
 * Analyzes execution metrics over time to detect:
 * - Volume changes (week-over-week, month-over-month)
 * - Anomalies (spikes, drops - 2+ standard deviations)
 * - Category distribution shifts (field presence changes)
 * - Performance degradation (duration increases)
 * - Operational health (empty results, failures)
 *
 * CRITICAL: Pure statistical analysis - NO LLM calls
 * This is the foundation for BusinessInsightGenerator
 *
 * @module lib/pilot/insight/TrendAnalyzer
 */

import { createLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExecutionMetrics } from '../MetricsCollector';
import { MetricDetector, type DetectedMetric } from './MetricDetector';

const logger = createLogger({ module: 'TrendAnalyzer', service: 'business-intelligence' });

/**
 * Trend metrics calculated from historical execution data
 */
export interface TrendMetrics {
  // Volume trends
  volume_change_7d: number;  // % change week-over-week (-1.0 to +∞)
  volume_change_30d: number;  // % change month-over-month (-1.0 to +∞)
  is_volume_spike: boolean;  // 2+ std deviations above mean
  is_volume_drop: boolean;   // 2+ std deviations below mean

  // Category distribution (field presence)
  category_distribution: Record<string, number>;  // {"has_priority": 0.27} (27% have priority)
  category_shift_7d: Record<string, number>;  // {"has_priority": +0.12} (12% increase)

  // Performance trends
  avg_duration_ms: number;
  duration_change_7d: number;  // % change in processing time

  // Operational health
  empty_result_rate: number;  // % of executions with 0 results
  failure_rate: number;  // % of executions that failed

  // Baseline for comparison
  baseline: {
    avg_items_per_execution: number;
    avg_duration_ms: number;
    typical_category_distribution: Record<string, number>;
  };

  // Business metric detection
  detected_metric?: DetectedMetric;  // Auto-detected business metric step
  metric_value_recent: number;  // Recent average for detected metric
  metric_value_historical: number;  // Historical average for detected metric

  // Data quality
  data_points: number;  // Number of executions analyzed
  confidence: 'low' | 'medium' | 'high';  // Based on data quantity
}

/**
 * Execution metrics from database (extended with timestamp)
 */
export interface ExecutionMetricsRecord extends ExecutionMetrics {
  id: string;
  agent_id: string;
  execution_id: string;
  executed_at: string;
  created_at: string;
}

export class TrendAnalyzer {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Analyze trends for an agent
   *
   * Minimum requirement: 7 executions (need week-over-week comparison)
   *
   * @param agentId - Agent ID to analyze
   * @param windowDays - Historical window in days (default: 30)
   * @returns Trend metrics or null if insufficient data
   */
  async analyzeTrends(agentId: string, windowDays: number = 30): Promise<TrendMetrics | null> {
    const startTime = Date.now();

    logger.info({ agentId, windowDays }, 'Starting trend analysis');

    // Fetch recent metrics from database
    const metrics = await this.fetchRecentMetrics(agentId, windowDays);

    if (metrics.length < 7) {
      logger.info({
        agentId,
        dataPoints: metrics.length,
        required: 7,
      }, 'Insufficient data for trend analysis (need 7+ executions)');
      return null;
    }

    // Auto-detect business metric step from most recent execution
    const metricDetector = new MetricDetector(this.supabase);
    let detectedMetric: DetectedMetric | undefined;
    let metricValueRecent = 0;
    let metricValueHistorical = 0;

    if (metrics[0].step_metrics && metrics[0].step_metrics.length > 0) {
      detectedMetric = await metricDetector.detectBusinessMetricStep(
        metrics[0].step_metrics as any,
        agentId
      );

      // Calculate recent and historical averages for detected metric
      const recentEnd = Math.min(7, Math.ceil(metrics.length / 2));
      const recentValues = metrics.slice(0, recentEnd).map(m =>
        metricDetector.extractMetricValue(m, detectedMetric!)
      );

      const baselineStart = Math.min(7, Math.floor(metrics.length / 2));
      const historicalValues = metrics.slice(baselineStart).map(m =>
        metricDetector.extractMetricValue(m, detectedMetric!)
      );

      metricValueRecent = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
      metricValueHistorical = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;

      logger.info({
        agentId,
        detectedStep: detectedMetric.step.step_name,
        confidence: detectedMetric.confidence,
        method: detectedMetric.detection_method,
        recentAvg: metricValueRecent,
        historicalAvg: metricValueHistorical,
      }, '✅ Business metric detected and calculated');
    }

    // Helper function to extract metric values (defined outside if block for use throughout)
    const getMetricValue = (m: ExecutionMetricsRecord): number => {
      if (!detectedMetric) {
        return m.total_items || 0;
      }
      return metricDetector.extractMetricValue(m, detectedMetric);
    };

    // Calculate baseline (days 8-30, or older half if less than 30 days)
    const baselineStart = Math.min(7, Math.floor(metrics.length / 2));
    const baseline = this.calculateBaseline(metrics.slice(baselineStart));

    // Calculate recent metrics (last 7 days, or newer half)
    const recentEnd = Math.min(7, Math.ceil(metrics.length / 2));
    const recent = this.calculateRecent(metrics.slice(0, recentEnd));

    // Detect volume changes
    // ✅ CRITICAL FIX: Use detected metric values instead of total_items
    const volumeChange7d = this.calculatePercentChange(
      metricValueRecent,  // Use detected metric average
      metricValueHistorical  // Use detected metric historical average
    );

    // For month-over-month, compare first 7 days to last 7 days
    const oldestValues = metrics.slice(-7).map(getMetricValue);
    const oldestAvg = oldestValues.reduce((a, b) => a + b, 0) / oldestValues.length;
    const volumeChange30d = this.calculatePercentChange(
      metricValueRecent,  // Use detected metric average
      oldestAvg  // Use detected metric 30-day-ago average
    );

    // Detect anomalies (2+ standard deviations)
    // Use detected metric values, not total_items
    const volumeStdDev = this.calculateStdDev(metrics.map(getMetricValue));
    const volumeMean = metricValueHistorical;  // Use detected metric historical average
    const isVolumeSpike = metricValueRecent > volumeMean + (2 * volumeStdDev);
    const isVolumeDrop = metricValueRecent < volumeMean - (2 * volumeStdDev);

    // Calculate category distribution shifts
    const categoryShift = this.calculateDistributionShift(
      recent.category_distribution,
      baseline.typical_category_distribution
    );

    // Calculate confidence based on data quantity
    const confidence = this.calculateConfidence(metrics.length);

    const trends: TrendMetrics = {
      volume_change_7d: volumeChange7d,
      volume_change_30d: volumeChange30d,
      is_volume_spike: isVolumeSpike,
      is_volume_drop: isVolumeDrop,
      category_distribution: recent.category_distribution,
      category_shift_7d: categoryShift,
      avg_duration_ms: recent.avg_duration_ms,
      duration_change_7d: this.calculatePercentChange(
        recent.avg_duration_ms,
        baseline.avg_duration_ms
      ),
      empty_result_rate: recent.empty_result_rate,
      failure_rate: recent.failure_rate,
      baseline: {
        // ✅ CRITICAL FIX: Use detected metric value instead of total_items
        avg_items_per_execution: metricValueHistorical,
        avg_duration_ms: baseline.avg_duration_ms,
        typical_category_distribution: baseline.typical_category_distribution,
      },
      detected_metric: detectedMetric,
      metric_value_recent: metricValueRecent,
      metric_value_historical: metricValueHistorical,
      data_points: metrics.length,
      confidence,
    };

    const analysisTime = Date.now() - startTime;
    logger.info({
      agentId,
      dataPoints: metrics.length,
      volumeChange7d: `${(volumeChange7d * 100).toFixed(1)}%`,
      volumeChange30d: `${(volumeChange30d * 100).toFixed(1)}%`,
      isVolumeSpike,
      isVolumeDrop,
      confidence,
      analysisTimeMs: analysisTime,
    }, 'Trend analysis complete');

    return trends;
  }

  /**
   * Fetch recent execution metrics from database
   */
  private async fetchRecentMetrics(
    agentId: string,
    windowDays: number
  ): Promise<ExecutionMetricsRecord[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - windowDays);

    const { data, error } = await this.supabase
      .from('execution_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .gte('executed_at', cutoffDate.toISOString())
      .order('executed_at', { ascending: false });

    if (error) {
      logger.error({ err: error, agentId }, 'Failed to fetch execution metrics');
      throw error;
    }

    logger.debug({
      agentId,
      windowDays,
      recordsFound: data?.length || 0,
    }, 'Fetched execution metrics');

    return (data as ExecutionMetricsRecord[]) || [];
  }

  /**
   * Calculate baseline metrics (older period for comparison)
   */
  private calculateBaseline(metrics: ExecutionMetricsRecord[]) {
    if (metrics.length === 0) {
      return {
        avg_items_per_execution: 0,
        avg_duration_ms: 0,
        typical_category_distribution: {},
      };
    }

    const totalItems = metrics.reduce((sum, m) => sum + m.total_items, 0);
    const avgItems = totalItems / metrics.length;

    const totalDuration = metrics.reduce((sum, m) => sum + (m.duration_ms || 0), 0);
    const avgDuration = totalDuration / metrics.length;

    const categoryDistribution = this.aggregateCategoryDistribution(metrics);

    return {
      avg_items_per_execution: avgItems,
      avg_duration_ms: avgDuration,
      typical_category_distribution: categoryDistribution,
    };
  }

  /**
   * Calculate recent metrics (newer period)
   */
  private calculateRecent(metrics: ExecutionMetricsRecord[]) {
    const baseline = this.calculateBaseline(metrics);

    // Calculate empty result rate
    const emptyCount = metrics.filter(m => m.has_empty_results).length;
    const emptyRate = emptyCount / metrics.length;

    // Calculate failure rate
    const failureCount = metrics.reduce((sum, m) => sum + m.failed_step_count, 0);
    const totalSteps = metrics.length; // Approximate - each execution is 1+ steps
    const failureRate = failureCount / totalSteps;

    return {
      avg_items_per_execution: baseline.avg_items_per_execution,
      avg_duration_ms: baseline.avg_duration_ms,
      category_distribution: baseline.typical_category_distribution,
      empty_result_rate: emptyRate,
      failure_rate: failureRate,
    };
  }

  /**
   * Aggregate category distribution across multiple executions
   *
   * Returns percentage of items that have each field
   *
   * Example:
   *   Input: [
   *     {total_items: 10, items_by_field: {has_priority: 8}},
   *     {total_items: 10, items_by_field: {has_priority: 6}}
   *   ]
   *   Output: {has_priority: 0.7} (70% of items have priority)
   */
  private aggregateCategoryDistribution(
    metrics: ExecutionMetricsRecord[]
  ): Record<string, number> {
    const distribution: Record<string, number> = {};

    if (metrics.length === 0) return distribution;

    // Collect all field keys
    const allFields = new Set<string>();
    metrics.forEach(m => {
      Object.keys(m.items_by_field || {}).forEach(field => allFields.add(field));
    });

    // Calculate average percentage for each field
    for (const field of allFields) {
      let totalPercentage = 0;
      let validCount = 0;

      for (const metric of metrics) {
        const fieldCount = (metric.items_by_field || {})[field] || 0;
        if (metric.total_items > 0) {
          totalPercentage += fieldCount / metric.total_items;
          validCount++;
        }
      }

      distribution[field] = validCount > 0 ? totalPercentage / validCount : 0;
    }

    return distribution;
  }

  /**
   * Calculate percent change between two values
   *
   * Returns -1.0 to +∞ (e.g., -0.4 = -40%, 0.5 = +50%, 1.0 = +100%)
   */
  private calculatePercentChange(current: number, baseline: number): number {
    if (baseline === 0) {
      return current > 0 ? 1.0 : 0;  // 100% increase from zero, or no change
    }

    return (current - baseline) / baseline;
  }

  /**
   * Calculate standard deviation of a dataset
   */
  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;

    return Math.sqrt(variance);
  }

  /**
   * Calculate category distribution shift
   *
   * Returns change in percentage for each field
   *
   * Example:
   *   Current: {has_priority: 0.80} (80% have priority)
   *   Baseline: {has_priority: 0.68} (68% have priority)
   *   Result: {has_priority: +0.12} (12 percentage point increase)
   */
  private calculateDistributionShift(
    current: Record<string, number>,
    baseline: Record<string, number>
  ): Record<string, number> {
    const shift: Record<string, number> = {};

    // Get all fields from both distributions
    const allFields = new Set([
      ...Object.keys(current),
      ...Object.keys(baseline),
    ]);

    for (const field of allFields) {
      const currentValue = current[field] || 0;
      const baselineValue = baseline[field] || 0;
      shift[field] = currentValue - baselineValue;
    }

    return shift;
  }

  /**
   * Calculate confidence level based on data quantity
   */
  private calculateConfidence(dataPoints: number): 'low' | 'medium' | 'high' {
    if (dataPoints < 10) return 'low';
    if (dataPoints < 20) return 'medium';
    return 'high';
  }
}
