/**
 * AC-F8.3 walked end to end (plan payments P-7a.3; requirement §9.1.2 F-3;
 * workplan §1.3, §7 "AC-F8.3"): a Founding Partner who cancels keeps the paid
 * plan to the paid-through date, and is then back on Founding Partner, with the
 * pill, while their free access is still live. AC-F8.2 (grace, then paused)
 * applies only to an account with no live free access to fall back to.
 *
 * No behaviour change was needed (SA, F-3 confirmed in code 2026-10-13; P-6a.1
 * FC-1). This walk pins it across every piece the owner sees, each one the REAL
 * function, so a change to any of them that breaks the promise fails here:
 *
 *   the cancel          `planManageOffer` / `billingStateFromRecord` on our billing row
 *   who decides access  `resolveEntitlements` → `deriveLifecycle` on the plan row
 *   the pill            `planBadgeFor`
 *   the banner          `planPaymentNotice` (no "ended" notice unless grace / paused)
 *   the sentence        `freeAccessAfterPaidTier` (BQ-5) names the same date the
 *                       lifecycle then uses
 *
 * The free-access cohort and the paid tier are found by STRUCTURE in the
 * production config (no cohort or tier name is written here).
 */

import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { planBadgeFor } from '@/lib/business-os/entitlements/planBadge';
import { freeAccessAfterPaidTier } from '@/lib/business-os/entitlements/freeAccess';
import { tierAccount } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import type { EntitlementAccount } from '@/lib/business-os/entitlements/account';
import { planManageOffer } from '@/lib/business-os/billing/planManageOffer';
import { planPaymentNotice, type PaymentNoticeBillingFacts } from '@/lib/business-os/billing/planPaymentNotice';
import { billingStateFromRecord } from '@/lib/business-os/billing/planPurchaseView';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const config = readCodeConfig();
const [PAID_TIER] = config.tierOrder;
const cohorts = config.cohorts as Readonly<Record<string, { durationHistory?: unknown }>>;
/** The admin-dated cohort (no duration): the Founding Partner shape. */
const FREE_ACCESS = Object.keys(cohorts).find((id) => !cohorts[id].durationHistory) as string;

const DAY = 86400000;
const HOUR = 3600000;
const MARGIN_MS = config.lifecycle.renewalSettlementMarginHistory[0].days * DAY;
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** Stripe's paid-through date (`current_period_end`, written verbatim to `tier_expires_at`). */
const PAID_THROUGH = '2026-11-10T00:00:00.000Z';
const CANCELLED_AT = '2026-10-20T09:00:00.000Z';
const FREE_UNTIL = '2027-03-01T00:00:00.000Z';

const LIFECYCLE = {
  cohorts: config.cohorts,
  tierOrder: config.tierOrder,
  subscriptionGraceHistory: config.lifecycle.subscriptionGraceHistory,
  renewalSettlementMarginHistory: config.lifecycle.renewalSettlementMarginHistory,
};

/** The plan row after the purchase: the apply function wrote the tier, never the cohort (F-3). */
const foundingPartner: EntitlementAccount = tierAccount(PAID_TIER, {
  tierExpiresAt: PAID_THROUGH,
  cohort: FREE_ACCESS,
  cohortExpiresAt: FREE_UNTIL,
});
const plainPayer: EntitlementAccount = tierAccount(PAID_TIER, { tierExpiresAt: PAID_THROUGH });

/** Our billing row: cancelled at period end, then ended by Stripe on the paid-through date. */
const cancelling = {
  stripeSubscriptionId: 'sub_1',
  subscriptionStatus: 'active' as 'active' | 'canceled',
  cancelAtPeriodEnd: true,
  currentPeriodEnd: PAID_THROUGH,
  endedAt: null as string | null,
  failedAttempts: 0,
};
const ended = { ...cancelling, subscriptionStatus: 'canceled' as const, endedAt: PAID_THROUGH };
const noticeFacts = (row: typeof cancelling): PaymentNoticeBillingFacts => ({
  livemode: false,
  subscriptionStatus: row.subscriptionStatus,
  failedAttempts: row.failedAttempts,
  lastPaymentFailedAt: null,
  actionRequiredInvoiceUrl: null,
  endedAt: row.endedAt,
  currentPeriodEnd: row.currentPeriodEnd,
  boughtTier: PAID_TIER,
});

function at(account: EntitlementAccount, iso: string) {
  const resolution = resolveEntitlements({ config, account, overrides: [], addons: [], now: new Date(iso) });
  return { resolution, pill: planBadgeFor(resolution, config) };
}
const notice = (row: typeof cancelling, lifecycle: { state: string; graceEndsAt: string | null }) =>
  planPaymentNotice(noticeFacts(row), lifecycle, { serverLivemode: false, enforcing: false });

