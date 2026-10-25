/**
 * The finance builder (slice 1a): section isolation (SA-Q8, AC-27, AC-37,
 * AC-39), the account scope (AC-26, AC-41, AC-42 / SA-WR-3), the override
 * strip (SA-WR-1), the revenue panel's branches (AC-22, AC-23), the cut-over
 * (AC-40) and the ceiling (AC-15).
 *
 * Slice 1c (BD-14, BD-15, BD-16): the renamed billing and revenue reads; the
 * revenue panel from test and real counts alike (AC-75 to AC-77); a paying
 * Founding Partner in its paid tier's group with the note (AC-78, AC-80,
 * AC-86); the picked business (AC-82) and two billing rows making the paying
 * read fail, so "Tier set" and never a guessed group (AC-85, SA-WR-28).
 *
 * Slice 1b: Section 4, K-2 and K-4 through the builder (AC-16, AC-17, AC-19,
 * AC-37, AC-38, SA-W11, SA-W12, SA-WR-8), the picked-business scope of every
 * credit and lot read (AC-42), the lot narrowing in the wiring (SA-W14) and
 * the wiring's credit reads (SA-WR-10). Every test injects a fake
 * `credits.getSnapshots`, so the real entitlement service is never reached;
 * the snapshots it returns are REAL resolutions of the config's own plans.
 *
 * Slice 2a: the takings block through the builder (the window range on the
 * client reads, names only for shown rows read, platform labelled), AC-65
 * (with a business picked, R-e′ / R-f′ get exactly the id and R-e / R-f have
 * zero calls), AC-66 (a failed payments read → that block unknown and every
 * other section renders; a failed refunds read → partial), and the counts
 * carry no amount.
 *
 * Slice 2b: the client payment problems block through the builder (AC-56,
 * AC-57, AC-59 by the window and the clock, AC-65 with a business picked,
 * AC-66 each read failing alone, AC-67 the reminder deadline with fake
 * timers, SA-WR-23), one names call over both tables (SA-W38), and counts
 * with no amount, currency, date or name.
 *
 * Slice 4a: "Our revenue" through the builder. The 1c K-5 headline and panel
 * sentence assertions (AC-75 to AC-77) are superseded by S4-FR-4 / S4-FR-7
 * (SA-W50, E-31) and rewritten; 1c's R-d BEHAVIOUR stays pinned (SA-WR-32):
 * a test-mode plan invoice alone still marks plans recorded. Then the boost
 * block (AC-93, AC-95), K-5's money (SA-W47, SA-WR-34: on K-5 only), the
 * picked business (AC-96: R-k′ gets exactly the id, R-k zero calls, R-d with
 * no argument) and the counts (no amount, currency or package).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockRepoLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: (...a: unknown[]) => mockRepoLog.info(...a),
    warn: (...a: unknown[]) => mockRepoLog.warn(...a),
    error: (...a: unknown[]) => mockRepoLog.error(...a),
    debug: (...a: unknown[]) => mockRepoLog.debug(...a),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});
const mockFindEntitlementInputs = jest.fn();
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: {
    findEntitlementInputs: (...a: unknown[]) => mockFindEntitlementInputs(...a),
    pagePlans: jest.fn(),
  },
}));
// SA-W14: the wiring's two lot reads, faked at the repository boundary.
const mockLotsAllAccounts = jest.fn();
const mockLotsForAccount = jest.fn();
jest.mock('@/lib/repositories/BusinessOsCreditLotRepository', () => ({
  businessOsCreditLotRepository: {
    listLotsWithDrawsAllAccounts: (...a: unknown[]) => mockLotsAllAccounts(...a),
    listLotsWithDraws: (...a: unknown[]) => mockLotsForAccount(...a),
  },
}));

import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type {
  FinanceClientDueRow,
  FinanceClientPaymentRow,
  FinanceClientPlanRow,
  FinanceClientReadResult as ClientRead,
  FinanceClientRefundRow,
} from '@/lib/repositories/BusinessOsFinanceReadRepository';
// Slice 1c: a separate import, so the list above stays unedited.
import type { FinanceBillingStatusRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
// Slice 4a: a separate import too.
import type { FinanceBoostPurchaseRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
// Slice 4b.2: a separate import, so the line above stays unedited.
import type { FinanceBoostAttentionResult, FinanceBoostAttentionRow, FinanceBoostReversalRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
// Slice 5a: a separate import too.
import type { FinancePlanPaymentRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
import { tierLabelForGroup } from '../planGroups';
import type { FinanceReminderFiguresInput } from '../paymentProblems';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { adminCreditPercentDeps } from '@/lib/business-os/credits/adminCreditPercentDeps';
import type { AdminCreditPercentDeps, AdminTotalsRow } from '@/lib/business-os/credits/adminCreditPercent';
import { buildFinanceHealth, FINANCE_LIMITS, type FinanceHealthDeps } from '../financeHealth';
import { ADMIN_READ_DEADLINE_MS } from '@/lib/admin/readUnderDeadline';
import * as fs from 'fs';
import * as path from 'path';
import { financeHealthDeps, findPlanWithoutOverrides, toFinanceLot } from '../financeHealthDeps';
import type { FinanceLot } from '../creditsSection';
import { resolveFinanceWindow } from '../financeWindow';
import { FINANCE_RULES_INVALID_HEADLINE, K4_INFORMATION_HEADLINE } from '../financeRules';
// Slice 4b.2: a separate import, so the line above stays unedited.
import { FINANCE_RULES } from '../financeRules';
// Slice 6a: a separate import, so the lines above stay unedited.
import type { FinanceAccountsTabQuery } from '../financeTypes';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const CHAMPION = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'champion') as string;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
// After the cut-over month: K-1 compares with a real previous span.
const NOW = new Date('2026-11-09T12:00:00.000Z');
const WINDOW = resolveFinanceWindow({ preset: 'this_month' }, NOW);

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

let seq = 0;
function charge(user_id: string | null, cost: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: String(seq),
    kind: 'charge',
    action_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`,
    adjusts_action_id: null,
    reason_code: null,
    user_id,
    period_start: '2026-11-01T00:00:00+00:00',
    group_id: null,
    credits: '1',
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: '2026-11-05T10:00:00+00:00',
    ...extra,
  };
}

type Result<T> = Promise<{ data: T | null; error: Error | null }>;
const ok = <T>(data: T): Result<T> => Promise.resolve({ data, error: null });
const fail = (): Result<never> => Promise.resolve({ data: null, error: new Error('read failed') });

/** A REAL snapshot of one of the config's plans (no figure typed here). */
function snapshotOf(planId: string) {
  const resolution = resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW });
  return { resolution, unavailable: false, stale: false };
}
/** The monthly allowance the config gives a plan, read from the same resolution. */
function allowanceOf(planId: string): number {
  const value = snapshotOf(planId).resolution.values['credits.allowance']?.value as { perMonth?: number } | undefined;
  if (typeof value?.perMonth !== 'number') throw new Error(`no monthly allowance for ${planId}`);
  return value.perMonth;
}
const ALLOWANCE_A = allowanceOf(CHAMPION);
const ALLOWANCE_B = allowanceOf(TIER);
/** The current credit period of a 1 September anchor, on NOW. */
const PERIOD = '2026-11-01T00:00:00+00:00';

/** The pass's reads, faked: A at 200% of its allowance, B at 10% (default). */
function creditDeps(opts: { unavailable?: string[]; totals?: AdminTotalsRow[]; failTotals?: boolean; ceiling?: boolean } = {}) {
  const getSnapshots = jest.fn(async (ids: string[]) => {
    const out = new Map<string, unknown>();
    for (const id of ids) {
      if (opts.unavailable?.includes(id)) out.set(id, { resolution: null, unavailable: true, stale: false });
      else out.set(id, snapshotOf(id === B ? TIER : CHAMPION));
    }
    return out;
  });
  const findPeriodAnchorsBatch = jest.fn(async (ids: readonly string[]) => ({
    data: Object.fromEntries(ids.map((id) => [id, '2026-09-01T00:00:00.000Z'])),
    error: null,
  }));
  const totals = opts.totals ?? [
    { user_id: A, period_start: PERIOD, credits_total: String(ALLOWANCE_A * 2) },
    { user_id: B, period_start: PERIOD, credits_total: String(ALLOWANCE_B / 10) },
  ];
  type TotalsArgs = Parameters<AdminCreditPercentDeps['listTotalsForAccountsInRange']>;
  type TotalsResult = Awaited<ReturnType<AdminCreditPercentDeps['listTotalsForAccountsInRange']>>;
  const listTotalsForAccountsInRange = jest.fn<Promise<TotalsResult>, TotalsArgs>(async (ids) =>
    opts.failTotals
      ? { data: null, error: new Error('totals failed') }
      : { data: { rows: totals.filter((row) => ids.includes(row.user_id)), reachedCeiling: opts.ceiling ?? false }, error: null }
  );
  return {
    getSnapshots: getSnapshots as unknown as AdminCreditPercentDeps['getSnapshots'] & jest.Mock,
    findPeriodAnchorsBatch,
    listTotalsForAccountsInRange,
  };
}

const ADMIN_X = '55555555-5555-4555-8555-555555555555';
/** The reminder queue's figures as the jobs & queues read returns them (extra fields included). */
const REMINDERS = {
  dueNow: 2, later: 4, noDueTime: null, inProgress: 0, stuck: 0, failed24h: 1, failed7d: 3,
  deadLettered24h: 0, deadLettered7d: 0, skipped7d: 1, guardrailSkips7d: null, unrecognisedStatus: 0,
  oldestDueAt: '2026-11-09T08:00:00.000Z',
} as FinanceReminderFiguresInput;
function giftLot(accountId: string | null, creditsGranted: number, extra: Partial<FinanceLot> = {}): FinanceLot {
  return {
    id: `44444444-4444-4444-8444-${String(Math.round(creditsGranted * 1000)).padStart(12, '0')}`,
    accountId,
    source: 'admin_grant',
    creditsGranted,
    expiresAt: null,
    createdAt: '2026-11-02T10:00:00.000Z',
    actorAdminId: ADMIN_X,
    draws: [],
    ...extra,
  };
}

// Overrides replace whole deps (e.g. a failing pagePlans); the result keeps the defaults' mock types.
function makeDeps(overrides: Record<string, unknown> = {}) {
  const defaults = {
    plans: { pagePlans: jest.fn(() => ok([plan(A), plan(B, { tier: TIER, cohort: null })])) },
    findPlanForAccount: jest.fn(() => ok({ plan: plan(A) })),
    ledger: {
      listRowsOfAllAccountsCreatedInRange: jest.fn(() =>
        ok({ rows: [charge(A, '3'), charge(B, '1'), charge(null, '2'), charge(PLATFORM, '0.5')], reachedCeiling: false })
      ),
      listRowsForAccountCreatedInRange: jest.fn(() => ok({ rows: [charge(A, '3')], reachedCeiling: false })),
      findChargesByActionIds: jest.fn(() => ok<CreditLedgerRow[]>([])),
    },
    finance: {
      listBillingStatusesAllAccounts: jest.fn(() =>
        ok<FinanceBillingStatusRow[]>([{ user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null }])
      ),
      findBillingStatusForAccount: jest.fn(() => ok(null)),
      countRevenueRows: jest.fn(() => ok({ planInvoicesPaid: 0, boostsPaid: 0 })),
      // Slice 2a: empty by default; the takings describes seed their own rows.
      listClientPaymentsAllAccountsPaidInRange: jest.fn<Result<ClientRead<FinanceClientPaymentRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listClientPaymentsForAccountPaidInRange: jest.fn<Result<ClientRead<FinanceClientPaymentRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listClientRefundsAllAccountsCreatedInRange: jest.fn<Result<ClientRead<FinanceClientRefundRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listClientRefundsForAccountCreatedInRange: jest.fn<Result<ClientRead<FinanceClientRefundRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      // Slice 2b: empty by default; the payment problems describes seed their own rows.
      listOverdueClientInvoicesAllAccounts: jest.fn<Result<ClientRead<FinanceClientDueRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listOverdueClientInvoicesForAccount: jest.fn<Result<ClientRead<FinanceClientDueRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listOverdueClientInstalmentsAllAccounts: jest.fn<Result<ClientRead<FinanceClientDueRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listOverdueClientInstalmentsForAccount: jest.fn<Result<ClientRead<FinanceClientDueRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listClientPlansAllAccounts: jest.fn<Result<ClientRead<FinanceClientPlanRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listClientPlansForAccount: jest.fn<Result<ClientRead<FinanceClientPlanRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      // Slice 4a: empty by default; the boost describes seed their own rows.
      listBoostPurchasesAllAccountsPaidInRange: jest.fn<Result<ClientRead<FinanceBoostPurchaseRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listBoostPurchasesForAccountPaidInRange: jest.fn<Result<ClientRead<FinanceBoostPurchaseRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      // Slice 5a: empty by default; the plan describes seed their own rows.
      listPlanPaymentsAllAccountsPaidInRange: jest.fn<Result<ClientRead<FinancePlanPaymentRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listPlanPaymentsForAccountPaidInRange: jest.fn<Result<ClientRead<FinancePlanPaymentRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      // Slice 4b.2: empty by default; the 4b.2 describes seed their own rows.
      listBoostReversalEventsAllAccountsRecordedInRange: jest.fn<Result<ClientRead<FinanceBoostReversalRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listBoostReversalEventsForAccountRecordedInRange: jest.fn<Result<ClientRead<FinanceBoostReversalRow>>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false })
      ),
      listBoostPurchasesNeedingAttentionAllAccounts: jest.fn<Result<FinanceBoostAttentionResult>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false, openedDates: 'read' as const })
      ),
      listBoostPurchasesNeedingAttentionForAccount: jest.fn<Result<FinanceBoostAttentionResult>, unknown[]>(() =>
        ok({ rows: [], reachedCeiling: false, openedDates: 'read' as const })
      ),
    },
    readReminderFigures: jest.fn<Result<FinanceReminderFiguresInput>, [Date, AbortSignal]>(() => ok(REMINDERS)),
    // M-4 (OV-5): the two route-injected recorded AI cost reads. All accounts: USD 7 recorded against
    // 4.50 charged (6.50 less the 2.00 deleted bucket); one account (A): USD 3.50 against 3.00.
    readRecordedAllAccounts: jest.fn<Result<{ rows: Array<{ cost_usd: number | string | null }>; completed: boolean }>, [{ from: Date; to: Date }, AbortSignal]>(
      () => ok({ rows: [{ cost_usd: '4' }, { cost_usd: '3' }], completed: true })
    ),
    readRecordedForAccount: jest.fn<Result<{ rows: Array<{ cost_usd: number | string | null }>; reachedCeiling: boolean }>, [string, { from: Date; to: Date }]>(
      () => ok({ rows: [{ cost_usd: '3.5' }], reachedCeiling: false })
    ),
    findNames: jest.fn((ids: readonly string[]) =>
      ok(ids.filter((id) => id === A).map((id) => ({ user_id: id, company_name: 'Acme Dental' })))
    ),
    config,
    isPlatformAccount: (id: string) => id === PLATFORM,
    credits: creditDeps(),
    lots: {
      allAccounts: jest.fn(() => ok<FinanceLot[]>([])),
      forAccount: jest.fn<Result<FinanceLot[]>, [string]>(() => ok<FinanceLot[]>([])),
    },
  };
  return { ...defaults, ...overrides } as typeof defaults;
}

const logger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() });

async function run(deps = makeDeps(), accountId: string | null = null, log = logger(), now = NOW, window = WINDOW, accountsTab: FinanceAccountsTabQuery | null = null) {
  const result = await buildFinanceHealth({ window, accountId, now, accountsTab }, log, deps as unknown as FinanceHealthDeps);
  return { result, log, deps };
}

beforeEach(() => jest.clearAllMocks());

describe('all businesses', () => {
  it('builds every section, ok, with exact figures and the four groups of rows in Section 3', async () => {
    const { result, deps } = await run();
    if (result.kind !== 'ok') throw new Error('expected ok');
    const p = result.payload;
    expect(p.accounts.status).toBe('ok');
    expect(p.accounts.scope).toBe('all');
    expect(p.accounts.figures?.total).toBe(2);
    expect(p.accounts.figures?.groups.find((g) => g.key === `tier:${TIER}`)?.count).toBe(1);
    expect(p.aiCost.status).toBe('ok');
    expect(p.aiCost.figures?.costUsd).toBe(6.5);
    expect(p.aiCost.figures?.deleted.costUsd).toBe(2);
    // SA-WR-5: the platform account is labelled, never named or "unknown".
    expect(p.aiCost.figures?.topAccounts).toEqual([
      { accountId: A, costUsd: 3, credits: 1, name: 'Acme Dental', nameStatus: 'found' },
      { accountId: B, costUsd: 1, credits: 1, name: null, nameStatus: 'missing' },
      { accountId: PLATFORM, costUsd: 0.5, credits: 1, name: null, nameStatus: 'platform' },
    ]);
    // Names are asked only for the non-platform ids read from the ledger.
    expect(deps.findNames).toHaveBeenCalledWith([A, B]);
    expect(p.revenue).toMatchObject({ status: 'ok', state: 'none_yet', plans: { status: 'ok', scope: 'all', lines: [] }, boosts: { status: 'ok', scope: 'all' }, totals: [] });
    expect(p.tiles.k5).toMatchObject({ status: 'neutral', headline: 'No data yet', money: { kind: 'none' } });
    expect(p.tiles.k3).toMatchObject({ status: 'amber', value: { value: 1, exact: true } });
    expect(result.counts).toMatchObject({ accounts: 2, ledgerRows: 4, deletedRows: 1, topAccounts: 3, namesFound: 1 });
  });

  it('AC-6: an empty plan walk → Section 1 zeros and K-3 green 0', async () => {
    const { result } = await run(makeDeps({ plans: { pagePlans: jest.fn(() => ok([])) } }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.accounts.figures?.total).toBe(0);
    expect(result.payload.tiles.k3).toMatchObject({ status: 'green', value: { value: 0, exact: true } });
  });

  it('AC-7: no ledger rows → Section 3 ok with zeros', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() => ok({ rows: [], reachedCeiling: false }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.aiCost).toMatchObject({ status: 'ok', figures: { costUsd: 0, rows: 0, exact: true } });
  });

  it('AC-15: a window read at its ceiling → Section 3 partial, not exact', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() =>
      ok({ rows: [charge(A, '1')], reachedCeiling: true })
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.aiCost.status).toBe('partial');
    expect(result.payload.aiCost.figures?.exact).toBe(false);
    // The same read path serves K-1, so it is a minimum too: amber, never green.
    expect(result.payload.tiles.k1).toMatchObject({ status: 'amber' });
  });

  it('AC-27 / AC-37: the plan walk fails → Section 1 unknown, K-3 unavailable, Section 3 total still ok with byGroup unknown', async () => {
    const { result, log } = await run(makeDeps({ plans: { pagePlans: jest.fn(fail) } }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.accounts).toEqual({ status: 'unknown', scope: 'all', figures: null });
    expect(result.payload.tiles.k3.status).toBe('unavailable');
    expect(result.payload.aiCost.status).toBe('ok');
    expect(result.payload.aiCost.figures?.byGroup).toEqual({ status: 'unknown', lines: [] });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'plans' }), expect.any(String));
  });

  it('AC-37: the walk reaching 20,000 → Section 1 partial, K-3 a minimum', async () => {
    let page = 0;
    const pagePlans = jest.fn(() => {
      page += 1;
      return ok(
        Array.from({ length: 500 }, (_, i) =>
          plan(`${String(page).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`, { cohort_expires_at: '2027-01-01T00:00:00Z' })
        )
      );
    });
    const { result } = await run(makeDeps({ plans: { pagePlans } }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(pagePlans).toHaveBeenCalledTimes(40);
    expect(result.payload.accounts.status).toBe('partial');
    expect(result.payload.tiles.k3).toMatchObject({ status: 'amber', value: { value: 0, exact: false } });
    // SA-2: the by-group breakdown rests on the same capped walk.
    expect(result.payload.aiCost.figures?.byGroup.status).toBe('partial');
  });

  it('the paying read fails → Section 1 ok with the "Tier set" group (SA-Q5)', async () => {
    const deps = makeDeps();
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(fail);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.accounts.figures?.payingKnown).toBe(false);
    expect(result.payload.accounts.figures?.groups.find((g) => g.key === 'tier_set')?.count).toBe(1);
  });

  it('AC-27: the window read fails → Section 3 unknown, the others ok, never a throw', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() => {
      throw new Error('exploded');
    });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.aiCost).toMatchObject({ status: 'unknown', figures: null });
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.revenue.status).toBe('ok');
  });

  it('names fail → the top 10 still shows, "name unavailable"', async () => {
    const { result } = await run(makeDeps({ findNames: jest.fn(fail) }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.aiCost.figures?.topAccounts[0]).toMatchObject({ accountId: A, nameStatus: 'unavailable' });
  });

  it('looks up the originals of adjustments outside the window, in chunks', async () => {
    const deps = makeDeps();
    const original = charge(A, '1', { triggered_by: 'scheduled' });
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() =>
      ok({
        rows: [charge(A, '-0.5', { kind: 'adjustment', action_id: null, adjusts_action_id: original.action_id, triggered_by: null, service: null })],
        reachedCeiling: false,
      })
    );
    deps.ledger.findChargesByActionIds.mockImplementation(() => ok([original]));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(deps.ledger.findChargesByActionIds).toHaveBeenCalledWith([original.action_id]);
    expect(result.payload.aiCost.figures?.byTrigger.find((t) => t.trigger === 'scheduled')?.rows).toBe(1);
  });
});

