/**
 * QA (MK5B-FU-1, workplan FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md): end-to-end
 * failure paths and hand-checked edge cases, through the REAL builder, the REAL wiring
 * (`listCurrentModeFirstPlanPayments`) and the REAL repository, over the reference view
 * fake. A tamper hook plants the database answers the view can never give, so every
 * defence is proved to reach the payload as Unknown, never a wrong number.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { trialEndOf } from '../planGroups';
import type { FinanceBillingStatusRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
import { BusinessOsBillingAdminReadRepository } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import { listCurrentModeFirstPlanPayments } from '@/lib/admin/billing/firstPlanPayments';
import { fakeFirstPaymentDb, type FakeBillingEvent, type RecordedFakeQuery } from '@/tests/helpers/fakeFirstPaymentDb';
import { LegacyFirstPlanPaymentsReader } from '@/tests/helpers/legacyFirstPlanPayments';
import { buildFinanceHealth, type FinanceHealthDeps } from '../financeHealth';
import { resolveFinanceWindow } from '../financeWindow';

// The plan row type, taken from its finance consumer so this QA file names no repository (RC-15).
type BusinessOsAccountPlan = Parameters<typeof trialEndOf>[0];

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const CHAMPION = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'champion') as string;
const TRIAL = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'trial') as string;
const NOW = new Date('2026-11-09T12:00:00.000Z');
const WINDOW = resolveFinanceWindow({ preset: 'this_month' }, NOW);
const NOV = { from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' };

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { boundary: id(1), lastOct: id(2), stopped: id(3), zeroFirst: id(4), liveEarlier: id(5), tie: id(6), nextMonth: id(7) };
const T = { paidEarlierMonth: id(11), unpaid: id(12), paidAfterEnd: id(13) };

function plan(user_id: string, extra: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id, tier: TIER, plan_version: 1, tier_expires_at: null, cohort: null, cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z', profile_created_at: '2026-01-01T00:00:00.000Z',
    trial_started_at: null, trial_ends_at: null, grace_ends_at: null, period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'trigger', updated_by_admin_id: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}
const trial = (user_id: string, endsAt: string) =>
  plan(user_id, { tier: null, cohort: TRIAL, trial_started_at: '2026-10-25T00:00:00.000Z', trial_ends_at: endsAt });

let eventNo = 0;
const ev = (user_id: string | null, paid_at: string | null, patch: Partial<FakeBillingEvent> = {}): FakeBillingEvent => {
  eventNo += 1;
  return { id: `eeeeeeee-0000-4000-8000-${String(1000 - eventNo).padStart(12, '0')}`, user_id, livemode: false, kind: 'invoice_paid', amount_minor: 1900, paid_at, ...patch };
};

const plans = [
  plan(A.boundary), plan(A.lastOct), plan(A.stopped), plan(A.zeroFirst), plan(A.liveEarlier), plan(A.tie), plan(A.nextMonth),
  trial(T.paidEarlierMonth, '2026-11-05T00:00:00.000Z'),
  trial(T.unpaid, '2026-11-05T00:00:00.000Z'),
  trial(T.paidAfterEnd, '2026-11-06T00:00:00.000Z'),
  plan(id(99), { tier: null, cohort: CHAMPION }),
];
const paying = [A.boundary, A.lastOct, A.zeroFirst, A.liveEarlier, A.tie, A.nextMonth];
const events: FakeBillingEvent[] = [
  ev(A.boundary, '2026-11-01T00:00:00.000Z'), // exactly the month start: IN
  ev(A.lastOct, '2026-10-31T23:59:59.999Z'), // last ms of October: first payment not this month
  ev(A.lastOct, '2026-11-02T00:00:00.000Z'),
  ev(A.stopped, '2026-11-02T00:00:00.000Z'), // converted this month, not paying now: stopped
  ev(A.zeroFirst, '2026-10-20T00:00:00.000Z', { amount_minor: 0 }), // $0 never counts
  ev(A.zeroFirst, '2026-11-03T00:00:00.000Z'),
  ev(A.liveEarlier, '2026-08-01T00:00:00.000Z', { livemode: true }), // the other mode never counts
  ev(A.liveEarlier, '2026-11-04T00:00:00.000Z'),
  ev(A.tie, '2026-11-05T10:00:00.000Z'), // the same instant written two ways: one first payment
  ev(A.tie, '2026-11-05T12:00:00+02:00'),
  ev(A.nextMonth, '2026-12-01T00:00:00.000Z'), // exactly next month start: OUT
  ev(null, '2026-11-02T00:00:00.000Z'), // detached row: never counted
  ev(T.paidEarlierMonth, '2026-09-15T00:00:00.000Z'), // paid before the trial (an earlier month)
  ev(T.paidAfterEnd, '2026-11-07T00:00:00.000Z'), // paid after its end, this month
];

type Res<T> = Promise<{ data: T | null; error: Error | null }>;
const ok = <T>(data: T): Res<T> => Promise.resolve({ data, error: null });
const emptyRead = () => ok({ rows: [], reachedCeiling: false });

function deps(converted: NonNullable<FinanceHealthDeps['converted']>): FinanceHealthDeps {
  const statuses: FinanceBillingStatusRow[] = paying.map((user_id) => ({ user_id, subscription_status: 'active', ended_at: null, bought_tier: null }));
  const payingSet = new Set(paying);
  return {
    plans: {
      pagePlans: (q: { afterUserId: string | null; limit: number }) => {
        const sorted = [...plans].sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
        const from = q.afterUserId === null ? 0 : sorted.findIndex((p) => p.user_id > (q.afterUserId as string));
        return ok(from < 0 ? [] : sorted.slice(from, from + q.limit));
      },
    },
    findPlanForAccount: (accountId: string) => ok({ plan: plans.find((p) => p.user_id === accountId) ?? null }),
    ledger: { listRowsOfAllAccountsCreatedInRange: emptyRead, listRowsForAccountCreatedInRange: emptyRead, findChargesByActionIds: () => ok([]) },
    finance: {
      listBillingStatusesAllAccounts: () => ok(statuses),
      findBillingStatusForAccount: (accountId: string) =>
        ok(payingSet.has(accountId) ? { user_id: accountId, subscription_status: 'active', ended_at: null, bought_tier: null } : null),
      listClientPaymentsAllAccountsPaidInRange: emptyRead,
      listClientPaymentsForAccountPaidInRange: emptyRead,
      listClientRefundsAllAccountsCreatedInRange: emptyRead,
      listClientRefundsForAccountCreatedInRange: emptyRead,
      listOverdueClientInvoicesAllAccounts: emptyRead,
      listOverdueClientInvoicesForAccount: emptyRead,
      listOverdueClientInstalmentsAllAccounts: emptyRead,
      listOverdueClientInstalmentsForAccount: emptyRead,
      listClientPlansAllAccounts: emptyRead,
      listClientPlansForAccount: emptyRead,
      listBoostPurchasesAllAccountsPaidInRange: emptyRead,
      listBoostPurchasesForAccountPaidInRange: emptyRead,
      listPlanPaymentsAllAccountsPaidInRange: emptyRead,
      listPlanPaymentsForAccountPaidInRange: emptyRead,
      listBoostReversalEventsAllAccountsRecordedInRange: emptyRead,
      listBoostReversalEventsForAccountRecordedInRange: emptyRead,
      listBoostPurchasesNeedingAttentionAllAccounts: () => ok({ rows: [], reachedCeiling: false, openedDates: 'read' as const }),
      listBoostPurchasesNeedingAttentionForAccount: () => ok({ rows: [], reachedCeiling: false, openedDates: 'read' as const }),
    },
    readReminderFigures: () => ok(null),
    readRecordedAllAccounts: () => ok({ rows: [], completed: true }),
    readRecordedForAccount: () => ok({ rows: [], reachedCeiling: false }),
    findNames: () => ok([]),
    config,
    isPlatformAccount: (accountId: string) => accountId === id(99),
    credits: {
      getSnapshots: async (ids: string[]) => new Map(ids.map((i) => [i, { resolution: null, unavailable: true, stale: false }])),
      findPeriodAnchorsBatch: async () => ({ data: {}, error: null }),
      listTotalsForAccountsInRange: async () => ({ data: { rows: [], reachedCeiling: false }, error: null }),
    },
    lots: { allAccounts: () => ok([]), forAccount: () => ok([]) },
    converted,
  } as unknown as FinanceHealthDeps;
}

type Answer = { data: Array<Record<string, unknown>> | null; error: Error | null };
const isRange = (q: RecordedFakeQuery) => q.filters.some((f) => f.column === 'first_payment_at');
const isById = (q: RecordedFakeQuery) => q.filters.some((f) => f.op === 'in');

/** The real repository over the reference view, with a hook that may replace what the database answered. */
function newPath(hook: (q: RecordedFakeQuery, answer: Answer) => Answer = (_q, a) => a) {
  const fake = fakeFirstPaymentDb(events);
  const client = {
    from: (table: string) => {
      const builder = (fake.client as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
      const then = builder.then as (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => void;
      builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        then((answer) => resolve(hook(fake.queries[fake.queries.length - 1], answer as Answer)), reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  const reader = new BusinessOsBillingAdminReadRepository(client);
  const rangeSpy = jest.spyOn(reader, 'listFirstPlanPaymentsInRangeAllAccounts');
  return {
    fake,
    rangeSpy,
    converted: {
      firstPlanPayments: (query) => listCurrentModeFirstPlanPayments(query, { reader, mode: () => 'test' }),
      signupSources: (ids: string[]) => ok(ids.map((account_id) => ({ account_id, source: 'organic' as const, stamped_at: null }))),
    } as NonNullable<FinanceHealthDeps['converted']>,
  };
}

/** The frozen MK-5b read (main 8967888c), asked about every non-platform plan row. */
function oldPath(accountId: string | null) {
  const legacy = new LegacyFirstPlanPaymentsReader(fakeFirstPaymentDb(events).client);
  const asked = accountId !== null ? [accountId] : plans.filter((p) => p.user_id !== id(99)).map((p) => p.user_id);
  return {
    firstPlanPayments: async () => {
      const r = await legacy.listFirstPlanPaymentsForAccounts(asked, false);
      return r.error || !r.data ? { data: null, error: r.error } : { data: r.data.map((row) => ({ accountId: row.user_id, paidAt: row.paid_at })), error: null };
    },
    signupSources: (ids: string[]) => ok(ids.map((account_id) => ({ account_id, source: 'organic' as const, stamped_at: null }))),
  } as NonNullable<FinanceHealthDeps['converted']>;
}

const quiet = () => ({ error: () => undefined, warn: () => undefined, info: () => undefined });
async function build(converted: NonNullable<FinanceHealthDeps['converted']>, accountId: string | null = null) {
  const result = await buildFinanceHealth({ window: WINDOW, accountId, now: NOW, accountsTab: null }, quiet(), deps(converted));
  if (result.kind !== 'ok') throw new Error('expected ok');
  return result.payload;
}

describe('QA MK5B-FU-1: hand-checked edge cases (month edges, $0, other mode, null user, ties, earlier-month trial)', () => {
  it('gives the exact figures by hand, and the same bytes as the frozen old read', async () => {
    const after = await build(newPath().converted);
    const before = await build(oldPath(null));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    const c = after.converted;
    if (c?.scope !== 'all') throw new Error('expected all');
    // Converted (paying now): boundary, zeroFirst, liveEarlier, tie. Stopped: A.stopped, T.paidAfterEnd.
    expect([c.status, c.converted, c.stopped]).toEqual(['ok', 4, 2]);
    expect(c.rows?.map((r) => r.accountId).sort()).toEqual([A.boundary, A.liveEarlier, A.stopped, A.tie, A.zeroFirst, T.paidAfterEnd].sort());
    expect(c.rows?.find((r) => r.accountId === A.zeroFirst)?.firstPaymentAt).toBe('2026-11-03T00:00:00.000Z');
    expect(c.rows?.find((r) => r.accountId === A.liveEarlier)?.firstPaymentAt).toBe('2026-11-04T00:00:00.000Z');
    // MK-9: three trials ended in the window; two paid (one in an earlier month, before its end), one before the end.
    expect(after.payingBreakdown?.trials).toEqual(expect.objectContaining({ endedInWindow: 3, paid: 2, paidBeforeEnd: 1 }));
  });
});

describe('QA MK5B-FU-1: every failure reaches the payload as Unknown, never a number', () => {
  const unknown = async (hook: (q: RecordedFakeQuery, answer: Answer) => Answer) => {
    const payload = await build(newPath(hook).converted);
    expect(payload.converted).toEqual(expect.objectContaining({ scope: 'all', status: 'unknown', converted: null, stopped: null, rows: null }));
    expect(payload.payingBreakdown?.trials).toEqual(expect.objectContaining({ paid: null, paidBeforeEnd: null, rate: null }));
  };
  const fail: Answer = { data: null, error: new Error('db down') };

  it('the month (view) read fails', () => unknown((q, a) => (isRange(q) ? fail : a)));
  it('the by-id (view) read fails', () => unknown((q, a) => (isById(q) ? fail : a)));
  it('the month read returns one account twice', () =>
    unknown((q, a) => (isRange(q) && a.data && a.data.length > 0 ? { ...a, data: [...a.data, a.data[0]] } : a)));
  it('the month read returns a row outside the month', () =>
    unknown((q, a) => (isRange(q) && a.data ? { ...a, data: [...a.data, { user_id: id(50), first_payment_at: '2026-12-01T00:00:00.000Z' }] } : a)));
  it('the month read returns a row with no user', () =>
    unknown((q, a) => (isRange(q) && a.data ? { ...a, data: [...a.data, { user_id: null, first_payment_at: '2026-11-02T00:00:00.000Z' }] } : a)));
  it('the by-id read returns an account that was not asked for', () =>
    unknown((q, a) => (isById(q) && a.data ? { ...a, data: [...a.data, { user_id: A.boundary, first_payment_at: '2026-11-01T00:00:00.000Z' }] } : a)));
  it('the by-id read returns one account twice', () =>
    unknown((q, a) => (isById(q) && a.data && a.data.length > 0 ? { ...a, data: [...a.data, a.data[0]] } : a)));
  it('the two joined reads disagree for one account', () =>
    unknown((q, a) =>
      isById(q) && a.data
        ? { ...a, data: a.data.map((r) => (r.user_id === T.paidAfterEnd ? { ...r, first_payment_at: '2026-11-08T00:00:00.000Z' } : r)) }
        : a
    ));
  it('the by-id read returns an unreadable date', () =>
    unknown((q, a) => (isById(q) && a.data ? { ...a, data: a.data.map((r) => ({ ...r, first_payment_at: 'not a date' })) } : a)));

  it('a range over 31 days is refused before any query (wiring + repository)', async () => {
    const path = newPath();
    const reader = new BusinessOsBillingAdminReadRepository(path.fake.client);
    const r = await listCurrentModeFirstPlanPayments(
      { accountIds: [T.unpaid], firstPaymentIn: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:01.000Z' } },
      { reader, mode: () => 'test' }
    );
    expect(r.data).toBeNull();
    expect(r.error?.name).toBe('AdminBillingReadGuardError');
    expect(path.fake.queries).toHaveLength(0);
  });
});

describe('QA MK5B-FU-1: one business picked never runs the cross-account read (C5)', () => {
  it.each(Object.entries({ ...A, ...T }))('%s: same bytes as the old read; only that id; no month range', async (_name, accountId) => {
    const path = newPath();
    const after = await build(path.converted, accountId);
    const before = await build(oldPath(accountId), accountId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(path.rangeSpy).not.toHaveBeenCalled();
    expect(path.fake.queries.length).toBe(1);
    for (const q of path.fake.queries) {
      expect(isRange(q)).toBe(false);
      expect(q.filters.find((f) => f.op === 'in')?.value).toEqual([accountId]);
    }
  });

  it('the all-businesses view asks the month once and only the trial ids by id', async () => {
    const path = newPath();
    await build(path.converted);
    expect(path.rangeSpy).toHaveBeenCalledTimes(1);
    expect(path.rangeSpy).toHaveBeenCalledWith(NOV, false);
    const byId = path.fake.queries.filter(isById);
    expect(byId).toHaveLength(1);
    expect([...(byId[0].filters.find((f) => f.op === 'in')?.value as string[])].sort()).toEqual([T.paidEarlierMonth, T.unpaid, T.paidAfterEnd].sort());
  });
});
