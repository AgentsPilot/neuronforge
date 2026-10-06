/**
 * Two cards about the same thing, and which one survives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Forty-four detectors run against one business, and four metrics are watched
 * by more than one of them. Nothing stopped two from putting the SAME contact
 * on the dashboard twice. It has already happened on a live account:
 *
 *   2026-09-17  contact 8742fc  → ret_package_ending + conv_no_next_step
 *   2026-09-29  contact 96b4cd  → conv_no_next_step
 *   2026-09-30  contact 96b4cd  → conv_pipeline_stuck
 *
 * The second pair is a day apart, which is worse than the same day: the owner
 * reads two cards about one person and cannot tell whether that is one problem
 * or two.
 *
 * The meeting reminder solved exactly this for sends — the spike-triggered
 * reminder stands down when the standing one covers the booking — and the
 * insight cards had no equivalent. This is that stand-down, for cards.
 *
 * WHY HERE, AND NOT IN THE DETECTORS
 *
 * A detector that had to know about other detectors would couple all
 * forty-four together, and the one that happened to run first would win by
 * accident. This runs once at the READ, which is the single place every
 * surface goes through, and the precedence is declared rather than emergent.
 *
 * WHAT IS DELIBERATELY NOT SUPPRESSED
 *
 * Only cards that would tell the owner THE SAME THING TO DO. Two findings
 * about one booking are not a duplicate when the actions differ: money held on
 * a cancelled appointment says "decide whether to refund", and a cancellation
 * pattern says "look at your diary". Both are worth a card, and the groups
 * below are deliberately short because of it.
 *
 * Pure. No database, no imports — the shape `funnelGap.ts` and
 * `dominantReason.ts` already use, and the reason this is testable without a
 * fixture.
 *
 * @module lib/business-os/insight/dedupe/overlappingInsights
 */

/**
 * Detectors that genuinely say the same thing, MOST SPECIFIC FIRST.
 *
 * The order is the whole judgement. Within a group, the first detector to name
 * an entity keeps it and the rest go quiet about that entity only — they still
 * appear for anyone else they name.
 *
 * A pair belongs here when an owner reading both cards would take ONE action.
 * Where the actions differ the cards both stand, however much the subject
 * overlaps.
 */
export const OVERLAP_GROUPS: readonly (readonly string[])[] = [
  /*
   * Both say "this contact is not moving". `conv_pipeline_stuck` names the
   * days and the stage, so it wins; `conv_no_next_step` is the same fact with
   * less detail. Confirmed on live data a day apart, for contact 96b4cd.
   */
  ['conv_pipeline_stuck', 'conv_no_next_step'],

  /*
   * Three ways of saying "this client is drifting", all on
   * `retention.clients_at_risk`. The action is the same each time: get in
   * touch. A package ending is the most concrete reason and dates itself, so
   * it leads; reschedule churn names a behaviour; engagement decay is the
   * residue, true of anyone quiet for long enough.
   */
  ['ret_package_ending', 'ret_reschedule_churn', 'crm_engagement_decay'],

  /*
   * One booking, one unpaid amount. `cash_payment_issues` knows WHY it failed
   * — a declined card is a different conversation from one never attempted —
   * so where both name the booking, the reason is the more useful card.
   */
  ['cash_payment_issues', 'cash_booking_unpaid'],

  /*
   * A page nobody converts on, and a page with no call to action. The second
   * explains the first and names the fix, so it leads.
   */
  ['web_missing_cta', 'web_page_no_conversions'],
];

/**
 * Overlaps that were considered and deliberately LEFT ALONE.
 *
 * Here so the guard test can tell "nobody thought about this pair" from "two
 * cards here is correct". Adding a detector that shares a metric with an
 * existing one must land in one list or the other.
 */
