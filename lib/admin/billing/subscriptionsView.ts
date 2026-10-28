import 'server-only';

/**
 * The admin Subscriptions list and its totals (plan payments P-8a.1, AM-2 and
 * AM-3; workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md
 * §5.2, SA-WP-P8a).
 *
 * PURE given its input: the billing rows of ONE Stripe mode (already filtered
 * by the read, PF-15), every plan row, the entitlement config, `now` and the
 * status filter. No I/O and no clock of its own.
 *
 * Which accounts are listed (BQ-P8a-5, settled by AM-2's own filters):
 *   - every billing row of this mode that has a subscription (a status);
 *   - "No Stripe": a plan row with a tier and no subscription in this mode
 *     (an admin-assigned plan, a comp).
 * Trials and free Founding Partners are not subscriptions and are not listed.
 *
 * Statuses: from the billing record (Stripe's mirrored status, the
 * cancel flag, the failed-attempt count P-6a writes on renewals only, the end)
 * and from the PLAN ROW's lifecycle (grace and paused are derived, never
 * stored: `deriveLifecycle`, the same call the Finance classifier makes). Read
 * for DISPLAY only: nothing here refuses anything (registered as a non-gate
 * importer).
 *
 * Money: MRR is `computeMrr` (`lib/business-os/billing/planMrr.ts`), the one
 * rule. Prices come from the config's `presentation` (SA-WP-P8a (d)). No tier
 * literal: tiers come from the rows and the config only.
 *
 * @module lib/admin/billing/subscriptionsView
 */

import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { deriveLifecycle, type LifecycleResult } from '@/lib/business-os/entitlements/lifecycle';
import { planLabel, planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import { lifecycleInputs } from '@/lib/business-os/entitlements/report';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { computeMrr, mrrTreatment, type MrrPrice, type MrrResult } from '@/lib/business-os/billing/planMrr';
import { isPayingBillingRow } from '@/lib/business-os/billing/payingSubscriptionStatuses';
import { toHundredths } from '@/lib/business-os/finance/currencyGroups';
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTIONS_ROW_CAP,
  type BillingDisagreement,
  type SubscriptionFilter,
  type SubscriptionPlanName,
  type SubscriptionRow,
  type SubscriptionStatus,
  type SubscriptionsPayload,
} from './subscriptionsTypes';

/** Stripe statuses that mean the subscription is over, whatever `ended_at` says. */
const ENDED_STRIPE_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);
/** Stripe statuses AM-2 names through its own filters; any other live one is `other`. */
const NAMED_STRIPE_STATUSES: ReadonlySet<string> = new Set(['active', 'past_due']);

/** The list order: what needs a look first, ended last. Not the chip precedence. */
const SORT_ORDER: readonly SubscriptionStatus[] = [
  'grace',
  'paused',
  'failed',
  'cancelling',
  'active',
  'other',
  'no_stripe',
  'ended',
];

/**
 * The catalog's monthly list price of a tier, excluding tax, in hundredths of
 * USD (the field is `monthlyPriceUsd`). A tier the config does not have has
 * no price: `null`, so MRR counts it as unpriced and never as 0.
 */
export function catalogPriceOf(config: EntitlementConfig): (tier: string) => MrrPrice | null {
  return (tier) => {
    if (!config.tierOrder.includes(tier)) return null;
    const hundredths = toHundredths(planMonthlyPriceUsd(config, tier));
    return hundredths === null ? null : { currency: 'USD', monthlyHundredths: hundredths };
  };
}

function nameOf(config: EntitlementConfig, planId: string | null): SubscriptionPlanName | null {
  return planId === null || planId === '' ? null : { id: planId, name: planLabel(config, planId) };
}

/** The statuses of one subscription row; never empty. Exported for the billing panel (P-8a.2): one rule for both. */
export function subscriptionStatuses(row: AdminBillingRow, lifecycle: LifecycleResult | null): SubscriptionStatus[] {
  const stripe = row.subscription_status;
  const ended = row.ended_at !== null || (stripe !== null && ENDED_STRIPE_STATUSES.has(stripe));
  const has: Record<SubscriptionStatus, boolean> = {
    ended,
    paused: lifecycle?.state === 'paused',
    grace: lifecycle?.state === 'grace',
    failed: !ended && (row.failed_attempts > 0 || stripe === 'past_due'),
    cancelling: !ended && row.cancel_at_period_end,
    active: !ended && stripe === 'active' && !row.cancel_at_period_end && row.failed_attempts === 0,
    other: !ended && stripe !== null && !NAMED_STRIPE_STATUSES.has(stripe),
    no_stripe: false,
  };
  return SUBSCRIPTION_STATUSES.filter((status) => has[status]);
}

/**
 * The paid-through date and Stripe's period end are written from the same
 * invoice (SA-P3 Q-7), so they normally match exactly. One second absorbs a
 * difference in how the two timestamps are formatted, never a real gap.
 * (Moved with the rule from `billingPanelView.ts`, P-8b.3a.)
 */
const SAME_INSTANT_MS = 1000;

