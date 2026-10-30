/**
 * The 3-day "your plan ends on {date}" reminder run (account deletion
 * lifecycle D4b / SX-3 part 2; workplan
 * docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §3.4, §3.5 and
 * the D4b addendum; SA S-3, S-5, S-12, S-14, DR-2, DR-5, R-A, R-B; user BQ-36,
 * U-1, U-3).
 *
 * Pure orchestration over ports; the production wiring is
 * `planCancelReminderPassDeps.ts`, and the door is its own cron route
 * `/api/cron/bos-plan-cancel-reminders` (R-A: not a pass of the billing
 * reconcile, whose run record has no room for these counts).
 *
 * ── A queue drain (durable-queue-drain) ─────────────────────────────────────
 *   claim     ONE call leases up to `batch` rows of the CURRENT key mode only
 *             (S-12) whose plan is set to end within the window and that have
 *             no reminder for that period end, FOR UPDATE SKIP LOCKED, so two
 *             overlapping runs never take the same row. A lease older than
 *             `leaseSeconds` is dead, because the route is killed at its
 *             `maxDuration` first (S-3 a; a test pins LEASE > maxDuration).
 *             Accounts with an open closure are left out in SQL (DR-2).
 *   check     at the choke point, per row, Stripe read FRESH (our row can lag
 *             the dashboard): the C-4 cross-checks (id, customer, mode,
 *             `bos_user_id`), still set to end (the flag OR `cancel_at`), not
 *             ended, active or trialing, exactly one item, and Stripe's end
 *             (`cancel_at` ?? the item's period end, S-14) equal to our row's.
 *             Anything else releases the row and is counted. No heal (S-5):
 *             the run writes only its own three columns. `past_due` is left
 *             out on purpose, in the claim and here (SA F-5): Keep is refused
 *             for it (`payment_failed_contact_us`) and dunning can end the plan
 *             sooner, so "ends on" and "Keep before" would not be reliably
 *             true. A plan cured back to active inside the window is reminded
 *             on the next run.
 *   send      through the plan-cancel composer, `event: 'reminder'`, to the
 *             claimed row's own account (tenant-isolation-guard Step 6), with
 *             the provider key `plan-cancel-reminder:{billingRowId}:{periodEnd}`
 *             (S-10 follow-up).
 *   record    DR-5 (S-3 b): `sent` or `unknown` COMPLETES the row (the period
 *             end is recorded, so at most once); `not_sent` RELEASES it, and a
 *             later daily run retries while the end is still ahead (about 3
 *             attempts at most, so no attempts column and no dead-letter).
 *
 * ── Never throws (R-B) ──────────────────────────────────────────────────────
 * Every port call is guarded per row. A failed claim, an unreadable key mode
 * or an unreachable Stripe is logged with `alert: true` and counted
 * (`deferred`); a row that throws is released and counted. The route still
 * guards a defect throw and marks the run failed.
 *
 * ── The deadline ────────────────────────────────────────────────────────────
 * No row is started with less than `rowMarginMs` left; the rows claimed but
 * not started are released (`deferred`) and `deadlineHit` is 1. A Stripe read
 * is cut at the deadline too.
 *
 * ── Counts (R-A) ────────────────────────────────────────────────────────────
 * Unprefixed, ten keys (`PLAN_CANCEL_REMINDER_COUNT_KEYS`), small enough for
 * the run record's 1,024-byte CHECK (a test pins the worst case). Logs and
 * counts carry ids and numbers only: never an address, a name or a plan name.
 *
 * @module lib/business-os/billing/planCancelReminderPass
 */

import { PLAN_CANCEL_REMINDER_WINDOW_SECONDS, type PlanCancelEmailInput, type PlanCancelEmailOutcome } from './planCancelEmail';
import { BOS_USER_ID_METADATA_KEY } from './stripeMetadataKeys';
import { isSetToEndThisPeriod, latestItemPeriodEnd } from './subscriptionCancelling';

export const PLAN_CANCEL_REMINDER_POLICY = {
  /** How far ahead the claim looks (BQ-36), shared with the cancel email's covered mark (R-D). */
  windowSeconds: PLAN_CANCEL_REMINDER_WINDOW_SECONDS,
  /** Longer than the route's `maxDuration` (60 s), so an older lease is provably dead (S-3 a). */
  leaseSeconds: 90,
  /** R-A: back to 25 (the run has its own route and its whole budget). */
  batch: 25,
  /** No row is started with less than this left: one Stripe read, one 4 s email and two writes. */
  rowMarginMs: 8_000,
} as const;

/** The run's whole budget, inside the route's 60 s `maxDuration` (the reconcile shell's 45 s). */
export const PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS = 45_000;

