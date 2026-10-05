/**
 * Whether a tally is a pattern.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is where the judgement in the decline and cancellation detectors lives,
 * so it is tested on its own with no fixtures and no database. Every case below
 * is a way the module has fabricated a finding before, in one form or another:
 * too small a sample, a near-tie reported as a winner, and a gap in our own
 * data collection reported back as a fact about the business.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { dominantReason, dominantWithin, MIN_SHARE } from '../dominantReason';

describe('a real pattern', () => {
  it('names the reason most of them gave', () => {
    const found = dominantReason({ client_cost: 4, timing: 1, scope: 1 }, 3);

    expect(found).not.toBeNull();
    expect(found!.reason).toBe('client_cost');
    expect(found!.count).toBe(4);
    expect(found!.total).toBe(6);
    expect(found!.share).toBe(0.67);
  });

  it('reports the denominator it actually divided by', () => {
    /*
     * The copy says "4 of the 6 that gave a reason". Both numbers travel out
     * so the sentence can be true: `recorded` is what the share is of, `total`
     * is how much of the picture it speaks for.
     */
    const found = dominantReason({ client_cost: 4, timing: 2, 'No reason provided': 10 }, 3);

    expect(found!.recorded).toBe(6);
    expect(found!.total).toBe(16);
    expect(found!.share).toBe(0.67);
  });
});

describe('too few to say anything', () => {
  it('stays silent below the sample floor', () => {
    // Two declines sharing a reason is a coincidence, however unanimous.
    expect(dominantReason({ client_cost: 2 }, 3)).toBeNull();
  });

  it('counts blanks toward the floor', () => {
    /*
     * Otherwise a business with 2 recorded reasons and 40 blanks would clear a
     * floor of 3 on the strength of the blanks while the claim rests on two
     * rows. The floor is about how much happened, not how much we captured.
     */
    expect(dominantReason({ client_cost: 2, 'No reason provided': 40 }, 3)).not.toBeNull();
    expect(dominantReason({ client_cost: 2 }, 3)).toBeNull();
  });

  it('says nothing at all about an empty set', () => {
    expect(dominantReason({}, 3)).toBeNull();
    expect(dominantReason({ client_cost: 0 }, 1)).toBeNull();
  });
});

describe('a flat spread is not a pattern', () => {
  it('refuses to crown the largest of five near-equal buckets', () => {
    /*
     * 2/7 is 29%. There IS a largest bucket and naming it would be arithmetic
     * presented as a finding — an owner told "timing is why you lose work"
     * would go and change their calendar over a near-tie.
     */
    const flat = { timing: 2, client_cost: 1, scope: 1, chose_other: 1, other: 2 };

    expect(dominantReason(flat, 3)).toBeNull();
  });

  it('reports once one reason clears the share floor', () => {
    const found = dominantReason({ timing: 4, client_cost: 2, scope: 2, other: 2 }, 3);

    expect(found!.reason).toBe('timing');
    expect(found!.share).toBeGreaterThanOrEqual(MIN_SHARE);
  });
});

describe('an unrecorded reason can never win', () => {
  it('ignores the fallback label however large it is', () => {
    /*
     * The failure this exists to prevent: telling an owner their main problem
     * is "No reason provided". That is a fact about our data collection, not
     * about their business.
     */
    const found = dominantReason({ 'No reason provided': 30, client_cost: 3, timing: 1 }, 3);

    expect(found!.reason).toBe('client_cost');
    expect(found!.total).toBe(34);
    expect(found!.recorded).toBe(4);
  });

  it('ignores free prose the client typed', () => {
    // `cancelReasonBucket` falls back to whatever they wrote. A sentence is
    // not groupable and two people never phrase it the same way.
    const found = dominantReason(
      { 'the kids were ill': 5, 'work came up': 4, client_unwell: 3 },
      3
    );

    expect(found!.reason).toBe('client_unwell');
  });

  it('returns null when nothing recorded a code at all', () => {
    expect(dominantReason({ 'No reason provided': 40, 'something came up': 3 }, 3)).toBeNull();
  });
});

describe('how sure it sounds', () => {
  it('stays low on a small sample however unanimous', () => {
    // All three agreeing is still three. The sample caps what the share earns.
    expect(dominantReason({ client_cost: 3 }, 3)!.confidence).toBe('low');
  });

  it('reaches medium once there are a few', () => {
    expect(dominantReason({ client_cost: 4, timing: 2 }, 3)!.confidence).toBe('medium');
  });

  it('reaches high only on a clear majority of a real sample', () => {
    expect(dominantReason({ client_cost: 8, timing: 4 }, 3)!.confidence).toBe('high');
    // Same sample, no majority: medium, not high.
    expect(dominantReason({ client_cost: 5, timing: 4, scope: 3 }, 3)!.confidence).toBe('medium');
  });
});

/* ------------------------------------------------------------- cross-tab */

interface Row {
  service: string | null;
  reason: string | null;
}

describe('a reason concentrated in one slice', () => {
  const rows: Row[] = [
    { service: 'package', reason: 'too_expensive' },
    { service: 'package', reason: 'too_expensive' },
    { service: 'package', reason: 'too_expensive' },
    { service: 'session', reason: 'timing' },
    { service: 'session', reason: 'scope' },
    { service: 'session', reason: 'chose_other' },
  ];

  it('finds the service the objection belongs to', () => {
    /*
     * The finding worth having. "Price is your top objection" names nothing to
     * change; "price objections are only on the package" names the thing.
     */
    const found = dominantWithin(rows, r => r.service, r => r.reason, 3);

    expect(found!.slice).toBe('package');
    expect(found!.pattern.reason).toBe('too_expensive');
    expect(found!.pattern.share).toBe(1);
  });

  it('skips rows whose slice is unknown', () => {
    // A row with no service cannot be evidence about a service.
    const withOrphans: Row[] = [...rows, { service: null, reason: 'too_expensive' }];
    const found = dominantWithin(withOrphans, r => r.service, r => r.reason, 3);

    expect(found!.pattern.total).toBe(3);
  });

  it('prefers the most concentrated slice, not the biggest', () => {
    const mixed: Row[] = [
      ...Array(8).fill({ service: 'session', reason: 'timing' }),
      ...Array(4).fill({ service: 'session', reason: 'scope' }),
      { service: 'package', reason: 'too_expensive' },
      { service: 'package', reason: 'too_expensive' },
      { service: 'package', reason: 'too_expensive' },
    ];

    const found = dominantWithin(mixed, r => r.service, r => r.reason, 3);

    // `session` has 12 rows to `package`'s 3, but package is unanimous.
    expect(found!.slice).toBe('package');
  });

  it('says nothing when no single slice holds enough', () => {
    const thin: Row[] = [
      { service: 'a', reason: 'too_expensive' },
      { service: 'b', reason: 'too_expensive' },
      { service: 'c', reason: 'too_expensive' },
    ];

    expect(dominantWithin(thin, r => r.service, r => r.reason, 3)).toBeNull();
  });
});
