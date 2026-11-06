/**
 * A plan reactivated IN STRIPE keeps the account (account deletion lifecycle
 * DL-1b / D6; carried ruling C-3; BQ-38; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §7).
 *
 * DELETE-owned port the plan subscription mirror calls (the `afterPlanMove`
 * precedent), after a successful mirror, when Stripe's FRESH read says the
 * plan renews (live status, not ended, and the derived "set to end this
 * period" false: a cleared flag, a cleared `cancel_at` or one moved past the
 * period end all count, SA Q-10).
 *
 *   1  the account's open closure row; none, or not `pending` → nothing.
 *      `requesting` belongs to a live request (its own engine write is about
 *      to set the plan to end); `grace` / `locked` have no plan that renews
 *   2  pending → kept, compare-and-set on `pending`, `kept_source: 'stripe'`
 *   3  only when the row MOVED: ACCOUNT_DELETION_KEPT, `details.source:
 *      'stripe'`, system actor (no `user_id`, no `actor_id`)
 *
 * REPLAY-SAFE (TL, PLAN PAYMENTS review point 2): the reconcile pass and the
 * admin "Reconcile plan payments now" replay the same events through the
 * handler. A replay finds no `pending` row (it is `kept`, which is not open),
 * or loses the compare-and-set, so there is no second transition and no
 * second audit row.
 *
 * FAILURE: a read or write error throws here; `planBillingHandler.ts` wraps
 * the port so the throw is logged `error` + alert and NEVER fails the mirror
 * or makes Stripe retry the event (TL, PLAN PAYMENTS review point 1). The row
 * then stays `pending` on a renewing plan until DL-3's pass over `pending`
 * rows re-reads Stripe (risk K-2, Q-11).
 *
 * The account id is OUR billing row's (the mirror's `resolveAccountId`),
 * never Stripe metadata. The closure is keyed by the login (`user_id`); today
 * the account id IS the login id (the account seam), which this file assumes.
 *
 * DL-3 learns to send "Your account is kept" from the row itself: `kept`,
 * `kept_source = 'stripe'`, `kept_email_sent_at` NULL (SA item 8).
 *
 * @module lib/business-os/account-deletion/closureStripeKeep
 */

import type { ClosureStatus } from './closureLifecycle';

type Result<T> = { data: T | null; error: Error | null };

/** What the mirror hands over. Every field comes from the event or our own billing row. */
export interface ClosureStripeKeepInput {
  /** From OUR billing row (`resolveAccountId`), never Stripe metadata. */
  accountId: string;
  subscriptionId: string;
  livemode: boolean;
  stripeEventId: string;
}

export interface ClosureStripeKeepLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

/** The port the mirror calls. `closureStripeKeepDeps.ts` wires the production one. */
export type ClosureStripeKeepPort = (input: ClosureStripeKeepInput, log: ClosureStripeKeepLogger) => Promise<void>;

export interface ClosureStripeKeepAuditFacts {
  accountId: string;
  closureId: string;
  subscriptionId: string;
  stripeEventId: string;
  livemode: boolean;
}

export interface ClosureStripeKeepDeps {
  closures: {
    findOpenForUser: (userId: string) => Promise<Result<{ id: string; status: ClosureStatus }>>;
    transition: (
      id: string,
      userId: string,
      from: ClosureStatus,
      to: ClosureStatus,
      patch: Record<string, string | boolean | null>
    ) => Promise<Result<boolean>>;
  };
  /** Writes ACCOUNT_DELETION_KEPT (source stripe); never rejects. */
  recordKept: (facts: ClosureStripeKeepAuditFacts, log: ClosureStripeKeepLogger) => Promise<void>;
  now: () => Date;
}

export async function keepClosureAfterStripeReactivation(
  input: ClosureStripeKeepInput,
  log: ClosureStripeKeepLogger,
  deps: ClosureStripeKeepDeps
): Promise<void> {
  const ids = { accountId: input.accountId, subscriptionId: input.subscriptionId, stripeEventId: input.stripeEventId, livemode: input.livemode };

  const open = await deps.closures.findOpenForUser(input.accountId);
  if (open.error) throw new Error('closure_read_failed');
  const row = open.data;
  if (!row || row.status !== 'pending') {
    if (row) log.info({ event: 'bos_closure_stripe_keep_skipped', closureId: row.id, closureStatus: row.status, ...ids }, 'Plan renews in Stripe; the open request is not pending, nothing kept');
    return;
  }

  const moved = await deps.closures.transition(row.id, input.accountId, 'pending', 'kept', { kept_at: deps.now().toISOString(), kept_source: 'stripe' });
  if (moved.error) throw new Error('closure_keep_failed');
  if (moved.data !== true) {
    log.info({ event: 'bos_closure_stripe_keep_lost', closureId: row.id, ...ids }, 'Plan renews in Stripe; the request had already moved');
    return;
  }

  log.info({ event: 'bos_closure_kept_by_stripe', closureId: row.id, ...ids }, 'Plan reactivated in Stripe; the deletion request is cancelled');
  await deps.recordKept({ accountId: input.accountId, closureId: row.id, subscriptionId: input.subscriptionId, stripeEventId: input.stripeEventId, livemode: input.livemode }, log);
}
