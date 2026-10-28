/**
 * Plan payments P-8b.3a (AM-2; SA P3-SA-4, P3-SA-2 item 5): the "Disagrees"
 * marker, filter and count on the Subscriptions list. ONE rule,
 * `billingDisagreements`, moved unchanged from the billing panel; the panel and
 * the list must give the same answer for the same records. The real
 * entitlement config is used and tiers come from it, never from literals.
 */

import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { billingDisagreements, buildPlanSubscriptions, buildSubscriptions, type SubscriptionsInput } from '../subscriptionsView';
import { buildBillingPanel } from '../billingPanelView';
import type { SubscriptionFilter } from '../subscriptionsTypes';

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

/** Every case the panel's rule distinguishes. */
const CASES: Array<[string, AdminBillingRow, BusinessOsAccountPlan | null, string[]]> = [
  ['agree', billing(1), plan(1), []],
  ['the plan on record differs', billing(2, { bought_tier: HIGH }), plan(2), ['tier_differs']],
  ['no tier on the plan row', billing(3), plan(3, { tier: null }), ['no_tier_on_plan']],
  ['no plan row at all', billing(4), null, ['no_tier_on_plan']],
  ['paid-through differs', billing(5), plan(5, { tier_expires_at: iso(NOW.getTime()) }), ['paid_through_differs']],
  ['paid-through within one second', billing(6), plan(6, { tier_expires_at: iso(Date.parse(END) + 900) }), []],
  ['both differ', billing(7, { bought_tier: HIGH }), plan(7, { tier_expires_at: null }), ['tier_differs', 'paid_through_differs']],
  ['not paying (ended)', billing(8, { ended_at: iso(NOW.getTime() - DAY), subscription_status: 'canceled' }), plan(8, { tier: null }), []],
  ['a null bought tier is not a stored difference', billing(9, { bought_tier: null }), plan(9), []],
];

describe('billingDisagreements: one rule for the panel and the list', () => {
  it.each(CASES)('%s', (_name, row, planRow, expected) => {
    expect(billingDisagreements(row, planRow)).toEqual(expected);
  });

  it.each(CASES)('the billing panel gives the same answer: %s', (_name, row, planRow, expected) => {
    const panel = buildBillingPanel({
      billing: { ...row, stripe_customer_id: 'cus_test_fixture' },
      plan: planRow,
      config,
      now: NOW,
      mode: 'test',
    });
    expect(panel.disagreements).toEqual(expected);
  });
});

describe('the list: marker, filter and count', () => {
  const rows = [billing(1), billing(2, { bought_tier: HIGH }), billing(5)];
  const plans = [plan(1), plan(2), plan(5, { tier_expires_at: null }), plan(20, { tier: HIGH })];

  it('each row carries its disagreements; a "No Stripe" row never disagrees', () => {
    const payload = build(rows, plans);
    const byAccount = new Map(payload.rows.map((row) => [row.accountId, row.disagreements]));
    expect(byAccount.get(account(1))).toEqual([]);
    expect(byAccount.get(account(2))).toEqual(['tier_differs']);
    expect(byAccount.get(account(5))).toEqual(['paid_through_differs']);
    expect(byAccount.get(account(20))).toEqual([]);
  });

  it('status=disagrees keeps only rows that disagree; the count ignores the filter', () => {
    const all = build(rows, plans);
    const filtered = build(rows, plans, 'disagrees');
    expect(all.totals.disagreeing).toBe(2);
    expect(filtered.totals.disagreeing).toBe(2);
    expect(filtered.status).toBe('disagrees');
    expect(filtered.matching).toBe(2);
    expect(filtered.rows.map((row) => row.accountId).sort()).toEqual([account(2), account(5)]);
    // Every other total is the same with or without the filter.
    expect(filtered.totals).toEqual(all.totals);
  });

  it('a status filter is unchanged by the new field', () => {
    expect(build(rows, plans, 'active').matching).toBe(3);
  });

  it('the plan drawer inherits the field through the one builder', () => {
    const drawer = buildPlanSubscriptions({ billingRows: rows, planRows: plans, config, now: NOW, mode: 'test', status: null, planId: HIGH });
    const disagreeing = drawer.rows.filter((row) => row.disagreements.length > 0).map((row) => row.accountId);
    expect(disagreeing).toEqual([account(2)]);
  });
});
