/**
 * Cancel a paying Business OS account's plan at the period end, or reactivate
 * it before that date (plan payments P-7a.1; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.2; SA C-1 to
 * C-5, TQ-1 to TQ-5).
 *
 * Orchestration over injected ports, so every branch is tested with fakes.
 * One entry point, `managePlanSubscription(action)`, behind both routes.
 *
 * THE ORDER IS THE CONTRACT (as P-7b.1's SA V-9): every database read, and
 * every refusal decided from our own data, precedes any Stripe call.
 *
 *   3  price-recognition switch off, key mode unknown  → manage_unavailable
 *   4  billing row (session user, key mode)            → billing_row_unreadable
 *   5  planManageOffer (our data, the screen's rule)   → not_subscribed / subscription_not_active /
 *                                                        (P-7a.4 E-1: a CANCEL on a row our record shows
 *                                                        ended → `unchanged` / `ended`, no Stripe call) /
 *                                                        payment_failed_contact_us / manage_unavailable /
 *                                                        change_pending (D2, cancel only: SA W-3)
 *   6  Stripe: the subscription, fresh; C-4 cross-checks
 *        (id, customer, mode, `bos_user_id`)            → billing_record_mismatch (alert, nothing written)
 *        its status                                     → payment_failed_contact_us (reactivate only) /
 *                                                        subscription_not_active
 *        CANCEL + `past_due` / `unpaid` AT STRIPE       → the IMMEDIATE path (P-7a.4, below)
 *   7  already what was asked (C-3: the flag OR `cancel_at`)
 *                                                      → `unchanged`, no write, no audit; heals our row
 *                                                        when it disagrees with Stripe (C-2)
 *   8  a pending upgrade update                        → upgrade_pending (TQ-5, whatever Stripe allows: X-3)
 *   9  Stripe: THE write (`setBusinessOsCancelAtPeriodEnd`), with a key fresh
 *        PER CALL of this function (D2, SX C-4; SA Q-3 / W-4: `planManageAttemptKey`,
 *        a random uuid suffix, never derived from ids or time alone, never logged)
 *  10  mirror Stripe's own answer onto our row (CAS); a failure is a warn, the webhook converges (C-2)
 *
 * P-7a.4 — CANCEL DURING A FAILED PAYMENT ENDS THE PLAN NOW (workplan §4.3;
 * BQ-3 = A, user 2026-10-26; SA C-11, TQ-12; SA's P-7a.1 binding note). Our
 * row only ADMITS the cancel (`planManageOffer` → `failing`); Stripe's FRESH
 * status picks the mode: `past_due` / `unpaid` → immediate; `active` /
 * `trialing` (cured, webhook lagging) → the period-end path above, so a
 * paid-up plan is never ended at once on our row's say-so. A `failing` row
 * whose subscription Stripe already ended → `unchanged` / `ended` (a second
 * tab), healed, no write, no audit.
 *
 *   I-1  a pending upgrade update                      → upgrade_pending (TQ-5, as step 8)
 *   I-2  Stripe: `cancelBusinessOsSubscriptionNow` (`invoice_now: false`,
 *        `prorate: false`, no `cancellation_details`, so Stripe records
 *        `cancellation_requested`), key fresh per attempt (D2)
 *                                                      → stripe_error / outcomeUnknown (as step 9)
 *   I-3  C-11: every OPEN invoice of THIS subscription is voided, each its own
 *        Stripe call under a per-attempt key, after the cancel. X-4 (sandbox,
 *        2026-10-27): Stripe stops retrying the open invoice but leaves it
 *        payable, and paying it sends `invoice.paid`, which the apply path
 *        would honour. An invoice that is not ours (customer, subscription,
 *        mode), a list or void failure, or more than one page → counted as
 *        LEFT OPEN, logged `error` + alert (an operator voids it). The plan
 *        has still ended: the request succeeds
 *   I-4  mirror Stripe's answer (`canceled`, `ended_at`); the webhook's
 *        `.deleted` writes the `subscription_ended` money history row
 *   audit  the same CANCELLED key, `mode: 'immediate'`, with the void counts
 *
 * It assigns no plan and invalidates no entitlement: access follows the plan
 * row's paid-through date (SA-P8), which a cancellation does not move.
 *
 * TENANT ISOLATION (tenant-isolation-guard). The request carries nothing: the
 * account is the session's (the route resolves it), the subscription and
 * customer ids come from OUR billing row in the server key's mode, and the
 * fresh Stripe answer is cross-checked against that row before any write.
 *
 * Expected refusals are RESULTS, never throws; an unexpected fault throws and
 * the route answers 500. Refusals and `unchanged` are logged, never audited;
 * every request that reached the write returns `audit` facts (the outcome
 * `unknown` when Stripe's answer was lost, as P-7b.1's V-3).
 *
 * Imports nothing from the entitlements module (TQ-13).
 *
 * D2 / SX-1 (workplan docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md;
 * SA W-1 to W-12): this is THE one "don't renew" engine for both the plain
 * cancel and, from D6, the deletion request. It is route-agnostic; D6 adds the
 * `origin` input with its first real caller (W-5) and calls this function,
 * never the Stripe method (pinned by oneDontRenewPath.guard.test.ts, W-7). A
 * cancel may carry a reason CODE (`planLeaveReasons.ts`, SX C-10 / SA-4): it
 * reaches the audit facts only, never a log line as free text.
 *
 * @module lib/business-os/billing/planSubscriptionManage
 */

