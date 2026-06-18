/**
 * PredictiveAnalytics - Trend Forecasting and Predictions
 *
 * Provides forward-looking analytics using statistical analysis
 * of historical execution data. All predictions use universal
 * metrics that work for ANY workflow type.
 *
 * Prediction Types:
 * 1. Execution volume forecast
 * 2. Success rate trend
 * 3. Processing time trend
 * 4. Value delivered projection
 * 5. Capacity utilization (approaching limits)
 *
 * @module lib/pilot/insight/PredictiveAnalytics
 */

import { createLogger } from '@/lib/logger';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'PredictiveAnalytics' });

// ============================================================================
// Types
// ============================================================================

/**
 * Trend direction
 */
export type TrendDirection = 'increasing' | 'stable' | 'decreasing';

/**
 * Prediction for a specific metric
 */
export interface Prediction {
  /** Identifier for the metric */
  metric_name: string;
  /** User-friendly label */
  metric_label: string;
  /** Current value (last data point) */
  current_value: number;
  /** Predicted value in 30 days */
  predicted_value_30d: number;
  /** Predicted value in 90 days */
  predicted_value_90d: number;
  /** Confidence interval [lower, upper] */
  confidence_interval: [number, number];
  /** Overall trend direction */
  trend: TrendDirection;
  /** Rate of change per day */
  change_rate_per_day: number;
  /** Date when alert threshold will be breached (if applicable) */
  alert_threshold_breach_date?: string;
  /** Unit for the values */
  unit: 'count' | 'seconds' | 'percentage' | 'milliseconds';
  /** Data points used for prediction */
  data_points: number;
  /** Confidence in the prediction (0-1) */
  confidence: number;
}

/**
 * Full prediction report for a workflow or portfolio
 */
export interface PredictionReport {
  generated_at: string;
  scope: {
    type: 'agent' | 'organization' | 'group';
    id: string;
    name: string;
  };
  predictions: Prediction[];
  alerts: PredictionAlert[];
  summary: string;
}

/**
 * Alert for concerning predictions
 */
export interface PredictionAlert {
  metric_name: string;
  alert_type: 'threshold_breach' | 'degradation' | 'capacity_limit';
  severity: 'warning' | 'critical';
  message: string;
  predicted_date: string;
  current_value: number;
  predicted_value: number;
}

/**
 * Historical data point for analysis
 */
interface DataPoint {
  date: Date;
  value: number;
}

/**
 * Configuration for predictions
 */
export interface PredictiveAnalyticsConfig {
  /** Minimum data points required for prediction */
  minDataPoints?: number;
  /** Look-back period in days */
  lookBackDays?: number;
  /** Success rate warning threshold */
  successRateWarningThreshold?: number;
  /** Success rate critical threshold */
  successRateCriticalThreshold?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<PredictiveAnalyticsConfig> = {
  minDataPoints: 7,
  lookBackDays: 90,
  successRateWarningThreshold: 0.9,
  successRateCriticalThreshold: 0.7,
};

// ============================================================================
// Main Class
// ============================================================================

export class PredictiveAnalytics {
  private supabase: SupabaseClient;
  private config: Required<PredictiveAnalyticsConfig>;

