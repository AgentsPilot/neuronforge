/**
 * `outlierSegment`: does one part of the business behave differently?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The first test is the rule the whole design rests on: a segment with MORE
 * ROWS but the SAME RATE is not a finding. Everything else here is a refusal
 * this module has already shipped the wrong version of once -- a ratio taken on
 * a sample too small to carry it (the 275% refund rate), and a denominator
 * loaded with rows that belong nowhere.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  outlierSegment,
  firstOutlier,
  nameSegment,
  MIN_PER_SEGMENT,
  MIN_RATIO,
  type SegmentVerdict,
} from '../segmentRate';

/** A booking, reduced to the two things a comparison needs. */
interface Row {
  day: string | null;
  cancelled: boolean;
}

/** `n` rows in `day`, of which `hits` are cancelled. */
function rows(day: string | null, of: number, hits: number): Row[] {
  return Array.from({ length: of }, (_, i) => ({ day, cancelled: i < hits }));
}

const byDay = {
  segmentOf: (r: Row) => r.day,
  isHit: (r: Row) => r.cancelled,
};

/** Narrow to the outlier case, failing loudly with the refusal kind if it is not. */
function outlier(verdict: SegmentVerdict) {
  if (verdict.kind !== 'outlier') {
    throw new Error(`expected an outlier, got "${verdict.kind}"`);
  }
  return verdict.comparison;
}

describe('the volume rule', () => {
  it('refuses a segment that is merely bigger', () => {
    /*
     * THE TEST THIS MODULE EXISTS FOR.
     *
     * Thursday has four times the bookings of every other day and four times
     * the cancellations. The rate is identical. "Thursday has more
     * cancellations" is true, useless, and exactly what a volume comparison
     * would report.
     */
    const verdict = outlierSegment(
      [...rows('thu', 40, 10), ...rows('tue', 10, 2), ...rows('wed', 10, 3)],
      byDay
    );

    expect(verdict.kind).toBe('flat');
  });

  it('has no bare-count mode to misuse', () => {
    // Every row hits, so every rate is 1.0 and the ratio is 1.0.
    const verdict = outlierSegment([...rows('thu', 20, 20), ...rows('tue', 20, 20)], {
      segmentOf: (r: Row) => r.day,
      isHit: () => true,
    });

    expect(verdict.kind).toBe('flat');
  });

  it('reports a segment whose RATE stands out, even when it is the smaller one', () => {
    // Thursday: 6 of 14 = 43%. The rest: 4 of 52 = 7.7%. The card from the design.
    const verdict = outlierSegment(
      [...rows('thu', 14, 6), ...rows('tue', 26, 2), ...rows('wed', 26, 2)],
      byDay
    );

    const c = outlier(verdict);
    expect(c.segment).toBe('thu');
    expect(c.hits).toBe(6);
    expect(c.of).toBe(14);
    expect(c.rest).toEqual({ hits: 4, of: 52, rate: 0.077 });
    expect(c.ratio).toBe(5.6);
  });
});

describe('samples too small to carry a ratio', () => {
  it('never names a segment too small to judge, however extreme its rate', () => {
    /*
     * THE `OpsServicePerformanceDetector` BUG, IN MINIATURE.
     *
     * A service booked twice, cancelled both times, is "100%" -- the most
     * extreme rate in the business and the least meaningful. The detector that
     * does this by hand today would report it. Here it cannot be the leader at
     * all, so the honest answer is that the two real services are level.
     */
    const verdict = outlierSegment(
      [...rows('rare', 2, 2), ...rows('main', 40, 4), ...rows('other', 20, 2)],
      byDay
    );

    expect(verdict.kind).toBe('flat');
    expect(JSON.stringify(verdict)).not.toContain('rare');
  });

  it('refuses when no segment at all reaches the floor', () => {
    const verdict = outlierSegment(
      [...rows('a', 4, 4), ...rows('b', 3, 0), ...rows('c', 2, 0)],
      byDay
    );

    expect(verdict.kind).toBe('tooSmall');
  });

  it('refuses when the remainder is too thin to be a reference', () => {
    // A 20-row leader is useless if the only thing to compare it against is 3 rows.
    const verdict = outlierSegment([...rows('thu', 20, 15), ...rows('tue', 3, 0)], byDay);

    expect(verdict.kind).toBe('restTooSmall');
  });

  it('honours the floor it is given over the default', () => {
    const tight = outlierSegment([...rows('thu', 6, 5), ...rows('tue', 6, 1)], {
      ...byDay,
      minPerSegment: 10,
    });

    expect(tight.kind).toBe('tooSmall');
  });

  it('caps confidence by the thinner side, not the ratio', () => {
    /*
     * A 10x ratio across 6 rows is still 6 rows. `medium` needs 8 both sides,
     * `high` needs 10 both sides AND a ratio of 3.
     */
    const thin = outlier(outlierSegment([...rows('thu', 6, 6), ...rows('tue', 6, 1)], byDay));
    expect(thin.confidence).toBe('low');

    const solid = outlier(
      outlierSegment([...rows('thu', 12, 9), ...rows('tue', 12, 2)], byDay)
    );
    expect(solid.confidence).toBe('high');
  });
});

describe('the refusals that would otherwise be invented numbers', () => {
  it('never returns an infinite ratio', () => {
    // Nothing outside Thursday is ever cancelled. There may be a finding here,
    // but it is not a ratio, so it says so rather than dividing by zero.
    const verdict = outlierSegment([...rows('thu', 10, 4), ...rows('tue', 20, 0)], byDay);

    expect(verdict.kind).toBe('restZero');
  });

  it('refuses when there is nothing to be a remainder', () => {
    expect(outlierSegment(rows('thu', 30, 10), byDay).kind).toBe('tooFewSegments');
  });

  it('refuses when no row carries a segment', () => {
    expect(outlierSegment(rows(null, 30, 10), byDay).kind).toBe('noSegments');
    expect(outlierSegment([], byDay).kind).toBe('noSegments');
  });
});

