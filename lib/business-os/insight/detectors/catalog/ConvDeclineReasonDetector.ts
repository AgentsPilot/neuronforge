/**
 * Why Quotes Are Being Turned Down
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The public quote page asks a declining client to pick a reason, and
 * `DECLINE_REASONS` is a closed, groupable set — `too_expensive`, `timing`,
 * `scope`, `chose_other`, `other`. `ProposalRepository` has been storing the
 * answer all along, and until now nothing read it.
 *
 * `ConvQuoteAcceptanceDropDetector` is the nearest thing and it answers a
 * different question: the SHARE of answered quotes that were accepted, quarter
 * against quarter. A falling rate tells an owner something is wrong. The reason
 * tells them what to change, and the platform already holds it.
 *
 * WHAT MAKES THIS WORTH A CARD, AND WHAT DOES NOT
 *
 * "Price is your top objection" names nothing an owner can do: every business
 * loses some work on price, and the sentence is almost always true. The finding
 * worth having is where the objection CONCENTRATES —
 *
 *   "every decline on the ₪8,500 package cited price; the ₪2,000 one has
 *    never lost on price"
 *
 * which is one quote, one service and one decision. So the cross-tab is not a
 * nice-to-have on top of the headline; on most accounts it IS the finding.
 *
 * THE JUDGEMENT IS NOT HERE
 *
 * Whether a tally is a pattern lives in `patterns/dominantReason.ts`: pure, no
 * database, and tested on its own. This file gathers rows and asks it. That
 * split is deliberate — the three ways this fabricates a finding (too few, a
 * flat spread, and our own blank reasons winning) are all decided there, where
 * they can be tested without a fixture.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import { createLogger } from '@/lib/logger';
import { canonicalReason } from '@/lib/business-os/cancellationReasons';
import { dominantReason, dominantWithin } from '../../patterns/dominantReason';

const logger = createLogger({ module: 'ConvDeclineReasonDetector' });

/**
 * How far back a decline still says something about how the business sells.
 *
 * Ninety days. A quarter is long enough to collect a sample from a business
 * that sends a handful of quotes a month, and short enough that the answer is
 * about today's prices rather than last year's.
 */
const LOOKBACK_DAYS = 90;

/**
 * The fewest declines in one service before that cell is reportable.
 *
 * Lower than the overall floor on purpose. A cross-tab divides an already
 * small sample, and demanding the full floor in every cell would mean no
 * business under a hundred declines ever sees the one finding that names
 * something to change.
 */
const CELL_MIN = 3;

interface DeclinedRow {
  id: string;
  contact_id: string | null;
  service_id: string | null;
  title: string | null;
  total: number | string | null;
  currency: string | null;
  decline_reason: string | null;
  decided_at: string | null;
  sent_at: string | null;
}

