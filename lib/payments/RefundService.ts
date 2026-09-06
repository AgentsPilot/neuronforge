/**
 * The one place a refund happens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There were two refund implementations before this, and they had drifted on
 * every invariant that matters: one accumulated the refunded total and the other
 * overwrote it; one checked for over-refund and the other did not; one wrote a
 * transaction status the schema did not declare. Neither passed a Stripe
 * idempotency key, neither recorded which account the charge lived on, and
 * neither actually reached Stripe — the UI path threw on a processor registry
 * that is never populated, and the other used a platform client that cannot see
 * a connected account's payment intent.
 *
 * The invariants that make a refund safe are all-or-nothing, so they live
 * together here:
 *
 *   · the account is READ, never guessed — an unresolved row is refused
 *   · the ledger row is written BEFORE Stripe is called, so a crash mid-flight
 *     leaves evidence rather than a silent loss
 *   · a repeated request returns the original refund instead of making a second
 *   · over-refund is rejected by a row lock in the database, not by a check here
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not compute `refunded_amount`, or set the transaction's status, or
 * touch the invoice. Those are derived by triggers from the ledger. Writing them
 * here would recreate exactly the drift this replaces.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

import Stripe from 'stripe';
import { createHash, randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabaseServer';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence } from '@/lib/business-os/activityText';
import { createLogger } from '@/lib/logger';
import { resolveRefundAccount, stripeRequestOptions } from './stripeAccountContext';
import { fromMinorUnits, resolveRefundAmount } from './refundMath';

const logger = createLogger({ module: 'RefundService' });

export type RefundErrorCode =
  /** No transaction, or not this user's. */
  | 'NOT_FOUND'
  /** The payment never settled, so there is nothing to return. */
  | 'NOT_REFUNDABLE'
  /** Which Stripe account holds this charge is not known well enough to be safe. */
  | 'ACCOUNT_UNRESOLVED'
  /** Asked for more than is left, or for nothing at all. */
  | 'EXCEEDS_REMAINING'
  | 'NOT_POSITIVE'
  | 'NOTHING_REMAINING'
  /** The connected account has already been paid out and cannot fund this. */
  | 'BALANCE_INSUFFICIENT'
  /**
   * There is no Stripe payment intent or charge to refund against.
   *
   * Money this platform did not take through Stripe — a payment recorded by
   * hand, or one whose reference was never written — cannot be returned through
   * Stripe. Reported so the UI can withhold the button rather than offer a
   * refund that fails at the last step.
   */
  | 'MISSING_REFERENCE'
  /**
   * More than one payment answers to what the caller named.
   *
   * A booking with a deposit and a balance, or a payment plan with twelve
   * periods. Reported rather than resolved: picking one silently is exactly how
   * "refund this booking" came to return a twelfth of the money.
   */
  | 'AMBIGUOUS_TARGET'
  /**
   * An earlier attempt with this same request id is still pending.
   *
   * Distinct from a failure: the money may yet move. Callers must not record a
   * refund, update a booking, or email the client on this — which is precisely
   * what they did while the replay branch reported every prior attempt as a
   * success.
   */
  | 'IN_FLIGHT'
  /** Stripe refused for some other reason. */
  | 'PROCESSOR_ERROR';

/**
 * Stripe's own refund reasons.
 *
 * Not the same thing as the free-text note the owner writes: this is the
 * classification Stripe records against the charge, and it is consequential —
 * `fraudulent` feeds Stripe's risk signals and its dispute handling, and a
 * business that refunds fraud as `requested_by_customer` is withholding
 * information from the system meant to protect it.
 */
export type StripeRefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer';