import { randomUUID } from 'crypto';

import { getStripeService, type BusinessOsCancelFacts, type StripeService } from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccount,
  type BusinessOsBillingAccountRepository,
  type BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { MANAGEABLE_STATUSES, PAYMENT_FAILED_STATUSES, planManageOffer, type PlanManageSwitches } from '@/lib/business-os/billing/planManageOffer';
import type { PlanLeaveReasonCode } from '@/lib/business-os/billing/planLeaveReasons';
import { BOS_USER_ID_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

export type PlanManageAction = 'cancel' | 'reactivate';

/**
 * D2 (SX C-4; SA Q-3, W-4): the Stripe idempotency key of ONE attempt. The
 * `attemptId` is a fresh random uuid per call of `managePlanSubscription`, so a
 * network retry inside the attempt reuses the key and the next attempt
 * (cancel → reactivate → cancel within 24 h) never does (P-7a TQ-3's concern).
 */
export function planManageAttemptKey(subscriptionId: string, action: PlanManageAction, attemptId: string): string {
  return `bos-plan-manage:${subscriptionId}:${action}:${attemptId}`;
}

/** P-7a.4: the immediate cancel's key, same shape and same attempt id as D2's (never logged). */
export function planCancelNowAttemptKey(subscriptionId: string, attemptId: string): string {
  return `bos-plan-manage:${subscriptionId}:cancel_now:${attemptId}`;
}

/** P-7a.4 (C-11): one void's key, per invoice and per attempt (never logged). */
export function planVoidInvoiceAttemptKey(invoiceId: string, attemptId: string): string {
  return `bos-plan-manage:${invoiceId}:void:${attemptId}`;
}

// ── Refusals ────────────────────────────────────────────────────────────────

export type PlanManageRefusalCode =
  | 'manage_unavailable'
  | 'billing_row_unreadable'
  | 'not_subscribed'
  | 'subscription_not_active'
  | 'payment_failed_contact_us'
  | 'billing_record_mismatch'
  | 'upgrade_pending'
  | 'change_pending'
  | 'stripe_error';

/** HTTP status and owner-facing message per refusal. Never a Stripe or database message. */
export const PLAN_MANAGE_REFUSALS: Readonly<Record<PlanManageRefusalCode, { status: number; message: string }>> = {
  manage_unavailable: { status: 503, message: 'This is not available right now. Please try again later.' },
  billing_row_unreadable: { status: 503, message: 'We could not check your billing right now. Please try again.' },
  not_subscribed: { status: 409, message: 'There is no paid plan on your account.' },
  subscription_not_active: { status: 409, message: 'Your subscription is not active right now.' },
  // P-7a.4 (TL ruling on QA E-2): only a Reactivate during a failed renewal gets this
  // now; same words as `plan.manage.refusal.payment_failed`. Code name kept (wire-stable).
  payment_failed_contact_us: { status: 409, message: 'Your payment failed. Update your card first, or cancel your plan.' },
  billing_record_mismatch: { status: 409, message: 'We could not change your plan. Please contact support.' },
  upgrade_pending: { status: 409, message: 'An upgrade is waiting for payment. Finish or wait for it first.' },
  change_pending: { status: 409, message: 'A plan change is in progress. Try again once it is finished.' },
  stripe_error: { status: 502, message: 'The payment provider did not respond. Please try again.' },
};

/** Logged at `error` with `alert: true`; every other refusal is a warn. */
const ALERTED: readonly PlanManageRefusalCode[] = ['billing_record_mismatch', 'stripe_error'];
/** `manage_unavailable` reasons that are configuration faults (alerted, as P-7b.1's F-3). */
const ALERTED_REASONS: readonly string[] = ['stripe_key_mode_unknown'];

/** Stripe refused the request before running it: nothing was written. */
const NOT_EXECUTED_ERROR_TYPES: readonly string[] = [
  'StripeInvalidRequestError',
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeRateLimitError',
];

const SUBSCRIPTION_STATUSES: readonly BusinessOsSubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

// ── Ports ───────────────────────────────────────────────────────────────────

export interface PlanManageLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export type PlanManageStripe = Pick<
  StripeService,
  | 'retrieveBusinessOsSubscription'
  | 'setBusinessOsCancelAtPeriodEnd'
  // P-7a.4 (immediate cancel and C-11's voids): the engine is their only caller (D2 W-7 guard).
  | 'cancelBusinessOsSubscriptionNow'
  | 'listBusinessOsOpenSubscriptionInvoices'
  | 'voidBusinessOsInvoice'
>;

export interface PlanManageDeps {
  logger: PlanManageLogger;
  repo?: Pick<BusinessOsBillingAccountRepository, 'findByUser' | 'mirrorSubscriptionState'>;
  stripe?: PlanManageStripe;
  /** Default: the price-recognition switch only (SA C-1). */
  switches?: () => PlanManageSwitches;
  mode?: () => StripeMode;
  now?: () => Date;
  /** D2 (SA W-4): the attempt id of the idempotency key. Default `randomUUID` (node `crypto`). */
  newAttemptId?: () => string;
}

export interface PlanManageInput {
  action: PlanManageAction;
  /** The session user. Never a request value. */
  userId: string;
  /** The session account (`resolveAccountId`), for the `bos_user_id` cross-check (C-4). */
  accountId: string;
  /** D2 (SX C-10, SA-4; SA Q-5): why the owner cancels, a code only. Ignored on reactivate. */
  reasonCode?: PlanLeaveReasonCode | null;
}

// ── Results ─────────────────────────────────────────────────────────────────

export type PlanManageAuditOutcome = 'cancelled' | 'reactivated' | 'unknown';

/** What the route audits. Ids and dates only. */
export interface PlanManageAuditFacts {
  action: PlanManageAction;
  outcome: PlanManageAuditOutcome;
  subscriptionId: string;
  /** ISO: when the plan stops (cancelled). */
  endsOn: string | null;
  /** ISO: the next renewal (reactivated). */
  renewsOn: string | null;
  livemode: boolean;
  /** At the period end, or `immediate` (P-7a.4: a failed payment, TQ-12). */
  mode: 'period_end' | 'immediate';
  /** P-7a.4 (C-11), immediate only: open invoices voided by this request. */
  invoicesVoided?: number;
  /** P-7a.4 (C-11), immediate only: open invoices NOT voided; `null` = could not tell (alerted). */
  invoicesLeftOpen?: number | null;
  /** D2 (SA Q-4): the cancel's reason code, or null (always null on reactivate). */
  reasonCode: PlanLeaveReasonCode | null;
}

export type PlanManageRefusal = {
  ok: false;
  code: PlanManageRefusalCode;
  /** ISO time a pending update expires (upgrade_pending). */
  retryAfter?: string;
  /** The write was attempted and its result is unknown (P-7b.1 V-3). Audited as `unknown`. */
  outcomeUnknown?: true;
  audit?: PlanManageAuditFacts;
};

export type PlanManageResult =
  /** `mode` is set only on P-7a.4's immediate end (`endsOn` is then when it ended); absent = period end. */
  | { ok: true; outcome: 'cancelled'; endsOn: string | null; mode?: 'immediate'; audit: PlanManageAuditFacts }
  | { ok: true; outcome: 'reactivated'; renewsOn: string | null; audit: PlanManageAuditFacts }
  /**
   * Already what was asked: `state` says which, `date` is the end or the
   * renewal. No write, no audit. P-7a.4: `ended` = a failed-payment cancel
   * whose subscription Stripe already ended (`date` = when).
   */
  | { ok: true; outcome: 'unchanged'; state: 'cancelling' | 'renewing' | 'ended'; date: string | null }
  | PlanManageRefusal;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoFromUnix(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}

function errorType(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const type = (err as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

/** A Stripe error, reduced to what an operator needs. The error object itself is never logged. */
function safeErr(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) return { kind: typeof err };
  const e = err as { type?: unknown; code?: unknown; statusCode?: unknown; requestId?: unknown; name?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : null,
    type: typeof e.type === 'string' ? e.type : null,
    code: typeof e.code === 'string' ? e.code : null,
    statusCode: typeof e.statusCode === 'number' ? e.statusCode : null,
    requestId: typeof e.requestId === 'string' ? e.requestId : null,
  };
}

/** C-3: cancelling is the flag OR a `cancel_at` date (X-2: the flag sets both; `cancel_at` alone is possible). */
function isCancelling(facts: { cancelAtPeriodEnd: boolean; cancelAt?: number | null }): boolean {
  return facts.cancelAtPeriodEnd || (typeof facts.cancelAt === 'number' && facts.cancelAt > 0);
}

/** The latest item period end, unix seconds (clover: the period is on the items). */
function latestItemPeriodEnd(items: ReadonlyArray<{ currentPeriodEnd: number | null }>): number | null {
  const ends = items.map((item) => item.currentPeriodEnd).filter((value): value is number => value !== null);
  return ends.length > 0 ? Math.max(...ends) : null;
}

function defaultSwitches(): PlanManageSwitches {
  return { pricesEnabled: isPlanPriceRecognitionEnabled() };
}

type RefuseFn = (code: PlanManageRefusalCode, context?: Record<string, unknown>, extra?: Omit<PlanManageRefusal, 'ok' | 'code'>) => PlanManageRefusal;

function refuser(log: PlanManageLogger, userId: string, action: PlanManageAction): RefuseFn {
  return (code, context = {}, extra = {}) => {
    const reason = typeof context.reason === 'string' ? context.reason : null;
    const alerted = ALERTED.includes(code) || (code === 'manage_unavailable' && reason !== null && ALERTED_REASONS.includes(reason));
    log[alerted ? 'error' : 'warn'](
      { event: 'bos_billing_manage_refused', code, action, userId, ...(alerted ? { alert: true } : {}), ...context },
      'Plan cancel / reactivate refused'
    );
    return { ok: false, code, ...extra };
  };
}

// ── The orchestration ───────────────────────────────────────────────────────

export async function managePlanSubscription(input: PlanManageInput, deps: PlanManageDeps): Promise<PlanManageResult> {
  const { action, userId, accountId } = input;
  const log = deps.logger;
  const refuse = refuser(log, userId, action);
  const now = (deps.now ?? (() => new Date()))();
  const switches = (deps.switches ?? defaultSwitches)();
  const repo = deps.repo ?? businessOsBillingAccountRepository;

  // 3. The route already 404s with the switch off; this is the orchestration's own floor.
  if (!switches.pricesEnabled) return refuse('manage_unavailable', { reason: 'bos_billing_prices_switch_off' });
  let livemode: boolean;
  try {
    livemode = isLiveMode((deps.mode ?? currentStripeMode)());
  } catch {
    return refuse('manage_unavailable', { reason: 'stripe_key_mode_unknown' });
  }

  // 4. Our billing row: by the session user and the server key's mode.
  const read = await repo.findByUser(userId, livemode);
  if (read.error) return refuse('billing_row_unreadable');
  const row = read.data;

  // 5. Our-data decision: the same predicate the screen uses. Which of the two
  //    actions is asked does not matter here: the fresh state decides at step 7,
  //    so a stale row (C-2) never blocks the press that would repair it.
  const offer = planManageOffer(row, switches, now);
  if (offer.kind === 'none') {
    switch (offer.reason) {
      case 'switch_off':
        return refuse('manage_unavailable', { reason: 'bos_billing_prices_switch_off' });
      case 'not_subscribed':
        return refuse('not_subscribed', { source: 'record' });
      case 'not_active':
        // P-7a.4, TL ruling on QA E-1: a CANCEL on a row whose subscription our
        // record already shows ended (a second tab after the immediate end
        // mirrored, or any ended plan) answers what is true, "has ended": from
        // our row, no Stripe call, no write, no audit. Reactivate keeps the refusal.
        if (action === 'cancel' && row && row.stripeSubscriptionId && row.endedAt !== null) {
          log.info(
            { event: 'bos_billing_manage_unchanged', action, userId, subscriptionId: row.stripeSubscriptionId, healed: false, state: 'ended', source: 'record', livemode },
            'Plan cancel: our record shows the subscription has already ended'
          );
          return { ok: true, outcome: 'unchanged', state: 'ended', date: row.endedAt };
        }
        return refuse('subscription_not_active', { source: 'record', reason: offer.reason, subscriptionStatus: row?.subscriptionStatus ?? null });
      case 'period_over':
        return refuse('subscription_not_active', { source: 'record', reason: offer.reason, subscriptionStatus: row?.subscriptionStatus ?? null });
      case 'change_pending':
        // D2 (SA W-3): refuses a CANCEL only. A reactivate goes on (our row says
        // renewing, but it may be stale, P-7a C-2): Keep is never refused for this.
        if (action === 'cancel') return refuse('change_pending', { source: 'record' });
        break;
    }
  }
  // P-7a.4: a failed renewal admits a CANCEL only (no Reactivate is offered there).
  if (offer.kind === 'failing' && action === 'reactivate') return refuse('payment_failed_contact_us', { source: 'record' });
  // `planManageOffer` answered renewing / cancelling / failing (or change_pending
  // on a reactivate, which follows only the live-row rules), so the row and its
  // subscription id exist.
  const ownRow = row as BusinessOsBillingAccount & { stripeSubscriptionId: string };
  const subscriptionId = ownRow.stripeSubscriptionId;

  // 6. Stripe's answer, fresh, for OUR row's subscription (never a request value).
  const stripe = deps.stripe ?? getStripeService();
  let fresh: Awaited<ReturnType<PlanManageStripe['retrieveBusinessOsSubscription']>>;
  try {
    fresh = await stripe.retrieveBusinessOsSubscription(subscriptionId);
  } catch (err) {
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'subscription_read', subscriptionId });
  }

  // C-4: exactly these four, before any write.
  const claim = fresh.metadata?.[BOS_USER_ID_METADATA_KEY];
  const checks = {
    subscriptionMatches: fresh.id === subscriptionId,
    customerMatches: fresh.customerId === ownRow.stripeCustomerId,
    modeMatches: fresh.livemode === ownRow.livemode && ownRow.livemode === livemode,
    metadataMatches: !claim || claim === accountId,
  };
  if (!checks.subscriptionMatches || !checks.customerMatches || !checks.modeMatches || !checks.metadataMatches) {
    return refuse('billing_record_mismatch', { reason: 'subscription_record_differs', subscriptionId, ...checks });
  }
  if (PAYMENT_FAILED_STATUSES.includes(fresh.status) && fresh.endedAt === null) {
    // P-7a.4 (SA's P-7a.1 binding note): STRIPE's fresh status picks the mode, never our row.
    if (action === 'cancel') {
      return cancelNow({ deps, log, refuse, repo, stripe, ownRow, fresh, userId, livemode, now, reasonCode: input.reasonCode ?? null });
    }
    return refuse('payment_failed_contact_us', { source: 'stripe', subscriptionId, subscriptionStatus: fresh.status });
  }
  if (action === 'cancel' && offer.kind === 'failing' && fresh.status === 'canceled' && fresh.endedAt !== null) {
    // P-7a.4: already ended at Stripe (a second tab, or Stripe's own dunning end); our row lags.
    await mirror(repo, log, ownRow, { status: fresh.status, cancelAtPeriodEnd: fresh.cancelAtPeriodEnd, endedAt: fresh.endedAt }, now, 'heal');
    log.info({ event: 'bos_billing_manage_unchanged', action, userId, subscriptionId, healed: true, state: 'ended', livemode }, 'Plan cancel: the subscription has already ended');
    return { ok: true, outcome: 'unchanged', state: 'ended', date: isoFromUnix(fresh.endedAt) };
  }
  if (!MANAGEABLE_STATUSES.includes(fresh.status) || fresh.endedAt !== null) {
    return refuse('subscription_not_active', { source: 'stripe', subscriptionId, subscriptionStatus: fresh.status });
  }

  const freshPeriodEnd = latestItemPeriodEnd(fresh.items);
  const wantCancelling = action === 'cancel';

  // 7. Already what was asked: no write, no audit. C-2: heal our row if it disagrees.
  if (isCancelling(fresh) === wantCancelling) {
    const rowDisagrees = ownRow.cancelAtPeriodEnd !== fresh.cancelAtPeriodEnd || ownRow.subscriptionStatus !== fresh.status;
    if (rowDisagrees) {
      await mirror(repo, log, ownRow, { status: fresh.status, cancelAtPeriodEnd: fresh.cancelAtPeriodEnd, endedAt: fresh.endedAt }, now, 'heal');
    }
    log.info(
      { event: 'bos_billing_manage_unchanged', action, userId, subscriptionId, healed: rowDisagrees, livemode },
      'Plan cancel / reactivate: already in that state'
    );
    return wantCancelling
      ? { ok: true, outcome: 'unchanged', state: 'cancelling', date: isoFromUnix(fresh.cancelAt ?? freshPeriodEnd) }
      : { ok: true, outcome: 'unchanged', state: 'renewing', date: isoFromUnix(freshPeriodEnd) };
  }

  // 8. TQ-5: a pending upgrade update is refused, whatever Stripe would allow (X-3 showed it would).
  if (fresh.pendingUpdate !== null) {
    const retryAfter = isoFromUnix(fresh.pendingUpdate.expiresAt) ?? undefined;
    return refuse('upgrade_pending', { subscriptionId }, retryAfter ? { retryAfter } : {});
  }

  // 9. THE write, under a key fresh for this attempt (D2, SX C-4). The key is never logged.
  const reasonCode = wantCancelling ? input.reasonCode ?? null : null;
  const auditBase = { action, subscriptionId, livemode, mode: 'period_end' as const, reasonCode };
  const idempotencyKey = planManageAttemptKey(subscriptionId, action, (deps.newAttemptId ?? randomUUID)());
  let after: BusinessOsCancelFacts;
  try {
    after = await stripe.setBusinessOsCancelAtPeriodEnd(subscriptionId, wantCancelling, { idempotencyKey });
  } catch (err) {
    const type = errorType(err);
    if (type !== null && NOT_EXECUTED_ERROR_TYPES.includes(type)) {
      return refuse('stripe_error', { stripeError: safeErr(err), step: 'update', reason: 'refused_by_stripe', subscriptionId });
    }
    // Timeout, 5xx, connection: the change may have been made (P-7b.1 V-3).
    const audit: PlanManageAuditFacts = { ...auditBase, outcome: 'unknown', endsOn: null, renewsOn: null };
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'update', reason: 'outcome_unknown', subscriptionId }, { outcomeUnknown: true, audit });
  }

  // Stripe's answer must be OUR subscription in the asked state; otherwise we cannot say what happened.
  if (after.id !== subscriptionId || after.customerId !== ownRow.stripeCustomerId || after.livemode !== ownRow.livemode || isCancelling(after) !== wantCancelling) {
    const audit: PlanManageAuditFacts = { ...auditBase, outcome: 'unknown', endsOn: null, renewsOn: null };
    return refuse(
      'stripe_error',
      { step: 'update', reason: 'answer_differs', subscriptionId, cancelAtPeriodEnd: after.cancelAtPeriodEnd, hasCancelAt: after.cancelAt !== null },
      { outcomeUnknown: true, audit }
    );
  }

  // 10. Our row, from the write's own answer (C-2). Never fails the request.
  await mirror(repo, log, ownRow, { status: after.status, cancelAtPeriodEnd: after.cancelAtPeriodEnd, endedAt: after.endedAt }, now, 'write');

  const endsOn = wantCancelling ? isoFromUnix(after.cancelAt ?? after.currentPeriodEnd) : null;
  const renewsOn = wantCancelling ? null : isoFromUnix(after.currentPeriodEnd);
  const outcome: 'cancelled' | 'reactivated' = wantCancelling ? 'cancelled' : 'reactivated';
  const audit: PlanManageAuditFacts = { ...auditBase, outcome, endsOn, renewsOn };
  log.info(
    { event: wantCancelling ? 'bos_billing_plan_cancelled' : 'bos_billing_plan_reactivated', userId, subscriptionId, endsOn, renewsOn, livemode },
    wantCancelling ? 'Plan set to cancel at the period end' : 'Plan cancellation removed'
  );
  return wantCancelling
    ? { ok: true, outcome: 'cancelled', endsOn, audit }
    : { ok: true, outcome: 'reactivated', renewsOn, audit };
}

