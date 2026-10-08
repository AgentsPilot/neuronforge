/**
 * The model proposes; this decides. Nothing here trusts the model's judgement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS THE WHOLE FEATURE
 *
 * Letting a model loose on business data is the most dangerous thing this
 * module could do. One session removed a fabricated 275% refund rate, counts
 * rendered as money, and figures invented out of absent keys -- all from
 * hand-written code that was merely careless. A model is not careless; it is
 * fluent, which is worse.
 *
 * So the model never reports anything. It proposes a QUESTION and commits, in
 * advance, to what would count as an answer. This file runs the question and
 * applies that commitment. Every figure that reaches a screen comes from a
 * query result; the model supplies none.
 *
 * THE DENOMINATOR IS DERIVED, NOT SUPPLIED
 *
 * A grouped `ComputeResult` carries `groups: [{ key, value }]` and NO row count
 * per group. So "this group has at least five rows behind it" cannot be checked
 * from the measure alone -- and without that check the guard is decorative:
 *
 *     "Clients who book on Mondays never come back"
 *     Monday had ONE client, who did not return. 0% repeat on Mondays.
 *
 * Arithmetically perfect, utterly meaningless, and no `min_ratio` catches it.
 *
 * The denominator could be asked of the model, but then a wrong or missing one
 * becomes a new trust surface. `deriveDenominator` builds it instead: the same
 * entity, the same filters, the same grouping, counting rows. The model cannot
 * get it wrong because the model is not consulted.
 *
 * This is also the discipline the hand-written detectors kept failing at. Every
 * share this module has had to correct -- the refund rate, the manual booking
 * share, the no-show spike -- was a numerator in search of a denominator.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ComputeQuery, ComputeResult } from '../../bizql/types';

/**
 * What the model may commit to, and nothing else.
 *
 * A CLOSED set, evaluated by the code below. Free-text conditions were the
 * obvious alternative and would have meant the model grading its own homework:
 * "confirm if this looks significant" is not a condition, it is a mood.
 *
 * Deliberately two kinds. Each needs a denominator and each is checkable
 * without interpretation. More can be added when a real proposal is turned away
 * for lack of one -- which is evidence, where guessing now would not be.
 */
export type ConfirmWhen =
  | {
      /** One group differs from the best group by at least `minRatio`. */
      kind: 'group_differs';
      /** Groups with fewer rows than this are discarded before comparing. */
      minRowsPerGroup: number;
      /** Best ÷ worst must reach this. 2 = "twice as good". */
      minRatio: number;
    }
  | {
      /**
       * One group is zero while others are not: the "never" claims.
       * "Clients from this source never rebook", "this slot never converts".
       */
      kind: 'group_is_zero';
      minRowsPerGroup: number;
      /** How many non-zero groups must exist for a zero to mean anything. */
      minOtherGroups: number;
    };

export const CONFIRM_WHEN_KINDS = ['group_differs', 'group_is_zero'] as const;

/**
 * Floors the model cannot talk its way under.
 *
 * It names `minRowsPerGroup` itself -- which is the point, it has to commit --
 * but a proposal asking for 1 is asking to be allowed the Monday finding. The
 * verifier raises anything below the floor rather than rejecting it, because
 * the proposal may otherwise be sound and the model has no stake in the number.
 */
export const MIN_ROWS_FLOOR = 5;
export const MIN_OTHER_GROUPS_FLOOR = 2;

/** A proposal, as it arrives from the model and before anything is believed. */
export interface Proposal {
  /** One sentence, no figures. The verifier supplies every number. */
  claim: string;
  /** The measure, usually grouped. */
  query: ComputeQuery;
  confirmWhen: ConfirmWhen;
}

export type RejectReason =
  | 'claim_contains_figure'
  | 'not_grouped'
  | 'unknown_confirm_kind'
  | 'no_groups_returned'
  | 'too_few_groups_with_evidence'
  | 'condition_not_met'
  | 'currency_mix'
  | 'unreadable_groups'
  | 'tautology';

export interface Verdict {
  confirmed: boolean;
  reason?: RejectReason;
  /**
   * The groups that survived the row floor, with the evidence behind each.
   * Carried so a published finding can show its provenance, and so a review
   * screen can show why it was rejected.
   */
  groups: Array<{ key: string; id?: string; value: number; rows: number }>;
  /** Filled on confirmation: what the claim actually rests on. */
  best?: { key: string; value: number; rows: number };
  worst?: { key: string; value: number; rows: number };
  ratio?: number;
}

