/**
 * Baseline Calculator
 *
 * Computes historical baselines for metrics to enable relative threshold detection.
 * Key features:
 * - Minimum sample guards to avoid false positives with insufficient data
 * - Standard deviation calculation for statistical significance
 * - Configurable lookback windows
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { MetricKey, PeriodType, BaselineResult, DerivedMetric, getMetricDefinition } from './types';

const logger = createLogger({ service: 'BaselineCalculator' });

// Minimum samples required by period type
const MIN_SAMPLES_BY_PERIOD: Record<PeriodType, number> = {
  daily: 7,    // 7 days minimum
  weekly: 4,   // 4 weeks minimum
  monthly: 3,  // 3 months minimum
};

export class BaselineCalculator {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Compute baseline statistics for a metric
   */
  async computeBaseline(
    userId: string,
    metricKey: MetricKey,
    periodType: PeriodType,
    lookbackDays: number = 30
  ): Promise<BaselineResult> {
    try {
      const definition = getMetricDefinition(metricKey);
      const minSamples = definition?.minSamplesForBaseline || MIN_SAMPLES_BY_PERIOD[periodType];

      // Calculate lookback date
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

      // Fetch historical metrics
      const { data: metrics, error } = await this.supabase
        .from('derived_metrics')
        .select('value')
        .eq('user_id', userId)
        .eq('metric_key', metricKey)
        .eq('period_type', periodType)
        .gte('period_start', lookbackDate.toISOString())
        .order('period_start', { ascending: false });

      if (error) {
        logger.error({ err: error, userId, metricKey }, 'Failed to fetch metrics for baseline');
        return this.emptyBaseline();
      }

      if (!metrics || metrics.length === 0) {
        logger.debug({ userId, metricKey }, 'No historical data for baseline');
        return this.emptyBaseline();
      }

      const values = metrics.map((m) => Number(m.value));
      const sampleSize = values.length;

      // Calculate mean
      const mean = values.reduce((sum, v) => sum + v, 0) / sampleSize;

      // Calculate standard deviation
      const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
      const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / sampleSize;
      const stdDev = Math.sqrt(avgSquaredDiff);

      // Threshold is 2 standard deviations from mean
      const threshold = 2 * stdDev;

      // Check if we have enough samples for statistical significance
      const isSignificant = sampleSize >= minSamples;

      logger.debug(
        { userId, metricKey, mean, stdDev, sampleSize, isSignificant },
        'Computed baseline'
      );

      return {
        mean,
        stdDev,
        threshold,
        sampleSize,
        isSignificant,
      };
    } catch (error) {
      logger.error({ err: error, userId, metricKey }, 'Failed to compute baseline');
      return this.emptyBaseline();
    }
  }

  /**
   * Check if a value is outside the baseline threshold
   */
  async isOutsideBaseline(
    userId: string,
    metricKey: MetricKey,
    periodType: PeriodType,
    currentValue: number,
    direction: 'above' | 'below' | 'either' = 'either',
    lookbackDays: number = 30
  ): Promise<{ isOutside: boolean; baseline: BaselineResult; delta: number }> {
    const baseline = await this.computeBaseline(userId, metricKey, periodType, lookbackDays);

    if (!baseline.isSignificant) {
      // Not enough data for reliable detection
      return { isOutside: false, baseline, delta: 0 };
    }

    const delta = currentValue - baseline.mean;
    const absDeviation = Math.abs(delta);

    let isOutside = false;

    switch (direction) {
      case 'above':
        isOutside = delta > baseline.threshold;
        break;
      case 'below':
        isOutside = delta < -baseline.threshold;
        break;
      case 'either':
        isOutside = absDeviation > baseline.threshold;
        break;
    }

    return { isOutside, baseline, delta };
  }

  /**
   * Calculate percent change from baseline
   */
  async getPercentChange(
    userId: string,
    metricKey: MetricKey,
    periodType: PeriodType,
    currentValue: number,
    lookbackDays: number = 30
  ): Promise<{ percentChange: number | null; baseline: BaselineResult }> {
    const baseline = await this.computeBaseline(userId, metricKey, periodType, lookbackDays);

    if (!baseline.isSignificant || baseline.mean === 0) {
      return { percentChange: null, baseline };
    }

    const percentChange = ((currentValue - baseline.mean) / baseline.mean) * 100;

    return { percentChange, baseline };
  }

  /**
   * Get the most recent metric value
   */
  async getLatestMetricValue(
    userId: string,
    metricKey: MetricKey,
    periodType: PeriodType
  ): Promise<DerivedMetric | null> {
    try {
      const { data, error } = await this.supabase
        .from('derived_metrics')
        .select('*')
        .eq('user_id', userId)
        .eq('metric_key', metricKey)
        .eq('period_type', periodType)
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error({ err: error, userId, metricKey }, 'Failed to get latest metric');
      return null;
    }
  }

  /**
   * Compare two periods
   */
  async comparePeriods(
    userId: string,
    metricKey: MetricKey,
    periodType: PeriodType,
    currentPeriodStart: Date,
    previousPeriodStart: Date
  ): Promise<{
    currentValue: number | null;
    previousValue: number | null;
    delta: number | null;
    percentChange: number | null;
  }> {
    try {
      const { data: metrics, error } = await this.supabase
        .from('derived_metrics')
        .select('value, period_start')
        .eq('user_id', userId)
        .eq('metric_key', metricKey)
        .eq('period_type', periodType)
        .in('period_start', [currentPeriodStart.toISOString(), previousPeriodStart.toISOString()]);

      if (error) throw error;

      const currentMetric = metrics?.find(
        (m) => new Date(m.period_start).getTime() === currentPeriodStart.getTime()
      );
      const previousMetric = metrics?.find(
        (m) => new Date(m.period_start).getTime() === previousPeriodStart.getTime()
      );

      const currentValue = currentMetric ? Number(currentMetric.value) : null;
      const previousValue = previousMetric ? Number(previousMetric.value) : null;

      let delta: number | null = null;
      let percentChange: number | null = null;

      if (currentValue !== null && previousValue !== null) {
        delta = currentValue - previousValue;
        if (previousValue !== 0) {
          percentChange = (delta / previousValue) * 100;
        }
      }

      return { currentValue, previousValue, delta, percentChange };
    } catch (error) {
      logger.error({ err: error, userId, metricKey }, 'Failed to compare periods');
      return { currentValue: null, previousValue: null, delta: null, percentChange: null };
    }
  }

  /**
   * Return an empty baseline result for cases with no data
   */
  private emptyBaseline(): BaselineResult {
    return {
      mean: 0,
      stdDev: 0,
      threshold: 0,
      sampleSize: 0,
      isSignificant: false,
    };
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const baselineCalculator = new BaselineCalculator(supabaseServer);
