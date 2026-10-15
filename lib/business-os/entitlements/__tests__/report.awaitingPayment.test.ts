/**
 * The shadow report's `awaitingPayment` section (plan payments P-5b.2; SA-P18,
 * AC-F2.10, SA Q-9, C-9; workplan BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md §3.5).
 *
 * A held friend's plan row has no basis by design, so the lifecycle reads it as
 * a `no_assignment` anomaly. The report classifies those accounts once, with
 * the payment gate's own predicate, and lists a held one under
 * `awaitingPayment` INSTEAD of `anomalies`. Pinned here:
 *
 *   - the move, and only of held `no_assignment` anomalies;
 *   - the totals still reconcile: `byState` and `accountsScanned` unchanged,
 *     and anomalies + held = the anomalies before the move (C-9);
 *   - a failed or unwired hold read leaves every anomaly in place, says so in
 *     `scanFailed`, and gives `count: null` (a failed read never hides one);
 *   - no candidate means no read at all;
 *   - ids and counts only (RC-16).
 *
 * Every reader is injected: nothing here reaches a repository singleton or a
 * database (C-9).
 */

import { AWAITING_PAYMENT_LIST_CAP, buildShadowReport, type resolveForReport } from '@/lib/business-os/entitlements/report';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { AwaitingPaymentReaders } from '@/lib/business-os/invites/paymentHoldBatch';
import type { BusinessOsAccountHoldFactsRow } from '@/lib/repositories/types';

/** The plan row type, taken from the report itself so this file names no entitlement repository (RC-15). */
type BusinessOsAccountPlan = Parameters<typeof resolveForReport>[1];

// C-9: a test that reached a real repository would fail loudly, not silently pass.
jest.mock('@/lib/repositories/BusinessOsAccountLineageRepository', () => ({
  businessOsAccountLineageRepository: new Proxy({}, { get: () => () => { throw new Error('the real lineage repository was reached'); } }),
}));
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: new Proxy({}, { get: () => () => { throw new Error('the real invite repository was reached'); } }),
}));

const NOW = new Date('2026-10-14T00:00:00.000Z');
const now = () => NOW;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: uuid(0),
    tier: null,
    plan_version: 0,
    tier_expires_at: null,
    cohort: 'champion',
    cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z',
    profile_created_at: '2026-01-02T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'backfill',
    updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function planRepository(rows: BusinessOsAccountPlan[]) {
  return {
    async pagePlans(options: { afterUserId?: string | null; limit?: number } = {}) {
      const after = options.afterUserId;
      return { data: rows.filter((row) => !after || row.user_id > after).slice(0, options.limit ?? 500), error: null };
    },
    async findTenantsMissingPlanRow() {
      return {
        data: { checked: rows.length, count: 0, missing: [], withProfile: 0, onboardingOnly: 0, truncated: false, scope: 'exhaustive' },
        error: null,
      };
    },
    async findRecentOnboardedPlans() {
      return { data: [], error: null };
    },
  };
}

function holdReaders(lineage: BusinessOsAccountHoldFactsRow[], grants: Record<string, 'tier' | 'cohort'> = {}) {
  const lineageCalls: string[][] = [];
  const readers: AwaitingPaymentReaders = {
    lineage: {
      findHoldFactsForAccountsForAdmin: jest.fn(async (ids: string[]) => {
        lineageCalls.push(ids);
        return { data: lineage.filter((row) => ids.includes(row.account_id)), error: null };
      }),
    },
    invites: {
      findGrantKindsByIdsForAdmin: jest.fn(async (ids: string[]) => ({
        data: ids.filter((id) => id in grants).map((id) => ({ id, grant_kind: grants[id] })),
        error: null,
      })),
    },
  };
  return { readers, lineageCalls };
}

/** A held friend, a basis-less non-friend, a paid friend and two healthy champions. */
const HELD = uuid(1);
const BROKEN = uuid(2);
const PAID_FRIEND = uuid(3);
const rows = [
  planRow({ user_id: HELD, cohort: null }),
  planRow({ user_id: BROKEN, cohort: null }),
  planRow({ user_id: PAID_FRIEND, cohort: null }),
  planRow({ user_id: uuid(4) }),
  planRow({ user_id: uuid(5) }),
];
const lineage: BusinessOsAccountHoldFactsRow[] = [
  { account_id: HELD, invite_id: uuid(101), source: 'account_invite', first_paid_at: null },
  { account_id: PAID_FRIEND, invite_id: uuid(103), source: 'account_invite', first_paid_at: '2026-10-12T00:00:00.000Z' },
];

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

