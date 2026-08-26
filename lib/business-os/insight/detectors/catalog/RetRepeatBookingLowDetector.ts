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
    eventTypes: ['booking.completed'],

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

    pairedProcessId: 'rebooking_reminder_sequence',
    consentTier: 'automate',
    eligibleForAutomation: true,
    ownerParameters: [
      {
        id: 'days_lookback',
        label: 'Days to Analyze',
        type: 'number',
        default: 60,
        min: 30,
        max: 180,
      },
    ],
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

    const daysLookback = 60;
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - daysLookback);

    // Get all completed bookings in the period, grouped by client email
    const { data: bookings, error } = await this.supabase
      .from('scheduling_bookings')
      .select('client_email, id, start_time, payment_amount')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('start_time', lookbackDate.toISOString())
      .not('client_email', 'is', null);

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
      const email = b.client_email?.toLowerCase();
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

    // Only fire if repeat rate is below threshold
    if (repeatRate >= this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(repeatRate, oneTimeClients.length);

    // Estimate lost recurring revenue
    const avgBookingValue = bookings.reduce((sum, b) =>
      sum + parseFloat(b.payment_amount || '75'), 0) / bookings.length;
    const potentialRebookings = oneTimeClients.length * 0.3; // 30% could rebook
    const estimatedLoss = potentialRebookings * avgBookingValue;

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.rebooking_rate',
      currentValue: Math.round(repeatRate * 10) / 10,
      baselineValue: this.definition.threshold,
      thresholdValue: this.definition.threshold,
      percentChange: Math.round(((repeatRate - this.definition.threshold) / this.definition.threshold) * 100),
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
        avg_booking_value: Math.round(avgBookingValue),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
