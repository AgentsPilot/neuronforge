/**
 * When an invoice counts as settled — money that arrived and must not be erased.
 *
 * One definition, because three places act on it and they must agree: deleting
 * a booking refuses if any of its invoices is settled, and voiding or deleting
 * an invoice refuses for the same reason. A rule that drifts between them lets
 * the same invoice be untouchable from one screen and erasable from another.
 */

// Type-only, so it is erased at compile time and this module keeps the
// property it was written for: no runtime dependency on Supabase.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'InvoiceSettlement' });

/** The fields the rule reads. Anything invoice-shaped satisfies it. */
export interface SettleableInvoice {
  status: string;
  paid_at?: string | null;
}

/**
 * Marked paid, or carrying a payment date.
 *
 * Both are checked because they can disagree: a processor webhook may stamp
 * `paid_at` before the status transition lands, and in that window an invoice
 * that has genuinely been paid still reads as `sent`. Treating either as
 * settled fails safe — the cost of refusing is a second click, the cost of
 * allowing is a deleted financial record.
 */
export function isSettledInvoice(invoice: SettleableInvoice | null | undefined): boolean {
  if (!invoice) return false;
  // 'refunded' and 'partially_refunded' are settled too: money arrived and some
  // or all of it went back. Both are financial records, and neither may be
  // deleted or voided.
  return (
    ['paid', 'refunded', 'partially_refunded'].includes(invoice.status) || !!invoice.paid_at
  );
}

/**
 * Has any of this invoice's money been given back?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READS `refund_status`, NOT `status`.
 *
 * `20260828d_invoice_refund_state.sql` says it outright: "`refund_status` is the
 * field to read. `status` gains 'refunded' and 'partially_refunded' because that
 * is what the invoice list renders, but it is a projection." A first version of
 * this guard checked `status` and let a refunded invoice straight through —
 * live data proves why: INV-00011 carries `refund_status: 'full'` and
 * `refunded_amount: 300` while its `status` still reads `sent`, because it was
 * refunded without ever having been marked paid.
 *
 * `refunded_amount` is checked too, so a row whose projection and ledger have
 * drifted is still caught by whichever of them noticed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function hasBeenRefunded(invoice: {
  status?: string | null;
  refund_status?: string | null;
  refunded_amount?: number | string | null;
}): boolean {
  if (invoice.refund_status === 'full' || invoice.refund_status === 'partial') return true;
  if (Number(invoice.refunded_amount ?? 0) > 0) return true;
  // The projection, for completeness — it is the least reliable of the three.
  return invoice.status === 'refunded' || invoice.status === 'partially_refunded';
}

/**
 * Record that an invoice was paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE WAY AN INVOICE BECOMES PAID.
 *
 * Five places used to do this and only one did it correctly. The rest set
 * `payment_invoices.status = 'paid'` and stopped — so the invoice looked settled
 * while no `payment_transactions` row existed. Revenue reads transactions, so
 * that money was invisible; refunds read transactions, so it was unrefundable;
 * and the CRM activity trigger never fired.
 *
 * TRANSACTION FIRST, INVOICE SECOND. If the payment cannot be recorded, the
 * invoice stays unpaid — visible, wrong in the safe direction, and retryable.
 * The other order is what produced paid-looking invoices with no money behind
 * them.
 *
 * The invoice update is belt-and-braces: `update_invoice_on_payment` already
 * does it when the transaction lands. It is repeated here so this works on a
 * database where that trigger is absent, and it is idempotent either way.
 *
 * WHY NOT A DATABASE TRIGGER going the other way? Because a trigger on
 * `payment_invoices` cannot know the payment intent, the charge, the Stripe
 * account or the payment method. It could only fabricate a transaction with
 * nulls — unrefundable phantom revenue, which is worse than the gap it closes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface SettleInvoiceInput {
  invoiceId: string;
  userId: string;
  contactId?: string | null;
  amount: number;
  currency: string;
  paidAt?: string;
  paymentMethod?: string;
  processorType?: string;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeCustomerId?: string | null;
  /** From `describeChargeAccount` — where the charge actually lives. */
  accountContext?: {
    stripe_connect_account_id: string | null;
    charge_account_kind: 'connect' | 'platform';
    account_resolution: string;
  };
  description?: string;
  metadata?: Record<string, unknown>;
  /**
   * The booking this invoice belongs to, when it belongs to one.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The charge was written with `invoice_id` alone, so money recorded by hand
   * against a booking's invoice produced a `payment_transactions` row that
   * named no booking: all 37 manual charges on this account carry
   * `booking_id = NULL`. Anything reading a booking's charges therefore could
   * not see them — the contact drawer joins `payment_transactions` on
   * `booking_id`, so a booking settled in cash looked like a booking with no
   * payment at all.
   *
   * Passed in rather than read from the invoice, because this function is
   * deliberately free of extra network calls: it is the one path several
   * surfaces share and it is tested against a fake database. Callers that know
   * the booking hand it over; the rest are unchanged.
   */
  bookingId?: string | null;
  /**
   * What the processor kept, when the caller already knows it.
   *
   * Passed in rather than fetched here: this function is deliberately free of
   * network calls — it is the one path three surfaces share, and it is tested
   * against a fake database. The webhook that has a Stripe client resolves the
   * fee and hands it over; the reconciler backfills anything settled without
   * one.
   */
  fee?: { processor_fee: number; net_amount: number; fee_currency: string } | null;
}

