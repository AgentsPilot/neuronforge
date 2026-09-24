/**
 * How the business is doing, measured against how it was doing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * The health score was a count of our own detections. A category with no
 * insights scored exactly 80 — "default healthy" — and each insight subtracted
 * a severity penalty. Three things followed:
 *
 *   an account with no data at all scored 81 and was told "your business is
 *   doing well", which is the strongest possible version of the advisor
 *   stating something it cannot know;
 *
 *   shipping a detector LOWERED every affected business's score, and deleting
 *   one raised it, so the number moved with our code rather than their trade;
 *
 *   the weekly narrative then described the score back to the owner —
 *   "your acquisition score is strong at 85" — so the story was about our
 *   catalogue wearing the language of their business.
 *
 * WHY EACH CATEGORY IS COMPARED WITH ITSELF
 *
 * A 0-100 grade needs a benchmark. A 31% repeat rate is excellent for a
 * consultant seeing clients twice a year and poor for a barber, and this
 * platform has no industry data for either. Inventing a curve would be the same
 * fabrication as the `$75` an hour and the `* 0.3` rebooking rate.
 *
 * A business compared with its own previous period needs no benchmark and is
 * always true. "Your repeat rate is 31%, up from 22%" is a fact; "your
 * retention scores 62/100" is an opinion wearing a number's clothes.
 *
 * NOT ENOUGH DATA IS AN ANSWER
 *
 * Every measure carries a minimum sample, and below it the category reports
 * `null` rather than a figure. Null is not zero and must never be rendered as
 * one: it means the platform has nothing honest to say yet, which is the
 * correct thing to tell a new business about its retention.
 *
 * Pure. No imports, no database — the resolver hands it facts and it returns
 * arithmetic, so every rule here is testable without a fixture.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/insight/health/businessHealth
 */

export type HealthCategory =
  | 'cash_flow'
  | 'retention'
  | 'conversion'
  | 'sales'
  | 'operations'
  | 'acquisition'
  | 'pricing';

/**
 * One measure, in the two periods being compared.
 *
 * `current` and `previous` are rates in the same unit — always a percentage
 * here — and `sample` is how many things the CURRENT rate was computed from.
 * A previous period with too little behind it makes the comparison, not the
 * rate, unavailable.
 */
export interface Measure {
  current: number | null;
  previous: number | null;
  sample: number;
  previousSample: number;
}

export interface CategoryHealth {
  category: HealthCategory;
  /** The measured rate this period, or null when there is too little to say. */
  rate: number | null;
  /** The same rate last period, or null. */
  previousRate: number | null;
  /** Percentage points moved. Null when either period is unavailable. */
  change: number | null;
  /** What the rate counts, for the narrative. A translation key, not prose. */
  measureKey: string;
  /** Why it is null, when it is. */
  unavailable: 'too_little_data' | 'not_measurable' | null;
  sample: number;
}

/**
 * The fewest things a rate may be computed from.
 *
 * Each is the point below which the percentage swings on a single event — with
 * four contacts a conversion rate can only be 0, 25, 50 or 75, and none of
 * those is a fact about the business.
 */
export const MIN_SAMPLE: Record<HealthCategory, number> = {
  cash_flow: 3,
  retention: 5,
  conversion: 10,
  sales: 5,
  operations: 8,
  acquisition: 25,
  pricing: Number.POSITIVE_INFINITY,
};

/**
 * What each category's rate actually counts.
 *
 * Keys rather than sentences: this runs server-side where there is no reader to
 * have a language, the same discipline the rest of the module follows.
 */
export const MEASURE_KEY: Record<HealthCategory, string> = {
  cash_flow: 'health.measure.invoices_paid_on_time',
  retention: 'health.measure.clients_who_returned',
  conversion: 'health.measure.contacts_who_became_clients',
  sales: 'health.measure.enquiries_replied_to',
  operations: 'health.measure.calendar_filled',
  acquisition: 'health.measure.visitors_who_got_in_touch',
  pricing: 'health.measure.none',
};

/**
 * Each category in the words the owner would use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOR THE PROMPT, not for the screen. The card renders `MEASURE_KEY` through
 * the translation layer; this is what the narrator is TOLD each figure is, and
 * it exists because it was previously told the category id.
 *
 * Handed `acquisition` and `cash_flow`, the model wrote back "your acquisition
 * score is impressive at 85" and "review cash flow strategies to ensure
 * stability" — to a massage therapist, about her own week. Those are not words
 * she uses and not questions she asks. She asks whether people are finding her
 * and whether she has been paid.
 *
 * Written as the QUESTION each rate answers, so the sentence the model builds
 * around it is already in plain language rather than translated into it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MEASURE_IN_PLAIN_WORDS: Record<HealthCategory, string> = {
  cash_flow: 'invoices that were paid on time',
  retention: 'people who came back a second time',
  conversion: 'people who got in touch and went on to become clients',
  sales: 'enquiries that got a reply',
  operations: 'how much of the time that was available to book actually got booked',
  acquisition: 'people who visited the website and then got in touch',
  pricing: 'prices (nothing records discounts yet, so this cannot be measured)',
};

/**
 * Turn one measure into a category's health.
 *
 * The rate is reported when the sample supports it. The CHANGE additionally
 * needs a previous period with its own sample — a business's first month has a
 * rate and no trend, and saying "down 100%" against a period that did not exist
 * is exactly the shape removed from sixteen detectors.
 */
