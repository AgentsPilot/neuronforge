/**
 * The finance builder (slice 1a): section isolation (SA-Q8, AC-27, AC-37,
 * AC-39), the account scope (AC-26, AC-41, AC-42 / SA-WR-3), the override
 * strip (SA-WR-1), the revenue panel's branches (AC-22, AC-23), the cut-over
 * (AC-40) and the ceiling (AC-15).
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

import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import { buildFinanceHealth, type FinanceHealthDeps } from '../financeHealth';
import { findPlanWithoutOverrides } from '../financeHealthDeps';
import { resolveFinanceWindow } from '../financeWindow';

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
    },
    findNames: jest.fn((ids: readonly string[]) =>
      ok(ids.filter((id) => id === A).map((id) => ({ user_id: id, company_name: 'Acme Dental' })))
    ),
    config,
    isPlatformAccount: (id: string) => id === PLATFORM,
  };
  return { ...defaults, ...overrides } as typeof defaults;
}

const logger = () => ({ error: jest.fn(), warn: jest.fn() });

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
