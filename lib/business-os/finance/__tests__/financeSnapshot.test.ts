/**
 * Finance slice 8.2: the pure snapshot builder (§11M.5, HS-W-5, HS-W-7, E-86,
 * E-95; AC-280, AC-282 to AC-285; 8.2-R1, 8.2-R3).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

// AC-280: one fixed credit-position pass for both the page and the snapshot, so they read the same.
const mockPass: { value: unknown } = { value: null };
jest.mock('@/lib/business-os/credits/adminCreditPercent', () => ({
  ...jest.requireActual('@/lib/business-os/credits/adminCreditPercent'),
  readAdminCreditPositions: async () => mockPass.value,
}));

import type { FinanceBillingStatusRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
import type { AdminCreditPosition, AdminCreditPositionsPass } from '@/lib/business-os/credits/adminCreditPercent';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import { buildFinanceHealth, payingSetOf, type FinanceHealthDeps } from '../financeHealth';
import { resolveFinanceWindow } from '../financeWindow';
import { classifyAccounts, type ClassifyInput } from '../planGroups';

/** The plan row type through the classifier's own input (RC-15: no test names the plan repository). */
type BusinessOsAccountPlan = ClassifyInput['rows'][number];
import { buildCreditsSection, outstandingBySource, type FinanceLot } from '../creditsSection';
import { FINANCE_METRIC_PARAMS, farOverAllowancePercentOf } from '../financeRules';
import { SNAPSHOT_DIMENSION_SHAPE, SNAPSHOT_METRIC_SHAPE } from '../financeSnapshotShape';
import { buildFinanceSnapshot, SNAPSHOT_METRICS, type FinanceSnapshotInput, type SnapshotRow } from '../financeSnapshot';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const CHAMPION = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'champion') as string;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-09T00:07:00.000Z');
const DAY = '2026-11-08';
const LINE = farOverAllowancePercentOf(FINANCE_METRIC_PARAMS);

function plan(user_id: string, extra: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id,
    tier: null,
    plan_version: 1,
    tier_expires_at: null,
    cohort: CHAMPION,
    cohort_expires_at: null,
    onboarding_started_at: '2026-09-01T00:00:00.000Z',
    profile_created_at: '2026-09-01T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-09-01T00:00:00.000Z',
    origin: 'trigger',
    updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}
const PLANS = [plan(A), plan(B, { tier: TIER, cohort: null }), plan(C, { tier: TIER, cohort: null })];
const BILLING: FinanceBillingStatusRow[] = [{ user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null }];

const position = (allowance: number, used: number): AdminCreditPosition => ({ kind: 'position', allowance, used, trial: false });
function pass(entries: Array<[string, AdminCreditPosition]>, outcome: AdminCreditPositionsPass['outcome'] = 'ok'): AdminCreditPositionsPass {
  return { outcome, byUserId: new Map(entries) };
}
const PASS = pass([
  [A, position(1000, 1600)],
  [B, position(2000, 100.25)],
  [C, position(500, 0.1)],
]);

let lotSeq = 0;
function lot(accountId: string | null, source: FinanceLot['source'], creditsGranted: number, extra: Partial<FinanceLot> = {}): FinanceLot {
  lotSeq += 1;
  return {
    id: `44444444-4444-4444-8444-${String(lotSeq).padStart(12, '0')}`,
    accountId,
    source,
    creditsGranted,
    expiresAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    actorAdminId: null,
    draws: [],
    ...extra,
  };
}
const LOTS = [
  lot(A, 'admin_grant', 100),
  lot(B, 'admin_grant', 50, { draws: [{ kind: 'reversal', credits: 20, createdAt: '2026-10-05T00:00:00.000Z' }] }),
  lot(null, 'admin_grant', 7),
  lot(A, 'boost_purchase', 5000, { draws: [{ kind: 'reversal', credits: 1000, createdAt: '2026-10-06T00:00:00.000Z' }] }),
  lot(C, 'boost_purchase', 300, { expiresAt: '2026-11-01T00:00:00.000Z' }),
  lot(null, 'boost_purchase', 900),
];

function input(extra: Partial<FinanceSnapshotInput> = {}): FinanceSnapshotInput {
  return {
    asOfDate: DAY,
    now: NOW,
    plans: { rows: PLANS, capped: false },
    paying: payingSetOf(BILLING),
    config,
    positions: PASS,
    lots: LOTS,
    farOverAllowancePercent: LINE,
    ...extra,
  };
}
const byMetric = (rows: SnapshotRow[], metric: string, dimension = 'all') =>
  rows.filter((r) => r.metric === metric && r.dimension === dimension).map((r) => r.value);
