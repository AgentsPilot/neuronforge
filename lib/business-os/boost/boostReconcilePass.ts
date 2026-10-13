/**
 * The boost reconcile pass (credits boost slice 4b.2; requirement FR-43, F-1,
 * R-8, R-10; workplan §3.4; SA C-2, C-3, C-4, C-8, C-9; 2b N-2; 4a C-1, C-3).
 *
 * Run nightly by `bos-billing-reconcile` (and on demand by the admin trigger),
 * it recovers what a missed or stuck webhook left behind, in three reads of at
 * most 50 rows each, oldest first, current Stripe mode only:
 *
 *   1. STUCK: `pending` / `awaiting_payment` purchases 30 min past their
 *      checkout expiry. Stripe's session (with the payment intent and its
 *      latest charge) decides: paid → credit, then apply any refund or dispute
 *      the charge already carries (N-2: a reversal that came before crediting);
 *      expired → expire; a delayed payment that failed → fail; still processing
 *      or open → leave. A row with NO session is never credited (C-3): after
 *      48 h it is expired, which only stops it counting toward the cap.
 *   2. DISPUTED (C-9): purchases still `disputed`. The dispute is read by the
 *      id stored on the row: won → `dispute_won`, lost → `dispute_lost`, open →
 *      leave. This also heals a `closed` that came before `created`.
 *   3. RECEIPTS: `paid` purchases with no receipt link 10 min after payment.
 *
 * Every effect runs through 2b's idempotent, row-locked functions on the row's
 * own id; the account is always the one the row returns (R-6). Lots are never
 * touched (T-9). So two overlapping runs (the cron and the admin trigger, or a
 * run and a webhook) converge: no claim is needed (SA Q-5).
 *
 * C-2: when an effect answers as if the row had moved (`not_allowed`,
 * `not_creditable`, `already_credited`), the row is read again. If a webhook
 * got there first, the row counts as `raced` (info, no alert, no audit). Only
 * a real disagreement is a finding.
 *
 * Each row decides its own outcome and the pass never throws for one row:
 *   - a finding (a person must look) → `error bos_boost_reconcile_finding`
 *     with `alert: true`, and ONE `BOS_BOOST_FLAGGED` audit entry per problem
 *     (SA CR-1): a stuck row is flagged `flagged_mismatch` once and leaves the
 *     stuck set; a row that cannot be flagged is alerted each run but audited
 *     only the first time;
 *   - a transient failure (a Stripe timeout, a 5xx, a retryable SQLSTATE) →
 *     counted as deferred and left for the next run;
 *   - a Stripe key problem (missing key or client, authentication or
 *     permission refused) stops the pass: every row would fail the same way.
 *
 * C-4 / CR-3: no row is started with less than 15 s before the deadline; the counts
 * then report `deadlineHit` and the rows left.
 *
 * @module lib/business-os/boost/boostReconcilePass
 */