// ── P-7a.4: the immediate end (workplan §4.3; SA C-11, TQ-12) ──────────────

type FreshSubscription = Awaited<ReturnType<PlanManageStripe['retrieveBusinessOsSubscription']>>;

interface CancelNowContext {
  deps: PlanManageDeps;
  log: PlanManageLogger;
  refuse: RefuseFn;
  repo: Pick<BusinessOsBillingAccountRepository, 'mirrorSubscriptionState'>;
  stripe: PlanManageStripe;
  ownRow: BusinessOsBillingAccount & { stripeSubscriptionId: string };
  fresh: FreshSubscription;
  userId: string;
  livemode: boolean;
  now: Date;
  reasonCode: PlanLeaveReasonCode | null;
}

async function cancelNow(c: CancelNowContext): Promise<PlanManageResult> {
  const { log, refuse, stripe, ownRow, fresh, userId, livemode, now } = c;
  const subscriptionId = ownRow.stripeSubscriptionId;

  // I-1. TQ-5, as the period-end path: a pending upgrade update is refused.
  if (fresh.pendingUpdate !== null) {
    const retryAfter = isoFromUnix(fresh.pendingUpdate.expiresAt) ?? undefined;
    return refuse('upgrade_pending', { subscriptionId, mode: 'immediate' }, retryAfter ? { retryAfter } : {});
  }

  // I-2. THE end, under a key fresh for this attempt (D2's pattern). Never logged.
  const attemptId = (c.deps.newAttemptId ?? randomUUID)();
  const auditBase = { action: 'cancel' as const, subscriptionId, livemode, mode: 'immediate' as const, reasonCode: c.reasonCode, renewsOn: null };
  let after: BusinessOsCancelFacts;
  try {
    after = await stripe.cancelBusinessOsSubscriptionNow(subscriptionId, { idempotencyKey: planCancelNowAttemptKey(subscriptionId, attemptId) });
  } catch (err) {
    const type = errorType(err);
    if (type !== null && NOT_EXECUTED_ERROR_TYPES.includes(type)) {
      return refuse('stripe_error', { stripeError: safeErr(err), step: 'cancel_now', reason: 'refused_by_stripe', subscriptionId });
    }
    // The end may have happened, with its open invoice still payable: the
    // alert (stripe_error is alerted) is the operator's cue to check C-11.
    const audit: PlanManageAuditFacts = { ...auditBase, outcome: 'unknown', endsOn: null, invoicesVoided: 0, invoicesLeftOpen: null };
    return refuse(
      'stripe_error',
      { stripeError: safeErr(err), step: 'cancel_now', reason: 'outcome_unknown', subscriptionId, invoiceSweep: 'not_run' },
      { outcomeUnknown: true, audit }
    );
  }

  if (after.id !== subscriptionId || after.customerId !== ownRow.stripeCustomerId || after.livemode !== ownRow.livemode || after.status !== 'canceled') {
    const audit: PlanManageAuditFacts = { ...auditBase, outcome: 'unknown', endsOn: null, invoicesVoided: 0, invoicesLeftOpen: null };
    return refuse(
      'stripe_error',
      { step: 'cancel_now', reason: 'answer_differs', subscriptionId, subscriptionStatus: after.status, invoiceSweep: 'not_run' },
      { outcomeUnknown: true, audit }
    );
  }

  // I-3. C-11: void what is still open on THIS subscription.
  const sweep = await voidOpenInvoices(c, attemptId);

  // I-4. Our row, from Stripe's answer. Never fails the request.
  await mirror(c.repo, log, ownRow, { status: after.status, cancelAtPeriodEnd: after.cancelAtPeriodEnd, endedAt: after.endedAt }, now, 'write');

  const endsOn = isoFromUnix(after.endedAt) ?? now.toISOString();
  const audit: PlanManageAuditFacts = {
    ...auditBase,
    outcome: 'cancelled',
    endsOn,
    invoicesVoided: sweep.voided,
    invoicesLeftOpen: sweep.leftOpen,
  };
  log.info(
    { event: 'bos_billing_plan_ended_now', userId, subscriptionId, endsOn, invoicesVoided: sweep.voided, invoicesLeftOpen: sweep.leftOpen, livemode },
    'Plan ended now after a failed payment'
  );
  return { ok: true, outcome: 'cancelled', endsOn, mode: 'immediate', audit };
}

