/**
 * The health score has to be about the business, not about our catalogue.
 *
 * The old one scored 80 per category with no insights and subtracted a severity
 * penalty per insight — so an empty account was told "your business is doing
 * well at 81/100", and shipping a detector lowered everybody's score. These
 * tests pin the two rules that replace it: compare a business with its own
 * past, and say nothing where there is too little to say.
 */

import {
  scoreCategory,
  summariseHealth,
  healthScore,
  rate,
  MIN_SAMPLE,
  type Measure,
  type CategoryHealth,
} from '../businessHealth';

const measure = (overrides: Partial<Measure> = {}): Measure => ({
  current: 50,
  previous: 40,
  sample: 20,
  previousSample: 20,
  ...overrides,
});

describe('rate', () => {
  it('computes a percentage', () => {
    expect(rate(3, 12)).toBe(25);
  });

  it('refuses a zero denominator rather than returning NaN', () => {
    /*
     * The single most common source of a fabricated figure here: NaN and
     * Infinity both render beside a percent sign without complaint.
     */
    expect(rate(3, 0)).toBeNull();
  });

  it('refuses a non-finite input', () => {
    expect(rate(Number.NaN, 10)).toBeNull();
    expect(rate(1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('scoreCategory', () => {
  it('reports the rate and how far it moved', () => {
    const health = scoreCategory('conversion', measure({ current: 31, previous: 22 }));

    expect(health.rate).toBe(31);
    expect(health.previousRate).toBe(22);
    expect(health.change).toBe(9);
    expect(health.unavailable).toBeNull();
  });

  it('says too little data rather than scoring a small sample', () => {
    /*
     * With four contacts a conversion rate can only be 0, 25, 50 or 75, and
     * none of those is a fact about the business.
     */
    const health = scoreCategory('conversion', measure({ sample: MIN_SAMPLE.conversion - 1 }));

    expect(health.rate).toBeNull();
    expect(health.unavailable).toBe('too_little_data');
  });

  it('gives a first-period business a rate and no trend', () => {
    // "Down 100%" against a period that did not exist is the shape removed
    // from sixteen detectors.
    const health = scoreCategory('conversion', measure({ previous: null, previousSample: 0 }));

    expect(health.rate).toBe(50);
    expect(health.change).toBeNull();
    expect(health.unavailable).toBeNull();
  });

  it('withholds the comparison when last period was too thin to compare with', () => {
    const health = scoreCategory('conversion', measure({ previousSample: 2 }));

    expect(health.rate).toBe(50);
    expect(health.previousRate).toBeNull();
    expect(health.change).toBeNull();
  });

  it('says pricing is not measurable rather than scoring it', () => {
    /*
     * Nothing records a discount and both pricing detectors are dark. The old
     * scorer gave this category 80 for having no insights, which read as "your
     * pricing is healthy".
     */
    const health = scoreCategory('pricing', measure({ sample: 10_000 }));

    expect(health.rate).toBeNull();
    expect(health.unavailable).toBe('not_measurable');
  });

  it('never returns zero where it means unknown', () => {
    const health = scoreCategory('retention', measure({ current: null, sample: 0 }));

    expect(health.rate).toBeNull();
    expect(health.rate).not.toBe(0);
  });
});

describe('summariseHealth', () => {
  const category = (change: number | null, rateValue: number | null = 50): CategoryHealth => ({
    category: 'conversion',
    rate: rateValue,
    previousRate: change === null ? null : rateValue! - change,
    change,
    measureKey: 'k',
    unavailable: rateValue === null ? 'too_little_data' : null,
    sample: 30,
  });

  it('reports the share of measures that improved', () => {
    const health = summariseHealth([category(10), category(8), category(-9), category(-4)]);

    expect(health.improved).toBe(2);
    expect(health.declined).toBe(2);
    expect(health.movingUp).toBe(50);
  });

  it('treats a small wobble as steady rather than a direction', () => {
    // One client rebooking must not be reported as a trend.
    const health = summariseHealth([category(1), category(-1), category(20)]);

    expect(health.steady).toBe(2);
    expect(health.improved).toBe(1);
  });

  it('says nothing overall from a single comparable measure', () => {
    /*
     * "100% of measures improved" from one measure is a sentence about one
     * number wearing the clothes of a summary.
     */
    const health = summariseHealth([category(10), category(null)]);

    expect(health.movingUp).toBeNull();
  });

  it('counts what is measured apart from what is not', () => {
    const health = summariseHealth([category(10), category(null, null), category(null, null)]);

    expect(health.measured).toBe(1);
    expect(health.unavailable).toBe(2);
  });

  it('is null overall for a business with nothing measurable yet', () => {
    const health = summariseHealth([category(null, null), category(null, null)]);

    expect(health.movingUp).toBeNull();
    expect(health.measured).toBe(0);
  });
});

/**
 * The score the owner reads, out of 100.
 *
 * Its whole meaning rests on one thing: **50 is unchanged**. The number that
 * preceded it was a count of our own detections dressed as a grade, and the
 * number that briefly replaced it was the SHARE of measures improving — so a
 * business with two of four moving up would have been told it scored 50/100 as
 * though that were a mark out of a hundred. These tests pin the scale itself.
 */
describe('healthScore', () => {
  const moved = (change: number | null): CategoryHealth => ({
    category: 'conversion',
    rate: 50,
    previousRate: change === null ? null : 50 - change,
    change,
    measureKey: 'k',
    unavailable: null,
    sample: 30,
  });

  it('sits at 50 when nothing has moved', () => {
    // The honest reading of a steady month: this month looks like last month.
    expect(healthScore([moved(0), moved(0), moved(0)])).toBe(50);
  });

  it('rises above 50 when the measured rates improve', () => {
    const score = healthScore([moved(10), moved(10)]);

    expect(score).toBeGreaterThan(50);
    expect(score).toBe(75);
  });

  it('falls below 50 when they slip', () => {
    const score = healthScore([moved(-10), moved(-10)]);

    expect(score).toBeLessThan(50);
    expect(score).toBe(25);
  });

  it('averages the movement rather than counting directions', () => {
    /*
     * One category up ten points and one down ten is a flat month, and must
     * not read the same as both up ten. `movingUp` cannot express this — it
     * would say 50% either way — which is exactly why the score is its own
     * function rather than that share renamed.
     */
    expect(healthScore([moved(10), moved(-10)])).toBe(50);
    expect(healthScore([moved(10), moved(10)])).toBe(75);
  });

  it('never leaves the range, however extreme the month', () => {
    expect(healthScore([moved(90), moved(90)])).toBe(100);
    expect(healthScore([moved(-90), moved(-90)])).toBe(0);
  });

  it('says nothing rather than guessing from a single measure', () => {
    // A score derived from one number is a sentence about one number.
    expect(healthScore([moved(20)])).toBeNull();
    expect(healthScore([])).toBeNull();
  });

  it('ignores categories with nothing to compare', () => {
    // A category with no previous period contributes no movement, and must not
    // be read as zero movement — that would drag every score towards 50.
    expect(healthScore([moved(10), moved(10), moved(null), moved(null)])).toBe(75);
  });

  it('is null, never zero, when it cannot be computed', () => {
    /*
     * The distinction the whole scale depends on. Zero means every measure
     * collapsed; null means we have nothing to say. A caller coercing one into
     * the other tells a brand-new business its score is rock bottom.
     */
    const noScore = healthScore([moved(null), moved(null)]);

    expect(noScore).toBeNull();
    expect(noScore).not.toBe(0);
  });
});
