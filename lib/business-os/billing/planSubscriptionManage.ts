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
 *                                                        payment_failed_contact_us / manage_unavailable
 *   6  Stripe: the subscription, fresh; C-4 cross-checks
 *        (id, customer, mode, `bos_user_id`)            → billing_record_mismatch (alert, nothing written)
 *        its status                                     → payment_failed_contact_us / subscription_not_active
 *   7  already what was asked (C-3: the flag OR `cancel_at`)
 *                                                      → `unchanged`, no write, no audit; heals our row
 *                                                        when it disagrees with Stripe (C-2)
 *   8  a pending upgrade update                        → upgrade_pending (TQ-5, whatever Stripe allows: X-3)
 *   9  Stripe: THE write (`setBusinessOsCancelAtPeriodEnd`)
 *  10  mirror Stripe's own answer onto our row (CAS); a failure is a warn, the webhook converges (C-2)
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
 * @module lib/business-os/billing/planSubscriptionManage
 */

import { getStripeService, type BusinessOsCancelFacts, type StripeService } from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccount,
  type BusinessOsBillingAccountRepository,
  type BusinessOsSubscriptionStatus,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { MANAGEABLE_STATUSES, PAYMENT_FAILED_STATUSES, planManageOffer, type PlanManageSwitches } from '@/lib/business-os/billing/planManageOffer';
import { BOS_USER_ID_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

export type PlanManageAction = 'cancel' | 'reactivate';

// ── Refusals ────────────────────────────────────────────────────────────────

export type PlanManageRefusalCode =
  | 'manage_unavailable'
  | 'billing_row_unreadable'
  | 'not_subscribed'
  | 'subscription_not_active'
  | 'payment_failed_contact_us'
  | 'billing_record_mismatch'
  | 'upgrade_pending'
  | 'stripe_error';

/** HTTP status and owner-facing message per refusal. Never a Stripe or database message. */
export const PLAN_MANAGE_REFUSALS: Readonly<Record<PlanManageRefusalCode, { status: number; message: string }>> = {
  manage_unavailable: { status: 503, message: 'This is not available right now. Please try again later.' },
  billing_row_unreadable: { status: 503, message: 'We could not check your billing right now. Please try again.' },
  not_subscribed: { status: 409, message: 'There is no paid plan on your account.' },
  subscription_not_active: { status: 409, message: 'Your subscription is not active right now.' },
  payment_failed_contact_us: { status: 409, message: 'Your payment failed. Update your card, or contact us to cancel.' },
  billing_record_mismatch: { status: 409, message: 'We could not change your plan. Please contact support.' },
  upgrade_pending: { status: 409, message: 'An upgrade is waiting for payment. Finish or wait for it first.' },
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

export type PlanManageStripe = Pick<StripeService, 'retrieveBusinessOsSubscription' | 'setBusinessOsCancelAtPeriodEnd'>;

export interface PlanManageDeps {
  logger: PlanManageLogger;
  repo?: Pick<BusinessOsBillingAccountRepository, 'findByUser' | 'mirrorSubscriptionState'>;
  stripe?: PlanManageStripe;
  /** Default: the price-recognition switch only (SA C-1). */
  switches?: () => PlanManageSwitches;
  mode?: () => StripeMode;
  now?: () => Date;
}

export interface PlanManageInput {
  action: PlanManageAction;
  /** The session user. Never a request value. */
  userId: string;
  /** The session account (`resolveAccountId`), for the `bos_user_id` cross-check (C-4). */
  accountId: string;
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
  /** At the period end (P-7a.4 adds `immediate`, TQ-12). */
  mode: 'period_end';
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
  | { ok: true; outcome: 'cancelled'; endsOn: string | null; audit: PlanManageAuditFacts }
  | { ok: true; outcome: 'reactivated'; renewsOn: string | null; audit: PlanManageAuditFacts }
  /** Already what was asked: `state` says which, `date` is the end or the renewal. No write, no audit. */
  | { ok: true; outcome: 'unchanged'; state: 'cancelling' | 'renewing'; date: string | null }
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
      case 'period_over':
        return refuse('subscription_not_active', { source: 'record', reason: offer.reason, subscriptionStatus: row?.subscriptionStatus ?? null });
      case 'payment_failed':
        return refuse('payment_failed_contact_us', { source: 'record' });
    }
  }
  // `planManageOffer` answered renewing / cancelling, so the row and its subscription id exist.
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
  if (PAYMENT_FAILED_STATUSES.includes(fresh.status)) {
    return refuse('payment_failed_contact_us', { source: 'stripe', subscriptionId, subscriptionStatus: fresh.status });
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

  // 9. THE write.
  const auditBase = { action, subscriptionId, livemode, mode: 'period_end' as const };
  let after: BusinessOsCancelFacts;
  try {
    after = await stripe.setBusinessOsCancelAtPeriodEnd(subscriptionId, wantCancelling);
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
