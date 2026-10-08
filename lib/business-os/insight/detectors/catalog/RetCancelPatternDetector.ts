/**
 * Why Bookings Keep Getting Called Off
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE THE SPIKE DETECTOR
 *
 * `RetCancellationSpikeDetector` already counts reasons — but only inside a
 * week that has ALREADY spiked 50% above the one before. It is a breakdown
 * attached to an alarm.
 *
 * A business losing one booking a week to the same cause never spikes. The rate
 * is flat, the alarm never fires, and nobody is ever told that the same thing
 * has happened eleven times running. A persistent pattern needs no spike to be
 * worth knowing, and that is the entire gap this fills: a quarter of
 * cancellations, grouped, with no requirement that anything got worse.
 *
 * THE DIMENSION NOTHING LOOKS AT: WHO
 *
 * `cancelled_by` (migration 20260928c) records whether the client or the
 * business called it off, and no surface reads it. The split matters more than
 * the reasons do:
 *
 *   mostly the client   a demand, pricing or commitment question
 *   mostly the owner    a scheduling problem, and the owner's own to fix
 *
 * An owner cancelling a third of their own bookings is the most actionable
 * thing on this card and the least likely to be noticed, because every
 * individual cancellation felt justified at the time. So the two sides are
 * counted separately and their reasons never pooled: `CLIENT_CANCEL_REASONS`
 * and `OWNER_CANCEL_REASONS` are different vocabularies on purpose, and mixing
 * them would produce a "top reason" neither party actually gave.
 *
 * The judgement about whether a tally IS a pattern lives in
 * `patterns/dominantReason.ts`, pure and tested without fixtures.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { createLogger } from '@/lib/logger';
import { cancelReasonBucket } from '@/lib/business-os/cancellationReasons';
import { CLIENT_CANCELLED_PREFIX } from '@/lib/services/bookingCancellationReason';
import { dominantReason } from '../../patterns/dominantReason';
import {
  firstOutlier,
  nameSegment,
  type Dimension,
  type SegmentRate,
} from '../../patterns/segmentRate';
import { localWeekdayIn } from '@/lib/business-os/businessDay';

const logger = createLogger({ module: 'RetCancelPatternDetector' });

/** A quarter: long enough to see a habit, short enough to still be true. */
const LOOKBACK_DAYS = 90;

/**
 * The share of cancellations the OWNER has to be responsible for before that
 * is the headline rather than the reasons.
 *
 * A third. Below it, owner cancellations are the ordinary friction of running
 * a diary; above it the owner is the largest single cause of their own lost
 * hours, which is a different conversation from anything the client did.
 */
const OWNER_SHARE_WORTH_SAYING = 0.33;

/** Below this many cancellations in the window, nothing is said at all. */
const MIN_CANCELLATIONS = 4;

interface CancelledRow {
  id: string;
  contact_id: string | null;
  start_time: string | null;
  updated_at: string | null;
  cancel_reason: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  service_id: string | null;
}