export interface SettleInvoiceResult {
  transactionId: string | null;
  /** True when a payment was already recorded and nothing new was written. */
  alreadySettled: boolean;
}

/** The minimum database surface this needs, so it can be tested without Supabase. */
export interface SettlementDb {
  from(table: string): {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        in?: (column: string, values: string[]) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data: unknown }> };
        };
        limit?: (n: number) => { maybeSingle: () => Promise<{ data: unknown }> };
        /*
         * DECLARED, REQUIRED, AND WITH A ROW SHAPE — which is what the comment
         * that used to sit here called "the actual fix" and deferred.
         *
         * The receipt-email read ends in `.maybeSingle()` on this shape. Left
         * undeclared, the call inferred `any` and the seven property reads
         * after it went unchecked — so this file carried a standing `tsc`
         * error and no type safety at exactly the point it emails a client.
         * Declared OPTIONAL it would be worse: "possibly undefined", result
         * `unknown`, and all seven reads fail instead of one.
         *
         * Required costs nothing in practice. There are two implementors: the
         * real Supabase client, which is cast in (its builder generics are too
         * deep for structural comparison), and the test fake, which already
         * provides it.
         */
        maybeSingle: () => Promise<{
          data: {
            user_id: string;
            client_email: string | null;
            client_name: string | null;
            invoice_number: string | null;
            currency: string | null;
            booking_id: string | null;
          } | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> };
    };
    update: (row: Record<string, unknown>) => {
      /*
       * Awaitable AND still chainable — which is what a PostgREST builder is.
       * Typing it as a bare Promise said the first filter had to be the last,
       * so `.eq(...).neq('status', 'paid')` — the filter that stops a stage
       * already marked paid from being restamped — was an error on a correct
       * line.
       */
      eq: (column: string, value: unknown) => Promise<{ error: unknown }> & {
        neq: (column: string, value: unknown) => Promise<{ error: unknown }>;
      };
    };
  };
}

/**
 * Accepts the narrow shape OR a real Supabase client.
 *
 * `SettlementDb` exists so this can be tested without a database, and it earns
 * that. But the real client does not satisfy it structurally: its builders carry
 * generics deep enough that TypeScript gives up comparing them — every caller
 * got both "not assignable to SettlementDb" and "type instantiation is
 * excessively deep".
 *
 * The alternative was a cast at each of the three call sites, which spreads the
 * problem rather than solving it and invites someone to cast something that is
 * NOT a database. Widening here narrows once, in the one place that knows why.
 */
