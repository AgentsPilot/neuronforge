/**
 * Findings about the same person are one story, not three cards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE EXISTING CORRELATION LAYER NEVER FIRED
 *
 * `patterns.ts` holds ten patterns, each naming TWO SPECIFIC DETECTORS that
 * must fire in the same run (`requiredDetectors: ['cash_ar_overdue',
 * 'cash_payment_issues']`, `minMatches: 2`). An audit on 2026-10-06 found three
 * detectors firing on the reporting account and no pair among them appearing in
 * any pattern. The layer has produced nothing, ever, and it never could: it
 * needs somebody to have anticipated the exact combination.
 *
 * This asks a question nobody has to anticipate: do these findings concern the
 * SAME SUBJECT? Every detector already reports `affectedEntityIds`, so the
 * overlap is there to be read.
 *
 *   before   "An invoice is overdue"  ·  "A booking was cancelled"
 *            "A contact is stuck in a stage"      -- three cards, three facts
 *   after    "Three things are going wrong with one client"   -- one subject
 *
 * WHAT THIS IS HONESTLY WORTH
 *
 * At four clients the owner knows who David is, so this is mostly NOISE
 * REDUCTION: three cards become one, which is better at any size. At two
 * hundred clients it becomes insight -- naming the client quietly falling apart
 * is something nobody can hold in their head.
 *
 * Pure, with no database: the grouping is the judgement, and it should be
 * testable without fixtures. Same reasoning as `funnelGap` and `dominantReason`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The shape this needs from a detection; deliberately minimal. */
export interface SubjectCandidate {
  detectorId: string;
  affectedEntityType?: string;
  affectedEntityIds?: string[];
  estimatedImpactUsd?: number | null;
}

export interface SharedSubject<T extends SubjectCandidate = SubjectCandidate> {
  /** The entity every finding here is about. */
  entityType: string;
  entityId: string;
  findings: T[];
}

/**
 * Entity types worth grouping on.
 *
 * A CONTACT is a subject: several things going wrong around one person is a
 * story about that person. A BOOKING or an INVOICE is not -- two findings about
 * one invoice are usually the same problem described twice, and merging them
 * would hide a duplicate rather than reveal a connection.
 *
 * `service` is deliberately absent. Every booking has a service, so grouping on
 * it would collect findings that share nothing but a category and present that
 * as a discovery.
 */
const SUBJECT_TYPES = new Set(['contact']);

/**
 * How many distinct findings make a story.
 *
 * Two. One finding about a client is just that finding, and calling it a
 * "story about David" would be dressing a single fact in bigger clothes.
 */
const MIN_FINDINGS = 2;

/**
 * Group findings by the subject they are all about.
 *
 * A finding naming many entities (an overdue-invoice card covering nine
 * clients) contributes to each of them. That is intended: the story is "these
 * three things are happening to David", and the fact that one of them also
 * happens to eight other people does not make it less true of David.
 *
 * Returned largest-first, because the client with four things wrong is more
 * worth naming than the one with two.
 */
export function groupBySharedSubject<T extends SubjectCandidate>(
  findings: T[]
): SharedSubject<T>[] {
  const byEntity = new Map<string, { entityType: string; entityId: string; findings: T[] }>();

  for (const finding of findings) {
    const type = finding.affectedEntityType;
    if (!type || !SUBJECT_TYPES.has(type)) continue;

    for (const entityId of finding.affectedEntityIds ?? []) {
      if (!entityId) continue;

      const key = `${type}|${entityId}`;
      const bucket = byEntity.get(key) ?? { entityType: type, entityId, findings: [] };

      /*
       * One finding counts once per subject, however many times its id list
       * repeats. A detector listing the same contact twice is a detector bug,
       * and it must not be able to manufacture a story on its own.
       */
      if (!bucket.findings.some(f => f.detectorId === finding.detectorId)) {
        bucket.findings.push(finding);
      }
      byEntity.set(key, bucket);
    }
  }

  return [...byEntity.values()]
    .filter(b => b.findings.length >= MIN_FINDINGS)
    .sort((a, b) => b.findings.length - a.findings.length);
}

/**
 * What a subject's findings are worth together.
 *
 * Summed only where a figure exists. A finding with no impact contributes
 * nothing rather than zero -- the distinction this module has had to restate
 * repeatedly, because zero is a claim and absent is not.
 *
 * Returns null when NOTHING in the group carries money, so a caller renders no
 * figure at all instead of "£0 at stake".
 */
export function subjectImpact(subject: SharedSubject): number | null {
  const withMoney = subject.findings.filter(f => typeof f.estimatedImpactUsd === 'number');
  if (withMoney.length === 0) return null;
  return withMoney.reduce((sum, f) => sum + (f.estimatedImpactUsd as number), 0);
}
