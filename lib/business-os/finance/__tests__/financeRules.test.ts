/**
 * The finance KPI rules (slice 1a, §7.1): AC-18, AC-20, SA-W5, C-18 for
 * finance, and that the finance vocabulary is enforced through Health's
 * widened validator (SA-Q1, SA-W4).
 */

import {
  colourFinanceTile,
  FINANCE_LOWER_BOUND_HEADLINE,
  FINANCE_RULES,
  FINANCE_RULES_INVALID_HEADLINE,
  NOT_ENOUGH_HISTORY_HEADLINE,
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
