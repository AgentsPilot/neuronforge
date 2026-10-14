/**
 * Words for "Reconcile top-ups now (all accounts)" on the Scheduled jobs &
 * queues page (Admin Layout follow-ups LF-4c; BD-6, SA-C2, SA-C3). Moved from
 * `app/admin/users/boostCopy.ts`, which imports a Business OS module at run
 * time and so cannot be imported by a Jobs client file (C-21).
 *
 * No imports at all (pinned by `jobsQueues.source.guard`). Pure: no React, no I/O.
 *
 * Deliberate copy changes in the move (BD-6, pinned): the button label, the
 * title (SA-W1) and the description (SA-W2). The description states the
 * nightly run's time; `jobsQueues.reconcile.render` (JREC-T1) pins it against
 * the registry, so a schedule change must update this sentence.
 */

export const RECONCILE_COPY = {
  button: 'Reconcile top-ups now (all accounts)',
  title: 'Reconcile top-ups now',
  description:
    'This checks Stripe for unfinished credit top-ups of every business. It may add credits, close expired checkouts or mark failed payments, exactly as the nightly run at 05:41 UTC does for top-ups. A press is not recorded as a run of the Billing reconcile job: its last run and counts stay as they are.',
  run: 'Run now',
  running: 'Running…',
  failed: 'The reconcile could not run. Nothing is lost: the nightly run will try again.',
} as const;

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