describe('rows that belong nowhere', () => {
  it('excludes a null segment from BOTH sides of the comparison', () => {
    /*
     * The subtle one. If unsegmented rows fell into the remainder they would
     * quietly load the reference with rows that are not evidence about any
     * part of the business -- the mirror of the blank-reason mistake
     * `dominantReason` documents.
     */
    const clean = outlier(
      outlierSegment([...rows('thu', 14, 6), ...rows('tue', 52, 4)], byDay)
    );

    const withOrphans = outlier(
      outlierSegment(
        [...rows('thu', 14, 6), ...rows('tue', 52, 4), ...rows(null, 100, 90)],
        byDay
      )
    );

    expect(withOrphans).toEqual(clean);
  });

  it('treats a blank or whitespace key as no segment at all', () => {
    const verdict = outlierSegment(
      [...rows('thu', 14, 6), ...rows('tue', 52, 4), ...rows('   ', 40, 38)],
      byDay
    );

    expect(outlier(verdict).rest.of).toBe(52);
  });
});

describe('trying several ways of slicing the same rows', () => {
  interface Booking {
    day: string | null;
    service: string | null;
    cancelled: boolean;
  }

  const dims = [
    { name: 'day_of_week', segmentOf: (b: Booking) => b.day },
    { name: 'service', segmentOf: (b: Booking) => b.service },
  ];

  /** `n` bookings on `day` for `service`, of which `hits` cancelled. */
  const book = (day: string | null, service: string | null, of: number, hits: number): Booking[] =>
    Array.from({ length: of }, (_, i) => ({ day, service, cancelled: i < hits }));

  it('takes the dimension given first, not the biggest ratio', () => {
    /*
     * Both slices would find something, and service has the larger gap. Order
     * is the caller's judgement about which is more actionable, so a bigger
     * number must not override it.
     */
    const rows = [
      ...book('thu', 'deep', 12, 9),
      ...book('tue', 'deep', 12, 1),
      ...book('tue', 'quick', 12, 0),
    ];

    const { found } = firstOutlier(rows, b => b.cancelled, dims);

    expect(found?.dimension).toBe('day_of_week');
    expect(found?.comparison.segment).toBe('thu');
  });

  it('falls through to the next dimension when the first refuses', () => {
    // Every day is level at 30%; the services are 50% against 10%.
    const rows = [
      ...book('thu', 'deep', 10, 5),
      ...book('thu', 'quick', 10, 1),
      ...book('tue', 'deep', 10, 5),
      ...book('tue', 'quick', 10, 1),
    ];

    const { found, refusals } = firstOutlier(rows, b => b.cancelled, dims);

    expect(refusals.day_of_week).toBe('flat');
    expect(found?.dimension).toBe('service');
    expect(found?.comparison.segment).toBe('deep');
  });

  it('names every refusal so a silent detector can be explained', () => {
    /*
     * The reason this returns a map rather than null. An absence cannot be
     * logged, which is how detectors in this module sat quiet for weeks with
     * nobody able to say why.
     */
    const rows = [...book('thu', 'deep', 10, 1), ...book('tue', 'quick', 10, 1)];

    const { found, refusals } = firstOutlier(rows, b => b.cancelled, dims);

    expect(found).toBeNull();
    expect(refusals).toEqual({ day_of_week: 'flat', service: 'flat' });
  });
});

describe('naming the slice', () => {
  it('turns a weekday code into a word a model can translate', () => {
    expect(nameSegment('day_of_week', 'thu')).toBe('Thursday');
    expect(nameSegment('day_of_week', 'sun')).toBe('Sunday');
  });

  it('refuses a weekday code it does not recognise', () => {
    // Rather than printing the raw key onto a card.
    expect(nameSegment('day_of_week', 'xyz')).toBeNull();
  });

  it('resolves a service id through the labels it is given', () => {
    const labels = new Map([['svc-1', 'Deep Tissue']]);
    expect(nameSegment('service', 'svc-1', labels)).toBe('Deep Tissue');
  });

  it('returns null rather than a UUID when the row has gone', () => {
    /*
     * The rule this exists for. "One group is four times worse" with a UUID
     * attached is the dead-link card again; the caller drops the whole
     * comparison instead.
     */
    expect(nameSegment('service', 'svc-missing', new Map())).toBeNull();
    expect(nameSegment('service', 'svc-1')).toBeNull();
    expect(nameSegment('service', 'svc-1', { 'svc-1': '   ' })).toBeNull();
  });

  it('returns null for a dimension with no lookup', () => {
    expect(nameSegment('channel', 'website')).toBeNull();
  });
});

describe('the constants are the ones documented', () => {
  it('matches MIN_TO_JUDGE in funnelGap, and twice-the-rest', () => {
    // Named here so a change to either is a deliberate edit to a test, not a
    // silent shift in what every detector is willing to claim.
    expect(MIN_PER_SEGMENT).toBe(5);
    expect(MIN_RATIO).toBe(2);
  });

  it('refuses a ratio exactly under the bar and accepts one on it', () => {
    // 10 of 20 = 50% against 5 of 20 = 25%. Exactly 2.0.
    const onTheBar = outlierSegment([...rows('thu', 20, 10), ...rows('tue', 20, 5)], byDay);
    expect(onTheBar.kind).toBe('outlier');

    // 9 of 20 = 45% against 5 of 20 = 25%. 1.8.
    const under = outlierSegment([...rows('thu', 20, 9), ...rows('tue', 20, 5)], byDay);
    expect(under.kind).toBe('flat');
  });
});
