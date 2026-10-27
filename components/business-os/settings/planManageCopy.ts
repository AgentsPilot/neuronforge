/**
 * Settings → Plan: what the owner reads when the cancel or reactivate route
 * refuses (plan payments P-7a.1; workplan §4.2, §11), and the portal and
 * invoices routes' paths and refusal lines (P-7a.2; workplan §4.4, §4.5).
 *
 * By the route's refusal `code`, to a dictionary key, never the server's
 * English message. Typed over `PlanManageRefusalCode` (a TYPE import only, so
 * nothing from the billing module reaches the browser bundle): a new refusal
 * code fails the build until it is given a line here. `not_available` is the
 * routes' 404 (the price switch turned off after the page loaded) and
 * `invalid_input` their 400. A 401 reads "signed out"; anything else unknown
 * reads the generic line. A refusal with `outcomeUnknown` reads "could not
 * confirm" whatever its code: the change may have been made.
 *
 * Client-safe: plain data and type-only imports.
 */

import type { PlanManageRefusalCode } from '@/lib/business-os/billing/planSubscriptionManage';
import type { PlanBillingDocsRefusalCode } from '@/lib/business-os/billing/planBillingDocuments';

export const PLAN_MANAGE_REFUSAL_KEYS: Readonly<Record<PlanManageRefusalCode | 'not_available' | 'invalid_input', string>> = {
  not_available: 'plan.manage.refusal.unavailable',
  invalid_input: 'plan.manage.refusal.generic',
  manage_unavailable: 'plan.manage.refusal.unavailable',
  billing_row_unreadable: 'plan.manage.refusal.unavailable',
  not_subscribed: 'plan.manage.refusal.not_subscribed',
  subscription_not_active: 'plan.manage.refusal.not_active',
  payment_failed_contact_us: 'plan.manage.payment_failed_contact',
  billing_record_mismatch: 'plan.manage.refusal.support',
  upgrade_pending: 'plan.manage.refusal.upgrade_pending',
  stripe_error: 'plan.manage.refusal.stripe_error',
};

/** The dictionary key for a refused cancel or reactivate. Never the server's English. */
export function planManageRefusalKey(refusal: { httpStatus: number; code: string | null; outcomeUnknown: boolean }): string {
  if (refusal.outcomeUnknown) return 'plan.manage.refusal.unknown';
  if (refusal.code !== null && Object.prototype.hasOwnProperty.call(PLAN_MANAGE_REFUSAL_KEYS, refusal.code)) {
    return PLAN_MANAGE_REFUSAL_KEYS[refusal.code as keyof typeof PLAN_MANAGE_REFUSAL_KEYS];
  }
  return refusal.httpStatus === 401 ? 'plan.refusal.signed_out' : 'plan.manage.refusal.generic';
}

export const PLAN_CANCEL_PATH = '/api/business-os/billing/plan/cancel';
export const PLAN_REACTIVATE_PATH = '/api/business-os/billing/plan/reactivate';

// ── P-7a.2: Update card (portal) and the invoice list ──────────────────────

export const PLAN_PORTAL_PATH = '/api/business-os/billing/plan/portal';
export const PLAN_INVOICES_PATH = '/api/business-os/billing/plan/invoices';

/**
 * The portal and invoices routes' refusal `code` → dictionary key (type-only
 * import of the codes, as above). They reuse the cancel / reactivate lines:
 * the owner reads the same sentence for the same situation.
 */
export const PLAN_BILLING_DOCS_REFUSAL_KEYS: Readonly<Record<PlanBillingDocsRefusalCode | 'not_available' | 'invalid_input', string>> = {
  not_available: 'plan.manage.refusal.unavailable',
  invalid_input: 'plan.manage.refusal.generic',
  documents_unavailable: 'plan.manage.refusal.unavailable',
  billing_row_unreadable: 'plan.manage.refusal.unavailable',
  no_billing_account: 'plan.manage.refusal.not_subscribed',
  portal_unavailable: 'plan.manage.refusal.unavailable',
  stripe_error: 'plan.manage.refusal.stripe_error',
};

/** The dictionary key for a refused portal open. Never the server's English. */
export function planBillingDocsRefusalKey(refusal: { httpStatus: number; code: string | null }): string {
  if (refusal.code !== null && Object.prototype.hasOwnProperty.call(PLAN_BILLING_DOCS_REFUSAL_KEYS, refusal.code)) {
    return PLAN_BILLING_DOCS_REFUSAL_KEYS[refusal.code as keyof typeof PLAN_BILLING_DOCS_REFUSAL_KEYS];
  }
  return refusal.httpStatus === 401 ? 'plan.refusal.signed_out' : 'plan.manage.refusal.generic';
}

/** `billing_reason` → the row's "what it was for" line. */
export const PLAN_INVOICE_REASON_KEYS: Readonly<Record<string, string>> = {
  subscription_create: 'plan.invoices.reason.subscription_create',
  subscription_cycle: 'plan.invoices.reason.subscription_cycle',
  subscription_update: 'plan.invoices.reason.subscription_update',
  other: 'plan.invoices.reason.other',
};

/** Stripe's invoice status → the owner's word (U-10: `void` reads "Not charged", never "failed"). */
export const PLAN_INVOICE_STATUS_KEYS: Readonly<Record<string, string>> = {
  paid: 'plan.invoices.status.paid',
  open: 'plan.invoices.status.open',
  void: 'plan.invoices.status.void',
  uncollectible: 'plan.invoices.status.uncollectible',
};