/** The run's counts, in the order the cron registry lists them. */
export const PLAN_CANCEL_REMINDER_COUNT_KEYS = [
  'examined',
  'sent',
  'notSent',
  'notCancelling',
  'periodMismatch',
  'mismatch',
  'covered',
  'deferred',
  'deadlineHit',
  'skipped',
] as const;
export type PlanCancelReminderCountKey = (typeof PLAN_CANCEL_REMINDER_COUNT_KEYS)[number];
export type PlanCancelReminderCounts = Record<PlanCancelReminderCountKey, number>;

/** The idempotency key prefix (S-10 follow-up). Ids and a date only. */
export const PLAN_CANCEL_REMINDER_KEY_PREFIX = 'plan-cancel-reminder';

export function planCancelReminderIdempotencyKey(billingRowId: string, periodEnd: string): string {
  return `${PLAN_CANCEL_REMINDER_KEY_PREFIX}:${billingRowId}:${periodEnd}`;
}

// The repositories' `{ data, error }` shape, written here rather than imported: billing modules other than
// the allow-listed callers import nothing from lib/repositories/ (routerPlacement guard, SA P1-C6).
type PortResult<T> = { data: T | null; error: Error | null };

/** One leased row, as the claim returns it (the repository's `CancelReminderClaim`). */
export interface PlanCancelReminderRow {
  id: string;
  /** The row's `user_id`: the account. */
  userId: string;
  livemode: boolean;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  /** Canonical ISO. */
  currentPeriodEnd: string;
  cancelReminderSentFor: string | null;
}

/** What the pass reads from Stripe's fresh subscription (`retrieveBusinessOsSubscription`). */
export interface PlanCancelReminderSubscriptionFacts {
  id: string;
  status: string;
  customerId: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt?: number | null;
  endedAt: number | null;
  livemode: boolean;
  metadata: Record<string, string> | null | undefined;
  items: ReadonlyArray<{ currentPeriodEnd: number | null }>;
}

export interface PlanCancelReminderLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface PlanCancelReminderDeps {
  /** `isPlanCancelEmailsEnabled`: off → `skipped`, nothing claimed (S-15). */
  isEnabled: () => boolean;
  /** The current key's mode; `null` = cannot tell (no key). */
  keyLivemode: () => boolean | null;
  newRunnerId: () => string;
  claim: (input: {
    runnerId: string;
    livemode: boolean;
    windowSeconds: number;
    leaseSeconds: number;
    batch: number;
  }) => Promise<PortResult<PlanCancelReminderRow[]>>;
  complete: (input: { id: string; userId: string; livemode: boolean; runnerId: string; periodEnd: string }) => Promise<PortResult<{ completed: boolean }>>;
  release: (input: { id: string; userId: string; livemode: boolean; runnerId: string }) => Promise<PortResult<{ released: boolean }>>;
  /** Stripe's fresh read; `null` when Stripe is not configured. */
  stripe: () => { retrieveSubscription: (subscriptionId: string) => Promise<PlanCancelReminderSubscriptionFacts> } | null;
  /** The plan-cancel composer for ONE row's account. Never throws by contract; guarded anyway. */
  sendReminder: (input: PlanCancelEmailInput) => Promise<PlanCancelEmailOutcome>;
  /** One bounded audit flush at the end of the run. */
  flushAudit: () => Promise<void>;
  logger: PlanCancelReminderLogger;
  /** Milliseconds; the test clock. */
  now: () => number;
}

export interface PlanCancelReminderContext {
  /** Epoch milliseconds after which no row is started (less `rowMarginMs`). */
  deadlineAt: number;
  correlationId: string;
}

/** Stripe statuses a plan that is still running can have. */
const RUNNING_STATUSES: readonly string[] = ['active', 'trialing'];

export function emptyPlanCancelReminderCounts(): PlanCancelReminderCounts {
  return Object.fromEntries(PLAN_CANCEL_REMINDER_COUNT_KEYS.map((key) => [key, 0])) as PlanCancelReminderCounts;
}

/**
 * C-3: the ONE rule for "set to end", plan payments' `isSetToEndThisPeriod`
 * (PR #571), the same one that fills our `cancel_at_period_end`. The flag, or
 * a dashboard `cancel_at` on or before the period end. A `cancel_at` AFTER it
 * means the plan renews once more, so "ends on" would be untrue: not cancelling.
 */
function isCancelling(facts: PlanCancelReminderSubscriptionFacts): boolean {
  return isSetToEndThisPeriod({
    cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
    cancelAt: facts.cancelAt,
    periodEnd: latestItemPeriodEnd(facts.items),
  });
}

/** S-14: Stripe's end, unix seconds: `cancel_at`, else the ONE item's period end. `null` when it cannot be told. */
function stripeEndOf(facts: PlanCancelReminderSubscriptionFacts): number | null {
  if (facts.items.length !== 1) return null;
  if (typeof facts.cancelAt === 'number' && facts.cancelAt > 0) return facts.cancelAt;
  const end = facts.items[0].currentPeriodEnd;
  return typeof end === 'number' ? end : null;
}

