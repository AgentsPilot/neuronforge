/**
 * The admin Subscriptions builder (plan payments P-8a.1, AM-2, AM-3; workplan
 * §5.2; AC-AM.2). The real entitlement config is used. Tier ids come from it,
 * never from literals (tier-literal rule).
 */

import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { planLabel, planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import { buildSubscriptions, catalogPriceOf } from '../subscriptionsView';
import { SUBSCRIPTIONS_ROW_CAP, type SubscriptionStatus } from '../subscriptionsTypes';

const config = getEntitlementConfig();
const LOW = config.tierOrder[0];
const HIGH = config.tierOrder[config.tierOrder.length - 1];
const NOW = new Date('2026-10-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const hundredths = (tier: string) => Math.round(planMonthlyPriceUsd(config, tier) * 100);

const account = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

function billing(n: number, patch: Partial<AdminBillingRow> = {}): AdminBillingRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: account(n),
    livemode: false,
    subscription_status: 'active',
    bought_tier: LOW,
    current_period_end: iso(NOW.getTime() + 10 * DAY),
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
    tier_expires_at: iso(NOW.getTime() + 10 * DAY),
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

const build = (billingRows: AdminBillingRow[], planRows: BusinessOsAccountPlan[], status: SubscriptionStatus | null = null) =>
  buildSubscriptions({ billingRows, planRows, config, now: NOW, mode: 'test', status });

describe('catalogPriceOf', () => {
  it('prices every configured tier from presentation, in USD hundredths', () => {
    const priceOf = catalogPriceOf(config);
    for (const tier of config.tierOrder) {
      expect(priceOf(tier)).toEqual({ currency: 'USD', monthlyHundredths: hundredths(tier) });
    }
  });

  it('a tier the config does not have has no price', () => {
    expect(catalogPriceOf(config)('not_a_configured_tier')).toBeNull();
  });
});

describe('statuses (AM-2)', () => {
  const statusOf = (b: AdminBillingRow, p: BusinessOsAccountPlan = plan(1)) => build([b], [p]).rows[0];

  it('a paying, renewing subscription is Active', () => {
    expect(statusOf(billing(1))).toMatchObject({ status: 'active', statuses: ['active'] });
  });

  it('cancelling at period end is Cancelling, not Active', () => {
    expect(statusOf(billing(1, { cancel_at_period_end: true }))).toMatchObject({ status: 'cancelling', statuses: ['cancelling'] });
  });

  it('a counted failed attempt, or past_due, is Failed', () => {
    expect(statusOf(billing(1, { failed_attempts: 2 })).statuses).toEqual(['failed']);
    expect(statusOf(billing(1, { subscription_status: 'past_due' })).statuses).toEqual(['failed']);
  });

  it('grace and paused come from the PLAN ROW lifecycle, and stack with Failed', () => {
    const graceRow = statusOf(
      billing(1, { subscription_status: 'past_due', failed_attempts: 1 }),
      plan(1, { tier_expires_at: iso(NOW.getTime() - 2 * DAY) })
    );
    expect(graceRow).toMatchObject({ status: 'grace', statuses: ['grace', 'failed'] });

    const pausedRow = statusOf(
      billing(1, { subscription_status: 'past_due', failed_attempts: 3 }),
      plan(1, { tier_expires_at: iso(NOW.getTime() - 20 * DAY) })
    );
    expect(pausedRow).toMatchObject({ status: 'paused', statuses: ['paused', 'failed'] });
  });

  it('an ended subscription is Ended first, whatever else applies', () => {
    const row = statusOf(
      billing(1, { subscription_status: 'canceled', ended_at: iso(NOW.getTime() - 20 * DAY) }),
      plan(1, { tier_expires_at: iso(NOW.getTime() - 20 * DAY) })
    );
    expect(row.status).toBe('ended');
    expect(row.statuses).toEqual(['ended', 'paused']);
  });

  it.each(['trialing', 'incomplete', 'unpaid', 'paused'])('Stripe %s is Other', (stripe) => {
    expect(statusOf(billing(1, { subscription_status: stripe })).statuses).toEqual(['other']);
  });

  it('every listed row has a status', () => {
    const { rows } = build(
      ['active', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'canceled'].map((s, i) =>
        billing(i + 1, { subscription_status: s })
      ),
      []
    );
    for (const row of rows) expect(row.statuses.length).toBeGreaterThan(0);
  });
});

describe('which accounts are listed (BQ-P8a-5)', () => {
  it('an admin-assigned tier with no subscription is No Stripe', () => {
    const { rows } = build([], [plan(5)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: account(5), status: 'no_stripe', stripeStatus: null, planBought: null });
    expect(rows[0].planOnRecord).toEqual({ id: LOW, name: planLabel(config, LOW) });
  });

  it('a subscribed account is never also No Stripe', () => {
    const { rows } = build([billing(1)], [plan(1)]);
    expect(rows.map((r) => r.status)).toEqual(['active']);
  });

  it('a billing row with no subscription (an abandoned checkout) is not listed by itself', () => {
    expect(build([billing(1, { subscription_status: null })], []).rows).toEqual([]);
    // ...and its admin-assigned tier is No Stripe.
    expect(build([billing(1, { subscription_status: null })], [plan(1)]).rows[0].status).toBe('no_stripe');
  });

  it('a plan row with no tier (a trial or a free Founding Partner) is not listed', () => {
    expect(build([], [plan(7, { tier: null, plan_version: 0, cohort: Object.keys(config.cohorts)[0] })]).rows).toEqual([]);
  });

  it('a row detached from a deleted account is listed with no account', () => {
    const { rows } = build([billing(1, { user_id: null })], []);
    expect(rows[0]).toMatchObject({ accountId: null, status: 'active' });
  });

  it('a row of the other mode never reaches the list or the money (PF-15)', () => {
    const result = build([billing(1, { livemode: true })], []);
    expect(result.rows).toEqual([]);
    expect(result.totals.mrr).toEqual([]);
  });
});

describe('totals (AM-3)', () => {
  it('MRR per currency, paid accounts per plan, and counts per status, over every row', () => {
    const result = build(
      [
        billing(1),
        billing(2, { bought_tier: HIGH }),
        billing(3, { cancel_at_period_end: true }),
        billing(4, { subscription_status: 'past_due', failed_attempts: 1 }),
        billing(5, { subscription_status: 'trialing' }),
      ],
      [plan(1), plan(2, { tier: HIGH }), plan(3), plan(4), plan(9)]
    );
    expect(result.totals.mrr).toEqual([
      {
        currency: 'USD',
        totalHundredths: hundredths(LOW) * 3 + hundredths(HIGH),
        cancellingHundredths: hundredths(LOW),
        pastDueHundredths: hundredths(LOW),
        subscriptions: 4,
        overflow: false,
      },
    ]);
    expect(result.totals.mrrPastDueCounted).toBe(true);
    const expectedPaid =
      LOW === HIGH
        ? [{ id: LOW, name: planLabel(config, LOW), accounts: 4 }]
        : [
            { id: LOW, name: planLabel(config, LOW), accounts: 3 },
            { id: HIGH, name: planLabel(config, HIGH), accounts: 1 },
          ];
    expect(result.totals.paidByPlan).toEqual(expectedPaid);
    expect(result.totals.byStatus).toMatchObject({ active: 2, cancelling: 1, failed: 1, other: 1, no_stripe: 1 });
    expect(result.totals.accounts).toBe(6);
  });

  it('a founder discount is counted apart, never at list price', () => {
    const result = build([billing(1, { founder_discount_applied_at: '2026-10-01T00:00:00.000Z' })], []);
    expect(result.totals.mrr).toEqual([]);
    expect(result.totals.mrrDiscountUnknown).toBe(1);
    expect(result.rows[0].discounted).toBe(true);
  });

  it('a bought tier no longer configured is unpriced', () => {
    const result = build([billing(1, { bought_tier: 'retired_tier' })], []);
    expect(result.totals.mrrUnpriced).toBe(1);
    expect(result.rows[0].planBought).toEqual({ id: 'retired_tier', name: 'retired_tier' });
  });
});

describe('filter and cap', () => {
  it('the filter narrows the rows; the totals stay over everything', () => {
    const result = build([billing(1), billing(2, { failed_attempts: 1 })], [], 'failed');
    expect(result.status).toBe('failed');
    expect(result.rows.map((r) => r.accountId)).toEqual([account(2)]);
    expect(result.matching).toBe(1);
    expect(result.totals.accounts).toBe(2);
  });

  it(`returns at most ${SUBSCRIPTIONS_ROW_CAP} rows, and says how many matched`, () => {
    const many = Array.from({ length: SUBSCRIPTIONS_ROW_CAP + 5 }, (_, i) => billing(i + 1));
    const result = build(many, []);
    expect(result.rows).toHaveLength(SUBSCRIPTIONS_ROW_CAP);
    expect(result.matching).toBe(SUBSCRIPTIONS_ROW_CAP + 5);
    expect(result.totals.byStatus.active).toBe(SUBSCRIPTIONS_ROW_CAP + 5);
  });

  it('what needs a look comes first, ended last', () => {
    const result = build(
      [
        billing(1, { ended_at: iso(NOW.getTime() - DAY), subscription_status: 'canceled' }),
        billing(2),
        billing(3, { failed_attempts: 1 }),
      ],
      [plan(1, { tier_expires_at: iso(NOW.getTime() - 20 * DAY) }), plan(2), plan(3)]
    );
    expect(result.rows.map((r) => r.status)).toEqual(['failed', 'active', 'ended']);
  });

  it('carries the mode and the server clock', () => {
    const result = build([], []);
    expect(result).toMatchObject({ mode: 'test', generatedAt: NOW.toISOString(), status: null, matching: 0 });
  });
});
