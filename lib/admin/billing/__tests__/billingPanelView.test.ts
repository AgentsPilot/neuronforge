/**
 * The admin billing panel builder (plan payments P-8a.2; AM-1, AC-AM.1,
 * AC-F4.1, AC-P8a.6). The real entitlement config is used. Tier ids come from
 * it, never from literals.
 */

import type { AdminBillingPanelRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { planLabel, planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import { buildBillingPanel } from '../billingPanelView';

const config = getEntitlementConfig();
const LOW = config.tierOrder[0];
const HIGH = config.tierOrder[config.tierOrder.length - 1];
const NOW = new Date('2026-10-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const PERIOD_END = iso(NOW.getTime() + 10 * DAY);
const ACCOUNT = '11111111-1111-4111-8111-000000000001';

function billing(patch: Partial<AdminBillingPanelRow> = {}): AdminBillingPanelRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    user_id: ACCOUNT,
    livemode: false,
    subscription_status: 'active',
    bought_tier: LOW,
    current_period_end: PERIOD_END,
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: iso(NOW.getTime() - 20 * DAY),
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
    stripe_customer_id: 'cus_TestCustomer1',
    ...patch,
  };
}

function plan(patch: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: ACCOUNT,
    tier: LOW,
    plan_version: 1,
    tier_expires_at: PERIOD_END,
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

const build = (b: AdminBillingPanelRow | null, p: BusinessOsAccountPlan | null, mode: 'test' | 'live' = 'test') =>
  buildBillingPanel({ billing: b, plan: p, config, now: NOW, mode });

describe('the two sides (AC-AM.1)', () => {
  it('a paying subscription: Stripe side, plan side, no disagreement, the test dashboard link', () => {
    const panel = build(billing(), plan());
    expect(panel.stripe).toMatchObject({
      stripeStatus: 'active',
      status: 'active',
      planBought: { id: LOW, name: planLabel(config, LOW) },
      currentPeriodEnd: PERIOD_END,
      mrrKind: 'counted',
      monthly: { currency: 'USD', hundredths: Math.round(planMonthlyPriceUsd(config, LOW) * 100) },
    });
    expect(panel.stripe?.monthly?.label).toMatch(/^\$\d/);
    expect(panel.stripe).toMatchObject({
    });
    expect(panel.plan).toMatchObject({ tier: { id: LOW, name: planLabel(config, LOW) }, paidThrough: PERIOD_END, state: 'active', origin: 'admin' });
    expect(panel.disagreements).toEqual([]);
    expect(panel.customerDashboardUrl).toBe('https://dashboard.stripe.com/test/customers/cus_TestCustomer1');
  });

  it('a live row links to the live dashboard', () => {
    expect(build(billing({ livemode: true }), plan(), 'live').customerDashboardUrl).toBe(
      'https://dashboard.stripe.com/customers/cus_TestCustomer1'
    );
  });

  it('an admin-assigned plan with no billing row: "No Stripe subscription" (AC-F4.1)', () => {
    const panel = build(null, plan());
    expect(panel.stripe).toBeNull();
    expect(panel.plan?.tier?.id).toBe(LOW);
    expect(panel.disagreements).toEqual([]);
    expect(panel.customerDashboardUrl).toBeNull();
  });

  it('a customer with no subscription (an abandoned checkout): no Stripe side, but the customer link', () => {
    const panel = build(billing({ subscription_status: null }), plan());
    expect(panel.stripe).toBeNull();
    expect(panel.customerDashboardUrl).toBe('https://dashboard.stripe.com/test/customers/cus_TestCustomer1');
  });

  it('a row of the other mode is ignored (PF-15)', () => {
    const panel = build(billing({ livemode: true }), plan(), 'test');
    expect(panel.stripe).toBeNull();
    expect(panel.customerDashboardUrl).toBeNull();
  });

  it('no plan row', () => {
    expect(build(billing(), null).plan).toBeNull();
  });

  it('statuses come from the list’s rule: cancelling, failed, grace', () => {
    expect(build(billing({ cancel_at_period_end: true }), plan()).stripe?.status).toBe('cancelling');
    const grace = build(
      billing({ subscription_status: 'past_due', failed_attempts: 1 }),
      plan({ tier_expires_at: iso(NOW.getTime() - 2 * DAY) })
    );
    expect(grace.stripe?.statuses).toEqual(['grace', 'failed']);
    expect(grace.plan?.state).toBe('grace');
  });

  it('past due is still counted, and flagged so the drawer shows it apart (BQ-P8a-4)', () => {
    const panel = build(billing({ subscription_status: 'past_due', failed_attempts: 1 }), plan());
    expect(panel.stripe).toMatchObject({ mrrKind: 'counted', monthly: { pastDue: true } });
    expect(build(billing(), plan()).stripe?.monthly?.pastDue).toBe(false);
  });

  it('a founder discount is never priced at list price', () => {
    const panel = build(billing({ founder_discount_applied_at: '2026-10-01T00:00:00.000Z' }), plan());
    expect(panel.stripe).toMatchObject({ discounted: true, mrrKind: 'discount_unknown', monthly: null });
  });

  it('a trialing subscription is not counted in MRR', () => {
    expect(build(billing({ subscription_status: 'trialing' }), plan()).stripe).toMatchObject({ mrrKind: 'not_paying', monthly: null });
  });
});

describe('disagreements from stored records (AC-P8a.6)', () => {
  it('the plan row holds another tier', () => {
    if (LOW === HIGH) return;
    expect(build(billing(), plan({ tier: HIGH })).disagreements).toEqual(['tier_differs']);
  });

  it('the paid-through date differs from Stripe’s period end', () => {
    expect(build(billing(), plan({ tier_expires_at: iso(NOW.getTime() + 3 * DAY) })).disagreements).toEqual([
      'paid_through_differs',
    ]);
  });

  it('the same instant written differently is not a disagreement', () => {
    expect(build(billing(), plan({ tier_expires_at: PERIOD_END.replace('Z', '+00:00') })).disagreements).toEqual([]);
  });

  it('a paying subscription whose plan row has no tier', () => {
    expect(build(billing(), plan({ tier: null, plan_version: 0, tier_expires_at: null })).disagreements).toEqual([
      'no_tier_on_plan',
    ]);
    expect(build(billing(), null).disagreements).toEqual(['no_tier_on_plan']);
  });

  it('an ended or not-paying subscription raises nothing', () => {
    expect(build(billing({ ended_at: NOW.toISOString(), subscription_status: 'canceled' }), plan({ tier: HIGH })).disagreements).toEqual([]);
    expect(build(billing({ subscription_status: 'trialing' }), plan({ tier: null, plan_version: 0 })).disagreements).toEqual([]);
  });
});

describe('payload', () => {
  it('carries no Stripe id but the customer’s, and only inside its dashboard link', () => {
    const text = JSON.stringify(build(billing(), plan()));
    expect(text.match(/\b(cus|sub|in|cs|pi)_[A-Za-z0-9]+/g)).toEqual(['cus_TestCustomer1']);
    expect(text).toContain('"customerDashboardUrl":"https://dashboard.stripe.com/test/customers/cus_TestCustomer1"');
  });
});
