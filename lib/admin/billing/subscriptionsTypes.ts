/**
 * The admin Subscriptions payload (plan payments P-8a.1, AM-2 and AM-3;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md §5.2).
 *
 * Types and constants only, with NO import, so the client page can share them
 * with the route without pulling server code into its bundle.
 *
 * @module lib/admin/billing/subscriptionsTypes
 */

/**
 * The list's statuses (AM-2), plus `other` for Stripe states AM-2 does not
 * name (trialing, incomplete, unpaid, paused in Stripe), so that every listed
 * row has a status. The chip shows the FIRST that applies, in this order
 * (workplan §5.2). A filter matches any status the row has.
 */
export const SUBSCRIPTION_STATUSES = [
  'ended',
  'paused',
  'grace',
  'failed',
  'cancelling',
  'active',
  'other',
  'no_stripe',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(raw: unknown): raw is SubscriptionStatus {
  return typeof raw === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(raw);
}

/**
 * Where the stored mirror and the plan row disagree, while the subscription is
 * paying. These come from OUR stored records only (plan payments P-8a.2;
 * moved here from `billingPanelTypes.ts` by P-8b.3a, which re-exports it, so
 * the list and the panel share one type). The check against Stripe itself is
 * the nightly reconcile's (AM-5), and is never shown as this.
 */
export type BillingDisagreement = 'tier_differs' | 'paid_through_differs' | 'no_tier_on_plan';

/**
 * The list's filter values (plan payments P-8b.3a, AM-2; SA P3-SA-2 item 5):
 * every status, plus `disagrees` (rows whose stored records disagree). ONE
 * constant for the Finance URL parser, the copy, the route's Zod and the view.
 * The chip keeps `isSubscriptionStatus`: `disagrees` is a filter, never a status.
 */
export const SUBSCRIPTION_FILTERS = [...SUBSCRIPTION_STATUSES, 'disagrees'] as const;

export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number];

export function isSubscriptionFilter(raw: unknown): raw is SubscriptionFilter {
  return typeof raw === 'string' && (SUBSCRIPTION_FILTERS as readonly string[]).includes(raw);
}

/** The route's 409 message when the server's Stripe key mode cannot be read. Never echoes the key. */
export const STRIPE_MODE_UNKNOWN =
  'The server’s Stripe key mode could not be read, so no subscription figures are shown.';

/** The most rows the list returns; the totals always cover every row (SA Q-5). */
export const SUBSCRIPTIONS_ROW_CAP = 200;

export interface SubscriptionPlanName {
  id: string;
  name: string;
}

export interface SubscriptionRow {
  /** NULL: a billing row detached from a deleted account. */
  accountId: string | null;
  /** Filled by the route after the cut, from the business profile. */
  businessName: string | null;
  status: SubscriptionStatus;
  statuses: SubscriptionStatus[];
  /** Stripe's status as mirrored on the billing record; NULL for "No Stripe". */
  stripeStatus: string | null;
  planBought: SubscriptionPlanName | null;
  /** The plan row's tier (the plan in force decides access, Q-T9). */
  planOnRecord: SubscriptionPlanName | null;
  /** The plan row's paid-through date (`tier_expires_at`). */
  paidThrough: string | null;
  /** Stripe's current period end, as mirrored. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  endedAt: string | null;
  lastPaidAt: string | null;
  lastPaymentFailedAt: string | null;
  failedAttempts: number;
  /** A downgrade waiting for the renewal (RD-7). */
  pendingPlan: SubscriptionPlanName | null;
  /** A founder discount is recorded (MRR then reads "amount not recorded"). */
  discounted: boolean;
  /**
   * P-8b.3a (AM-2): where our billing record and the plan row disagree, by the
   * billing panel's own rule (`billingDisagreements`). Empty when they agree.
   */
  disagreements: BillingDisagreement[];
}

export interface SubscriptionsMrrLine {
  currency: string | null;
  totalHundredths: number;
  cancellingHundredths: number;
  pastDueHundredths: number;
  subscriptions: number;
  overflow: boolean;
}

export interface SubscriptionsTotals {
  /** One line per currency, never one total across currencies. */
  mrr: SubscriptionsMrrLine[];
  mrrUnpriced: number;
  mrrDiscountUnknown: number;
  /** BQ-P8a-4: whether `past_due` counts in MRR. */
  mrrPastDueCounted: boolean;
  /** Subscriptions counted in MRR, by the plan bought (AM-3 "active paid accounts per plan"). */
  paidByPlan: Array<SubscriptionPlanName & { accounts: number }>;
  /** Rows having each status (a row can have several). */
  byStatus: Record<SubscriptionStatus, number>;
  /** Every listed row. */
  accounts: number;
  /** P-8b.3a: listed rows whose stored records disagree. Ignores the filter, like every total. */
  disagreeing: number;
}

export interface SubscriptionsPayload {
  generatedAt: string;
  /** The current Stripe mode (PF-15): every row and figure is this mode only. */
  mode: 'test' | 'live';
  /** The filter applied to `rows` (a status, or `disagrees`); `null` = all. Totals ignore it. */
  status: SubscriptionFilter | null;
  totals: SubscriptionsTotals;
  rows: SubscriptionRow[];
  /** Rows matching the filter, before the cap. */
  matching: number;
}