/**
 * Does the claim smuggle a figure?
 *
 * The model is told to write prose without numbers because the verifier owns
 * every figure. A claim that carries one has either guessed it or read it from
 * the profile, and either way it is a number nobody computed for this result.
 * Rejected outright rather than stripped: a claim built around a figure stops
 * making sense without it, and a half-edited sentence is worse than none.
 *
 * Spelled-out small numbers are allowed ("some clients never rebook"); digits
 * and per-cent signs are not. Ordinals and years are permitted because they
 * name things rather than measure them.
 */
export function claimCarriesFigure(claim: string): boolean {
  const withoutYears = claim.replace(/\b(19|20)\d{2}\b/g, '');
  const withoutOrdinals = withoutYears.replace(/\b\d+(st|nd|rd|th)\b/gi, '');
  return /\d/.test(withoutOrdinals) || /[%‰]/.test(withoutOrdinals);
}

/**
 * Is this question incapable of being interesting?
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Counting unfiltered rows per group ALWAYS varies. Five services will always
 * have five different booking counts; that is what five numbers look like, not
 * a discovery. The live run proved it: "some services have more bookings than
 * others" cleared the row floor on five groups with a real 2.1x ratio and was
 * worth nothing.
 *
 * This is the difference between a VOLUME question and an OUTCOME question,
 * and it is the whole gap between a true card and a useful one:
 *
 *   count bookings per service          tautology -- bigger things are bigger
 *   count CANCELLED bookings per service  a finding -- one service loses people
 *
 * The filter is what turns the second into a question about behaviour rather
 * than about size. A `sum` or an `avg` is exempt: averaging a value per group
 * can legitimately come out flat, so an uneven result means something.
 *
 * This fails at ANY data volume, which is why it is a rule and not a threshold.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function isTautology(query: ComputeQuery): boolean {
  if (query.agg?.fn !== 'count') return false;
  // A filter makes it a question about which rows, not how many exist.
  return !query.where || query.where.length === 0;
}

/**
 * Are these groups something a person could read?
 *
 * Found on the very first live run. The model grouped bookings by the raw
 * `service_id` column and the verifier happily confirmed that one group had
 * 2.6x the bookings of another -- naming both as UUIDs:
 *
 *   "5be8fe70-daac-... has 2.6x more than 72d698b5-b846-..."
 *
 * Arithmetically sound and completely useless, which is the same failure mode
 * as the Monday case wearing different clothes. A finding nobody can read is
 * not a finding.
 *
 * BizQL already solves this: grouping by a RELATION resolves ids to labels,
 * which is why `ComputeResult.groups` carries `key` (what the group is called)
 * separately from `id` (what it is). Grouping by the raw foreign-key column
 * skips that resolution and leaves the uuid in `key`. So this is a signal to
 * group differently, not a limit of the data -- the prompt now says so, and
 * this is the check behind the instruction.
 */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function groupsAreReadable(groups: Array<{ key: string }>): boolean {
  if (groups.length === 0) return false;
  // Every key, not most: one unresolved id in a comparison makes the whole
  // sentence unsayable.
  return groups.every(g => !UUID_LIKE.test(g.key.trim()));
}

/**
 * The count version of the measure query.
 *
 * Same entity, same filters, same grouping, counting rows. `select`, `order`
 * and limits are dropped because they cannot change a count per group, and
 * carrying them would only create ways for the two queries to disagree.
 */
export function deriveDenominator(query: ComputeQuery): ComputeQuery {
  return {
    op: 'compute',
    entity: query.entity,
    ...(query.where ? { where: query.where } : {}),
    ...(query.group_by ? { group_by: query.group_by } : {}),
    /*
     * `over` MUST be carried, and forgetting it was a real bug here.
     *
     * It names a relation to aggregate across -- "every service, counting its
     * bookings" -- and it is what makes a service with NO bookings appear at
     * zero instead of vanishing from the result. Dropping it from the
     * denominator would count the parent rows instead of the related ones, so
     * every group's row count would come back as 1 and the row floor would
     * reject every `over` finding for having no evidence. The guard would have
     * looked like it was working.
     */
    ...(query.over ? { over: query.over } : {}),
    agg: { fn: 'count' },
  } as ComputeQuery;
}