// ── Our revenue (slice 4a; the 1c revenue panel's wording superseded, SA-W50 / E-31) ──

let boostSeq = 0;
function boostRow(user_id: string | null, extra: Partial<FinanceBoostPurchaseRow> = {}): FinanceBoostPurchaseRow {
  boostSeq += 1;
  return {
    id: `cccccccc-0000-4000-8000-${String(boostSeq).padStart(12, '0')}`,
    user_id,
    status: 'paid',
    package_id: 'pkg-small',
    package_version: 1,
    currency: 'USD',
    amount_total_minor: 1000,
    amount_tax_minor: 0,
    credits_total: '5000.000000',
    paid_at: '2026-11-05T10:00:00.000Z',
    ...extra,
  };
}

/** The owner's own test purchase (AC-95): one boost, USD 10.00, 5,000 credits. */
function boostDeps(rows: FinanceBoostPurchaseRow[] = [boostRow(A)], reachedCeiling = false) {
  const deps = makeDeps();
  deps.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(() => ok({ rows, reachedCeiling }));
  deps.finance.listBoostPurchasesForAccountPaidInRange.mockImplementation(() =>
    ok({ rows: rows.filter((r) => r.user_id === A), reachedCeiling })
  );
  return deps;
}

describe('R-d sets `state` with all businesses only (SA-WR-32 kept; SA-W61, SA-W62)', () => {
  // The builder receives counts only; that test-mode rows are counted at all is
  // pinned, UNEDITED, in the repository test (no mode filter on either head count).
  it('SA-WR-32: a test-mode plan invoice alone (R-d counts it) → state recorded', async () => {
    const deps = makeDeps();
    deps.finance.countRevenueRows.mockImplementation(() => ok({ planInvoicesPaid: 1, boostsPaid: 0 }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'ok', state: 'recorded' });
    expect(result.counts.revenueExistence).toBe('read');
  });

  it('AC-76 (4a meaning): a paid boost alone → state recorded, the boost line shown, plans empty', async () => {
    const deps = boostDeps();
    deps.finance.countRevenueRows.mockImplementation(() => ok({ planInvoicesPaid: 0, boostsPaid: 1 }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'ok', state: 'recorded', plans: { status: 'ok', lines: [], notes: { empty: true } } });
    expect(result.payload.revenue.boosts.lines).toEqual([expect.objectContaining({ currency: 'USD', purchases: 1, net: 10 })]);
  });

  it('AC-77 (4a meaning): nothing paid → state none_yet, K-5 "No data yet"', async () => {
    const { result } = await run(makeDeps());
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'ok', state: 'none_yet' });
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', headline: 'No data yet', money: { kind: 'none' } });
  });

  it('SA-W62: R-d fails → state unknown and the log line; the section status and K-5 unchanged', async () => {
    const deps = boostDeps();
    deps.finance.countRevenueRows.mockImplementation(fail);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'ok', state: 'unknown', boosts: { status: 'ok' }, plans: { status: 'ok' } });
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', money: { kind: 'one', currency: 'USD', net: 10 } });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'revenue_existence' }), 'Finance read failed');
    expect(result.counts.revenueExistence).toBe('failed');
  });

  it('SA-W62: the boosts AND plans reads fail → the section is unknown; every other section still renders', async () => {
    const deps = makeDeps();
    deps.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(fail as never);
    deps.finance.listPlanPaymentsAllAccountsPaidInRange.mockImplementation(fail as never);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.status).toBe('unknown');
    expect(result.payload.revenue.totals).toBeNull();
    // Slice 4b.2: held now (R-l, read fine) and the events note still travel (E-103).
    expect(result.payload.revenue.boosts).toEqual({ status: 'unknown', scope: 'all', lines: null, packages: null, deletedAccounts: null, notes: null, heldNow: [], events: null });
    expect(result.payload.revenue.plans).toMatchObject({ status: 'unknown', lines: null, accounts: null, notes: null });
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.takings.status).toBe('ok');
  });

  it('SA-W62: R-d and R-k fail but the plans read succeeds → partial, never unknown', async () => {
    const deps = makeDeps();
    deps.finance.countRevenueRows.mockImplementation(fail);
    deps.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(fail as never);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'partial', state: 'unknown' });
  });
});

describe('our boost revenue, all businesses (slice 4a)', () => {
  it('AC-95: the owner purchase → USD 10.00 line, starter-like package row, K-5 grey with USD 10 and the net headline; R-k gets the window', async () => {
    const deps = boostDeps();
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const boosts = result.payload.revenue.boosts;
    expect(boosts).toMatchObject({ status: 'ok', scope: 'all', deletedAccounts: [] });
    expect(boosts.lines).toEqual([
      { currency: 'USD', purchases: 1, gross: 10, tax: 0, refunded: 0, lost: 0, net: 10, creditsSold: 5000, unreadable: 0, unreadableEvents: 0, unreadableCredits: 0 },
    ]);
    expect(boosts.packages).toEqual([
      { currency: 'USD', packageId: 'pkg-small', packageVersion: 1, purchases: 1, gross: 10, refunded: 0, net: 10, unreadable: 0 },
    ]);
    expect(result.payload.tiles.k5).toEqual({
      id: 'k5_our_revenue',
      status: 'neutral',
      headline: 'Boosts net of refunds and disputes, plus plans received',
      value: null,
      previous: null,
      money: { kind: 'one', currency: 'USD', net: 10 },
    });
    expect(deps.finance.listBoostPurchasesAllAccountsPaidInRange.mock.calls).toEqual([[{ from: WINDOW.start, to: WINDOW.end }]]);
    expect(deps.finance.listBoostPurchasesForAccountPaidInRange).not.toHaveBeenCalled();
  });

  it('SA-WR-34: K-1 to K-4 never carry money; K-5 always does', async () => {
    for (const deps of [makeDeps(), boostDeps()]) {
      const { result } = await run(deps);
      if (result.kind !== 'ok') throw new Error('expected ok');
      const { k1, k2, k3, k4, k5 } = result.payload.tiles;
      for (const tile of [k1, k2, k3, k4]) expect(tile).not.toHaveProperty('money');
      expect(k5).toHaveProperty('money');
      expect(k5.value).toBeNull();
    }
  });

  it('AC-97: a deleted-account purchase counts in the totals and on the deleted line', async () => {
    const { result } = await run(boostDeps([boostRow(A), boostRow(null, { amount_total_minor: 2500 })]));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.boosts.lines![0]).toMatchObject({ purchases: 2, net: 35 });
    expect(result.payload.revenue.boosts.deletedAccounts).toEqual([{ currency: 'USD', purchases: 1, net: 25, unreadable: 0 }]);
    expect(result.counts.boosts.deletedAccountPurchases).toBe(1);
  });

  it('AC-92: two currencies → K-5 several, never a sum', async () => {
    const { result } = await run(boostDeps([boostRow(A), boostRow(B, { currency: 'EUR', amount_total_minor: 700 })]));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', headline: 'Boosts net of refunds and disputes, plus plans received', money: { kind: 'several', currencies: 2 } });
    expect(result.payload.revenue.boosts.lines!.map((l) => l.currency)).toEqual(['EUR', 'USD']);
  });

  it('AC-93: R-k at its ceiling → boosts partial, section partial, K-5 unknown cut_off (still grey, never "at least")', async () => {
    const { result } = await run(boostDeps([boostRow(A)], true));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'partial', boosts: { status: 'partial', notes: { exact: false } } });
    // Slice 4b.2: lost is an event figure (the events were read in full); net is still Unknown.
    expect(result.payload.revenue.boosts.lines![0]).toMatchObject({ net: null, lost: 0 });
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', money: { kind: 'unknown', reason: 'cut_off' } });
    expect(result.counts.boosts).toMatchObject({ rows: 1, ceiling: true });
  });

  it('AC-95: R-k fails → K-5 unavailable "Unknown", boosts unknown, section partial, every other section present', async () => {
    const deps = boostDeps();
    deps.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k5).toMatchObject({ status: 'unavailable', headline: 'Unknown', money: { kind: 'unknown', reason: 'failed' } });
    expect(result.payload.revenue).toMatchObject({ status: 'partial', plans: { status: 'ok' }, boosts: { status: 'unknown', lines: null }, totals: null });
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.aiCost.status).toBe('ok');
    expect(result.payload.credits.status).toBe('ok');
    expect(result.payload.takings.status).toBe('ok');
    expect(result.counts.boosts).toMatchObject({ rows: null, counted: 0 });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'boost_purchases' }), 'Finance read failed');
  });

  it('R-k THROWS → the same unknown block, never a throw out of the builder', async () => {
    const deps = boostDeps();
    deps.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(() => {
      throw new Error('exploded');
    });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.boosts.status).toBe('unknown');
  });

  it('the counts carry no amount, currency or package', async () => {
    const { result } = await run(boostDeps([boostRow(A, { amount_total_minor: 987654 }), boostRow(A, { status: 'expired' })]));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.counts.boosts).toEqual({
      rows: 2,
      ceiling: false,
      counted: 1,
      otherStatus: 1,
      unreadable: 0,
      unreadableCredits: 0,
      currencies: 1,
      packages: 1,
      deletedAccountPurchases: 0,
      // Slice 4b.2: counts, states and booleans only.
      events: 0,
      eventsCeiling: false,
      eventsState: 'read',
      unreadableEvents: 0,
      attention: 0,
      openDisputes: 0,
      notCredited: 0,
      openedDates: 'read',
    });
    const text = JSON.stringify(result.counts);
    for (const secret of ['9876', 'USD', 'pkg-small']) expect(text).not.toContain(secret);
  });

  it('the boost block looks up no name: an id read only from a boost row never reaches the names read', async () => {
    const ONLY_IN_BOOSTS = '66666666-6666-4666-8666-666666666666';
    const deps = boostDeps([boostRow(ONLY_IN_BOOSTS)]);
    await run(deps);
    for (const [ids] of deps.findNames.mock.calls) expect(ids).not.toContain(ONLY_IN_BOOSTS);
  });
});

describe('AC-96 / AC-123: with a business picked, R-k′ and R-m′ get exactly the id; R-k, R-m and R-d zero calls', () => {
  it('exactly the id and the window range; deletedAccounts null; K-5 is that business’s own; no platform-wide read (SA-Q35)', async () => {
    const deps = boostDeps([boostRow(A), boostRow(null, { amount_total_minor: 2500 })]);
    deps.finance.countRevenueRows.mockImplementation(() => ok({ planInvoicesPaid: 3, boostsPaid: 2 }));
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(deps.finance.listBoostPurchasesForAccountPaidInRange.mock.calls).toEqual([[A, { from: WINDOW.start, to: WINDOW.end }]]);
    expect(deps.finance.listBoostPurchasesAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(deps.finance.listPlanPaymentsForAccountPaidInRange.mock.calls).toEqual([[A, { from: WINDOW.start, to: WINDOW.end }]]);
    expect(deps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(deps.finance.countRevenueRows).not.toHaveBeenCalled();
    expect(result.counts.revenueExistence).toBe('not_called');
    const boosts = result.payload.revenue.boosts;
    expect(boosts.scope).toBe('one');
    expect(boosts.deletedAccounts).toBeNull();
    expect(boosts.lines).toEqual([expect.objectContaining({ purchases: 1, net: 10 })]);
    expect(result.payload.revenue.plans).toMatchObject({ scope: 'one', accounts: null, deletedAccounts: null, payments: [] });
    // E-36: this business's own boost makes it recorded; R-d's platform-wide 3 / 2 is never read.
    expect(result.payload.revenue.state).toBe('recorded');
    expect(result.payload.tiles.k5).toMatchObject({ money: { kind: 'one', currency: 'USD', net: 10 } });
  });

  it('a picked business with no boost → K-5 "No data yet", empty', async () => {
    const deps = boostDeps([boostRow(B)]);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.boosts.notes).toMatchObject({ empty: true });
    expect(result.payload.tiles.k5).toMatchObject({ headline: 'No data yet', money: { kind: 'none' } });
    expect(deps.finance.listBoostPurchasesAllAccountsPaidInRange).not.toHaveBeenCalled();
  });
});

// ── Our revenue, plans (slice 5a, §11D.4; T5) ────────────────────────────────

let planSeq = 0;
function planRow(user_id: string | null, extra: Partial<FinancePlanPaymentRow> = {}): FinancePlanPaymentRow {
  planSeq += 1;
  return {
    id: `dddddddd-0000-4000-8000-${String(planSeq).padStart(12, '0')}`,
    user_id,
    kind: 'invoice_paid',
    tier: TIER,
    amount_minor: 7900,
    amount_tax_minor: 0,
    currency: 'usd',
    period_start: '2026-11-03T18:21:07.000Z',
    period_end: '2026-12-03T18:21:07.000Z',
    paid_at: '2026-11-03T18:21:09.000Z',
    ...extra,
  };
}

/** The owner account's month: a USD 10.00 boost and a USD 79.00 plan payment (§11D.1). */
function ownerDeps(plans: FinancePlanPaymentRow[] = [planRow(A)], reachedCeiling = false) {
  const deps = boostDeps();
  deps.finance.listPlanPaymentsAllAccountsPaidInRange.mockImplementation(() => ok({ rows: plans, reachedCeiling }));
  deps.finance.listPlanPaymentsForAccountPaidInRange.mockImplementation(() =>
    ok({ rows: plans.filter((r) => r.user_id === A), reachedCeiling })
  );
  return deps;
}

describe('our plan revenue, all businesses (slice 5a)', () => {
  it('AC-122: boost USD 10.00 + plan USD 79.00 → K-5 one USD 89, grey, the new headline; totals per currency; R-m gets the window', async () => {
    const deps = ownerDeps();
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const revenue = result.payload.revenue;
    expect(revenue.status).toBe('ok');
    expect(revenue.plans.lines).toEqual([
      { currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 0, exact: true },
    ]);
    expect(revenue.totals).toEqual([{ currency: 'USD', boostsNet: 10, plansReceived: 79, total: 89 }]);
    expect(result.payload.tiles.k5).toEqual({
      id: 'k5_our_revenue',
      status: 'neutral',
      headline: 'Boosts net of refunds and disputes, plus plans received',
      value: null,
      previous: null,
      money: { kind: 'one', currency: 'USD', net: 89 },
    });
    expect(deps.finance.listPlanPaymentsAllAccountsPaidInRange.mock.calls).toEqual([[{ from: WINDOW.start, to: WINDOW.end }]]);
    expect(deps.finance.listPlanPaymentsForAccountPaidInRange).not.toHaveBeenCalled();
  });

  it('AC-124: the by-business table names only the shown plan rows, in one names call; platform labelled; deleted line from NULL user_id', async () => {
    const ONLY_IN_PLANS = '77777777-7777-4777-8777-777777777777';
    const deps = ownerDeps([planRow(A), planRow(ONLY_IN_PLANS, { amount_minor: 1999 }), planRow(PLATFORM, { amount_minor: 100 }), planRow(null, { amount_minor: 4900 })]);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const plans = result.payload.revenue.plans;
    expect(plans.accounts).toEqual([
      { accountId: A, name: 'Acme Dental', nameStatus: 'found', currency: 'USD', payments: 1, received: 79, exact: true },
      { accountId: ONLY_IN_PLANS, name: null, nameStatus: 'missing', currency: 'USD', payments: 1, received: 19.99, exact: true },
      { accountId: PLATFORM, name: null, nameStatus: 'platform', currency: 'USD', payments: 1, received: 1, exact: true },
    ]);
    expect(plans.deletedAccounts).toEqual([{ currency: 'USD', payments: 1, received: 49, exact: true }]);
    const planNameCalls = deps.findNames.mock.calls.filter(([ids]) => ids.includes(ONLY_IN_PLANS));
    expect(planNameCalls).toEqual([[[A, ONLY_IN_PLANS]]]);
    for (const [ids] of deps.findNames.mock.calls) expect(ids).not.toContain(PLATFORM);
    expect(result.counts.plans).toMatchObject({ accountsShown: 3, accountsTotal: 3, deletedAccountPayments: 1, namesFound: 1 });
  });

  it('SA-W66: equal received in one currency → by name among the shown rows', async () => {
    const Z = '99999999-9999-4999-8999-999999999999';
    const deps = ownerDeps([planRow(Z, { amount_minor: 500 }), planRow(A, { amount_minor: 500 })]);
    deps.findNames.mockImplementation(((ids: readonly string[]) =>
      ok(ids.map((id) => ({ user_id: id, company_name: id === A ? 'Zeta Gym' : 'Alpha Spa' })))) as never);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.plans.accounts!.map((r) => r.name)).toEqual(['Alpha Spa', 'Zeta Gym']);
  });

  it('AC-126: R-m fails → plans unknown, section partial, K-5 unknown failed, totals null; every other section present; logged', async () => {
    const deps = boostDeps();
    deps.finance.listPlanPaymentsAllAccountsPaidInRange.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'partial', plans: { status: 'unknown', lines: null }, boosts: { status: 'ok' }, totals: null });
    expect(result.payload.tiles.k5).toMatchObject({ status: 'unavailable', money: { kind: 'unknown', reason: 'failed' } });
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.takings.status).toBe('ok');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'plan_payments' }), 'Finance read failed');
    expect(result.counts.plans.rows).toBeNull();
  });

  it('AC-125: R-m at its ceiling → plans partial, section partial, K-5 unknown cut_off (grey)', async () => {
    const { result } = await run(ownerDeps([planRow(A)], true));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toMatchObject({ status: 'partial', plans: { status: 'partial', notes: { exact: false } } });
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', money: { kind: 'unknown', reason: 'cut_off' } });
    expect(result.counts.plans).toMatchObject({ rows: 1, ceiling: true });
  });

  it('SA-W65: a tier in the config order gets its label; one outside it and NULL are "Unknown plan" (null)', async () => {
    const deps = ownerDeps([planRow(A), planRow(A, { tier: 'not_a_tier', paid_at: '2026-11-02T00:00:00.000Z' }), planRow(A, { tier: null, paid_at: '2026-11-01T00:00:00.000Z' })]);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.plans.payments!.map((p) => p.planLabel)).toEqual([tierLabelForGroup(config, `tier:${TIER}`), null, null]);
    expect(tierLabelForGroup(config, `tier:${TIER}`)).toBeTruthy();
  });

  it('M2-FR-11: the plan counts carry no amount, currency, tier or name', async () => {
    const { result } = await run(ownerDeps([planRow(A, { amount_minor: 987654 }), planRow(A, { kind: 'mismatch_refused' })]));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(Object.keys(result.counts.plans).sort()).toEqual([
      'accountsShown', 'accountsTotal', 'ceiling', 'currencies', 'deletedAccountPayments', 'namesFound', 'otherKind', 'payments', 'paymentsTotal', 'rows', 'unreadable', 'zeroAmount',
    ]);
    const text = JSON.stringify([result.counts.plans, result.counts.revenueExistence]);
    for (const secret of ['9876', 'USD', 'usd', TIER, 'Acme']) expect(text).not.toContain(secret);
  });
});

