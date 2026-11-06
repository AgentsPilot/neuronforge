/**
 * THE DELETION REQUEST (stage A): what `POST /api/business-os/account/delete`
 * does after its own gates (account deletion lifecycle DL-1b / D6; requirement
 * §3.3, XC-2, XC-5, XC-6; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §4; SA W-1 to W-5, W-8,
 * W-11, W-13; user decisions 2026-11-04).
 *
 * Nothing is deleted here. A request records a closure row and, for a paid
 * plan, asks the ONE "don't renew" engine (`managePlanSubscription`, origin
 * `deletion_request`) to stop the renewal. The account closes later, through
 * the lifecycle (DL-3 to DL-5).
 *
 * Pure orchestration over ports (the `planSubscriptionManage` pattern), so every
 * branch, the invariant included, is tested with fakes and no network. The
 * production ports are `closureRequestDeps.ts`. The closure port is typed here,
 * structurally, so only the deps file names the repository (SA note, G-2).
 *
 * THE ORDER IS THE CONTRACT (XC-2; the P-7b.1 V-9 rule): every database read
 * and every refusal decided from our own data precede the closure insert, and
 * the insert precedes the only Stripe call.
 *
 *   R-6   an open request already?           → already_requested (409, no audit)
 *   R-7   key mode, our billing row, classify (W-5: free is decided BEFORE the
 *         prices switch is read)              → not_available / try_again /
 *                                              blocked [payment_failed] (BQ-11) /
 *                                              plan_change_pending / plan_state_changed
 *   R-8   the check, then the XC-5 filter on the RAW rows (W-4)
 *                                            → not_available / try_again / blocked
 *   R-9   free only: the timezone, the lock date (W-11; fail closed)
 *   R-10  insert `requesting` (`renewal_was_on` from our row, XC-2)
 *   R-11f free: requesting → grace (lock date fixed). No `next_check_at` (W-2)
 *   R-11p paid: the engine, `origin: 'deletion_request'`, the reason code
 *   R-12  paid, and ONLY when the engine said "set to end this period" from
 *         Stripe's own answer (P-1 `cancelled`, P-2 `unchanged / cancelling`):
 *         requesting → pending with `renewal_was_on` and `plan_ends_at`
 *         corrected from that answer (W-3). No `next_check_at` (W-2)
 *
 * INVARIANT (XC-2, §7): a row becomes `pending` in R-12 only, and R-12 runs
 * only after the engine said the plan is set to end. A definite refusal
 * deletes the `requesting` row; an unknown outcome or a throw LEAVES it
 * `requesting` for DL-3 to settle from a fresh Stripe read (never `pending`,
 * never deleted). `closureRequest.invariant.test.ts` drives every branch.
 *
 * Tenancy: every id is the SESSION's (the route passes `readSessionSubject()`'s
 * id and `resolveAccountId` of it). Nothing here reads a request.
 *
 * Logs carry ids, codes and statuses only: never the email, the statement or
 * a Stripe / database message.
 *
 * @module lib/business-os/account-deletion/closureRequest
 */

import { planManageOffer } from '@/lib/business-os/billing/planManageOffer';
import type { PlanLeaveReasonCode } from '@/lib/business-os/billing/planLeaveReasons';
import type {
  PlanManageAuditFacts,
  PlanManageInput,
  PlanManageRefusalCode,
  PlanManageResult,
} from '@/lib/business-os/billing/planSubscriptionManage';
import type { StatementLanguage } from './acknowledgement';
import { toBlockerViews, type BlockerView } from './blockerCopy';
import { requestBlockers } from './closureBlockers';
import { closureLockAt } from './closureDates';
import type { ClosureStatus } from './closureLifecycle';
import type { AccountDeletionCheckOutcome, SelfDeletionSubject } from './selfServiceDeletion';

// ── Ports ───────────────────────────────────────────────────────────────────

type Result<T> = { data: T | null; error: (Error & { code?: string }) | null };

/** The closure row fields this module reads. */
export interface ClosureRowLike {
  id: string;
  status: ClosureStatus;
}