function sameInstant(a: string, b: string): boolean {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(ms) && ms <= SAME_INSTANT_MS;
}

/**
 * Where our billing record and the plan row disagree (AM-1's stored
 * disagreements). ONE rule for the billing panel and the Subscriptions list's
 * "Disagrees" marker (plan payments P-8b.3a, SA P3-SA-4): moved here from
 * `buildBillingPanel` unchanged. Stored records only, never Stripe itself
 * (ruling 4, option A).
 *
 * Disagreements only while the subscription is paying: an ended or
 * cancelled-and-lapsed subscription is expected to differ from the plan row.
 */
export function billingDisagreements(row: AdminBillingRow, plan: BusinessOsAccountPlan | null): BillingDisagreement[] {
  const disagreements: BillingDisagreement[] = [];
  if (isPayingBillingRow(row)) {
    const planTier = plan?.tier ?? null;
    if (planTier === null || planTier === '') {
      disagreements.push('no_tier_on_plan');
    } else if (row.bought_tier !== null && row.bought_tier !== planTier) {
      disagreements.push('tier_differs');
    }
    const paidThrough = plan?.tier_expires_at ?? null;
    if (
      planTier !== null &&
      planTier !== '' &&
      row.current_period_end !== null &&
      (paidThrough === null || !sameInstant(paidThrough, row.current_period_end))
    ) {
      disagreements.push('paid_through_differs');
    }
  }
  return disagreements;
}

/** The statuses of an admin-assigned plan with no subscription in this mode. */
function noStripeStatuses(lifecycle: LifecycleResult): SubscriptionStatus[] {
  const has: Partial<Record<SubscriptionStatus, boolean>> = {
    paused: lifecycle.state === 'paused',
    grace: lifecycle.state === 'grace',
    no_stripe: true,
  };
  return SUBSCRIPTION_STATUSES.filter((status) => has[status] === true);
}

const sortKey = (row: SubscriptionRow): number => SORT_ORDER.indexOf(row.status);
const dateKey = (row: SubscriptionRow): string => row.currentPeriodEnd ?? row.paidThrough ?? '9999';

function compareRows(a: SubscriptionRow, b: SubscriptionRow): number {
  return (
    sortKey(a) - sortKey(b) ||
    (dateKey(a) < dateKey(b) ? -1 : dateKey(a) > dateKey(b) ? 1 : 0) ||
    (a.accountId ?? '~').localeCompare(b.accountId ?? '~')
  );
}

/**
 * Money MK-4 (SA-2): the MRR of one Stripe mode's billing rows, the ONE place
 * both the Subscriptions list and the Finance payload get it from, so the two
 * figures are equal by construction. A defensive mode check (PF-15) and only
 * rows that have a subscription status, as the list counts them.
 */
export function subscriptionsMrr(
  billingRows: readonly AdminBillingRow[],
  config: EntitlementConfig,
  mode: 'test' | 'live'
): MrrResult {
  const livemode = mode === 'live';
  const subscribed = billingRows.filter((row) => row.livemode === livemode && row.subscription_status !== null);
  return computeMrr(subscribed, { livemode, priceOf: catalogPriceOf(config) });
}

export interface SubscriptionsInput {
  /** Billing rows of `mode` only (the read filters it). */
  billingRows: readonly AdminBillingRow[];
  planRows: readonly BusinessOsAccountPlan[];
  config: EntitlementConfig;
  now: Date;
  mode: 'test' | 'live';
  /** A status, or `disagrees` (P-8b.3a); null = all. */
  status: SubscriptionFilter | null;
}

