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
import { createLogger } from '@/lib/logger';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const logger = createLogger({ module: 'RetNoShowSpikeDetector' });
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
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = Date.now();
    const recentFrom = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
    const baselineFrom = new Date(now - (WINDOW_DAYS + BASELINE_DAYS) * 86_400_000).toISOString();

    /*
     * Read from the bookings, not from the event rail.
     *
     * This used to ask `business_events` for `booking.no_show` and
     * `derived_metrics` for a pre-computed rate. Nothing writes to either, so
     * the detector was correct code over two empty tables and could never fire.
     * `scheduling_bookings.status` already has a `no_show` value, the PATCH
     * route already accepts it, and the stats route already counts it — the
     * fact was reachable all along.
     */
    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select('id, status, start_time, contact_id, payment_amount, service_id')
      .eq('user_id', userId)
      .gte('start_time', baselineFrom)
      .lt('start_time', new Date(now).toISOString());

    if (error) throw error;

    const rows = (data ?? []) as unknown as BookingRow[];

    // Only appointments that have HAPPENED can be no-shows. A confirmed
    // booking next week is neither attended nor missed.
    const settled = rows.filter(r => CONCLUDED.has((r.status ?? '').toLowerCase()));

    const recent = settled.filter(r => (r.start_time ?? '') >= recentFrom);
    const baseline = settled.filter(r => (r.start_time ?? '') < recentFrom);

    if (recent.length < MIN_RECENT_BOOKINGS || baseline.length < MIN_BASELINE_BOOKINGS) {
      this.logDetection(userId, null);
      return null;
    }

    const recentNoShows = recent.filter(r => r.status === 'no_show');
    const recentRate = Math.round((recentNoShows.length / recent.length) * 100);
    const baselineRate = Math.round(
      (baseline.filter(r => r.status === 'no_show').length / baseline.length) * 100
    );

    const risePoints = recentRate - baselineRate;
    if (recentRate < MIN_RATE_PERCENT || risePoints < RISE_THRESHOLD_POINTS) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * What the missed appointments were worth, from the bookings themselves.
     *
     * The charge on the booking where there is one. No fallback to an invented
     * average: an earlier version of this file defaulted to a hardcoded $75 and
     * showed it to owners as their own figure.
     */
    const lostValue = recentNoShows.reduce((sum, r) => sum + toNumber(r.payment_amount), 0);

    const severity = this.definition.severityFn(risePoints, baselineRate);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'retention.no_show_rate',
      currentValue: recentRate,
      baselineValue: baselineRate,
      thresholdValue: RISE_THRESHOLD_POINTS,
      percentChange: risePoints,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: recentNoShows.map(r => r.id),
      affectedCount: recentNoShows.length,
      estimatedImpactUsd: Math.round(lostValue * 100) / 100,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        no_show_rate: recentRate,
        baseline_rate: baselineRate,
        rise_points: risePoints,
        no_shows: recentNoShows.length,
        appointments: recent.length,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}

/** Statuses that mean the appointment is in the past and its outcome is known. */
const CONCLUDED = new Set(['completed', 'no_show']);

const WINDOW_DAYS = 30;
const BASELINE_DAYS = 60;
/** Concluded appointments needed before a rate is a rate. */
const MIN_RECENT_BOOKINGS = 10;
const MIN_BASELINE_BOOKINGS = 20;
/** Below this, a no-show rate is not worth raising however it moved. */
const MIN_RATE_PERCENT = 10;
/** How many percentage points it must have risen. */
const RISE_THRESHOLD_POINTS = 10;

interface BookingRow {
  id: string;
  status: string | null;
  start_time: string | null;
  contact_id: string | null;
  payment_amount: number | string | null;
  service_id: string | null;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