/** The closure repository's methods, structurally (only the deps file names the class). */
export interface ClosureRequestStore {
  findOpenForUser: (userId: string) => Promise<Result<ClosureRowLike>>;
  insertRequesting: (input: {
    userId: string;
    statementLanguage: StatementLanguage;
    reasonCode: string;
    renewalWasOn: boolean;
    planEndsAt: string | null;
  }) => Promise<Result<ClosureRowLike>>;
  transition: (
    id: string,
    userId: string,
    from: ClosureStatus,
    to: ClosureStatus,
    patch: Record<string, string | boolean | null>
  ) => Promise<Result<boolean>>;
  deleteRequesting: (id: string, userId: string) => Promise<Result<boolean>>;
}

/** Our billing row, as far as this module reads it. */
export interface BillingRowLike {
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  endedAt: string | null;
  failedAttempts: number;
  pendingTier: string | null;
  openCheckoutSessionId: string | null;
  openCheckoutExpiresAt: string | null;
}

export interface ClosureRequestLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface ClosureRequestDeps {
  closures: ClosureRequestStore;
  /** Our billing row for the session user in the server key's mode. */
  billingRow: (userId: string, livemode: boolean) => Promise<Result<BillingRowLike>>;
  /** The server key's mode; throws when it cannot be read. */
  livemode: () => boolean;
  /** `isPlanPriceRecognitionEnabled()`: read only for a row with a live subscription id (W-5). */
  pricesEnabled: () => boolean;
  runCheck: (input: SelfDeletionSubject) => Promise<AccountDeletionCheckOutcome>;
  /** `user_preferences.timezone`, raw (NULL = not asked). */
  readTimezone: (userId: string) => Promise<Result<string>>;
  /** `managePlanSubscription`, with its logger bound. The one "don't renew" path. */
  manage: (input: PlanManageInput) => Promise<PlanManageResult>;
  now: () => Date;
  logger: ClosureRequestLogger;
}

export interface ClosureRequestInput {
  /** The session user (`readSessionSubject`). */
  subject: string;
  /** The session login email. Never logged. */
  email: string;
  /** `resolveAccountId(subject)`, for the engine's metadata cross-check. */
  accountId: string;
  /** The language of the statement list that matched on the server (never the UI's). */
  statementLanguage: StatementLanguage;
  reasonCode: PlanLeaveReasonCode;
}

// ── Results ─────────────────────────────────────────────────────────────────

export type ClosureRequestRefusalCode =
  | 'already_requested'
  | 'blocked'
  | 'plan_change_pending'
  | 'plan_state_changed'
  | 'not_available'
  | 'try_again'
  | 'stripe_error'
  | 'request_failed';

export const CLOSURE_REQUEST_REFUSAL_STATUS: Readonly<Record<ClosureRequestRefusalCode, number>> = {
  already_requested: 409,
  blocked: 409,
  plan_change_pending: 409,
  plan_state_changed: 409,
  not_available: 503,
  try_again: 503,
  stripe_error: 502,
  request_failed: 500,
};

export type ClosureRequestOutcome =
  | {
      ok: true;
      status: 'pending';
      closureId: string;
      planEndsOn: string | null;
      renewalWasOn: boolean;
      /** Set when the engine reached the Stripe write (BOS_BILLING_SUBSCRIPTION_CANCELLED). */
      engineAudit: PlanManageAuditFacts | null;
    }
  | {
      ok: true;
      status: 'grace';
      closureId: string;
      graceStartsAt: string;
      lockAt: string;
      lockTimezone: string;
    }
  | {
      ok: false;
      error: ClosureRequestRefusalCode;
      /** Why, for the refusal audit and the log: a code, never a message. */
      reason: string;
      /** `blocked` only. */
      blockers?: BlockerView[];
      /** Guard ids that refused (the refusal audit's `details.guards`). */
      guards: string[];
      /** `already_requested` (the open row's status) and P-8 (`requesting`). */
      closureStatus?: ClosureStatus | null;
      outcomeUnknown?: true;
      /** Set when the engine reached the Stripe write (P-3, P-7, P-8). */
      engineAudit?: PlanManageAuditFacts;
      /** False only for `already_requested` and P-8: nothing was refused there. */
      auditRefusal: boolean;
      closureId?: string;
    };

type Refused = Extract<ClosureRequestOutcome, { ok: false }>;

function refused(error: ClosureRequestRefusalCode, reason: string, extra: Partial<Omit<Refused, 'ok' | 'error' | 'reason'>> = {}): Refused {
  return { ok: false, error, reason, guards: [], auditRefusal: true, ...extra };
}

