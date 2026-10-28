/**
 * MK5B-FU-1 (workplan FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md §9.4 and
 * §9.5; SA-WP-M5F): the new bounded first-payment reads give EXACTLY the same
 * Finance figures as the old read, and stay exact far past the old ceiling.
 *
 * THE OLD PATH: `tests/helpers/legacyFirstPlanPayments.ts`, a verbatim, hash-
 * pinned copy of main `8967888c`'s read, over the raw billing events, asked
 * about every non-platform plan row (the one business picked: that id), exactly
 * as the MK-5b builder asked.
 *
 * THE NEW PATH: the real repository (Q1 by range, Q2 by id) over the reference
 * first-payment view, the real `listCurrentModeFirstPlanPayments`, and the real
 * builder, which now asks for this UTC month plus the trials MK-9 looks up.
 *
 * Both feed the same real `buildFinanceHealth` on the same seeded data, clock
 * and window, and the WHOLE payload must be byte-identical. An oracle computed
 * straight from the events checks both. Only the log counts may differ.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { FinanceBillingStatusRow } from '@/lib/repositories/BusinessOsFinanceReadRepository';
import { BusinessOsBillingAdminReadRepository } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort } from '@/lib/business-os/entitlements/lifecycle';
import { listCurrentModeFirstPlanPayments } from '@/lib/admin/billing/firstPlanPayments';
import { fakeFirstPaymentDb, referenceFirstPayments, type FakeBillingEvent } from '@/tests/helpers/fakeFirstPaymentDb';
import { LegacyFirstPlanPaymentsReader } from '@/tests/helpers/legacyFirstPlanPayments';
import { buildFinanceHealth, FINANCE_LIMITS, type FinanceHealthDeps } from '../financeHealth';
import { resolveFinanceWindow, type ResolvedFinanceWindow } from '../financeWindow';
import { isTrialRow, trialEndOf } from '../planGroups';
import { trialsToPaid } from '../payingBreakdown';
import { FINANCE_TRIAL_TO_PAID } from '../financeRules';
import { currentUtcMonth } from '../convertedThisMonth';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const CHAMPION = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'champion') as string;
const TRIAL = Object.keys(config.cohorts).find((id) => stateForCohort(id) === 'trial') as string;
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const WINDOW = resolveFinanceWindow({ preset: 'this_month' }, NOW);
const DAY = 24 * 60 * 60 * 1000;

// ── The frozen old read cannot drift ──────────────────────────────────────
const LEGACY_BLOCK_SHA256 = 'ac0ac49b85eb2295d77b7a42152522a9478fbf92d054a1c5c3d3b47aaf933e04';

// ── Seeded data ─────────────────────────────────────────────────────────
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const acct = (n: number) => uuid('aaaaaaaa', n);

function plan(user_id: string, extra: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id,
    tier: null,
    plan_version: 1,
    tier_expires_at: null,
    cohort: CHAMPION,
    cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z',
    profile_created_at: '2026-01-01T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'trigger',
    updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

interface Dataset {
  plans: BusinessOsAccountPlan[];
  paying: string[];
  events: FakeBillingEvent[];
}

interface Shape {
  accounts: number;
  /** Share of accounts on the trial cohort. */
  trialShare: number;
  payerShare: number;
  /** Payments per paying account: 1 to this many. */
  maxPayments: number;
  /** Months of history the first payment may be in. */
  historyMonths: number;
  /** Also seed the corner cases (ties, offsets, other mode, $0, nulls, kinds, platform, no-plan account). */
  corners: boolean;
}

