/**
 * The admin billing panel payload (plan payments P-8a.2, AM-1; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md §5.2).
 *
 * Types only, with no runtime import, so the drawer can share them with the
 * route without pulling server code into its bundle.
 *
 * @module lib/admin/billing/billingPanelTypes
 */

import type { SubscriptionPlanName, SubscriptionStatus } from './subscriptionsTypes';

/**
 * Where the stored mirror and the plan row disagree, while the subscription is
 * paying. These come from OUR stored records only. The check against Stripe
 * itself is P-8b's reconciliation (AM-5).
 */
export type BillingDisagreement = 'tier_differs' | 'paid_through_differs' | 'no_tier_on_plan';

/** How this subscription counts in MRR (`mrrTreatment`, the one rule). */
export type BillingMrrKind = 'counted' | 'not_paying' | 'unpriced' | 'discount_unknown';

export interface BillingPanelStripeSide {
  /** Stripe's status as mirrored on the billing record (display only). */
  stripeStatus: string;
  status: SubscriptionStatus;
  statuses: SubscriptionStatus[];
  planBought: SubscriptionPlanName | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: SubscriptionPlanName | null;
  lastPaidAt: string | null;
  lastPaymentFailedAt: string | null;
  failedAttempts: number;
  endedAt: string | null;
  discounted: boolean;
  mrrKind: BillingMrrKind;
  /**
   * The monthly amount counted in MRR; null unless `mrrKind` is `counted`. `label` is
   * formatted on the server (the drawer imports nothing from lib/business-os).
   */
  /** `pastDue`: counted while past due (BQ-P8a-4), so the drawer shows it apart. */
  monthly: { currency: string; hundredths: number; label: string; pastDue: boolean } | null;
}

export interface BillingPanelPlanSide {
  /** The plan row's tier (the plan in force decides access, Q-T9). */
  tier: SubscriptionPlanName | null;
  /** The free access recorded under it (trial or Founding Partner), if any. */
  cohort: SubscriptionPlanName | null;
  /** `tier_expires_at`. */
  paidThrough: string | null;
  /** The derived lifecycle state (`deriveLifecycle`). */
  state: string;
  /** Who set the row up (`origin`): admin, invite, signup. */
  origin: string;
}

export interface BillingPanelPayload {
  generatedAt: string;
  /** The current Stripe mode (PF-15): the panel shows this mode's billing row only. */
  mode: 'test' | 'live';
  /** `null`: no subscription in this mode ("No Stripe subscription", AC-F4.1). */
  stripe: BillingPanelStripeSide | null;
  /** `null`: the account has no plan row. */
  plan: BillingPanelPlanSide | null;
  disagreements: BillingDisagreement[];
  /** The Stripe dashboard page of this account's customer, built on the server; null when there is none. */
  customerDashboardUrl: string | null;
}