/** The engine's definite refusals (§4.4 P-4), mapped. */
function mapEngineRefusal(code: PlanManageRefusalCode): Refused {
  const reason = `plan_${code}`;
  switch (code) {
    case 'payment_failed_contact_us':
      return refused('blocked', reason, { blockers: [{ code: 'payment_failed' }] });
    case 'billing_record_mismatch':
    case 'custom_end_date':
      return refused('blocked', reason, { blockers: [{ code: 'contact_support' }] });
    case 'upgrade_pending':
    case 'change_pending':
      return refused('plan_change_pending', reason);
    case 'subscription_not_active':
    case 'not_subscribed':
      return refused('plan_state_changed', reason);
    case 'manage_unavailable':
      return refused('not_available', reason);
    case 'billing_row_unreadable':
      return refused('try_again', reason);
    case 'stripe_error':
      return refused('stripe_error', reason);
    case 'deletion_pending':
      // An owner reactivate only; a cancel never reads it. A fault if it ever arrives here.
      return refused('request_failed', reason);
  }
}

// ── Classification (§4.3; SA W-5; user decision Q-1: `trialing` as `active`) ─

type Classified =
  | { path: 'free' }
  | { path: 'paid'; renewalWasOn: boolean; planEndsAt: string | null; subscriptionId: string }
  | { path: 'refuse'; refusal: Refused };

function hasUnexpiredCheckout(row: BillingRowLike, now: Date): boolean {
  if (!row.openCheckoutSessionId) return false;
  const expiresAt = row.openCheckoutExpiresAt ? Date.parse(row.openCheckoutExpiresAt) : Number.NaN;
  // Unknown expiry with a session set: treat as open (fail closed), as `planManageOffer`.
  return !Number.isFinite(expiresAt) || expiresAt > now.getTime();
}

export function classifyBillingRow(row: BillingRowLike | null, pricesEnabled: () => boolean, now: Date): Classified {
  // W-5: "free" is decided from the row FIRST, before the prices switch is read.
  const free = !row || !row.stripeSubscriptionId || row.endedAt !== null;
  if (free) {
    // A checkout paid during grace would start a plan on a closing account.
    if (row && hasUnexpiredCheckout(row, now)) return { path: 'refuse', refusal: refused('plan_change_pending', 'open_checkout') };
    return { path: 'free' };
  }
  if (!pricesEnabled()) return { path: 'refuse', refusal: refused('not_available', 'prices_switch_off') };

  const offer = planManageOffer(row, { pricesEnabled: true }, now);
  const subscriptionId = row.stripeSubscriptionId as string;
  switch (offer.kind) {
    case 'renewing':
      return { path: 'paid', renewalWasOn: true, planEndsAt: row.currentPeriodEnd, subscriptionId };
    case 'cancelling':
      // BQ-33: the owner had already cancelled; Keep will not turn renewal back on.
      return { path: 'paid', renewalWasOn: false, planEndsAt: row.currentPeriodEnd, subscriptionId };
    case 'failing':
      return { path: 'refuse', refusal: refused('blocked', 'payment_failed', { blockers: [{ code: 'payment_failed' }] }) };
    case 'none':
      if (offer.reason === 'change_pending') return { path: 'refuse', refusal: refused('plan_change_pending', 'change_pending') };
      // period_over (webhook lagging an end), not_active without ended_at (incomplete, paused, unknown).
      return { path: 'refuse', refusal: refused('plan_state_changed', offer.reason) };
  }
}

/**
 * BQ-11 for the pre-check (Q-15): our billing row shows a failed renewal on a
 * live subscription, so the drawer lists `payment_failed` as the request would.
 * A data fact, so the prices switch is not an input here.
 */
export function isPaymentFailing(row: BillingRowLike | null, now: Date): boolean {
  if (!row || !row.stripeSubscriptionId || row.endedAt !== null) return false;
  return planManageOffer(row, { pricesEnabled: true }, now).kind === 'failing';
}

// ── The orchestration ───────────────────────────────────────────────────────

