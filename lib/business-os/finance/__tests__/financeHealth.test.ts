/**
 * The finance builder (slice 1a): section isolation (SA-Q8, AC-27, AC-37,
 * AC-39), the account scope (AC-26, AC-41, AC-42 / SA-WR-3), the override
 * strip (SA-WR-1), the revenue panel's branches (AC-22, AC-23), the cut-over
 * (AC-40) and the ceiling (AC-15).
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
      listLiveBillingStatusesAllAccounts: jest.fn(() =>
        ok([{ user_id: B, subscription_status: 'active', ended_at: null }])
      ),
      findLiveBillingStatusForAccount: jest.fn(() => ok(null)),
      countLiveRevenueRows: jest.fn(() => ok({ planInvoicesPaid: 0, boostsPaid: 0 })),
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
    },
    readReminderFigures: jest.fn<Result<FinanceReminderFiguresInput>, [Date, AbortSignal]>(() => ok(REMINDERS)),
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

async function run(deps = makeDeps(), accountId: string | null = null, log = logger(), now = NOW, window = WINDOW) {
  const result = await buildFinanceHealth({ window, accountId, now }, log, deps as unknown as FinanceHealthDeps);
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
    expect(p.revenue).toEqual({ status: 'ok', state: 'none_yet' });
    expect(p.tiles.k5).toMatchObject({ status: 'neutral', headline: 'None yet' });
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
    deps.finance.listLiveBillingStatusesAllAccounts.mockImplementation(fail);
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

describe('the revenue panel (S1-FR-25..27)', () => {
  it('AC-23: a live paid invoice → recorded, K-5 "Revenue recorded, not yet shown"', async () => {
    const deps = makeDeps();
    deps.finance.countLiveRevenueRows.mockImplementation(() => ok({ planInvoicesPaid: 1, boostsPaid: 0 }));
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue.state).toBe('recorded');
    expect(result.payload.tiles.k5).toMatchObject({ status: 'neutral', headline: 'Revenue recorded, not yet shown' });
  });

  it('AC-39: the check fails → panel unknown, K-5 unavailable "Could not check"', async () => {
    const deps = makeDeps();
    deps.finance.countLiveRevenueRows.mockImplementation(fail);
    const { result } = await run(deps);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.revenue).toEqual({ status: 'unknown', state: 'unknown' });
    expect(result.payload.tiles.k5).toMatchObject({ status: 'unavailable', headline: 'Could not check' });
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

describe('one business picked (SEC-3, AC-26, AC-41, AC-42 / SA-WR-3)', () => {
  it('checks the plan table first; no row → account_not_found, and nothing else is read', async () => {
    const deps = makeDeps({ findPlanForAccount: jest.fn(() => ok({ plan: null })) });
    const { result } = await run(deps, A);
    expect(result).toEqual({ kind: 'account_not_found' });
    expect(deps.ledger.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
    expect(deps.finance.countLiveRevenueRows).not.toHaveBeenCalled();
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
    expect(deps.finance.listLiveBillingStatusesAllAccounts).not.toHaveBeenCalled();

    // Exactly the validated id, on every account-scoped read.
    expect(deps.findPlanForAccount).toHaveBeenCalledWith(A);
    expect(deps.finance.findLiveBillingStatusForAccount).toHaveBeenCalledWith(A);
    const accountArgs = (deps.ledger.listRowsForAccountCreatedInRange.mock.calls as unknown as unknown[][]).map((c) => c[0]);
    expect(accountArgs.length).toBe(3);
    expect(new Set(accountArgs)).toEqual(new Set([A]));
    // The originals lookup is by action id taken from rows already read.
    expect(deps.ledger.findChargesByActionIds).toHaveBeenCalledWith([original.action_id]);

    // R-d: the one platform-wide read, called with NO argument.
    expect(deps.finance.countLiveRevenueRows).toHaveBeenCalledWith();

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
    deps.finance.findLiveBillingStatusForAccount.mockImplementation((() =>
      ok({ user_id: A, subscription_status: 'past_due', ended_at: null })) as never);
    const { result } = await run(deps, A);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.payload.accounts.figures?.groups.find((g) => g.key === `tier:${TIER}`)?.count).toBe(1);
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
  it('exposes exactly the thirteen finance reads: the four of 2a and the six of 2b included', () => {
    expect(Object.keys(financeHealthDeps().finance).sort()).toEqual([
      'countLiveRevenueRows',
      'findLiveBillingStatusForAccount',
      'listClientPaymentsAllAccountsPaidInRange',
      'listClientPaymentsForAccountPaidInRange',
      'listClientPlansAllAccounts',
      'listClientPlansForAccount',
      'listClientRefundsAllAccountsCreatedInRange',
      'listClientRefundsForAccountCreatedInRange',
      'listLiveBillingStatusesAllAccounts',
      'listOverdueClientInstalmentsAllAccounts',
      'listOverdueClientInstalmentsForAccount',
      'listOverdueClientInvoicesAllAccounts',
      'listOverdueClientInvoicesForAccount',
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
      deps.finance.listLiveBillingStatusesAllAccounts,
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