describe('AC-F8.3: a Founding Partner who cancels', () => {
  it('non-vacuity: the production config has an admin-dated cohort and a paid tier', () => {
    expect(FREE_ACCESS).toBeDefined();
    expect(PAID_TIER).toBeDefined();
  });

  it('1. right after cancelling: "Ends on" the paid-through date, Reactivate offered, still on the paid plan, no pill, no banner', () => {
    expect(planManageOffer(cancelling, { pricesEnabled: true }, new Date(CANCELLED_AT))).toEqual({ kind: 'cancelling' });
    expect(billingStateFromRecord(cancelling, new Date(CANCELLED_AT))).toEqual({ state: 'ending', date: PAID_THROUGH });

    const { resolution, pill } = at(foundingPartner, CANCELLED_AT);
    expect(resolution.basis).toEqual({ kind: 'tier', tier: PAID_TIER });
    expect(resolution.state).toBe('active');
    expect(pill).toBeNull();
    expect(notice(cancelling, resolution.lifecycle)).toBeNull();
  });

  it('2. BQ-5: the sentence names the free-access end, which is the date the lifecycle then uses', () => {
    expect(freeAccessAfterPaidTier(foundingPartner, LIFECYCLE)).toEqual({ endsAt: FREE_UNTIL });
    expect(freeAccessAfterPaidTier(plainPayer, LIFECYCLE)).toBeNull();
  });

  it('3. through the paid-through date and the 24 h margin: still the paid plan (FC-1)', () => {
    for (const iso of [plus(PAID_THROUGH, -HOUR), PAID_THROUGH, plus(PAID_THROUGH, MARGIN_MS - 1)]) {
      const { resolution, pill } = at(foundingPartner, iso);
      expect(resolution.basis).toEqual({ kind: 'tier', tier: PAID_TIER });
      expect(pill).toBeNull();
    }
  });

  it('4. Stripe ends it; after the margin: back on Founding Partner, with the pill, no "ended" banner, while free access lives', () => {
    for (const iso of [plus(PAID_THROUGH, MARGIN_MS), plus(PAID_THROUGH, 10 * DAY), plus(FREE_UNTIL, -HOUR)]) {
      const { resolution, pill } = at(foundingPartner, iso);
      expect(resolution.basis).toEqual({ kind: 'cohort', cohort: FREE_ACCESS });
      expect(resolution.lifecycle.accessEndsAt).toBe(FREE_UNTIL);
      expect(resolution.state).not.toBe('grace');
      expect(resolution.state).not.toBe('paused');
      expect(pill).not.toBeNull();
      expect(notice(ended, resolution.lifecycle)).toBeNull();
      // Nothing left to cancel or reactivate.
      expect(planManageOffer(ended, { pricesEnabled: true }, new Date(iso))).toEqual({ kind: 'none', reason: 'not_active' });
    }
  });

  it('5. when the free access itself ends: the pill goes, grace starts, and the banner says the subscription ended', () => {
    const { resolution, pill } = at(foundingPartner, plus(FREE_UNTIL, HOUR));
    expect(resolution.state).toBe('grace');
    expect(pill).toBeNull();
    expect(notice(ended, resolution.lifecycle)).toMatchObject({ kind: 'ended', endedAt: PAID_THROUGH });
  });
});

describe('AC-F8.2 contrast: no free access to fall back to', () => {
  it('after the margin: grace with the "ended" banner, then paused; never the pill', () => {
    const grace = at(plainPayer, plus(PAID_THROUGH, MARGIN_MS));
    expect(grace.resolution.state).toBe('grace');
    expect(grace.pill).toBeNull();
    expect(notice(ended, grace.resolution.lifecycle)).toMatchObject({ kind: 'ended' });

    const graceEndsAt = grace.resolution.lifecycle.graceEndsAt as string;
    expect(at(plainPayer, graceEndsAt).resolution.state).toBe('paused');
  });

  it('free access that ends INSIDE the paid period does not come back, and earns no BQ-5 sentence', () => {
    const lapsed = tierAccount(PAID_TIER, { tierExpiresAt: PAID_THROUGH, cohort: FREE_ACCESS, cohortExpiresAt: '2026-11-01T00:00:00.000Z' });
    expect(freeAccessAfterPaidTier(lapsed, LIFECYCLE)).toBeNull();
    const { resolution, pill } = at(lapsed, plus(PAID_THROUGH, 2 * DAY));
    expect(resolution.state).toBe('grace');
    expect(pill).toBeNull();
  });
});
