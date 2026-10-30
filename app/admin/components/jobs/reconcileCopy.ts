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
 *
 * Plan payments P-8b.3c (SA P3-SA-2 item 8, P3-SA-8): the words for
 * "Reconcile plan payments now" live here too (`PLAN_RECONCILE_COPY`,
 * `planReconcileOutcome`, `planReconcileSentences`). Every plan key in the
 * Billing reconcile job's `partlyDoneWhen` has its own sentence, so a press can
 * never read cleaner than the nightly row would; this file cannot read the
 * registry, so `jobsQueues.reconcilePlans.render` pins that the keys cover it.
 * Findings are said to be "with Stripe": the Finance list's "Disagrees"
 * means our two records disagree with each other, which is not this.
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

// ── Reconcile plan payments now (plan payments P-8b.3c) ──────────────────────

export const PLAN_RECONCILE_COPY = {
  button: 'Reconcile plan payments now',
  title: 'Reconcile plan payments now',
  description:
    'This checks Stripe for plan payment events of every business that our records do not show as handled, and replays them the way the webhook would. It also compares plan subscriptions with Stripe and logs any difference for a person to check; it changes nothing to match. A press is not recorded as a run of the Billing reconcile job: its last run and counts stay as they are.',
  run: 'Run now',
  running: 'Running…',
  failed: 'The plan reconcile could not finish. Nothing is lost: the nightly run will try again.',
} as const;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One sentence for each plan key of the Billing reconcile job's
 * `partlyDoneWhen`, shown when its count is above 0 (SA P3-SA-2 item 8).
 * D3-4 (a): a lost claim (another run held the event) counts as
 * `planIncomplete`, and its sentence says so.
 */
export const PLAN_LEFT_WORK_SENTENCES: Readonly<Record<string, (n: number) => string>> = {
  planIncomplete: () => 'Some plan events were left for the nightly run: another run held them, or a limit was reached.',
  planDeadlineHit: () => 'It stopped at its time limit; the nightly run picks up the rest.',
  planReplayFailed: (n) => `${plural(n, 'plan event', 'plan events')} failed when replayed; the nightly run will try again.`,
  planWindowClipped: () => 'Only the last 7 days of Stripe events were checked.',
  planApiVersionSkipped: (n) => `${plural(n, 'plan event was', 'plan events were')} skipped because Stripe used a version we have not checked.`,
  planCheckIncomplete: () => 'Not every plan subscription could be compared with Stripe; the nightly run will try again.',
};

/** Step B and C findings, counts only (details stay in the finding log lines). */
export const PLAN_FINDING_SENTENCES: Readonly<Record<string, (n: number) => string>> = {
  planMismatch: (n) => `${plural(n, 'plan subscription disagrees', 'plan subscriptions disagree')} with Stripe: logged for a person to check.`,
  planOrphan: (n) => `${plural(n, 'Stripe plan subscription has', 'Stripe plan subscriptions have')} no billing record: logged for a person to check.`,
  planUnassigned: (n) => `${plural(n, 'paid plan invoice has', 'paid plan invoices have')} no plan assigned: logged for a person to check.`,
};

/** A count the runner could have sent: a whole number, 0 or more. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The plan reconcile route's answer in words, or null when it did not really
 * run (QA6b-M1, SA P3-SA-8). Fails closed (QA edge 1): `passesFailed` must be
 * present and exactly 0, `planEventsSeen` must be present, and every plan count
 * that is present must be a whole number, 0 or more. Anything else is the
 * failure line, never "finished".
 */
export function planReconcileOutcome(data: unknown): string[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as { counts?: unknown; passesFailed?: unknown };
  if (!isCount(record.passesFailed) || record.passesFailed !== 0) return null;
  if (!record.counts || typeof record.counts !== 'object' || Array.isArray(record.counts)) return null;
  const counts = record.counts as Record<string, unknown>;
  if (!isCount(counts.planEventsSeen)) return null;
  for (const [key, value] of Object.entries(counts)) if (key.startsWith('plan') && !isCount(value)) return null;
  return planReconcileSentences(counts);
}

/** The plan pass's counters in words (its keys, flattened as `plan<Key>`). */
export function planReconcileSentences(counts: Record<string, unknown>): string[] {
  const n = (key: string) => (typeof counts[key] === 'number' ? (counts[key] as number) : 0);
  const leftWork = Object.keys(PLAN_LEFT_WORK_SENTENCES).filter((key) => n(key) > 0);
  const listed = `${plural(n('planEventsSeen'), 'plan event', 'plan events')} listed from Stripe, ${n('planReplayed')} replayed.`;
  // D3-4 (a): never a clean "finished" line while any work was left.
  const lines = [leftWork.length === 0 ? `Plan reconcile finished: ${listed}` : `Plan reconcile did not finish everything: ${listed}`];
  for (const key of leftWork) lines.push(PLAN_LEFT_WORK_SENTENCES[key](n(key)));
  for (const [key, sentence] of Object.entries(PLAN_FINDING_SENTENCES)) if (n(key) > 0) lines.push(sentence(n(key)));
  return lines;
}