export interface RefundRequest {
  userId: string;
  transactionId: string;
  /**
   * The Stripe classification. Defaults to `requested_by_customer`, which was
   * previously hardcoded — so a duplicate charge and a fraudulent one were both
   * reported to Stripe as the customer changing their mind.
   */
  stripeReason?: StripeRefundReason;
  /** Major units. Omitted means everything still remaining. */
  amount?: number | null;
  reason?: string;
  source: 'app' | 'webhook' | 'reconciler' | 'manual';
  initiatedBy?: string | null;
  /**
   * Stable for one user intent. A resubmitted form, a double click and a retry
   * after a timeout all carry the same value and produce ONE refund.
   */
  clientRequestId?: string;
  /**
   * The business is RECORDING a refund it made itself, outside any processor.
   *
   * A bank transfer sent back, cash handed over. There is nothing to call, so
   * this writes the ledger row and stops — the triggers derive the transaction,
   * invoice and booking state from it exactly as they do for a Stripe refund.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * TWO CONDITIONS, AND BOTH ARE REQUIRED.
   *
   * This flag alone is not enough. It says the business asserts it returned the
   * money; the transaction's `processor_type` says whether the money could have
   * moved without us. Trusting the flag by itself would let a Stripe payment be
   * marked refunded while the client's card was never credited — the invoice
   * would close, the booking would free, revenue would drop, and the client
   * would still be out of pocket with a document saying otherwise.
   *
   * The reverse is equally deliberate: a payment whose `processor_type` is
   * 'stripe' but whose charge reference was never recorded must NOT fall
   * through to here. That money did go through Stripe and has to come back the
   * same way; recording it by hand would leave a real charge un-refunded and a
   * ledger claiming it was returned.
   * ─────────────────────────────────────────────────────────────────────────
   */
  manual?: boolean;
}

export interface RefundSuccess {
  ok: true;
  refundId: string;
  processorRefundId: string | null;
  amount: number;
  currency: string;
  /** True when this request matched an earlier one and nothing new happened. */
  replayed: boolean;
}

export interface RefundFailure {
  ok: false;
  code: RefundErrorCode;
  message: string;
  /** Major units still refundable, where that is known. */
  remaining?: number;
}

export type RefundResult = RefundSuccess | RefundFailure;

interface TransactionRow {
  id: string;
  user_id: string;
  invoice_id: string | null;
  amount: number;
  currency: string;
  status: string;
  refunded_amount: number | null;
  /** 'stripe' | 'manual' | … — who took the money, if anyone. */
  processor_type: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_connect_account_id: string | null;
  account_resolution: string | null;
}

const TRANSACTION_COLUMNS =
  'id, user_id, invoice_id, amount, currency, status, refunded_amount, processor_type, stripe_payment_intent_id, stripe_charge_id, stripe_connect_account_id, account_resolution';

/**
 * What to tell Stripe to refund: the payment intent, or failing that the charge.
 *
 * ONE resolver, because the answer has to be the same in three places that used
 * to decide separately — the refundability check the UI reads, the guard before
 * the ledger is written, and the Stripe call itself. When only the last of them
 * knew, a payment with no reference was offered a refund button, accepted, given
 * a ledger row, and then failed at Stripe with a 502 whose real reason
 * production hides. Every payment plan installment was in exactly that state.
 */
export function resolveStripeRefundTarget(
  tx: Pick<TransactionRow, 'stripe_payment_intent_id' | 'stripe_charge_id'>
): { payment_intent: string } | { charge: string } | null {
  if (tx.stripe_payment_intent_id) return { payment_intent: tx.stripe_payment_intent_id };
  if (tx.stripe_charge_id) return { charge: tx.stripe_charge_id };
  return null;
}

/** Alias, so the target can be consulted before the account without confusion. */
const stripeTargetFor = resolveStripeRefundTarget;

const NO_REFERENCE_MESSAGE =
  'This payment has no Stripe reference, so it cannot be refunded through Stripe. Return it to the client directly and record it against the booking.';

/**
 * How much of a transaction can still be returned, and why not if it cannot.
 *
 * Exposed so the UI can show a real maximum and a real reason rather than
 * guessing client-side — which is what the current modal does, and why a direct
 * POST bypasses its only guard.
 */
