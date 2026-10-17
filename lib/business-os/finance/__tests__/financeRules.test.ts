/**
 * The finance KPI rules (slice 1a, §7.1): AC-18, AC-20, SA-W5, C-18 for
 * finance, and that the finance vocabulary is enforced through Health's
 * widened validator (SA-Q1, SA-W4). Slice 1b: K-2 (AC-19, SA-W10, SA-WR-8)
 * and K-4 (AC-8).
 */

import {
  accountsNotReadHeadline,
  colourFarOverAllowanceTile,
  colourFinanceTile,
  estimateChargeFeeMinor,
  farOverAllowancePercentOf,
  FEE_ESTIMATE_CURRENCY,
  feeEstimateNoteOf,
  FINANCE_GREEN_ELIGIBLE,
  FINANCE_LOWER_BOUND_HEADLINE,
  FINANCE_METRIC_PARAMS,
  FINANCE_RULES,
  FINANCE_RULES_INVALID_HEADLINE,
  K4_INFORMATION_HEADLINE,
  NOT_ENOUGH_HISTORY_HEADLINE,
  STRIPE_FEE_ESTIMATE,
  STRIPE_FEE_ESTIMATE_RANGE,
  stripeFeeEntryOf,
  type FinanceMeasurement,
  type FinanceRule,
} from '../financeRules';
import { GREEN_HEADLINE } from '@/lib/admin/health/evaluateHealth';

const exact = (value: number) => ({ value, exact: true });
const atLeast = (value: number) => ({ value, exact: false });
const k1 = (current: { value: number; exact: boolean }, previous: { value: number; exact: boolean }): FinanceMeasurement => ({
  metrics: { aiCostMonth: current, aiCostPrevSpan: previous },
});
const colourK1 = (m: FinanceMeasurement | null, rules: unknown = FINANCE_RULES.k1_ai_cost) =>
  colourFinanceTile('k1_ai_cost', rules, m);

describe('K-1 AI cost this month (AC-18)', () => {
  it.each([
    ['$15 vs $10 → amber (up 50%)', 15, 10, 'amber'],
    ['$20 vs $10 → red (doubled)', 20, 10, 'red'],
    ['$14.99 vs $10 → green', 14.99, 10, 'green'],
    ['$0.99 vs $0.10 → below the $1 floor → green', 0.99, 0.1, 'green'],
    ['SA-W5: $1.50 vs an exact $0 → red ("new spend")', 1.5, 0, 'red'],
    ['$0 vs $0 → green', 0, 0, 'green'],
  ])('%s', (_name, current, previous, status) => {
    expect(colourK1(k1(exact(current), exact(previous))).status).toBe(status);
  });

  it('red says why, in words', () => {
    expect(colourK1(k1(exact(20), exact(10))).headline).toBe('AI cost at least doubled vs the same days last month');
  });

  it('the cut-over → not measured, "Not enough history"', () => {
    expect(colourK1({ metrics: { aiCostMonth: exact(50) }, notEnoughHistory: true })).toEqual({
      status: 'not_measured',
      headline: NOT_ENOUGH_HISTORY_HEADLINE,
      ruleId: null,
    });
  });

  it('an inexact current or previous figure → amber minimum, never green, and no ratio rule fires', () => {
    for (const m of [k1(atLeast(14), exact(10)), k1(exact(14), atLeast(10)), k1(atLeast(100), exact(10))]) {
      expect(colourK1(m)).toEqual({ status: 'amber', headline: FINANCE_LOWER_BOUND_HEADLINE, ruleId: null });
    }
  });

  it('a failed read → unavailable', () => {
    expect(colourK1(null).status).toBe('unavailable');
  });

  it('AC-20: a threshold change in DATA changes the colour, with no code change', () => {
    const measurement = k1(exact(12), exact(10));
    expect(colourK1(measurement).status).toBe('green');
    const edited: FinanceRule[] = FINANCE_RULES.k1_ai_cost.map((r) =>
      r.id === 'aiCost.up50' && r.condition.kind === 'ratioAtLeast' ? { ...r, condition: { ...r.condition, factor: 1.2 } } : r
    );
    expect(colourK1(measurement, edited).status).toBe('amber');
  });
});

