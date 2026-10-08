/**
 * Does one part of the business behave differently from the rest?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A card that says "30% of your bookings are cancelled" tells an owner what she
 * can already read off her own calendar. A card that says "Thursday 43%,
 * everything else 8%" tells her something she cannot see, and names the thing
 * to change. The difference between those two sentences is this module.
 *
 * An audit of the catalogue found 35 of 46 detectors reporting a STATE against
 * an absolute threshold rather than a CHANGE, because nothing in the module
 * compared anything to anything. Comparing a business to its peers was
 * considered and rejected as a product (no account's data informs another's),
 * so the reference has to come from inside the same business: her days, her
 * services, her booking channels.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE: COMPARE RATES, NEVER VOLUMES.
 *
 * "Thursday has more bookings" is not a finding. It means she works Thursdays.
 * "Thursday is cancelled more often" is a finding.
 *
 * This is enforced by the SHAPE of the function, not by a check inside it:
 * `isHit` is a required predicate, so every comparison is `hits / of` within a
 * segment against `hits / of` across the others. There is no bare-count mode to
 * reach for. A caller passing `isHit: () => true` gets every rate at 1.0 and an
 * honest `flat` refusal, which is the correct answer to a question with no
 * numerator.
 *
 * It is the segment-shaped sibling of `isTautology` in `hypothesis/verify.ts`,
 * which rejects a bare `count` with no `where` for exactly the same reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS NOT
 *
 * `dominantReason.ts` next door answers a DIFFERENT question: inside one slice,
 * which reason code dominates. That is a categorical distribution. This is a
 * rate against a pooled remainder. The two are easy to confuse by name and
 * impossible to confuse by signature — that one needs a reason per row, this
 * one needs a yes/no per row. Its `PatternConfidence` and its discipline of
 * letting sample size cap how sure the copy may sound are reused here.
 *
 * Pure: no database, no clock, no imports beyond its sibling's type. The same
 * shape `funnelGap.ts` and `businessHealth.ts` use, and the reason all three
 * are testable without a fixture.
 *
 * @module lib/business-os/insight/patterns/segmentRate
 */

import type { PatternConfidence } from './dominantReason';

/**
 * The fewest rows a segment needs before its rate means anything.
 *
 * Five, matching `MIN_TO_JUDGE` in `funnelGap.ts` — the same judgement about
 * the same kind of number, so it would be strange for the two to disagree.
 * Below it, one extra cancellation swings the rate by twenty points.
 */
export const MIN_PER_SEGMENT = 5;

/**
 * How far ahead the outlier has to be before it is worth a card.
 *
 * Twice the rest. Not a tuned number: at anything less the owner would be
 * acting on a near-tie, and the module has spent a lot of effort removing cards
 * that dress a coin-flip as a finding.
 */
export const MIN_RATIO = 2;

/** One segment, measured against everything that is not it. */
export interface SegmentRate {
  /** The segment key, as `segmentOf` returned it. Never blank. */
  segment: string;
  /** How many rows in this segment hit. */
  hits: number;
  /** How many rows are in this segment at all. The honest denominator. */
  of: number;
  /** `hits / of`, rounded to three places. */
  rate: number;
  /** Every OTHER segment, pooled. See the note on pooling in `outlierSegment`. */
  rest: { hits: number; of: number; rate: number };
  /** `rate / rest.rate`, rounded to one place. Never `Infinity` — see `restZero`. */
  ratio: number;
  confidence: PatternConfidence;
}

/**
 * The answer, or the named reason there isn't one.
 *
 * A discriminated verdict rather than `null`, copying `GapVerdict` in
 * `funnelGap.ts`. The reason is not style: several silent refusals in this
 * module went unnoticed for weeks precisely because the only thing a caller
 * could observe was an absence. A `kind` can be logged.
 */