  constructor(
    supabaseClient?: SupabaseClient,
    config?: PredictiveAnalyticsConfig
  ) {
    this.supabase = supabaseClient || defaultSupabase;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate predictions for a single workflow
   */
  async predictForAgent(agentId: string, agentName: string): Promise<PredictionReport> {
    const startTime = Date.now();

    logger.info({ agentId }, 'Generating predictions for agent');

    // Fetch historical metrics
    const metrics = await this.fetchAgentMetrics(agentId);

    if (metrics.length < this.config.minDataPoints) {
      return this.insufficientDataReport(agentId, agentName, 'agent', metrics.length);
    }

    // Generate predictions
    const predictions = this.generatePredictions(metrics);
    const alerts = this.generateAlerts(predictions);

    logger.info({
      agentId,
      duration: Date.now() - startTime,
      predictionCount: predictions.length,
      alertCount: alerts.length,
    }, 'Agent predictions generated');

    return {
      generated_at: new Date().toISOString(),
      scope: {
        type: 'agent',
        id: agentId,
        name: agentName,
      },
      predictions,
      alerts,
      summary: this.generateSummary(predictions, alerts),
    };
  }

  /**
   * Generate predictions for an entire organization
   */
  async predictForOrganization(orgId: string, orgName: string): Promise<PredictionReport> {
    const startTime = Date.now();

    logger.info({ orgId }, 'Generating predictions for organization');

    // Fetch aggregated metrics
    const metrics = await this.fetchOrgMetrics(orgId);

    if (metrics.length < this.config.minDataPoints) {
      return this.insufficientDataReport(orgId, orgName, 'organization', metrics.length);
    }

    // Generate predictions
    const predictions = this.generatePredictions(metrics);
    const alerts = this.generateAlerts(predictions);

    logger.info({
      orgId,
      duration: Date.now() - startTime,
      predictionCount: predictions.length,
      alertCount: alerts.length,
    }, 'Organization predictions generated');

    return {
      generated_at: new Date().toISOString(),
      scope: {
        type: 'organization',
        id: orgId,
        name: orgName,
      },
      predictions,
      alerts,
      summary: this.generateSummary(predictions, alerts),
    };
  }

  /**
   * Generate predictions for a user-defined group
   */
  async predictForGroup(groupId: string, groupName: string): Promise<PredictionReport> {
    const startTime = Date.now();

    logger.info({ groupId }, 'Generating predictions for group');

    // Fetch group agent IDs
    const { data: memberships } = await this.supabase
      .from('agent_group_memberships')
      .select('agent_id')
      .eq('group_id', groupId);

    const agentIds = memberships?.map(m => m.agent_id) || [];

    if (agentIds.length === 0) {
      return this.insufficientDataReport(groupId, groupName, 'group', 0);
    }

    // Fetch aggregated metrics for group agents
    const metrics = await this.fetchGroupMetrics(agentIds);

    if (metrics.length < this.config.minDataPoints) {
      return this.insufficientDataReport(groupId, groupName, 'group', metrics.length);
    }

    // Generate predictions
    const predictions = this.generatePredictions(metrics);
    const alerts = this.generateAlerts(predictions);

    logger.info({
      groupId,
      duration: Date.now() - startTime,
      predictionCount: predictions.length,
      alertCount: alerts.length,
    }, 'Group predictions generated');

    return {
      generated_at: new Date().toISOString(),
      scope: {
        type: 'group',
        id: groupId,
        name: groupName,
      },
      predictions,
      alerts,
      summary: this.generateSummary(predictions, alerts),
    };
  }

  // ============================================================================
  // Data Fetching
  // ============================================================================

  private async fetchAgentMetrics(agentId: string): Promise<Map<string, DataPoint[]>> {
    const lookBackDate = new Date();
    lookBackDate.setDate(lookBackDate.getDate() - this.config.lookBackDays);

    const { data, error } = await this.supabase
      .from('execution_metrics')
      .select('executed_at, total_items, time_saved_seconds, failed_step_count, success_step_count, execution_duration_ms')
      .eq('agent_id', agentId)
      .gte('executed_at', lookBackDate.toISOString())
      .order('executed_at', { ascending: true });

    if (error) {
      logger.error({ err: error, agentId }, 'Failed to fetch agent metrics');
      return new Map();
    }

    return this.aggregateMetricsByDay(data || []);
  }

  private async fetchOrgMetrics(orgId: string): Promise<Map<string, DataPoint[]>> {
    const lookBackDate = new Date();
    lookBackDate.setDate(lookBackDate.getDate() - this.config.lookBackDays);

    // First get agent IDs for org
    const { data: agents } = await this.supabase
      .from('agents')
      .select('id')
      .eq('org_id', orgId)
      .neq('status', 'deleted');

    if (!agents || agents.length === 0) {
      return new Map();
    }

    const agentIds = agents.map(a => a.id);

    const { data, error } = await this.supabase
      .from('execution_metrics')
      .select('executed_at, total_items, time_saved_seconds, failed_step_count, success_step_count, execution_duration_ms')
      .in('agent_id', agentIds)
      .gte('executed_at', lookBackDate.toISOString())
      .order('executed_at', { ascending: true });

    if (error) {
      logger.error({ err: error, orgId }, 'Failed to fetch org metrics');
      return new Map();
    }

    return this.aggregateMetricsByDay(data || []);
  }

  private async fetchGroupMetrics(agentIds: string[]): Promise<Map<string, DataPoint[]>> {
    const lookBackDate = new Date();
    lookBackDate.setDate(lookBackDate.getDate() - this.config.lookBackDays);

    const { data, error } = await this.supabase
      .from('execution_metrics')
      .select('executed_at, total_items, time_saved_seconds, failed_step_count, success_step_count, execution_duration_ms')
      .in('agent_id', agentIds)
      .gte('executed_at', lookBackDate.toISOString())
      .order('executed_at', { ascending: true });

    if (error) {
      logger.error({ err: error }, 'Failed to fetch group metrics');
      return new Map();
    }

    return this.aggregateMetricsByDay(data || []);
  }

  private aggregateMetricsByDay(data: any[]): Map<string, DataPoint[]> {
    const metrics = new Map<string, DataPoint[]>();

    // Initialize metric arrays
    metrics.set('execution_volume', []);
    metrics.set('success_rate', []);
    metrics.set('avg_duration', []);
    metrics.set('time_saved', []);
    metrics.set('items_processed', []);

    // Group by day
    const byDay = new Map<string, any[]>();
    data.forEach(record => {
      const day = record.executed_at.slice(0, 10);
      const existing = byDay.get(day) || [];
      existing.push(record);
      byDay.set(day, existing);
    });

    // Aggregate each day
    byDay.forEach((records, day) => {
      const date = new Date(day);

      // Volume
      metrics.get('execution_volume')!.push({
        date,
        value: records.length,
      });

      // Success rate
      let totalSteps = 0;
      let successSteps = 0;
      records.forEach(r => {
        totalSteps += (r.failed_step_count || 0) + (r.success_step_count || 0);
        successSteps += r.success_step_count || 0;
      });
      metrics.get('success_rate')!.push({
        date,
        value: totalSteps > 0 ? successSteps / totalSteps : 1,
      });

      // Avg duration
      const totalDuration = records.reduce((sum, r) => sum + (r.execution_duration_ms || 0), 0);
      metrics.get('avg_duration')!.push({
        date,
        value: records.length > 0 ? totalDuration / records.length : 0,
      });

      // Time saved
      const totalTimeSaved = records.reduce((sum, r) => sum + (r.time_saved_seconds || 0), 0);
      metrics.get('time_saved')!.push({
        date,
        value: totalTimeSaved,
      });

      // Items processed
      const totalItems = records.reduce((sum, r) => sum + (r.total_items || 0), 0);
      metrics.get('items_processed')!.push({
        date,
        value: totalItems,
      });
    });

    return metrics;
  }

  // ============================================================================
  // Prediction Generation
  // ============================================================================

  private generatePredictions(metricsMap: Map<string, DataPoint[]>): Prediction[] {
    const predictions: Prediction[] = [];

    const metricConfigs: Array<{
      name: string;
      label: string;
      unit: Prediction['unit'];
    }> = [
      { name: 'execution_volume', label: 'Daily Executions', unit: 'count' },
      { name: 'success_rate', label: 'Success Rate', unit: 'percentage' },
      { name: 'avg_duration', label: 'Average Duration', unit: 'milliseconds' },
      { name: 'time_saved', label: 'Time Saved', unit: 'seconds' },
      { name: 'items_processed', label: 'Items Processed', unit: 'count' },
    ];

    metricConfigs.forEach(config => {
      const dataPoints = metricsMap.get(config.name) || [];
      if (dataPoints.length < this.config.minDataPoints) return;

      const prediction = this.predictMetric(
        config.name,
        config.label,
        config.unit,
        dataPoints
      );

      if (prediction) {
        predictions.push(prediction);
      }
    });

    return predictions;
  }

  private predictMetric(
    name: string,
    label: string,
    unit: Prediction['unit'],
    dataPoints: DataPoint[]
  ): Prediction | null {
    if (dataPoints.length < 2) return null;

    // Sort by date
    const sorted = [...dataPoints].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Get current value (most recent)
    const currentValue = sorted[sorted.length - 1].value;

    // Calculate linear regression
    const { slope, intercept, rSquared } = this.linearRegression(sorted);

    // Calculate predictions
    const now = new Date();
    const days30 = 30;
    const days90 = 90;

    const daysSinceStart = (now.getTime() - sorted[0].date.getTime()) / (1000 * 60 * 60 * 24);

    const predicted30 = intercept + slope * (daysSinceStart + days30);
    const predicted90 = intercept + slope * (daysSinceStart + days90);

    // Calculate confidence interval based on variance
    const variance = this.calculateVariance(sorted.map(d => d.value));
    const stdDev = Math.sqrt(variance);
    const marginOfError = stdDev * 1.96; // 95% confidence

    // Determine trend
    const trend = this.determineTrend(slope, currentValue);

    // Calculate confidence based on R² and data points
    const confidence = Math.min(0.95, rSquared * 0.7 + (sorted.length / 100) * 0.3);

    return {
      metric_name: name,
      metric_label: label,
      current_value: this.roundValue(currentValue, unit),
      predicted_value_30d: this.roundValue(Math.max(0, predicted30), unit),
      predicted_value_90d: this.roundValue(Math.max(0, predicted90), unit),
      confidence_interval: [
        this.roundValue(Math.max(0, predicted30 - marginOfError), unit),
        this.roundValue(predicted30 + marginOfError, unit),
      ],
      trend,
      change_rate_per_day: this.roundValue(slope, unit),
      unit,
      data_points: sorted.length,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  private linearRegression(dataPoints: DataPoint[]): {
    slope: number;
    intercept: number;
    rSquared: number;
  } {
    const n = dataPoints.length;
    if (n < 2) return { slope: 0, intercept: 0, rSquared: 0 };

    // Convert dates to numeric (days since first date)
    const firstDate = dataPoints[0].date.getTime();
    const xValues = dataPoints.map(d => (d.date.getTime() - firstDate) / (1000 * 60 * 60 * 24));
    const yValues = dataPoints.map(d => d.value);

    // Calculate means
    const xMean = xValues.reduce((a, b) => a + b, 0) / n;
    const yMean = yValues.reduce((a, b) => a + b, 0) / n;

    // Calculate slope
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
      denominator += (xValues[i] - xMean) ** 2;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Calculate R²
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * xValues[i];
      ssRes += (yValues[i] - predicted) ** 2;
      ssTot += (yValues[i] - yMean) ** 2;
    }

    const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

    return { slope, intercept, rSquared: Math.max(0, rSquared) };
  }

  private calculateVariance(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / n;
    return values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / n;
  }

  private determineTrend(slope: number, currentValue: number): TrendDirection {
    // Relative change threshold
    const threshold = currentValue * 0.01; // 1% of current value

    if (slope > threshold) return 'increasing';
    if (slope < -threshold) return 'decreasing';
    return 'stable';
  }

  private roundValue(value: number, unit: Prediction['unit']): number {
    if (unit === 'percentage') {
      return Math.round(value * 1000) / 1000; // 3 decimal places
    }
    return Math.round(value * 100) / 100; // 2 decimal places
  }

  // ============================================================================
  // Alert Generation
  // ============================================================================

  private generateAlerts(predictions: Prediction[]): PredictionAlert[] {
    const alerts: PredictionAlert[] = [];

    predictions.forEach(prediction => {
      // Check success rate degradation
      if (prediction.metric_name === 'success_rate') {
        if (prediction.predicted_value_30d < this.config.successRateCriticalThreshold) {
          alerts.push({
            metric_name: prediction.metric_name,
            alert_type: 'degradation',
            severity: 'critical',
            message: `Success rate predicted to drop to ${(prediction.predicted_value_30d * 100).toFixed(1)}% in 30 days`,
            predicted_date: this.addDays(new Date(), 30).toISOString(),
            current_value: prediction.current_value,
            predicted_value: prediction.predicted_value_30d,
          });
        } else if (prediction.predicted_value_30d < this.config.successRateWarningThreshold) {
          alerts.push({
            metric_name: prediction.metric_name,
            alert_type: 'degradation',
            severity: 'warning',
            message: `Success rate trending down - may fall below ${(this.config.successRateWarningThreshold * 100).toFixed(0)}%`,
            predicted_date: this.addDays(new Date(), 30).toISOString(),
            current_value: prediction.current_value,
            predicted_value: prediction.predicted_value_30d,
          });
        }
      }

      // Check for rapid decline (more than 50% drop predicted)
      if (prediction.trend === 'decreasing' &&
          prediction.predicted_value_30d < prediction.current_value * 0.5) {
        alerts.push({
          metric_name: prediction.metric_name,
          alert_type: 'degradation',
          severity: 'warning',
          message: `${prediction.metric_label} predicted to decline significantly`,
          predicted_date: this.addDays(new Date(), 30).toISOString(),
          current_value: prediction.current_value,
          predicted_value: prediction.predicted_value_30d,
        });
      }
    });

    return alerts;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private insufficientDataReport(
    id: string,
    name: string,
    type: 'agent' | 'organization' | 'group',
    dataPoints: number
  ): PredictionReport {
    return {
      generated_at: new Date().toISOString(),
      scope: { type, id, name },
      predictions: [],
      alerts: [],
      summary: `Insufficient data for predictions. Need at least ${this.config.minDataPoints} days of data, currently have ${dataPoints}.`,
    };
  }

  private generateSummary(predictions: Prediction[], alerts: PredictionAlert[]): string {
    if (predictions.length === 0) {
      return 'No predictions available.';
    }

    const parts: string[] = [];

    // Volume trend
    const volumePrediction = predictions.find(p => p.metric_name === 'execution_volume');
    if (volumePrediction) {
      parts.push(`Execution volume is ${volumePrediction.trend}.`);
    }

    // Success rate
    const successPrediction = predictions.find(p => p.metric_name === 'success_rate');
    if (successPrediction) {
      const pct = (successPrediction.current_value * 100).toFixed(1);
      parts.push(`Success rate at ${pct}%, ${successPrediction.trend}.`);
    }

    // Alerts
    if (alerts.length > 0) {
      parts.push(`${alerts.length} alert(s) require attention.`);
    }

    return parts.join(' ');
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let analyticsInstance: PredictiveAnalytics | null = null;

export function getPredictiveAnalytics(
  supabaseClient?: SupabaseClient,
  config?: PredictiveAnalyticsConfig
): PredictiveAnalytics {
  if (!analyticsInstance) {
    analyticsInstance = new PredictiveAnalytics(supabaseClient, config);
  }
  return analyticsInstance;
}

export { PredictiveAnalytics as default };