export function scoreCategory(category: HealthCategory, measure: Measure): CategoryHealth {
  const base = {
    category,
    measureKey: MEASURE_KEY[category],
    sample: measure.sample,
  };

  // Nothing measures pricing today. Saying so beats scoring it 80.
  if (!Number.isFinite(MIN_SAMPLE[category])) {
    return { ...base, rate: null, previousRate: null, change: null, unavailable: 'not_measurable' };
  }

  if (measure.current === null || measure.sample < MIN_SAMPLE[category]) {
    return { ...base, rate: null, previousRate: null, change: null, unavailable: 'too_little_data' };
  }

  const comparable =
    measure.previous !== null && measure.previousSample >= MIN_SAMPLE[category];

  return {
    ...base,
    rate: round(measure.current),
    previousRate: comparable ? round(measure.previous!) : null,
    change: comparable ? round(measure.current - measure.previous!) : null,
    unavailable: null,
  };
}

export interface BusinessHealth {
  categories: CategoryHealth[];
  /**
   * How the business is moving overall: the share of measurable categories
   * that improved, as a percentage.
   *
   * Deliberately NOT an average of the rates. Averaging a 31% repeat rate with
   * a 95% on-time payment rate produces a number with no meaning — they are
   * different quantities. What can honestly be combined is direction: of the
   * things we can measure, how many got better.
   *
   * Null until at least two categories can be compared, because "100% of
   * measures improved" from a single measure is a sentence about one number.
   */
  movingUp: number | null;
  improved: number;
  declined: number;
  steady: number;
  /** Categories with a rate but no comparison yet, and those with neither. */
  measured: number;
  unavailable: number;
}

/**
 * A movement smaller than this is noise, not a trend.
 *
 * Two percentage points. Below it a rate that wobbled because one client
 * rebooked would be reported to the owner as a direction of travel.
 */
const MEANINGFUL_POINTS = 2;

export function summariseHealth(categories: CategoryHealth[]): BusinessHealth {
  const comparable = categories.filter(c => c.change !== null);

  const improved = comparable.filter(c => c.change! > MEANINGFUL_POINTS).length;
  const declined = comparable.filter(c => c.change! < -MEANINGFUL_POINTS).length;
  const steady = comparable.length - improved - declined;

  return {
    categories,
    movingUp: comparable.length >= 2 ? round((improved / comparable.length) * 100) : null,
    improved,
    declined,
    steady,
    measured: categories.filter(c => c.rate !== null).length,
    unavailable: categories.filter(c => c.rate === null).length,
  };
}

/**
 * How far a 20-point average move stretches on the 0-100 scale.
 *
 * A DISPLAY CHOICE, not a claim. It asserts nothing about the business: it only
 * decides how much of the range a given movement occupies, and 20 points of
 * average change across every measured category is the practical ceiling — a
 * business whose on-time payment, repeat and reply rates all moved that far in
 * four weeks has had an extraordinary month in one direction or the other.
 *
 * Kept separate from `MEANINGFUL_POINTS`, which is a judgement about noise.
 */
const POINTS_TO_SCORE = 2.5;

/** Where the scale sits when nothing has moved. */
const UNCHANGED = 50;

/**
 * The business measured against itself, as a number out of 100.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT 100 MEANS, AND WHY IT IS NOT AN ABSOLUTE GRADE
 *
 * There is no benchmark anywhere in this platform, and inventing one would be
 * the same fabrication the module spent a rework removing: a 3% visitor-to-
 * enquiry rate is excellent and a 40% repeat rate is poor, depending entirely on
 * the trade. So the comparison is against the only yardstick that is genuinely
 * available — the SAME business's previous 28 days.
 *
 * **50 means nothing changed.** Above it the measured rates are improving,
 * below it they are slipping. A business trading steadily and well sits near
 * fifty, which is the honest reading: this month looks like last month.
 *
 * WHY NOT AN AVERAGE OF THE RATES
 *
 * Because they are different quantities. The mean of a 31% repeat rate and a 95%
 * on-time payment rate is not a fact. What CAN be combined across categories is
 * how far each one moved, in percentage points, against its own previous value.
 *
 * NULL RATHER THAN A NUMBER
 *
 * Fewer than two comparable categories yields null, matching `movingUp` — a
 * score derived from one measure is a sentence about one number wearing the
 * clothes of a summary. Null must reach the reader as *no score*, never as
 * zero: on this scale zero means every measure collapsed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function healthScore(categories: CategoryHealth[]): number | null {
  const comparable = categories.filter(c => c.change !== null);
  if (comparable.length < 2) return null;

  const meanChange =
    comparable.reduce((sum, c) => sum + c.change!, 0) / comparable.length;

  const score = UNCHANGED + meanChange * POINTS_TO_SCORE;

  // Clamped, because an exceptional month must not report 140 out of 100.
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * A rate as a percentage, or null when the denominator cannot carry one.
 *
 * Zero denominators are the single most common source of a fabricated figure in
 * this module — they produce NaN and Infinity, both of which render beside a
 * currency symbol or a percent sign without complaint.
 */
export function rate(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return (part / whole) * 100;
}

/** One decimal place. Enough to show movement, not enough to imply precision. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