export function buildSubscriptions(input: SubscriptionsInput): SubscriptionsPayload {
  const { billingRows, planRows, config, now, mode, status } = input;
  const livemode = mode === 'live';
  const inputs = lifecycleInputs(config);
  const priceOf = catalogPriceOf(config);

  const plans = new Map<string, BusinessOsAccountPlan>();
  for (const plan of planRows) plans.set(plan.user_id, plan);
  const lifecycleOf = (plan: BusinessOsAccountPlan | undefined): LifecycleResult | null =>
    plan ? deriveLifecycle(fromPlanRow(plan), inputs, now) : null;

  // A defensive mode check: the read already filtered, and a row of another
  // mode must never reach the list or the money (PF-15).
  const subscribed = billingRows.filter((row) => row.livemode === livemode && row.subscription_status !== null);
  const subscribedAccounts = new Set(subscribed.map((row) => row.user_id).filter((id): id is string => id !== null));

  const rows: SubscriptionRow[] = [];
  for (const billing of subscribed) {
    const plan = billing.user_id === null ? undefined : plans.get(billing.user_id);
    const statuses = subscriptionStatuses(billing, lifecycleOf(plan));
    rows.push({
      accountId: billing.user_id,
      businessName: null,
      status: statuses[0],
      statuses,
      stripeStatus: billing.subscription_status,
      planBought: nameOf(config, billing.bought_tier),
      planOnRecord: nameOf(config, plan?.tier ?? null),
      paidThrough: plan?.tier_expires_at ?? null,
      currentPeriodEnd: billing.current_period_end,
      cancelAtPeriodEnd: billing.cancel_at_period_end,
      endedAt: billing.ended_at,
      lastPaidAt: billing.last_paid_at,
      lastPaymentFailedAt: billing.last_payment_failed_at,
      failedAttempts: billing.failed_attempts,
      pendingPlan: nameOf(config, billing.pending_tier),
      discounted: billing.founder_discount_applied_at !== null,
      disagreements: billingDisagreements(billing, plan ?? null),
    });
  }

  for (const plan of planRows) {
    if (plan.tier === null || plan.tier === '' || subscribedAccounts.has(plan.user_id)) continue;
    const lifecycle = lifecycleOf(plan) as LifecycleResult;
    const statuses = noStripeStatuses(lifecycle);
    rows.push({
      accountId: plan.user_id,
      businessName: null,
      status: statuses[0],
      statuses,
      stripeStatus: null,
      planBought: null,
      planOnRecord: nameOf(config, plan.tier),
      paidThrough: plan.tier_expires_at,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      lastPaidAt: null,
      lastPaymentFailedAt: null,
      failedAttempts: 0,
      pendingPlan: null,
      discounted: false,
      // No billing row in this mode, so nothing to disagree with (the panel's answer too).
      disagreements: [],
    });
  }

  rows.sort(compareRows);

  const byStatus = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as Record<SubscriptionStatus, number>;
  for (const row of rows) for (const s of row.statuses) byStatus[s] += 1;

  const mrr = subscriptionsMrr(billingRows, config, mode);

  const paid = new Map<string, number>();
  for (const billing of subscribed) {
    const treatment = mrrTreatment(billing, { livemode, priceOf });
    if (treatment.kind === 'counted' && billing.bought_tier !== null) {
      paid.set(billing.bought_tier, (paid.get(billing.bought_tier) ?? 0) + 1);
    }
  }
  const tierIndex = (tier: string) => {
    const i = config.tierOrder.indexOf(tier);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const paidByPlan = [...paid.entries()]
    .sort(([a], [b]) => tierIndex(a) - tierIndex(b) || a.localeCompare(b))
    .map(([tier, accounts]) => ({ id: tier, name: planLabel(config, tier), accounts }));

  const matches = (row: SubscriptionRow): boolean =>
    status === null || (status === 'disagrees' ? row.disagreements.length > 0 : row.statuses.includes(status));
  const matchingRows = rows.filter(matches);

  return {
    generatedAt: now.toISOString(),
    mode,
    status,
    totals: {
      mrr: mrr.lines,
      mrrUnpriced: mrr.unpriced,
      mrrDiscountUnknown: mrr.discountUnknown,
      mrrPastDueCounted: mrr.pastDueCounted,
      paidByPlan,
      byStatus,
      accounts: rows.length,
      disagreeing: rows.filter((row) => row.disagreements.length > 0).length,
    },
    rows: matchingRows.slice(0, SUBSCRIPTIONS_ROW_CAP),
    matching: matchingRows.length,
  };
}

/**
 * Money MK-8 (KPI restructure review §3, Plans & subscriptions → "Plan drawer:
 * one plan's accounts, statuses and MRR"). ONE rule: the inputs are narrowed
 * to one plan and `buildSubscriptions` builds the list, so the drawer and the
 * Subscriptions list cannot disagree for the same rows.
 *
 * The plan's accounts are the billing rows (this mode, with a status) whose
 * bought plan is `planId`, plus the plan rows on `planId` that have NO billing
 * row of any plan in this mode ("No Stripe", admin-assigned). An account billed
 * on another plan is not this plan's, whatever its plan row says (that is the
 * panel's "tier differs" disagreement). MRR is therefore this plan's only.
 * The plan id is compared, never written: no tier literal here.
 */
export function buildPlanSubscriptions(input: SubscriptionsInput & { planId: string }): SubscriptionsPayload {
  const { planId, billingRows, planRows } = input;
  const livemode = input.mode === 'live';
  // SA-CR-MK8 CR-1: ONE predicate for "billed in this mode", the list's own (`subscribed` in
  // buildSubscriptions): this mode and a subscription status. A row with no status (a stale
  // `bought_tier` left on a never-subscribed or cleared row) is no plan's billing, so each
  // account lands in exactly one plan drawer, and MRR (which counts paying statuses only) agrees.
  const isBilled = (row: AdminBillingRow) => row.livemode === livemode && row.subscription_status !== null;
  const billedAnyPlan = new Set(
    billingRows.filter((row) => isBilled(row) && row.user_id !== null).map((row) => row.user_id as string)
  );
  const planBilling = billingRows.filter((row) => isBilled(row) && row.bought_tier === planId);
  const planAccounts = new Set(planBilling.map((row) => row.user_id).filter((id): id is string => id !== null));
  const planRowsForPlan = planRows.filter(
    (row) => planAccounts.has(row.user_id) || (row.tier === planId && !billedAnyPlan.has(row.user_id))
  );
  return buildSubscriptions({ ...input, billingRows: planBilling, planRows: planRowsForPlan });
}
