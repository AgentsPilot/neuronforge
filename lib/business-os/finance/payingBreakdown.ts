/**
 * F-K5's breakdown (Money MK-9; KPI restructure review §12 MK-9, from the
 * superseded §11N: S5B-FR-8 to S5B-FR-16, BQ-22 and BQ-23 defaults; workplan
 * docs/workplans/ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md, SA-WP-MK9).
 *
 * PURE: every input is passed in; no read, no clock, no repository, and no
 * billing mode named (the rows arrive already narrowed by the caller).
 *
 * 1. Paying vs comped made exact (BQ-22). Inside the one Comped group (BD-3,
 *    six groups, sums unchanged): "Assigned, no subscription" = the account
 *    has no billing row with a subscription status; "Subscription ended or not
 *    paying" = it has one, and it is not paying (MK9-R4: the same "billed"
 *    predicate as the Subscriptions list, so "Assigned" is its "No Stripe").
 *
 * 2. Trial-to-paid (BQ-23). The base is every trial that ENDED in the window
 *    `[start, end)` and by now (SA-CR-MK9 C-1: ended means before both the
 *    window end and now; a trial still running is never also "ended"). Paid = a first plan payment at any time up to now, the SAME
 *    first-payment result Converted this month counts (SA-Q-MK9-1, option 1);
 *    "paid before the trial ended" = `firstPaymentAt < trialEnd`. No first
 *    payment result (its read failed or did not run) makes both Unknown, never
 *    0 (MK9-R1). The rate shows only from the rule's minimum up (SA-Q116).
 *
 * @module lib/business-os/finance/payingBreakdown
 */

import type { FinanceCompedSplit, FinanceGroupKey, FinanceTrialsToPaid } from './financeTypes';

/** One account's billing status, as the paying read returns it (the fields used here only). */
export interface BreakdownStatusRow {
  user_id: string;
  subscription_status: string | null;
  ended_at: string | null;
}

/**
 * The Comped split, over the classifier's own groups. Null when the paying read
 * failed: the classifier then folds tier groups into "Tier set", and no split
 * can be said (never 0).
 */
export function compedSplit(input: {
  groupByAccount: ReadonlyMap<string, FinanceGroupKey>;
  /** Null when the paying read failed. */
  statusRows: readonly BreakdownStatusRow[] | null;
  isPaying: (row: BreakdownStatusRow) => boolean;
}): FinanceCompedSplit | null {
  if (input.statusRows === null) return null;
  const rowOf = new Map<string, BreakdownStatusRow>();
  for (const row of input.statusRows) rowOf.set(row.user_id, row);
  let total = 0;
  let assignedNoSubscription = 0;
  let endedOrNotPaying = 0;
  for (const [accountId, group] of input.groupByAccount) {
    if (group !== 'comped') continue;
    total += 1;
    const row = rowOf.get(accountId);
    // "Billed" (MK9-R4): a row with a subscription status. Without one, nothing was ever subscribed.
    if (!row || row.subscription_status === null) assignedNoSubscription += 1;
    // Unreachable for a paying row: an account is Comped only when the classifier found it NOT paying,
    // by this same isPaying predicate (planGroups.groupFor). Were it reached, the account would count
    // in `total` but in neither line, so the two lines would no longer add up to Comped (MK9-FU-3).
    else if (!input.isPaying(row)) endedOrNotPaying += 1;
  }
  return { total, assignedNoSubscription, endedOrNotPaying };
}

const instant = (iso: string | null): number | null => {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
};

/** Trial-to-paid over the trials given (the plan walk's trial rows, platform left out). */
export function trialsToPaid(input: {
  /** Null when the plan walk failed. */
  trials: ReadonlyArray<{ accountId: string; endsAt: string | null }> | null;
  /** The plan walk was cut off: every count is "at least". */
  capped: boolean;
  /** The first plan payments (Converted this month's own result), or null when it is missing. */
  firstPayments: ReadonlyArray<{ accountId: string; paidAt: string }> | null;
  window: { start: Date; end: Date };
  now: Date;
  minimumTrials: number;
}): FinanceTrialsToPaid {
  const { minimumTrials } = input;
  if (input.trials === null) {
    return { status: 'unknown', endedInWindow: null, stillRunning: null, paid: null, paidBeforeEnd: null, rate: null, minimumForRate: minimumTrials };
  }
  const from = input.window.start.getTime();
  const to = input.window.end.getTime();
  const nowMs = input.now.getTime();
  const firstOf = input.firstPayments === null ? null : new Map(input.firstPayments.map((p) => [p.accountId, instant(p.paidAt)]));

  let endedInWindow = 0;
  let stillRunning = 0;
  let paid = 0;
  let paidBeforeEnd = 0;
  for (const trial of input.trials) {
    const end = instant(trial.endsAt);
    if (end === null) continue; // a trial whose clock never started has no end: neither ended nor running
    if (end > nowMs) {
      // Still running. SA-CR-MK9 C-1: a preset window ends at the next UTC midnight, so a trial that
      // ends later today is inside it; it has not ENDED yet, so it is never counted as both.
      stillRunning += 1;
      continue;
    }
    if (end < from || end >= to) continue;
    endedInWindow += 1;
    const first = firstOf?.get(trial.accountId) ?? null;
    if (first === null) continue;
    paid += 1;
    if (first < end) paidBeforeEnd += 1;
  }

  const paidKnown = firstOf !== null;
  return {
    status: input.capped ? 'partial' : 'ok',
    endedInWindow,
    stillRunning,
    paid: paidKnown ? paid : null,
    paidBeforeEnd: paidKnown ? paidBeforeEnd : null,
    // Never a rate under the minimum, on a cut walk ("at least"), or with paid unknown.
    rate:
      paidKnown && !input.capped && endedInWindow >= minimumTrials && endedInWindow > 0
        ? { paid, base: endedInWindow, percent: Math.round((paid / endedInWindow) * 100) }
        : null,
    minimumForRate: minimumTrials,
  };
}