describe('K-3 Founding Partners with no end date', () => {
  const k3 = (m: FinanceMeasurement | null) => colourFinanceTile('k3_founding_no_end_date', FINANCE_RULES.k3_founding_no_end_date, m);

  it('0 exact → green; 2 → amber; 0 inexact → amber minimum; null → unavailable', () => {
    expect(k3({ metrics: { foundingNoEndDate: exact(0) } })).toEqual({ status: 'green', headline: GREEN_HEADLINE, ruleId: null });
    expect(k3({ metrics: { foundingNoEndDate: exact(2) } })).toEqual({
      status: 'amber',
      headline: 'Founding Partners with no end date',
      ruleId: 'founding.noEndDate',
    });
    expect(k3({ metrics: { foundingNoEndDate: atLeast(0) } }).headline).toBe(FINANCE_LOWER_BOUND_HEADLINE);
    expect(k3(null).status).toBe('unavailable');
  });
});

describe('K-5 Our revenue (never green in slice 1)', () => {
  const k5 = (m: FinanceMeasurement | null) =>
    colourFinanceTile('k5_our_revenue', FINANCE_RULES.k5_our_revenue, m, { unavailableHeadline: 'Could not check' });

  it('three branches: none yet, recorded, could not check', () => {
    expect(k5({ metrics: {}, information: 'None yet' })).toEqual({ status: 'neutral', headline: 'None yet', ruleId: null });
    expect(k5({ metrics: {}, information: 'Revenue recorded, not yet shown' }).status).toBe('neutral');
    expect(k5(null)).toEqual({ status: 'unavailable', headline: 'Could not check', ruleId: null });
  });
});

describe('validation (the finance vocabulary, through Health’s widened validator)', () => {
  it('FINANCE_RULES passes validation on every tile', () => {
    const errors: unknown[] = [];
    for (const id of ['k1_ai_cost', 'k3_founding_no_end_date', 'k5_our_revenue'] as const) {
      colourFinanceTile(id, FINANCE_RULES[id], { metrics: {} }, { onRuleError: (p) => errors.push(p) });
    }
    expect(errors).toEqual([]);
  });

  it('a rule naming a Health metric on a finance tile → unavailable, and reported', () => {
    const errors: unknown[] = [];
    const bad = [
      {
        id: 'x',
        priority: 1,
        colour: 'red',
        description: 'Spend',
        condition: { kind: 'atLeast', metric: 'spend24h', value: 1 },
      },
    ];
    const result = colourFinanceTile('k1_ai_cost', bad, k1(exact(1), exact(1)), { onRuleError: (p) => errors.push(p) });
    expect(result).toEqual({ status: 'unavailable', headline: FINANCE_RULES_INVALID_HEADLINE, ruleId: null });
    expect(errors).toEqual([{ tile: 'k1_ai_cost', ruleId: 'x', reason: 'metric not measured for this tile' }]);
  });

  it('a K-3 metric on K-1 is refused too (each tile has its own vocabulary)', () => {
    const bad = [{ ...FINANCE_RULES.k3_founding_no_end_date[0] }];
    expect(colourK1(k1(exact(1), exact(1)), bad).status).toBe('unavailable');
  });
});

