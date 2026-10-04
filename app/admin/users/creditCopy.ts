/**
 * Words and number formats for the Credits block of the Businesses panel and
 * its Give / Take back forms (credit deduction slice 11c, workplan §11c.3.5).
 *
 * No JSX, so the copy contract test imports it without rendering. English
 * only: the admin screens use no dictionary.
 *
 * `CREDIT_ERROR_COPY` holds one sentence for every code the credit view GET,
 * the two credit ops and the shared checks in front of them can return. It is
 * kept complete by `__tests__/creditErrors.contract.test.ts`, which reads the
 * codes from the server sources (SA W11c-7). An unknown code, or a response
 * that is not JSON, shows `GENERIC_ERROR_COPY`, never the raw code.
 */

import type { CreditAllowanceLayerView } from './types';

export const GENERIC_ERROR_COPY = 'Something failed on the server. The correlation id is in the logs.';

export const CREDIT_ERROR_COPY: Record<string, string> = {
  // The admin gate.
  Unauthorized: 'Your admin session has ended. Sign in again, then reload this page.',
  Forbidden: 'This account is not an admin, so it cannot read or change credits.',
  // The path and the account (the view GET and the change POST).
  invalid_account_id: 'That does not look like an account id.',
  platform_account: 'This is the platform account. It has no credits of its own to show or change.',
  tenant_check_failed: 'Whether this is a Business OS account could not be determined. Try again.',
  not_a_business_os_account: 'Not a Business OS account. This login has no Business OS business.',
  own_account: 'You cannot change credits on your own account. Another admin has to do it.',
  invalid_body: 'The form sent something the server did not accept. Check the amount, the end date and the reason.',
  plan_read_failed: 'The account plan could not be read, so nothing was changed. Try again.',
  plan_row_missing: 'This account has no plan yet, so credits cannot be given or taken back.',
  'Internal server error': GENERIC_ERROR_COPY,
  // Give credits.
  payment_hold_check_failed: 'Whether this account is waiting for a first payment could not be checked, so nothing was given. Try again.',
  awaiting_payment: 'This account is waiting for its first payment. Credits cannot be given until it has paid.',
  expires_at_in_past: 'The end date is already in the past. Choose a later end date, or no end date.',
  credit_lots_unreadable: 'The account credits could not be read, so nothing was changed. Try again.',
  lot_write_failed: 'The change could not be saved. Nothing was recorded; try again.',
  lot_read_failed: 'The credits were recorded, but reading them back failed. Reload the credits to see them.',
  idempotency_key_conflict:
    'This form already recorded a different change. Reload the credits to see it, then close and reopen the form to make another.',
  // Take back.
  lot_not_found: 'That gift is not on this account any more. Reload the credits.',
  paid_credits_locked: 'These credits were paid for. Tick the confirmation to take them back.',
  lot_expired: 'That gift has already ended, so there is nothing to take back.',
  nothing_left: 'Nothing is left on that gift to take back.',
  exceeds_remaining: 'That is more than is left on this gift. Take back less, or choose everything left.',
};

/** A sentence for a code, never the code itself. */
export function creditErrorSentence(code: string): string {
  return Object.prototype.hasOwnProperty.call(CREDIT_ERROR_COPY, code) ? CREDIT_ERROR_COPY[code] : GENERIC_ERROR_COPY;
}

export const CREDIT_COPY = {
  heading: 'Credits',
  loading: 'Loading credits…',
  usageError: 'The plan credits could not be read.',
  extraError: 'The extra credits could not be read.',
  allowanceUnavailable: 'The plan could not be read; figures shown without an allowance.',
  noAllowance: 'No allowance',
  setBy: 'Set by',
  overPlanNote: 'Nothing is blocked yet (shadow mode).',
  extraNote: 'Extra credits are not part of the plan figure.',
  inconsistentLot: 'One gift shows more taken back than was given. It counts as 0; tell the engineering team.',
  noLots: 'No extra credits given yet.',
  datesNote: 'Dates are shown in UTC.',
  giveButton: 'Give credits',
  takeBackButton: 'Take back',
  sourceAdmin: 'Given by an admin',
  sourceBoost: 'Bought',
  noEndDate: 'No end date',
  expired: 'Expired',
  notCountedYet: 'Not counted yet (just recorded); reload in a moment.',
  paidCreditsConfirm: 'These credits were paid for. Taking them back does not refund the payment.',
  replayGive: 'This gift had already been recorded; showing what was recorded.',
  replayTakeBack: 'This take-back had already been recorded; showing what was recorded.',
  dismiss: 'Dismiss',
} as const;

/**
 * "Set by" in plain words (user UI fixes, 2026-10-04). The raw layer stays on
 * the element's `title`, so an admin can still match it to the "Decided by"
 * column of the Plan & entitlements table. Kept complete by
 * `__tests__/creditLayerCopy.contract.test.ts`, which reads the server's
 * `AdminCreditAllowanceLayer` union.
 */
export const ALLOWANCE_LAYER_COPY: Record<CreditAllowanceLayerView, string> = {
  basis: 'the plan',
  cohort_values: 'the plan group',
  override: 'an exception for this account',
  lifecycle_gate: 'plan ended or paused',
  grandfather: 'earlier terms',
  addon: 'an add-on',
};

/** The plain words for a layer; an unknown layer shows its raw value rather than nothing. */
export function allowanceLayerLabel(layer: string): string {
  return Object.prototype.hasOwnProperty.call(ALLOWANCE_LAYER_COPY, layer)
    ? ALLOWANCE_LAYER_COPY[layer as CreditAllowanceLayerView]
    : layer;
}

/** "1,234" for a whole figure, otherwise up to 2 dp; a non-zero figure is never shown as 0 (OP-29). */
export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return 'unreadable';
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  if (value !== 0 && Math.abs(value) < 0.01) return value > 0 ? '< 0.01' : '> -0.01';
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** The exact figure, for a `title` attribute. */
export function exactCredits(value: number): string {
  return Number.isFinite(value) ? String(value) : 'unreadable';
}

/** An instant as `YYYY-MM-DD HH:MM UTC`. */
export function formatUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The first 8 characters of an admin id; the full id goes in a `title` (SA OP-30 cut). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
