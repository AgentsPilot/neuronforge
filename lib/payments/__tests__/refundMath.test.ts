/**
 * The arithmetic, exhaustively.
 *
 * Every case here is a way to be wrong about real money by a factor of a
 * hundred, by a penny, or by one refund too many. None of them throw — they all
 * return a plausible number — which is why they need assertions rather than
 * review.
 */

import {
  deriveRefundStatus,
  fromMinorUnits,
  minorUnitsPerMajor,
  remainingRefundableMinor,
  resolveRefundAmount,
  toMinorUnits,
} from '../refundMath';

describe('minor units', () => {
  it('uses 100 for ordinary currencies', () => {
    expect(minorUnitsPerMajor('USD')).toBe(100);
    expect(minorUnitsPerMajor('ils')).toBe(100);
    expect(minorUnitsPerMajor(' EUR ')).toBe(100);
  });

  it('uses 1 for zero-decimal currencies', () => {
    // ¥1000 is 1000 minor units, not 100000. The existing refund route's
    // `Math.round(amount * 100)` would ask Stripe for a hundred times the money.
    expect(minorUnitsPerMajor('JPY')).toBe(1);
    expect(toMinorUnits(1000, 'jpy')).toBe(1000);
    expect(fromMinorUnits(1000, 'jpy')).toBe(1000);
  });

  it('uses 1000 for three-decimal currencies, rounded to a trailing zero', () => {
    // Stripe requires the final digit to be 0 for these.
    expect(minorUnitsPerMajor('KWD')).toBe(1000);
    expect(toMinorUnits(1.234, 'kwd') % 10).toBe(0);
    expect(toMinorUnits(1.235, 'kwd')).toBe(1240);
  });

  it('does not lose a penny to floating point', () => {
    // 19.99 * 100 is 1998.9999999999998. Truncating gives 1998 — a penny short
    // on every refund of that amount, and nothing would ever report it.
    expect(toMinorUnits(19.99, 'usd')).toBe(1999);
    expect(toMinorUnits(0.29, 'usd')).toBe(29);
    expect(toMinorUnits(1.005, 'usd')).toBe(101);
  });

  it('round-trips without drift', () => {
    for (const amount of [0.01, 1, 19.99, 200, 1234.56]) {
      expect(fromMinorUnits(toMinorUnits(amount, 'usd'), 'usd')).toBe(amount);
    }
  });
});

describe('remainingRefundableMinor', () => {
  it('is the whole amount when nothing has been refunded', () => {
    expect(remainingRefundableMinor(200, 0, 'ils')).toBe(20000);
  });

  it('survives repeated thirds without leaving a residue', () => {
    // The reason this works in minor units. In major units,
    // 100 - 33.33 - 33.33 - 33.34 is 1.4e-14 rather than 0, which would leave
    // the transaction eternally refundable and let a fourth refund through.
    const total = 100;
    let refunded = 0;
    for (const part of [33.33, 33.33, 33.34]) refunded += part;

    expect(remainingRefundableMinor(total, refunded, 'usd')).toBe(0);
  });

  it('never goes negative on an over-refunded row', () => {
    // Broken data — but reporting -500 would invite callers to do arithmetic
    // on it.
    expect(remainingRefundableMinor(100, 105, 'usd')).toBe(0);
  });
});

describe('deriveRefundStatus', () => {
  it('matches the database trigger at every boundary', () => {
    expect(deriveRefundStatus(200, 0, 'ils')).toBe('none');
    expect(deriveRefundStatus(200, 0.01, 'ils')).toBe('partial');
    expect(deriveRefundStatus(200, 199.99, 'ils')).toBe('partial');
    expect(deriveRefundStatus(200, 200, 'ils')).toBe('full');
    // Over-refunded is still full, not something new.
    expect(deriveRefundStatus(200, 250, 'ils')).toBe('full');
  });
});

describe('resolveRefundAmount', () => {
  it('defaults to everything REMAINING, not the original amount', () => {
    // The live bug in refund_full: after a partial refund it sends the
    // transaction's original amount, asking Stripe for more than is left, and
    // records a full refund regardless of the outcome.
    const decision = resolveRefundAmount(200, 50, 'ils');
    expect(decision).toEqual({ ok: true, amountMinor: 15000, amountMajor: 150 });
  });

  it('accepts a partial amount within what remains', () => {
    expect(resolveRefundAmount(200, 50, 'ils', 100)).toEqual({
      ok: true,
      amountMinor: 10000,
      amountMajor: 100,
    });
  });

  it('accepts exactly the remainder', () => {
    expect(resolveRefundAmount(200, 50, 'ils', 150).ok).toBe(true);
  });

  it('rejects a penny more than remains', () => {
    const decision = resolveRefundAmount(200, 50, 'ils', 150.01);
    expect(decision).toEqual({ ok: false, error: 'EXCEEDS_REMAINING', remainingMinor: 15000 });
  });

  it('rejects zero and negative amounts', () => {
    expect(resolveRefundAmount(200, 0, 'ils', 0).ok).toBe(false);
    expect(resolveRefundAmount(200, 0, 'ils', -10)).toMatchObject({ error: 'NOT_POSITIVE' });
    // Below the smallest representable unit rounds to zero, which is not a refund.
    expect(resolveRefundAmount(200, 0, 'ils', 0.001)).toMatchObject({ error: 'NOT_POSITIVE' });
  });

  it('rejects any refund once nothing remains', () => {
    expect(resolveRefundAmount(200, 200, 'ils')).toMatchObject({ error: 'NOTHING_REMAINING' });
    expect(resolveRefundAmount(200, 200, 'ils', 1)).toMatchObject({ error: 'NOTHING_REMAINING' });
  });

  it('handles a zero-decimal currency end to end', () => {
    // ¥5000 of ¥20000 already refunded leaves ¥15000 — not ¥1,500,000.
    expect(resolveRefundAmount(20000, 5000, 'jpy')).toEqual({
      ok: true,
      amountMinor: 15000,
      amountMajor: 15000,
    });
  });

  it('cannot be split into more than the whole', () => {
    // Three partials that each pass individually must not sum past the total.
    let refunded = 0;
    const total = 200;

    for (const attempt of [80, 80, 80]) {
      const decision = resolveRefundAmount(total, refunded, 'ils', attempt);
      if (decision.ok) refunded += decision.amountMajor;
    }

    expect(refunded).toBeLessThanOrEqual(total);
    expect(refunded).toBe(160); // the third is refused
  });
});