describe('E-36: the picked business’s `state` from its own reads (SA-Q35)', () => {
  it('one plan payment and no boost → recorded', async () => {
    const deps = makeDeps();
    deps.finance.listPlanPaymentsForAccountPaidInRange.mockImplementation(() => ok({ rows: [planRow(A)], reachedCeiling: false }));
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.state).toBe('recorded');
    expect(result.payload.tiles.k5).toMatchObject({ money: { kind: 'one', currency: 'USD', net: 79 } });
  });

  it('neither → none_yet; R-d not called', async () => {
    const deps = makeDeps();
    deps.finance.countRevenueRows.mockImplementation(() => ok({ planInvoicesPaid: 9, boostsPaid: 9 }));
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.state).toBe('none_yet');
    expect(deps.finance.countRevenueRows).not.toHaveBeenCalled();
  });

  it.each([
    ['R-m′', 'listPlanPaymentsForAccountPaidInRange'],
    ['R-k′', 'listBoostPurchasesForAccountPaidInRange'],
  ] as const)('%s failing → unknown', async (_n, method) => {
    const deps = makeDeps();
    deps.finance[method].mockImplementation(fail as never);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.state).toBe('unknown');
  });

  it('the owner picked: plan 79.00 + boost 10.00 → K-5 USD 89 and the list newest first', async () => {
    const deps = ownerDeps([planRow(A, { paid_at: '2026-11-01T00:00:00.000Z', amount_minor: 1999 }), planRow(A)]);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.plans.payments!.map((p) => p.paidAt)).toEqual(['2026-11-03T18:21:09.000Z', '2026-11-01T00:00:00.000Z']);
    expect(result.payload.revenue.totals).toEqual([{ currency: 'USD', boostsNet: 10, plansReceived: 98.99, total: 108.99 }]);
    expect(result.payload.tiles.k5).toMatchObject({ money: { kind: 'one', currency: 'USD', net: 108.99 } });
  });
});

describe('K-1 and the cut-over', () => {
  it('in October 2026 the previous span starts before the cut-over: not measured, and the previous span is not read', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const deps = makeDeps();
    const { result } = await run(deps, null, logger(), now, resolveFinanceWindow({ preset: 'this_month' }, now));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k1).toMatchObject({ status: 'not_measured', headline: 'Not enough history', previous: null });
    // Window + current month only: two reads, no previous-span read.
    expect(deps.ledger.listRowsOfAllAccountsCreatedInRange).toHaveBeenCalledTimes(2);
  });

  it('November: compares this month with the same span of October', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(((range: { from: Date }) =>
      ok({ rows: [charge(A, range.from.getUTCMonth() === 9 ? '1' : '3')], reachedCeiling: false })) as never);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k1).toMatchObject({ status: 'red', value: { value: 3, exact: true }, previous: { value: 1, exact: true } });
  });

  it('SA-1 / QA-1: an unreadable amount in the month → K-1 grey "Unknown", never green', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() =>
      ok({ rows: [charge(A, 'not-a-number'), charge(A, '1')], reachedCeiling: false })
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k1).toMatchObject({ status: 'unavailable', headline: 'Unknown', value: null });
    expect(result.payload.aiCost.figures?.exact).toBe(false);
    expect(result.payload.aiCost.status).toBe('partial');
  });

  it('AC-40: a window entirely before the cut-over is not read; coverage says so', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const window = resolveFinanceWindow({ preset: 'custom', from: '2026-09-01', to: '2026-09-20' }, now);
    const deps = makeDeps();
    const { result } = await run(deps, null, logger(), now, window);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.aiCost.coverage).toBe('entirely_before_cutover');
    expect(result.payload.aiCost.figures?.rows).toBe(0);
    // Only K-1's current month was read.
    expect(deps.ledger.listRowsOfAllAccountsCreatedInRange).toHaveBeenCalledTimes(1);
  });

  it('AC-40: a window starting before the cut-over is read from the cut-over', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const window = resolveFinanceWindow({ preset: 'custom', from: '2026-09-20', to: '2026-10-09' }, now);
    const deps = makeDeps();
    const { result } = await run(deps, null, logger(), now, window);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.aiCost.coverage).toBe('starts_before_cutover');
    const firstRange = (deps.ledger.listRowsOfAllAccountsCreatedInRange.mock.calls as unknown as Array<[{ from: Date }]>)
      .map((c) => c[0].from.toISOString());
    expect(firstRange).toContain('2026-09-29T16:50:53.914Z');
  });
});

describe('slice 1c: a paying Founding Partner, all businesses (BD-15, AC-78, AC-80, AC-86)', () => {
  const TIER_2 = config.tierOrder[1];
  const groupOf = (figures: { groups: Array<{ key: string; count: number; foundingPartners: number }> } | null | undefined, key: string) =>
    figures?.groups.find((g) => g.key === key);

  it('AC-78 (a): champion with its tier in force and a paying row → its tier group, note 1; Comped 0', async () => {
    const deps = makeDeps({ plans: { pagePlans: jest.fn(() => ok([plan(A, { tier: TIER })])) } });
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(() =>
      ok([{ user_id: A, subscription_status: 'active', ended_at: null, bought_tier: null }])
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const figures = result.payload.accounts.figures;
    expect(groupOf(figures, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(groupOf(figures, 'comped')?.count).toBe(0);
  });

  it('AC-78 (b) / AC-80 / AC-86: champion with no tier, paying row with a bought tier → that tier, note 1, K-3 does not count it', async () => {
    const deps = makeDeps({ plans: { pagePlans: jest.fn(() => ok([plan(A), plan(B)])) } });
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(() =>
      ok([{ user_id: A, subscription_status: 'active', ended_at: null, bought_tier: TIER_2 }])
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const figures = result.payload.accounts.figures;
    expect(groupOf(figures, `tier:${TIER_2}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(groupOf(figures, 'founding_partner')?.count).toBe(1);
    expect(figures?.foundingNoEndDate).toBe(1);
    expect(result.payload.tiles.k3.value).toEqual({ value: 1, exact: true });
  });

  it('AC-79: a bought tier on a row that is not paying is ignored; the champion stays in Founding Partner', async () => {
    const deps = makeDeps({ plans: { pagePlans: jest.fn(() => ok([plan(A)])) } });
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(() =>
      ok([{ user_id: A, subscription_status: 'active', ended_at: '2026-10-01T00:00:00Z', bought_tier: TIER }])
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const figures = result.payload.accounts.figures;
    expect(groupOf(figures, 'founding_partner')?.count).toBe(1);
    expect(figures?.groups.every((g) => g.foundingPartners === 0)).toBe(true);
  });
});

describe('one business picked (SEC-3, AC-26, AC-41, AC-42 / SA-WR-3)', () => {
  it('checks the plan table first; no row → account_not_found, and nothing else is read', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: null })) });
    const { result } = await run(deps, A);
    expect(result).toEqual({ kind: 'account_not_found' });
    expect(deps.ledger.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
    expect(deps.finance.countRevenueRows).not.toHaveBeenCalled();
  });

  it('a failed check → account_check_failed', async () => {
    const { result } = await run(makeDeps({ findPlanForAccount: jest.fn(fail) }), A);
    expect(result).toEqual({ kind: 'account_check_failed' });
  });

  it('every account-scoped read gets exactly the id; no all-accounts read; R-d with no argument; names only from rows read', async () => {
    const deps = makeDeps();
    const original = charge(A, '1');
    deps.ledger.listRowsForAccountCreatedInRange.mockImplementation(() =>
      ok({
        rows: [charge(A, '3'), charge(A, '-1', { kind: 'adjustment', action_id: null, adjusts_action_id: original.action_id, service: null, triggered_by: null })],
        reachedCeiling: false,
      })
    );
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');

    // Zero calls on every all-accounts method.
    expect(deps.plans.pagePlans).not.toHaveBeenCalled();
    expect(deps.ledger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(deps.finance.listBillingStatusesAllAccounts).not.toHaveBeenCalled();

    // Exactly the validated id, on every account-scoped read.
    expect(deps.findPlanForAccount).toHaveBeenCalledWith(A);
    expect(deps.finance.findBillingStatusForAccount).toHaveBeenCalledWith(A);
    const accountArgs = (deps.ledger.listRowsForAccountCreatedInRange.mock.calls as unknown as unknown[][]).map((c) => c[0]);
    expect(accountArgs.length).toBe(3);
    expect(new Set(accountArgs)).toEqual(new Set([A]));
    // The originals lookup is by action id taken from rows already read.
    expect(deps.ledger.findChargesByActionIds).toHaveBeenCalledWith([original.action_id]);

    // SA-Q35 (slice 5a): R-d, platform-wide, is no longer called with a business picked; nor is R-m.
    expect(deps.finance.countRevenueRows).not.toHaveBeenCalled();
    expect(deps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(deps.finance.listPlanPaymentsForAccountPaidInRange).toHaveBeenCalledWith(A, { from: WINDOW.start, to: WINDOW.end });

    // Names: only ids from the rows read.
    expect(deps.findNames).toHaveBeenCalledWith([A]);

    // Section 1 narrowed: Total 1, all groups shown.
    expect(result.payload.accounts.scope).toBe('one');
    expect(result.payload.accounts.figures?.total).toBe(1);
    expect(result.payload.accountId).toBe(A);
  });

  it('AC-41: an open-ended Founding Partner → K-3 is 1; a dated one → 0', async () => {
    const open = await run(makeDeps(), A);
    const dated = await run(
      makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: plan(A, { cohort_expires_at: '2027-06-01T00:00:00Z' }) })) }),
      A
    );
    if (open.result.kind !== 'ok' || dated.result.kind !== 'ok') throw new Error('expected ok');
    expect(open.result.payload.tiles.k3.value).toEqual({ value: 1, exact: true });
    expect(dated.result.payload.tiles.k3.value).toEqual({ value: 0, exact: true });
  });

  it('the picked account pays: its tier group, via R-c′', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: plan(A, { tier: TIER, cohort: null }) })) });
    deps.finance.findBillingStatusForAccount.mockImplementation((() =>
      ok({ user_id: A, subscription_status: 'past_due', ended_at: null, bought_tier: null })) as never);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.accounts.figures?.groups.find((g) => g.key === `tier:${TIER}`)?.count).toBe(1);
  });

  it('AC-82: a paying Founding Partner with its tier in force → its tier group, note 1, K-3 0; account-scoped reads only', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: plan(A, { tier: TIER }) })) });
    deps.finance.findBillingStatusForAccount.mockImplementation((() =>
      ok({ user_id: A, subscription_status: 'active', ended_at: null, bought_tier: null })) as never);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const figures = result.payload.accounts.figures;
    expect(figures?.groups.find((g) => g.key === `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(figures?.groups.find((g) => g.key === 'founding_partner')?.count).toBe(0);
    expect(result.payload.tiles.k3.value).toEqual({ value: 0, exact: true });
    expect(deps.finance.findBillingStatusForAccount).toHaveBeenCalledWith(A);
    expect(deps.finance.listBillingStatusesAllAccounts).not.toHaveBeenCalled();
    expect(deps.plans.pagePlans).not.toHaveBeenCalled();
    // SA-Q35 (slice 5a): no platform-wide read with a business picked.
    expect(deps.finance.countRevenueRows).not.toHaveBeenCalled();
  });

  it('AC-82 / AC-85 / SA-WR-28: two billing rows make R-c′ fail → the champion stays in Founding Partner, "Tier set", no note', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: plan(A) })) });
    deps.finance.findBillingStatusForAccount.mockImplementation((() =>
      ({ data: null, error: new Error('JSON object requested, multiple (or no) rows returned') })) as never);
    const { result, log } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const figures = result.payload.accounts.figures;
    expect(result.payload.accounts.status).toBe('ok');
    expect(figures?.payingKnown).toBe(false);
    expect(figures?.groups.map((g) => g.key)).toEqual(['trial', 'founding_partner', 'tier_set', 'unknown_held']);
    expect(figures?.groups.find((g) => g.key === 'founding_partner')?.count).toBe(1);
    expect(figures?.groups.every((g) => g.foundingPartners === 0)).toBe(true);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('SA-WR-1: override rows (admin reason text) never travel past the wiring', () => {
  const SECRET = 'SECRET-ADMIN-REASON-do-not-leak';

  it('the wiring returns { plan } only', async () => {
    mockFindEntitlementInputs.mockResolvedValue({
      data: {
        plan: plan(A),
        overrides: [{ id: 'o1', user_id: A, capability: 'x', op: 'set', value: 1, reason: SECRET, ended_reason: SECRET }],
      },
      error: null,
    });
    const result = await findPlanWithoutOverrides(A);
    expect(Object.keys(result.data ?? {})).toEqual(['plan']);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(mockFindEntitlementInputs).toHaveBeenCalledWith(A);
  });

  it('…so the builder, its payload and every log line never see them', async () => {
    mockFindEntitlementInputs.mockResolvedValue({
      data: { plan: plan(A), overrides: [{ id: 'o1', reason: SECRET }] },
      error: null,
    });
    const log = logger();
    const deps = makeDeps({ findPlanForAccount: findPlanWithoutOverrides });
    const { result } = await run(deps, A, log);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify([log.error.mock.calls, log.warn.mock.calls])).not.toContain(SECRET);
    expect(JSON.stringify(Object.values(mockRepoLog).map((f) => f.mock.calls))).not.toContain(SECRET);
  });

  it('a failed plan read is passed on as an error, never as "no row"', async () => {
    mockFindEntitlementInputs.mockResolvedValue({ data: null, error: new Error('down') });
    const result = await findPlanWithoutOverrides(A);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('down');
  });
});

describe('Section 4, K-2 and K-4 (slice 1b)', () => {
  it('all businesses: rows by % used, K-2 amber at 1, K-4 grey 0, names for the rows shown, counts only in the counts', async () => {
    const { result, deps, log } = await run();
    if (result.kind !== 'ok') throw new Error('expected ok');
    const credits = result.payload.credits;
    expect(credits.status).toBe('ok');
    expect(credits.scope).toBe('all');
    expect(credits.farOverAllowancePercent).toBe(150);
    expect(credits.figures).toMatchObject({ accounts: 2, overAllowance: 1, farOverAllowance: 1, unknownAccounts: 0 });
    expect(credits.figures?.rows).toEqual([
      expect.objectContaining({ accountId: A, name: 'Acme Dental', nameStatus: 'found', group: 'founding_partner', usedTenths: 2000, farOverAllowance: true, giftedOutstanding: 0 }),
      expect.objectContaining({ accountId: B, name: null, nameStatus: 'missing', group: `tier:${TIER}`, usedTenths: 100, farOverAllowance: false }),
    ]);
    expect(credits.figures?.rows[1].tierLabel).toEqual(expect.any(String));
    expect(result.payload.tiles.k2).toMatchObject({ status: 'amber', value: { value: 1, exact: true }, headline: 'Accounts at or over the far-over-allowance line' });
    // AC-8: no lots → K-4 shows 0, grey, with its information line.
    expect(result.payload.tiles.k4).toMatchObject({ status: 'neutral', value: { value: 0, exact: true }, headline: K4_INFORMATION_HEADLINE });
    expect(credits.gifted?.outstanding).toBe(0);
    // R-b once, never the one-account read; Section 4's own names call.
    expect(deps.lots.allAccounts).toHaveBeenCalledTimes(1);
    expect(deps.lots.forAccount).not.toHaveBeenCalled();
    expect(deps.findNames).toHaveBeenCalledWith([A, B]);
    expect(result.counts).toMatchObject({ creditAccounts: 2, creditsPass: 'ok', creditPositions: { position: 2, no_allowance: 0, unknown: 0 }, creditLots: 0, creditRowsShown: 2 });
    // The pass's one info line: counts and timing only.
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', accounts: 2, position: 2 }), 'Admin credit positions pass served');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(String(ALLOWANCE_A * 2));
  });

  it('K-2 green "All clear" when every account is read and none is far over', async () => {
    const deps = makeDeps({ credits: creditDeps({ totals: [{ user_id: A, period_start: PERIOD, credits_total: '1' }] }) });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k2).toMatchObject({ status: 'green', value: { value: 0, exact: true } });
  });

  it('SA-WR-8: one account unreadable and none far over → K-2 amber "1 account could not be read", never green', async () => {
    const deps = makeDeps({ credits: creditDeps({ unavailable: [B], totals: [{ user_id: A, period_start: PERIOD, credits_total: '1' }] }) });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.credits.figures).toMatchObject({ unknownAccounts: 1, farOverAllowance: 0 });
    expect(result.payload.tiles.k2).toEqual({
      id: 'k2_far_over_allowance',
      status: 'amber',
      headline: '1 account could not be read',
      value: { value: 0, exact: false },
      previous: null,
    });
  });

  it('SA-WR-8: one account unreadable and one far over → K-2 amber from the rule', async () => {
    const { result } = await run(makeDeps({ credits: creditDeps({ unavailable: [B] }) }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k2).toMatchObject({ status: 'amber', headline: 'Accounts at or over the far-over-allowance line', value: { value: 1, exact: false } });
  });

  it.each([
    ['the totals read fails', { failTotals: true }, 'failed'],
    ['the totals read reaches its ceiling', { ceiling: true }, 'failed'],
  ])('AC-16: %s → Section 4 unknown, K-2 unavailable, K-4 still shows (SA-W12), the other sections ok', async (_n, opts, pass) => {
    const deps = makeDeps({
      credits: creditDeps(opts),
      lots: { allAccounts: jest.fn(() => ok([giftLot(A, 12.5)])), forAccount: jest.fn() },
    });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.credits).toMatchObject({ status: 'unknown', figures: null });
    expect(result.payload.tiles.k2).toMatchObject({ status: 'unavailable', value: null });
    expect(result.payload.tiles.k4).toMatchObject({ status: 'neutral', value: { value: 12.5, exact: true } });
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.aiCost.status).toBe('ok');
    expect(result.counts.creditsPass).toBe(pass);
  });

  it('AC-37 / SA-W11: the plan walk fails → Section 4 unknown, NO pass call, K-4 still shows', async () => {
    const deps = makeDeps({
      plans: { pagePlans: jest.fn(fail) },
      lots: { allAccounts: jest.fn(() => ok([giftLot(A, 3)])), forAccount: jest.fn() },
    });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.credits.status).toBe('unknown');
    expect(result.payload.tiles.k2.status).toBe('unavailable');
    expect(result.payload.tiles.k4.value).toEqual({ value: 3, exact: true });
    expect(deps.credits.getSnapshots).not.toHaveBeenCalled();
    expect(deps.credits.findPeriodAnchorsBatch).not.toHaveBeenCalled();
    expect(deps.credits.listTotalsForAccountsInRange).not.toHaveBeenCalled();
    expect(result.counts).toMatchObject({ creditsPass: 'skipped', creditAccounts: null, creditPositions: null });
  });

  it('SA-W11: the plan walk capped at 20,000 → Section 4 unknown, NO pass call, K-4 still shows', async () => {
    let page = 0;
    const pagePlans = jest.fn(() => {
      page += 1;
      return ok(Array.from({ length: 500 }, (_, i) => plan(`${String(page).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`)));
    });
    const deps = makeDeps({ plans: { pagePlans } });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.accounts.status).toBe('partial');
    expect(result.payload.credits.status).toBe('unknown');
    expect(result.payload.tiles.k2.status).toBe('unavailable');
    expect(result.payload.tiles.k4.status).toBe('neutral');
    expect(deps.credits.getSnapshots).not.toHaveBeenCalled();
    expect(result.counts.creditsPass).toBe('skipped');
  });

  it('AC-38: the lots read fails → gifted column, window and K-4 unknown; the table and K-2 render', async () => {
    const deps = makeDeps({ lots: { allAccounts: jest.fn(fail), forAccount: jest.fn() } });
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.credits.status).toBe('ok');
    expect(result.payload.credits.gifted).toBeNull();
    expect(result.payload.credits.figures?.rows.map((r) => r.giftedOutstanding)).toEqual([null, null]);
    expect(result.payload.tiles.k4).toMatchObject({ status: 'unavailable', value: null });
    expect(result.payload.tiles.k2.status).toBe('amber');
    expect(result.counts.creditLots).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'credit_lots' }), expect.any(String));
  });

  it('SA-W10: an invalid far-over line in data → K-2 unavailable with the rules-invalid headline, logged at error', async () => {
    const { result, log } = await run(makeDeps({ metricParams: { farOverAllowancePercent: 99 } }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k2).toMatchObject({ status: 'unavailable', headline: FINANCE_RULES_INVALID_HEADLINE, value: null });
    expect(result.payload.credits.farOverAllowancePercent).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'rules', tile: 'k2_far_over_allowance' }), expect.any(String));
  });

  it('SA-W10: the line as data — at 120 a 130% account becomes far over, with no code change', async () => {
    const totals = [{ user_id: A, period_start: PERIOD, credits_total: String(ALLOWANCE_A * 1.3) }];
    const at150 = await run(makeDeps({ credits: creditDeps({ totals }) }));
    const at120 = await run(makeDeps({ credits: creditDeps({ totals }), metricParams: { farOverAllowancePercent: 120 } }));
    if (at150.result.kind !== 'ok' || at120.result.kind !== 'ok') throw new Error('expected ok');
    expect(at150.result.payload.tiles.k2.value).toEqual({ value: 0, exact: true });
    expect(at120.result.payload.tiles.k2.value).toEqual({ value: 1, exact: true });
  });

  it('SA-W9: a deleted account\u2019s lot is not in K-4; it is its own figure', async () => {
    const deps = makeDeps({ lots: { allAccounts: jest.fn(() => ok([giftLot(A, 4), giftLot(null, 30)])), forAccount: jest.fn() } });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k4.value).toEqual({ value: 4, exact: true });
    expect(result.payload.credits.gifted).toMatchObject({ outstanding: 4, deletedAccountsOutstanding: 30, window: { granted: 34, grants: 2, grantingAdmins: 1 } });
  });

  it('a platform account in the plan rows is labelled and never looked up by name (SA-WR-5)', async () => {
    const deps = makeDeps({ plans: { pagePlans: jest.fn(() => ok([plan(A), plan(PLATFORM)])) } });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.credits.figures?.rows.find((r) => r.accountId === PLATFORM)).toMatchObject({ nameStatus: 'platform', name: null });
    for (const [ids] of deps.findNames.mock.calls as unknown as Array<[string[]]>) expect(ids).not.toContain(PLATFORM);
  });

  it('names fail → Section 4 rows still show, "name unavailable"', async () => {
    const { result } = await run(makeDeps({ findNames: jest.fn(fail) }));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.credits.figures?.rows.every((r) => r.nameStatus === 'unavailable')).toBe(true);
  });
});

