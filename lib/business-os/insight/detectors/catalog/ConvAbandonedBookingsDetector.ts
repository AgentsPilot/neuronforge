/**
 * Clients who chose a time, reached the card, and did not finish.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A CANCELLATION
 *
 * A cancellation is a decision somebody made about a booking that exists. This
 * is the opposite: no booking was ever created, on purpose, because writing one
 * before the money would hold an hour for a client who may never pay.
 *
 * The trace is an `abandoned_bookings` row, and until this detector nothing
 * outside the booking flow read that table. The owner had no way to learn that
 * four people reached the card for one service this week and none of them
 * finished — which is the kind of thing that means a price, a page or a
 * processor is wrong, and is invisible in every other number on the dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REPORTS THE SERVICE, BECAUSE THAT IS THE ACTIONABLE PART
 *
 * "Six people abandoned" is a statistic. "Six people abandoned the same
 * service, and nobody abandoned the other four" is a lead. The grouping is in
 * the parameters so the card can name the service rather than a count.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT COUNT
 *
 * Only card journeys produce an attempt at all, so this measures that subset
 * and no other. A free or invoiced service writes its booking immediately and
 * has no incomplete state to abandon — a client who walks away there leaves a
 * real booking, which is a different problem and not this one.
 *
 * It also ignores attempts still at `started`: those are people who may be
 * typing their card number right now. Only `abandoned` counts, which the
 * sweeper sets after the attempt has been cold for 30 minutes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

interface AbandonedRow {
  id: string;
  service_id: string | null;
  start_time: string | null;
  created_at: string;
  recovery_email_sent_at: string | null;
}

export class ConvAbandonedBookingsDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'conv_abandoned_bookings',
    name: 'Abandoned Bookings',
    category: 'conversion',
    description:
      'Detects clients who chose a time and reached the payment step without finishing',

    watchedMetrics: ['conversion.abandoned_bookings'],
    documentsEventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    /* Two in a week. One is a dropped phone; two is a pattern worth a look,
       and this is a quiet card rather than an alarm. */
    threshold: 2,
    direction: 'above',
    minSamples: 2,

    severityFn: (count: number, concentration: number): InsightSeverity => {
      /* Concentration is the share falling on a single service. Six spread
         across six services is noise; six on one service is a broken page. */
      if (count >= 6 && concentration >= 0.6) return 'high';
      if (count >= 4) return 'medium';
      return 'low';
    },

    /*
     * `claimType: 'instance'` (hazard H15).
     *
     * `currentValue` is a COUNT of people who reached the card and did not
     * finish. Four abandonments are four abandonments whether the business
     * took four bookings that week or four hundred — each row is a real person
     * who really left, so there is no denominator and no rate being claimed.
     * The same reading as an overdue invoice.
     *
     * Declared rather than left to default, because `effectiveClaimType`
     * assumes `rate` and would hold the card until the conversion vector is
     * fully lit. A new business is exactly who needs to hear that nobody is
     * finishing.
     *
     * `concentration` IS a rate, and it is deliberately kept out of the claim:
     * it only ever moves severity between low and high, never whether the card
     * appears, and `by_service` hands the reader the counts to judge it on.
     */
    claimType: 'instance',

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AUTOMATABLE NOW, AND IT WAS NOT BEFORE.
     *
     * This read `undefined` / `false`, on sound reasoning: the only action
     * anyone could have offered was an email to somebody who had just decided
     * not to pay, and the card's real finding is the CONCENTRATION — several
     * on one service is a broken page or a price nobody will meet, which no
     * automation can fix.
     *
     * Both halves still hold, and the second is why this card keeps existing
     * rather than being replaced by the agent. What changed is that there is
     * now a bounded, owner-controlled thing to offer: `recover_abandoned_
     * checkouts` writes ONCE more, only to attempts the twice-hourly sweep has
     * already finished with, only while the attempt is still `abandoned`, and
     * only inside a window the owner chooses on the install dialog. It stops
     * the moment they book, because `convertAttempt` moves the row.
     *
     * So the division is: the agent does the asking, and the card still
     * carries the judgement the owner alone can make.
     * ─────────────────────────────────────────────────────────────────────────
     */
    pairedProcessId: 'send_followup_nudge',
    eligibleForAutomation: true,
    cooldownHours: 168, // a week: this is a trend, not an incident
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async detect(userId: string): Promise<DetectionResult | null> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const { data: thisWeek, error } = await this.supabase
      .from('abandoned_bookings')
      .select('id, service_id, start_time, created_at, recovery_email_sent_at')
      .eq('user_id', userId)
      .eq('status', 'abandoned')
      .gte('created_at', weekAgo.toISOString())
      .lt('created_at', now.toISOString());

    if (error) {
      throw error;
    }

    const rows = (thisWeek ?? []) as AbandonedRow[];
    const count = rows.length;

    if (count < this.definition.threshold) {
      this.logDetection(userId, null);
      return null;
    }

    /* Last week, for context rather than for a threshold: the card says
       whether this is new or usual. */
    const { data: lastWeek } = await this.supabase
      .from('abandoned_bookings')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'abandoned')
      .gte('created_at', twoWeeksAgo.toISOString())
      .lt('created_at', weekAgo.toISOString());

    const previousCount = lastWeek?.length ?? 0;

    /* Which service, and how concentrated. */
    const byService = new Map<string, number>();
    for (const row of rows) {
      const key = row.service_id ?? 'unknown';
      byService.set(key, (byService.get(key) ?? 0) + 1);
    }

    const ranked = [...byService.entries()].sort((a, b) => b[1] - a[1]);
    const [worstServiceId, worstCount] = ranked[0] ?? ['unknown', 0];
    const concentration = count > 0 ? worstCount / count : 0;

    const serviceNames = await this.namesFor(
      ranked.map(([id]) => id).filter(id => id !== 'unknown')
    );

    /*
     * What the hours were worth, where a price is known.
     *
     * Read from the service rather than the attempt: an attempt records what
     * the client chose, not what they would have been charged, and a plan's
     * first instalment is not the service's price.
     */
    const estimated = await this.valueOf(ranked, byService);

    const severity = this.definition.severityFn(count, concentration);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.abandoned_bookings',
      currentValue: count,
      baselineValue: previousCount,
      thresholdValue: this.definition.threshold,
      percentChange:
        previousCount > 0
          ? Math.round(((count - previousCount) / previousCount) * 100)
          : null,
      direction: 'above',
      affectedEntityType: 'booking',
      affectedEntityIds: rows.map(r => r.id),
      affectedCount: count,
      estimatedImpactUsd: estimated ?? undefined,
      impactDirection: 'loss',
      impactPeriod: 'weekly',
      processParameters: {
        abandoned_this_week: count,
        abandoned_last_week: previousCount,
        /* Named, not just counted — the owner acts on the service. */
        worst_service_id: worstServiceId === 'unknown' ? null : worstServiceId,
        worst_service_name: serviceNames.get(worstServiceId) ?? null,
        worst_service_count: worstCount,
        by_service: ranked.map(([id, n]) => ({
          service_id: id === 'unknown' ? null : id,
          service_name: serviceNames.get(id) ?? null,
          count: n,
        })),
        /* So the owner knows whether these people already heard from us. */
        already_emailed: rows.filter(r => r.recovery_email_sent_at).length,
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /** Service names, so a card never shows an id to an owner. */
  private async namesFor(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (ids.length === 0) return names;

    const { data } = await this.supabase
      .from('scheduling_services')
      .select('id, service_name')
      .in('id', ids);

    for (const row of data ?? []) {
      names.set(row.id as string, row.service_name as string);
    }
    return names;
  }

  /**
   * The money that did not arrive, or null.
   *
   * Null rather than zero where no price is known: reporting nothing is honest,
   * reporting zero says these bookings were worthless.
   */
  private async valueOf(
    ranked: Array<[string, number]>,
    byService: Map<string, number>
  ): Promise<number | null> {
    const ids = ranked.map(([id]) => id).filter(id => id !== 'unknown');
    if (ids.length === 0) return null;

    const { data } = await this.supabase
      .from('scheduling_services')
      .select('id, price')
      .in('id', ids);

    let total = 0;
    let known = false;

    for (const row of data ?? []) {
      const price = Number(row.price ?? 0);
      if (!price) continue;
      known = true;
      total += price * (byService.get(row.id as string) ?? 0);
    }

    return known ? total : null;
  }
}