type RowVerdict =
  | { kind: 'send' }
  | { kind: 'release'; counter: Exclude<PlanCancelReminderCountKey, 'examined' | 'sent' | 'deadlineHit' | 'skipped'>; reason: string };

/**
 * The choke-point decision for one row against Stripe's fresh answer. Pure;
 * exported for its test.
 */
export function decideReminderRow(row: PlanCancelReminderRow, fresh: PlanCancelReminderSubscriptionFacts, keyLivemode: boolean): RowVerdict {
  // C-4: exactly these four, before anything is sent.
  const claim = fresh.metadata?.[BOS_USER_ID_METADATA_KEY];
  const checks = {
    subscriptionMatches: fresh.id === row.stripeSubscriptionId,
    customerMatches: fresh.customerId === row.stripeCustomerId,
    modeMatches: fresh.livemode === row.livemode && row.livemode === keyLivemode,
    metadataMatches: !claim || claim === row.userId,
  };
  if (!checks.subscriptionMatches || !checks.customerMatches || !checks.modeMatches || !checks.metadataMatches) {
    return { kind: 'release', counter: 'mismatch', reason: 'subscription_record_differs' };
  }
  if (!isCancelling(fresh) || fresh.endedAt !== null || !RUNNING_STATUSES.includes(fresh.status)) {
    return { kind: 'release', counter: 'notCancelling', reason: 'not_set_to_end' };
  }
  const end = stripeEndOf(fresh);
  if (end === null || end * 1000 !== Date.parse(row.currentPeriodEnd)) {
    return { kind: 'release', counter: 'periodMismatch', reason: 'period_end_differs' };
  }
  return { kind: 'send' };
}

