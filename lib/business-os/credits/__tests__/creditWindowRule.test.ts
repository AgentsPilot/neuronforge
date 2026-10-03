/**
 * The pure credit window rule (credit deduction slice 8a, SA SQ-41).
 */

import { creditWindowRule, parseLedgerFigure } from '../creditWindowRule';

const ANCHOR = '2026-09-14T10:00:00.123456+00:00';
const MONTH = { amount: 32250, per: 'month' as const };
const TRIAL = { amount: 2000, per: 'total' as const };

describe('creditWindowRule', () => {
  it('no plan row: no allowance, whatever the snapshot says', () => {
    expect(creditWindowRule({ anchor: null, allowance: MONTH })).toEqual({ allowance: null, mode: 'period' });
    expect(creditWindowRule({ anchor: null, allowance: TRIAL })).toEqual({ allowance: null, mode: 'period' });
  });

  it('a one-off allowance with an anchor: summed from the anchor', () => {
    expect(creditWindowRule({ anchor: ANCHOR, allowance: TRIAL })).toEqual({ allowance: TRIAL, mode: 'trial_total' });
  });

  it('a monthly allowance: the one period', () => {
    expect(creditWindowRule({ anchor: ANCHOR, allowance: MONTH })).toEqual({ allowance: MONTH, mode: 'period' });
  });

  it('a plan row with no allowance: the one period, no allowance', () => {
    expect(creditWindowRule({ anchor: ANCHOR, allowance: null })).toEqual({ allowance: null, mode: 'period' });
  });
});

describe('parseLedgerFigure', () => {
  it.each([
    [12.5, 12.5],
    ['12.5', 12.5],
    ['0', 0],
    [0, 0],
    ['', null],
    ['  ', null],
    ['abc', null],
    [null, null],
    [undefined, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
  ])('%p → %p', (value, expected) => {
    expect(parseLedgerFigure(value as number | string | null | undefined)).toBe(expected);
  });
});