function dataset(seed: number, shape: Shape): Dataset {
  const rand = prng(seed);
  const plans: BusinessOsAccountPlan[] = [];
  const paying: string[] = [];
  const events: FakeBillingEvent[] = [];
  let eventN = 0;
  const event = (user_id: string | null, at: string | null, patch: Partial<FakeBillingEvent> = {}): void => {
    eventN += 1;
    // Ids not in time order: the tie-break must be by id, never by insertion.
    const idNum = (eventN * 7919) % 1_000_000_007;
    events.push({ id: uuid('eeeeeeee', idNum), user_id, livemode: false, kind: 'invoice_paid', amount_minor: 1900, paid_at: at, ...patch });
  };
  const monthStart = Date.UTC(2026, 10, 1);
  for (let i = 1; i <= shape.accounts; i += 1) {
    const id = acct(i);
    const isTrial = rand() < shape.trialShare;
    if (isTrial) {
      // Trial ends spread around the window [Nov 1, Nov 10) and NOW (Nov 9 12:00), edges included.
      const pick = rand();
      const end =
        pick < 0.05 ? WINDOW.start.getTime() : pick < 0.1 ? WINDOW.end.getTime() : pick < 0.15 ? NOW.getTime() : monthStart + Math.floor((rand() * 40 - 15) * DAY);
      plans.push(plan(id, { cohort: TRIAL, trial_started_at: new Date(end - 14 * DAY).toISOString(), trial_ends_at: new Date(end).toISOString() }));
    } else {
      plans.push(plan(id, rand() < 0.5 ? { tier: TIER, cohort: null } : {}));
    }
    if (rand() < shape.payerShare) {
      if (rand() < 0.85) paying.push(id);
      const count = 1 + Math.floor(rand() * shape.maxPayments);
      const first = monthStart + Math.floor((rand() * shape.historyMonths - (shape.historyMonths - 1)) * 30 * DAY) + Math.floor(rand() * DAY);
      for (let k = 0; k < count; k += 1) event(id, new Date(first + k * 30 * DAY).toISOString());
    } else if (rand() < 0.05) {
      // Stopped before paying anything above zero.
      event(id, new Date(monthStart + 2 * DAY).toISOString(), { amount_minor: 0 });
    }
  }
  if (shape.corners) {
    const n = shape.accounts;
    const tie = acct(n + 1);
    plans.push(plan(tie, { tier: TIER, cohort: null }));
    paying.push(tie);
    // Two payments at the same instant, written with different offsets; a $0 one earlier.
    event(tie, '2026-11-03T10:00:00.000Z');
    event(tie, '2026-11-03T12:00:00+02:00');
    event(tie, '2026-10-20T00:00:00.000Z', { amount_minor: 0 });
    const edges: Array<[string, string]> = [
      ['monthStart', '2026-11-01T00:00:00.000Z'],
      ['lastMs', '2026-11-30T23:59:59.999Z'],
      ['offsetIn', '2026-11-01T00:30:00+01:00'],
      ['offsetOut', '2026-10-31T23:30:00-00:30'],
      ['nextMonth', '2026-12-01T00:00:00.000Z'],
    ];
    edges.forEach(([, at], i) => {
      const id = acct(n + 2 + i);
      plans.push(plan(id, { tier: TIER, cohort: null }));
      paying.push(id);
      event(id, at);
    });
    // Other mode earlier; null paid_at; other kinds earlier; negative-free zero amount.
    const mixed = acct(n + 10);
    plans.push(plan(mixed, { tier: TIER, cohort: null }));
    paying.push(mixed);
    event(mixed, '2026-08-01T00:00:00.000Z', { livemode: true });
    event(mixed, null);
    event(mixed, '2026-07-01T00:00:00.000Z', { kind: 'refunded' });
    event(mixed, '2026-07-02T00:00:00.000Z', { kind: 'subscription_updated' });
    event(mixed, '2026-07-03T00:00:00.000Z', { kind: 'mismatch_refused' });
    event(mixed, '2026-11-04T00:00:00.000Z');
    // Converted this month and no longer paying.
    const stopped = acct(n + 11);
    plans.push(plan(stopped, { tier: TIER, cohort: null }));
    event(stopped, '2026-11-02T00:00:00.000Z');
    // A detached row, a platform account and an account with no plan row, all paid this month.
    event(null, '2026-11-02T00:00:00.000Z');
    plans.push(plan(PLATFORM, { tier: TIER, cohort: null }));
    paying.push(PLATFORM);
    event(PLATFORM, '2026-11-02T00:00:00.000Z');
    event(acct(n + 12), '2026-11-02T00:00:00.000Z');
    // A trial that paid before its trial started (an earlier month), ending inside the window.
    const early = acct(n + 13);
    plans.push(plan(early, { cohort: TRIAL, trial_started_at: '2026-10-25T00:00:00.000Z', trial_ends_at: '2026-11-05T00:00:00.000Z' }));
    event(early, '2026-09-15T00:00:00.000Z');
  }
  // The plan walk is keyset on user_id.
  plans.sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0));
  return { plans, paying, events };
}