describe('AC-42 (slice 1b): with a business picked, every credit and lot read gets exactly that id', () => {
  it('positions pass, lots and names narrow to [A]; R-b gets ZERO calls', async () => {
    const deps = makeDeps({ lots: { allAccounts: jest.fn(() => ok([])), forAccount: jest.fn(() => ok([giftLot(A, 6)])) } });
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');

    expect(deps.lots.allAccounts).not.toHaveBeenCalled();
    expect(deps.plans.pagePlans).not.toHaveBeenCalled();
    expect(deps.lots.forAccount).toHaveBeenCalledTimes(1);
    expect(deps.lots.forAccount).toHaveBeenCalledWith(A);

    expect(deps.credits.getSnapshots).toHaveBeenCalledTimes(1);
    expect(deps.credits.getSnapshots).toHaveBeenCalledWith([A]);
    expect(deps.credits.findPeriodAnchorsBatch.mock.calls).toEqual([[[A]]]);
    expect(deps.credits.listTotalsForAccountsInRange.mock.calls.map((c) => c[0])).toEqual([[A]]);

    for (const [ids] of deps.findNames.mock.calls as unknown as Array<[string[]]>) expect(ids).toEqual([A]);

    expect(result.payload.credits).toMatchObject({ scope: 'one', status: 'ok', figures: { accounts: 1 } });
    expect(result.payload.credits.figures?.rows.map((r) => r.accountId)).toEqual([A]);
    expect(result.payload.tiles.k4.value).toEqual({ value: 6, exact: true });
    expect(result.payload.credits.gifted?.accountsNotListed).toBe(0);
  });

  it('a picked business with no plan row → 404 path, and no credit or lot read at all', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: null })) });
    const { result } = await run(deps, A);
    expect(result).toEqual({ kind: 'account_not_found' });
    expect(deps.credits.getSnapshots).not.toHaveBeenCalled();
    expect(deps.lots.forAccount).not.toHaveBeenCalled();
    expect(deps.lots.allAccounts).not.toHaveBeenCalled();
  });
});

describe('the wiring (SA-W13, SA-W14, SA-WR-10)', () => {
  const SECRET = 'SECRET-LOT-REASON-do-not-leak';
  const KEY = 'admin_grant:SECRET-KEY-do-not-leak';
  const lotRow = (accountId: string | null) => ({
    id: '44444444-4444-4444-8444-000000000001',
    accountId,
    source: 'admin_grant' as const,
    creditsGranted: 9,
    creditsBase: 9,
    creditsBonus: 0,
    creditValueVersion: 3,
    expiresAt: null,
    idempotencyKey: KEY,
    sourceRef: '66666666-6666-4666-8666-666666666666',
    actorKind: 'admin' as const,
    actorAdminId: ADMIN_X,
    reason: SECRET,
    createdAt: '2026-11-02T10:00:00.000Z',
    draws: [
      {
        id: '55555555-5555-4555-8555-000000000001',
        lotId: '44444444-4444-4444-8444-000000000001',
        accountId,
        kind: 'reversal' as const,
        credits: 2,
        reason: SECRET,
        actorAdminId: ADMIN_X,
        idempotencyKey: `admin_reversal:${SECRET}`,
        createdAt: '2026-11-03T10:00:00.000Z',
      },
    ],
  });

  it('SA-WR-10: the production credit reads are exactly adminCreditPercentDeps()\u2019s two, with NO getSnapshots (the real service)', () => {
    const wired = financeHealthDeps();
    expect(Object.keys(wired.credits).sort()).toEqual(Object.keys(adminCreditPercentDeps()).sort());
    expect(Object.keys(wired.credits).sort()).toEqual(['findPeriodAnchorsBatch', 'listTotalsForAccountsInRange']);
    expect(wired.credits).not.toHaveProperty('getSnapshots');
    expect(Object.keys(wired.lots).sort()).toEqual(['allAccounts', 'forAccount']);
  });

  it('SA-W14: toFinanceLot keeps exactly the narrow fields, field by field', () => {
    const lot = toFinanceLot(lotRow(A));
    expect(Object.keys(lot).sort()).toEqual(['accountId', 'actorAdminId', 'createdAt', 'creditsGranted', 'draws', 'expiresAt', 'id', 'source']);
    expect(Object.keys(lot.draws[0]).sort()).toEqual(['createdAt', 'credits', 'kind']);
    expect(JSON.stringify(lot)).not.toContain(SECRET);
    expect(JSON.stringify(lot)).not.toContain('SECRET-KEY');
  });

  it('SA-W14: a planted reason on a lot and a draw never reaches the payload or any log line (all businesses and one picked)', async () => {
    mockLotsAllAccounts.mockResolvedValue({ data: [lotRow(A), lotRow(null)], error: null });
    mockLotsForAccount.mockResolvedValue({ data: [lotRow(A)], error: null });
    const wired = financeHealthDeps();
    for (const accountId of [null, A]) {
      const log = logger();
      const { result } = await run(makeDeps({ lots: wired.lots }), accountId, log);
      if (result.kind !== 'ok') throw new Error('expected ok');
      // The lots really travelled: 9 granted − 2 taken back.
      expect(result.payload.tiles.k4.value).toEqual({ value: 7, exact: true });
      const everything = JSON.stringify([result, log.error.mock.calls, log.warn.mock.calls, log.info.mock.calls, Object.values(mockRepoLog).map((f) => f.mock.calls)]);
      expect(everything).not.toContain(SECRET);
      expect(everything).not.toContain('SECRET-KEY');
      expect(everything).not.toContain(ADMIN_X);
    }
    expect(mockLotsAllAccounts).toHaveBeenCalledTimes(1);
    expect(mockLotsAllAccounts).toHaveBeenCalledWith();
    expect(mockLotsForAccount).toHaveBeenCalledWith(A);
  });

  it('a failed lot read is passed on as an error, never as "no lots"', async () => {
    mockLotsAllAccounts.mockResolvedValue({ data: null, error: new Error('down') });
    const result = await financeHealthDeps().lots.allAccounts();
    expect(result).toEqual({ data: null, error: expect.any(Error) });
  });
});

// ── Slice 2a: Section 2 block B, takings ─────────────────────────────────────

/** A figure planted on a payment: it must never reach a log line (AC-69). */
const PLANTED_AMOUNT = '9876.54';
let clientSeq = 0;
function clientPayment(user_id: string, amount: string, currency: string, extra: Partial<FinanceClientPaymentRow> = {}): FinanceClientPaymentRow {
  clientSeq += 1;
  return {
    id: `cccccccc-0000-4000-8000-${String(clientSeq).padStart(12, '0')}`,
    user_id,
    amount,
    currency,
    status: 'succeeded',
    paid_at: '2026-11-03T10:00:00+00:00',
    processor_fee: null,
    fee_currency: null,
    processor_type: 'stripe',
    ...extra,
  };
}
function clientRefund(user_id: string, amount: string, currency: string): FinanceClientRefundRow {
  clientSeq += 1;
  return {
    id: `dddddddd-0000-4000-8000-${String(clientSeq).padStart(12, '0')}`,
    user_id,
    amount,
    currency,
    status: 'succeeded',
    created_at: '2026-11-04T10:00:00+00:00',
  };
}
function takingsDeps() {
  const deps = makeDeps();
  deps.finance.listClientPaymentsAllAccountsPaidInRange.mockImplementation(() =>
    ok({
      rows: [
        clientPayment(A, PLANTED_AMOUNT, 'usd', { processor_fee: '1.10', fee_currency: 'USD' }),
        clientPayment(B, '200.00', 'ILS', { processor_type: 'manual' }),
        clientPayment(PLATFORM, '5.00', 'USD'),
      ],
      reachedCeiling: false,
    })
  );
  deps.finance.listClientRefundsAllAccountsCreatedInRange.mockImplementation(() =>
    ok({ rows: [clientRefund(A, '76.54', 'USD')], reachedCeiling: false })
  );
  deps.finance.listClientPaymentsForAccountPaidInRange.mockImplementation(() =>
    ok({ rows: [clientPayment(A, PLANTED_AMOUNT, 'USD')], reachedCeiling: false })
  );
  deps.finance.listClientRefundsForAccountCreatedInRange.mockImplementation(() =>
    ok({ rows: [clientRefund(A, '76.54', 'USD')], reachedCeiling: false })
  );
  return deps;
}

describe('takings, all businesses (slice 2a)', () => {
  it('reads R-e and R-f over the selected window, builds per-currency lines, and names only the non-platform rows shown', async () => {
    const { result, deps } = await run(takingsDeps());
    if (result.kind !== 'ok') throw new Error('expected ok');
    const range = { from: WINDOW.start, to: WINDOW.end };
    expect(deps.finance.listClientPaymentsAllAccountsPaidInRange.mock.calls).toEqual([[range]]);
    expect(deps.finance.listClientRefundsAllAccountsCreatedInRange.mock.calls).toEqual([[range]]);
    expect(deps.finance.listClientPaymentsForAccountPaidInRange).not.toHaveBeenCalled();
    expect(deps.finance.listClientRefundsForAccountCreatedInRange).not.toHaveBeenCalled();

    const t = result.payload.takings;
    expect(t.status).toBe('ok');
    expect(t.scope).toBe('all');
    expect(t.figures?.lines).toEqual([
      { currency: 'ILS', payments: 1, gross: 200, refunded: 0, net: 200, businesses: 1, unreadable: 0, unreadablePayments: 0 },
      { currency: 'USD', payments: 2, gross: 9881.54, refunded: 76.54, net: 9805, businesses: 2, unreadable: 0, unreadablePayments: 0 },
    ]);
    expect(t.figures?.feeLines).toEqual([{ currency: 'USD', fees: 1.1, payments: 1 }]);
    expect(t.figures?.rows).toEqual([
      { accountId: B, currency: 'ILS', payments: 1, gross: 200, refunded: 0, net: 200, name: null, nameStatus: 'missing', unreadablePayments: 0 },
      { accountId: A, currency: 'USD', payments: 1, gross: 9876.54, refunded: 76.54, net: 9800, name: 'Acme Dental', nameStatus: 'found', unreadablePayments: 0 },
      { accountId: PLATFORM, currency: 'USD', payments: 1, gross: 5, refunded: 0, net: 5, name: null, nameStatus: 'platform', unreadablePayments: 0 },
    ]);
    // Never for the platform account; ids only from the rows read.
    // The takings call: the shown rows' order (ILS row first), the platform row left out.
    expect(deps.findNames).toHaveBeenCalledWith([B, A]);
    for (const [ids] of deps.findNames.mock.calls) expect(ids).not.toContain(PLATFORM);

    expect(result.counts.takings).toEqual({
      payments: 3,
      refunds: 1,
      paymentsCeiling: false,
      refundsCeiling: false,
      otherStatusPayments: 0,
      refundsNotCompleted: 0,
      unreadableAmounts: 0,
      unreadableFees: 0,
      currencies: 2,
      rowsShown: 3,
      rowsTotal: 3,
      namesFound: 1,
    });
    // Counts only: no amount, no currency code, no name.
    const counts = JSON.stringify(result.counts);
    expect(counts).not.toContain(PLANTED_AMOUNT);
    expect(counts).not.toMatch(/USD|ILS|Acme/);
  });

  it('no takings rows → empty, ok; no names call for takings', async () => {
    const { result } = await run();
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.takings).toMatchObject({ status: 'ok', figures: { empty: true, lines: [], rows: [] } });
    expect(result.counts.takings).toMatchObject({ payments: 0, refunds: 0, rowsShown: 0, namesFound: 0 });
  });

  it('the payments read at its ceiling → takings partial; every other section unchanged', async () => {
    const deps = takingsDeps();
    deps.finance.listClientPaymentsAllAccountsPaidInRange.mockImplementation(() =>
      ok({ rows: [clientPayment(A, '1.00', 'USD')], reachedCeiling: true })
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.takings.status).toBe('partial');
    expect(result.payload.takings.figures?.lines[0].net).toBeNull();
    expect(result.counts.takings.paymentsCeiling).toBe(true);
    expect(result.payload.aiCost.status).toBe('ok');
  });

  it('names fail → the rows still show, "unavailable"; the block stays ok', async () => {
    const deps = takingsDeps();
    deps.findNames.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.takings.status).toBe('ok');
    expect(result.payload.takings.figures?.rows.map((r) => r.nameStatus)).toEqual(['unavailable', 'unavailable', 'platform']);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'takings_names' }), 'Finance read failed');
  });
});

