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
  reconcileButton: 'Run billing reconcile now (all accounts)',
  takeBackButton: 'Take back credits',
  takeBackAbove: 'Take back in Credits above',
  nothingToTakeBack: 'Nothing left to take back',
  ownAccount: 'This is your own account: an admin cannot change it.',
  reasonInternal: 'The reason is internal: the business never sees it.',
  reconcileTitle: 'Run billing reconcile now',
  reconcileDescription:
    'This checks Stripe for unfinished credit top-ups of every business, not only this one. It may add credits, close expired checkouts or mark failed payments, exactly as the nightly run at 05:41 UTC does.',
  reconcileRun: 'Run now',
  reconcileRunning: 'Running…',
  reconcileFailed: 'The reconcile could not run. Nothing is lost: the nightly run will try again.',
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

/**
 * The reconcile route's answer in words, or null when it did not really run
 * (QA6b-M1): a pass that failed (`passesFailed` > 0) or counts without the
 * boost pass's `boostExamined` are a failure, never "0 examined".
 */
export function reconcileOutcome(data: unknown): string[] | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as { counts?: unknown; passesFailed?: unknown };
  if (typeof record.passesFailed === 'number' && record.passesFailed > 0) return null;
  if (!record.counts || typeof record.counts !== 'object') return null;
  const counts = record.counts as Record<string, unknown>;
  if (typeof counts.boostExamined !== 'number') return null;
  return reconcileSentences(counts);
}

/** The reconcile route's counters in words (the boost pass's keys, flattened as `boost<Key>`). */
export function reconcileSentences(counts: Record<string, unknown>): string[] {
  const n = (key: string) => (typeof counts[key] === 'number' ? (counts[key] as number) : 0);
  const lines = [
    `Reconcile finished: ${n('boostExamined')} stuck top-ups examined, ${n('boostCredited')} credited, ${n('boostExpired')} expired, ${n('boostFailed')} marked failed, ${n('boostFlagged')} need a person, ${n('boostDeferred')} left for the next run.`,
  ];
  if (n('boostDisputesExamined') > 0) lines.push(`${n('boostDisputesExamined')} open disputes re-read, ${n('boostDisputesConcluded')} concluded.`);
  if (n('boostReceiptsFilled') > 0) lines.push(`${n('boostReceiptsFilled')} missing receipts filled.`);
  if (n('boostDeadlineHit') > 0) lines.push(`It stopped at its time limit with ${n('boostRowsLeft')} top-ups left; the nightly run picks them up.`);
  if (n('boostStripeUnavailable') > 0) lines.push('Stripe could not be read, so nothing was checked.');
  if (n('boostListFailed') > 0) lines.push('Some top-ups could not be listed; the nightly run tries again.');
  return lines;
}
