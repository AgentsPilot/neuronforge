/**
 * Retention Repeat Booking Low Detector
 *
 * Detects when client rebooking rate is too low (>60% one-time clients).
 * Signals retention issues requiring engagement campaigns.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class RetRepeatBookingLowDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_repeat_booking_low',
    name: 'Low Repeat Booking Rate',
    category: 'retention',
    description: 'Detects when >60% of clients are one-time only',

    watchedMetrics: ['retention.rebooking_rate'],
    documentsEventTypes: ['booking.completed'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 40, // Below 40% repeat rate = problem
    direction: 'below',
    minSamples: 10, // Need at least 10 unique clients

    severityFn: (repeatRate: number, oneTimeCount: number): InsightSeverity => {
      if (repeatRate < 25 || oneTimeCount >= 20) return 'critical';
      if (repeatRate < 30 || oneTimeCount >= 10) return 'high';
      if (repeatRate < 40 || oneTimeCount >= 5) return 'medium';
      return 'low';
    },

    pairedProcessId: 'send_followup_nudge',
    eligibleForAutomation: true,
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

    const daysLookback = 60;
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - daysLookback);

    // Get all completed bookings in the period, grouped by contact
    const { data: bookings, error } = await this.supabase
      .from('scheduling_bookings')
      .select('contact_id, id, start_time, payment_amount')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('start_time', lookbackDate.toISOString())
      .not('contact_id', 'is', null);

    if (error) {
      throw error;
    }

    if (!bookings || bookings.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    // Group bookings by client
    const clientBookings: Record<string, typeof bookings> = {};
    bookings.forEach((b) => {
      // Grouped by contact, not by email text. `client_email` was dropped
      // with the rest of the denormalised client fields.
      const email = b.contact_id;
      if (email) {
        if (!clientBookings[email]) {
          clientBookings[email] = [];
        }
        clientBookings[email].push(b);
      }
    });

    const uniqueClients = Object.keys(clientBookings);

    // Need minimum clients for meaningful analysis
    if (uniqueClients.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Count one-time vs repeat clients
    const oneTimeClients = uniqueClients.filter((email) => clientBookings[email].length === 1);
    const repeatClients = uniqueClients.filter((email) => clientBookings[email].length > 1);

    const repeatRate = (repeatClients.length / uniqueClients.length) * 100;

    /*
     * Is this low FOR THIS BUSINESS, or just low against a number we typed?
     * ─────────────────────────────────────────────────────────────────────────
     * `threshold: 40` is a judgement with no evidence behind it. A therapist
     * running a course of six sessions will sit near 100%; somebody selling a
     * one-off survey will never pass 10% and nothing is wrong with them. Told
     * weekly that they are "below 40%", the second owner learns to ignore the
     * advisor -- which is the complaint that started this work.
     *
     * So the business's own history is asked first. `compareToOwnBaseline`
     * returns null when the rate sits inside this business's normal range, and
     * THAT SILENCE IS THE POINT: a card appearing now means the rate actually
     * moved, not that it is still where it has always been.
     *
     * The absolute threshold remains the fallback for an account with no
     * history yet, which is the behaviour this detector had before -- a new
     * business gets the generic advice, and stops getting it once there is
     * enough of its own past to say something truer.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const comparison = await this.compareToOwnBaseline(
      userId,
      'retention.rebooking_rate',
      repeatRate,
      // The only period this metric is computed for; see METRIC_DEFINITIONS.
      'monthly'
    );

    if (comparison) {
      /*
       * There is a history, so it decides, and 40 stops mattering.
       *
       * Unremarkable means unremarkable however it compares to a constant, and
       * a rate ABOVE their mean is good news this detector has nothing to say
       * about.
       */
      if (!comparison.unusual || comparison.direction === 'above') {
        this.logDetection(userId, null);
        return null;
      }
    } else if (repeatRate >= this.definition.threshold) {
      // No usable baseline: fall back to the absolute rule this detector had.
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(repeatRate, oneTimeClients.length);

    /*
     * What a booking here is actually worth, and how many might come back.
     *
     * Both halves of this were invented. `payment_amount || '75'` priced every
     * unpriced booking at £75, and `* 0.3 // 30% could rebook` was a rebooking
     * rate nobody measured — multiplied together and shown to the owner as
     * money they were losing.
     *
     * The value now comes from the bookings that HAVE a price. The rate comes
     * from the business's own repeat behaviour: `repeatRate` is the share of
     * clients who already came back, which is the only rebooking rate this
     * platform can honestly claim. If neither can be resolved there is no
     * money sentence.
     */
    const pricedBookings = bookings
      .map(b => parseFloat(String(b.payment_amount ?? '')))
      .filter(value => Number.isFinite(value) && value > 0);

    /*
     * The bookings that carry a price, or the business's own average.
     *
     * `resolveAverageDealValue` reads real collected transactions first and the
     * prices of the services this business sells second — so a business that
     * has priced its catalogue still gets a real figure when its bookings have
     * no amount recorded. Null only when there is neither.
     */
    const avgBookingValue = pricedBookings.length > 0
      ? pricedBookings.reduce((sum, value) => sum + value, 0) / pricedBookings.length
      : await this.resolveAverageDealValue(userId);

    /*
     * Measured, not assumed: the share of this business's own clients who came
     * back. Using it says "as many again as already do", which is a claim the
     * data supports.
     */
    const potentialRebookings = oneTimeClients.length * (repeatRate / 100);

    const estimatedLoss = avgBookingValue === null
      ? undefined
      : potentialRebookings * avgBookingValue;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.rebooking_rate',
      currentValue: Math.round(repeatRate * 10) / 10,
      /*
       * A target is not a baseline, and the distance to it is not a change.
       *
       * These reported the THRESHOLD as `baselineValue` and the gap to it as
       * `percentChange`, which the narrator reads as "Change from baseline" —
       * so a business whose repeat rate had been perfectly steady was told it
       * had fallen 40%. The threshold belongs in `thresholdValue`, where it
       * already is, and nothing here was measured twice.
       */
      /*
       * The business's OWN mean where there is one, and 0 where there is not.
       *
       * `hasRealBaseline` in InsightRepository omits the change line when this
       * is 0, so an account with no history says nothing comparative rather
       * than comparing itself to a constant -- which is exactly how
       * `cash_refund_pattern` came to report an impossible 275%.
       */
      baselineValue: comparison?.mean ?? 0,
      thresholdValue: this.definition.threshold,
      /*
       * Points below their own mean, not a percentage of it: the figure is
       * already a rate, and a percent change of a percent reads as nonsense.
       */
      percentChange: comparison ? Math.round(comparison.mean - repeatRate) * -1 : 0,
      direction: 'below',
      affectedEntityType: 'contact',
      affectedEntityIds: [], // Would need to map emails to contact IDs
      affectedCount: oneTimeClients.length,
      estimatedImpactUsd: estimatedLoss,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        days_lookback: daysLookback,
        repeat_rate: Math.round(repeatRate * 10) / 10,
        total_clients: uniqueClients.length,
        one_time_clients: oneTimeClients.length,
        repeat_clients: repeatClients.length,
        one_time_emails: oneTimeClients.slice(0, 20), // Limit for payload size
        // Null when no booking carried a price, rather than a rounded guess.
        avg_booking_value: avgBookingValue === null ? null : Math.round(avgBookingValue),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