describe('AC-66 (2a): a failed takings read stays in its block', () => {
  it('R-e fails → takings unknown with no figures; every slice-1 section still renders', async () => {
    const deps = takingsDeps();
    deps.finance.listClientPaymentsAllAccountsPaidInRange.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.takings).toEqual({ status: 'unknown', scope: 'all', figures: null });
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.aiCost.status).toBe('ok');
    expect(result.payload.credits.status).toBe('ok');
    expect(result.payload.revenue.status).toBe('ok');
    expect(result.counts.takings).toMatchObject({ payments: null, rowsShown: 0 });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'client_payments' }), 'Finance read failed');
  });

  it('R-e THROWS → the same unknown block, never a throw out of the builder', async () => {
    const deps = takingsDeps();
    deps.finance.listClientPaymentsAllAccountsPaidInRange.mockImplementation(() => {
      throw new Error('exploded');
    });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.takings.status).toBe('unknown');
  });

  it('R-f fails → refunded and net Unknown, gross shown, partial', async () => {
    const deps = takingsDeps();
    deps.finance.listClientRefundsAllAccountsCreatedInRange.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const t = result.payload.takings;
    expect(t.status).toBe('partial');
    expect(t.figures?.refundsState).toBe('unknown');
    expect(t.figures?.lines.find((l) => l.currency === 'USD')).toMatchObject({ gross: 9881.54, refunded: null, net: null });
    expect(result.counts.takings.refunds).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'client_refunds' }), 'Finance read failed');
  });
});

describe('AC-65 (2a): with a business picked, R-e′ and R-f′ get exactly the id; R-e and R-f are never called', () => {
  it('exactly the id and the window range; zero all-accounts calls; names at most [id]; scope one; businesses 1', async () => {
    const deps = takingsDeps();
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const range = { from: WINDOW.start, to: WINDOW.end };
    expect(deps.finance.listClientPaymentsForAccountPaidInRange.mock.calls).toEqual([[A, range]]);
    expect(deps.finance.listClientRefundsForAccountCreatedInRange.mock.calls).toEqual([[A, range]]);
    expect(deps.finance.listClientPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(deps.finance.listClientRefundsAllAccountsCreatedInRange).not.toHaveBeenCalled();
    for (const [ids] of deps.findNames.mock.calls) expect(ids).toEqual([A]);
    const t = result.payload.takings;
    expect(t.scope).toBe('one');
    expect(t.figures?.businesses).toBe(1);
    expect(t.figures?.rows.map((r) => r.accountId)).toEqual([A]);
  });

  it('a picked business with no takings → businesses 0, empty', async () => {
    const deps = makeDeps();
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.takings.figures).toMatchObject({ businesses: 0, empty: true });
    expect(deps.finance.listClientPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
  });
});

describe('the wiring (slices 2a and 2b)', () => {
  it('exposes exactly the twenty-one finance reads: the four of 2a, the six of 2b, the two of 4a, the two of 5a and the four of 4b.2 included', () => {
    expect(Object.keys(financeHealthDeps().finance).sort()).toEqual([
      'countRevenueRows',
      'findBillingStatusForAccount',
      'listBillingStatusesAllAccounts',
      'listBoostPurchasesAllAccountsPaidInRange',
      'listBoostPurchasesForAccountPaidInRange',
      'listBoostPurchasesNeedingAttentionAllAccounts',
      'listBoostPurchasesNeedingAttentionForAccount',
      'listBoostReversalEventsAllAccountsRecordedInRange',
      'listBoostReversalEventsForAccountRecordedInRange',
      'listClientPaymentsAllAccountsPaidInRange',
      'listClientPaymentsForAccountPaidInRange',
      'listClientPlansAllAccounts',
      'listClientPlansForAccount',
      'listClientRefundsAllAccountsCreatedInRange',
      'listClientRefundsForAccountCreatedInRange',
      'listOverdueClientInstalmentsAllAccounts',
      'listOverdueClientInstalmentsForAccount',
      'listOverdueClientInvoicesAllAccounts',
      'listOverdueClientInvoicesForAccount',
      'listPlanPaymentsAllAccountsPaidInRange',
      'listPlanPaymentsForAccountPaidInRange',
    ]);
  });

  it('2b: wires neither the names read nor the reminder read: the route injects both', () => {
    const wired = financeHealthDeps() as Record<string, unknown>;
    expect(wired).not.toHaveProperty('findNames');
    expect(wired).not.toHaveProperty('readReminderFigures');
  });
});

// ── Slice 2b: client payment problems through the builder ────────────────────

const DUE_AMOUNT = '123.45';
const TODAY_2B = '2026-11-09';
function dueRow(user_id: string | null, extra: Partial<FinanceClientDueRow> = {}): FinanceClientDueRow {
  seq += 1;
  return {
    id: `dddddddd-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id,
    amount: DUE_AMOUNT,
    currency: 'USD',
    status: 'overdue',
    due_date: '2026-10-01',
    ...extra,
  };
}
function clientPlan(extra: Partial<FinanceClientPlanRow> = {}): FinanceClientPlanRow {
  seq += 1;
  return {
    id: `eeeeeeee-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: A,
    status: 'active',
    cancelled_at: null,
    completed_at: null,
    next_charge_at: '2026-12-01T00:00:00Z',
    last_failure_at: null,
    ...extra,
  };
}

/** Overdue invoices for A and the platform, an instalment for B, plans for A. */
function problemsDeps() {
  const deps = makeDeps();
  const invoices = { rows: [dueRow(A), dueRow(PLATFORM, { status: 'sent', due_date: '2026-11-01', currency: 'ILS', amount: '10.00' })], reachedCeiling: false };
  const instalments = { rows: [dueRow(B, { status: 'pending', due_date: '2026-11-05', currency: 'ILS', amount: '25.50' })], reachedCeiling: false };
  const plans = {
    rows: [
      clientPlan(),
      clientPlan({ status: 'cancelled', cancelled_at: '2026-11-03T10:00:00Z' }),
      clientPlan({ status: 'cancelled', cancelled_at: '2026-10-20T10:00:00Z' }),
    ],
    reachedCeiling: false,
  };
  deps.finance.listOverdueClientInvoicesAllAccounts.mockImplementation(() => ok(invoices));
  deps.finance.listOverdueClientInvoicesForAccount.mockImplementation(() => ok({ rows: [invoices.rows[0]], reachedCeiling: false }));
  deps.finance.listOverdueClientInstalmentsAllAccounts.mockImplementation(() => ok(instalments));
  deps.finance.listOverdueClientInstalmentsForAccount.mockImplementation(() => ok({ rows: [], reachedCeiling: false }));
  deps.finance.listClientPlansAllAccounts.mockImplementation(() => ok(plans));
  deps.finance.listClientPlansForAccount.mockImplementation(() => ok(plans));
  return deps;
}

describe('client payment problems, all businesses (slice 2b)', () => {
  it('reads R-g / R-h with today’s UTC date, R-i with no argument, R-j once with the clock and a signal; builds every part', async () => {
    const { result, deps } = await run(problemsDeps());
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(deps.finance.listOverdueClientInvoicesAllAccounts.mock.calls).toEqual([[TODAY_2B]]);
    expect(deps.finance.listOverdueClientInstalmentsAllAccounts.mock.calls).toEqual([[TODAY_2B]]);
    expect(deps.finance.listClientPlansAllAccounts.mock.calls).toEqual([[]]);
    expect(deps.readReminderFigures).toHaveBeenCalledTimes(1);
    const [clock, signal] = deps.readReminderFigures.mock.calls[0];
    expect(clock).toBe(NOW);
    expect(signal).toBeInstanceOf(AbortSignal);
    for (const fn of [
      deps.finance.listOverdueClientInvoicesForAccount,
      deps.finance.listOverdueClientInstalmentsForAccount,
      deps.finance.listClientPlansForAccount,
    ]) expect(fn).not.toHaveBeenCalled();

    const p = result.payload.paymentProblems;
    expect(p.status).toBe('ok');
    expect(p.scope).toBe('all');
    expect(p.today).toBe(TODAY_2B);
    expect(p.failedPayments).toEqual({ state: 'not_stored' });
    expect(p.overdueInvoices.status).toBe('ok');
    expect(p.overdueInvoices.figures?.lines).toEqual([
      { currency: 'ILS', marked: 0, pastDue: 1, amount: 10, amountExact: true, unreadable: 0, businesses: 1, oldestDueDate: '2026-11-01' },
      { currency: 'USD', marked: 1, pastDue: 0, amount: 123.45, amountExact: true, unreadable: 0, businesses: 1, oldestDueDate: '2026-10-01' },
    ]);
    expect(p.overdueInvoices.figures?.rows).toEqual([
      expect.objectContaining({ accountId: A, name: 'Acme Dental', nameStatus: 'found', dueDate: '2026-10-01', daysPastDue: 39, kind: 'marked' }),
      expect.objectContaining({ accountId: PLATFORM, name: null, nameStatus: 'platform', dueDate: '2026-11-01', kind: 'past_due' }),
    ]);
    expect(p.overdueInstalments.figures?.rows).toEqual([
      expect.objectContaining({ accountId: B, name: null, nameStatus: 'missing', dueDate: '2026-11-05', daysPastDue: 4, kind: 'past_due' }),
    ]);
    expect(p.clientPlans.figures).toMatchObject({ activeNow: 1, cancelledInWindow: 1, total: 3 });
    expect(p.reminders).toEqual({
      status: 'ok',
      state: 'read',
      figures: { dueNow: 2, inProgress: 0, stuck: 0, failed24h: 1, failed7d: 3, deadLettered24h: 0, deadLettered7d: 0, oldestDueAt: '2026-11-09T08:00:00.000Z' },
    });
  });

  it('SA-W38: ONE names call for both tables, ids only from the rows shown, never the platform account', async () => {
    const without = await run(makeDeps());
    const withRows = await run(problemsDeps());
    expect(withRows.deps.findNames.mock.calls.length).toBe(without.deps.findNames.mock.calls.length + 1);
    expect(withRows.deps.findNames.mock.calls[withRows.deps.findNames.mock.calls.length - 1]).toEqual([[A, B]]);
  });

  it('the counts: rows, ceilings, state words and timing; no amount, currency, due date or name', async () => {
    const { result } = await run(problemsDeps());
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.counts.paymentProblems).toEqual({
      invoices: 2,
      instalments: 1,
      plans: 3,
      invoicesCeiling: false,
      instalmentsCeiling: false,
      plansCeiling: false,
      unreadableAmounts: 0,
      unexpectedRows: 0,
      overdueRowsShown: 3,
      reminders: 'read',
      reminderMs: expect.any(Number),
      namesFound: 1,
    });
    const counts = JSON.stringify(result.counts.paymentProblems);
    for (const secret of [DUE_AMOUNT, '25.5', 'USD', 'ILS', '2026-10-01', 'Acme Dental', A]) expect(counts).not.toContain(secret);
  });

  it('AC-56: switching the window leaves the overdue figures and active-now unchanged; AC-59: cancelled follows the window', async () => {
    const month = await run(problemsDeps());
    const week = await run(problemsDeps(), null, logger(), NOW, resolveFinanceWindow({ preset: '7d' }, NOW));
    const custom = await run(problemsDeps(), null, logger(), NOW, resolveFinanceWindow({ preset: 'custom', from: '2026-10-15', to: '2026-11-09' }, NOW));
    if (month.result.kind !== 'ok' || week.result.kind !== 'ok' || custom.result.kind !== 'ok') throw new Error('expected ok');
    const m = month.result.payload.paymentProblems;
    // Each run seeds fresh row ids; everything else must be identical.
    const withoutIds = (part: typeof m.overdueInvoices) => ({
      ...part,
      figures: part.figures && { ...part.figures, rows: part.figures.rows.map((row) => ({ ...row, id: 'x' })) },
    });
    for (const other of [week.result.payload.paymentProblems, custom.result.payload.paymentProblems]) {
      expect(withoutIds(other.overdueInvoices)).toEqual(withoutIds(m.overdueInvoices));
      expect(withoutIds(other.overdueInstalments)).toEqual(withoutIds(m.overdueInstalments));
      expect(other.clientPlans.figures?.activeNow).toBe(m.clientPlans.figures?.activeNow);
    }
    expect(m.clientPlans.figures?.cancelledInWindow).toBe(1);
    expect(week.result.payload.paymentProblems.clientPlans.figures?.cancelledInWindow).toBe(1);
    expect(custom.result.payload.paymentProblems.clientPlans.figures?.cancelledInWindow).toBe(2);
  });

  it('AC-57: R-g and R-h receive the UTC date of the request’s clock: 2026-09-30 at 23:59 UTC, 2026-10-01 at 00:01 UTC', async () => {
    for (const [iso, expected] of [
      ['2026-09-30T23:59:00.000Z', '2026-09-30'],
      ['2026-10-01T00:01:00.000Z', '2026-10-01'],
    ] as const) {
      const now = new Date(iso);
      const deps = makeDeps();
      deps.finance.listOverdueClientInstalmentsAllAccounts.mockImplementation(() =>
        ok({ rows: [dueRow(A, { status: 'pending', due_date: '2026-09-30' })], reachedCeiling: false })
      );
      const { result } = await run(deps, null, logger(), now, resolveFinanceWindow({ preset: 'this_month' }, now));
      if (result.kind !== 'ok') throw new Error('expected ok');
      expect(deps.finance.listOverdueClientInvoicesAllAccounts.mock.calls).toEqual([[expected]]);
      expect(deps.finance.listOverdueClientInstalmentsAllAccounts.mock.calls).toEqual([[expected]]);
      const total = result.payload.paymentProblems.overdueInstalments.figures?.total;
      expect(total).toBe(expected === '2026-09-30' ? 0 : 1);
    }
  });
});

describe('AC-65 (2b): with a business picked, R-g′, R-h′ and R-i′ get exactly the id; R-g, R-h, R-i and R-j are never called', () => {
  it('exactly the id (and today’s date); zero all-accounts calls; zero reminder calls; names at most [id]; the platform-wide note', async () => {
    const deps = problemsDeps();
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(deps.finance.listOverdueClientInvoicesForAccount.mock.calls).toEqual([[A, TODAY_2B]]);
    expect(deps.finance.listOverdueClientInstalmentsForAccount.mock.calls).toEqual([[A, TODAY_2B]]);
    expect(deps.finance.listClientPlansForAccount.mock.calls).toEqual([[A]]);
    for (const fn of [
      deps.finance.listOverdueClientInvoicesAllAccounts,
      deps.finance.listOverdueClientInstalmentsAllAccounts,
      deps.finance.listClientPlansAllAccounts,
      deps.readReminderFigures,
      deps.plans.pagePlans,
      deps.ledger.listRowsOfAllAccountsCreatedInRange,
      deps.finance.listBillingStatusesAllAccounts,
      deps.finance.listClientPaymentsAllAccountsPaidInRange,
      deps.finance.listClientRefundsAllAccountsCreatedInRange,
      deps.lots.allAccounts,
    ]) expect(fn).not.toHaveBeenCalled();
    for (const [ids] of deps.findNames.mock.calls) expect(ids).toEqual([A]);
    const p = result.payload.paymentProblems;
    expect(p.scope).toBe('one');
    expect(p.reminders).toEqual({ status: 'ok', state: 'not_narrowed', figures: null });
    expect(p.status).toBe('ok');
    expect(result.counts.paymentProblems).toMatchObject({ reminders: 'not_narrowed', reminderMs: null });
  });
});

describe('AC-66 (2b): each read failing alone fails only its part; the block is partial, never unknown', () => {
  const failing = [
    ['R-g', 'listOverdueClientInvoicesAllAccounts', 'overdueInvoices', 'client_overdue_invoices'],
    ['R-h', 'listOverdueClientInstalmentsAllAccounts', 'overdueInstalments', 'client_overdue_instalments'],
    ['R-i', 'listClientPlansAllAccounts', 'clientPlans', 'client_plans'],
  ] as const;

  it.each(failing)('%s fails → its part unknown, the others ok, every other section renders, logged by name', async (_n, method, part, readName) => {
    const deps = problemsDeps();
    (deps.finance[method] as jest.Mock).mockImplementation(fail);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const p = result.payload.paymentProblems;
    expect(p.status).toBe('partial');
    expect(p[part]).toEqual({ status: 'unknown', figures: null });
    for (const other of (['overdueInvoices', 'overdueInstalments', 'clientPlans'] as const).filter((x) => x !== part)) {
      expect(p[other].status).toBe('ok');
    }
    expect(p.reminders.state).toBe('read');
    expect(result.payload.accounts.status).toBe('ok');
    expect(result.payload.aiCost.status).toBe('ok');
    expect(result.payload.takings.status).toBe('ok');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: readName }), 'Finance read failed');
  });

  it('R-j errors → reminders failed (unknown), block partial, the other parts ok', async () => {
    const deps = problemsDeps();
    deps.readReminderFigures.mockImplementation(fail);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const p = result.payload.paymentProblems;
    expect(p.reminders).toEqual({ status: 'unknown', state: 'failed', figures: null });
    expect(p.status).toBe('partial');
    expect(p.overdueInvoices.status).toBe('ok');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'reminders' }), 'Finance read failed');
    expect(result.counts.paymentProblems.reminders).toBe('failed');
  });

  it('R-j throws → still a failed part, never a 500', async () => {
    const deps = problemsDeps();
    deps.readReminderFigures.mockImplementation(() => {
      throw new Error('exploded');
    });
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.paymentProblems.reminders.state).toBe('failed');
  });

  it('SA-W35: a malformed R-j result → failed, never a 0', async () => {
    const deps = problemsDeps();
    deps.readReminderFigures.mockImplementation(() => ok({ ...REMINDERS, stuck: -1 }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.paymentProblems.reminders).toEqual({ status: 'unknown', state: 'failed', figures: null });
  });

  it('the names read fails → "Name unavailable" on the overdue rows, the parts stay ok', async () => {
    const deps = problemsDeps();
    deps.findNames.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const rows = result.payload.paymentProblems.overdueInvoices.figures?.rows ?? [];
    expect(rows[0]).toMatchObject({ accountId: A, name: null, nameStatus: 'unavailable' });
    expect(rows[1]).toMatchObject({ accountId: PLATFORM, nameStatus: 'platform' });
    expect(result.payload.paymentProblems.overdueInvoices.status).toBe('ok');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'overdue_names' }), 'Finance read failed');
  });
});