import { z } from 'zod';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import type { ReconcileLogger, ReconcilePass, ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';
import { plan } from '@/lib/business-os/boost/boostChargeHandler';
import { sameCurrency } from '@/lib/business-os/boost/boostChargeEvents';
import { BOOST_RECEIPT_HARD_LIMIT_MS, BOOST_RECEIPT_REQUEST_OPTIONS, type BoostReceiptOutcome } from '@/lib/business-os/boost/boostReceipt';
import { boostMetadataDisagrees, parseBoostSession, type BoostSession } from '@/lib/business-os/boost/boostWebhookSession';
import {
  BOOST_PURCHASE_READ_LIMITS,
  isAnomalousRepositoryError,
  isDeterministicRepositoryError,
  type BoostReconcileListKind,
  type BusinessOsBoostPurchase,
  type BusinessOsBoostPurchaseRepository,
  type BusinessOsBoostPurchaseStatus,
  type BusinessOsBoostTransitionInput,
  type BusinessOsBoostTransitionStatus,
  type BusinessOsBoostTransitionTarget,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import type { AgentRepositoryResult as RepositoryResult } from '@/lib/repositories/types';

const MINUTE_MS = 60 * 1000;

/** SA Q-8 and C-4. Durations are written as arithmetic, never as one literal. */
export const BOOST_RECONCILE_LIMITS = {
  /** Rows per read (one read per kind). */
  BATCH: BOOST_PURCHASE_READ_LIMITS.MAX_RECONCILE_BATCH,
  /** A pending / awaiting purchase is stuck 30 min after its checkout expiry. */
  STUCK_GRACE_MS: 30 * MINUTE_MS,
  /** A purchase with no session is expired 48 h after its checkout expiry (C-3). */
  NO_SESSION_EXPIRE_MS: 48 * 60 * MINUTE_MS,
  /** A disputed purchase is re-read once it has been disputed for 30 min (C-9). */
  DISPUTE_GRACE_MS: 30 * MINUTE_MS,
  /** A missing receipt is backfilled 10 min after payment. */
  RECEIPT_GRACE_MS: 10 * MINUTE_MS,
  /**
   * C-4 / SA CR-3: never start a row with less than this left before the
   * deadline. One row can make two Stripe reads, each locally bounded at 6 s
   * (the session, then `disputes.list`), plus its SQL calls, so 15 s keeps the
   * run inside 45 s + 15 s = maxDuration.
   */
  ROW_MARGIN_MS: 15 * 1000,
} as const;

/** The pass's counters, in the run record as `boost<Key>`. Counts only, never money. */
export const BOOST_RECONCILE_COUNT_KEYS = [
  'examined',
  'credited',
  'expired',
  'failed',
  'stillProcessing',
  'stillOpen',
  'flagged',
  'raced',
  'reversalsApplied',
  'disputesExamined',
  'disputesConcluded',
  'disputesStillOpen',
  'receiptsExamined',
  'receiptsFilled',
  'receiptsNotFilled',
  'deferred',
  'deadlineHit',
  'rowsLeft',
  'batchFull',
  'listFailed',
  'stripeUnavailable',
] as const;
export type BoostReconcileCountKey = (typeof BOOST_RECONCILE_COUNT_KEYS)[number];
export type BoostReconcileCounts = Record<BoostReconcileCountKey, number>;

type StripeRequestOptions = { timeout: number; maxNetworkRetries: number };

/** The three Stripe reads, typed structurally so the tests need no SDK. */
export interface BoostReconcileStripePort {
  checkout: {
    sessions: {
      retrieve(id: string, params: { expand: string[] }, options: StripeRequestOptions): Promise<unknown>;
    };
  };
  disputes: {
    retrieve(id: string, params: Record<string, never>, options: StripeRequestOptions): Promise<unknown>;
    list(params: { payment_intent: string; limit: number }, options: StripeRequestOptions): Promise<unknown>;
  };
}

export interface BoostReconcileDeps {
  purchases: Pick<BusinessOsBoostPurchaseRepository, 'listForReconcile' | 'credit' | 'transition' | 'recordReceipt'> & {
    /** The row again, by its own id (C-2); wired to the webhook's unscoped by-id read. */
    reread(purchaseId: string): Promise<RepositoryResult<BusinessOsBoostPurchase | null>>;
  };
  /** Null when the Business OS Stripe client cannot be built (the pass stops). */
  stripe: () => BoostReconcileStripePort | null;
  /** `true` when the server's key is live; null when it cannot be told (the pass stops). */
  keyLivemode: () => boolean | null;
  /** Writes and flushes one audit entry, bounded; never throws (`logAndFlush`). */
  audit: (entry: AuditLogInput, log: ReconcileLogger) => Promise<void>;
  /** The 4a receipt fill (one payment-intent read), bounded; never throws. */
  receipt: (input: { purchaseId: string; paymentIntentId: string; eventLivemode: boolean }, log: ReconcileLogger) => Promise<BoostReceiptOutcome>;
  /** Epoch ms; the deadline is checked against it. */
  clock: () => number;
  /**
   * SA CR-1: does this purchase already have a `BOS_BOOST_FLAGGED` audit entry
   * with this reason? Scoped to the purchase's own account. `null` when it
   * cannot be told (the audit is then skipped; the alert still fires).
   */
  findingRecorded: (input: { accountId: string; purchaseId: string; reason: string }) => Promise<boolean | null>;
}

// ── What the pass reads from Stripe (Zod; unknown fields ignored) ────────────

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{1,252}$/;
const CHARGE_ID = /^(ch|py)_[A-Za-z0-9_]{1,250}$/;
const DISPUTE_ID = /^(dp|du)_[A-Za-z0-9_]{1,250}$/;
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const chargeSchema = z
  .object({
    id: z.string().regex(CHARGE_ID),
    amount_refunded: minor,
    currency: z.string().min(1).max(10),
    refunded: z.boolean().optional(),
    disputed: z.boolean().optional(),
    receipt_url: z.string().max(2048).nullable().optional(),
  })
  .passthrough();

const intentSchema = z
  .object({
    id: z.string().regex(PAYMENT_INTENT_ID),
    status: z.string().min(1).max(64),
    latest_charge: z.union([z.string(), chargeSchema]).nullable().optional(),
  })
  .passthrough();

/** The session fields 4a's `parseBoostSession` does not read. */
const sessionStateSchema = z
  .object({
    status: z.enum(['open', 'complete', 'expired']).nullable(),
    expires_at: z.number().int().nonnegative(),
    livemode: z.boolean(),
    payment_intent: z.union([z.string().regex(PAYMENT_INTENT_ID), intentSchema]).nullable().optional(),
  })
  .passthrough();

const disputeSchema = z
  .object({
    id: z.string().regex(DISPUTE_ID),
    status: z.string().min(1).max(64),
    currency: z.string().min(1).max(10),
    payment_intent: z
      .union([z.string().regex(PAYMENT_INTENT_ID), z.object({ id: z.string().regex(PAYMENT_INTENT_ID) }).passthrough()])
      .nullable()
      .optional(),
  })
  .passthrough();

const disputeListSchema = z.object({ data: z.array(disputeSchema) }).passthrough();

type StripeCharge = z.infer<typeof chargeSchema>;
type StripeIntent = z.infer<typeof intentSchema>;
type StripeDispute = z.infer<typeof disputeSchema>;

/** Dispute statuses that are still being decided (Stripe's list). */
const DISPUTE_OPEN: ReadonlySet<string> = new Set(['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review']);

/** What a stuck purchase can be: the reads only return these two. */
const STUCK: ReadonlySet<string> = new Set(['pending', 'awaiting_payment']);

/** "The money arrived" (4a QA4a-D1). */
const PAID_FAMILY: ReadonlySet<string> = new Set(['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost']);

/** Statuses a won dispute returns a purchase to, and that a new dispute may open from (2b). */
const DISPUTE_CONCLUDED_BACK_TO: ReadonlySet<string> = new Set(['paid', 'partially_refunded', 'refunded']);

const ENTITY_TYPE = 'business_os_boost_purchase' as const;

/** Thrown inside the pass only: the Stripe key cannot be used, so no row can be read. */
class StopPass extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'StopPass';
  }
}