describe('K-2 accounts far over their allowance (slice 1b: AC-19, SA-W10, SA-WR-8)', () => {
  const k2 = (measured: { farOverAllowance: number; unknownAccounts: number } | null, params: unknown = FINANCE_METRIC_PARAMS, rules: unknown = FINANCE_RULES.k2_far_over_allowance) =>
    colourFarOverAllowanceTile(rules, measured, params);

  it('AC-19 through the tile: 1 → amber with the rule; 0 with every account read → green', () => {
    expect(k2({ farOverAllowance: 1, unknownAccounts: 0 })).toEqual({
      status: 'amber',
      headline: 'Accounts at or over the far-over-allowance line',
      ruleId: 'credits.farOver',
    });
    expect(k2({ farOverAllowance: 0, unknownAccounts: 0 })).toEqual({ status: 'green', headline: GREEN_HEADLINE, ruleId: null });
  });

  it('SA-WR-8: one account unknown and none far over → amber with the K-2 headline, never green, never the ledger line', () => {
    const colour = k2({ farOverAllowance: 0, unknownAccounts: 1 });
    expect(colour).toEqual({ status: 'amber', headline: '1 account could not be read', ruleId: null });
    expect(colour.headline).not.toBe(FINANCE_LOWER_BOUND_HEADLINE);
    expect(k2({ farOverAllowance: 0, unknownAccounts: 3 }).headline).toBe('3 accounts could not be read');
    expect(accountsNotReadHeadline(2)).toBe('2 accounts could not be read');
  });

  it('SA-WR-8: one account unknown and one far over → amber from the rule (a lower bound of 1 proves it)', () => {
    expect(k2({ farOverAllowance: 1, unknownAccounts: 1 })).toEqual({
      status: 'amber',
      headline: 'Accounts at or over the far-over-allowance line',
      ruleId: 'credits.farOver',
    });
  });

  it('no figures (section unknown) → unavailable "Unknown"', () => {
    expect(k2(null)).toEqual({ status: 'unavailable', headline: 'Unknown', ruleId: null });
  });

  it.each([99, 1001, 1.5, '150', null])('SA-W10: an invalid line (%p) → unavailable with the rules-invalid headline, reported', (value) => {
    const errors: unknown[] = [];
    const colour = colourFarOverAllowanceTile(
      FINANCE_RULES.k2_far_over_allowance,
      { farOverAllowance: 0, unknownAccounts: 0 },
      { farOverAllowancePercent: value },
      { onRuleError: (p) => errors.push(p) }
    );
    expect(colour).toEqual({ status: 'unavailable', headline: FINANCE_RULES_INVALID_HEADLINE, ruleId: null });
    expect(errors).toEqual([{ tile: 'k2_far_over_allowance', ruleId: null, reason: 'farOverAllowancePercent must be an integer from 100 to 1000' }]);
  });

  it('SA-W10: the line is data — 150 today, valid at the bounds', () => {
    expect(FINANCE_METRIC_PARAMS.farOverAllowancePercent).toBe(150);
    expect(farOverAllowancePercentOf(FINANCE_METRIC_PARAMS)).toBe(150);
    expect(farOverAllowancePercentOf({ farOverAllowancePercent: 100 })).toBe(100);
    expect(farOverAllowancePercentOf({ farOverAllowancePercent: 1000 })).toBe(1000);
    expect(farOverAllowancePercentOf(undefined)).toBeNull();
  });

  it('AC-20 style: the count rule’s value changed to 2 in DATA makes one account green', () => {
    const edited: FinanceRule[] = FINANCE_RULES.k2_far_over_allowance.map((r) =>
      r.condition.kind === 'atLeast' ? { ...r, condition: { ...r.condition, value: 2 } } : r
    );
    expect(k2({ farOverAllowance: 1, unknownAccounts: 0 }).status).toBe('amber');
    expect(k2({ farOverAllowance: 1, unknownAccounts: 0 }, FINANCE_METRIC_PARAMS, edited).status).toBe('green');
  });
});

describe('K-4 gifted credits outstanding (slice 1b: AC-8, information only)', () => {
  const k4 = (m: FinanceMeasurement | null) => colourFinanceTile('k4_gifted_outstanding', FINANCE_RULES.k4_gifted_outstanding, m);

  it('a read value, 0 included → neutral (grey) with its information line; never green', () => {
    expect(k4({ metrics: {}, information: K4_INFORMATION_HEADLINE })).toEqual({ status: 'neutral', headline: K4_INFORMATION_HEADLINE, ruleId: null });
  });

  it('a failed lots read → unavailable', () => {
    expect(k4(null)).toEqual({ status: 'unavailable', headline: 'Unknown', ruleId: null });
  });
});

describe('slice 1b vocabulary and validation', () => {
  it('FINANCE_RULES passes validation on K-2 and K-4', () => {
    const errors: unknown[] = [];
    for (const id of ['k2_far_over_allowance', 'k4_gifted_outstanding'] as const) {
      colourFinanceTile(id, FINANCE_RULES[id], { metrics: {} }, { onRuleError: (p) => errors.push(p) });
    }
    expect(errors).toEqual([]);
  });

  it('K-2 refuses another tile’s metric (aiCostMonth), and K-1 refuses K-2’s', () => {
    const errors: unknown[] = [];
    const bad = [{ ...FINANCE_RULES.k1_ai_cost[0] }];
    expect(
      colourFinanceTile('k2_far_over_allowance', bad, { metrics: { accountsFarOverAllowance: exact(1) } }, { onRuleError: (p) => errors.push(p) }).status
    ).toBe('unavailable');
    expect(errors).toEqual([{ tile: 'k2_far_over_allowance', ruleId: 'aiCost.doubled', reason: 'metric not measured for this tile' }]);
    expect(colourK1(k1(exact(1), exact(1)), [{ ...FINANCE_RULES.k2_far_over_allowance[0] }]).status).toBe('unavailable');
  });

  it('K-4 may never be green; K-2 may (code, not data)', () => {
    expect(FINANCE_GREEN_ELIGIBLE.has('k4_gifted_outstanding')).toBe(false);
    expect(FINANCE_GREEN_ELIGIBLE.has('k2_far_over_allowance')).toBe(true);
  });
});

