/**
 * Metrics Compute Service
 *
 * Computes derived metrics from business events.
 * Called by:
 * 1. Daily cron job to pre-compute metrics
 * 2. On-demand for real-time metric queries
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { PaymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { BusinessEventService } from '../events/BusinessEventService';
import { BusinessEventCategory, BusinessEventType } from '../events/types';
import {
  MetricKey,
  PeriodType,
  MetricUnit,
  DerivedMetric,
  MetricsServiceResult,
  METRIC_DEFINITIONS,
  getMetricDefinition,
} from './types';
import { BaselineCalculator } from './BaselineCalculator';

const logger = createLogger({ service: 'MetricsComputeService' });

interface ComputedMetricResult {
  value: number;
  unit: MetricUnit;
  sampleSize: number;
  breakdown?: Record<string, number>;
}

export class MetricsComputeService {
  private supabase: SupabaseClient;
  private eventService: BusinessEventService;
  private baselineCalculator: BaselineCalculator;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    this.eventService = new BusinessEventService(supabaseClient);
    this.baselineCalculator = new BaselineCalculator(supabaseClient);
  }

  /**
   * Compute and store all metrics for a user for a given period
   */
  async computeAllMetrics(
    userId: string,
    periodType: PeriodType,
    periodStart: Date,
    periodEnd: Date
  ): Promise<MetricsServiceResult<DerivedMetric[]>> {
    try {
      logger.info({ userId, periodType, periodStart, periodEnd }, 'Computing all metrics');

      const results: DerivedMetric[] = [];

      // Get metrics for this period type
      const metricsToCompute = METRIC_DEFINITIONS.filter((m) =>
        m.periodTypes.includes(periodType)
      );

      for (const definition of metricsToCompute) {
        try {
          const result = await this.computeAndStoreMetric(
            userId,
            definition.key,
            periodType,
            periodStart,
            periodEnd
          );

          if (result.data) {
            results.push(result.data);
          }
        } catch (error) {
          logger.error(
            { err: error, userId, metricKey: definition.key },
            'Failed to compute metric'
          );
          // Continue with other metrics
        }
      }

      logger.info(
        { userId, periodType, metricsComputed: results.length },
        'Completed computing metrics'
      );

      return { data: results, error: null };
    } catch (error) {
      logger.error({ err: error, userId, periodType }, 'Failed to compute all metrics');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Compute and store a single metric
   */
  async computeAndStoreMetric(
    userId: string,
    metricKey: MetricKey,
    periodType: PeriodType,
    periodStart: Date,
    periodEnd: Date
  ): Promise<MetricsServiceResult<DerivedMetric>> {
    try {
      const definition = getMetricDefinition(metricKey);
      if (!definition) {
        throw new Error(`Unknown metric key: ${metricKey}`);
      }

      // Compute the metric value
      const computed = await this.computeMetricValue(
        userId,
        definition,
        periodStart,
        periodEnd
      );

      // Get baseline for comparison
      const baseline = await this.baselineCalculator.computeBaseline(
        userId,
        metricKey,
        periodType,
        30 // 30-day lookback
      );

      // Calculate percent change if we have a significant baseline
      let percentChange: number | null = null;
      if (baseline.isSignificant && baseline.mean !== 0) {
        percentChange = ((computed.value - baseline.mean) / baseline.mean) * 100;
      }

      // Upsert the metric
      const { data, error } = await this.supabase
        .from('derived_metrics')
        .upsert(
          {
            user_id: userId,
            metric_key: metricKey,
            period_type: periodType,
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            value: computed.value,
            unit: computed.unit,
            baseline_value: baseline.isSignificant ? baseline.mean : null,
            baseline_period: baseline.isSignificant ? 'previous_30d' : null,
            percent_change: percentChange,
            sample_size: computed.sampleSize,
            std_deviation: baseline.isSignificant ? baseline.stdDev : null,
            breakdown: computed.breakdown || null,
            computed_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,metric_key,period_type,period_start',
          }
        )
        .select()
        .single();

      if (error) throw error;

      logger.debug(
        { userId, metricKey, value: computed.value, periodType },
        'Computed and stored metric'
      );

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, metricKey }, 'Failed to compute and store metric');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Compute a metric value from events
   */
  private async computeMetricValue(
    userId: string,
    definition: typeof METRIC_DEFINITIONS[0],
    periodStart: Date,
    periodEnd: Date
  ): Promise<ComputedMetricResult> {
    const fromDate = periodStart.toISOString();
    const toDate = periodEnd.toISOString();

    switch (definition.aggregation) {
      case 'count':
        return this.computeCountMetric(userId, definition.eventTypes, fromDate, toDate, definition.unit);

      case 'sum':
        return this.computeSumMetric(userId, definition.eventTypes, fromDate, toDate, definition.unit);

      case 'avg':
        return this.computeAvgMetric(userId, definition.eventTypes, fromDate, toDate, definition.unit);

      case 'rate':
        return this.computeRateMetric(userId, definition.key, definition.eventTypes, fromDate, toDate);

      case 'snapshot':
        return this.computeSnapshotMetric(userId, definition.key, definition.category, definition.unit);

      default:
        return { value: 0, unit: definition.unit, sampleSize: 0 };
    }
  }

  /**
   * Count events of specific types
   */
  private async computeCountMetric(
    userId: string,
    eventTypes: BusinessEventType[],
    fromDate: string,
    toDate: string,
    unit: MetricUnit
  ): Promise<ComputedMetricResult> {
    const result = await this.eventService.getEventCountsByType(userId, {
      fromDate,
      toDate,
    });

    if (result.error || !result.data) {
      return { value: 0, unit, sampleSize: 0 };
    }

    let total = 0;
    for (const eventType of eventTypes) {
      total += result.data[eventType] || 0;
    }

    return { value: total, unit, sampleSize: total };
  }

  /**
   * Sum value_usd for events
   */
  private async computeSumMetric(
    userId: string,
    eventTypes: BusinessEventType[],
    fromDate: string,
    toDate: string,
    unit: MetricUnit
  ): Promise<ComputedMetricResult> {
    const result = await this.eventService.getTotalValue(userId, {
      eventTypes,
      fromDate,
      toDate,
    });

    if (result.error || result.data === null) {
      return { value: 0, unit, sampleSize: 0 };
    }

    // Get sample size (count of events with values)
    const countResult = await this.eventService.getEventCountsByType(userId, {
      fromDate,
      toDate,
    });

    let sampleSize = 0;
    if (countResult.data) {
      for (const eventType of eventTypes) {
        sampleSize += countResult.data[eventType] || 0;
      }
    }

    return { value: result.data, unit, sampleSize };
  }

  /**
   * Average value from metadata
   */
  private async computeAvgMetric(
    userId: string,
    eventTypes: BusinessEventType[],
    fromDate: string,
    toDate: string,
    unit: MetricUnit
  ): Promise<ComputedMetricResult> {
    // For avg metrics, we need to query events directly
    const eventsResult = await this.eventService.getRecentEventsByTypes(userId, eventTypes, 1000);

    if (eventsResult.error || !eventsResult.data) {
      return { value: 0, unit, sampleSize: 0 };
    }

    // Filter by date range
    const events = eventsResult.data.filter((e) => {
      const eventDate = new Date(e.created_at);
      return eventDate >= new Date(fromDate) && eventDate <= new Date(toDate);
    });

    if (events.length === 0) {
      return { value: 0, unit, sampleSize: 0 };
    }

    // For reply time, look for reply_time_seconds in metadata
    let sum = 0;
    let count = 0;

    for (const event of events) {
      const metadata = event.metadata as Record<string, unknown>;
      if (metadata.reply_time_seconds) {
        // Convert seconds to hours for this metric
        sum += (Number(metadata.reply_time_seconds) / 3600);
        count++;
      } else if (metadata.value) {
        sum += Number(metadata.value);
        count++;
      }
    }

    const avg = count > 0 ? sum / count : 0;

    return { value: avg, unit, sampleSize: count };
  }

  /**
   * Calculate a rate (e.g., no-show rate)
   */
  private async computeRateMetric(
    userId: string,
    metricKey: MetricKey,
    eventTypes: BusinessEventType[],
    fromDate: string,
    toDate: string
  ): Promise<ComputedMetricResult> {
    const countResult = await this.eventService.getEventCountsByType(userId, {
      fromDate,
      toDate,
    });

    if (countResult.error || !countResult.data) {
      return { value: 0, unit: 'percentage', sampleSize: 0 };
    }

    // Calculate rate based on metric type
    if (metricKey === 'retention.no_show_rate') {
      const noShows = countResult.data['booking.no_show'] || 0;
      const completed = countResult.data['booking.completed'] || 0;
      const total = noShows + completed;

      if (total === 0) {
        return { value: 0, unit: 'percentage', sampleSize: 0 };
      }

      const rate = (noShows / total) * 100;
      return { value: rate, unit: 'percentage', sampleSize: total };
    }

    if (metricKey === 'retention.cancellation_rate') {
      const cancelled = countResult.data['booking.cancelled'] || 0;
      const created = countResult.data['booking.created'] || 0;

      if (created === 0) {
        return { value: 0, unit: 'percentage', sampleSize: 0 };
      }

      const rate = (cancelled / created) * 100;
      return { value: rate, unit: 'percentage', sampleSize: created };
    }

    // Default rate calculation
    let numerator = 0;
    let denominator = 0;

    for (const eventType of eventTypes) {
      const count = countResult.data[eventType] || 0;
      // First event type is numerator, rest are added to denominator
      if (eventTypes.indexOf(eventType) === 0) {
        numerator = count;
      }
      denominator += count;
    }

    if (denominator === 0) {
      return { value: 0, unit: 'percentage', sampleSize: 0 };
    }

    const rate = (numerator / denominator) * 100;
    return { value: rate, unit: 'percentage', sampleSize: denominator };
  }

  /**
   * Get a snapshot metric (current state, not time-based)
   */
  private async computeSnapshotMetric(
    userId: string,
    metricKey: MetricKey,
    category: BusinessEventCategory,
    unit: MetricUnit
  ): Promise<ComputedMetricResult> {
    // For snapshot metrics like AR overdue, we query the actual tables
    // This is a placeholder - actual implementation depends on the metric

    if (metricKey === 'cashflow.ar_overdue_usd') {
      // Overdue AR total via the repository. Reuses getOverdueInvoices with an
      // overdue-only status filter. A far-future `asOfDate` neutralizes the method's
      // default `.lt('due_date', now)` so the metric sums ALL `status='overdue'` rows
      // (strict parity with the prior bare `status='overdue'` select — SA §9.2 advisory),
      // not just those past a 'now' due-date threshold. Sums the real `amount` column
      // in-service (fixes the phantom `total_amount` read).
      const invoiceRepo = new PaymentInvoiceRepository(this.supabase);
      const { data, error } = await invoiceRepo.getOverdueInvoices(userId, {
        statuses: ['overdue'],
        asOfDate: '9999-12-31T23:59:59.999Z',
      });

      if (error || !data) {
        return { value: 0, unit, sampleSize: 0 };
      }

      const total = data.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
      return { value: total, unit, sampleSize: data.length };
    }

    return { value: 0, unit, sampleSize: 0 };
  }

  /**
   * Get period boundaries for a given date
   */
  static getPeriodBoundaries(
    date: Date,
    periodType: PeriodType
  ): { start: Date; end: Date } {
    const start = new Date(date);
    const end = new Date(date);

    switch (periodType) {
      case 'daily':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;

      case 'weekly':
        // Start from Monday
        const dayOfWeek = start.getDay();
        const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;

      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const metricsComputeService = new MetricsComputeService(supabaseServer);
