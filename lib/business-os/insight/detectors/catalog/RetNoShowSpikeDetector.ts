/**
 * Retention No-Show Spike Detector
 *
 * Detects when no-show rate spikes (2+ std deviations above baseline).
 * This is a baseline-relative detector.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { COMMON_GUARDRAILS } from '../types';

export class RetNoShowSpikeDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_no_show_spike',
    name: 'No-Show Rate Spike',
    category: 'retention',
    description: 'Detects when no-show rate spikes above baseline',

    watchedMetrics: ['retention.no_show_rate'],
    eventTypes: ['booking.no_show'],

    baselineWindow: 'month',
    thresholdType: 'std_deviation',
    threshold: 2, // 2 standard deviations
    direction: 'above',
    minSamples: 28, // 4 weeks of data

    severityFn: (delta: number, baseline: number): InsightSeverity => {
      const percentIncrease = baseline > 0 ? (delta / baseline) * 100 : 100;
      if (percentIncrease >= 100) return 'critical';
      if (percentIncrease >= 50) return 'high';
      if (percentIncrease >= 25) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_reminder_sequence',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'hours_before',
        label: 'Hours Before Booking',
        type: 'number',
        default: 24,
        min: 1,
        max: 72,
      },
    ],
    guardrails: [
      COMMON_GUARDRAILS.max_2_per_booking,
      COMMON_GUARDRAILS.quiet_hours,
    ],
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

    // Get baseline for no-show rate.
    // no_show_rate is stored at weekly/monthly granularity; 'weekly' is the finest
    // supported period and matches this detector's weekly impact framing.
    const baseline = await this.baselineCalculator.computeBaseline(
      userId,
      'retention.no_show_rate',
      'weekly',
      this.getBaselineLookbackDays()
    );

    // Not enough data
    if (!baseline.isSignificant) {
      this.logDetection(userId, null);
      return null;
    }

    // Get current no-show rate (last week)
    const latest = await this.getLatestMetricValue(userId, 'retention.no_show_rate');

    if (!latest) {
      this.logDetection(userId, null);
      return null;
    }

    const currentValue = latest.value;

    // Check if above threshold (baseline + 2 * stdDev)
    const threshold = baseline.threshold;

    if (currentValue <= threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate delta and severity
    const delta = currentValue - baseline.mean;
    // getPercentChange returns { percentChange: number | null, baseline }; coalesce the
    // null case (insignificant/zero baseline) to 0 since DetectionResult.percentChange is number.
    const { percentChange: computedPercentChange } = await this.baselineCalculator.getPercentChange(
      userId,
      'retention.no_show_rate',
      'weekly',
      currentValue,
      this.getBaselineLookbackDays()
    );
    const percentChange = computedPercentChange ?? 0;
    const severity = this.definition.severityFn(delta, baseline.mean);

    // Get recent no-shows for context
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: noShows } = await this.supabase
      .from('business_events')
      .select('entity_id, contact_id')
      .eq('user_id', userId)
      .eq('event_type', 'booking.no_show')
      .gte('created_at', weekAgo.toISOString());

    const affectedBookings = noShows?.map((ns) => ns.entity_id) || [];

    // Estimate revenue impact (assume avg booking value)
    const { data: avgBooking } = await this.supabase
      .from('business_events')
      .select('value_usd')
      .eq('user_id', userId)
      .eq('event_type', 'booking.completed')
      .not('value_usd', 'is', null)
      .limit(100);

    const avgBookingValue = avgBooking && avgBooking.length > 0
      ? avgBooking.reduce((sum, b) => sum + parseFloat(b.value_usd || '0'), 0) / avgBooking.length
      : 75; // Default assumption

    const estimatedLoss = affectedBookings.length * avgBookingValue;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.no_show_rate',
      currentValue,
      baselineValue: baseline.mean,
      thresholdValue: threshold,
      percentChange,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: affectedBookings,
      affectedCount: affectedBookings.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {
        hours_before: 24,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