export class RetCancelPatternDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'ret_cancel_pattern',
    name: 'Why Bookings Keep Getting Called Off',
    category: 'retention',
    description:
      'Groups a quarter of cancellations by reason and by who called them off, with no spike required',

    watchedMetrics: ['retention.cancel_reason'],
    documentsEventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',

    /*
     * Four, against the decline detector's three.
     *
     * Cancellations are more common than declined quotes and carry more
     * innocent noise — illness, weather, a clash. A pattern needs a slightly
     * wider base here before it stops being a run of bad luck.
     */
    minSamples: MIN_CANCELLATIONS,

    severityFn: (count: number, _value: number): InsightSeverity => {
      if (count >= 8) return 'high';
      if (count >= 4) return 'medium';
      return 'low';
    },

    /*
     * Nothing to automate. The two findings are "your clients keep cancelling
     * for X" and "you keep cancelling" — the first needs a policy decision, the
     * second a look at the diary. Neither is a button.
     */
    pairedProcessId: undefined,

    /*
     * A dominant cancellation reason is a share of a sample, so it needs the
     * sample. Flagged `ignoresVectorMaturity: true` when written, which was
     * wrong: it fired on 4 cancellations and reported them as a pattern.
     */
    claimType: 'pattern',

    eligibleForAutomation: false,
    /*
     * A week, matching the decline detector. A habit does not change between
     * Tuesday and Thursday, and a card about one that reappears daily is a card
     * the owner learns to dismiss without reading.
     */
    cooldownHours: 168,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

    const { data, error } = await this.supabase
      .from('scheduling_bookings')
      .select(
        'id, contact_id, start_time, updated_at, cancel_reason, cancellation_reason, cancelled_by, service_id'
      )
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', since)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as CancelledRow[];
    if (rows.length < MIN_CANCELLATIONS) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Who called it off. The column where there is one, the legacy English
     * prefix where there is not — the same fallback
     * `CashCancelledUnrefundedDetector` uses, and for the same reason: every
     * row cancelled before 20260928c carries only the prose.
     *
     * An unknown party is counted as neither. Guessing would put real
     * cancellations on the wrong side of the one split this card is about.
     */
    const partyOf = (row: CancelledRow): 'client' | 'owner' | null => {
      if (row.cancelled_by === 'client' || row.cancelled_by === 'owner') return row.cancelled_by;
      if (row.cancelled_by === 'system') return null;
      if (!row.cancellation_reason) return null;
      return row.cancellation_reason.startsWith(CLIENT_CANCELLED_PREFIX) ? 'client' : 'owner';
    };

    const byClient = rows.filter(r => partyOf(r) === 'client');
    const byOwner = rows.filter(r => partyOf(r) === 'owner');
    const attributed = byClient.length + byOwner.length;

    /*
     * The reasons, counted per side and never pooled. An empty bucket is kept
     * so it counts toward the total; `dominantReason` will not let it win.
     */
    const tally = (subset: CancelledRow[]) => {
      const counts: Record<string, number> = {};
      for (const row of subset) {
        const bucket = cancelReasonBucket(row, '');
        counts[bucket] = (counts[bucket] ?? 0) + 1;
      }
      return counts;
    };

    const clientPattern = dominantReason(tally(byClient), MIN_CANCELLATIONS);
    const ownerPattern = dominantReason(tally(byOwner), 3);

    /*
     * Is the OWNER the story?
     *
     * Measured against attributed rows only. Including the unknown party in the
     * denominator would quietly understate the owner's share on exactly the
     * accounts with the most legacy rows — the ones least able to see it.
     */
    const ownerShare = attributed > 0 ? byOwner.length / attributed : 0;
    const ownerIsTheStory = attributed >= MIN_CANCELLATIONS && ownerShare >= OWNER_SHARE_WORTH_SAYING;

    // Nothing dominates on either side and the owner is not over-represented.
    if (!clientPattern && !ownerPattern && !ownerIsTheStory) {
      this.logDetection(userId, null);
      return null;
    }

    const headlineCount = ownerIsTheStory
      ? byOwner.length
      : clientPattern?.count ?? ownerPattern?.count ?? rows.length;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * IS IT A PARTICULAR DAY, OR A PARTICULAR SERVICE?
     *
     * The query above deliberately loads ONLY cancelled bookings, which is
     * right for the reason analysis — it asks which reason dominates among
     * those who gave one — but it means this detector cannot form a RATE from
     * what it already has. Every row is the same outcome, so counting them by
     * day would only report which day she works most. That is the volume
     * fallacy `patterns/segmentRate.ts` exists to refuse.
     *
     * So the denominator comes from a second query, and it is windowed on
     * `start_time` for BOTH halves. The reason query windows on `updated_at`
     * (when the cancellation was recorded), which is the right clock for a
     * reason and the wrong one for a rate: dividing cancellations-by-
     * updated_at by bookings-by-start_time compares two different populations
     * and can exceed 100%.
     *
     * Failing here must never take down the reason card, so a failed or thin
     * lookup simply leaves the comparison absent.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const comparison = await this.cancelRateOutlier(userId, since);

    const result = this.createDetectionResult({
      severity: this.definition.severityFn(headlineCount, 0),
      metricKey: 'retention.cancel_reason',
      currentValue: headlineCount,
      baselineValue: 0,
      thresholdValue: 0,
      // A count over a window, not a movement. See the same note on the other
      // counting detectors.
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: rows.map(row => row.id),
      affectedCount: headlineCount,
      /*
       * No money figure. A cancelled booking's value is not lost revenue — the
       * slot may have been refilled, the client may have rebooked, and the
       * deposit may have been kept. `CashCancelledUnrefundedDetector` reports
       * the money that genuinely is still held; this one reports behaviour.
       */
      comparison: comparison?.rate,
      /*
       * Names the slice, which `describeComparison` deliberately does not —
       * it sends the shape of the gap and nothing to attach it to.
       */
      narrationSubject: comparison
        ? `the cancellations concentrate on ${comparison.name}: ${comparison.rate.hits} of ${comparison.rate.of} called off there, against ${comparison.rate.rest.hits} of ${comparison.rate.rest.of} everywhere else`
        : undefined,
      processParameters: {
        comparison_dimension: comparison?.dimension,
        comparison_segment: comparison?.name,

        lookback_days: LOOKBACK_DAYS,
        cancellations: rows.length,
        attributed,
        unknown_party: rows.length - attributed,

        by_client: byClient.length,
        by_owner: byOwner.length,
        owner_share: Math.round(ownerShare * 100) / 100,
        owner_is_the_story: ownerIsTheStory,

        client_reason: clientPattern?.reason ?? null,
        client_reason_count: clientPattern?.count ?? null,
        client_reason_of: clientPattern?.recorded ?? null,
        client_confidence: clientPattern?.confidence ?? null,

        owner_reason: ownerPattern?.reason ?? null,
        owner_reason_count: ownerPattern?.count ?? null,
        owner_reason_of: ownerPattern?.recorded ?? null,
        owner_confidence: ownerPattern?.confidence ?? null,
      },
    });

    logger.info(
      {
        userId,
        cancellations: rows.length,
        byOwner: byOwner.length,
        clientReason: clientPattern?.reason ?? null,
        ownerReason: ownerPattern?.reason ?? null,
      },
      'Cancellations show a pattern'
    );
    this.logDetection(userId, result);
    return result;
  }

  /**
   * Which day or which service the cancellations concentrate on, if either.
   *
   * Its own query, because the reason analysis above loads only cancelled
   * rows and a rate needs the bookings that were NOT called off. Windowed on
   * `start_time` for both halves — see the note at the call site on why mixing
   * clocks can produce a rate over 100%.
   *
   * Never throws. A comparison decorates a card that stands on its own; a
   * failure here has to cost the decoration and nothing else.
   */
  private async cancelRateOutlier(
    userId: string,
    since: string
  ): Promise<{ dimension: string; name: string; rate: SegmentRate } | null> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_bookings')
        .select('id, status, start_time, service_id')
        .eq('user_id', userId)
        .gte('start_time', since)
        .lt('start_time', new Date().toISOString());

      if (error) throw error;

      /*
       * Only appointments whose outcome is known. A booking still sitting in
       * `confirmed` with its slot already past is an unmarked meeting, not an
       * attended one, and counting it as "not cancelled" would quietly deflate
       * every rate here.
       */
      const settled = ((data ?? []) as SettledRow[]).filter(r =>
        RESOLVED.has((r.status ?? '').toLowerCase())
      );

      const timezone = await this.resolveBusinessTimezone(userId);

      const dimensions: Dimension<SettledRow>[] = [];
      if (timezone) {
        dimensions.push({
          name: 'day_of_week',
          segmentOf: r => (r.start_time ? localWeekdayIn(new Date(r.start_time), timezone) : null),
        });
      }
      dimensions.push({ name: 'service', segmentOf: r => r.service_id });

      const { found, refusals } = firstOutlier(
        settled,
        r => (r.status ?? '').toLowerCase() === 'cancelled',
        dimensions
      );

      if (!found) {
        logger.debug(
          { userId, refusals, settled: settled.length, hasTimezone: Boolean(timezone) },
          'Cancellations are even across every slice; reporting the reasons alone'
        );
        return null;
      }

      let labels: Map<string, string> | undefined;
      if (found.dimension === 'service') {
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

      const name = nameSegment(found.dimension, found.comparison.segment, labels);
      if (!name) {
        // A UUID on a card is worse than no comparison at all.
        logger.debug({ userId, dimension: found.dimension }, 'Slice could not be named; omitting');
        return null;
      }

      return { dimension: found.dimension, name, rate: found.comparison };
    } catch (err) {
      logger.debug({ err, userId }, 'Cancellation rate comparison unavailable');
      return null;
    }
  }
}

/** The denominator's shape. Deliberately narrower than `CancelledRow`. */
interface SettledRow {
  id: string;
  status: string | null;
  start_time: string | null;
  service_id: string | null;
}

/**
 * Statuses that mean the appointment reached an outcome.
 *
 * `confirmed` is excluded on purpose even when the slot is in the past: that
 * is an unmarked meeting, and treating it as attended would understate every
 * cancellation rate on exactly the accounts that forget to mark them.
 */
const RESOLVED = new Set(['cancelled', 'completed', 'no_show']);