describe('AC-67 / SA-WR-23: the reminder deadline', () => {
  it('is written 2 * 1000, equals 2000 and differs from the admin default deadline', () => {
    expect(FINANCE_LIMITS.REMINDER_DEADLINE_MS).toBe(2000);
    expect(FINANCE_LIMITS.REMINDER_DEADLINE_MS).not.toBe(ADMIN_READ_DEADLINE_MS);
    expect(FINANCE_LIMITS.OVERDUE_ROWS_SHOWN).toBe(50);
    const code = fs.readFileSync(path.join(process.cwd(), 'lib/business-os/finance/financeHealth.ts'), 'utf8');
    expect(code).toMatch(/REMINDER_DEADLINE_MS: 2 \* 1000,/);
  });

  describe('with fake timers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('a never-settling reader → still pending at 1,999 ms; at 2,000 ms "failed", and the signal it received is aborted', async () => {
      const deps = problemsDeps();
      let received: AbortSignal | null = null;
      deps.readReminderFigures.mockImplementation(((_now: Date, signal: AbortSignal) => {
        received = signal;
        return new Promise(() => undefined);
      }) as never);
      let settled = false;
      const pending = run(deps).then((r) => {
        settled = true;
        return r;
      });
      await jest.advanceTimersByTimeAsync(FINANCE_LIMITS.REMINDER_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      expect((received as AbortSignal | null)?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const { result } = await pending;
      expect(settled).toBe(true);
      if (result.kind !== 'ok') throw new Error('expected ok');
      expect(result.payload.paymentProblems.reminders).toEqual({ status: 'unknown', state: 'failed', figures: null });
      expect(result.payload.paymentProblems.overdueInvoices.status).toBe('ok');
      expect((received as AbortSignal | null)?.aborted).toBe(true);
    });

    it('the reminder read starts with the other reads, not after them (same Promise.all)', async () => {
      const deps = problemsDeps();
      const order: string[] = [];
      deps.readReminderFigures.mockImplementation((() => {
        order.push('reminders');
        return ok(REMINDERS);
      }) as never);
      deps.finance.listClientPlansAllAccounts.mockImplementation((() => {
        order.push('plans');
        return new Promise(() => undefined);
      }) as never);
      void run(deps);
      await jest.advanceTimersByTimeAsync(0);
      // The plans read never settles, yet the reminder read has already started beside it.
      expect(order).toEqual(['plans', 'reminders']);
    });
  });
});

// ── Slice 6a (Money M-3): the Accounts tab and the picked margin (T5) ───────

describe('slice 6a: account economics through the builder', () => {
  const TAB: FinanceAccountsTabQuery = { sort: 'ai_cost', group: null, show: 'all' };
  const runTab = (deps = makeDeps(), tab: FinanceAccountsTabQuery = TAB, log = logger()) => run(deps, null, log, NOW, WINDOW, tab);

  it('AC-145: without the tab, neither key exists, no extra names call, counts say not built', async () => {
    const without = await run(ownerDeps());
    const withTab = await runTab(ownerDeps());
    if (without.result.kind !== 'ok' || withTab.result.kind !== 'ok') throw new Error('expected ok');
    expect(without.result.payload).not.toHaveProperty('accountEconomics');
    expect(without.result.payload).not.toHaveProperty('accountMargin');
    expect(without.result.counts.accountEconomics).toEqual({ built: false });
    // The tab adds exactly ONE names call.
    expect(withTab.deps.findNames.mock.calls.length).toBe(without.deps.findNames.mock.calls.length + 1);
    // The Overview keys are the same, in the same order, with the tab key after them.
    expect(Object.keys(withTab.result.payload)).toEqual([...Object.keys(without.result.payload), 'accountEconomics']);
  });

  it('AC-142 / AC-134: the owner row (89.00 paid, cost 3) and the platform line; the cost equals Section 3', async () => {
    const { result, deps } = await runTab(ownerDeps());
    if (result.kind !== 'ok') throw new Error('expected ok');
    const tab = result.payload.accountEconomics;
    if (!tab) throw new Error('expected the tab');
    const owner = tab.rows.find((r) => r.accountId === A);
    expect(owner?.paid.lines).toEqual([{ currency: 'USD', afterTax: 89, exact: true, planAfterTax: 79, boostsAfterTax: 10 }]);
    expect(owner?.aiCost).toEqual({ kind: 'figure', costUsd: 3, exact: true });
    expect(owner?.margin).toEqual({ kind: 'figure', marginUsd: 86, noRevenue: false });
    expect(owner?.name).toBe('Acme Dental');
    expect(owner?.nameStatus).toBe('found');
    // The platform line's cost is Section 3's total; each row's cost is Section 3's per-account figure.
    expect(tab.platform.aiCost).toEqual({ kind: 'figure', costUsd: result.payload.aiCost.figures?.costUsd, exact: true });
    for (const top of result.payload.aiCost.figures?.topAccounts ?? []) {
      const row = tab.rows.find((r) => r.accountId === top.accountId);
      expect(row?.aiCost).toEqual({ kind: 'figure', costUsd: top.costUsd, exact: true });
    }
    // The platform account (on the ledger, no plan row) is labelled, never named; the deleted bucket is the Deleted row.
    expect(tab.rows.find((r) => r.accountId === PLATFORM)).toMatchObject({ kind: 'platform', nameStatus: 'platform', name: null });
    expect(tab.deleted?.aiCost).toEqual({ kind: 'figure', costUsd: 2, exact: true });
    // AC-143: ONE names call for the shown rows: at most 200 ids, taken from the rows read, no platform id.
    const lastIds = deps.findNames.mock.calls[deps.findNames.mock.calls.length - 1][0] as string[];
    expect(lastIds.length).toBeLessThanOrEqual(200);
    expect([...lastIds].sort()).toEqual([A, B].sort());
    expect(lastIds).not.toContain(PLATFORM);
    // "Paid us, total" on the Overview still reads 89 (tax included).
    expect(result.payload.revenue.totals).toEqual(
      expect.arrayContaining([expect.objectContaining({ currency: 'USD', total: 89 })])
    );
    expect(result.counts.accountEconomics).toEqual({
      built: true, status: 'ok', accounts: 3, matching: 3, shown: 3, deletedRow: true, noPlanRow: 1, namesFound: 1,
      sort: 'ai_cost', group: 'all', show: 'all',
    });
  });

  it('AC-142: the picked business gets accountMargin equal to its tab row, from R-a′ / R-k′ / R-m′ only', async () => {
    const tab = await runTab(ownerDeps());
    const picked = await run(ownerDeps(), A);
    if (tab.result.kind !== 'ok' || picked.result.kind !== 'ok') throw new Error('expected ok');
    // The picked ledger read holds only A's charge (cost 3), as the tab row's cost.
    const row = tab.result.payload.accountEconomics?.rows.find((r) => r.accountId === A);
    expect(picked.result.payload.accountMargin).toEqual({ paid: row?.paid, aiCost: row?.aiCost, margin: row?.margin, marginAfterFees: row?.marginAfterFees });
    expect(picked.result.payload).not.toHaveProperty('accountEconomics');
    expect(picked.result.counts.accountEconomics).toEqual({ built: false });
    expect(picked.deps.finance.listBoostPurchasesAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(picked.deps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(picked.deps.ledger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
  });

  // Slice 6b (FE-4, SA-Q81, SA-W-6b-9, E-73): the fee config is injected like metricParams.
  it('6b: production uses the default fee config; an injected one changes the fees; an invalid one is Unknown with one error line naming no value', async () => {
    const plain = await runTab(ownerDeps());
    if (plain.result.kind !== 'ok') throw new Error('expected ok');
    expect(plain.result.payload.accountEconomics?.feeEstimate).toEqual({ currency: 'USD', percent: 2.9, fixed: 0.3 });
    expect(plain.log.error).not.toHaveBeenCalledWith(expect.anything(), 'Finance Stripe fee estimate config is invalid');

    const injected = ownerDeps();
    Object.assign(injected, { feeEstimate: { USD: { percentBps: 350, fixedMinor: 25 } } });
    const other = await runTab(injected);
    if (other.result.kind !== 'ok') throw new Error('expected ok');
    expect(other.result.payload.accountEconomics?.feeEstimate).toEqual({ currency: 'USD', percent: 3.5, fixed: 0.25 });

    const broken = ownerDeps();
    Object.assign(broken, { feeEstimate: { USD: { percentBps: 1001, fixedMinor: 30 } } });
    const bad = await runTab(broken);
    if (bad.result.kind !== 'ok') throw new Error('expected ok');
    expect(bad.result.payload.accountEconomics?.feeEstimate).toBeNull();
    const row = bad.result.payload.accountEconomics?.rows.find((r) => r.accountId === A);
    expect(row?.marginAfterFees).toEqual({ kind: 'unknown' });
    expect(bad.result.payload.accountEconomics?.platform.marginAfterFees).toEqual({ kind: 'unknown' });
    expect(bad.log.error).toHaveBeenCalledWith({ read: 'fee_estimate' }, 'Finance Stripe fee estimate config is invalid');
    expect(bad.result.payload.accountEconomics?.status).toBe(plain.result.payload.accountEconomics?.status);
  });

  it('BD-15: a paying Founding Partner in its tier group carries the chip (the same set as Section 1’s note)', async () => {
    const deps = ownerDeps();
    deps.plans.pagePlans.mockImplementation(() => ok([plan(A), plan(B, { tier: TIER })]));
    const { result } = await runTab(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const b = result.payload.accountEconomics?.rows.find((r) => r.accountId === B);
    expect(b).toMatchObject({ group: `tier:${TIER}`, foundingPartner: true, tierLabel: tierLabelForGroup(config, `tier:${TIER}`) });
    const note = result.payload.accounts.figures?.groups.find((g) => g.key === `tier:${TIER}`)?.foundingPartners;
    expect(note).toBe(1);
  });

  it('the group filter is logged as its kind; the groups offered come from Section 1 with server labels', async () => {
    const { result } = await runTab(ownerDeps(), { sort: 'margin', group: `tier:${TIER}`, show: 'negative' });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.counts.accountEconomics).toMatchObject({ built: true, group: 'tier', sort: 'margin', show: 'negative' });
    expect(JSON.stringify(result.counts)).not.toContain(TIER);
    const options = result.payload.accountEconomics?.groupOptions ?? [];
    expect(options.map((o) => o.key)).toEqual(result.payload.accounts.figures?.groups.map((g) => g.key));
  });

  describe('AC-138: each read failing alone; the Overview always renders', () => {
    const overviewKeys = ['generatedAt', 'window', 'accountId', 'tiles', 'revenue', 'accounts', 'aiCost', 'credits', 'takings', 'paymentProblems'];
    type Deps = ReturnType<typeof makeDeps>;
    const cases: Array<[string, (d: Deps) => void, 'aiCost' | 'paid' | 'credits']> = [
      ['ledger', (d) => d.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() => fail()), 'aiCost'],
      ['boosts', (d) => d.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(() => fail()), 'paid'],
      ['plans', (d) => d.finance.listPlanPaymentsAllAccountsPaidInRange.mockImplementation(() => fail()), 'paid'],
      ['walk', (d) => d.plans.pagePlans.mockImplementation(() => fail()), 'credits'],
      [
        'positions',
        (d) => d.credits.listTotalsForAccountsInRange.mockImplementation(async () => ({ data: null, error: new Error('x') })),
        'credits',
      ],
    ];
    it.each(cases)('%s fails → Unknown in its column, the tab partial, every Overview section present', async (_name, breakIt, column) => {
      const deps = ownerDeps();
      breakIt(deps);
      const { result } = await runTab(deps);
      if (result.kind !== 'ok') throw new Error('expected ok');
      const tab = result.payload.accountEconomics;
      expect(tab?.status).toBe('partial');
      for (const key of overviewKeys) expect(result.payload).toHaveProperty(key);
      const owner = tab?.rows.find((r) => r.accountId === A);
      if (column === 'aiCost') expect(owner?.aiCost).toEqual({ kind: 'unknown' });
      if (column === 'paid') expect(owner?.paid.failed).toBe(true);
      if (column === 'credits') expect(owner?.credits).toEqual({ kind: 'unknown' });
    });

    it('all three money reads fail → the tab unknown', async () => {
      const deps = ownerDeps();
      deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() => fail());
      deps.finance.listBoostPurchasesAllAccountsPaidInRange.mockImplementation(() => fail());
      deps.finance.listPlanPaymentsAllAccountsPaidInRange.mockImplementation(() => fail());
      const { result } = await runTab(deps);
      if (result.kind !== 'ok') throw new Error('expected ok');
      expect(result.payload.accountEconomics?.status).toBe('unknown');
    });

    it('the names read fails → names "unavailable", logged as account_names, the figures stand', async () => {
      const deps = ownerDeps();
      const log = logger();
      const before = await runTab(ownerDeps());
      const earlierCalls = before.deps.findNames.mock.calls.length - 1;
      let call = 0;
      deps.findNames.mockImplementation((ids: readonly string[]) => {
        call += 1;
        // Fail only the tab's call, the last one.
        return call > earlierCalls ? fail() : ok(ids.filter((id) => id === A).map((id) => ({ user_id: id, company_name: 'Acme Dental' })));
      });
      const { result } = await runTab(deps, TAB, log);
      if (result.kind !== 'ok') throw new Error('expected ok');
      const owner = result.payload.accountEconomics?.rows.find((r) => r.accountId === A);
      expect(owner?.nameStatus).toBe('unavailable');
      expect(owner?.margin.kind).toBe('figure');
      expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'account_names' }), 'Finance read failed');
    });
  });

  it('AC-137: an injected ceiling on the ledger read → "At least" cost and an Unknown margin on every row', async () => {
    const deps = ownerDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() => ok({ rows: [charge(A, '3')], reachedCeiling: true }));
    const { result } = await runTab(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const tab = result.payload.accountEconomics;
    expect(tab?.rows.find((r) => r.accountId === A)?.aiCost).toEqual({ kind: 'figure', costUsd: 3, exact: false });
    for (const row of tab?.rows ?? []) expect(row.margin).toEqual({ kind: 'unknown' });
    expect(tab?.status).toBe('partial');
  });
});

// ── Money M-4 (OV-5, T5-B): the recorded AI cost through the builder ─────────
// A separate import and a pass-through spy on the pure builder (SA-WR-50), so
// the lines above stay unedited and every other test runs the real builder.
jest.mock('../recordedCost', () => {
  const actual = jest.requireActual('../recordedCost');
  return { ...actual, buildRecordedAiCost: jest.fn(actual.buildRecordedAiCost) };
});
import * as recordedCostModule from '../recordedCost';
import { COST_SCALE } from '@/lib/business-os/credits/creditReport';