describe('awaitingPayment: held accounts move out of anomalies (SA-P18, Q-9)', () => {
  it('the held friend is listed under awaitingPayment and no longer in anomalies; real anomalies stay', async () => {
    const { readers } = holdReaders(lineage);
    const report = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows), holdReaders: readers });

    expect(report.static.awaitingPayment).toEqual({ scanFailed: false, count: 1, accountIds: [HELD], truncated: false });
    expect(report.static.anomalies.map((entry) => entry.accountId)).toEqual([BROKEN, PAID_FRIEND]);
    expect(report.static.anomalies.every((entry) => entry.anomaly === 'no_assignment')).toBe(true);
  });

  it('C-9: the totals still reconcile: byState and accountsScanned unchanged, anomalies + held = before', async () => {
    const before = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows) });
    const { readers } = holdReaders(lineage);
    const after = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows), holdReaders: readers });

    expect(after.static.accountsScanned).toBe(before.static.accountsScanned);
    expect(after.static.byState).toEqual(before.static.byState);
    expect(total(after.static.byState)).toBe(after.static.accountsScanned);
    expect(after.static.anomalies.length + (after.static.awaitingPayment.count ?? 0)).toBe(before.static.anomalies.length);
    expect(after.static.noEndDate).toEqual(before.static.noEndDate);
    expect(after.static.dormantChampions).toEqual(before.static.dormantChampions);
  });

  it('classifies only no_assignment anomalies, once, in one batched read (P5-C10)', async () => {
    const { readers, lineageCalls } = holdReaders(lineage);
    await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows), holdReaders: readers });
    expect(lineageCalls).toEqual([[HELD, BROKEN, PAID_FRIEND]]);
  });

  it('no candidate: no hold read at all, and a clean zero', async () => {
    const { readers, lineageCalls } = holdReaders(lineage);
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      planRepository: planRepository([planRow({ user_id: uuid(4) })]),
      holdReaders: readers,
    });
    expect(lineageCalls).toEqual([]);
    expect(report.static.awaitingPayment).toEqual({ scanFailed: false, count: 0, accountIds: [], truncated: false });
  });

  it(`lists at most ${AWAITING_PAYMENT_LIST_CAP} ids, with the exact count and truncated`, async () => {
    const many = Array.from({ length: AWAITING_PAYMENT_LIST_CAP + 5 }, (_v, i) => uuid(1000 + i));
    const { readers } = holdReaders(many.map((id) => ({ account_id: id, invite_id: null, source: 'account_invite' as const, first_paid_at: null })));
    const report = await buildShadowReport({
      config: readCodeConfig(),
      now,
      planRepository: planRepository(many.map((id) => planRow({ user_id: id, cohort: null }))),
      holdReaders: readers,
    });
    expect(report.static.awaitingPayment.count).toBe(AWAITING_PAYMENT_LIST_CAP + 5);
    expect(report.static.awaitingPayment.accountIds).toHaveLength(AWAITING_PAYMENT_LIST_CAP);
    expect(report.static.awaitingPayment.truncated).toBe(true);
    expect(report.static.anomalies).toEqual([]);
  });
});

describe('a failed hold read never hides an anomaly', () => {
  it.each([
    ['the lineage read errors', { data: null, error: new Error('timeout') }],
    ['the lineage read throws', 'throw'],
  ] as const)('%s: scanFailed, count null, anomalies exactly as before', async (_label, answer) => {
    const before = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows) });
    const { readers } = holdReaders(lineage);
    readers.lineage.findHoldFactsForAccountsForAdmin = jest.fn(async () => {
      if (answer === 'throw') throw new Error('network');
      return answer;
    });
    const report = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows), holdReaders: readers });
    expect(report.static.awaitingPayment).toEqual({ scanFailed: true, count: null, accountIds: [], truncated: false });
    expect(report.static.anomalies).toEqual(before.static.anomalies);
    expect(report.static.anomalies.map((entry) => entry.accountId)).toContain(HELD);
  });

  it('unwired (no readers given): the same, and no repository is reached', async () => {
    const report = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows) });
    expect(report.static.awaitingPayment).toEqual({ scanFailed: true, count: null, accountIds: [], truncated: false });
    expect(report.static.anomalies.map((entry) => entry.accountId)).toEqual([HELD, BROKEN, PAID_FRIEND]);
  });
});

describe('RC-16: ids and counts only', () => {
  it('the section has exactly its four keys, and its ids are account ids', async () => {
    const { readers } = holdReaders(lineage);
    const report = await buildShadowReport({ config: readCodeConfig(), now, planRepository: planRepository(rows), holdReaders: readers });
    expect(Object.keys(report.static.awaitingPayment).sort()).toEqual(['accountIds', 'count', 'scanFailed', 'truncated']);
    expect(report.static.awaitingPayment.accountIds.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(JSON.stringify(report.static.awaitingPayment)).not.toMatch(/@|invite|grant|paid_at/i);
  });
});