export class ConvDeclineReasonDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_decline_reason',
    name: 'Why Quotes Are Being Turned Down',
    category: 'conversion',
    description:
      'Groups declined quotes by the reason the client gave, and finds where that reason concentrates',

    watchedMetrics: ['conversion.decline_reason'],
    documentsEventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',

    /*
     * THREE, and deliberately not the ONE used by the stuck-contact and
     * held-money detectors.
     *
     * There, a single named instance IS the fact: one person parked in a stage,
     * one client's money being held. Here the pattern is the entire content of
     * the finding, and one client saying "too expensive" is a conversation, not
     * a signal. `dominantReason` enforces this too; stating it here keeps the
     * registry honest about what the detector claims.
     */
    minSamples: 3,

    severityFn: (count: number, _value: number): InsightSeverity => {
      // Graded on how much work is being lost the same way, never on the
      // money: a declined quote was never won, so nothing was lost from a
      // balance. See `impactDirection` below.
      if (count >= 6) return 'high';
      if (count >= 3) return 'medium';
      return 'low';
    },

    /*
     * No paired process, and nothing automatable.
     *
     * There is no action a platform can take on "your prices are too high".
     * Repricing a service is a business decision with a hundred inputs this
     * module cannot see, and a button offering to do it would be the clearest
     * possible case of the advisor overstepping what the evidence supports.
     */
    pairedProcessId: undefined,

    /*
     * Runs while the conversion vector is still dark. A business that has sent
     * twelve quotes has no baseline and may still have lost four of them the
     * same way, which is exactly when knowing why is most useful.
     */
    /*
     * Why quotes are lost is a share of the quotes that were answered. Below
     * the sample it is a coincidence with a label on it.
     */
    claimType: 'pattern',

    eligibleForAutomation: false,
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
      .from('proposals')
      .select('id, contact_id, service_id, title, total, currency, decline_reason, decided_at, sent_at')
      .eq('user_id', userId)
      .eq('status', 'declined')
      .gte('decided_at', since)
      .order('decided_at', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as DeclinedRow[];
    if (rows.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Grouped through `canonicalReason`, which folds equivalent spellings —
     * `too_expensive` and `client_cost` are the same objection recorded by two
     * different screens, and counting them apart would split a real pattern in
     * half and then report neither.
     *
     * A row with no reason keeps an empty key. It counts toward the total and
     * can never win; that rule lives in `dominantReason`.
     */
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = row.decline_reason ? canonicalReason(row.decline_reason) : '';
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const overall = dominantReason(counts, this.definition.minSamples);
    if (!overall) {
      // Too few, too flat, or nobody recorded a reason. All three are
      // "nothing honest to say", and none of them is an error.
      this.logDetection(userId, null);
      return null;
    }

    /*
     * Where the objection concentrates. Null is the ordinary case on a small
     * account and the headline stands on its own without it.
     */
    const byService = dominantWithin(
      rows,
      row => row.service_id,
      row => (row.decline_reason ? canonicalReason(row.decline_reason) : ''),
      CELL_MIN
    );

    const serviceName = byService
      ? rows.find(r => r.service_id === byService.slice)?.title ?? null
      : null;

    /*
     * What the declined work was worth, per currency and never summed across
     * them. There is no FX rate in this platform, so one combined figure would
     * be invented. Reported for the dominant currency only, with the flag
     * saying others exist.
     */
    const byCurrency = new Map<string, number>();
    for (const row of rows) {
      const amount = toNumber(row.total);
      if (amount <= 0) continue;
      const code = (row.currency || 'USD').toUpperCase();
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + amount);
    }
    const dominantCurrency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];

    const result = this.createDetectionResult({
      severity: this.definition.severityFn(overall.count, 0),
      metricKey: 'conversion.decline_reason',
      currentValue: overall.count,
      baselineValue: 0,
      thresholdValue: 0,
      /*
       * A count, so nothing moved by a percentage. Reporting 100 here reached
       * the narrator as a measurement once and produced sentences about "a
       * 100% increase" against a base of zero.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'proposal',
      affectedEntityIds: rows.map(row => row.id),
      affectedCount: overall.count,
      /*
       * `estimatedImpactUsd` and `impactDirection` are both deliberately unset.
       *
       * Declined work was never won, so no money left the business and none is
       * owed to it. Putting the quoted total in the impact field would make the
       * dashboard add up work the owner never had and call it a loss, which is
       * the most misleading figure this detector could produce. The value
       * travels in `processParameters` instead, where the copy can say "the
       * quotes came to X" without the dashboard summing it into a balance.
       */
      processParameters: {
        reason: overall.reason,
        reason_count: overall.count,
        declines_total: overall.total,
        declines_with_reason: overall.recorded,
        share: overall.share,
        confidence: overall.confidence,
        lookback_days: LOOKBACK_DAYS,
        // Null on most accounts, and the headline stands without it.
        concentrated_in_service_id: byService?.slice ?? null,
        concentrated_in_service: serviceName,
        concentrated_reason: byService?.pattern.reason ?? null,
        concentrated_count: byService?.pattern.count ?? null,
        concentrated_of: byService?.pattern.total ?? null,
        declined_value: dominantCurrency?.[1] ?? null,
        currency: dominantCurrency?.[0] ?? null,
        mixed_currency: byCurrency.size > 1,
      },
    });

    logger.info(
      { userId, reason: overall.reason, count: overall.count, of: overall.recorded },
      'Declined quotes share a reason'
    );
    this.logDetection(userId, result);
    return result;
  }
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