type StripeFailureKind = 'missing' | 'invalid' | 'key' | 'transient';
type StripeRead<T> = { ok: true; value: T } | { ok: false; kind: StripeFailureKind; facts: Record<string, unknown> };

/** Facts about a Stripe error, never its message (it can echo request values; slice 3 QA3-D2). */
function stripeFactsOf(error: unknown): Record<string, unknown> {
  const facts = error as { type?: unknown; code?: unknown; requestId?: unknown; statusCode?: unknown; name?: unknown } | null;
  return {
    type: typeof facts?.type === 'string' ? facts.type : null,
    code: typeof facts?.code === 'string' ? facts.code : null,
    requestId: typeof facts?.requestId === 'string' ? facts.requestId : null,
    statusCode: typeof facts?.statusCode === 'number' ? facts.statusCode : null,
    errorName: typeof facts?.name === 'string' ? facts.name : null,
  };
}

/** Which Stripe failures a retry can change. */
export function classifyStripeFailure(error: unknown): StripeFailureKind {
  const facts = stripeFactsOf(error);
  if (facts.type === 'StripeAuthenticationError' || facts.type === 'StripePermissionError') return 'key';
  if (facts.type === 'StripeInvalidRequestError') {
    return facts.statusCode === 404 || facts.code === 'resource_missing' ? 'missing' : 'invalid';
  }
  return 'transient';
}