export type SegmentVerdict =
  /** No row carried a usable segment key. */
  | { kind: 'noSegments' }
  /** Only one segment exists, so there is nothing to be a "rest". */
  | { kind: 'tooFewSegments' }
  /** No segment reached `minPerSegment`. */
  | { kind: 'tooSmall' }
  /** The pooled remainder is too thin to be a reference. */
  | { kind: 'restTooSmall' }
  /** The rest never hits. An infinite ratio is not a finding. */
  | { kind: 'restZero' }
  /** A leader exists, but not far enough ahead to be worth saying. */
  | { kind: 'flat' }
  | { kind: 'outlier'; comparison: SegmentRate };

interface Tally {
  hits: number;
  of: number;
}

/**
 * Sample first, then how clear-cut it is.
 *
 * The same order as `confidenceFor` in `dominantReason.ts`, for the same
 * reason: a landslide across five rows is still five rows. BOTH sides have to
 * be substantial — a 10-row segment against a 6-row remainder is not a
 * confident finding however large the ratio, because the reference is as thin
 * as the claim.
 */
function confidenceFor(segment: Tally, rest: Tally, ratio: number): PatternConfidence {
  if (segment.of >= 10 && rest.of >= 10 && ratio >= 3) return 'high';
  if (segment.of >= 8 && rest.of >= 8) return 'medium';
  return 'low';
}

/** Two places for a rate, one for a ratio. Nothing here is precise enough for more. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The segment that stands out, or the reason none does.
 *
 * @param rows      whatever the detector already loaded; never re-queried here
 * @param segmentOf the part of the business this row belongs to, or null to exclude it
 * @param isHit     the thing being measured — cancelled, no-showed, converted
 */
export function outlierSegment<T>(
  rows: T[],
  opts: {
    segmentOf: (row: T) => string | null | undefined;
    isHit: (row: T) => boolean;
    minPerSegment?: number;
    minRatio?: number;
  }
): SegmentVerdict {
  const minPerSegment = opts.minPerSegment ?? MIN_PER_SEGMENT;
  const minRatio = opts.minRatio ?? MIN_RATIO;

  const tallies = new Map<string, Tally>();
  let total: Tally = { hits: 0, of: 0 };

  for (const row of rows) {
    const key = opts.segmentOf(row);
    /*
     * A row with no segment is excluded from BOTH sides.
     *
     * It cannot be evidence about a segment, and letting it fall into the
     * remainder would quietly load the reference with rows that belong
     * nowhere. `dominantReason` documents the mirror of this mistake for blank
     * reason codes.
     */
    if (key === null || key === undefined || !String(key).trim()) continue;

    const segment = String(key);
    const hit = opts.isHit(row) ? 1 : 0;

    const tally = tallies.get(segment) ?? { hits: 0, of: 0 };
    tally.hits += hit;
    tally.of += 1;
    tallies.set(segment, tally);

    total = { hits: total.hits + hit, of: total.of + 1 };
  }

  if (tallies.size === 0) return { kind: 'noSegments' };
  if (tallies.size < 2) return { kind: 'tooFewSegments' };

  /*
   * The leader is chosen by RATE, among segments that clear the floor.
   *
   * Only the outlier has to clear it. The remainder is every other segment
   * POOLED, thin ones included -- pooling is what makes the reference solid on
   * a small account, and excluding a two-booking service from the comparison
   * would also quietly exclude its two bookings from the thing being compared
   * against.
   */
  let leader: { segment: string; tally: Tally; rate: number } | null = null;

  for (const [segment, tally] of tallies) {
    if (tally.of < minPerSegment) continue;
    const rate = tally.hits / tally.of;
    if (!leader || rate > leader.rate) leader = { segment, tally, rate };
  }

  if (!leader) return { kind: 'tooSmall' };

  const rest: Tally = {
    hits: total.hits - leader.tally.hits,
    of: total.of - leader.tally.of,
  };

  if (rest.of < minPerSegment) return { kind: 'restTooSmall' };

  const restRate = rest.hits / rest.of;
  /*
   * Nothing in the rest of the business hits.
   *
   * The ratio would be infinite, and a card reading "Thursday cancels
   * infinitely more often" is the module stating something arithmetic rather
   * than true. There may well be a finding here, but it is not a RATIO finding,
   * so this says so rather than inventing a number.
   */
  if (restRate === 0) return { kind: 'restZero' };

  const ratio = leader.rate / restRate;
  if (ratio < minRatio) return { kind: 'flat' };

  return {
    kind: 'outlier',
    comparison: {
      segment: leader.segment,
      hits: leader.tally.hits,
      of: leader.tally.of,
      rate: round(leader.rate, 3),
      rest: { hits: rest.hits, of: rest.of, rate: round(restRate, 3) },
      ratio: round(ratio, 1),
      confidence: confidenceFor(leader.tally, rest, ratio),
    },
  };
}

