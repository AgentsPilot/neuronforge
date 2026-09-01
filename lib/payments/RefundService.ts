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
  /** Stripe refused for some other reason. */
  | 'PROCESSOR_ERROR';

export interface RefundRequest {
  userId: string;
  transactionId: string;
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
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_connect_account_id: string | null;
  account_resolution: string | null;
}

const TRANSACTION_COLUMNS =
  'id, user_id, invoice_id, amount, currency, status, refunded_amount, stripe_payment_intent_id, stripe_charge_id, stripe_connect_account_id, account_resolution';

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

  if (!account.ok) {
    return { refundable: false, reason: account.reason, detail: account.detail, remaining };
  }

  if (!amount.ok) return { refundable: false, reason: amount.error, remaining: 0 };

  return { refundable: true, remaining, currency: tx.currency };
}

/**
 * Find the transaction behind whatever the caller is looking at.
 *
 * The invoices tab knows an invoice, the CRM drawer knows a booking, and the
 * payments tab knows a transaction. One resolver so those three surfaces cannot
 * each invent their own — which is how the booking route ended up with a lookup
 * that 500s whenever a booking has two transactions.
 */
export async function resolveRefundTarget(params: {
  userId: string;
  transactionId?: string;
  invoiceId?: string;
  bookingId?: string;
}): Promise<{ transactionId: string } | { error: RefundErrorCode; message: string }> {
  const { userId, transactionId, invoiceId, bookingId } = params;

  if (transactionId) return { transactionId };

  const column = invoiceId ? 'invoice_id' : 'booking_id';
  const value = invoiceId ?? bookingId;

  if (!value) {
    return { error: 'NOT_FOUND', message: 'No invoice, booking or payment was given.' };
  }

  // Settled payments only, newest first. More than one is legitimate — a deposit
  // and a balance — so this picks rather than failing, which is what the old
  // `.single()` did.
  const { data } = await supabaseServer
    .from('payment_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq(column, value)
    .in('status', ['succeeded', 'refunded'])
    .order('created_at', { ascending: false })
    .limit(1);

  const found = data?.[0]?.id;
  if (!found) {
    return {
      error: 'NOT_FOUND',
      message: 'No settled payment is recorded against this, so there is nothing to refund.',
    };
  }

  return { transactionId: found };
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

  // The account, before anything else. An unresolved charge must not reach
  // Stripe at all: the call would either error or refund from the wrong balance,
  // and the second is not recoverable.
  const account = resolveRefundAccount(tx);
  if (!account.ok) {
    log.warn({ resolution: tx.account_resolution }, 'Refused: Stripe account unresolved');
    return { ok: false, code: 'ACCOUNT_UNRESOLVED', message: account.detail };
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
      status: 'pending',
      reason: reason ?? null,
      processor_type: 'stripe',
      stripe_connect_account_id: account.stripeAccount,
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
        .select('id, processor_refund_id, amount, currency')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
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

  // Now Stripe.
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const target = tx.stripe_payment_intent_id
      ? { payment_intent: tx.stripe_payment_intent_id }
      : tx.stripe_charge_id
        ? { charge: tx.stripe_charge_id }
        : null;

    if (!target) {
      throw Object.assign(new Error('This payment has no Stripe reference to refund against.'), {
        code: 'missing_reference',
      });
    }

    const stripeRefund = await stripe.refunds.create(
      { ...target, amount: amount.amountMinor, reason: 'requested_by_customer' },
      {
        // Two layers of the same guarantee. The database key stops a second row;
        // this stops a second refund if the first response was lost in transit
        // and the row never got written.
        idempotencyKey,
        ...stripeRequestOptions(account.stripeAccount),
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