export async function getRefundability(userId: string, transactionId: string) {
  const { data } = await supabaseServer
    .from('payment_transactions')
    .select(TRANSACTION_COLUMNS)
    .eq('id', transactionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { refundable: false, reason: 'NOT_FOUND' as const, remaining: 0 };

  const tx = data as TransactionRow;

  if (!['succeeded', 'refunded'].includes(tx.status)) {
    return { refundable: false, reason: 'NOT_REFUNDABLE' as const, remaining: 0 };
  }

  const account = resolveRefundAccount(tx);
  const amount = resolveRefundAmount(tx.amount, tx.refunded_amount ?? 0, tx.currency);
  const remaining = amount.ok ? amount.amountMajor : 0;

  /*
   * Money that never went through a processor has no processor account, so the
   * account check would answer first and answer wrongly.
   *
   * It reported ACCOUNT_UNRESOLVED — "we cannot tell which Stripe account this
   * belongs to" — for a bank transfer that belongs to no Stripe account at all.
   * The owner got a message about a system they do not use, and the manual
   * branch below, which is the one that applies, was never reached.
   */
  const isManualMoney = tx.processor_type === 'manual' && !resolveStripeRefundTarget(tx);

  if (!isManualMoney && !account.ok) {
    return { refundable: false, reason: account.reason, detail: account.detail, remaining };
  }

  if (!amount.ok) return { refundable: false, reason: amount.error, remaining: 0 };

  // Nothing to refund against. Checked here so the button is never offered:
  // the alternative is the owner clicking it and getting a generic failure.
  if (!resolveStripeRefundTarget(tx)) {
    /*
     * TWO DIFFERENT SITUATIONS wear this one code, and telling a business owner
     * the wrong one is worse than saying nothing.
     *
     *   processor_type 'manual' — the money never went through Stripe. Cash, a
     *     bank transfer, an invoice marked paid by hand. It has to be returned
     *     the same way it arrived.
     *
     *   processor_type 'stripe' — the money DID go through Stripe; this
     *     platform simply never recorded which charge it was. Every payment
     *     plan period collected before the reference was written is in this
     *     state. Telling that owner "this payment did not go through Stripe" is
     *     flatly untrue, and it sends them looking for a cash payment that does
     *     not exist.
     *
     * The caller gets the processor type so it can say the right one.
     */
    const processorType =
      (tx as TransactionRow & { processor_type?: string }).processor_type ?? null;

    return {
      refundable: false,
      reason: 'MISSING_REFERENCE' as const,
      detail: NO_REFERENCE_MESSAGE,
      processorType,
      /*
       * Not refundable BY US, but the business can record one it made itself.
       *
       * Only for money that never went through a processor. The other case
       * wearing this code — a Stripe payment whose charge reference was never
       * written — must stay blocked: that money has to come back through
       * Stripe, and offering to record it by hand would leave a real charge
       * standing against a ledger claiming it was returned.
       */
      recordable: processorType === 'manual',
      remaining,
    };
  }

  return { refundable: true, recordable: false, remaining, currency: tx.currency };
}

/**
 * Every settled payment behind whatever the caller is looking at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This returned ONE transaction — `.order('created_at' desc).limit(1)` — and a
 * twelve-period payment plan puts twelve transactions on one booking. So
 * "refund this booking" returned one twelfth of the money and reported success,
 * and the caller then marked the whole booking refunded.
 *
 * Returning the full set makes the ambiguity visible instead of resolving it
 * silently. What to do about it is the CALLER's decision, expressed as a scope:
 * one payment, or everything collected against the thing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function resolveRefundTargets(params: {
  userId: string;
  transactionId?: string;
  invoiceId?: string;
  bookingId?: string;
}): Promise<{ transactionIds: string[] } | { error: RefundErrorCode; message: string }> {
  const { userId, transactionId, invoiceId, bookingId } = params;

  if (transactionId) return { transactionIds: [transactionId] };

  if (!invoiceId && !bookingId) {
    return { error: 'NOT_FOUND', message: 'No invoice, booking or payment was given.' };
  }

  /*
   * A booking's payments hang off it two different ways.
   *
   * A website or landing-page sale writes `booking_id` on the transaction. An
   * INVOICE raised for a booking does not: the transaction carries `invoice_id`
   * and the booking is on the invoice. Matching only `booking_id` therefore
   * found nothing for every invoice-paid booking — so refunding one from the
   * CRM booking tab reported "no settled payment", showed 0.00, and offered a
   * refund of nothing.
   *
   * Verified on live data: invoice INV-00001 settles booking
   * `18df4a3f-…` through transaction `a876d569-…`, which has `booking_id: null`.
   */
  const invoiceIds: string[] = invoiceId ? [invoiceId] : [];

  if (bookingId && !invoiceId) {
    const { data: invoices } = await supabaseServer
      .from('payment_invoices')
      .select('id')
      .eq('user_id', userId)
      .eq('booking_id', bookingId);

    invoiceIds.push(...(invoices ?? []).map(row => row.id as string));
  }

  /*
   * Newest first, and newest is not arbitrary: refunding a plan from the last
   * period backwards means a run that stops halfway has returned the money the
   * client has least benefit from, and leaves the earliest periods — the ones
   * covering work already done — intact.
   *
   * PostgREST cannot express "booking_id = X OR invoice_id IN (…)" cleanly, so
   * each link is asked for separately and the results merged — the same shape
   * `findSettledForBooking` uses for the same reason.
   */
  const queries: PromiseLike<{ data: { id: string; created_at: string }[] | null }>[] = [];

  if (bookingId && !invoiceId) {
    queries.push(
      supabaseServer
        .from('payment_transactions')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('booking_id', bookingId)
        .in('status', ['succeeded', 'refunded'])
    );
  }

  if (invoiceIds.length > 0) {
    queries.push(
      supabaseServer
        .from('payment_transactions')
        .select('id, created_at')
        .eq('user_id', userId)
        .in('invoice_id', invoiceIds)
        .in('status', ['succeeded', 'refunded'])
    );
  }

  const results = await Promise.all(queries);

  // Deduped: a transaction can carry BOTH links, and refunding it twice in one
  // group would be refused by the over-refund guard — after the first leg had
  // already returned the money.
  const seen = new Set<string>();
  const rows: { id: string; created_at: string }[] = [];

  for (const result of results) {
    for (const row of result.data ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }

  const found = rows
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map(row => row.id);

  if (found.length === 0) {
    return {
      error: 'NOT_FOUND',
      message: 'No settled payment is recorded against this, so there is nothing to refund.',
    };
  }

  return { transactionIds: found };
}

/**
 * The single-payment resolver, kept for callers that genuinely want one.
 *
 * Refuses when there is more than one candidate rather than picking, so the
 * ambiguity reaches the caller — which is the whole difference from the version
 * that silently returned a twelfth of a plan.
 */
export async function resolveRefundTarget(params: {
  userId: string;
  transactionId?: string;
  invoiceId?: string;
  bookingId?: string;
}): Promise<{ transactionId: string } | { error: RefundErrorCode; message: string }> {
  const resolved = await resolveRefundTargets(params);
  if ('error' in resolved) return resolved;

  if (resolved.transactionIds.length > 1) {
    return {
      error: 'AMBIGUOUS_TARGET',
      message:
        'More than one payment was collected against this. Choose which payment to refund, or refund all of them.',
    };
  }

  return { transactionId: resolved.transactionIds[0] };
}

/** One leg of a group refund: what was asked of a transaction, and what happened. */
export interface GroupRefundLeg {
  transactionId: string;
  ok: boolean;
  amount: number;
  currency: string | null;
  code?: RefundErrorCode;
  message?: string;
}

export interface GroupRefundOutcome {
  legs: GroupRefundLeg[];
  /** What actually went back. */
  refundedTotal: number;
  /** How many legs were asked for, so a caller can say "7 of 12". */
  requested: number;
  succeeded: number;
  currency: string | null;
}

/**
 * Refund several payments as one intent — a whole booking, or a whole plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEQUENTIAL, deliberately. The over-refund guard is a `SELECT … FOR UPDATE` in
 * a trigger; firing these in parallel makes legitimate legs contend for row
 * locks and surface as spurious `EXCEEDS_REMAINING`. A refund is not a hot path
 * and correctness is worth the latency.
 *
 * NO PARTIAL AMOUNT. Group scope refunds everything remaining on each payment.
 * Splitting an arbitrary sum across twelve periods has no honest answer — and
 * whichever one it chose, the client's statement would not match the intent.
 * A specific amount is a single-payment refund, which the caller can still make.
 *
 * NOT ATOMIC, and it does not pretend to be. Stripe refunds are individually
 * final; there is no transaction to roll back across twelve of them. So a run
 * that succeeds seven times and then hits `balance_insufficient` reports exactly
 * that, and the caller shows it. Collapsing this into a single boolean is how
 * the one-twelfth bug stayed invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function refundGroup(request: {
  userId: string;
  transactionIds: string[];
  reason?: string;
  source: RefundRequest['source'];
  initiatedBy?: string;
  stripeReason?: StripeRefundReason;
  /** One id for the whole intent; each leg derives its own from it. */
  clientRequestId?: string;
  /**
   * Return at most this much across the whole group.
   *
   * Omitted, every payment is refunded in full — the ordinary meaning of
   * "refund the booking". With a cap, the amount is taken from the NEWEST
   * period backwards: those are the payments the client has had least benefit
   * from, and it is the one allocation that can be explained to them. Splitting
   * a sum evenly across twelve periods produces card-statement lines that match
   * nothing the owner asked for.
   */
  maxTotal?: number;
}): Promise<GroupRefundOutcome> {
  const groupId = request.clientRequestId ?? crypto.randomUUID();
  const legs: GroupRefundLeg[] = [];
  let refundedTotal = 0;
  let currency: string | null = null;
  let budget = request.maxTotal ?? Infinity;

  for (const transactionId of request.transactionIds) {
    // The cap is spent. Remaining periods are left untouched rather than
    // refunded for zero, which would write meaningless ledger rows.
    if (budget <= 0) break;

    /*
     * How much this payment can take out of the cap.
     *
     * Asked of the server rather than assumed: a period may already be partly
     * refunded, and requesting more than remains fails the whole leg on the
     * over-refund guard instead of taking what is there.
     */
    let legAmount: number | undefined;

    if (request.maxTotal !== undefined) {
      const { remaining } = await getRefundability(request.userId, transactionId);
      legAmount = Math.round(Math.min(budget, remaining) * 100) / 100;
      if (legAmount <= 0) continue;
    }

    const outcome = await refund({
      userId: request.userId,
      transactionId,
      amount: legAmount,
      reason: request.reason,
      source: request.source,
      initiatedBy: request.initiatedBy,
      stripeReason: request.stripeReason,
      /*
       * Derived from the group's id, not fresh per leg.
       *
       * A retry of the same group intent then replays every leg instead of
       * refunding each of them a second time — the property the whole
       * idempotency scheme exists for, which a `randomUUID()` per leg would
       * quietly discard.
       */
      clientRequestId: `${groupId}:${transactionId}`,
    });

    if (outcome.ok) {
      refundedTotal += outcome.amount;
      budget -= outcome.amount;
      currency ??= outcome.currency;
      legs.push({ transactionId, ok: true, amount: outcome.amount, currency: outcome.currency });
      continue;
    }

    /*
     * Already fully refunded is not a failure of THIS intent.
     *
     * Refunding a booking twice, or refunding one whose periods were partly
     * returned already, should end with everything refunded and no alarm — the
     * end state the caller asked for is the end state they get.
     */
    if (outcome.code === 'NOTHING_REMAINING') {
      legs.push({ transactionId, ok: true, amount: 0, currency: null });
      continue;
    }

    legs.push({
      transactionId,
      ok: false,
      amount: 0,
      currency: null,
      code: outcome.code,
      message: outcome.message,
    });
  }

  return {
    legs,
    refundedTotal: Math.round(refundedTotal * 100) / 100,
    requested: request.transactionIds.length,
    succeeded: legs.filter(leg => leg.ok).length,
    currency,
  };
}