/** Weekday codes as `localWeekdayIn` emits them, in the order a week runs. */
const WEEKDAY_NAMES: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/**
 * The slice, named so a person recognises it.
 *
 * A comparison the owner cannot locate is the dead-link card again — "one
 * group is four times worse" drew the reply "which one?". The detector resolves
 * the key here and puts the result in `narrationSubject`, because the card
 * components declare `process_parameters` and none of them render it.
 *
 * English on purpose. It goes into `narrationSubject`, which is scaffolding for
 * a model that writes the card in the owner's language — the same field already
 * carries "the booking link '5 שירותים', 25 clicks", where the English frames a
 * name that stays as it is. A weekday is a word, not a figure, so translating
 * it is the one thing a model is reliably good at.
 *
 * Returns null when the key cannot be named: a service whose row has gone, or
 * a dimension with no lookup. The caller then omits the comparison rather than
 * printing a UUID.
 */
export function nameSegment(
  dimension: string,
  key: string,
  labels?: Map<string, string> | Record<string, string>
): string | null {
  if (dimension === 'day_of_week') return WEEKDAY_NAMES[key] ?? null;

  if (!labels) return null;
  const found = labels instanceof Map ? labels.get(key) : labels[key];
  return found?.trim() ? found : null;
}

/** One way of slicing the same rows: by day, by service, by channel. */
export interface Dimension<T> {
  /** A stable key — `'day_of_week'`, `'service'`. Travels to the card's copy. */
  name: string;
  segmentOf: (row: T) => string | null | undefined;
}

/**
 * Try several ways of slicing the data and take the first that finds something.
 *
 * Three detectors ask this in the same shape — is it the day, or the service?
 * — and the order matters: the dimensions are tried as given, so a detector
 * puts its most actionable slice first rather than taking whichever happens to
 * produce the largest ratio. A bigger number is not a better card.
 *
 * `refusals` is the point of the return shape. Every refusal in this module
 * used to be an absence, and an absence cannot be logged — which is how
 * several detectors sat silent for weeks with nobody able to say why. The
 * caller logs this map at debug and the reason is in the log.
 */
export function firstOutlier<T>(
  rows: T[],
  isHit: (row: T) => boolean,
  dimensions: Dimension<T>[],
  opts?: { minPerSegment?: number; minRatio?: number }
): {
  found: { dimension: string; comparison: SegmentRate } | null;
  refusals: Record<string, SegmentVerdict['kind']>;
} {
  const refusals: Record<string, SegmentVerdict['kind']> = {};

  for (const dimension of dimensions) {
    const verdict = outlierSegment(rows, {
      segmentOf: dimension.segmentOf,
      isHit,
      minPerSegment: opts?.minPerSegment,
      minRatio: opts?.minRatio,
    });

    if (verdict.kind === 'outlier') {
      return { found: { dimension: dimension.name, comparison: verdict.comparison }, refusals };
    }

    refusals[dimension.name] = verdict.kind;
  }

  return { found: null, refusals };
}
