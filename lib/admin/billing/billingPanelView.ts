import 'server-only';

/**
 * The admin billing panel of ONE account (plan payments P-8a.2, AM-1, AC-AM.1,
 * AC-F4.1; workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md
 * §5.2, SA-WP-P8a).
 *
 * Two columns side by side (Q-T9):
 *   - Stripe, as MIRRORED on our billing record for the current mode. It is
 *     never a live Stripe call (§7 "Data source", SR-11);
 *   - the plan row, which decides access.
 * It also gives the stored-record disagreements and the customer's Stripe
 * dashboard link, which is built here from the stored customer id.
 *
 * PURE given its input. Statuses use the Subscriptions list's own helper and
 * the MRR amount the one MRR rule, so the drawer and the list cannot disagree.
 * Read for DISPLAY only: nothing here refuses anything (a registered non-gate
 * importer).
 *
 * @module lib/admin/billing/billingPanelView
 */

import type { AdminBillingPanelRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { deriveLifecycle } from '@/lib/business-os/entitlements/lifecycle';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import { lifecycleInputs } from '@/lib/business-os/entitlements/report';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { mrrTreatment } from '@/lib/business-os/billing/planMrr';
import { stripeDashboardUrl } from '@/lib/business-os/boost/boostAdminView';
import { formatMinorAmount } from '@/lib/business-os/currency';
import { billingDisagreements, catalogPriceOf, subscriptionStatuses } from './subscriptionsView';
import type { BillingPanelPayload, BillingPanelStripeSide } from './billingPanelTypes';
import type { SubscriptionPlanName } from './subscriptionsTypes';

function nameOf(config: EntitlementConfig, planId: string | null): SubscriptionPlanName | null {
  return planId === null || planId === '' ? null : { id: planId, name: planLabel(config, planId) };
}

export interface BillingPanelInput {
  /** The account's billing row in `mode`, or null. */
  billing: AdminBillingPanelRow | null;
  plan: BusinessOsAccountPlan | null;
  config: EntitlementConfig;
  now: Date;
  mode: 'test' | 'live';
}

export function buildBillingPanel(input: BillingPanelInput): BillingPanelPayload {
  const { billing, plan, config, now, mode } = input;
  const livemode = mode === 'live';
  // A defensive mode check: the read already filtered (PF-15).
  const row = billing !== null && billing.livemode === livemode ? billing : null;
  const lifecycle = plan ? deriveLifecycle(fromPlanRow(plan), lifecycleInputs(config), now) : null;

  let stripe: BillingPanelStripeSide | null = null;
  if (row !== null && row.subscription_status !== null) {
    const statuses = subscriptionStatuses(row, lifecycle);
    const treatment = mrrTreatment(row, { livemode, priceOf: catalogPriceOf(config) });
    stripe = {
      stripeStatus: row.subscription_status,
      status: statuses[0],
      statuses,
      planBought: nameOf(config, row.bought_tier),
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      pendingPlan: nameOf(config, row.pending_tier),
      lastPaidAt: row.last_paid_at,
      lastPaymentFailedAt: row.last_payment_failed_at,
      failedAttempts: row.failed_attempts,
      endedAt: row.ended_at,
      discounted: row.founder_discount_applied_at !== null,
      mrrKind: treatment.kind === 'other_mode' ? 'not_paying' : treatment.kind,
      monthly:
        treatment.kind === 'counted'
          ? {
              currency: treatment.price.currency,
              hundredths: treatment.price.monthlyHundredths,
              label: formatMinorAmount(treatment.price.monthlyHundredths, treatment.price.currency, 'en-US'),
              pastDue: treatment.pastDue,
            }
          : null,
    };
  }

  // The stored-record disagreements: ONE rule, shared with the Subscriptions
  // list's "Disagrees" marker (P-8b.3a, SA P3-SA-4), so the two cannot differ.
  const disagreements = row === null ? [] : billingDisagreements(row, plan);

  return {
    generatedAt: now.toISOString(),
    mode,
    stripe,
    plan: plan
      ? {
          tier: nameOf(config, plan.tier),
          cohort: nameOf(config, plan.cohort),
          paidThrough: plan.tier_expires_at,
          state: (lifecycle as NonNullable<typeof lifecycle>).state,
          origin: plan.origin,
        }
      : null,
    disagreements,
    // The row's own mode decides the dashboard (SA C-4 of the boost view); it equals the server's here.
    customerDashboardUrl: row === null ? null : stripeDashboardUrl('customer', row.stripe_customer_id, row.livemode),
  };
}
