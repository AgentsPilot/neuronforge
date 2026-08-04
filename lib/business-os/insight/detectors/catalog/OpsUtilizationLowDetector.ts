/**
 * Operations Utilization Low Detector
 *
 * Detects when calendar utilization is below 50%.
 * This is an absolute threshold detector (advisory only, no automation).
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class OpsUtilizationLowDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ops_utilization_low',
    name: 'Low Calendar Utilization',
    category: 'operations',
    description: 'Detects when calendar utilization is below 50%',

    watchedMetrics: ['operations.calendar_utilization'],
    eventTypes: ['calendar.utilization_low'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 50, // 50% utilization
    direction: 'below',
    minSamples: 28, // 4 weeks of data

    severityFn: (utilization: number): InsightSeverity => {
      if (utilization <= 20) return 'critical';
      if (utilization <= 30) return 'high';
      if (utilization <= 40) return 'medium';
      return 'low';
    },

    // No paired process - this is advisory only
    pairedProcessId: undefined,
    consentTier: 'observe',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 168, // 1 week
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    // Get current utilization
    const latest = await this.getLatestMetricValue(userId, 'operations.calendar_utilization');

    if (!latest) {
      this.logDetection(userId, null);
      return null;
    }

    const currentValue = latest.value;
    const threshold = this.definition.threshold;

    // Check if below threshold
    if (currentValue >= threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Get baseline for context
    const baseline = await this.baselineCalculator.computeBaseline(
      userId,
      'operations.calendar_utilization',
      this.getBaselineLookbackDays(),
      this.definition.minSamples
    );

    // Not enough data - but we can still surface the insight
    const baselineMean = baseline.isSignificant ? baseline.mean : 50;

    // Calculate severity
    const severity = this.definition.severityFn(currentValue, 0);

    // Estimate lost revenue opportunity
    // Assumption: each unfilled hour could generate avg booking revenue
    const { data: avgBooking } = await this.supabase
      .from('business_events')
      .select('value_usd')
      .eq('user_id', userId)
      .eq('event_type', 'booking.completed')
      .not('value_usd', 'is', null)
      .limit(100);

    const avgBookingValue = avgBooking && avgBooking.length > 0
      ? avgBooking.reduce((sum, b) => sum + parseFloat(b.value_usd || '0'), 0) / avgBooking.length
      : 75;

    // Get available hours per week (from scheduling_availability or default)
    const { data: availability } = await this.supabase
      .from('scheduling_availability')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .single();

    // Default to 40 hours/week if no availability data
    const availableHoursPerWeek = availability
      ? this.calculateAvailableHours(availability)
      : 40;

    // Calculate unfilled hours
    const filledPercent = currentValue / 100;
    const unfilledHours = availableHoursPerWeek * (1 - filledPercent);
    const estimatedOpportunity = unfilledHours * avgBookingValue;

    const percentChange = this.baselineCalculator.getPercentChange(currentValue, baselineMean);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'operations.calendar_utilization',
      currentValue,
      baselineValue: baselineMean,
      thresholdValue: threshold,
      percentChange,
      direction: 'below',
      affectedCount: Math.round(unfilledHours),
      estimatedImpactUsd: estimatedOpportunity,
      impactDirection: 'opportunity',
      impactPeriod: 'weekly',
      processParameters: {},
    });

    this.logDetection(userId, result);
    return result;
  }

  /**
   * Calculate available hours from availability settings
   */
  private calculateAvailableHours(availability: Record<string, unknown>): number {
    // This would parse the availability JSON structure
    // For now, return a reasonable default
    return 40;
  }
}