/** Raise a proposal's floors to the minimum this module will accept. */
export function withEnforcedFloors(confirmWhen: ConfirmWhen): ConfirmWhen {
  if (confirmWhen.kind === 'group_differs') {
    return {
      ...confirmWhen,
      minRowsPerGroup: Math.max(confirmWhen.minRowsPerGroup, MIN_ROWS_FLOOR),
      // A ratio below 1 inverts the comparison; below 1.5 is noise on any real data.
      minRatio: Math.max(confirmWhen.minRatio, 1.5),
    };
  }
  return {
    ...confirmWhen,
    minRowsPerGroup: Math.max(confirmWhen.minRowsPerGroup, MIN_ROWS_FLOOR),
    minOtherGroups: Math.max(confirmWhen.minOtherGroups, MIN_OTHER_GROUPS_FLOOR),
  };
}

/**
 * Apply the committed condition to the measured result.
 *
 * Pure: both results are passed in, already executed. The caller owns the
 * database and this owns the judgement, which is what makes the judgement
 * testable without fixtures.
 */
export function evaluate(
  proposal: Proposal,
  measure: ComputeResult,
  denominator: ComputeResult
): Verdict {
  const empty: Verdict = { confirmed: false, groups: [] };

  if (claimCarriesFigure(proposal.claim)) {
    return { ...empty, reason: 'claim_contains_figure' };
  }

  if (!CONFIRM_WHEN_KINDS.includes(proposal.confirmWhen.kind as never)) {
    return { ...empty, reason: 'unknown_confirm_kind' };
  }

  /*
   * Refused before the query runs. There is no result that could rescue a
   * question whose answer is arithmetic rather than information.
   */
  if (isTautology(proposal.query)) {
    return { ...empty, reason: 'tautology' };
  }

  /*
   * Both halves must be grouped, or there is nothing to compare.
   *
   * An ungrouped compute returns one number, and "this group differs" has no
   * meaning against a single total. The model is told to group; this is the
   * check rather than the trust.
   */
  if (!measure.groups?.length || !denominator.groups?.length) {
    return { ...empty, reason: 'not_grouped' };
  }

  /*
   * Money that cannot be added must not be compared either.
   *
   * `currencyBreakdown` is present only when the rows span more than one
   * currency, and then `value` is the LARGEST single currency's total rather
   * than the whole. Ranking groups on that compares a part to a whole. There is
   * no FX rate anywhere in this platform, so the honest answer is to decline.
   */
  if (measure.currencyBreakdown?.length) {
    return { ...empty, reason: 'currency_mix' };
  }

  const rowsByKey = new Map(denominator.groups.map(g => [g.key, g.value]));

  const condition = withEnforcedFloors(proposal.confirmWhen);

  const groups = measure.groups
    .map(g => ({ key: g.key, id: g.id, value: g.value, rows: rowsByKey.get(g.key) ?? 0 }))
    .filter(g => g.rows >= condition.minRowsPerGroup);

  // THE MONDAY GUARD. One client in a group is not a finding about that group.
  if (groups.length === 0) {
    return { ...empty, reason: 'no_groups_returned' };
  }

  /*
   * Checked AFTER the row floor, so a stray uuid in a group that was going to
   * be discarded anyway does not sink an otherwise readable finding.
   */
  if (!groupsAreReadable(groups)) {
    return { ...empty, groups, reason: 'unreadable_groups' };
  }

  const ranked = [...groups].sort((a, b) => b.value - a.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  if (condition.kind === 'group_is_zero') {
    const zero = groups.filter(g => g.value === 0);
    const nonZero = groups.filter(g => g.value > 0);

    if (zero.length === 0) {
      return { ...empty, groups, reason: 'condition_not_met' };
    }

    /*
     * A zero is only interesting beside enough non-zeros.
     *
     * "This source never rebooks" said of the only source with any evidence is
     * a statement about the business, not about the source.
     */
    if (nonZero.length < condition.minOtherGroups) {
      return { ...empty, groups, reason: 'too_few_groups_with_evidence' };
    }

    return { confirmed: true, groups, best, worst: zero[0] };
  }

  // group_differs
  if (groups.length < 2) {
    return { ...empty, groups, reason: 'too_few_groups_with_evidence' };
  }

  /*
   * A zero worst makes the ratio infinite, which is `group_is_zero`'s claim and
   * not this one. Declining here keeps the two conditions from overlapping:
   * a proposal that means "never" should have said so and committed to
   * `minOtherGroups`.
   */
  if (worst.value <= 0) {
    return { ...empty, groups, reason: 'condition_not_met' };
  }

  const ratio = best.value / worst.value;
  if (ratio < condition.minRatio) {
    return { ...empty, groups, reason: 'condition_not_met' };
  }

  return {
    confirmed: true,
    groups,
    best,
    worst,
    ratio: Math.round(ratio * 10) / 10,
  };
}
