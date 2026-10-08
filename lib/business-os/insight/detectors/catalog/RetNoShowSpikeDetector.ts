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
import { firstOutlier, nameSegment, type Dimension } from '../../patterns/segmentRate';
import { localWeekdayIn } from '@/lib/business-os/businessDay';

const logger = createLogger({ module: 'RetNoShowSpikeDetector' });

export class RetNoShowSpikeDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_no_show_spike',
    name: 'No-Show Rate Spike',
    category: 'retention',
    description: 'Detects when no-show rate spikes above baseline',

    watchedMetrics: ['retention.no_show_rate'],
    documentsEventTypes: ['booking.no_show'],

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
    eligibleForAutomation: true,
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

    /*
     * WHICH appointments are being missed, not just how many.
     *
     * "Your no-shows are up 12 points" is a number the owner can do nothing
     * with. "Thursday evenings are missed four times as often as everything
     * else" names the thing to change. Computed over the FULL settled window
     * rather than the recent slice: the recent window is deliberately short to
     * catch a spike, and a 30-day slice rarely holds enough per day for a rate
     * to mean anything.
     *
     * Day first, then service — the owner can move a slot more easily than she
     * can change what she sells, so the more actionable slice is tried first.
     * The day dimension is dropped entirely when nobody has told us the
     * business's zone, because a weekday read off a UTC timestamp files
     * late-evening appointments under the wrong day.
     */
    const timezone = await this.resolveBusinessTimezone(userId);

    const dimensions: Dimension<BookingRow>[] = [];
    if (timezone) {
      dimensions.push({
        name: 'day_of_week',
        segmentOf: r => (r.start_time ? localWeekdayIn(new Date(r.start_time), timezone) : null),
      });
    }
    dimensions.push({ name: 'service', segmentOf: r => r.service_id });

    const { found, refusals } = firstOutlier(settled, r => r.status === 'no_show', dimensions);

    if (!found) {
      // The refusal kinds, so a card without a comparison can be explained.
      logger.debug(
        { userId, refusals, hasTimezone: Boolean(timezone), settled: settled.length },
        'No-show rate is even across every slice; reporting the spike alone'
      );
    }

    /*
     * Name the slice, or drop the comparison entirely.
     *
     * A card that says "one group is four times worse" without saying which is
     * the dead-link card again, and the owner's reply to that was "which
     * link?". A service id has to be resolved to its name, and if the row has
     * since gone there is nothing honest to print -- so the whole comparison
     * goes rather than a UUID.
     */
    let segmentName: string | null = null;
    if (found) {
      let labels: Map<string, string> | undefined;

      if (found.dimension === 'service') {
        // Only when a service actually won. No lookup on the day path.
        const { data: services } = await this.supabase
          .from('scheduling_services')
          .select('id, service_name')
          .eq('user_id', userId)
          .eq('id', found.comparison.segment);

        labels = new Map(
          ((services ?? []) as Array<{ id: string; service_name: string | null }>).map(s => [
            s.id,
            s.service_name ?? '',
          ])
        );
      }

      segmentName = nameSegment(found.dimension, found.comparison.segment, labels);

      if (!segmentName) {
        logger.debug(
          { userId, dimension: found.dimension },
          'Comparison found but its slice could not be named; omitting it'
        );
      }
    }

    const comparison = segmentName ? found?.comparison : undefined;

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
      comparison,
      /*
       * The slice, named. `describeComparison` in `InsightRepository` sends
       * only the shape of the gap, so without this line the model has four
       * numbers and nothing to attach them to.
       */
      narrationSubject: comparison
        ? `the no-shows concentrate on ${segmentName}: ${comparison.hits} of ${comparison.of} missed there, against ${comparison.rest.hits} of ${comparison.rest.of} everywhere else`
        : undefined,
      processParameters: {
        window_days: WINDOW_DAYS,
        no_show_rate: recentRate,
        baseline_rate: baselineRate,
        rise_points: risePoints,
        no_shows: recentNoShows.length,
        appointments: recent.length,
        /*
         * The dimension travels with the comparison so the card can say "on
         * Thursdays" rather than "in one group". The segment KEY is an id or a
         * day code, never display text — the card resolves it.
         */
        comparison_dimension: comparison ? found?.dimension : undefined,
        comparison_segment: comparison ? segmentName : undefined,
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
