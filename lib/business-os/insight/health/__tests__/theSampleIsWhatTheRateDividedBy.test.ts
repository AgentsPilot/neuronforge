/**
 * The number beside a rate is the number the rate was taken OF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, ON A LIVE CARD
 *
 * The weekly review showed "12.5% of your hours booked — from 16". The rate was
 * right: 16 booked hours out of 128 the owner offers. The 16 was not the
 * denominator. It is `sample`, which for this one measure counts BOOKINGS,
 * because the `MIN_SAMPLE` gate has to ask "are there enough appointments for
 * this to be a rate at all" and eight bookings is the honest form of that
 * question.
 *
 * So the card put a percentage next to a number it was not computed from, and a
 * reader doing the arithmetic got 2 hours out of 16 — the wrong figure and the
 * wrong unit. Every other measure is safe here by coincidence of definition:
 * 14 of 26 invoices really is 53.8% of 26.
 *
 * `basis` carries the denominator and the words for its unit, so the card can
 * show what the division actually used. These tests pin that it travels
 * through `scoreCategory` and that its ABSENCE is preserved — every summary
 * already in the database lacks the field and must render exactly as before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { scoreCategory } from '../businessHealth';

describe('the denominator a rate was taken of', () => {
  it('travels through scoring when the measure carries one', () => {
    const scored = scoreCategory('operations', {
      current: 12.5,
      previous: null,
      sample: 16,
      previousSample: 0,
      basis: { value: 128, unitKey: 'health.unit.hours' },
    });

    expect(scored.rate).toBe(12.5);
    // The gate's number is untouched: 16 bookings is still what MIN_SAMPLE asks.
    expect(scored.sample).toBe(16);
    expect(scored.basis).toEqual({ value: 128, unitKey: 'health.unit.hours' });
  });

  it('is absent, not empty, for a measure whose sample IS its denominator', () => {
    /*
     * 14 of 26 invoices. The sample is the denominator, so there is nothing
     * extra to say — and an empty object here would make every stored summary
     * look as though it had one.
     */
    const scored = scoreCategory('cash_flow', {
      current: 53.8,
      previous: 45.5,
      sample: 26,
      previousSample: 11,
    });

    expect(scored.basis).toBeUndefined();
    expect('basis' in scored).toBe(false);
  });

  it('is dropped with the rate when there is too little data to report one', () => {
    // No rate means no figure on the card, so no denominator to explain.
    const scored = scoreCategory('operations', {
      current: 12.5,
      previous: null,
      sample: 4, // below MIN_SAMPLE.operations (8)
      previousSample: 0,
      basis: { value: 128, unitKey: 'health.unit.hours' },
    });

    expect(scored.rate).toBeNull();
    expect(scored.unavailable).toBe('too_little_data');
  });
});
