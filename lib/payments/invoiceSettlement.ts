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
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ error: unknown }>;
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

  return { transactionId: transaction.id, alreadySettled: false };
}
