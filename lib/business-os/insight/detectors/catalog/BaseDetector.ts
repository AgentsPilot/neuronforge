/**
 * Base Detector
 *
 * Abstract base class for all detectors with common functionality.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { BaselineCalculator } from '../../metrics/BaselineCalculator';
import type { Detector, DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import type { MetricKey } from '../../metrics/types';

const logger = createLogger({ module: 'BaseDetector' });

/**
 * Abstract base class for detectors
 */
export abstract class BaseDetector implements Detector {
  protected supabase: SupabaseClient;
  protected baselineCalculator: BaselineCalculator;
  abstract definition: DetectorDefinition;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.baselineCalculator = new BaselineCalculator(supabase);
  }

  /**
   * Main evaluation method - must be implemented by subclasses
   */
  abstract evaluate(userId: string): Promise<DetectionResult | null>;

  /**
   * Check if detector is on cooldown for this user
   */
  protected async isOnCooldown(userId: string): Promise<boolean> {
    const cooldownHours = this.definition.cooldownHours;

    const { data } = await this.supabase
      .from('insights')
      .select('last_surfaced_at')
      .eq('user_id', userId)
      .eq('detector_id', this.definition.id)
      .order('last_surfaced_at', { ascending: false })
      .limit(1)
      .single();

    if (!data?.last_surfaced_at) {
      return false;
    }

    const lastSurfaced = new Date(data.last_surfaced_at);
    const cooldownEnd = new Date(lastSurfaced.getTime() + cooldownHours * 60 * 60 * 1000);

    return new Date() < cooldownEnd;
  }

  /**
   * Get the latest metric value for a user
   */
  protected async getLatestMetricValue(
    userId: string,
    metricKey: MetricKey
  ): Promise<{ value: number; periodStart: Date; periodEnd: Date } | null> {
    const { data } = await this.supabase
      .from('derived_metrics')
      .select('value, period_start, period_end')
      .eq('user_id', userId)
      .eq('metric_key', metricKey)
      .order('period_end', { ascending: false })
      .limit(1)
      .single();

    if (!data) {
      return null;
    }

    return {
      value: parseFloat(data.value),
      periodStart: new Date(data.period_start),
      periodEnd: new Date(data.period_end),
    };
  }

  /**
   * Calculate baseline lookback days from window
   */
  protected getBaselineLookbackDays(): number {
    switch (this.definition.baselineWindow) {
      case 'week':
        return 7;
      case 'month':
        return 30;
      case '90days':
        return 90;
      default:
        return 30;
    }
  }

  /**
   * Calculate severity from percent change
   */
  protected calculateSeverityFromPercentChange(percentChange: number): InsightSeverity {
    const absChange = Math.abs(percentChange);

    if (absChange >= 100) return 'critical';
    if (absChange >= 50) return 'high';
    if (absChange >= 25) return 'medium';
    return 'low';
  }

  /**
   * Calculate severity from absolute value thresholds
   */
  protected calculateSeverityFromAbsolute(
    value: number,
    thresholds: { low: number; medium: number; high: number; critical: number }
  ): InsightSeverity {
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.high) return 'high';
    if (value >= thresholds.medium) return 'medium';
    return 'low';
  }

  /**
   * Create a detection result with common fields
   */
  protected createDetectionResult(
    params: Omit<DetectionResult, 'detectorId' | 'detectedAt' | 'category' | 'eligibleForAutomation' | 'pairedProcessId'>
  ): DetectionResult {
    return {
      detectorId: this.definition.id,
      detectedAt: new Date(),
      category: this.definition.category,
      pairedProcessId: this.definition.pairedProcessId,
      eligibleForAutomation: this.definition.eligibleForAutomation,
      ...params,
    };
  }

  /**
   * Log detection for debugging
   */
  protected logDetection(userId: string, result: DetectionResult | null): void {
    if (result) {
      logger.info(
        {
          userId,
          detectorId: this.definition.id,
          severity: result.severity,
          currentValue: result.currentValue,
          baselineValue: result.baselineValue,
        },
        'Detection triggered'
      );
    } else {
      logger.debug(
        { userId, detectorId: this.definition.id },
        'No detection'
      );
    }
  }
}