/** Stable per (user, transaction, intent) so a replay cannot become a second refund. */
function idempotencyKeyFor(userId: string, transactionId: string, clientRequestId: string): string {
  return createHash('sha256').update(`${userId}:${transactionId}:${clientRequestId}`).digest('hex');
}

export async function refund(request: RefundRequest): Promise<RefundResult> {
  const { userId, transactionId, reason, source, initiatedBy } = request;
  const clientRequestId = request.clientRequestId || randomUUID();
  const log = logger.child({ userId, transactionId });

  const { data } = await supabaseServer
    .from('payment_transactions')
    .select(TRANSACTION_COLUMNS)
    .eq('id', transactionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) {
    return { ok: false, code: 'NOT_FOUND', message: 'That payment could not be found.' };
  }

  const tx = data as TransactionRow;

  if (!['succeeded', 'refunded'].includes(tx.status)) {
    return {
      ok: false,
      code: 'NOT_REFUNDABLE',
      message: 'This payment has not settled, so there is nothing to return.',
    };
  }

  /*
   * Is this money the platform can move, or money the business moved itself?
   *
   * Decided here, once, because everything below branches on it: a manual
   * refund needs no Stripe account, no charge reference and no API call — it
   * needs a ledger row saying the business returned the money.
   *
   * BOTH conditions. `manual` is the business asserting it; `processor_type`
   * is whether that assertion is even possible. See RefundRequest.manual.
   */
  const isManual = request.manual === true && tx.processor_type === 'manual';

  if (request.manual === true && !isManual) {
    // Asked to record a manual refund against processor money. Refusing is the
    // only safe answer: the client's card was never credited, and writing the
    // row would close the invoice on a refund that did not happen.
    log.warn(
      { transactionId: tx.id, processorType: tx.processor_type },
      'Refused: manual refund requested for a payment taken through a processor'
    );
    return {
      ok: false,
      code: 'NOT_REFUNDABLE',
      message: 'This payment was taken through a payment processor, so it has to be refunded through it.',
    };
  }

  /*
   * The account, before anything else. An unresolved charge must not reach
   * Stripe at all: the call would either error or refund from the wrong
   * balance, and the second is not recoverable.
   *
   * Resolved only when something will actually be called. A manual refund has
   * no account to get wrong, and demanding one would block exactly the
   * businesses this path exists for — the ones with no processor at all.
   */
  let stripeAccount: string | null = null;

  /*
   * Skipped for manual money whether or not `manual` was passed.
   *
   * With the flag it is irrelevant — nothing will be called. Without it, the
   * request still has to be refused, and resolving the account first refuses it
   * with the wrong reason: a bank transfer would come back as "Stripe account
   * unresolved" instead of "this payment did not go through a processor".
   */
  const isManualMoney = tx.processor_type === 'manual' && !stripeTargetFor(tx);

  if (!isManualMoney) {
    const account = resolveRefundAccount(tx);
    if (!account.ok) {
      log.warn({ resolution: tx.account_resolution }, 'Refused: Stripe account unresolved');
      return { ok: false, code: 'ACCOUNT_UNRESOLVED', message: account.detail };
    }
    stripeAccount = account.stripeAccount;
  }

  const amount = resolveRefundAmount(tx.amount, tx.refunded_amount ?? 0, tx.currency, request.amount);
  if (!amount.ok) {
    return {
      ok: false,
      code: amount.error,
      message:
        amount.error === 'NOTHING_REMAINING'
          ? 'This payment has already been fully refunded.'
          : 'That refund amount is not valid for this payment.',
      remaining: fromMinorUnits(amount.remainingMinor, tx.currency),
    };
  }

  /*
   * Before the ledger, not after.
   *
   * This check existed only inside the Stripe try-block, so a payment with no
   * reference got a `pending` ledger row that immediately had to be marked
   * failed — noise in an append-only ledger, and briefly a row holding refund
   * budget for money that was never going to move.
   */
  const stripeTarget = resolveStripeRefundTarget(tx);
  if (!isManual && !stripeTarget) {
    log.warn({ transactionId: tx.id }, 'Refused: no Stripe payment intent or charge on this payment');
    return { ok: false, code: 'MISSING_REFERENCE', message: NO_REFERENCE_MESSAGE };
  }

  const idempotencyKey = idempotencyKeyFor(userId, transactionId, clientRequestId);

  // The ledger row goes in FIRST, as `pending`.
  //
  // If the process dies between here and Stripe's answer, this row is the only
  // evidence the attempt happened — that gap is precisely where money is lost
  // invisibly today. The row also holds budget in the over-refund trigger, so a
  // second request arriving while this one is still in flight is not told the
  // funds are free.
  const { data: ledgerRow, error: ledgerError } = await supabaseServer
    .from('payment_refunds')
    .insert({
      user_id: userId,
      transaction_id: tx.id,
      invoice_id: tx.invoice_id,
      amount: amount.amountMajor,
      amount_minor: amount.amountMinor,
      currency: tx.currency,
      /*
       * A manual refund is `succeeded` on arrival.
       *
       * `pending` exists to cover the gap between asking a processor and
       * hearing back — there is no such gap here: the business is reporting
       * money it has already sent. Leaving it pending would hold refund budget
       * against a movement that is already complete, and nothing would ever
       * come along to close it.
       */
      status: isManual ? 'succeeded' : 'pending',
      succeeded_at: isManual ? new Date().toISOString() : null,
      reason: reason ?? null,
      processor_type: isManual ? 'manual' : 'stripe',
      stripe_connect_account_id: stripeAccount,
      idempotency_key: idempotencyKey,
      source,
      initiated_by: initiatedBy ?? null,
    })
    .select('id, processor_refund_id, status, amount')
    .single();

  if (ledgerError) {
    // 23505 on the idempotency key: this exact request has been made before.
    // Return what it produced rather than refunding a second time.
    if (ledgerError.code === '23505') {
      const { data: existing } = await supabaseServer
        .from('payment_refunds')
        .select('id, processor_refund_id, amount, currency, status, failure_code, failure_message')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        /**
         * WHAT the earlier attempt did decides what a replay means.
         *
         * This used to return `ok: true` for any existing row, without reading
         * `status`. So replaying a request whose refund had FAILED —
         * `balance_insufficient`, say — reported success with a null
         * `processorRefundId`, and the callers acted on it: the booking was
         * marked refunded, an audit entry was written at severity `critical`,
         * and the client was emailed about money that never moved.
         */
        if (existing.status === 'succeeded') {
          log.info({ refundId: existing.id }, 'Replayed request; returning the original refund');
          return {
            ok: true,
            refundId: existing.id,
            processorRefundId: existing.processor_refund_id,
            amount: Number(existing.amount),
            currency: existing.currency,
            replayed: true,
          };
        }

        if (existing.status === 'pending') {
          // Still in flight, or orphaned by a crash. Either way the caller must
          // not fire side effects — the money may yet move, or may not.
          log.warn({ refundId: existing.id }, 'Replayed a refund that is still pending');
          return {
            ok: false,
            code: 'IN_FLIGHT',
            message: 'This refund is still being processed. Check again shortly before retrying.',
          };
        }

        // failed / canceled. Report the original failure rather than a false
        // success; a genuine retry is a new intent and needs a new request id.
        log.warn(
          { refundId: existing.id, status: existing.status, failureCode: existing.failure_code },
          'Replayed a refund that did not succeed'
        );

        return {
          ok: false,
          code: 'PROCESSOR_ERROR',
          message:
            existing.failure_message ||
            'This refund was attempted before and did not go through. Try again as a new refund.',
        };
      }
    }

    // 23514 is the over-refund guard, which holds the row lock and is the only
    // correct place for that check.
    if (ledgerError.code === 'P0001' || ledgerError.code === '23514') {
      return {
        ok: false,
        code: 'EXCEEDS_REMAINING',
        message: 'That would refund more than this payment still has available.',
      };
    }

    log.error({ err: ledgerError }, 'Could not open the refund ledger row');
    return { ok: false, code: 'PROCESSOR_ERROR', message: 'The refund could not be started.' };
  }

  /*
   * The refund, on the client's timeline.
   *
   * Money arriving was recorded and money going back was not — the one
   * financial event with no trail beside the client it belongs to. Written in
   * the business's language, like every other activity, because this is its
   * own history rather than a label on a control.
   *
   * Non-blocking: a refund that has already left Stripe must not be reported
   * as failed because a timeline row could not be written.
   */
  const recordRefundActivity = () => {
      if (tx.invoice_id || tx.user_id) {
        void (async () => {
          try {
            const { data: invoice } = await supabaseServer
              .from('payment_invoices')
              .select('contact_id, invoice_number')
              .eq('id', tx.invoice_id ?? '')
              .maybeSingle();

            if (!invoice?.contact_id) return;

            const { data: ownerProfile } = await supabaseServer
              .from('business_profiles')
              .select('language')
              .eq('user_id', tx.user_id)
              .maybeSingle();
            const ownerLocale = ownerProfile?.language || 'en';

            await crmActivityRepository.create({
              user_id: tx.user_id,
              contact_id: invoice.contact_id,
              activity_type: 'refund_issued',
              title: activitySentence('refund_issued', {
                amount: new Intl.NumberFormat(
                  ownerLocale === 'he' ? 'he-IL' : ownerLocale === 'es' ? 'es-ES' : 'en-US',
                  { style: 'currency', currency: tx.currency || 'USD' }
                ).format(amount.amountMajor),
              }, ownerLocale),
              description: JSON.stringify({
                kind: 'refund_issued',
                amount: amount.amountMajor,
                currency: tx.currency,
                reason: reason || undefined,
                invoiceNumber: invoice.invoice_number || undefined,
              }),
              auto_logged: true,
              source_capability: 'payments',
              source_entity_id: transactionId,
            });
          } catch (err) {
            log.warn({ err, refundId: ledgerRow.id }, 'Refund activity logging failed (non-blocking)');
          }
        })();
      }
  };

  if (isManual) {
    /*
     * Done. No processor to call — the money already moved, by hand.
     *
     * Everything downstream is identical to a Stripe refund because it is
     * driven by the ledger row, not by this function: recompute_transaction_
     * refund_state sets the transaction, propagate_refund_to_invoice sets the
     * invoice, propagate_refund_to_booking sets the booking. That is why a
     * business with no processor gets the same reporting, the same journey and
     * the same export as one with Stripe.
     */
    log.info(
      { refundId: ledgerRow.id, amount: amount.amountMajor },
      'Manual refund recorded'
    );

    recordRefundActivity();

    return {
      ok: true,
      refundId: ledgerRow.id,
      // Null, not a made-up id: no processor issued this, and a reconciler
      // matching on references must not find a value that matches nothing.
      processorRefundId: null,
      amount: amount.amountMajor,
      currency: tx.currency,
      replayed: false,
    };
  }

  // Now Stripe.
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const stripeRefund = await stripe.refunds.create(
      {
        // Non-null by the guard above: a null target on a non-manual refund
        // returned MISSING_REFERENCE before the ledger row was written.
        ...stripeTarget!,
        amount: amount.amountMinor,
        reason: request.stripeReason ?? 'requested_by_customer',
      },
      {
        // Two layers of the same guarantee. The database key stops a second row;
        // this stops a second refund if the first response was lost in transit
        // and the row never got written.
        idempotencyKey,
        ...stripeRequestOptions(stripeAccount!),
      }
    );

    await supabaseServer
      .from('payment_refunds')
      .update({
        status: stripeRefund.status === 'failed' ? 'failed' : 'succeeded',
        processor_refund_id: stripeRefund.id,
        succeeded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ledgerRow.id);

    log.info(
      { refundId: ledgerRow.id, stripeRefundId: stripeRefund.id, amount: amount.amountMajor },
      'Refund issued'
    );

    recordRefundActivity();

    return {
      ok: true,
      refundId: ledgerRow.id,
      processorRefundId: stripeRefund.id,
      amount: amount.amountMajor,
      currency: tx.currency,
      replayed: false,
    };
  } catch (error) {
    const stripeCode = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);

    await supabaseServer
      .from('payment_refunds')
      .update({
        status: 'failed',
        failure_code: stripeCode ?? null,
        failure_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ledgerRow.id);

    log.error({ err: error, stripeCode }, 'Stripe refused the refund');

    // The connected account has already been paid out. Distinct from a generic
    // failure because the business can act on it — and because marking the
    // transaction refunded here would claim money moved when none did.
    if (stripeCode === 'balance_insufficient') {
      return {
        ok: false,
        code: 'BALANCE_INSUFFICIENT',
        message:
          'This payment has already been paid out, so there are not enough funds in the Stripe balance to refund it.',
      };
    }

    return {
      ok: false,
      code: 'PROCESSOR_ERROR',
      // The provider's own words only in development. In production they leak
      // internals to whoever clicked the button.
      message:
        process.env.NODE_ENV === 'development'
          ? message
          : 'The refund could not be completed. Nothing has been charged back.',
    };
  }
}
