/**
 * Retention Cancellation Spike Detector
 *
 * Detects when booking cancellations spike compared to previous period.
 * This is a percent_change detector comparing last 7 days vs previous 7 days.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class RetCancellationSpikeDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_cancellation_spike',
    name: 'Cancellation Spike',
    category: 'retention',
    description: 'Detects when booking cancellations spike 50%+ from previous week',

    watchedMetrics: ['retention.cancellation_rate'],
    eventTypes: ['booking.cancelled'],

    baselineWindow: 'week',
    thresholdType: 'percent_change',
    threshold: 50, // 50% increase
    direction: 'above',
    minSamples: 2, // Need at least 2 cancellations in baseline

    severityFn: (percentIncrease: number, cancellationCount: number): InsightSeverity => {
      if (cancellationCount >= 10 || percentIncrease >= 150) return 'critical';
      if (cancellationCount >= 5 || percentIncrease >= 100) return 'high';
      if (cancellationCount >= 3 || percentIncrease >= 50) return 'medium';
      return 'low';
    },

    pairedProcessId: 'analyze_cancellation_reasons',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 72, // 3 days
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

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get current week cancellations (use updated_at since cancelled_at doesn't exist)
    const { data: currentWeek, error: currentError } = await this.supabase
      .from('scheduling_bookings')
      .select('id, service_id, cancellation_reason, updated_at')
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', weekAgo.toISOString())
      .lt('updated_at', now.toISOString());

    if (currentError) {
      throw currentError;
    }

    const currentCount = currentWeek?.length || 0;

    // No cancellations this week - nothing to report
    if (currentCount === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Get previous week cancellations (use updated_at since cancelled_at doesn't exist)
    const { data: previousWeek, error: previousError } = await this.supabase
      .from('scheduling_bookings')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', twoWeeksAgo.toISOString())
      .lt('updated_at', weekAgo.toISOString());

    if (previousError) {
      throw previousError;
    }

    const previousCount = previousWeek?.length || 0;

    // Calculate percent change
    let percentChange: number;
    if (previousCount === 0) {
      // If no previous cancellations but have current ones, this is a spike
      // Only fire if we have 3+ current cancellations (avoid noise)
      if (currentCount < 3) {
        this.logDetection(userId, null);
        return null;
      }
      percentChange = 100; // Treat as 100% increase
    } else {
      percentChange = ((currentCount - previousCount) / previousCount) * 100;
    }

    // Only fire if cancellations increased by threshold or more
    if (percentChange < this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Get avg booking value for impact calculation
    const { data: completedBookings } = await this.supabase
      .from('scheduling_bookings')
      .select('payment_amount')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('payment_amount', 'is', null)
      .limit(50);

    const avgBookingValue = completedBookings && completedBookings.length > 0
      ? completedBookings.reduce((sum, b) => sum + parseFloat(b.payment_amount || '0'), 0) / completedBookings.length
      : 75; // Default assumption

    // Calculate severity
    const severity = this.definition.severityFn(percentChange, currentCount);

    // Estimate impact
    const estimatedLoss = currentCount * avgBookingValue;

    // Analyze cancellation reasons
    const reasons = currentWeek?.reduce((acc, b) => {
      const reason = b.cancellation_reason || 'No reason provided';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.cancellation_rate',
      currentValue: currentCount,
      baselineValue: previousCount,
      thresholdValue: Math.ceil(previousCount * (1 + this.definition.threshold / 100)),
      percentChange: Math.round(percentChange),
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: currentWeek?.map((b) => b.id) || [],
      affectedCount: currentCount,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {
        current_cancellations: currentCount,
        previous_cancellations: previousCount,
        increase_percent: Math.round(percentChange),
        cancellation_reasons: reasons,
        booking_ids: currentWeek?.map((b) => b.id) || [],
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