const families = (rows: SnapshotRow[]) =>
  new Set(rows.map((r) => (r.metric.startsWith('credit_') && r.metric !== 'credit_outstanding_total' ? 'credit' : /gifted|bought|outstanding_total/.test(r.metric) ? 'lots' : 'plan')));

describe('the metric list (SA-Q101, AC-285)', () => {
  it('is the twenty metrics of §11M.5, each in the CHECK shape, none about money', () => {
    expect(SNAPSHOT_METRICS).toHaveLength(20);
    for (const m of SNAPSHOT_METRICS) {
      expect(SNAPSHOT_METRIC_SHAPE.test(m)).toBe(true);
      expect(m).not.toMatch(/revenue|cost|fee|takings|usd|currency|price|amount|money|value/);
    }
  });
});

describe('payingSetOf (8.2-R3)', () => {
  it('null rows give payingIds null (unknown), never an empty set; no rows give an empty set', () => {
    expect(payingSetOf(null).payingIds).toBeNull();
    expect(payingSetOf([]).payingIds).toEqual(new Set());
    expect(payingSetOf(BILLING).payingIds).toEqual(new Set([B]));
  });
});

describe('the full night (AC-280, AC-283, AC-285)', () => {
  const built = buildFinanceSnapshot(input());

  it('writes all three families, every row in the shape and in a known unit', () => {
    expect(built.familiesSkipped).toBe(0);
    expect(built.metricsSkipped).toBe(0);
    expect(families(built.rows)).toEqual(new Set(['plan', 'credit', 'lots']));
    for (const row of built.rows) {
      expect(row.as_of_date).toBe(DAY);
      expect(SNAPSHOT_METRIC_SHAPE.test(row.metric) && SNAPSHOT_DIMENSION_SHAPE.test(row.dimension)).toBe(true);
      expect(['accounts', 'credits']).toContain(row.unit);
      expect(Object.keys(row).sort()).toEqual(['as_of_date', 'dimension', 'metric', 'unit', 'value']);
    }
    // No key appears twice for a day (the table's unique key).
    const keys = built.rows.map((r) => `${r.metric}|${r.dimension}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('AC-280: plan rows equal classifyAccounts; every seeded group is written and the groups add up (AC-283)', () => {
    const figures = classifyAccounts({ rows: PLANS, ...payingSetOf(BILLING), window: { start: NOW, end: NOW }, now: NOW, config }).figures;
    expect(byMetric(built.rows, 'accounts_total')).toEqual([figures.total]);
    for (const g of figures.groups) {
      expect(byMetric(built.rows, 'accounts_in_group', g.key)).toEqual([g.count]);
      expect(byMetric(built.rows, 'accounts_in_grace', g.key)).toEqual([g.grace]);
      expect(byMetric(built.rows, 'accounts_past_due', g.key)).toEqual([g.pastDue]);
    }
    const inGroups = built.rows.filter((r) => r.metric === 'accounts_in_group').reduce((s, r) => s + r.value, 0);
    expect(inGroups).toBe(figures.total);
    expect(built.rows.filter((r) => r.metric === 'accounts_in_group')).toHaveLength(figures.groups.length);
    for (const [state, n] of Object.entries(figures.byState)) expect(byMetric(built.rows, 'accounts_in_state', state)).toEqual([n]);
    expect(byMetric(built.rows, 'founding_no_end_date')).toEqual([figures.foundingNoEndDate]);
    expect(byMetric(built.rows, 'founding_dormant')).toEqual([figures.dormantFounding]);
    expect(byMetric(built.rows, 'accounts_ending_soon')).toEqual([figures.endingIn30Days]);
  });

  it('AC-280: credit and lot rows equal buildCreditsSection; the sums are exact micro-credits (SA-W-8.2-2)', () => {
    const section = buildCreditsSection({
      accountIds: PLANS.map((p) => p.user_id),
      groupOf: () => undefined,
      tierLabelOf: () => null,
      positions: PASS.byUserId,
      lots: LOTS,
      window: { start: NOW, end: NOW },
      now: NOW,
      farOverAllowancePercent: LINE,
      displayCap: 0,
    });
    const f = section.figures!;
    expect(byMetric(built.rows, 'credit_accounts')).toEqual([f.accounts]);
    expect(byMetric(built.rows, 'credit_over_allowance')).toEqual([f.overAllowance]);
    expect(byMetric(built.rows, 'credit_far_over_allowance')).toEqual([f.farOverAllowance]);
    expect(byMetric(built.rows, 'credit_unknown_accounts')).toEqual([0]);
    expect(byMetric(built.rows, 'credit_no_allowance_accounts')).toEqual([0]);
    expect(byMetric(built.rows, 'credit_allowance')).toEqual([3500]);
    expect(byMetric(built.rows, 'credit_used')).toEqual([1700.35]);
    // max(1000 - 1600, 0) + (2000 - 100.25) + (500 - 0.1) = 2399.65
    expect(byMetric(built.rows, 'credit_included_left')).toEqual([2399.65]);
    expect(byMetric(built.rows, 'gifted_outstanding')).toEqual([section.gifted!.outstanding]);
    expect(byMetric(built.rows, 'gifted_outstanding')).toEqual([130]);
    expect(byMetric(built.rows, 'gifted_outstanding_deleted')).toEqual([7]);
  });

  it('E-95: bought outstanding is K-4’s loop over boost lots: existing accounts only, drawn and expired lots respected', () => {
    // A: 5000 - 1000 = 4000; C: expired before NOW = 0; the deleted account's 900 is not counted.
    expect(byMetric(built.rows, 'bought_outstanding')).toEqual([4000]);
    expect(outstandingBySource(LOTS, 'boost_purchase', NOW).deletedMicro).toBe(900 * 1e6);
    expect(byMetric(built.rows, 'credit_outstanding_total')).toEqual([2399.65 + 130 + 4000]);
  });
});

describe('AC-280 against the page itself: buildFinanceHealth, all businesses, the same now', () => {
  it('Section 1, Section 4, K-2, K-3 and K-4 equal the snapshot', async () => {
    mockPass.value = PASS;
    const ok = <T>(data: T) => Promise.resolve({ data, error: null });
    const empty = () => ok({ rows: [], reachedCeiling: false });
    const deps = {
      plans: { pagePlans: () => ok(PLANS) },
      findPlanForAccount: () => ok({ plan: null }),
      ledger: { listRowsOfAllAccountsCreatedInRange: empty, listRowsForAccountCreatedInRange: empty, findChargesByActionIds: () => ok([]) },
      finance: {
        listBillingStatusesAllAccounts: () => ok(BILLING),
        findBillingStatusForAccount: () => ok(null),
        countRevenueRows: () => ok({ planInvoicesPaid: 0, boostsPaid: 0 }),
        listClientPaymentsAllAccountsPaidInRange: empty,
        listClientPaymentsForAccountPaidInRange: empty,
        listClientRefundsAllAccountsCreatedInRange: empty,
        listClientRefundsForAccountCreatedInRange: empty,
        listOverdueClientInvoicesAllAccounts: empty,
        listOverdueClientInvoicesForAccount: empty,
        listOverdueClientInstalmentsAllAccounts: empty,
        listOverdueClientInstalmentsForAccount: empty,
        listClientPlansAllAccounts: empty,
        listClientPlansForAccount: empty,
        listBoostPurchasesAllAccountsPaidInRange: empty,
        listBoostPurchasesForAccountPaidInRange: empty,
        listPlanPaymentsAllAccountsPaidInRange: empty,
        listPlanPaymentsForAccountPaidInRange: empty,
      },
      findNames: () => ok([]),
      readReminderFigures: () => Promise.resolve({ data: null, error: new Error('not needed') }),
      readRecordedAllAccounts: () => ok({ rows: [], completed: true }),
      readRecordedForAccount: () => ok({ rows: [], reachedCeiling: false }),
      config,
      isPlatformAccount: () => false,
      credits: {},
      lots: { allAccounts: () => ok(LOTS), forAccount: () => ok([]) },
    } as unknown as FinanceHealthDeps;
    const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    const window = resolveFinanceWindow({ preset: 'this_month' }, NOW);
    const result = await buildFinanceHealth({ window, accountId: null, now: NOW, accountsTab: null }, log, deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const page = result.payload;
    const rows = buildFinanceSnapshot(input()).rows;

    const accounts = page.accounts.figures!;
    expect(byMetric(rows, 'accounts_total')).toEqual([accounts.total]);
    for (const g of accounts.groups) expect(byMetric(rows, 'accounts_in_group', g.key)).toEqual([g.count]);
    expect(byMetric(rows, 'founding_no_end_date')).toEqual([page.tiles.k3.value?.value]);
    const credits = page.credits.figures!;
    expect(byMetric(rows, 'credit_accounts')).toEqual([credits.accounts]);
    expect(byMetric(rows, 'credit_over_allowance')).toEqual([credits.overAllowance]);
    expect(byMetric(rows, 'credit_far_over_allowance')).toEqual([page.tiles.k2.value?.value]);
    expect(byMetric(rows, 'gifted_outstanding')).toEqual([page.tiles.k4.value?.value]);
    expect(byMetric(rows, 'gifted_outstanding_deleted')).toEqual([page.credits.gifted!.deletedAccountsOutstanding]);
  });
});

describe('only exact figures (HS-W-5, AC-282): a family is written whole or not at all', () => {
  const skippedOf = (extra: Partial<FinanceSnapshotInput>) => buildFinanceSnapshot(input(extra));

  it('a failed walk: no plan and no credit rows (the pass never ran); lots still written', () => {
    const r = skippedOf({ plans: null, positions: null });
    expect(r.skipped).toEqual(['plan', 'credit']);
    expect(families(r.rows)).toEqual(new Set(['lots']));
    // The outstanding total needs credit_included_left: not written, counted as skipped.
    expect(byMetric(r.rows, 'credit_outstanding_total')).toEqual([]);
  });

  it('a capped walk: no plan and no credit rows', () => {
    expect(skippedOf({ plans: { rows: PLANS, capped: true } }).skipped).toEqual(['plan', 'credit']);
  });

  it('a failed billing read (paying unknown, 8.2-R3): no plan rows, credit and lots still written', () => {
    const r = skippedOf({ paying: payingSetOf(null) });
    expect(r.skipped).toEqual(['plan']);
    expect(families(r.rows)).toEqual(new Set(['credit', 'lots']));
  });

  it.each(['failed', 'timeout'] as const)('a %s credit pass: no credit rows and no outstanding total', (outcome) => {
    const r = skippedOf({ positions: pass([], outcome) });
    expect(r.skipped).toEqual(['credit']);
    expect(r.rows.some((row) => row.metric.startsWith('credit_'))).toBe(false);
  });

  it('one unknown account: the counts are written, the three sums and the total are not', () => {
    const r = skippedOf({ positions: pass([[A, position(1000, 10)], [B, { kind: 'unknown' }], [C, position(500, 1)]]) });
    expect(byMetric(r.rows, 'credit_unknown_accounts')).toEqual([1]);
    for (const m of ['credit_allowance', 'credit_used', 'credit_included_left', 'credit_outstanding_total']) expect(byMetric(r.rows, m)).toEqual([]);
    expect(r.metricsSkipped).toBe(4);
    expect(r.familiesSkipped).toBe(0);
  });

  it('an invalid far-over line: only credit_far_over_allowance is missing', () => {
    const r = skippedOf({ farOverAllowancePercent: null });
    expect(byMetric(r.rows, 'credit_far_over_allowance')).toEqual([]);
    expect(byMetric(r.rows, 'credit_over_allowance')).toHaveLength(1);
    expect(r.metricsSkipped).toBe(1);
  });

  it('a failed lots read: no lots rows and no total; plan and credit still written', () => {
    const r = skippedOf({ lots: null });
    expect(r.skipped).toEqual(['lots']);
    expect(families(r.rows)).toEqual(new Set(['plan', 'credit']));
  });

  it('never a 0 in place of a missing figure', () => {
    const r = skippedOf({ plans: null, positions: null, lots: null });
    expect(r.rows).toEqual([]);
    expect(r.familiesSkipped).toBe(3);
  });
});

describe('E-86 / 8.2-R1: the shape check runs on the EMITTED rows', () => {
  it('a tier key outside the shape skips the plan family only; credit and lots are still written', () => {
    const odd = { ...config, tierOrder: [...config.tierOrder, 'Pro Plus'] } as typeof config;
    const r = buildFinanceSnapshot(input({ config: odd, plans: { rows: [...PLANS, plan(C, { tier: 'Pro Plus', cohort: null })], capped: false } }));
    // Whether or not the classifier admits the odd tier, no emitted row may break the CHECK.
    for (const row of r.rows) expect(SNAPSHOT_DIMENSION_SHAPE.test(row.dimension)).toBe(true);
    expect(r.skipped).toEqual(['plan']);
    expect(families(r.rows)).toEqual(new Set(['credit', 'lots']));
  });

  it('AC-284: a planted account id as a lifecycle state is caught and skips only plan', () => {
    const real = classifyAccounts;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module object itself, so the builder's own import sees the spy
    const spy = jest.spyOn(require('../planGroups'), 'classifyAccounts').mockImplementation((...args: unknown[]) => {
      const out = (real as (...a: unknown[]) => ReturnType<typeof classifyAccounts>)(...args);
      return { ...out, figures: { ...out.figures, byState: { ...out.figures.byState, [A]: 1 } } };
    });
    try {
      const r = buildFinanceSnapshot(input());
      expect(r.skipped).toEqual(['plan']);
      expect(r.rows.some((row) => row.dimension === A || /[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.dimension))).toBe(false);
      expect(families(r.rows)).toEqual(new Set(['credit', 'lots']));
    } finally {
      spy.mockRestore();
    }
  });
});
