/**
 * The RR-4 colour rules, every case.
 */

import { compareUnit, formatGapPercent, rowCoverage, unitGapText, type UnitComparisonInput } from '../coverageColour';

const unit = (current: string | null, pending: string | null, name = 'output'): UnitComparisonInput => ({
  unit: name,
  current,
  currentBasis: current === null ? 'unpriced' : 'table',
  pending,
});

const used = { usedByBusinessOs: true };
const unused = { usedByBusinessOs: false };

describe('compareUnit', () => {
  it('equal prices: green, no change', () => {
    expect(compareUnit(unit('0.6', '0.60'), used)).toMatchObject({ colour: 'green', status: 'no_change', gapBasisPoints: 0 });
  });

  it('ours above: green, covered, with the % we charge above (BQ-3: no third colour)', () => {
    expect(compareUnit(unit('1.35', '1'), used)).toMatchObject({
      colour: 'green',
      status: 'covered',
      gapBasisPoints: 3500,
      label: 'Covered: we charge +35.00% vs provider',
    });
  });

  it('ours below: red, undercharging, with the gap', () => {
    expect(compareUnit(unit('0.88', '1'), used)).toMatchObject({
      colour: 'red',
      status: 'undercharging',
      gapBasisPoints: -1200,
      label: 'Undercharging: -12.00%',
    });
  });

  it('the colour comes from the exact sign, not the rounded gap', () => {
    // A gap of -0.000001%: rounds to 0 basis points, but it is still below.
    expect(compareUnit(unit('0.99999999', '1'), used)).toMatchObject({
      colour: 'red',
      status: 'undercharging',
      gapBasisPoints: 0,
      label: 'Undercharging: less than -0.01%',
    });
  });

  it('one side missing: grey, not compared', () => {
    expect(compareUnit(unit('0.6', null), used)).toMatchObject({ colour: 'grey', status: 'not_compared' });
    expect(compareUnit(unit(null, '0.6'), unused)).toMatchObject({ colour: 'grey', status: 'not_compared' });
  });

  it('a Business OS model with no current price: red, not priced', () => {
    expect(compareUnit(unit(null, '0.6'), used)).toMatchObject({ colour: 'red', status: 'not_priced' });
    expect(compareUnit(unit(null, null), used)).toMatchObject({ colour: 'red', status: 'not_priced' });
  });

  it('cached input missing on our side is never "not priced"', () => {
    expect(compareUnit(unit(null, '0.075', 'cached_input'), used)).toMatchObject({ colour: 'grey' });
  });

  it('provider price 0 (input-only output): equal is green no change; ours above is green with no %', () => {
    expect(compareUnit(unit('0', '0'), used)).toMatchObject({ colour: 'green', status: 'no_change' });
    expect(compareUnit(unit('0.1', '0'), used)).toMatchObject({ colour: 'green', gapBasisPoints: null, label: 'Covered (provider price is 0)' });
  });
});

describe('rowCoverage: worst unit wins', () => {
  it('red if any unit is red, naming the red units in text', () => {
    const units = [compareUnit(unit('1', '1', 'input'), used), compareUnit(unit('0.88', '1', 'output'), used)];
    expect(rowCoverage(units)).toEqual({ colour: 'red', redUnits: ['output'], summary: 'Undercharging: output -12.00%' });
  });

  it('names a not-priced unit', () => {
    const units = [compareUnit(unit(null, '1', 'input'), used)];
    expect(rowCoverage(units).summary).toBe('Undercharging: input not priced');
  });

  it('green only when every compared unit is green; grey units do not count', () => {
    const units = [
      compareUnit(unit('1', '1', 'input'), used),
      compareUnit(unit('2', '1', 'output'), used),
      compareUnit(unit('0.5', null, 'cached_input'), used),
    ];
    expect(rowCoverage(units)).toEqual({ colour: 'green', redUnits: [], summary: 'Covered' });
    expect(rowCoverage([compareUnit(unit('1', '1'), used)]).summary).toBe('Covered: no change');
  });

  it('grey when nothing compares', () => {
    expect(rowCoverage([compareUnit(unit('1', null), used)])).toEqual({ colour: 'grey', redUnits: [], summary: 'Not compared' });
  });
});

it('formatGapPercent prints two decimals, so 1 to 4 bps never reads 0 (CR-2)', () => {
  expect(formatGapPercent(-1)).toBe('-0.01%');
  expect(formatGapPercent(-4)).toBe('-0.04%');
  expect(formatGapPercent(-1200)).toBe('-12.00%');
  expect(formatGapPercent(-1234)).toBe('-12.34%');
  expect(formatGapPercent(0)).toBe('0.00%');
  expect(formatGapPercent(50)).toBe('+0.50%');
});

it('a red unit 1 to 4 bps under never reads as zero (CR-2)', () => {
  const under = compareUnit(unit('0.9999', '1'), used);
  expect(under).toMatchObject({ colour: 'red', gapBasisPoints: -1, label: 'Undercharging: -0.01%' });
  expect(rowCoverage([under]).summary).toBe('Undercharging: output -0.01%');
  expect(compareUnit(unit('0.9996', '1'), used).label).toBe('Undercharging: -0.04%');
});

// Slice 4 (SA N-2): the short gap text a table cell shows, same rule as the labels.
describe('unitGapText', () => {
  it('no change reads 0.00%', () => {
    expect(unitGapText(compareUnit(unit('0.6', '0.60'), used))).toBe('0.00%');
  });

  it('covered and undercharging carry their sign', () => {
    expect(unitGapText(compareUnit(unit('1.35', '1'), used))).toBe('+35.00%');
    expect(unitGapText(compareUnit(unit('2.5', '2.75'), used))).toBe('-9.09%');
  });

  it('a red unit under 1 basis point never reads 0.00%', () => {
    const tiny = compareUnit(unit('0.99999', '1'), used);
    expect(tiny.colour).toBe('red');
    expect(unitGapText(tiny)).toBe('less than -0.01%');
  });

  it('a unit with no gap returns its label', () => {
    expect(unitGapText(compareUnit(unit('0.6', null), used))).toBe('No new price');
    expect(unitGapText(compareUnit(unit(null, '1'), used))).toBe('Not priced');
    expect(unitGapText(compareUnit(unit(null, '1'), unused))).toBe('Not compared');
  });
});
