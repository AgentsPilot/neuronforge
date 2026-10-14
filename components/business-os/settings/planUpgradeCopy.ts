/**
 * Settings → Plan: what the owner reads when an upgrade route refuses (plan
 * payments P-7b.1b; workplan §3.7, §10; SA U-5, V-3, Q-2, Q-6).
 *
 * By the route's refusal `code`, to a dictionary key, never the server's
 * English message. Typed over `PlanUpgradeRefusalCode` (a TYPE import only, so
 * nothing from the billing module reaches the browser bundle): a new refusal
 * code fails the build until it is given a line here. `not_available` is the
 * routes' 404 (the checkout switch turned off after the page loaded) and
 * `invalid_input` their 400. A 401 reads "signed out"; anything else unknown
 * reads the generic line.
 *
 * Three codes are not a line but a STATE, decided in `PlanUpgrade.tsx`:
 *   upgrade_awaiting_confirmation  (preview, Q-2) the confirm is offered again
 *   upgrade_processing             (V-2) Stripe already bills the higher tier:
 *                                  "Upgrading…" and the server re-read
 *   not_an_upgrade                 our record already pays for the target (the
 *                                  webhook landed between the page load and the
 *                                  press): the same re-read, which shows the plan
 * Their keys below are what is shown if they ever reach the generic path.
 *
 * Client-safe: plain data and type-only imports.
 */

import type { PlanUpgradeRefusalCode } from '@/lib/business-os/billing/planUpgrade';

export const PLAN_UPGRADE_REFUSAL_KEYS: Readonly<Record<PlanUpgradeRefusalCode | 'not_available' | 'invalid_input', string>> = {
  not_available: 'plan.upgrade.refusal.unavailable',
  invalid_input: 'plan.upgrade.refusal.generic',
  upgrade_unavailable: 'plan.upgrade.refusal.unavailable',
  billing_row_unreadable: 'plan.upgrade.refusal.generic',
  not_subscribed: 'plan.upgrade.refusal.not_active',
  subscription_not_active: 'plan.upgrade.refusal.not_active',
  subscription_cancelling: 'plan.upgrade.refusal.cancelling',
  upgrade_pending: 'plan.upgrade.refusal.pending',
  upgrade_awaiting_confirmation: 'plan.upgrade.awaiting_confirmation',
  upgrade_processing: 'plan.upgrade.upgrading',
  not_an_upgrade: 'plan.upgrade.upgrading',
  price_unavailable: 'plan.upgrade.refusal.unavailable',
  price_mismatch: 'plan.upgrade.refusal.unavailable',
  billing_record_mismatch: 'plan.upgrade.refusal.support',
  preview_expired: 'plan.upgrade.refusal.preview_expired',
  upgrade_busy: 'plan.upgrade.refusal.busy',
  stripe_error: 'plan.upgrade.refusal.generic',
};

/** Refusals answered by going to "Upgrading…" and re-reading the server (V-2), never by a line. */
export const PLAN_UPGRADE_REREAD_CODES: readonly string[] = ['upgrade_processing', 'not_an_upgrade'];

/** The dictionary key for a refused preview or confirm. Never the server's English. */
export function planUpgradeRefusalKey(refusal: { httpStatus: number; code: string | null }): string {
  if (refusal.code !== null && Object.prototype.hasOwnProperty.call(PLAN_UPGRADE_REFUSAL_KEYS, refusal.code)) {
    return PLAN_UPGRADE_REFUSAL_KEYS[refusal.code as keyof typeof PLAN_UPGRADE_REFUSAL_KEYS];
  }
  return refusal.httpStatus === 401 ? 'plan.refusal.signed_out' : 'plan.upgrade.refusal.generic';
}

/**
 * Below this many cents, Stripe charges nothing now and carries the amount to
 * the next invoice (its minimum charge; experiment E-5: a 14-cent upgrade was
 * marked paid with `amount_paid` 0 and the 14 cents billed with the renewal).
 * The preview does not apply that rule (it answered `amount_due` 14), so the
 * screen does (user decision 2026-10-13, E-5 wording option a).
 */
export const STRIPE_MINIMUM_CHARGE_MINOR = 50;

/** Which "due now" sentence a preview amount reads as. */
export function upgradeDueKey(amountDueMinor: number): string {
  if (amountDueMinor <= 0) return 'plan.upgrade.due_now_zero';
  if (amountDueMinor < STRIPE_MINIMUM_CHARGE_MINOR) return 'plan.upgrade.due_later_small';
  return 'plan.upgrade.due_now';
}

/** USD minor units in digits (SR-15): "$33.87", "$0.14". Always two decimals for an amount due. */
export function formatUsdMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/** A monthly price as the rest of the section prints it: "$129", or "$129.50" when not whole. */
export function formatMonthlyUsdMinor(minor: number): string {
  return minor % 100 === 0 ? `$${minor / 100}` : formatUsdMinor(minor);
}

/** The language's locale for dates, the map the rest of Business OS uses. */
export function localeFor(language: string): string {
  return language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
}

/** A billing instant (renewal, retry time) as a day, on the ACCOUNT's clock (QA P-4.2 note 3). */
export function formatAccountDay(iso: string, language: string, timeZone: string | undefined): string | null {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return null;
  return day.toLocaleDateString(localeFor(language), { day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone || 'UTC' });
}

/** A retry time (`retryAfter`) as a day and a time, on the account's clock. */
export function formatAccountTime(iso: string, language: string, timeZone: string | undefined): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(localeFor(language), {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone || 'UTC',
  });
}

export const PLAN_UPGRADE_PREVIEW_PATH = '/api/business-os/billing/plan/upgrade/preview';
export const PLAN_UPGRADE_CONFIRM_PATH = '/api/business-os/billing/plan/upgrade';