// ── The builder's deps: every other read empty ──────────────────────────
type Res<T> = Promise<{ data: T | null; error: Error | null }>;
const ok = <T>(data: T): Res<T> => Promise.resolve({ data, error: null });
const emptyRead = () => ok({ rows: [], reachedCeiling: false });

function deps(ds: Dataset, converted: NonNullable<FinanceHealthDeps['converted']>, opts: { failPlans?: boolean; failPaying?: boolean } = {}) {
  const statuses: FinanceBillingStatusRow[] = ds.paying.map((user_id) => ({ user_id, subscription_status: 'active', ended_at: null, bought_tier: null }));
  const payingSet = new Set(ds.paying);
  return {
    plans: {
      pagePlans: (q: { afterUserId: string | null; limit: number }) => {
        if (opts.failPlans) return Promise.resolve({ data: null, error: new Error('plans failed') });
        const from = q.afterUserId === null ? 0 : ds.plans.findIndex((p) => p.user_id > (q.afterUserId as string));
        return ok(from < 0 ? [] : ds.plans.slice(from, from + q.limit));
      },
    },
    findPlanForAccount: (id: string) => ok({ plan: ds.plans.find((p) => p.user_id === id) ?? null }),
    ledger: {
      listRowsOfAllAccountsCreatedInRange: emptyRead,
      listRowsForAccountCreatedInRange: emptyRead,
      findChargesByActionIds: () => ok([]),
    },
    finance: {
      listBillingStatusesAllAccounts: () => (opts.failPaying ? Promise.resolve({ data: null, error: new Error('paying failed') }) : ok(statuses)),
      findBillingStatusForAccount: (id: string) =>
        opts.failPaying
          ? Promise.resolve({ data: null, error: new Error('paying failed') })
          : ok(payingSet.has(id) ? { user_id: id, subscription_status: 'active', ended_at: null, bought_tier: null } : null),
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
    // Names for the shown rows only; a fixed rule so both paths see the same names.
    findNames: (ids: readonly string[]) => ok(ids.filter((id) => id.endsWith('1')).map((id) => ({ user_id: id, company_name: `Biz ${id.slice(-4)}` }))),
    config,
    isPlatformAccount: (id: string) => id === PLATFORM,
    credits: {
      getSnapshots: async (ids: string[]) => new Map(ids.map((id) => [id, { resolution: null, unavailable: true, stale: false }])),
      findPeriodAnchorsBatch: async () => ({ data: {}, error: null }),
      listTotalsForAccountsInRange: async () => ({ data: { rows: [], reachedCeiling: false }, error: null }),
    },
    lots: { allAccounts: () => ok([]), forAccount: () => ok([]) },
    converted,
  } as unknown as FinanceHealthDeps;
}

const sources = (ids: string[]) => ok(ids.filter((id) => id.endsWith('3')).map((account_id) => ({ account_id, source: 'organic' as const, stamped_at: null })));

/** The OLD path: MK-5b's read of every asked account's raw history (the builder asked every plan row, or the picked id). */
function oldConverted(ds: Dataset, accountId: string | null, fake = fakeFirstPaymentDb(ds.events)) {
  const legacy = new LegacyFirstPlanPaymentsReader(fake.client);
  const planRowIds = ds.plans.filter((p) => p.user_id !== PLATFORM).map((p) => p.user_id);
  const asked = accountId !== null ? [accountId] : planRowIds;
  return {
    fake,
    converted: {
      firstPlanPayments: async () => {
        const r = await legacy.listFirstPlanPaymentsForAccounts(asked, false);
        return r.error || !r.data ? { data: null, error: r.error } : { data: r.data.map((row) => ({ accountId: row.user_id, paidAt: row.paid_at })), error: null };
      },
      signupSources: sources,
    } as NonNullable<FinanceHealthDeps['converted']>,
  };
}

/** The NEW path: the real wiring and repository over the view. */
function newConverted(ds: Dataset, fake = fakeFirstPaymentDb(ds.events)) {
  const reader = new BusinessOsBillingAdminReadRepository(fake.client);
  return {
    fake,
    converted: {
      firstPlanPayments: (query) => listCurrentModeFirstPlanPayments(query, { reader, mode: () => 'test' }),
      signupSources: sources,
    } as NonNullable<FinanceHealthDeps['converted']>,
  };
}

const quiet = () => ({ error: () => undefined, warn: () => undefined, info: () => undefined });

async function build(d: FinanceHealthDeps, accountId: string | null, window: ResolvedFinanceWindow = WINDOW) {
  const result = await buildFinanceHealth({ window, accountId, now: NOW, accountsTab: null }, quiet(), d);
  if (result.kind !== 'ok') throw new Error('expected ok');
  return result;
}

/** The oracle, straight from the events: the figures both paths must give. */
function oracle(ds: Dataset, window: ResolvedFinanceWindow = WINDOW) {
  const first = new Map(referenceFirstPayments(ds.events).filter((r) => !r.livemode).map((r) => [r.user_id, r.first_payment_at]));
  const month = currentUtcMonth(NOW);
  const rows = ds.plans.filter((p) => p.user_id !== PLATFORM);
  const payingSet = new Set(ds.paying);
  let converted = 0;
  let stopped = 0;
  for (const row of rows) {
    const at = first.get(row.user_id);
    if (at === undefined) continue;
    const t = Date.parse(at);
    if (t < Date.parse(month.from) || t >= Date.parse(month.to)) continue;
    if (payingSet.has(row.user_id)) converted += 1;
    else stopped += 1;
  }
  const trials = rows.filter(isTrialRow).map((row) => ({ accountId: row.user_id, endsAt: trialEndOf(row, config, NOW) }));
  const trialsOut = trialsToPaid({
    trials,
    capped: false,
    firstPayments: [...first.entries()].map(([accountId, paidAt]) => ({ accountId, paidAt })),
    window: { start: window.start, end: window.end },
    now: NOW,
    minimumTrials: FINANCE_TRIAL_TO_PAID.minimumTrials,
  });
  return { converted, stopped, paid: trialsOut.paid, paidBeforeEnd: trialsOut.paidBeforeEnd, endedInWindow: trialsOut.endedInWindow };
}

async function compareAll(ds: Dataset, window: ResolvedFinanceWindow = WINDOW) {
  const oldRun = oldConverted(ds, null);
  const newRun = newConverted(ds);
  const before = await build(deps(ds, oldRun.converted), null, window);
  const after = await build(deps(ds, newRun.converted), null, window);
  return { before, after, oldRun, newRun };
}

describe('MK5B-FU-1: the frozen old read', () => {
  it('is byte-for-byte the method at main 8967888c (LF sha256 of the marked block)', () => {
    const text = fs.readFileSync(path.join(process.cwd(), 'tests', 'helpers', 'legacyFirstPlanPayments.ts'), 'utf8').replace(/\r\n/g, '\n');
    const block = text.split('// ── LEGACY BLOCK START (verbatim, main 8967888c) ──\n')[1].split('\n// ── LEGACY BLOCK END ──')[0];
    expect(createHash('sha256').update(block).digest('hex')).toBe(LEGACY_BLOCK_SHA256);
    expect(block).toContain(".from('business_os_billing_events')");
  });
});

describe('MK5B-FU-1: the reference view equals the oracle rule (the fake is honest)', () => {
  it('one row per account and mode, the earliest qualifying payment, ties by id', () => {
    const ds = dataset(7, { accounts: 300, trialShare: 0.3, payerShare: 0.6, maxPayments: 6, historyMonths: 12, corners: true });
    const view = referenceFirstPayments(ds.events);
    const keys = view.map((r) => `${r.user_id}|${r.livemode}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of view) {
      const candidates = ds.events.filter(
        (e) => e.user_id === row.user_id && e.livemode === row.livemode && e.kind === 'invoice_paid' && (e.amount_minor ?? 0) > 0 && e.paid_at !== null
      );
      const min = Math.min(...candidates.map((e) => Date.parse(e.paid_at as string)));
      expect(Date.parse(row.first_payment_at)).toBe(min);
    }
    expect(view.some((r) => r.user_id === null)).toBe(false);
  });
});

describe('MK5B-FU-1 equivalence: the whole payload is byte-identical (§9.4)', () => {
  it('EQ-1: 50 seeded random data sets, 0 to 300 accounts, with every corner case', async () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const rand = prng(seed * 31);
      const ds = dataset(seed, {
        accounts: Math.floor(rand() * 300),
        trialShare: rand() * 0.6,
        payerShare: rand(),
        maxPayments: 1 + Math.floor(rand() * 12),
        historyMonths: 1 + Math.floor(rand() * 18),
        corners: seed % 2 === 0,
      });
      const { before, after } = await compareAll(ds);
      expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
      const o = oracle(ds);
      const c = after.payload.converted;
      if (c?.scope !== 'all') throw new Error('expected all');
      expect([c.status, c.converted, c.stopped]).toEqual(['ok', o.converted, o.stopped]);
      expect(after.payload.payingBreakdown?.trials).toEqual(expect.objectContaining({ paid: o.paid, paidBeforeEnd: o.paidBeforeEnd }));
    }
  });

  it('EQ-2: 1,750 accounts (past QA\'s figure; rows kept under the old ceiling so the old path can answer)', async () => {
    const ds = dataset(1750, { accounts: 1750, trialShare: 0.3, payerShare: 0.7, maxPayments: 10, historyMonths: 12, corners: true });
    const qualifying = ds.events.filter((e) => e.kind === 'invoice_paid' && (e.amount_minor ?? 0) > 0 && e.paid_at !== null && !e.livemode);
    expect(qualifying.length).toBeLessThan(20_000);
    const { before, after } = await compareAll(ds);
    expect(before.payload.converted?.status).toBe('ok');
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
    const c = after.payload.converted;
    if (c?.scope !== 'all') throw new Error('expected all');
    expect(c.converted).toBe(oracle(ds).converted);
    expect(c.converted).toBeGreaterThan(0);
  });

  it.each([100, 101, 200, 1000, 1001, 2000])('EQ-3: %p plan rows (the 100-id chunk boundaries)', async (accounts) => {
    const ds = dataset(accounts, { accounts, trialShare: 0.25, payerShare: 0.6, maxPayments: 6, historyMonths: 6, corners: false });
    expect(ds.plans).toHaveLength(accounts);
    const { before, after } = await compareAll(ds);
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
  });

  it.each([1000, 1001])('EQ-4: one 100-id chunk holding exactly %p rows (the old read pages inside the chunk)', async (rows) => {
    const ds = dataset(4, { accounts: 100, trialShare: 0, payerShare: 0, maxPayments: 1, historyMonths: 1, corners: false });
    for (let i = 0; i < rows; i += 1) {
      const user = ds.plans[i % 100].user_id;
      ds.events.push({ id: uuid('ffffffff', i + 1), user_id: user, livemode: false, kind: 'invoice_paid', amount_minor: 900, paid_at: new Date(Date.UTC(2026, 10, 1) - i * DAY + (i % 3) * 3600_000).toISOString() });
    }
    ds.paying.push(...ds.plans.slice(0, 50).map((p) => p.user_id));
    const { before, after, oldRun } = await compareAll(ds);
    // 1,000 rows fill one page exactly, so a second request is made either way.
    expect(oldRun.fake.queries.length).toBe(2);
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
  });

  it('EQ-9: a long custom window (trial edges far from this month)', async () => {
    const ds = dataset(99, { accounts: 400, trialShare: 0.6, payerShare: 0.5, maxPayments: 4, historyMonths: 6, corners: true });
    const custom = resolveFinanceWindow({ preset: 'custom', from: '2026-08-12', to: '2026-11-09' }, NOW);
    const { before, after } = await compareAll(ds, custom);
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
    expect(after.payload.payingBreakdown?.trials.paid).toBe(oracle(ds, custom).paid);
  });

  it('EQ-10: one business picked, each state, reads only that id and never the month range (M5F-C5)', async () => {
    const ds = dataset(10, { accounts: 50, trialShare: 0.2, payerShare: 0.6, maxPayments: 3, historyMonths: 3, corners: true });
    const states = new Set<string>();
    for (const p of ds.plans.filter((row) => row.user_id !== PLATFORM)) {
      const oldRun = oldConverted(ds, p.user_id);
      const newRun = newConverted(ds);
      const before = await build(deps(ds, oldRun.converted), p.user_id);
      const after = await build(deps(ds, newRun.converted), p.user_id);
      expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
      const c = after.payload.converted;
      if (c?.scope === 'one' && c.state) states.add(c.state);
      for (const q of newRun.fake.queries) {
        expect(q.filters.some((f) => f.column === 'first_payment_at')).toBe(false);
        expect(q.filters.find((f) => f.op === 'in')?.value).toEqual([p.user_id]);
      }
    }
    expect([...states].sort()).toEqual(['converted', 'not_converted', 'stopped']);
  });

  it('EQ-11: failures give the same Unknown on both paths (plan walk, paying read, first-payment read)', async () => {
    const ds = dataset(11, { accounts: 120, trialShare: 0.3, payerShare: 0.5, maxPayments: 3, historyMonths: 3, corners: true });
    for (const opts of [{ failPlans: true }, { failPaying: true }]) {
      const before = await build(deps(ds, oldConverted(ds, null).converted, opts), null);
      const after = await build(deps(ds, newConverted(ds).converted, opts), null);
      expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
      expect(after.payload.converted?.status).toBe('unknown');
    }
    const failingOld = oldConverted(ds, null, fakeFirstPaymentDb(ds.events, { failOn: () => true }));
    const failingNew = newConverted(ds, fakeFirstPaymentDb(ds.events, { failOn: (q) => q.filters.some((f) => f.op === 'in') }));
    const before = await build(deps(ds, failingOld.converted), null);
    const after = await build(deps(ds, failingNew.converted), null);
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
    expect(after.payload.converted?.status).toBe('unknown');
    expect(after.payload.payingBreakdown?.trials.paid).toBeNull();
  });
});

describe('MK5B-FU-1 scale (§9.5)', () => {
  it('SC-1: past the old ceiling the old path is Unknown and the new one is exact, in bounded reads', async () => {
    const started = Date.now();
    // Just under the plan walk's own 20,000-row cap, so "partial" never muddies the comparison.
    const accounts = FINANCE_LIMITS.PLAN_CEILING - 500;
    const ds = dataset(2026, { accounts, trialShare: 0.25, payerShare: 0.78, maxPayments: 13, historyMonths: 13, corners: true });
    const qualifying = ds.events.filter((e) => e.kind === 'invoice_paid' && (e.amount_minor ?? 0) > 0 && e.paid_at !== null && !e.livemode).length;
    expect(qualifying).toBeGreaterThan(100_000);

    // The defect this slice fixes: the old read (asked every plan row, as the old builder did) hits its
    // 20,000-row ceiling, so Converted and MK-9 Paid were Unknown on every load. Proved at the read, not
    // through a second 19,500-account build, to keep the test inside its time budget (SA-Q-M5F-12);
    // EQ-11 already proves a failed first-payment read gives Unknown through the builder on both paths.
    const oldRun = oldConverted(ds, null);
    const oldRead = await oldRun.converted.firstPlanPayments({ accountIds: [], firstPaymentIn: null });
    expect(oldRead.data).toBeNull();
    expect(oldRead.error?.name).toBe('AdminBillingReadCeilingError');

    const newRun = newConverted(ds);
    const after = await build(deps(ds, newRun.converted), null);

    const o = oracle(ds);
    const c = after.payload.converted;
    if (c?.scope !== 'all') throw new Error('expected all');
    expect([c.status, c.converted, c.stopped]).toEqual(['ok', o.converted, o.stopped]);
    expect(c.converted).toBeGreaterThan(0);
    expect(after.payload.payingBreakdown?.trials).toEqual(expect.objectContaining({ paid: o.paid, paidBeforeEnd: o.paidBeforeEnd, endedInWindow: o.endedInWindow }));

    // Bounded: this month's first payments by range, and ceil(trials asked / 100) id requests.
    const range = newRun.fake.queries.filter((q) => q.filters.some((f) => f.column === 'first_payment_at'));
    const byId = newRun.fake.queries.filter((q) => q.filters.some((f) => f.op === 'in'));
    const askedIds = byId.reduce((n, q) => n + (q.filters.find((f) => f.op === 'in')?.value as string[]).length, 0);
    // This month's first payments, read 1,000 at a time (here about 1,200 converters, so 2 requests).
    const rangeRows = range.reduce((n, q) => n + q.rows, 0);
    expect(range).toHaveLength(Math.floor(rangeRows / 1000) + 1);
    expect(rangeRows).toBe(referenceFirstPayments(ds.events).filter((r) => !r.livemode && Date.parse(r.first_payment_at) < Date.UTC(2026, 11, 1) && Date.parse(r.first_payment_at) >= Date.UTC(2026, 10, 1)).length);
    expect(byId).toHaveLength(Math.ceil(askedIds / 100));
    for (const q of newRun.fake.queries) {
      expect(q.table).toBe('business_os_first_plan_payments');
      expect(q.limit).toBeLessThanOrEqual(1000);
      expect((q.filters.find((f) => f.op === 'in')?.value as string[] | undefined)?.length ?? 0).toBeLessThanOrEqual(100);
    }
    const rowsRead = newRun.fake.queries.reduce((n, q) => n + q.rows, 0);
    expect(rowsRead).toBeLessThanOrEqual(askedIds + rangeRows);
    expect(rowsRead).toBeLessThan(qualifying / 20);
    // Test-only timing note for the report (SA-Q-M5F-12); not a log line.
    process.stdout.write(`SC-1 MK5B-FU-1: accounts=${accounts} qualifyingRows=${qualifying} requests=${newRun.fake.queries.length} rowsRead=${rowsRead} ms=${Date.now() - started}\n`);
  }, 60_000);

  it('SC-2: 20,000 first payments in one month reach the range read\'s ceiling: Unknown, never 0', async () => {
    const events: FakeBillingEvent[] = Array.from({ length: 20_000 }, (_, i) => ({
      id: uuid('dddddddd', i + 1),
      user_id: uuid('cccccccc', i + 1),
      livemode: false,
      kind: 'invoice_paid',
      amount_minor: 100,
      paid_at: '2026-11-02T00:00:00.000Z',
    }));
    const fake = fakeFirstPaymentDb(events);
    const result = await listCurrentModeFirstPlanPayments(
      { accountIds: [], firstPaymentIn: currentUtcMonth(NOW) },
      { reader: new BusinessOsBillingAdminReadRepository(fake.client), mode: () => 'test' }
    );
    expect(result.data).toBeNull();
    expect(result.error?.name).toBe('AdminBillingReadCeilingError');
    expect(fake.queries.every((q) => (q.limit ?? 0) <= 1000)).toBe(true);
  });
});
