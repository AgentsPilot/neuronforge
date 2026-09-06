/**
 * Operations Last-Minute Cancellation Detector
 *
 * Detects pattern of last-minute cancellations (<24h before booking).
 * Signals need for stronger cancellation policy or reminders.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class OpsLastMinuteCancelsDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ops_last_minute_cancels',
    name: 'Last-Minute Cancellations',
    category: 'operations',
    description: 'Detects cancellations made <24h before booking time',

    watchedMetrics: ['operations.last_minute_cancels'],
    eventTypes: ['booking.cancelled'],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 3, // 3+ last-minute cancels in a week
    direction: 'above',
    minSamples: 1,

    severityFn: (count: number, revenue: number): InsightSeverity => {
      if (count >= 8 || revenue >= 500) return 'critical';
      if (count >= 5 || revenue >= 300) return 'high';
      if (count >= 3 || revenue >= 150) return 'medium';
      return 'low';
    },

    pairedProcessId: 'enforce_cancellation_policy',
    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [
      {
        id: 'hours_threshold',
        label: 'Hours Before (Last-Minute)',
        type: 'number',
        default: 24,
        min: 12,
        max: 48,
      },
    ],
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

    const hoursThreshold = 24;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Get cancelled bookings from last week (use updated_at since cancelled_at doesn't exist)
    const { data: cancelledBookings, error } = await this.supabase
      .from('scheduling_bookings')
      .select('id, start_time, updated_at, payment_amount, client_email, cancellation_reason')
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', weekAgo.toISOString())
      .not('start_time', 'is', null);

    if (error) {
      throw error;
    }

    if (!cancelledBookings || cancelledBookings.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Filter to last-minute cancellations (cancelled within 24h of start_time)
    // Using updated_at as proxy for when cancellation happened
    const lastMinuteCancels = cancelledBookings.filter((booking) => {
      const startTime = new Date(booking.start_time);
      const cancelledAt = new Date(booking.updated_at);
      const hoursBeforeStart = (startTime.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);
      return hoursBeforeStart >= 0 && hoursBeforeStart <= hoursThreshold;
    });

    // Check threshold
    if (lastMinuteCancels.length < this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate lost revenue
    const lostRevenue = lastMinuteCancels.reduce((sum, b) =>
      sum + parseFloat(b.payment_amount || '75'), 0);

    // Calculate severity
    const severity = this.definition.severityFn(lastMinuteCancels.length, lostRevenue);

    // Analyze patterns
    const hourBreakdown: Record<string, number> = {};
    lastMinuteCancels.forEach((b) => {
      const startTime = new Date(b.start_time);
      const cancelledAt = new Date(b.updated_at);
      const hoursBefore = Math.round((startTime.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60));
      const bucket = hoursBefore <= 6 ? '0-6h' : hoursBefore <= 12 ? '6-12h' : '12-24h';
      hourBreakdown[bucket] = (hourBreakdown[bucket] || 0) + 1;
    });

    const reasons = lastMinuteCancels.reduce((acc, b) => {
      const reason = b.cancellation_reason || 'No reason';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'operations.last_minute_cancels',
      currentValue: lastMinuteCancels.length,
      baselineValue: 0,
      thresholdValue: this.definition.threshold,
      percentChange: 100,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: lastMinuteCancels.map((b) => b.id),
      affectedCount: lastMinuteCancels.length,
      estimatedImpactUsd: lostRevenue,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {
        hours_threshold: hoursThreshold,
        total_cancellations: cancelledBookings.length,
        last_minute_count: lastMinuteCancels.length,
        lost_revenue: Math.round(lostRevenue),
        hour_breakdown: hourBreakdown,
        cancellation_reasons: reasons,
        booking_ids: lastMinuteCancels.map((b) => b.id),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