describe('Money M-4: the recorded AI cost through the builder', () => {
  const builderSpy = jest.mocked(recordedCostModule.buildRecordedAiCost);
  const SPAN = { from: WINDOW.start, to: WINDOW.end };
  const okResult = (result: Awaited<ReturnType<typeof run>>['result']) => {
    if (result.kind !== 'ok') throw new Error('expected ok');
    return result;
  };

  it('SA-WR-49: RECORDED_DEADLINE_MS is written 2 * 1000 and equals 2000', () => {
    expect(FINANCE_LIMITS.RECORDED_DEADLINE_MS).toBe(2000);
    const code = fs.readFileSync(path.join(process.cwd(), 'lib/business-os/finance/financeHealth.ts'), 'utf8');
    expect(code).toMatch(/RECORDED_DEADLINE_MS: 2 \* 1000,/);
  });

  it('AC-157: all businesses → the all-accounts read ONCE, with the half-open window and a signal; the account read never', async () => {
    const { result, deps } = await run();
    expect(deps.readRecordedAllAccounts).toHaveBeenCalledTimes(1);
    const [span, signal] = deps.readRecordedAllAccounts.mock.calls[0];
    expect(span).toEqual(SPAN);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(deps.readRecordedForAccount).not.toHaveBeenCalled();
    // AC-154: 7.00 recorded against 6.50 charged less the 2.00 deleted bucket (R4-4) → 2.50.
    expect(okResult(result).payload.aiCost.recorded).toEqual({
      status: 'ok',
      recordedUsd: 7,
      recordedExact: true,
      aboveCharged: { state: 'figure', usd: 2.5 },
      chargedAboveUsd: null,
    });
    expect(okResult(result).payload.aiCost.figures?.costUsd).toBe(6.5);
  });

  it('AC-155 / AC-157 / SA-WR-50: a business picked → the account read ONCE with exactly that id; the all-accounts read never; charged = Section 3 account units, deleted 0', async () => {
    const { result, deps } = await run(makeDeps(), A);
    expect(deps.readRecordedAllAccounts).not.toHaveBeenCalled();
    expect(deps.readRecordedForAccount).toHaveBeenCalledTimes(1);
    expect(deps.readRecordedForAccount.mock.calls[0]).toEqual([A, SPAN]);
    expect(deps.readRecordedForAccount.mock.calls[0]).toHaveLength(2);
    const payload = okResult(result).payload;
    const input = builderSpy.mock.calls[builderSpy.mock.calls.length - 1][0];
    expect(input.charged).toEqual({ totalUnits: 3 * COST_SCALE, deletedUnits: 0, exact: true });
    expect(input.charged?.totalUnits).toBe(Math.round((payload.aiCost.figures?.costUsd ?? NaN) * COST_SCALE));
    expect(input.read).toMatchObject({ kind: 'account', reachedCeiling: false });
    expect(payload.aiCost.recorded?.aboveCharged).toEqual({ state: 'figure', usd: 0.5 });
    expect(payload.aiCost.recorded?.recordedUsd).toBe(3.5);
  });

  it('the picked id reaches no recorded read when the plan check says no such business (AC-157, tenant isolation)', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: null })) });
    const { result } = await run(deps, A);
    expect(result.kind).toBe('account_not_found');
    expect(deps.readRecordedForAccount).not.toHaveBeenCalled();
    expect(deps.readRecordedAllAccounts).not.toHaveBeenCalled();
  });

  it('AC-167: the Accounts tab → neither read is called, no `recorded` key, counts { built: false }', async () => {
    const { result, deps } = await run(makeDeps(), null, logger(), NOW, WINDOW, { sort: 'ai_cost', group: null, show: 'all' });
    expect(deps.readRecordedAllAccounts).not.toHaveBeenCalled();
    expect(deps.readRecordedForAccount).not.toHaveBeenCalled();
    const tabResult = okResult(result);
    expect(tabResult.payload.aiCost).not.toHaveProperty('recorded');
    expect(tabResult.counts.aiRecorded).toEqual({ built: false });
    expect(tabResult.payload.accountEconomics).toBeDefined();
  });

  it('M4-FR-9: the counts say which read ran and how; no amount', async () => {
    const { result } = await run();
    const counts = okResult(result).counts.aiRecorded;
    expect(counts).toMatchObject({ built: true, read: 'all_accounts', outcome: 'ok', rows: 2, completed: true, reachedCeiling: null, unreadable: 0 });
    expect(typeof (counts as { ms: unknown }).ms).toBe('number');
    expect(JSON.stringify(counts)).not.toMatch(/2\.5|6\.5|4\.5|"7"/);
    const picked = okResult((await run(makeDeps(), A)).result).counts.aiRecorded;
    expect(picked).toMatchObject({ built: true, read: 'account', outcome: 'ok', rows: 1, completed: null, reachedCeiling: false });
  });

  it('AC-160: a small injected result (completed false) → "At least" and Unknown; Section 3 figures deep-equal the plain run', async () => {
    const plain = okResult((await run()).result).payload.aiCost;
    const deps = makeDeps({ readRecordedAllAccounts: jest.fn(() => ok({ rows: [{ cost_usd: '1' }], completed: false })) });
    const capped = okResult((await run(deps)).result).payload.aiCost;
    expect(capped.recorded).toMatchObject({ status: 'partial', recordedUsd: 1, recordedExact: false, aboveCharged: { state: 'unknown', usd: null } });
    expect(capped.figures).toEqual(plain.figures);
    expect(capped.status).toBe(plain.status);
  });

  it('AC-160: one account at its ceiling → "At least" and Unknown', async () => {
    const deps = makeDeps({ readRecordedForAccount: jest.fn(() => ok({ rows: [{ cost_usd: '9' }], reachedCeiling: true })) });
    const recorded = okResult((await run(deps, A)).result).payload.aiCost.recorded;
    expect(recorded).toMatchObject({ status: 'partial', recordedExact: false, aboveCharged: { state: 'unknown' } });
  });

  it('AC-161: the ledger side not exact (its ceiling) → the difference Unknown, the recorded figure shown', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(() => ok({ rows: [charge(A, '3')], reachedCeiling: true }));
    const recorded = okResult((await run(deps)).result).payload.aiCost.recorded;
    expect(recorded).toMatchObject({ status: 'partial', recordedUsd: 7, recordedExact: true, aboveCharged: { state: 'unknown', usd: null } });
  });

  it('AC-161: the ledger read failed → Section 3 unknown, the recorded figure shown, the difference Unknown', async () => {
    const deps = makeDeps();
    deps.ledger.listRowsOfAllAccountsCreatedInRange.mockImplementation(fail);
    const aiCost = okResult((await run(deps)).result).payload.aiCost;
    expect(aiCost.status).toBe('unknown');
    expect(aiCost.figures).toBeNull();
    expect(aiCost.recorded).toMatchObject({ recordedUsd: 7, aboveCharged: { state: 'unknown' } });
  });

  const throwing = () => {
    throw new Error('recorded exploded');
  };
  it.each([
    ['returns { error }', fail],
    ['throws', throwing],
    ['returns no data', () => ok(null)],
  ])('AC-161: the recorded read %s → both Unknown; Section 3 and every other section unchanged; logged once by name', async (_name, impl) => {
    const plain = okResult((await run()).result).payload;
    const log = logger();
    const deps = makeDeps({ readRecordedAllAccounts: jest.fn(impl) });
    const { result } = await run(deps, null, log);
    const payload = okResult(result).payload;
    expect(payload.aiCost.recorded).toEqual({ status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null });
    const withoutRecorded = (section: typeof payload.aiCost) => ({ status: section.status, coverage: section.coverage, figures: section.figures });
    expect(withoutRecorded(payload.aiCost)).toEqual(withoutRecorded(plain.aiCost));
    for (const key of ['revenue', 'accounts', 'credits', 'takings', 'paymentProblems', 'tiles'] as const) expect(payload[key]).toEqual(plain[key]);
    const named = log.error.mock.calls.filter((c) => (c[0] as { read?: string }).read === 'recorded_ai_cost');
    expect(named).toHaveLength(1);
    expect(okResult(result).counts.aiRecorded).toMatchObject({ built: true, outcome: 'failed', rows: null });
  });

  it('AC-163: K-1, Section 3 and the picked AI margin are deep-equal with and without a big recorded fixture (never added)', async () => {
    const small = okResult((await run()).result).payload;
    const big = okResult((await run(makeDeps({ readRecordedAllAccounts: jest.fn(() => ok({ rows: [{ cost_usd: '1000' }], completed: true })) }))).result).payload;
    expect(big.tiles.k1).toEqual(small.tiles.k1);
    expect(big.aiCost.figures).toEqual(small.aiCost.figures);
    expect(big.aiCost.recorded?.recordedUsd).toBe(1000);
    const pickedSmall = okResult((await run(makeDeps(), A)).result).payload;
    const pickedBig = okResult((await run(makeDeps({ readRecordedForAccount: jest.fn(() => ok({ rows: [{ cost_usd: '1000' }], reachedCeiling: false })) }), A)).result).payload;
    expect(pickedBig.accountMargin).toEqual(pickedSmall.accountMargin);
    expect(pickedBig.tiles.k1).toEqual(pickedSmall.tiles.k1);
  });

  it('AC-159: a window that starts before the cut-over → "Not available", the recorded figure still shown', async () => {
    const window = resolveFinanceWindow({ preset: 'custom', from: '2026-09-15', to: '2026-10-14' }, NOW);
    const aiCost = okResult((await run(makeDeps(), null, logger(), NOW, window)).result).payload.aiCost;
    expect(aiCost.coverage).toBe('starts_before_cutover');
    expect(aiCost.recorded).toMatchObject({ recordedUsd: 7, aboveCharged: { state: 'not_available', usd: null } });
  });

  describe('M4-FR-8 / E-57: the deadline (fake timers)', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
    afterEach(() => jest.useRealTimers());
    const tick = () => new Promise((resolve) => setImmediate(resolve));

    it('all accounts: a never-settling read → pending at 1,999 ms; at 2,000 ms Unknown, its signal aborted, outcome "deadline"', async () => {
      let received: AbortSignal | null = null;
      const deps = makeDeps({
        readRecordedAllAccounts: jest.fn((_span: unknown, signal: AbortSignal) => {
          received = signal;
          return new Promise(() => undefined);
        }),
      });
      let settled = false;
      const pending = run(deps).then((r) => {
        settled = true;
        return r;
      });
      await jest.advanceTimersByTimeAsync(FINANCE_LIMITS.RECORDED_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      expect((received as AbortSignal | null)?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const result = okResult((await pending).result);
      expect(result.payload.aiCost.recorded?.status).toBe('unknown');
      expect(result.payload.aiCost.status).toBe('ok');
      expect((received as AbortSignal | null)?.aborted).toBe(true);
      expect(result.counts.aiRecorded).toMatchObject({ built: true, read: 'all_accounts', outcome: 'deadline' });
    });

    // Jest fails the running test on any unhandled rejection: a planted `void Promise.reject(…)` at the
    // end of this test made it fail with that error (run 2026-10-15, recorded in the workplan), so a
    // late rejection that escaped `underDeadline` / `settle` would fail it the same way.
    it('one account: raced only (no signal reaches it); a late REJECTION after the deadline is dropped with no unhandled rejection', async () => {
      let rejectLate: (err: Error) => void = () => undefined;
      const deps = makeDeps({
        readRecordedForAccount: jest.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectLate = reject;
            })
        ),
      });
      const pending = run(deps, A);
      await jest.advanceTimersByTimeAsync(FINANCE_LIMITS.RECORDED_DEADLINE_MS);
      const result = okResult((await pending).result);
      expect(deps.readRecordedForAccount.mock.calls[0]).toHaveLength(2);
      expect(result.payload.aiCost.recorded?.status).toBe('unknown');
      expect(result.counts.aiRecorded).toMatchObject({ built: true, read: 'account', outcome: 'deadline' });
      rejectLate(new Error('late failure'));
      await tick();
      await tick();
      expect(result.payload.aiCost.recorded?.status).toBe('unknown');
    });

    it('one account: a late RESULT after the deadline is never applied to the payload', async () => {
      let resolveLate: (value: unknown) => void = () => undefined;
      const deps = makeDeps({
        readRecordedForAccount: jest.fn(
          () =>
            new Promise((resolve) => {
              resolveLate = resolve;
            })
        ),
      });
      const pending = run(deps, A);
      await jest.advanceTimersByTimeAsync(FINANCE_LIMITS.RECORDED_DEADLINE_MS);
      const result = okResult((await pending).result);
      resolveLate({ data: { rows: [{ cost_usd: '3.5' }], reachedCeiling: false }, error: null });
      await tick();
      expect(result.payload.aiCost.recorded).toEqual({ status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null });
    });

    it('the recorded read starts with the other reads, not after them (same Promise.all)', async () => {
      const deps = makeDeps();
      const order: string[] = [];
      deps.readRecordedAllAccounts.mockImplementation((() => {
        order.push('recorded');
        return ok({ rows: [], completed: true });
      }) as never);
      deps.finance.listPlanPaymentsAllAccountsPaidInRange.mockImplementation((() => {
        order.push('plans');
        return new Promise(() => undefined);
      }) as never);
      void run(deps);
      await jest.advanceTimersByTimeAsync(0);
      expect(order).toEqual(['plans', 'recorded']);
    });
  });

  it('the wiring injects neither recorded read: the route binds both (SA-W104)', () => {
    const wired = financeHealthDeps() as Record<string, unknown>;
    expect(wired).not.toHaveProperty('readRecordedAllAccounts');
    expect(wired).not.toHaveProperty('readRecordedForAccount');
  });
});

// ── DF-6 (§11L): since it started, through the UNCHANGED builder (AC-263, AC-267, AC-268) ──
describe('DF-6: a since-start window through the builder', () => {
  const SINCE = resolveFinanceWindow({ preset: 'since_start' }, NOW);
  const picked = async (deps: ReturnType<typeof makeDeps>, window = SINCE) => {
    const { result } = await run(deps, A, logger(), NOW, window);
    if (result.kind !== 'ok') throw new Error('expected ok');
    return result;
  };

  it('every window-based read gets the since-start instants; coverage is after the cut-over; margins are figures', async () => {
    const deps = ownerDeps();
    const result = await picked(deps);
    const range = { from: SINCE.start, to: SINCE.end };
    expect(deps.finance.listBoostPurchasesForAccountPaidInRange).toHaveBeenCalledWith(A, range);
    expect(deps.finance.listPlanPaymentsForAccountPaidInRange).toHaveBeenCalledWith(A, range);
    expect(deps.ledger.listRowsForAccountCreatedInRange).toHaveBeenCalledWith(A, expect.objectContaining(range), expect.anything());
    expect(result.payload.window).toEqual({ preset: 'since_start', from: '2026-09-29', to: '2026-11-09', start: '2026-09-29T16:50:53.914Z', end: NOW.toISOString() });
    expect(result.payload.aiCost.coverage).toBe('after_cutover');
    expect(result.payload.accountMargin?.margin.kind).toBe('figure');
    expect(result.payload.accountMargin?.marginAfterFees.kind).toBe('figure');
  });

  it('AC-263: the ledger read at its ceiling → Section 3 "at least" (partial) and both margins Unknown, never 0', async () => {
    const deps = ownerDeps();
    deps.ledger.listRowsForAccountCreatedInRange.mockImplementation(() => ok({ rows: [charge(A, '3')], reachedCeiling: true }));
    const result = await picked(deps);
    expect(result.payload.aiCost.status).toBe('partial');
    expect(result.payload.accountMargin?.margin).toEqual({ kind: 'unknown' });
    expect(result.payload.accountMargin?.marginAfterFees).toEqual({ kind: 'unknown' });
  });

  it('AC-263: the recorded read at its ceiling → the recorded figure is not exact and "Recorded above charged" is Unknown', async () => {
    const deps = makeDeps({ readRecordedForAccount: jest.fn(() => ok({ rows: [{ cost_usd: '3.5' }], reachedCeiling: true })) });
    const recorded = (await picked(deps)).payload.aiCost.recorded;
    expect(recorded).toMatchObject({ recordedExact: false, aboveCharged: { state: 'unknown', usd: null } });
  });

  it('AC-267: K-1 to K-4 equal their This month values; K-5 follows the window', async () => {
    const since = await picked(ownerDeps());
    const month = await picked(ownerDeps(), WINDOW);
    for (const key of ['k1', 'k2', 'k3', 'k4'] as const) expect(since.payload.tiles[key]).toEqual(month.payload.tiles[key]);
    expect(since.payload.tiles.k5.id).toBe('k5_our_revenue');
  });

  it('AC-268: an ILS boost in the window → both margins "n/a, different currency"', async () => {
    const deps = boostDeps([boostRow(A), boostRow(A, { currency: 'ILS' })]);
    const margin = (await picked(deps)).payload.accountMargin;
    expect(margin?.margin).toEqual({ kind: 'other_currency' });
    expect(margin?.marginAfterFees).toEqual({ kind: 'other_currency' });
  });
});

// ── Slice 4b.2: the reversal events and the purchases needing attention (BD-17, FR-4B-1 to FR-4B-16) ──
describe('slice 4b.2: refunds by event date, held now, block A, the K-5 dispute rule', () => {
  let evSeq = 0;
  const evRow = (extra: Partial<FinanceBoostReversalRow> = {}): FinanceBoostReversalRow => {
    evSeq += 1;
    return {
      id: `dddddddd-0000-4000-8000-${String(evSeq).padStart(12, '0')}`,
      purchase_id: 'pppppppp-0000-4000-8000-000000000001',
      kind: 'refund',
      amount_minor: 400,
      currency: 'USD',
      recorded_at: '2026-11-06T10:00:00.000Z',
      purchase: { user_id: A, package_id: 'pkg-small', package_version: 1, amount_total_minor: 1000, amount_tax_minor: 0, paid: true },
      ...extra,
    };
  };
  const disputed = (extra: Partial<FinanceBoostAttentionRow> = {}): FinanceBoostAttentionRow => ({
    id: 'qqqqqqqq-0000-4000-8000-000000000001',
    user_id: A,
    status: 'disputed',
    currency: 'USD',
    amount_total_minor: 1000,
    amount_refunded_minor: 0,
    status_changed_at: '2026-11-04T00:00:00.000Z',
    disputeOpenedAt: '2026-11-04T00:00:00.000Z',
    ...extra,
  });
  const withAttention = (deps: ReturnType<typeof makeDeps>, rows: FinanceBoostAttentionRow[]) => {
    deps.finance.listBoostPurchasesNeedingAttentionAllAccounts.mockImplementation(() => ok({ rows, reachedCeiling: false, openedDates: 'read' as const }));
    deps.finance.listBoostPurchasesNeedingAttentionForAccount.mockImplementation(() => ok({ rows, reachedCeiling: false, openedDates: 'read' as const }));
    return deps;
  };

  it('AC-217: a refund recorded in the window lowers net and K-5 there; R-n gets the window', async () => {
    const deps = boostDeps();
    deps.finance.listBoostReversalEventsAllAccountsRecordedInRange.mockImplementation(() => ok({ rows: [evRow()], reachedCeiling: false }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.boosts.lines![0]).toMatchObject({ gross: 10, refunded: 4, net: 6 });
    expect(result.payload.tiles.k5.money).toEqual({ kind: 'one', currency: 'USD', net: 6 });
    expect(deps.finance.listBoostReversalEventsAllAccountsRecordedInRange.mock.calls).toEqual([[{ from: WINDOW.start, to: WINDOW.end }]]);
    expect(result.payload.credits.bought?.refundNotTakenBack).toBe(true);
  });

  it('AC-103 / AC-219: one open dispute → K-5 red "1 boost payment in dispute", value unchanged; held now shown, not in net', async () => {
    const { result } = await run(withAttention(boostDeps(), [disputed()]));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k5).toMatchObject({ status: 'red', headline: '1 boost payment in dispute', money: { kind: 'one', currency: 'USD', net: 10 } });
    expect(result.payload.revenue.boosts.heldNow).toEqual([{ currency: 'USD', disputes: 1, amount: 10 }]);
    expect(result.payload.revenue.boosts.lines![0].net).toBe(10);
    expect(result.payload.paymentProblems.boosts?.figures).toMatchObject({ openDisputes: 1, empty: false });
    expect(Object.keys(result.payload.tiles)).toHaveLength(5);
  });

  it('AC-103: the threshold is data: raising it to 2 keeps K-5 grey with no code change', async () => {
    const deps = withAttention(boostDeps(), [disputed()]);
    const rules = {
      ...FINANCE_RULES,
      k5_our_revenue: [{ ...FINANCE_RULES.k5_our_revenue[0], condition: { kind: 'atLeast', metric: 'boostOpenDisputes', value: 2 } }],
    };
    const { result } = await run({ ...deps, rules } as typeof deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k5.status).toBe('neutral');
  });

  it('AC-103: R-l failing → K-5 grey "Dispute check failed", its value unchanged; block A unknown, the others render', async () => {
    const deps = boostDeps();
    deps.finance.listBoostPurchasesNeedingAttentionAllAccounts.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', headline: 'Dispute check failed', money: { kind: 'one', currency: 'USD', net: 10 } });
    expect(result.payload.paymentProblems.boosts).toEqual({ status: 'unknown', figures: null });
    expect(result.payload.revenue.boosts.heldNow).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'boost_attention' }), 'Finance read failed');
  });

  it('AC-224 / §7: the events table absent → refunded, lost and net Unknown, partial, logged at warn not error; every other section renders', async () => {
    const deps = boostDeps();
    const absent = Object.assign(new Error('The boost reversal events table is not available'), { name: 'FinanceReadTableAbsentError' });
    deps.finance.listBoostReversalEventsAllAccountsRecordedInRange.mockImplementation(() => Promise.resolve({ data: null, error: absent }) as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.boosts.lines![0]).toMatchObject({ gross: 10, refunded: null, lost: null, net: null });
    expect(result.payload.revenue.boosts.events).toMatchObject({ state: 'not_available' });
    expect(result.payload.revenue.status).toBe('partial');
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ read: 'boost_reversal_events', reason: 'table_absent' }), expect.any(String));
    expect(log.error).not.toHaveBeenCalledWith(expect.objectContaining({ read: 'boost_reversal_events' }), expect.anything());
    for (const section of ['accounts', 'aiCost', 'credits', 'takings'] as const) expect(result.payload[section].status).toBe('ok');
  });

  it('AC-224: any other event read failure is an error log and the same Unknown figures', async () => {
    const deps = boostDeps();
    deps.finance.listBoostReversalEventsAllAccountsRecordedInRange.mockImplementation(fail as never);
    const { result, log } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.boosts.events).toMatchObject({ state: 'failed' });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'boost_reversal_events' }), 'Finance read failed');
  });

  it('AC-229: a business picked → R-n′ and R-l′ with exactly that id; R-n and R-l never called', async () => {
    const deps = boostDeps();
    await run(deps, A);
    expect(deps.finance.listBoostReversalEventsForAccountRecordedInRange.mock.calls).toEqual([[A, { from: WINDOW.start, to: WINDOW.end }]]);
    expect(deps.finance.listBoostPurchasesNeedingAttentionForAccount.mock.calls).toEqual([[A]]);
    expect(deps.finance.listBoostReversalEventsAllAccountsRecordedInRange).not.toHaveBeenCalled();
    expect(deps.finance.listBoostPurchasesNeedingAttentionAllAccounts).not.toHaveBeenCalled();
  });

  it('AC-226: the Accounts tab reads the same events as Our revenue', async () => {
    const deps = boostDeps();
    deps.finance.listBoostReversalEventsAllAccountsRecordedInRange.mockImplementation(() => ok({ rows: [evRow()], reachedCeiling: false }));
    const { result } = await run(deps, null, logger(), NOW, WINDOW, { sort: 'ai_cost', group: null, show: 'all' });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const row = result.payload.accountEconomics?.rows.find((r) => r.accountId === A);
    expect(row?.paid.lines[0].boostsAfterTax).toBe(6);
  });

  it('E-103: every new 4b.2 wire field is set on every built payload', async () => {
    for (const deps of [makeDeps(), boostDeps(), withAttention(boostDeps(), [disputed()])]) {
      for (const accountId of [null, A]) {
        const { result } = await run(deps, accountId);
        if (result.kind !== 'ok') throw new Error('expected ok');
        expect(result.payload.revenue.boosts).toHaveProperty('heldNow');
        expect(result.payload.revenue.boosts).toHaveProperty('events');
        expect(result.payload.paymentProblems.boosts).toBeDefined();
        expect(result.payload.credits).toHaveProperty('bought');
        for (const row of result.payload.credits.figures?.rows ?? []) expect(row).toHaveProperty('boughtOutstanding');
      }
    }
  });

  it('AC-230: the payload carries no Stripe id, mode or purchase id from the new reads', async () => {
    const deps = withAttention(boostDeps(), [disputed()]);
    deps.finance.listBoostReversalEventsAllAccountsRecordedInRange.mockImplementation(() => ok({ rows: [evRow()], reachedCeiling: false }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const text = JSON.stringify([result.payload, result.counts]);
    for (const secret of ['pppppppp', 'qqqqqqqq', 'dddddddd', 'livemode', 'stripe_']) expect(text).not.toContain(secret);
  });
});