export async function runClosureRequest(input: ClosureRequestInput, deps: ClosureRequestDeps): Promise<ClosureRequestOutcome> {
  const { subject } = input;
  const log = deps.logger;
  const now = deps.now();
  const ids = { userId: subject };

  // R-6. One open request per account.
  const open = await deps.closures.findOpenForUser(subject);
  if (open.error) return refused('try_again', 'closure_read_failed');
  if (open.data) {
    log.info({ ...ids, closureId: open.data.id, closureStatus: open.data.status, outcome: 'already_requested' }, 'Deletion request: one is already open');
    return refused('already_requested', 'already_requested', { closureStatus: open.data.status, auditRefusal: false });
  }

  // R-7. The key mode, then our billing row, then the classification.
  let livemode: boolean;
  try {
    livemode = deps.livemode();
  } catch {
    log.error({ ...ids, outcome: 'not_available', reason: 'stripe_key_mode_unknown', alert: true }, 'Deletion request: the Stripe key mode is unknown');
    return refused('not_available', 'stripe_key_mode_unknown');
  }
  const billing = await deps.billingRow(subject, livemode);
  if (billing.error) return refused('try_again', 'billing_row_unreadable');
  const classified = classifyBillingRow(billing.data, deps.pricesEnabled, now);
  if (classified.path === 'refuse') {
    log.warn({ ...ids, outcome: classified.refusal.error, reason: classified.refusal.reason }, 'Deletion request refused from our billing row');
    return classified.refusal;
  }

  // R-8. The check, then the XC-5 filter on its RAW rows (W-4).
  const check = await deps.runCheck({ email: input.email, subject });
  if (check.kind === 'unavailable') return refused('not_available', check.reason);
  if (check.kind === 'failed') return refused('try_again', 'check_failed');
  const filtered = requestBlockers({ rows: check.rows, verdictBlocked: check.verdictBlocked, resolvedThisLogin: check.resolvedThisLogin });
  if (filtered.blocking.length > 0) {
    const views = toBlockerViews(filtered.blocking);
    const guards = [...new Set(filtered.blocking.map((row) => row.guard))];
    log.warn({ ...ids, outcome: 'blocked', guards, engineering: filtered.engineering }, 'Deletion request refused: blockers at stage A');
    return refused('blocked', 'blocked', { blockers: views.length > 0 ? views : [{ code: 'contact_support' }], guards });
  }

  // R-9. Free only: the lock date is promised to the owner, so an unreadable zone refuses.
  let lock: { lockAt: string; lockTimezone: string } | null = null;
  if (classified.path === 'free') {
    const zone = await deps.readTimezone(subject);
    if (zone.error) return refused('try_again', 'timezone_unreadable');
    lock = closureLockAt(now, zone.data);
  }

  // R-10. The request row (XC-2). `renewal_was_on` from our row; corrected at R-12.
  const paid = classified.path === 'paid' ? classified : null;
  const inserted = await deps.closures.insertRequesting({
    userId: subject,
    statementLanguage: input.statementLanguage,
    reasonCode: input.reasonCode,
    renewalWasOn: paid ? paid.renewalWasOn : false,
    planEndsAt: paid ? paid.planEndsAt : null,
  });
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === 'already_open') {
      const again = await deps.closures.findOpenForUser(subject);
      return refused('already_requested', 'already_requested', { closureStatus: again.data?.status ?? null, auditRefusal: false });
    }
    return refused('try_again', 'closure_insert_failed');
  }
  const closureId = inserted.data.id;
  const closureIds = { ...ids, closureId };

  // R-11f. Free: stage C starts now, its lock date fixed (W-2: no next_check_at).
  if (classified.path === 'free' && lock) {
    const graceStartsAt = now.toISOString();
    const moved = await deps.closures.transition(closureId, subject, 'requesting', 'grace', {
      grace_starts_at: graceStartsAt,
      lock_at: lock.lockAt,
      lock_timezone: lock.lockTimezone,
    });
    if (moved.error || moved.data !== true) {
      await withdraw(deps, closureId, subject, 'grace_transition_failed');
      return refused('try_again', 'grace_transition_failed', { closureId });
    }
    log.info({ ...closureIds, outcome: 'grace', lockAt: lock.lockAt, lockTimezone: lock.lockTimezone }, 'Deletion requested: free account, grace period started');
    return { ok: true, status: 'grace', closureId, graceStartsAt, lockAt: lock.lockAt, lockTimezone: lock.lockTimezone };
  }

  // R-11p. Paid: the one "don't renew" engine. A throw may follow the write: leave `requesting` (P-9).
  let result: PlanManageResult;
  try {
    result = await deps.manage({ action: 'cancel', userId: subject, accountId: input.accountId, origin: 'deletion_request', reasonCode: input.reasonCode });
  } catch {
    log.error({ ...closureIds, outcome: 'request_failed', reason: 'engine_threw', alert: true }, 'Deletion request: the cancel engine threw; the row stays requesting');
    return refused('request_failed', 'unexpected_failed', { closureId });
  }

  if (!result.ok) {
    if (result.outcomeUnknown) {
      // P-7: Stripe may have stopped the renewal. Never `pending`, never deleted: DL-3 settles it.
      log.error({ ...closureIds, outcome: 'stripe_error', outcomeUnknown: true, alert: true }, 'Deletion request: the Stripe answer was lost; the row stays requesting');
      return refused('stripe_error', 'plan_outcome_unknown', { outcomeUnknown: true, closureId, ...(result.audit ? { engineAudit: result.audit } : {}) });
    }
    // P-4: a definite refusal wrote nothing at Stripe, so the request is withdrawn.
    await withdraw(deps, closureId, subject, `plan_${result.code}`);
    return { ...mapEngineRefusal(result.code), closureId };
  }

  let endsOn: string | null;
  let renewalWasOn: boolean;
  let engineAudit: PlanManageAuditFacts | null = null;
  if (result.outcome === 'cancelled' && result.mode === 'immediate') {
    // P-3: impossible with origin `deletion_request` (§6 E-1). Leave `requesting`, alert.
    log.error({ ...closureIds, outcome: 'request_failed', reason: 'immediate_end', alert: true }, 'Deletion request: the engine ended the plan now; the row stays requesting');
    return refused('request_failed', 'plan_ended_now', { closureId, engineAudit: result.audit });
  } else if (result.outcome === 'cancelled') {
    // P-1: Stripe was renewing and now will not (D-3: Stripe's answer wins over our row).
    endsOn = result.endsOn;
    renewalWasOn = true;
    engineAudit = result.audit;
  } else if (result.outcome === 'unchanged' && result.state === 'cancelling') {
    // P-2: already set to end THIS period (W-1: the engine tested `isSetToEndThisPeriod`).
    endsOn = result.date;
    renewalWasOn = false;
  } else if (result.outcome === 'unchanged' && result.state === 'ended') {
    // P-5: our row lagged an end; the engine healed it, so a retry takes the free path.
    await withdraw(deps, closureId, subject, 'plan_ended');
    return refused('plan_state_changed', 'plan_ended', { closureId });
  } else {
    // P-6: `unchanged / renewing`, `reactivated`: a fault.
    log.error({ ...closureIds, outcome: 'request_failed', reason: 'unexpected_engine_answer', alert: true }, 'Deletion request: unexpected answer from the cancel engine');
    await withdraw(deps, closureId, subject, 'unexpected_engine_answer');
    return refused('request_failed', 'unexpected_engine_answer', { closureId });
  }

  // R-12. The ONLY place a row becomes `pending` (XC-2 invariant). W-2: no next_check_at.
  const moved = await deps.closures.transition(closureId, subject, 'requesting', 'pending', {
    renewal_was_on: renewalWasOn,
    plan_ends_at: endsOn,
  });
  if (moved.error || moved.data !== true) {
    // P-8: Stripe already will not renew; DL-3 settles the row to `pending` (SA Q-11).
    log.error({ ...closureIds, outcome: 'try_again', reason: 'pending_transition_failed', alert: true }, 'Deletion request: the plan is set to end but the row stays requesting');
    return refused('try_again', 'pending_transition_failed', {
      closureId,
      closureStatus: 'requesting',
      auditRefusal: false,
      ...(engineAudit ? { engineAudit } : {}),
    });
  }
  log.info({ ...closureIds, outcome: 'pending', renewalWasOn, planEndsOn: endsOn }, 'Deletion requested: the plan will not renew');
  return { ok: true, status: 'pending', closureId, planEndsOn: endsOn, renewalWasOn, engineAudit };
}

/** Remove the `requesting` row, best-effort. A row left behind is not open in the XC-2 sense; DL-3 settles it. */
async function withdraw(deps: ClosureRequestDeps, closureId: string, subject: string, reason: string): Promise<void> {
  const removed = await deps.closures.deleteRequesting(closureId, subject);
  if (removed.error || removed.data !== true) {
    deps.logger.error(
      { userId: subject, closureId, reason, removed: removed.data ?? null, alert: true },
      'Deletion request: the requesting row could not be withdrawn; DL-3 settles it'
    );
  }
}
