/**
 * computeCreditBalance — max(0, allowance + granted − used), the one place the
 * balance is computed (credit deduction slice 6a, SA SQ-27).
 */

import { computeCreditBalance, roundToLedger } from '../creditBalance';

describe('computeCreditBalance', () => {
  it('is null without an allowance', () => {
    expect(computeCreditBalance({ allowance: null, granted: 0, used: 12 })).toBeNull();
  });

  it('subtracts use from the allowance, unrounded (no display rounding)', () => {
    expect(computeCreditBalance({ allowance: 32250, granted: 0, used: 62.5 })).toBe(32187.5);
    expect(computeCreditBalance({ allowance: 2000, granted: 0, used: 0.4 })).toBe(1999.6);
  });

  it('adds granted credits', () => {
    expect(computeCreditBalance({ allowance: 100, granted: 50, used: 120 })).toBe(30);
  });

  it('clamps at zero: consumption can exceed the allowance', () => {
    expect(computeCreditBalance({ allowance: 32250, granted: 0, used: 32260 })).toBe(0);
  });

  it('keeps the ledger precision and drops floating-point noise', () => {
    expect(computeCreditBalance({ allowance: 1, granted: 0, used: 0.1 + 0.2 })).toBe(0.7);
    expect(roundToLedger(0.1234567)).toBe(0.123457);
  });

  it('refuses to answer (null) rather than show a full allowance for an unreadable figure', () => {
    expect(computeCreditBalance({ allowance: 100, granted: 0, used: Number.NaN })).toBeNull();
    expect(computeCreditBalance({ allowance: Number.POSITIVE_INFINITY, granted: 0, used: 1 })).toBeNull();
  });
});