// ── Money MK-5 (§5.1, Q-11; F-K4): paying accounts and the platform AI margin in the payload ──
describe('Money MK-5: paying (F-K5) and platformMargin (F-K4)', () => {
  it('all businesses: paying is the plan rows in the paying set over EVERY plan row (Q-11), ok', async () => {
    const { result } = await run();
    if (result.kind !== 'ok') throw new Error('expected ok');
    // Two plan rows (A, B); only B has a paying billing row.
    expect(result.payload.paying).toEqual({ scope: 'all', status: 'ok', paying: 1, accounts: 2 });
    expect(result.payload.accounts.figures?.total).toBe(2);
  });

  it('the paying read failed: unknown, never 0 of n', async () => {
    const deps = makeDeps();
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.paying).toEqual({ scope: 'all', status: 'unknown', paying: null, accounts: null });
  });

  it('the plan read failed: unknown', async () => {
    const deps = makeDeps();
    deps.plans.pagePlans.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.paying).toEqual({ scope: 'all', status: 'unknown', paying: null, accounts: null });
  });

  it('a business picked: whether it pays, from its own billing row', async () => {
    const notPaying = await run(makeDeps(), A);
    if (notPaying.result.kind !== 'ok') throw new Error('expected ok');
    expect(notPaying.result.payload.paying).toEqual({ scope: 'one', status: 'ok', paying: false });
    const deps = makeDeps();
    deps.findPlanForAccount.mockImplementation(() => ok({ plan: plan(B, { tier: TIER, cohort: null }) }));
    deps.finance.findBillingStatusForAccount.mockImplementation(
      () => ok({ user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null }) as never
    );
    const paying = await run(deps, B);
    if (paying.result.kind !== 'ok') throw new Error('expected ok');
    expect(paying.result.payload.paying).toEqual({ scope: 'one', status: 'ok', paying: true });
  });

  it('platformMargin: present for all businesses, absent with a business picked (F-K4 reads accountMargin then)', async () => {
    const all = await run();
    if (all.result.kind !== 'ok') throw new Error('expected ok');
    expect(all.result.payload.platformMargin).toEqual(expect.objectContaining({ margin: expect.any(Object), marginAfterFees: expect.any(Object) }));
    const one = await run(makeDeps(), A);
    if (one.result.kind !== 'ok') throw new Error('expected ok');
    expect(one.result.payload).not.toHaveProperty('platformMargin');
    expect(one.result.payload.accountMargin).toBeDefined();
  });

  it('platformMargin equals the Accounts tab platform line for the same reads (one function)', async () => {
    const overview = await run();
    const tab = await run(makeDeps(), null, logger(), NOW, WINDOW, { sort: 'ai_cost', group: null, show: 'all' });
    if (overview.result.kind !== 'ok' || tab.result.kind !== 'ok') throw new Error('expected ok');
    const line = tab.result.payload.accountEconomics?.platform;
    expect(line).toBeDefined();
    const { accountsCovered: _covered, includesDeleted: _deleted, ...lineMargin } = line!;
    expect(overview.result.payload.platformMargin).toEqual(lineMargin);
    expect(tab.result.payload.platformMargin).toEqual(lineMargin);
  });
});

// ── SA-CR-MK5 C-1 (§5.1): platform accounts are out of both counts ──
describe('Money MK-5 C-1: Paying % leaves platform accounts out of the numerator and the denominator', () => {
  it('a paying platform account with a plan row is in neither count (the existing isPlatformAccount rule)', async () => {
    const deps = makeDeps();
    deps.plans.pagePlans.mockImplementation(() => ok([plan(A), plan(B, { tier: TIER, cohort: null }), plan(PLATFORM, { tier: TIER, cohort: null })]) as never);
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(
      () =>
        ok<FinanceBillingStatusRow[]>([
          { user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null },
          { user_id: PLATFORM, subscription_status: 'active', ended_at: null, bought_tier: null },
        ]) as never
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.paying).toEqual({ scope: 'all', status: 'ok', paying: 1, accounts: 2 });
  });

  it('control: without the rule the platform row would count (the guard is not vacuous)', async () => {
    const deps = makeDeps({ isPlatformAccount: () => false });
    deps.plans.pagePlans.mockImplementation(() => ok([plan(A), plan(B, { tier: TIER, cohort: null }), plan(PLATFORM, { tier: TIER, cohort: null })]) as never);
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(
      () =>
        ok<FinanceBillingStatusRow[]>([
          { user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null },
          { user_id: PLATFORM, subscription_status: 'active', ended_at: null, bought_tier: null },
        ]) as never
    );
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.paying).toEqual({ scope: 'all', status: 'ok', paying: 2, accounts: 3 });
  });
});

// ── Money MK-5b (§5.1 F-K5b, SA-10): Converted this month through the builder ──
describe('Money MK-5b: converted (F-K5b) through the builder', () => {
  // NOW is 2026-11-09: "this month" is November 2026 in UTC, whatever the window.
  const NOV = { from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' };
  const C = '33333333-3333-4333-8333-333333333333';

  /** Plan rows A (not paying), B (paying), C (paying); first payments as given. */
  function convertedDeps(first: Array<{ accountId: string; paidAt: string }>, sources = [{ account_id: B, source: 'account_invite' as const, stamped_at: '2026-11-03T00:00:00.000Z' }]) {
    const deps = makeDeps();
    deps.plans.pagePlans.mockImplementation(
      () => ok([plan(A), plan(B, { tier: TIER, cohort: null }), plan(C, { tier: TIER, cohort: null }), plan(PLATFORM, { tier: TIER, cohort: null })]) as never
    );
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(
      () =>
        ok<FinanceBillingStatusRow[]>([
          { user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null },
          { user_id: C, subscription_status: 'active', ended_at: null, bought_tier: null },
        ]) as never
    );
    const converted = {
      firstPlanPayments: jest.fn<Result<Array<{ accountId: string; paidAt: string }>>, [readonly string[]]>(() => ok(first)),
      signupSources: jest.fn<Result<Array<{ account_id: string; source: 'admin_invite' | 'account_invite' | 'organic'; stamped_at: string | null }>>, [string[]]>(
        () => ok(sources)
      ),
    };
    return { ...deps, converted };
  }

  it('without the dep: no converted key and no counts entry (every earlier fixture unchanged)', async () => {
    const { result } = await run();
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload).not.toHaveProperty('converted');
    expect(result.counts).not.toHaveProperty('converted');
  });

  it('all businesses: asks for exactly the non-platform plan-row ids; counts the paying accounts that first paid this month', async () => {
    const deps = convertedDeps([
      { accountId: B, paidAt: '2026-11-03T10:00:00.000Z' },
      // C first paid last month: not converted this month (G-3: once only).
      { accountId: C, paidAt: '2026-10-20T10:00:00.000Z' },
    ]);
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(deps.converted.firstPlanPayments).toHaveBeenCalledTimes(1);
    expect([...(deps.converted.firstPlanPayments.mock.calls[0][0] as string[])].sort()).toEqual([A, B, C].sort());
    expect(result.payload.converted).toEqual({
      scope: 'all',
      status: 'ok',
      month: NOV,
      converted: 1,
      paying: 2,
      stopped: 0,
      rows: [
        {
          accountId: B,
          name: null,
          nameStatus: 'missing',
          group: `tier:${TIER}`,
          tierLabel: tierLabelForGroup(config, `tier:${TIER}`),
          firstPaymentAt: '2026-11-03T10:00:00.000Z',
          source: 'account_invite',
          sourceStatus: 'found',
          payingNow: true,
        },
      ],
      shownLimit: 100,
    });
    // Names and sources for the shown rows only.
    expect(deps.converted.signupSources).toHaveBeenCalledWith([B]);
    expect(result.counts.converted).toEqual({
      scope: 'all', status: 'ok', asked: 3, found: 2, converted: 1, stopped: 0, shown: 1, namesFound: 0, sourcesFound: 1, stampDiffers: 0,
    });
  });

  it('converted this month but no longer paying: listed as stopped, never counted', async () => {
    const deps = convertedDeps([{ accountId: A, paidAt: '2026-11-02T00:00:00.000Z' }], []);
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const c = result.payload.converted;
    if (c?.scope !== 'all') throw new Error('expected all');
    expect(c.converted).toBe(0);
    expect(c.stopped).toBe(1);
    expect(c.rows).toEqual([
      expect.objectContaining({ accountId: A, payingNow: false, name: 'Acme Dental', nameStatus: 'found', source: null, sourceStatus: 'missing' }),
    ]);
    // G-1 cross-check: A has no lineage stamp, so it differs (logged only).
    expect(result.counts.converted?.stampDiffers).toBe(1);
  });

  it('the first-payment read failed (the ceiling, the mode, the database): unknown, never 0', async () => {
    const deps = convertedDeps([]);
    deps.converted.firstPlanPayments.mockImplementation(() => ({ data: null, error: new Error('ceiling') }) as never);
    const { result, log } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.converted).toEqual({
      scope: 'all', status: 'unknown', month: NOV, converted: null, paying: null, stopped: null, rows: null, shownLimit: 100,
    });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'first_plan_payments' }), 'Finance read failed');
    expect(deps.converted.signupSources).not.toHaveBeenCalled();
  });

  it('the paying read or the plan read failed: unknown, and no first-payment read', async () => {
    const paying = convertedDeps([]);
    paying.finance.listBillingStatusesAllAccounts.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const a = await run(paying as never);
    if (a.result.kind !== 'ok') throw new Error('expected ok');
    expect(a.result.payload.converted).toEqual(expect.objectContaining({ status: 'unknown', converted: null }));
    expect(paying.converted.firstPlanPayments).not.toHaveBeenCalled();

    const plans = convertedDeps([]);
    plans.plans.pagePlans.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const b = await run(plans as never);
    if (b.result.kind !== 'ok') throw new Error('expected ok');
    expect(b.result.payload.converted).toEqual(expect.objectContaining({ status: 'unknown', converted: null }));
    expect(plans.converted.firstPlanPayments).not.toHaveBeenCalled();
  });

  it('the source read failed: the rows stay, each source "unavailable" (shown as Unknown)', async () => {
    const deps = convertedDeps([{ accountId: B, paidAt: '2026-11-03T10:00:00.000Z' }]);
    deps.converted.signupSources.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    const c = result.payload.converted;
    if (c?.scope !== 'all') throw new Error('expected all');
    expect(c.status).toBe('ok');
    expect(c.rows?.[0]).toEqual(expect.objectContaining({ source: null, sourceStatus: 'unavailable' }));
  });

  it('a capped plan walk: partial ("at least"), never a plain figure', async () => {
    let page = 0;
    const pagePlans = jest.fn(() => {
      page += 1;
      return ok(Array.from({ length: 500 }, (_, i) => plan(`${String(page).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`)));
    });
    const deps = { ...convertedDeps([]), plans: { pagePlans } };
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.converted).toEqual(expect.objectContaining({ scope: 'all', status: 'partial', converted: 0 }));
  });

  it('a business picked: exactly its id; converted, stopped, not converted, unknown', async () => {
    const picked = (first: Array<{ accountId: string; paidAt: string }>, paying: boolean) => {
      const deps = convertedDeps(first);
      deps.findPlanForAccount.mockImplementation(() => ok({ plan: plan(B, { tier: TIER, cohort: null }) }));
      deps.finance.findBillingStatusForAccount.mockImplementation(
        () => ok(paying ? { user_id: B, subscription_status: 'active', ended_at: null, bought_tier: null } : null) as never
      );
      return deps;
    };
    const yes = picked([{ accountId: B, paidAt: '2026-11-03T00:00:00.000Z' }], true);
    const r1 = await run(yes as never, B);
    if (r1.result.kind !== 'ok') throw new Error('expected ok');
    expect(yes.converted.firstPlanPayments).toHaveBeenCalledWith([B]);
    expect(yes.converted.signupSources).not.toHaveBeenCalled();
    expect(r1.result.payload.converted).toEqual({ scope: 'one', status: 'ok', month: NOV, state: 'converted', firstPaymentAt: '2026-11-03T00:00:00.000Z' });

    const stopped = await run(picked([{ accountId: B, paidAt: '2026-11-03T00:00:00.000Z' }], false) as never, B);
    if (stopped.result.kind !== 'ok') throw new Error('expected ok');
    expect(stopped.result.payload.converted).toEqual(expect.objectContaining({ state: 'stopped' }));

    const earlier = await run(picked([{ accountId: B, paidAt: '2026-10-03T00:00:00.000Z' }], true) as never, B);
    if (earlier.result.kind !== 'ok') throw new Error('expected ok');
    expect(earlier.result.payload.converted).toEqual(expect.objectContaining({ state: 'not_converted', firstPaymentAt: null }));

    const failing = picked([], true);
    failing.converted.firstPlanPayments.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const unknown = await run(failing as never, B);
    if (unknown.result.kind !== 'ok') throw new Error('expected ok');
    expect(unknown.result.payload.converted).toEqual({ scope: 'one', status: 'unknown', month: NOV, state: null, firstPaymentAt: null });
  });

  it('"this month" is the month of now in UTC, whatever window is picked', async () => {
    const deps = convertedDeps([{ accountId: B, paidAt: '2026-11-01T00:00:00.000Z' }]);
    const lastWeek = resolveFinanceWindow({ preset: '7d' }, NOW);
    const { result } = await run(deps as never, null, logger(), NOW, lastWeek);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.converted).toEqual(expect.objectContaining({ month: NOV, converted: 1 }));
  });

  it('the production wiring supplies the converted reads by name', () => {
    const wired = financeHealthDeps();
    expect(Object.keys(wired.converted ?? {}).sort()).toEqual(['firstPlanPayments', 'signupSources']);
  });
});

// ── Money MK-9 (SA-WP-MK9): F-K5's breakdown through the builder ──
describe('Money MK-9: payingBreakdown through the builder', () => {
  // NOW is 2026-11-09; the window is this month (2026-11-01 to 2026-11-10).
  const TRIAL = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'trial') as string;
  const C = '33333333-3333-4333-8333-333333333333';
  const D = '44444444-4444-4444-8444-444444444444';
  const trialPlan = (user: string, endsAt: string) =>
    plan(user, { cohort: TRIAL, tier: null, trial_started_at: '2026-10-20T00:00:00.000Z', trial_ends_at: endsAt });

  function breakdownDeps(firstPayments: Array<{ accountId: string; paidAt: string }> | 'fail' | 'absent' = []) {
    const deps = makeDeps();
    deps.plans.pagePlans.mockImplementation(
      () =>
        ok([
          plan(A, { tier: TIER, cohort: null, tier_expires_at: '2026-12-31T00:00:00.000Z' }), // comped: no billing row
          plan(B, { tier: TIER, cohort: null }), // paying (B is active in the default billing rows)
          trialPlan(C, '2026-11-03T00:00:00.000Z'), // ended in the window
          trialPlan(D, '2026-11-20T00:00:00.000Z'), // still running
          plan(PLATFORM, { cohort: TRIAL, trial_started_at: '2026-10-20T00:00:00.000Z', trial_ends_at: '2026-11-03T00:00:00.000Z' }), // never counted
        ]) as never
    );
    if (firstPayments === 'absent') return { deps, converted: undefined };
    const converted = {
      firstPlanPayments: jest.fn<Result<Array<{ accountId: string; paidAt: string }>>, [readonly string[]]>(() =>
        firstPayments === 'fail' ? ({ data: null, error: new Error('boom') } as never) : ok(firstPayments)
      ),
      signupSources: jest.fn(() => ok([])),
    };
    return { deps: { ...deps, converted }, converted };
  }

  it('all businesses: Comped split, trials ended / running, paid from the SAME first-payment read as Converted (one call)', async () => {
    const { deps, converted } = breakdownDeps([{ accountId: C, paidAt: '2026-11-01T00:00:00.000Z' }]);
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(converted?.firstPlanPayments).toHaveBeenCalledTimes(1);
    expect(result.payload.payingBreakdown).toEqual({
      comped: { total: 1, assignedNoSubscription: 1, endedOrNotPaying: 0 },
      trials: { status: 'ok', endedInWindow: 1, stillRunning: 1, paid: 1, paidBeforeEnd: 1, rate: null, minimumForRate: 10 },
    });
    expect(result.counts.payingBreakdown).toEqual({
      comped: 1, assignedNoSubscription: 1, endedOrNotPaying: 0, trialsStatus: 'ok', trialsEnded: 1, trialsPaid: 1, rateShown: false,
    });
  });

  it('failure path: the first-payment read fails → Paid Unknown (null), never 0; the comped split and trial counts intact', async () => {
    const { deps } = breakdownDeps('fail');
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.payingBreakdown?.trials).toEqual(
      expect.objectContaining({ status: 'ok', endedInWindow: 1, stillRunning: 1, paid: null, paidBeforeEnd: null, rate: null })
    );
    expect(result.payload.payingBreakdown?.comped).toEqual({ total: 1, assignedNoSubscription: 1, endedOrNotPaying: 0 });
  });

  it('without the first-payment wiring, Paid is Unknown too (never 0)', async () => {
    const { deps } = breakdownDeps('absent');
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.payingBreakdown?.trials.paid).toBeNull();
  });

  it('the paying read failed: Comped split null ("Could not check"); Paid Unknown (the first-payment read did not run)', async () => {
    const { deps, converted } = breakdownDeps([]);
    deps.finance.listBillingStatusesAllAccounts.mockImplementation(() => ({ data: null, error: new Error('boom') }) as never);
    const { result } = await run(deps as never);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.payingBreakdown?.comped).toBeNull();
    expect(result.payload.payingBreakdown?.trials.paid).toBeNull();
    expect(converted?.firstPlanPayments).not.toHaveBeenCalled();
  });

  it('a business picked: no breakdown key (one account is not a rate)', async () => {
    const { deps } = breakdownDeps([]);
    const { result } = await run(deps as never, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload).not.toHaveProperty('payingBreakdown');
    expect(result.counts).not.toHaveProperty('payingBreakdown');
  });
});