/** A promise cut at `ms`; a timeout or a rejection is `undefined`. */
async function within<T>(promise: () => Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), Math.max(0, ms));
    });
    return await Promise.race([promise().catch(() => undefined), timedOut]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One reminder run. Never throws (R-B); returns the counts for the run record.
 */
export async function runPlanCancelReminderPass(
  deps: PlanCancelReminderDeps,
  context: PlanCancelReminderContext
): Promise<PlanCancelReminderCounts> {
  const counts = emptyPlanCancelReminderCounts();
  const log = deps.logger;
  const base = { event: 'bos_plan_cancel_reminder', correlationId: context.correlationId };
  const safeLog = (level: keyof PlanCancelReminderLogger, ctx: Record<string, unknown>, message: string) => {
    try {
      log[level]({ ...base, ...ctx }, message);
    } catch {
      // A logger that throws must not stop the run.
    }
  };

  // S-15: the switch first. Off → nothing claimed, nothing read.
  let enabled = false;
  try {
    enabled = deps.isEnabled();
  } catch {
    enabled = false;
  }
  if (!enabled) {
    counts.skipped = 1;
    return counts;
  }

  // S-12: only the current key mode's rows, because only those can be read fresh.
  let livemode: boolean | null = null;
  try {
    livemode = deps.keyLivemode();
  } catch {
    livemode = null;
  }
  if (livemode === null) {
    safeLog('error', { alert: true, reason: 'key_mode_unknown' }, 'Plan-ends reminders not run: the Stripe key mode cannot be told');
    counts.deferred = 1;
    return counts;
  }

  let stripe: ReturnType<PlanCancelReminderDeps['stripe']> = null;
  try {
    stripe = deps.stripe();
  } catch {
    stripe = null;
  }
  if (!stripe) {
    safeLog('error', { alert: true, reason: 'stripe_unavailable' }, 'Plan-ends reminders not run: Stripe is not available');
    counts.deferred = 1;
    return counts;
  }
  const service = stripe;

  const runnerId = deps.newRunnerId();
  let rows: PlanCancelReminderRow[];
  try {
    const claimed = await deps.claim({
      runnerId,
      livemode,
      windowSeconds: PLAN_CANCEL_REMINDER_POLICY.windowSeconds,
      leaseSeconds: PLAN_CANCEL_REMINDER_POLICY.leaseSeconds,
      batch: PLAN_CANCEL_REMINDER_POLICY.batch,
    });
    if (claimed.error || !claimed.data) throw claimed.error ?? new Error('claim_returned_nothing');
    rows = claimed.data;
  } catch (err) {
    // R-B: counted and alerted; the run itself does not fail. Before 20261100 is applied, this is the answer.
    safeLog('error', { err, alert: true, reason: 'claim_failed', livemode }, 'Plan-ends reminders not run: the claim failed');
    counts.deferred = 1;
    return counts;
  }

  const release = async (row: PlanCancelReminderRow, reason: string) => {
    try {
      const released = await deps.release({ id: row.id, userId: row.userId, livemode: row.livemode, runnerId });
      if (released.error) throw released.error;
    } catch (err) {
      // The lease expires on its own (S-3 a); the row is retried by a later run.
      safeLog('warn', { err, billingAccountId: row.id, reason }, 'Plan-ends reminder lease not released; it expires on its own');
    }
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (deps.now() > context.deadlineAt - PLAN_CANCEL_REMINDER_POLICY.rowMarginMs) {
      counts.deadlineHit = 1;
      for (const left of rows.slice(index)) {
        await release(left, 'deadline');
        counts.deferred += 1;
      }
      break;
    }
    counts.examined += 1;
    const ids = { billingAccountId: row.id, userId: row.userId, subscriptionId: row.stripeSubscriptionId, livemode: row.livemode };

    try {
      // Defensive: the claim leaves these out, so a hit means the cancel email covered it meanwhile (R-D).
      if (row.cancelReminderSentFor !== null && Date.parse(row.cancelReminderSentFor) === Date.parse(row.currentPeriodEnd)) {
        counts.covered += 1;
        await release(row, 'covered');
        continue;
      }
      if (row.livemode !== livemode) {
        counts.mismatch += 1;
        safeLog('error', { ...ids, alert: true, reason: 'claimed_other_mode' }, 'Plan-ends reminder skipped: the claim returned a row in the other mode');
        await release(row, 'mismatch');
        continue;
      }

      const fresh = await within(() => service.retrieveSubscription(row.stripeSubscriptionId), context.deadlineAt - deps.now());
      if (!fresh) {
        counts.deferred += 1;
        safeLog('warn', { ...ids, reason: 'stripe_read_failed' }, 'Plan-ends reminder left for a later run: Stripe could not be read');
        await release(row, 'stripe_read_failed');
        continue;
      }

      const verdict = decideReminderRow(row, fresh, livemode);
      if (verdict.kind === 'release') {
        counts[verdict.counter] += 1;
        if (verdict.counter === 'mismatch') {
          safeLog('error', { ...ids, alert: true, reason: verdict.reason }, 'Plan-ends reminder not sent: Stripe disagrees with our billing record');
        } else {
          safeLog('info', { ...ids, reason: verdict.reason }, 'Plan-ends reminder not sent: the plan is no longer set to end on that date');
        }
        await release(row, verdict.reason);
        continue;
      }

      let outcome: PlanCancelEmailOutcome;
      try {
        outcome = await deps.sendReminder({
          event: 'reminder',
          userId: row.userId,
          date: row.currentPeriodEnd,
          subscriptionId: row.stripeSubscriptionId,
          livemode: row.livemode,
          correlationId: context.correlationId,
          actor: 'system',
          idempotencyKey: planCancelReminderIdempotencyKey(row.id, row.currentPeriodEnd),
        });
      } catch {
        outcome = { outcome: 'not_sent', reason: 'transport_failed' };
      }

      if (outcome.outcome === 'sent' || outcome.outcome === 'unknown') {
        // DR-5: at most once. An unknown send may have gone, so it is recorded too.
        if (outcome.outcome === 'sent') counts.sent += 1;
        else counts.notSent += 1;
        let completed = false;
        try {
          const result = await deps.complete({
            id: row.id,
            userId: row.userId,
            livemode: row.livemode,
            runnerId,
            periodEnd: row.currentPeriodEnd,
          });
          completed = result.data?.completed === true;
        } catch {
          completed = false;
        }
        if (!completed) {
          // The lease outlives the route, so this is a write failure, not a lost lease. The provider key
          // keeps a re-send inside its window from reaching the owner twice.
          safeLog('error', { ...ids, alert: true, outcome: outcome.outcome, reason: 'complete_failed' }, 'Plan-ends reminder sent but not recorded');
        }
        continue;
      }

      if (outcome.outcome === 'skipped') {
        // The switch went off during the run: nothing was sent.
        counts.deferred += 1;
      } else {
        counts.notSent += 1;
      }
      await release(row, outcome.outcome === 'skipped' ? 'switched_off' : outcome.reason);
    } catch (err) {
      // R-B: a defect in one row never stops the run.
      counts.deferred += 1;
      safeLog('error', { ...ids, err, reason: 'row_failed' }, 'Plan-ends reminder row failed unexpectedly');
      await release(row, 'row_failed');
    }
  }

  try {
    await deps.flushAudit();
  } catch {
    // Bounded and never fails the run.
  }

  if (counts.deferred > 0 || counts.deadlineHit > 0) {
    safeLog('warn', { counts }, 'Plan-ends reminder run left rows for a later run');
  } else {
    safeLog('info', { counts }, 'Plan-ends reminder run finished');
  }
  return counts;
}
