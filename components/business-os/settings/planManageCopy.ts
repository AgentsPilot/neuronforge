/**
 * Settings → Plan: what the owner reads when the cancel or reactivate route
 * refuses (plan payments P-7a.1; workplan §4.2, §11).
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
  // D2 / SX-1 (SA F-1): an existing line, so no new wording; D3 may give it its own.
  change_pending: 'plan.manage.refusal.unavailable',
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