/**
 * C-11: void every open invoice of the ended subscription. Never throws. An
 * invoice that fails a check, a failed void, a failed list or a second page
 * is left open and alerted; `leftOpen: null` = the list itself was not read.
 */
async function voidOpenInvoices(c: CancelNowContext, attemptId: string): Promise<{ voided: number; leftOpen: number | null }> {
  const { log, stripe, ownRow, livemode } = c;
  const subscriptionId = ownRow.stripeSubscriptionId;
  const alert = (context: Record<string, unknown>) =>
    log.error(
      { event: 'bos_billing_cancel_now_invoice_left_open', alert: true, userId: c.userId, subscriptionId, livemode, ...context },
      'Plan ended now, but an open invoice could not be voided; void it in Stripe'
    );

  let listed: Awaited<ReturnType<PlanManageStripe['listBusinessOsOpenSubscriptionInvoices']>>;
  try {
    listed = await stripe.listBusinessOsOpenSubscriptionInvoices(subscriptionId);
  } catch (err) {
    alert({ step: 'list', stripeError: safeErr(err) });
    return { voided: 0, leftOpen: null };
  }

  let voided = 0;
  let leftOpen = 0;
  for (const invoice of listed.invoices) {
    const ours =
      invoice.id.length > 0 &&
      invoice.customerId === ownRow.stripeCustomerId &&
      invoice.subscriptionId === subscriptionId &&
      invoice.livemode === ownRow.livemode;
    if (!ours) {
      leftOpen += 1;
      alert({ step: 'check', invoiceId: invoice.id || null, reason: 'invoice_record_differs' });
      continue;
    }
    try {
      const answer = await stripe.voidBusinessOsInvoice(invoice.id, { idempotencyKey: planVoidInvoiceAttemptKey(invoice.id, attemptId) });
      if (answer.id === invoice.id && answer.status === 'void') {
        voided += 1;
      } else {
        leftOpen += 1;
        alert({ step: 'void', invoiceId: invoice.id, reason: 'answer_differs', invoiceStatus: answer.status });
      }
    } catch (err) {
      leftOpen += 1;
      alert({ step: 'void', invoiceId: invoice.id, stripeError: safeErr(err) });
    }
  }
  if (listed.hasMore) {
    alert({ step: 'list', reason: 'more_than_one_page' });
    return { voided, leftOpen: null };
  }
  return { voided, leftOpen };
}

