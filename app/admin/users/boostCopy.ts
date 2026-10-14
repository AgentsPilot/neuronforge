/**
 * Words and money for the admin "Credit top-ups" block and its actions
 * (credits boost slices 6a / 6b). Pure: no React, no I/O.
 */

import { formatMinorAmount } from '@/lib/business-os/currency';

/** Minor units in their own currency, through the shared rule (6a SA CR-1); never throws. */
export function money(minor: number, currency: string): string {
  if (!Number.isFinite(minor)) return 'unreadable';
  try {
    return formatMinorAmount(minor, currency, 'en');
  } catch {
    return 'unreadable';
  }
}

export function perWindow(amountMinor: number, currency: string, windowDays: number): string {
  return `${money(amountMinor, currency)} per ${windowDays} days`;
}

export const BOOST_ACTION_COPY = {
  setLimitButton: 'Set limit',
  backToDefaultButton: 'Back to default',
  takeBackButton: 'Take back credits',
  takeBackAbove: 'Take back in Credits above',
  nothingToTakeBack: 'Nothing left to take back',
  ownAccount: 'This is your own account: an admin cannot change it.',
  reasonInternal: 'The reason is internal: the business never sees it.',
  // LF-4c (BD-6): the reconcile moved to Scheduled jobs & queues; its words
  // live in app/admin/components/jobs/reconcileCopy.ts. The drawer keeps a pointer.
  reconcilePointer: 'Reconcile top-ups for all accounts:',
  reconcilePointerLink: 'Scheduled jobs & queues',
} as const;

/** The server's refusal codes for the two limit ops, in words. Anything else is generic. */
export const BOOST_ACTION_ERROR_WORDS: Readonly<Record<string, string>> = {
  own_account: 'You cannot change your own account.',
  platform_account: 'This is the platform account, not a business.',
  not_a_business_os_account: 'This account is not a Business OS business.',
  tenant_check_failed: 'Whether this is a business could not be checked. Try again.',
  plan_row_missing: 'This business has no plan yet, so it has no limit to change.',
  no_active_cap_override: 'This business is already on the default limit.',
  cap_override_read_failed: 'The current limit could not be read. Nothing was changed. Try again.',
  cap_override_write_failed: 'The limit could not be saved. Try again.',
  invalid_body: 'The amount or the reason is not valid.',
};

export function boostActionErrorSentence(code: string): string {
  return BOOST_ACTION_ERROR_WORDS[code] ?? 'Something failed on the server. The correlation id is in the logs.';
}
