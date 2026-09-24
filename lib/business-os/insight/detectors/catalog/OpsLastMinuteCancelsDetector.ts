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

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `enforce_cancellation_policy`, a process that was never built — so the card

     * offered "handle it for me", the server answered 404 on the process, and the

     * insight was never marked acted. Whatever fixes this is a different KIND of

     * action from the four that exist, which all send a message.

     *

     * Declaring nothing is honest: the card shows the finding without a button

     * that cannot work.

     */
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
      .select('id, start_time, updated_at, payment_amount, cancellation_reason')
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

    /*
     * What these cancellations were actually worth.
     *
     * `payment_amount || '75'` put an invented £75 on every booking whose price
     * was not recorded. Two measured sources replace it, in order:
     *
     *   the booking's own `payment_amount`, where it has one
     *   this business's own average, from `resolveAverageDealValue` — real
     *   collected transactions, falling back to the prices of the services it
     *   actually sells
     *
     * So a business that has priced its services gets a real figure even for
     * bookings with no amount recorded. Only a business with neither — no
     * transactions and no priced services — reports no money, because there is
     * then genuinely nothing to read it from.
     */
    const businessAverage = await this.resolveAverageDealValue(userId);

    const cancelValues = lastMinuteCancels
      .map(b => {
        const charged = parseFloat(String(b.payment_amount ?? ''));
        if (Number.isFinite(charged) && charged > 0) return charged;
        return businessAverage;
      })
      .filter((value): value is number => value !== null);

    const lostRevenue = cancelValues.length > 0
      ? cancelValues.reduce((sum, value) => sum + value, 0)
      : null;

    // Calculate severity
    const severity = this.definition.severityFn(lastMinuteCancels.length, lostRevenue ?? 0);

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
      /*
       * Nothing changed by a hundred per cent.
       *
       * This detector counts: there is no baseline to have moved from, and a
       * hardcoded 100 reached the narrator as a real measurement. It produced
       * sentences like "a 100% increase in risk compared to your usual client
       * retention" and "a 100% increase in your expected cash flow" — arithmetic
       * presented as a trend, about a base of zero.
       *
       * `hasRealBaseline` now keeps the figure out of the prompt, but that guard
       * reads `baselineValue`, so it is the second line of defence. This is the
       * first: a count reports no change, because none was measured.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: lastMinuteCancels.map((b) => b.id),
      affectedCount: lastMinuteCancels.length,
      // Undefined, not zero: zero reads as "nothing at stake", which is the
      // opposite of "we could not price it".
      estimatedImpactUsd: lostRevenue ?? undefined,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {
        hours_threshold: hoursThreshold,
        total_cancellations: cancelledBookings.length,
        last_minute_count: lastMinuteCancels.length,
        lost_revenue: lostRevenue === null ? null : Math.round(lostRevenue),
        hour_breakdown: hourBreakdown,
        cancellation_reasons: reasons,
        booking_ids: lastMinuteCancels.map((b) => b.id),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