/**
 * Copy Stripe's state onto our row with the webhook's own CAS method
 * (`mirrorSubscriptionState`, keyed on user, mode and subscription id). Never
 * throws and never fails the request: the webhook's fresh read writes the same
 * values (C-2). A status our table cannot hold is not written.
 */
async function mirror(
  repo: Pick<BusinessOsBillingAccountRepository, 'mirrorSubscriptionState'>,
  log: PlanManageLogger,
  row: BusinessOsBillingAccount & { stripeSubscriptionId: string },
  state: { status: string; cancelAtPeriodEnd: boolean; endedAt: number | null },
  now: Date,
  source: 'write' | 'heal'
): Promise<void> {
  const ids = { userId: row.accountId, subscriptionId: row.stripeSubscriptionId, livemode: row.livemode, source };
  const status = SUBSCRIPTION_STATUSES.find((known) => known === state.status);
  if (!status || row.accountId === null) {
    log.warn({ event: 'bos_billing_manage_mirror_skipped', reason: status ? 'detached_row' : 'unknown_status', ...ids }, 'Billing record not updated after a cancel / reactivate');
    return;
  }
  try {
    const result = await repo.mirrorSubscriptionState({
      userId: row.accountId,
      livemode: row.livemode,
      stripeSubscriptionId: row.stripeSubscriptionId,
      status,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      endedAtIso: isoFromUnix(state.endedAt),
      nowIso: now.toISOString(),
    });
    if (result.error || !result.data) {
      log.warn({ event: 'bos_billing_manage_mirror_failed', ...ids }, 'Billing record not updated after a cancel / reactivate; the webhook will');
      return;
    }
    if (!result.data.mirrored) {
      log.warn({ event: 'bos_billing_manage_mirror_skipped', reason: 'row_no_longer_holds_subscription', ...ids }, 'Billing record no longer holds this subscription');
    }
  } catch {
    // The repository never throws; if it ever does, the webhook still converges.
    log.warn({ event: 'bos_billing_manage_mirror_failed', ...ids }, 'Billing record not updated after a cancel / reactivate; the webhook will');
  }
}
