/**
 * Is a distribution of reasons actually a pattern, or just a tally?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE
 *
 * Two detectors are about to ask the same question of two different tables —
 * why quotes are turned down, why bookings are called off — and the question
 * is entirely judgement. Counting is the easy half; deciding whether a count
 * means anything is where this module has already made expensive mistakes.
 *
 * So it lives here: pure, no database, no imports beyond its own types. The
 * same shape `funnelGap.ts` and `businessHealth.ts` use, and the reason both
 * are testable without a single fixture.
 *
 * THE THREE WAYS THIS GOES WRONG, AND WHAT STOPS EACH
 *
 *   Too few.      Two declines sharing a reason is a coincidence, and a card
 *                 reading "price is your main objection" off a sample of two
 *                 is the platform stating something it cannot know.
 *                 → `minSample`, and null below it.
 *
 *   Flat.         Five reasons at one each has a "largest" bucket, and naming
 *                 it is a fabrication dressed as arithmetic. The largest of
 *                 five near-equal things is not a finding.
 *                 → `MIN_SHARE`, and null below it.
 *
 *   Unknown wins. A business that never captures reasons has one enormous
 *                 bucket of blanks. Reporting it would tell the owner their
 *                 main problem is "no reason recorded", which is a fact about
 *                 our data collection and not about their business.
 *                 → blanks count toward the total and can never be dominant.
 *
 * The third is the subtle one. Blanks MUST stay in the total: dropping them
 * would turn "2 of 30, the rest unrecorded" into "2 of 2, a clear pattern",
 * which is the same lie arrived at from the other direction.
 *
 * @module lib/business-os/insight/patterns/dominantReason
 */

/**
 * The share of recorded reasons one has to hold before it is the story.
 *
 * Two fifths. Below it the distribution has no shape worth reporting: with
 * four reasons in play the leader can hold 30% and still be barely ahead of
 * the next, and an owner told "timing is why you lose work" would act on a
 * near-tie.
 */
export const MIN_SHARE = 0.4;

/**
 * How sure the sample lets us sound. Read by the copy, never by a threshold.
 *
 * Deliberately coarse. A continuous confidence score invites a sentence like
 * "73% confidence", which is a number nobody computed from anything.
 */
export type PatternConfidence = 'low' | 'medium' | 'high';

export interface DominantReason {
  /** The canonical code, e.g. `client_cost`. Never a blank bucket. */
  reason: string;
  /** How many carried it. */
  count: number;
  /** Everything considered, blanks included. The honest denominator. */
  total: number;
  /** How many of `total` carried ANY reason. `count / recorded` is the share. */
  recorded: number;
  /** `count / recorded`, rounded to two places. */
  share: number;
  confidence: PatternConfidence;
}

/**
 * Counts that are not a reason anyone chose.
 *
 * Passed as keys by callers that bucket with `cancelReasonBucket`, which falls
 * back to free prose and then to a label like 'No reason provided'. Prose is
 * not groupable and a fallback label is not a reason, so neither can win.
 */
function isRecordedReason(key: string): boolean {
  if (!key.trim()) return false;
  /*
   * A code, not a sentence. Every reason in `cancellationReasons.ts` is
   * lower_snake_case, and the fallback buckets are either human prose ("the
   * kids were ill") or a label ("No reason provided"). Both contain a space or
   * a capital; no code does.
   */
  return /^[a-z][a-z0-9_]*$/.test(key);
}

/**
 * The reason that dominates, or null when none honestly does.
 *
 * @param counts  reason code (or fallback bucket) → how many
 * @param minSample the fewest ROWS, blanks included, before any claim is made
 */
export function dominantReason(
  counts: Record<string, number>,
  minSample: number
): DominantReason | null {
  let total = 0;
  let recorded = 0;
  let best: { reason: string; count: number } | null = null;

  for (const [key, raw] of Object.entries(counts)) {
    const count = Number(raw) || 0;
    if (count <= 0) continue;

    total += count;
    if (!isRecordedReason(key)) continue;

    recorded += count;
    if (!best || count > best.count) best = { reason: key, count };
  }

  // Not enough has happened to say anything at all.
  if (total < minSample || !best) return null;

  /*
   * The share is of RECORDED reasons, not of the total.
   *
   * "4 of the 6 that gave a reason" is the true sentence. Dividing by a total
   * padded with blanks would understate a real pattern — a business that
   * captures reasons half the time would need twice the signal to be told
   * anything, which punishes the owner for our own gap in collection.
   *
   * The blanks are not lost: `total` and `recorded` both travel out, so the
   * copy can say how much of the picture it is speaking for.
   */
  const share = best.count / recorded;
  if (share < MIN_SHARE) return null;

  return {
    reason: best.reason,
    count: best.count,
    total,
    recorded,
    share: Math.round(share * 100) / 100,
    confidence: confidenceFor(recorded, share),
  };
}

/**
 * Sample first, then how clear-cut it is.
 *
 * A landslide across four rows is still four rows, so the sample caps what the
 * share can earn. This is the order that keeps "all 3 of them" from reading
 * like a law.
 */
function confidenceFor(recorded: number, share: number): PatternConfidence {
  if (recorded >= 10 && share >= 0.6) return 'high';
  if (recorded >= 5) return 'medium';
  return 'low';
}

/**
 * The same question, asked inside one slice of the data.
 *
 * "Price objections are only on the ₪8,500 package" is worth saying; "price is
 * your top objection" mostly is not, because it names nothing to change. This
 * finds the slice where a reason concentrates.
 *
 * `cellMinSample` is separate from and smaller than the overall one on purpose:
 * a cross-tab divides an already small sample, and requiring the full floor in
 * every cell would mean no business under a hundred declines ever sees one.
 * Three in a single cell against a clear overall pattern is a real signal; the
 * caller decides whether to report it alongside the headline or instead of it.
 */
export function dominantWithin<T>(
  rows: T[],
  sliceOf: (row: T) => string | null | undefined,
  reasonOf: (row: T) => string | null | undefined,
  cellMinSample: number
): { slice: string; pattern: DominantReason } | null {
  const bySlice = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const slice = sliceOf(row);
    // A row whose slice is unknown cannot be evidence ABOUT a slice.
    if (!slice) continue;

    const reason = reasonOf(row) || '';
    const counts = bySlice.get(slice) ?? {};
    counts[reason] = (counts[reason] ?? 0) + 1;
    bySlice.set(slice, counts);
  }

  let winner: { slice: string; pattern: DominantReason } | null = null;

  for (const [slice, counts] of bySlice) {
    const pattern = dominantReason(counts, cellMinSample);
    if (!pattern) continue;
    // The most concentrated cell, not the biggest. A slice where every single
    // one gave the same reason is the finding, even if another slice has more.
    if (!winner || pattern.share > winner.pattern.share) {
      winner = { slice, pattern };
    }
  }

  return winner;
}
