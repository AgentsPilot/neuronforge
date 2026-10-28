/**
 * QA P-8b.3a (AM-2): edges of the "Disagrees" filter and count in
 * `buildSubscriptions` beyond the Dev tests: an empty list, every row
 * disagreeing, the row cap, a list of "No Stripe" rows only, and the payload
 * carrying no new identifying field. Tiers come from the real config.
 */

import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { buildSubscriptions, type SubscriptionsInput } from '../subscriptionsView';
import { SUBSCRIPTIONS_ROW_CAP, type SubscriptionFilter } from '../subscriptionsTypes';

// The plan-row type through the builder's own input, so this test names no plan repository (RC-15).
type BusinessOsAccountPlan = SubscriptionsInput['planRows'][number];

const config = getEntitlementConfig();
const LOW = config.tierOrder[0];
const HIGH = config.tierOrder[config.tierOrder.length - 1];
const NOW = new Date('2026-10-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const END = iso(NOW.getTime() + 10 * DAY);
const account = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

function billing(n: number, patch: Partial<AdminBillingRow> = {}): AdminBillingRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: account(n),
    livemode: false,
    subscription_status: 'active',
    bought_tier: LOW,
    current_period_end: END,
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: iso(NOW.getTime() - 20 * DAY),
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
    ...patch,
  };
}

function plan(n: number, patch: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: account(n),
    tier: LOW,
    plan_version: 1,
    tier_expires_at: END,
    cohort: null,
    cohort_expires_at: null,
    onboarding_started_at: '2026-09-01T00:00:00.000Z',
    profile_created_at: '2026-09-01T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-09-01T00:00:00.000Z',
    origin: 'admin',
    updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...patch,
  };
}

const build = (billingRows: AdminBillingRow[], planRows: BusinessOsAccountPlan[], status: SubscriptionFilter | null = null) =>
  buildSubscriptions({ billingRows, planRows, config, now: NOW, mode: 'test', status });

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe('QA P-8b.3a: counts and totals at the edges', () => {
  it('an empty list: disagreeing 0, no rows, matching 0, with and without the filter', () => {
    for (const status of [null, 'disagrees'] as const) {
      const payload = build([], [], status);
      expect(payload.totals.disagreeing).toBe(0);
      expect(payload.totals.accounts).toBe(0);
      expect(payload.rows).toEqual([]);
      expect(payload.matching).toBe(0);
      expect(payload.status).toBe(status);
    }
  });

  it('every row disagrees: disagreeing = accounts = matching, and the filter changes no row and no total', () => {
    const ids = range(4);
    const rows = ids.map((n) => billing(n, { bought_tier: HIGH }));
    const plans = ids.map((n) => plan(n));
    const all = build(rows, plans);
    const filtered = build(rows, plans, 'disagrees');
    expect(all.totals.disagreeing).toBe(4);
    expect(all.totals.accounts).toBe(4);
    expect(filtered.matching).toBe(4);
    expect(filtered.rows).toEqual(all.rows);
    expect(filtered.totals).toEqual(all.totals);
  });

  it('no row disagrees: the filter gives an empty list while the totals stay whole', () => {
    const ids = range(3);
    const payload = build(ids.map((n) => billing(n)), ids.map((n) => plan(n)), 'disagrees');
    expect(payload.rows).toEqual([]);
    expect(payload.matching).toBe(0);
    expect(payload.totals.accounts).toBe(3);
    expect(payload.totals.disagreeing).toBe(0);
  });

  it('only "No Stripe" rows (admin-assigned plans, no billing row): none disagrees, the filter is empty', () => {
    const payload = build([], [plan(1, { tier: HIGH }), plan(2)], 'disagrees');
    expect(payload.totals.accounts).toBeGreaterThan(0);
    expect(payload.totals.disagreeing).toBe(0);
    expect(payload.rows).toEqual([]);
  });

  it('past the row cap: rows are cut, matching and disagreeing count every row', () => {
    const ids = range(SUBSCRIPTIONS_ROW_CAP + 3);
    const payload = build(
      ids.map((n) => billing(n, { bought_tier: HIGH })),
      ids.map((n) => plan(n)),
      'disagrees'
    );
    expect(payload.rows).toHaveLength(SUBSCRIPTIONS_ROW_CAP);
    expect(payload.matching).toBe(SUBSCRIPTIONS_ROW_CAP + 3);
    expect(payload.totals.disagreeing).toBe(SUBSCRIPTIONS_ROW_CAP + 3);
  });

  it('the new row field holds kinds only: the row keys are the old ones plus `disagreements`', () => {
    const payload = build([billing(1, { bought_tier: HIGH })], [plan(1, { tier_expires_at: null })]);
    const row = payload.rows[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        'accountId',
        'businessName',
        'cancelAtPeriodEnd',
        'currentPeriodEnd',
        'disagreements',
        'discounted',
        'endedAt',
        'failedAttempts',
        'lastPaidAt',
        'lastPaymentFailedAt',
        'paidThrough',
        'pendingPlan',
        'planBought',
        'planOnRecord',
        'stripeStatus',
        'status',
        'statuses',
      ].sort()
    );
    expect(row.disagreements).toEqual(['tier_differs', 'paid_through_differs']);
  });
});
