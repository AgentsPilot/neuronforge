/**
 * Settings → Plan: the line shown when the checkout route refuses a start
 * (plan payments P-4.2, M-7; the P-5a.2 holding-screen pattern, SA Q-8/W-10).
 *
 * By the route's refusal `code`, to a dictionary key, never the server's
 * English message. Typed over `PlanCheckoutRefusalCode` (a TYPE import only, so
 * nothing from the billing module reaches the browser bundle): a new refusal
 * code fails the build until it is given a line here. `not_available` is the
 * route's 404 (a switch turned off after the page loaded) and `invalid_input`
 * its 400. A 401 reads "signed out"; anything else unknown reads the generic
 * line.
 *
 * Client-safe: plain data and type-only imports.
 */

import type { PlanCheckoutRefusalCode } from '@/lib/business-os/billing/planCheckout';
import type { EndsFreeAccessOnPurchaseWire } from '@/lib/business-os/billing/planPurchaseTypes';

export const PLAN_PURCHASE_REFUSAL_KEYS: Readonly<Record<PlanCheckoutRefusalCode | 'not_available' | 'invalid_input', string>> = {
  not_available: 'plan.refusal.not_open',
  checkout_unavailable: 'plan.refusal.not_open',
  lock_unavailable: 'plan.refusal.not_open',
  held_payment_unavailable: 'plan.refusal.not_open',
  held_tier_unresolved: 'plan.refusal.not_open',
  held_tier_not_allowed: 'plan.refusal.not_open',
  price_unavailable: 'plan.refusal.price_unavailable',
  price_mismatch: 'plan.refusal.price_unavailable',
  checkout_open: 'plan.refusal.checkout_open',
  checkout_processing: 'plan.refusal.checkout_processing',
  checkout_busy: 'plan.refusal.busy',
  retry_later: 'plan.refusal.busy',
  subscription_live: 'plan.refusal.subscription_live',
  free_access_no_end_date: 'plan.refusal.free_access_no_end_date',
  no_plan_row: 'plan.refusal.not_ready',
  email_required: 'plan.refusal.email_required',
  billing_record_conflict: 'plan.refusal.support',
  hold_unreadable: 'plan.refusal.generic',
  plan_unreadable: 'plan.refusal.generic',
  billing_row_unreadable: 'plan.refusal.generic',
  subscription_check_incomplete: 'plan.refusal.generic',
  stripe_error: 'plan.refusal.generic',
  invalid_input: 'plan.refusal.generic',
};

/** The dictionary key for a refused start. Never the server's English. */
export function planPurchaseRefusalKey(refusal: { httpStatus: number; code: string | null }): string {
  if (refusal.code !== null && Object.prototype.hasOwnProperty.call(PLAN_PURCHASE_REFUSAL_KEYS, refusal.code)) {
    return PLAN_PURCHASE_REFUSAL_KEYS[refusal.code as keyof typeof PLAN_PURCHASE_REFUSAL_KEYS];
  }
  return refusal.httpStatus === 401 ? 'plan.refusal.signed_out' : 'plan.refusal.generic';
}

/**
 * A dictionary template with its `{name}` slots filled. A function replacer, so
 * a `$` in a value ("$79") is printed, never read as a `$&`-style pattern (the
 * same rule as `PlanSection`'s `fill`).
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : slot));
}

/** Where Stripe's completion sends the owner: Settings → Plan with the return marker. */
export const SETTINGS_PLAN_PATH = '/business-os/settings?section=plan';

export function settingsPlanReturnPath(sessionId: string): string {
  return `${SETTINGS_PLAN_PATH}&checkout=${encodeURIComponent(sessionId)}`;
}

/**
 * The sentence beside an offer when buying ends free access (plan payments W-7),
 * by the server's `endsFreeAccessOnPurchase`. One map for the Choose island and
 * the plan comparison modal (upgrade modal UM-1a D-4, moved here in UM-1b).
 */
export const ENDS_FREE_ACCESS_KEYS: Readonly<Record<Exclude<EndsFreeAccessOnPurchaseWire, null>, string>> = {
  trial: 'plan.choose.trial_ends_today',
  free_access: 'plan.choose.free_access_ends_today',
};