export const DELIBERATELY_SEPARATE: readonly (readonly string[])[] = [
  /*
   * Cancellations, from three angles with three different answers: money still
   * held (refund or keep it), a recurring cause (change something), and
   * last-minute notice (a policy question). An owner acts differently on each.
   */
  ['cash_cancelled_unrefunded', 'ret_cancel_pattern', 'ret_cancellation_spike', 'ops_last_minute_cancels'],

  /*
   * Unpaid money at three altitudes: which invoices are late, how the debt is
   * distributed by age, and one total for everything outstanding. A summary and
   * its parts are not duplicates of each other.
   */
  ['cash_ar_overdue', 'cash_ar_aging', 'cash_revenue_at_risk'],

  /*
   * The acceptance rate falling, and the reason clients give. Complementary by
   * construction — the second is the answer to the question the first raises.
   */
  ['conv_quote_acceptance_drop', 'conv_decline_reason'],
];

/** The minimum an insight has to look like for this to decide anything. */
export interface OverlappableInsight {
  detector_id: string;
  affected_entity_ids?: string[] | null;
  affected_entity_type?: string | null;
}

export interface Suppression {
  detectorId: string;
  /** The detector that claimed the entity first. */
  coveredBy: string;
  /** The entity they both named. */
  entityId: string;
}

/**
 * Drop the cards that repeat one already on the list.
 *
 * Display ORDER is preserved exactly: the decision is made in precedence order
 * and then applied as a filter over the original array. Re-sorting would hand
 * the dashboard a list ranked by this module's opinion of specificity rather
 * than by priority, which is not its business.
 */
export function dedupeOverlapping<T extends OverlappableInsight>(
  insights: T[]
): { kept: T[]; suppressed: Suppression[] } {
  const dropped = new Set<number>();
  const suppressed: Suppression[] = [];

  /*
   * One group at a time, each with its own claim map.
   *
   * Per-group rather than one shared map, because two detectors from DIFFERENT
   * groups naming one contact is not a duplicate: money owed and a stalled
   * pipeline are separate problems that happen to share a person, and
   * suppressing one would hide a debt because somebody is also slow to reply.
   */
  for (const members of OVERLAP_GROUPS) {
    const claimed = new Map<string, string>();

    /*
     * Walked in PRECEDENCE order, ties broken by arrival.
     *
     * Not by sorting the caller's array — that comparator would be
     * inconsistent for insights outside the group and `Array.sort` is free to
     * do anything with one of those. Selecting the group first keeps the
     * ordering total over the only rows it applies to.
     */
    const inGroup = insights
      .map((insight, index) => ({ insight, index, rank: members.indexOf(insight.detector_id) }))
      .filter(entry => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index);

    for (const { insight, index } of inGroup) {
      const ids = insight.affected_entity_ids ?? [];
      // About the business rather than a person. Nothing to clash with.
      if (ids.length === 0) continue;

      /*
       * ───────────────────────────────────────────────────────────────────────
       * SUPPRESSED ONLY WHEN EVERY NAME ON IT IS ALREADY COVERED.
       *
       * Partial overlap is the common case, not the exotic one: three contacts
       * have no next step and one of them is also stuck. Dropping the card on
       * the strength of that one would lose two real findings to silence a
       * third, and a card that never appears is a loss nobody can see.
       *
       * The card then survives WHOLE, still naming the covered person. This
       * module decides which cards show; rewriting their contents is not its
       * business, and a card whose numbers disagreed with its own list would
       * be the worse bargain.
       * ───────────────────────────────────────────────────────────────────────
       */
      const covered = ids.filter(id => claimed.has(id));

      if (covered.length === ids.length) {
        dropped.add(index);
        suppressed.push({
          detectorId: insight.detector_id,
          coveredBy: claimed.get(covered[0])!,
          entityId: covered[0],
        });
        continue;
      }

      for (const id of ids) {
        if (!claimed.has(id)) claimed.set(id, insight.detector_id);
      }
    }
  }

  return {
    kept: insights.filter((_, index) => !dropped.has(index)),
    suppressed,
  };
}