export async function settleInvoicePaid(
  client: SettlementDb | SupabaseClient,
  input: SettleInvoiceInput
): Promise<SettleInvoiceResult> {
  const db = client as SettlementDb;

  const paidAt = input.paidAt ?? new Date().toISOString();

  // Already recorded? This runs from webhooks that Stripe may redeliver and
  // from retry paths, so it has to be safe to call twice. Without this a
  // redelivery would add a second payment and double the recorded revenue.
  const existing = await (db.from('payment_transactions').select('id').eq(
    'invoice_id',
    input.invoiceId
  ) as unknown as {
    in: (c: string, v: string[]) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: { id: string } | null }> } };
  })
    .in('status', ['succeeded', 'refunded'])
    .limit(1)
    .maybeSingle();

  if (existing?.data?.id) {
    return { transactionId: existing.data.id, alreadySettled: true };
  }

  const { data: transaction, error: txError } = await db
    .from('payment_transactions')
    .insert({
      user_id: input.userId,
      contact_id: input.contactId ?? null,
      invoice_id: input.invoiceId,
      /* Null when the invoice stands alone, which is a real and common case. */
      booking_id: input.bookingId ?? null,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      status: 'succeeded',
      payment_method: input.paymentMethod ?? 'card',
      processor_type: input.processorType ?? 'stripe',
      description: input.description ?? null,
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
      stripe_charge_id: input.stripeChargeId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
      paid_at: paidAt,
      refund_status: 'none',
      refunded_amount: 0,
      metadata: input.metadata ?? {},
      // Spread, so an unknown fee leaves the columns NULL rather than writing
      // zeros the backfill would then skip over.
      ...(input.fee ?? {}),
      ...(input.accountContext ?? {}),
    })
    .select('id')
    .single();

  if (txError || !transaction) {
    // Thrown, never swallowed. A caller that logs and continues is what leaves
    // an invoice marked paid with no payment behind it.
    throw new Error(
      `Could not record the payment for invoice ${input.invoiceId}: ${
        (txError as { message?: string })?.message ?? 'unknown error'
      }`
    );
  }

  const { error: invoiceError } = await db
    .from('payment_invoices')
    .update({ status: 'paid', paid_at: paidAt, updated_at: paidAt })
    .eq('id', input.invoiceId);

  if (invoiceError) {
    throw new Error(
      `Payment ${transaction.id} was recorded but invoice ${input.invoiceId} could not be marked paid: ${
        (invoiceError as { message?: string })?.message ?? 'unknown error'
      }`
    );
  }

  /*
   * A plan stage moves with the invoice that bills it.
   *
   * Without this the two halves of an instalment plan drift apart: the invoice
   * says paid and the stage still says pending, so nothing can answer "how much
   * of this job has been collected". The drawer read the FIRST invoice, found
   * it paid, and marked a two-stage job complete on half the money.
   *
   * Keyed on `invoice_id`, which `raiseInvoice` writes when it raises the
   * stage. Rows with no link — anything billed before that existed — are simply
   * not matched, which is correct: nothing claims they were paid.
   *
   * Non-fatal. The money is recorded and the invoice is paid; a stage left
   * pending is a reporting problem, not a reason to fail a settled payment
   * that the caller would then retry.
   */
  const { error: stageError } = await db
    .from('payment_plan_installments')
    .update({
      status: 'paid',
      paid_at: paidAt,
      /*
       * ───────────────────────────────────────────────────────────────────────
       * HOW THIS STAGE WAS PAID, WHICH THE STAGE COULD NOT PREVIOUSLY SAY.
       *
       * Only `status` and `paid_at` were written here, so every stage looked
       * identical however its money arrived. That breaks the case this whole
       * path exists for: a quoted job where the deposit went through the card
       * and the final milestone came in cash. Both stages read "paid", and
       * nothing on the row could tell an owner — or a report — which was which.
       *
       * These are the same columns `PaymentPlanRepository.markInstallmentPaid`
       * writes on the owner-driven path and the Stripe webhook writes on the
       * plan path, so a stage settled through here is no longer a second-class
       * row with three of its fields empty.
       *
       * `transaction_id` is the one that matters beyond display: it is the link
       * a refund follows to find the charge behind a period. The webhook's own
       * comment says so, and stages settled through this function had it NULL.
       *
       * `stripe_invoice_id` is deliberately NOT written. It is the dedupe key
       * for `recordPlanPeriodPaid` (`.eq('stripe_invoice_id', invoice.id)`), and
       * filling it from here would make that path read a settled period as one
       * it had already recorded — a silent skip on a different plan's money.
       * ───────────────────────────────────────────────────────────────────────
       */
      payment_method: input.paymentMethod ?? 'card',
      processor_type: input.processorType ?? 'stripe',
      transaction_id: transaction.id,
      /* No trigger on this table, so the row would still claim it had not been
         touched since it was projected. */
      updated_at: paidAt,
    })
    /*
     * ───────────────────────────────────────────────────────────────────────
     * NOT FILTERED ON STATUS, AND THAT IS THE WHOLE POINT.
     *
     * This carried `.neq('status', 'paid')` to avoid restamping a stage that
     * was already settled. Harmless when this update wrote only `status` and
     * `paid_at` — and fatal once it started carrying the attribution above,
     * because by the time it runs the row is ALWAYS already paid.
     *
     * `move_plan_stage_with_invoice` (migration 20260916) fires on
     * `payment_invoices` the moment the line above flips it to `paid`, and
     * marks every stage on that invoice paid. So the trigger wins the race by
     * construction, the guard then matched zero rows, and `payment_method`,
     * `processor_type` and `transaction_id` were silently never written. Live
     * proof: a cash payment recorded at 21:06:40 left its stage `paid` with
     * all three NULL, while the transaction beside it said `cash/manual`.
     *
     * Safe to drop the guard. `settleInvoicePaid` returns `alreadySettled`
     * before reaching here whenever a transaction already exists for this
     * invoice, so arriving at this line means THIS call is the payment — and
     * re-writing the same `paid_at` it just set is a no-op.
     *
     * The migration's own note says the two halves are idempotent because
     * "whichever runs second changes nothing". That is no longer the goal: the
     * second one has something to add.
     * ───────────────────────────────────────────────────────────────────────
     */
    .eq('invoice_id', input.invoiceId);

  if (stageError) {
    logger.error(
      { err: stageError, invoiceId: input.invoiceId, transactionId: transaction.id },
      'Invoice settled but its plan stage could not be marked paid'
    );
  }

  /*
   * A PACKAGE'S MEETINGS, which this payment is what confirms.
   *
   * Here because this is where every payment path converges — the Stripe
   * webhook, a manual mark-paid, bizql, a retry — exactly as the receipt below
   * is. Hung off one caller, the others would settle a package and leave six
   * meetings `pending` with their client never told.
   *
   * Non-fatal but AWAITED: the `try/catch` is what keeps a failure here from
   * failing a settled payment, and it does that whether or not anybody waits.
   * Firing it off instead meant the work began after the response and was lost
   * with the invocation — see the receipt below, which lost every email it was
   * ever asked to send for exactly that reason. A dropped confirmation here
   * leaves six meetings `pending` with their slots held and their client never
   * told, and nothing retries it.
   *
   * The client is cast to the real client because this reads two tables
   * `SettlementDb` does not describe. Widening that interface for it would
   * spread the problem — its own comments record what adding one optional
   * method already cost — so the cast is here, in the one place that knows the
   * fake database in the tests answers these calls too.
   */
  await (async () => {
    try {
      const { confirmPackageOnPayment } = await import('@/lib/payments/confirmPackageOnPayment');
      await confirmPackageOnPayment(client as SupabaseClient, input.invoiceId, paidAt);
    } catch (err) {
      logger.error(
        { err, invoiceId: input.invoiceId },
        'Payment settled but a package it may have paid for was not confirmed'
      );
    }
  })();

  /*
   * The receipt.
   *
   * Sent from here because this is where every payment path converges — card
   * via the Stripe webhook, a manual mark-paid, bizql, a retry. Sending it from
   * any one caller means the others stay silent, which is exactly how the plan
   * stage came to disagree with its invoice.
   *
   * It matters more since the acceptance flow stopped emailing the invoice to
   * anyone it redirects: without this, a client who accepted and paid by card
   * received NO email at all about money leaving their account.
   *
   * Below the `alreadySettled` return above, so a replayed webhook cannot send
   * a second receipt for the same payment.
   *
   * AWAITED. It was fired and forgotten, on the reasoning that a mail failure
   * must not fail a settled payment the caller would then retry. True, and the
   * `try/catch` is what secures it: this returns normally whatever the mailer
   * does. What `void` actually bought was a continuation starting after the
   * response, which no host keeps alive — frozen at response time on
   * serverless, killed by the next restart in local dev. The identical block in
   * the Stripe Connect webhook sent nothing at all on 19 Oct across three
   * settled invoices, one of them for ₪4,750, because of this and nothing else.
   */
  await (async () => {
    try {
      const { data: invoice } = await db
        .from('payment_invoices')
        .select('user_id, client_email, client_name, invoice_number, currency, booking_id')
        .eq('id', input.invoiceId)
        .maybeSingle();

      if (!invoice?.client_email) return;

      const { BookingEmailService } = await import('@/lib/services/BookingEmailService');

      await BookingEmailService.sendPaymentReceipt(invoice.user_id, {
        invoiceId: input.invoiceId,
        customerEmail: invoice.client_email,
        customerName: invoice.client_name || '',
        amount: input.amount,
        currency: invoice.currency || 'USD',
        /* `?? undefined`, because the column is nullable and the parameter is
           not. The mismatch was invisible while this read inferred `any`: a
           null invoice number went in as a null the receipt template would
           have printed. */
        receiptNumber: invoice.invoice_number ?? undefined,
        paymentMethod: input.paymentMethod ?? undefined,
        bookingId: invoice.booking_id ?? undefined,
      });
    } catch (err) {
      logger.error(
        { err, invoiceId: input.invoiceId, transactionId: transaction.id },
        'Payment settled but the receipt did not go out'
      );
    }
  })();

  return { transactionId: transaction.id, alreadySettled: false };
}