// ── Slice 6b (§11K.3, AC-243, AC-244, BQ-15, SA-Q81): the Stripe fee estimate ──
describe('slice 6b: the Stripe fee estimate (data, its range check and the per-charge formula)', () => {
  const DEFAULT = STRIPE_FEE_ESTIMATE[FEE_ESTIMATE_CURRENCY];

  it('BQ-15: the default is 290 bps + 30 minor units, USD only', () => {
    expect(STRIPE_FEE_ESTIMATE).toEqual({ USD: { percentBps: 290, fixedMinor: 30 } });
    expect(FEE_ESTIMATE_CURRENCY).toBe('USD');
    expect(STRIPE_FEE_ESTIMATE_RANGE).toEqual({ percentBps: { min: 0, max: 1000 }, fixedMinor: { min: 0, max: 1000 } });
  });

  it.each([
    [7900, 259],
    [4414, 158],
    [1000, 59],
    [500, 45], // 145,000 + 5,000 = 150,000 → 15 (an exact half rounds up), + 30
    [499, 44], // 144,710 + 5,000 = 149,710 → 14 (below half rounds down), + 30
    [0, 30],
  ])('AC-243: gross %d → fee %d at the default', (gross, fee) => {
    expect(estimateChargeFeeMinor(gross, DEFAULT)).toBe(fee);
  });

  it('AC-243: the test account in October, plan 7900 + boost 1000, is 259 + 59 = 318 minor units', () => {
    expect((estimateChargeFeeMinor(7900, DEFAULT) as number) + (estimateChargeFeeMinor(1000, DEFAULT) as number)).toBe(318);
  });

  it('AC-243: not a safe integer, negative, or overflowing → null, never a guess', () => {
    expect(estimateChargeFeeMinor(-1, DEFAULT)).toBeNull();
    expect(estimateChargeFeeMinor(1.5, DEFAULT)).toBeNull();
    expect(estimateChargeFeeMinor(Number.MAX_SAFE_INTEGER, DEFAULT)).toBeNull();
  });

  it('the division is exact near the safe limit (no float round-up)', () => {
    // 9,007,199,254,730 × 1000 + 5000 is safe; floor((…)/10000) must equal the integer quotient.
    const gross = 9_007_199_254_730;
    const scaled = gross * 1000 + 5000;
    expect(estimateChargeFeeMinor(gross, { percentBps: 1000, fixedMinor: 0 })).toBe((scaled - (scaled % 10_000)) / 10_000);
  });

  it('AC-244: another config changes the fee with no code change (350 bps + 25)', () => {
    const entry = stripeFeeEntryOf({ USD: { percentBps: 350, fixedMinor: 25 } }, 'USD');
    expect(entry).toEqual({ percentBps: 350, fixedMinor: 25 });
    expect(estimateChargeFeeMinor(7900, entry as NonNullable<typeof entry>)).toBe(302);
    expect(estimateChargeFeeMinor(1000, entry as NonNullable<typeof entry>)).toBe(60);
  });

  it.each([
    ['percentBps 1001', { USD: { percentBps: 1001, fixedMinor: 30 } }],
    ['fixedMinor 1001', { USD: { percentBps: 290, fixedMinor: 1001 } }],
    ['a fraction', { USD: { percentBps: 2.9, fixedMinor: 30 } }],
    ['a negative', { USD: { percentBps: -1, fixedMinor: 30 } }],
    ['a string', { USD: { percentBps: '290', fixedMinor: 30 } }],
    ['NaN', { USD: { percentBps: Number.NaN, fixedMinor: 30 } }],
    ['no USD entry', { EUR: { percentBps: 290, fixedMinor: 30 } }],
    ['a missing field', { USD: { percentBps: 290 } }],
    ['null', null],
    ['a number', 290],
  ])('AC-244: %s → no entry (every fee Unknown)', (_name, config) => {
    expect(stripeFeeEntryOf(config, 'USD')).toBeNull();
    expect(feeEstimateNoteOf(config, 'USD')).toBeNull();
  });

  it('the range ends are valid (0 and 1000)', () => {
    expect(stripeFeeEntryOf({ USD: { percentBps: 0, fixedMinor: 1000 } }, 'USD')).toEqual({ percentBps: 0, fixedMinor: 1000 });
  });

  it('FE-16: the note values are divided on the server: 2.9 and 0.3 at the default; 3.5 and 0.25 at 350 / 25', () => {
    expect(feeEstimateNoteOf(STRIPE_FEE_ESTIMATE, 'USD')).toEqual({ currency: 'USD', percent: 2.9, fixed: 0.3 });
    expect(feeEstimateNoteOf({ USD: { percentBps: 350, fixedMinor: 25 } }, 'USD')).toEqual({ currency: 'USD', percent: 3.5, fixed: 0.25 });
  });
});