/** One Stripe read, bounded by the request options and a local hard limit; never throws. */
async function stripeRead<T>(call: () => Promise<T>): Promise<StripeRead<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hardLimit = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), BOOST_RECEIPT_HARD_LIMIT_MS);
    });
    const value = await Promise.race([call(), hardLimit]);
    if (value === 'timeout') return { ok: false, kind: 'transient', facts: { timeoutMs: BOOST_RECEIPT_HARD_LIMIT_MS } };
    return { ok: true, value: value as T };
  } catch (error) {
    return { ok: false, kind: classifyStripeFailure(error), facts: stripeFactsOf(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function zeroCounts(): BoostReconcileCounts {
  return Object.fromEntries(BOOST_RECONCILE_COUNT_KEYS.map((key) => [key, 0])) as BoostReconcileCounts;
}

/** The status a transition leaves the row in, for the C-2 re-read (null: any paid-family). */
function statusAfter(target: BusinessOsBoostTransitionTarget): BusinessOsBoostPurchaseStatus | null {
  return target === 'dispute_won' ? null : (target as BusinessOsBoostPurchaseStatus);
}

function disputeIntentOf(dispute: StripeDispute): string | null {
  const intent = dispute.payment_intent;
  if (intent == null) return null;
  return typeof intent === 'string' ? intent : intent.id;
}

export function createBoostReconcilePass(deps: BoostReconcileDeps): ReconcilePass {
  return {
    name: 'boost',
    run: (context) => runBoostReconcile(deps, context),
  };
}

export async function runBoostReconcile(deps: BoostReconcileDeps, context: ReconcilePassContext): Promise<BoostReconcileCounts> {
  const { log } = context;
  const counts = zeroCounts();
  const nowMs = context.now.getTime();
  const timeLeft = () => context.deadlineAt - deps.clock();

  const livemode = deps.keyLivemode();
  if (livemode === null) {
    counts.stripeUnavailable = 1;
    log.error({ alert: true, trigger: context.trigger }, 'bos_boost_reconcile_unavailable: the Stripe key mode cannot be told');
    return counts;
  }

  let client: BoostReconcileStripePort | null = null;
  function stripe(): BoostReconcileStripePort {
    if (client) return client;
    client = deps.stripe();
    if (!client) throw new StopPass('no_stripe_client');
    return client;
  }

  // ── Shared outcome helpers (the account is the row's, always) ──────────────

  async function audit(row: BusinessOsBoostPurchase, action: string, details: Record<string, unknown>): Promise<void> {
    await deps.audit(
      { action, entityType: ENTITY_TYPE, entityId: row.id, userId: row.accountId, resourceName: row.packageId, details },
      log
    );
  }

  /**
   * A person must look (SA CR-1: one record per problem, not one per night).
   *
   *   - `auto` (the default): a STUCK row (`pending` / `awaiting_payment`) is
   *     flagged once with `transition('flagged_mismatch', reason)`, which 2b
   *     allows from both. That writes the one owner-visible `BOS_BOOST_FLAGGED`,
   *     takes the row out of the stuck set (no nightly Stripe re-read) and lists
   *     it for slice 6. Any other row cannot be flagged: it is alerted on every
   *     run, but audited only the FIRST time (`findingRecorded`: an existing
   *     `BOS_BOOST_FLAGGED` with this reason on this purchase).
   *   - `once`: never flag (e.g. the SQL itself failed deterministically), audit once.
   *   - `recorded`: the SQL already flagged or moved the row, so the finding
   *     cannot repeat: alert and audit.
   */
  async function finding(
    row: BusinessOsBoostPurchase,
    reason: string,
    extra: Record<string, unknown> = {},
    mode: 'auto' | 'once' | 'recorded' = 'auto'
  ): Promise<void> {
    counts.flagged += 1;
    const details = { reason, row_status: row.status, source: 'reconcile', livemode: row.livemode, ...extra };

    if (mode === 'auto' && STUCK.has(row.status)) {
      const flagged = await deps.purchases.transition({ purchaseId: row.id, toStatus: 'flagged_mismatch', flagReason: reason.slice(0, 64) });
      const status = flagged.data?.status ?? null;
      if (!flagged.error && status === 'transitioned') {
        log.error({ alert: true, purchaseId: row.id, rowStatus: row.status, reason, flagApplied: true, ...extra }, 'bos_boost_reconcile_finding');
        await audit(row, AUDIT_EVENTS.BOS_BOOST_FLAGGED, { ...details, flag_applied: true });
        return;
      }
      if (!flagged.error && status === 'already') {
        // Another run flagged it a moment ago and wrote the record.
        log.info({ purchaseId: row.id, reason }, 'bos_boost_reconcile_raced');
        return;
      }
      // The row moved, or the flag could not be written: fall through to "audit once".
      log.warn({ purchaseId: row.id, reason, status, errorName: flagged.error?.name ?? null }, 'bos_boost_reconcile_flag_not_applied');
    }

    if (mode === 'recorded') {
      log.error({ alert: true, purchaseId: row.id, rowStatus: row.status, reason, ...extra }, 'bos_boost_reconcile_finding');
      await audit(row, AUDIT_EVENTS.BOS_BOOST_FLAGGED, details);
      return;
    }

    // A row that stays as it is: alert every run, audit only the first time.
    const seen = row.accountId === null ? null : await deps.findingRecorded({ accountId: row.accountId, purchaseId: row.id, reason });
    log.error({ alert: true, purchaseId: row.id, rowStatus: row.status, reason, repeat: seen === true, ...extra }, 'bos_boost_reconcile_finding');
    if (seen === false) await audit(row, AUDIT_EVENTS.BOS_BOOST_FLAGGED, details);
    else if (seen === null) log.warn({ purchaseId: row.id, reason }, 'bos_boost_reconcile_finding_audit_skipped: the earlier record could not be checked');
  }

  /** 4a C-1: deterministic → a finding; transient → deferred to the next run (XX000 also alerted). */
  async function repositoryFailure(row: BusinessOsBoostPurchase, error: Error, step: string): Promise<void> {
    const facts = { purchaseId: row.id, step, sqlstate: (error as { sqlstate?: unknown }).sqlstate ?? null, errorName: error.name };
    if (isDeterministicRepositoryError(error)) {
      // Never flag after a failed SQL call: the next call could fail the same way.
      await finding(row, 'deterministic_failure', { step }, 'once');
      return;
    }
    counts.deferred += 1;
    if (isAnomalousRepositoryError(error)) log.error({ ...facts, alert: true }, 'bos_boost_reconcile_internal_error: deferred to the next run');
    else log.warn(facts, 'bos_boost_reconcile_transient_failure: deferred to the next run');
  }

  async function stripeFailure(row: BusinessOsBoostPurchase, failure: { kind: StripeFailureKind; facts: Record<string, unknown> }, step: string): Promise<void> {
    if (failure.kind === 'key') throw new StopPass('stripe_key_refused');
    if (failure.kind === 'transient') {
      counts.deferred += 1;
      log.warn({ purchaseId: row.id, step, stripe: failure.facts }, 'bos_boost_reconcile_stripe_unavailable: deferred to the next run');
      return;
    }
    await finding(row, failure.kind === 'missing' ? `reconcile_${step}_missing` : `reconcile_${step}_refused`, { stripe_code: failure.facts.code ?? null });
  }

  /**
   * C-2. The effect answered as if the row had moved: read it again. If the
   * re-read row satisfies `settled`, a webhook got there first (raced, info).
   * Otherwise it is a finding.
   */
  async function raceOrFinding(
    row: BusinessOsBoostPurchase,
    reason: string,
    settled: (current: BusinessOsBoostPurchase) => boolean,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const again = await deps.purchases.reread(row.id);
    if (again.error) return repositoryFailure(row, again.error, 'reread');
    const current = again.data;
    if (current === null || settled(current)) {
      counts.raced += 1;
      log.info({ purchaseId: row.id, readStatus: row.status, nowStatus: current?.status ?? null, reason }, 'bos_boost_reconcile_raced');
      return;
    }
    await finding(current, reason, extra);
  }

  // ── Moves on a stuck row: expire or fail ───────────────────────────────────

  async function moveStuck(row: BusinessOsBoostPurchase, target: 'expired' | 'failed', paymentIntentId: string | null, note: string): Promise<void> {
    const result = await deps.purchases.transition({ purchaseId: row.id, toStatus: target, paymentIntentId });
    if (result.error || !result.data) return repositoryFailure(row, result.error ?? new Error('transition returned nothing'), `transition:${target}`);
    const { status, fromStatus } = result.data;
    switch (status) {
      case 'transitioned':
        counts[target] += 1;
        if (note === 'no_session') log.warn({ purchaseId: row.id, fromStatus }, 'bos_boost_reconcile_no_session_expired');
        else log.info({ purchaseId: row.id, target, fromStatus, note }, 'bos_boost_reconcile_moved');
        if (target === 'failed') await audit(row, AUDIT_EVENTS.BOS_BOOST_PAYMENT_FAILED, { package_id: row.packageId, livemode: row.livemode, source: 'reconcile' });
        return;
      case 'already':
      case 'not_found':
        counts.raced += 1;
        log.info({ purchaseId: row.id, target, status }, 'bos_boost_reconcile_raced');
        return;
      case 'not_allowed':
        // Moved out of pending / awaiting since the batch read → a webhook won the race.
        return raceOrFinding(row, `transition_not_allowed:${target}`, (current) => !STUCK.has(current.status), { from_status: fromStatus });
      case 'mismatch':
        // 2b flagged it (payment_intent_reused): the function wrote the flag.
        return finding(row, 'payment_intent_reused', {}, 'recorded');
      default:
        return finding(row, 'reconcile_unexpected', { target, status });
    }
  }

  // ── Reversals on a credited row (N-2, C-8, C-9; the 4b.1 rules) ────────────

  /** One 2b transition for a refund or dispute fact; returns the function's answer (null on a failure). */
  async function applyReversal(
    row: BusinessOsBoostPurchase,
    input: BusinessOsBoostTransitionInput,
    kind: 'refund' | 'dispute'
  ): Promise<BusinessOsBoostTransitionStatus | null> {
    const result = await deps.purchases.transition(input);
    if (result.error || !result.data) {
      await repositoryFailure(row, result.error ?? new Error('transition returned nothing'), `transition:${input.toStatus}`);
      return null;
    }
    const { status, fromStatus } = result.data;
    const target = input.toStatus;
    switch (status) {
      case 'transitioned':
      case 'recorded':
        counts.reversalsApplied += 1;
        if (target === 'dispute_won' || target === 'dispute_lost') counts.disputesConcluded += 1;
        // FR-35: the admin-visible flag on every recorded reversal, as the webhook raises it.
        log.error({ alert: true, purchaseId: row.id, toStatus: target, fromStatus, status, source: 'reconcile' }, 'bos_boost_payment_reversed');
        await audit(row, AUDIT_EVENTS.BOS_BOOST_PAYMENT_REVERSED, {
          kind,
          phase: 'reconcile',
          to_status: target,
          from_status: fromStatus,
          amount_refunded_minor: kind === 'refund' ? (input.amountRefundedMinor ?? null) : null,
          livemode: row.livemode,
        });
        return status;
      case 'already':
      case 'stale':
      case 'not_found':
        log.info({ purchaseId: row.id, toStatus: target, status }, 'bos_boost_reconcile_reversal_already_recorded');
        return status;
      case 'not_allowed': {
        const expected = statusAfter(target);
        await raceOrFinding(
          row,
          `transition_not_allowed:${target}`,
          (current) => (expected === null ? DISPUTE_CONCLUDED_BACK_TO.has(current.status) && current.stripeDisputeId === input.disputeId : current.status === expected),
          { from_status: fromStatus }
        );
        return status;
      }
      default:
        await finding(row, 'reversal_unexpected', { target, status });
        return status;
    }
  }

  /** A dispute Stripe reports, applied to the row as the 4b.1 webhook would (C-8, C-9). */
  async function applyDispute(row: BusinessOsBoostPurchase, dispute: StripeDispute): Promise<void> {
    if (!sameCurrency(dispute.currency, row.currency)) return finding(row, 'currency_mismatch', { phase: 'dispute' });
    const intent = disputeIntentOf(dispute);
    if (intent === null || intent !== row.stripePaymentIntentId) return finding(row, 'reconcile_dispute_mismatch');
    const paymentIntentId = intent;

    const conclusion: BusinessOsBoostTransitionTarget | 'open' | null =
      // SA CR-2: `warning_closed` (an inquiry that closed without a chargeback, no funds taken) concludes as won.
      dispute.status === 'won' || dispute.status === 'warning_closed'
        ? 'dispute_won'
        : dispute.status === 'lost'
          ? 'dispute_lost'
          : DISPUTE_OPEN.has(dispute.status)
            ? 'open'
            : null;

    if (row.stripeDisputeId === dispute.id) {
      if (row.status !== 'disputed') {
        // Already concluded (QA4b-M1): a won dispute left it paid-family with this id.
        log.info({ purchaseId: row.id, rowStatus: row.status }, 'bos_boost_reconcile_dispute_already_concluded');
        return;
      }
      if (conclusion === 'open') {
        counts.disputesStillOpen += 1;
        log.info({ purchaseId: row.id, disputeStatus: dispute.status }, 'bos_boost_reconcile_dispute_open');
        return;
      }
      // Any other status (e.g. a new one Stripe adds) is not ours to guess.
      if (conclusion === null) return finding(row, 'reconcile_dispute_status', { dispute_status: dispute.status });
      await applyReversal(row, { purchaseId: row.id, toStatus: conclusion, paymentIntentId, disputeId: dispute.id }, 'dispute');
      return;
    }

    if (row.stripeDisputeId !== null) return finding(row, 'reconcile_second_dispute');

    // Never recorded (N-2: it came before crediting): open it as `created` would, then conclude.
    const opened = await applyReversal(row, { purchaseId: row.id, toStatus: 'disputed', paymentIntentId, disputeId: dispute.id }, 'dispute');
    // Concluded only from a row that now IS disputed with this id; a `recorded`
    // answer (a flagged row keeps its status) is left to a person.
    if (opened !== 'transitioned') return;
    const nowDisputed: BusinessOsBoostPurchase = { ...row, status: 'disputed', stripeDisputeId: dispute.id };
    if (conclusion === 'dispute_won' || conclusion === 'dispute_lost') {
      await applyReversal(nowDisputed, { purchaseId: row.id, toStatus: conclusion, paymentIntentId, disputeId: dispute.id }, 'dispute');
    } else if (conclusion === 'open') {
      counts.disputesStillOpen += 1;
    } else {
      await finding(nowDisputed, 'reconcile_dispute_status', { dispute_status: dispute.status });
    }
  }

  /** After a credit (ours or a webhook's): the receipt from the charge in hand, then its refund and dispute state. */
  async function afterCredit(row: BusinessOsBoostPurchase, paymentIntentId: string, intent: StripeIntent | null): Promise<void> {
    const charge: StripeCharge | null = intent && intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    if (!charge) {
      // The receipt backfill covers the link; a reversal would reach the webhook.
      log.warn({ purchaseId: row.id }, 'bos_boost_reconcile_charge_unavailable: the payment has no readable charge');
      return;
    }

    const again = await deps.purchases.reread(row.id);
    if (again.error || !again.data) {
      // The credit is done; only the follow-up is skipped. Alerted so a person can check the charge.
      log.error({ alert: true, purchaseId: row.id }, 'bos_boost_reconcile_followup_skipped: the credited purchase could not be read again');
      return;
    }
    const current = again.data;

    if (!sameCurrency(charge.currency, current.currency)) return finding(current, 'currency_mismatch', { phase: 'charge' });

    const receiptUrl = charge.receipt_url;
    if (current.receiptUrl === null && typeof receiptUrl === 'string' && receiptUrl.startsWith('https://')) {
      const stored = await deps.purchases.recordReceipt({ purchaseId: current.id, chargeId: charge.id, receiptUrl });
      if (stored.data?.status === 'recorded') counts.receiptsFilled += 1;
      else if (stored.error || stored.data?.status !== 'already_recorded') log.warn({ purchaseId: current.id, status: stored.data?.status ?? null }, 'bos_boost_receipt_unavailable: the receipt was not stored');
    }

    if (charge.amount_refunded > current.amountRefundedMinor) {
      const move = plan(
        'charge.refunded',
        {
          kind: 'refund',
          chargeId: charge.id,
          paymentIntentId,
          amountRefundedMinor: charge.amount_refunded,
          currency: charge.currency,
          fullyRefunded: charge.refunded ?? null,
        },
        current
      );
      if (move.kind === 'transition') await applyReversal(current, move.input, 'refund');
    }

    if (charge.disputed === true) {
      // C-8: Charge carries no dispute id in this API version, so the dispute is
      // listed by the payment intent. No readable dispute is a finding, not a guess.
      const client = stripe();
      const read = await stripeRead(() => client.disputes.list({ payment_intent: paymentIntentId, limit: 10 }, { ...BOOST_RECEIPT_REQUEST_OPTIONS }));
      if (!read.ok) return stripeFailure(current, read, 'dispute');
      const parsed = disputeListSchema.safeParse(read.value);
      const newest = parsed.success ? parsed.data.data[0] : undefined;
      if (!newest) return finding(current, 'dispute_id_unreadable');
      await applyDispute(current, newest);
    }
  }

  // ── 1. A stuck purchase ────────────────────────────────────────────────────

  async function creditStuck(row: BusinessOsBoostPurchase, session: BoostSession, intent: StripeIntent | null): Promise<void> {
    const { paymentIntentId, amountSubtotalMinor, amountTotalMinor, currency } = session;
    if (!paymentIntentId) return finding(row, 'no_payment_intent');
    if (amountSubtotalMinor === null || amountTotalMinor === null || currency === null) return finding(row, 'session_amounts_missing');

    const result = await deps.purchases.credit({
      purchaseId: row.id,
      sessionId: session.id,
      paymentIntentId,
      amountSubtotalMinor,
      amountTaxMinor: session.amountTaxMinor,
      amountTotalMinor,
      currency,
      livemode: row.livemode,
    });
    if (result.error || !result.data) return repositoryFailure(row, result.error ?? new Error('credit returned nothing'), 'credit');

    const outcome = result.data;
    switch (outcome.outcome) {
      case 'credited':
        counts.credited += 1;
        log.info({ purchaseId: row.id, lotId: outcome.lotId, creditsTotal: row.creditsTotal }, 'bos_boost_reconcile_credited');
        await audit(row, AUDIT_EVENTS.BOS_BOOST_CREDITED, {
          package_id: row.packageId,
          package_version: row.packageVersion,
          credits_total: row.creditsTotal,
          price_minor: row.priceMinor,
          currency: row.currency,
          lot_id: outcome.lotId,
          stripe_payment_intent_id: paymentIntentId,
          livemode: row.livemode,
          source: 'reconcile',
        });
        return afterCredit(row, paymentIntentId, intent);
      case 'already_credited':
        // C-2: a webhook credited it between the batch read and this call.
        counts.raced += 1;
        log.info({ purchaseId: row.id }, 'bos_boost_reconcile_raced');
        return afterCredit(row, paymentIntentId, intent);
      case 'mismatch':
        // 2b flagged the row itself (e.g. no_session, amount_mismatch): it has left the stuck set.
        return finding(row, outcome.flagReason, {}, 'recorded');
      case 'not_creditable':
        return raceOrFinding(row, 'paid_not_creditable', (current) => PAID_FAMILY.has(current.status));
      case 'not_found':
        counts.raced += 1;
        log.info({ purchaseId: row.id }, 'bos_boost_reconcile_raced');
        return;
    }
  }

  async function reconcileStuck(row: BusinessOsBoostPurchase): Promise<void> {
    counts.examined += 1;
    const sessionId = row.stripeCheckoutSessionId;

    if (sessionId === null) {
      // C-3: never credited. Expiring only frees the cap; a late payment still
      // reaches the row through 4a's reference fallback and is flagged `no_session`.
      if (nowMs - Date.parse(row.checkoutExpiresAt) >= BOOST_RECONCILE_LIMITS.NO_SESSION_EXPIRE_MS) {
        return moveStuck(row, 'expired', null, 'no_session');
      }
      counts.stillOpen += 1;
      return;
    }

    // Outside the bounded read: a missing client stops the pass, it is not a transient row failure.
    const client = stripe();
    const read = await stripeRead(() =>
      client.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] }, { ...BOOST_RECEIPT_REQUEST_OPTIONS })
    );
    if (!read.ok) return stripeFailure(row, read, 'session');

    const parsed = parseBoostSession(read.value);
    const state = sessionStateSchema.safeParse(read.value);
    if (!parsed.ok || !state.success) {
      return finding(row, 'reconcile_session_unreadable', { issues: parsed.ok ? [] : parsed.issues.slice(0, 10) });
    }
    const session = parsed.session;
    if (session.id !== sessionId) return finding(row, 'session_mismatch');
    if (state.data.livemode !== row.livemode) return finding(row, 'livemode_mismatch');
    if (boostMetadataDisagrees(session.metadata)) return finding(row, 'metadata_mismatch');
    const rawIntent = state.data.payment_intent;
    const intent: StripeIntent | null = rawIntent && typeof rawIntent === 'object' ? rawIntent : null;

    if (session.paymentStatus === 'paid') return creditStuck(row, session, intent);
    // Promotion codes are off (slice 3), so a free session is never expected (T-7).
    if (session.paymentStatus === 'no_payment_required') return finding(row, 'no_payment_required');

    const status = state.data.status;
    if (status === 'expired' || (status === 'open' && state.data.expires_at * 1000 <= nowMs)) {
      return moveStuck(row, 'expired', null, 'session_expired');
    }
    if (status === 'open') {
      counts.stillOpen += 1;
      return;
    }
    // Complete but unpaid: a delayed payment method (e.g. a bank debit).
    if (intent && (intent.status === 'requires_payment_method' || intent.status === 'canceled')) {
      return moveStuck(row, 'failed', intent.id, 'payment_failed');
    }
    counts.stillProcessing += 1;
    log.info({ purchaseId: row.id, intentStatus: intent?.status ?? null }, 'bos_boost_reconcile_still_processing');
  }

  // ── 2. A purchase still disputed (C-9) ─────────────────────────────────────

  async function reconcileDisputed(row: BusinessOsBoostPurchase): Promise<void> {
    counts.disputesExamined += 1;
    const disputeId = row.stripeDisputeId;
    if (disputeId === null) return finding(row, 'reconcile_dispute_id_missing');
    const client = stripe();
    const read = await stripeRead(() => client.disputes.retrieve(disputeId, {}, { ...BOOST_RECEIPT_REQUEST_OPTIONS }));
    if (!read.ok) return stripeFailure(row, read, 'dispute');
    const parsed = disputeSchema.safeParse(read.value);
    if (!parsed.success || parsed.data.id !== disputeId) return finding(row, 'dispute_unreadable');
    await applyDispute(row, parsed.data);
  }

  // ── 3. A paid purchase with no receipt link ────────────────────────────────

  async function backfillReceipt(row: BusinessOsBoostPurchase): Promise<void> {
    counts.receiptsExamined += 1;
    if (row.stripePaymentIntentId === null) return finding(row, 'reconcile_receipt_no_payment_intent');
    const outcome = await deps.receipt({ purchaseId: row.id, paymentIntentId: row.stripePaymentIntentId, eventLivemode: row.livemode }, log);
    if (outcome === 'recorded') counts.receiptsFilled += 1;
    else if (outcome === 'already_recorded') counts.raced += 1;
    else counts.receiptsNotFilled += 1;
  }

  // ── The run ────────────────────────────────────────────────────────────────

  const phases: Array<{ kind: BoostReconcileListKind; graceMs: number; handle: (row: BusinessOsBoostPurchase) => Promise<void> }> = [
    { kind: 'stuck', graceMs: BOOST_RECONCILE_LIMITS.STUCK_GRACE_MS, handle: reconcileStuck },
    { kind: 'disputed', graceMs: BOOST_RECONCILE_LIMITS.DISPUTE_GRACE_MS, handle: reconcileDisputed },
    { kind: 'receipt_missing', graceMs: BOOST_RECONCILE_LIMITS.RECEIPT_GRACE_MS, handle: backfillReceipt },
  ];

  let stopped = false;
  for (const phase of phases) {
    if (stopped) break;
    if (timeLeft() < BOOST_RECONCILE_LIMITS.ROW_MARGIN_MS) {
      counts.deadlineHit = 1;
      break;
    }
    const listed = await deps.purchases.listForReconcile({
      kind: phase.kind,
      livemode,
      before: new Date(nowMs - phase.graceMs).toISOString(),
      limit: BOOST_RECONCILE_LIMITS.BATCH,
    });
    if (listed.error || !listed.data) {
      counts.listFailed += 1;
      log.error({ alert: true, kind: phase.kind, errorName: listed.error?.name ?? null }, 'bos_boost_reconcile_list_failed');
      continue;
    }
    const rows = listed.data;
    if (rows.length >= BOOST_RECONCILE_LIMITS.BATCH) counts.batchFull = 1;

    for (let index = 0; index < rows.length; index += 1) {
      if (timeLeft() < BOOST_RECONCILE_LIMITS.ROW_MARGIN_MS) {
        counts.deadlineHit = 1;
        counts.rowsLeft += rows.length - index;
        stopped = true;
        break;
      }
      const row = rows[index];
      // Defensive: the read is by mode; a row of the other mode is never touched.
      if (row.livemode !== livemode) continue;
      try {
        await phase.handle(row);
      } catch (error) {
        if (error instanceof StopPass) {
          counts.stripeUnavailable = 1;
          counts.rowsLeft += rows.length - index;
          stopped = true;
          log.error({ alert: true, reason: error.reason, trigger: context.trigger }, 'bos_boost_reconcile_unavailable: Stripe cannot be read');
          break;
        }
        // A defect in this row's handling: count it, alert, and carry on with the next row.
        counts.deferred += 1;
        log.error(
          { alert: true, purchaseId: row.id, kind: phase.kind, errorName: error instanceof Error ? error.name : typeof error },
          'bos_boost_reconcile_row_failed'
        );
      }
    }
  }

  log.info({ trigger: context.trigger, ...counts }, 'bos_boost_reconcile_done');
  return counts;
}
