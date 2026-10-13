import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'PaymentRepository' });

// Types
export interface PaymentTransaction {
  id: string;
  user_id: string;
  contact_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_customer_id: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  payment_method: string | null;
  description: string | null;
  invoice_id: string | null;
  // The booking this paid for, when it paid for one.
  booking_id?: string | null;
  metadata: Record<string, unknown>;
  failure_reason: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  // New refund fields
  refund_status: 'none' | 'partial' | 'full';
  refunded_amount: number;
  refunded_at: string | null;
  refund_reason: string | null;
  processor_refund_id: string | null;
  processor_type: string | null;
  // Service information (enriched from metadata)
  service_id?: string;
  service_name?: string;
  // Payment plan installment information (enriched from payment_plan_installments)
  installment_number?: number;
  installment_total?: number;
  payment_plan_name?: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface InvoiceAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface PaymentInvoice {
  id: string;
  user_id: string;
  contact_id: string | null;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'refunded' | 'partially_refunded';
  /**
   * Refund state, DERIVED from this invoice's payments by
   * propagate_refund_to_invoice(). Read these; never write them — the trigger
   * recomputes them from the refund ledger on every change, so a direct write
   * is silently overwritten.
   */
  refunded_amount: number;
  refund_status: 'none' | 'partial' | 'full';
  refunded_at: string | null;
  line_items: InvoiceLineItem[];
  due_date: string | null;
  payment_terms: string;
  notes: string | null;
  internal_notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  // Payment fields (processor agnostic)
  payment_method: string | null;
  payment_received_at: string | null;
  payment_notes: string | null;
  processor_type: string | null;
  /**
   * May this invoice be paid online?
   *
   * FALSE means collect it by transfer — no card button on the pay page, bank
   * details instead. NULL means no choice was recorded and the business's own
   * collection capability decides, which is how every invoice behaved before
   * the column existed.
   */
  allow_online_payment: boolean | null;
  processor_checkout_id: string | null;
  processor_payment_id: string | null;
  processor_customer_id: string | null;
  processor_payment_method_id: string | null;
  // Retry fields
  retry_count: number;
  last_retry_at: string | null;
  next_retry_at: string | null;
  // Stripe Invoice fields
  stripe_invoice_id: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf: string | null;
  // Client details
  client_name: string | null;
  client_email: string | null;
  client_address: InvoiceAddress | null;
  // Booking link
  booking_id: string | null;
  // Which service was billed. Drives the revenue-by-service breakdown on the
  // reports page; absent on invoices that aren't for a catalogue service.
  service_id?: string | null;
}

export interface StripeConnectAccount {
  id: string;
  user_id: string;
  stripe_account_id: string;
  stripe_account_type: string;
  stripe_email: string | null; // Email used for the Stripe Express account
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  onboarding_completed: boolean;
  country: string | null;
  /**
   * Settlement currency, as WE understand it.
   *
   * Nullable like `country` above, and for the same reason: it can be unknown.
   * Stripe decides the real one from the country; this records our belief, and
   * both readers already treat it as optional — `|| null` in the status refresh
   * and `?.toUpperCase()` in the status card. The type simply had not caught up.
   */
  currency: string | null;
  business_type: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentRepositoryResult<T> = {
  data: T | null;
  error: Error | null;
};

// ── Stripe webhook: transaction column lists and row shapes (CF-5 PR 3) ──────
// Each list is the exact select string the webhook issued inline before it moved
// here (docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
// §7.3.4). Literal types, so a caller can pass only these (SA C-3).

/** `charge.dispute.*`: the payment, its owner and what the dispute alert needs. */
export const WEBHOOK_TRANSACTION_DISPUTE_COLUMNS = 'id, user_id, status, amount, currency, contact_id, metadata';
/** `charge.refunded`: what each refund row needs from its payment. */
export const WEBHOOK_TRANSACTION_REFUND_COLUMNS = 'id, user_id, invoice_id, currency';
/** `payment_intent.succeeded`: is this intent already recorded? */
export const WEBHOOK_TRANSACTION_ID_COLUMNS = 'id';
/** `invoice.paid` (#257): the row recorded under this intent, and whether it has an invoice yet. */
export const WEBHOOK_TRANSACTION_ATTACH_COLUMNS = 'id, invoice_id';

/** Closed set of column lists `findFirstByStripeReference` may select. */
export type WebhookTransactionByReferenceColumns =
  | typeof WEBHOOK_TRANSACTION_DISPUTE_COLUMNS
  | typeof WEBHOOK_TRANSACTION_REFUND_COLUMNS;
/** Closed set of column lists `findByPaymentIntentId` may select. */
export type WebhookTransactionByIntentColumns =
  | typeof WEBHOOK_TRANSACTION_ID_COLUMNS
  | typeof WEBHOOK_TRANSACTION_ATTACH_COLUMNS;

/**
 * The row shape each column list returns. `status` is a plain string here:
 * a disputed payment reads `disputed`, which `PaymentTransaction['status']`
 * does not list.
 */
export interface WebhookTransactionFields {
  [WEBHOOK_TRANSACTION_DISPUTE_COLUMNS]: {
    id: string;
    user_id: string;
    status: string;
    amount: number;
    currency: string;
    contact_id: string | null;
    metadata: Record<string, unknown> | null;
  };
  [WEBHOOK_TRANSACTION_REFUND_COLUMNS]: Pick<PaymentTransaction, 'id' | 'user_id' | 'invoice_id' | 'currency'>;
  [WEBHOOK_TRANSACTION_ID_COLUMNS]: Pick<PaymentTransaction, 'id'>;
  [WEBHOOK_TRANSACTION_ATTACH_COLUMNS]: Pick<PaymentTransaction, 'id' | 'invoice_id'>;
}

/** Which Stripe reference a payment is found by: the intent when there is one, else the charge. */
export interface WebhookStripeReference {
  paymentIntentId: string | null | undefined;
  chargeId: string;
}

/** What a dispute event writes on the payment: its new status and the metadata built from the dispute. */
export interface WebhookDisputeState {
  status: string;
  metadata: Record<string, unknown>;
}

/**
 * A payment row the webhook records: a standalone Connect payment
 * (`payment_intent.succeeded`), a plan period, or an invoice payment
 * (`invoice.paid`, Connect checkout). The route builds it as an object literal,
 * so an extra key fails `tsc` (SA C-3).
 *
 * The fee columns arrive by spreading `feeColumns(fee)`, which is typed
 * `Record<string, unknown>` and so adds nothing to the literal's type; they are
 * listed here only so that a literal naming them is accepted.
 */
export interface NewWebhookTransactionRow {
  user_id: string;
  contact_id: string | null;
  invoice_id?: string;
  booking_id?: string | null;
  service_id?: string | null;
  amount: number;
  currency: string;
  status: 'succeeded';
  processor_type: 'stripe';
  payment_method: 'card';
  stripe_payment_intent_id: string | null;
  stripe_customer_id?: string | null;
  processor_fee?: number;
  net_amount?: number;
  fee_currency?: string;
  paid_at: string;
  description: string;
  refund_status?: 'none';
  refunded_amount?: 0;
  metadata: Record<string, unknown>;
  stripe_connect_account_id: string | null;
  charge_account_kind: 'connect' | 'platform';
  account_resolution: string;
}

/**
 * supabase-js's result, passed through unchanged (the same error object, so a
 * caller can still read `message` or rethrow it). The webhook transaction
 * methods neither catch nor log (see their section).
 */
export interface WebhookTransactionResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

// Transaction Repository
export class PaymentTransactionRepository {
  private supabase: SupabaseClient;

  // Constructor injection (matches PaymentPlanRepository/Scheduling/CRM). The singleton export
  // below passes `supabaseServer`, keeping existing importers byte-compatible.
  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  async create(transaction: Omit<PaymentTransaction, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentRepositoryResult<PaymentTransaction>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_transactions')
        .insert(transaction)
        .select()
        .single();

      if (error) throw error;
      logger.info({ transactionId: data.id }, 'Payment transaction created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create payment transaction');
      return { data: null, error: error as Error };
    }
  }

  async findById(id: string, userId: string): Promise<PaymentRepositoryResult<PaymentTransaction>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_transactions')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find payment transaction');
      return { data: null, error: error as Error };
    }
  }

  async list(
    userId: string,
    options: {
      status?: string;
      contactId?: string;
      limit?: number;
      offset?: number;
      includeContact?: boolean;
    } = {}
  ): Promise<PaymentRepositoryResult<PaymentTransaction[]>> {
    try {
      const { status, contactId, limit = 50, offset = 0, includeContact = false } = options;

      // Use join to get contact info if requested
      const selectClause = includeContact
        ? '*, contact:crm_contacts(id, first_name, last_name, email)'
        : '*';

      let query = this.supabase
        .from('payment_transactions')
        .select(selectClause)
        .eq('user_id', userId);

      if (status) query = query.eq('status', status);
      if (contactId) query = query.eq('contact_id', contactId);

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      // Enrich with service information and payment plan installment data
      const enrichedData = await Promise.all((data || []).map(async (transaction: any) => {
        let enriched = { ...transaction };

        // Add service information from proper service_id column (not metadata)
        // service_id column was added in migration 20260809
        const serviceId = transaction.service_id || transaction.metadata?.service_id; // Fallback to metadata for old records
        if (serviceId) {
          const { data: serviceData } = await this.supabase
            .from('scheduling_services')
            .select('id, service_name')
            .eq('id', serviceId)
            .eq('user_id', userId)
            .single();

          if (serviceData) {
            enriched = {
              ...enriched,
              service_id: serviceData.id,
              service_name: serviceData.service_name
            };
          }
        }

        // Add payment plan installment information if this transaction is linked to an installment
        const { data: installmentData } = await this.supabase
          .from('payment_plan_installments')
          .select('installment_number, payment_plan_id, payment_plans(name, installment_count)')
          .eq('transaction_id', transaction.id)
          .eq('user_id', userId)
          .single();

        if (installmentData) {
          enriched = {
            ...enriched,
            installment_number: installmentData.installment_number,
            installment_total: (installmentData as any).payment_plans?.installment_count,
            payment_plan_name: (installmentData as any).payment_plans?.name
          };
        }

        return enriched;
      }));

      return { data: enrichedData as unknown as PaymentTransaction[], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list payment transactions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count invoices for a user, optionally filtered by status and/or contact. Uses a
   * head-only exact count (no rows fetched). Backs the `count_invoices` plugin op.
   *
   * MERGE NOTE (2026-09-02): main and the feature branch each wrote a `count()` here and
   * git unioned both into this class - a duplicate implementation TypeScript rejected.
   * This (branch) version is kept because it is a strict superset: it also filters by
   * `contactId` (required by app/api/payments/invoices/route.ts) and applies the same
   * comma-separated status grouping as list(), so a single status behaves identically to
   * main's version used by payments-plugin-executor. See D12.
   */
  async count(
    userId: string,
    options: {
      status?: string;
      contactId?: string;
    } = {}
  ): Promise<PaymentRepositoryResult<number>> {
    try {
      const { status, contactId } = options;

      let query = this.supabase
        .from('payment_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (status) query = query.eq('status', status);
      if (contactId) query = query.eq('contact_id', contactId);

      const { count, error } = await query;
      if (error) throw error;

      return { data: count || 0, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to count payment transactions');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<PaymentTransaction>
  ): Promise<PaymentRepositoryResult<PaymentTransaction>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_transactions')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ transactionId: id }, 'Payment transaction updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update payment transaction');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Money still held for a booking — taken directly, or against one of the
   * invoices raised for it. A fully refunded payment is left out: refunding
   * flips the transaction to 'refunded', so filtering on 'succeeded' is what
   * separates money the business holds from money it has given back. A partial
   * refund stays 'succeeded' and still counts, because part of it is held.
   *
   * Used to decide whether a booking can still be deleted.
   */
  async findSettledForBooking(
    bookingId: string,
    invoiceIds: string[],
    userId: string
  ): Promise<PaymentRepositoryResult<PaymentTransaction[]>> {
    try {
      // booking_id and invoice_id are separate columns, and PostgREST cannot
      // express "or" across an in-list cleanly, so ask for each and merge.
      const queries = [
        this.supabase
          .from('payment_transactions')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'succeeded')
          .eq('booking_id', bookingId),
      ];

      if (invoiceIds.length > 0) {
        queries.push(
          this.supabase
            .from('payment_transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'succeeded')
            .in('invoice_id', invoiceIds)
        );
      }

      const results = await Promise.all(queries);
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;

      const byId = new Map<string, PaymentTransaction>();
      results.forEach(r => (r.data || []).forEach((t: PaymentTransaction) => byId.set(t.id, t)));

      return { data: Array.from(byId.values()), error: null };
    } catch (error) {
      logger.error({ err: error, bookingId, userId }, 'Failed to look up settled payments for booking');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Money the business actually kept: what was paid, less what was returned.
   *
   * This filtered on `status = 'succeeded'` and summed the gross amount, which
   * was wrong in both directions at once. A fully refunded payment flips to
   * 'refunded' and vanished from revenue entirely — right by accident. A
   * PARTIALLY refunded one stays 'succeeded' and was counted at full value, so
   * a business that refunded half of every payment saw none of it.
   *
   * Both statuses are included and `refunded_amount` is subtracted, so each
   * payment contributes exactly what was kept. `refunded_amount` is maintained
   * by trigger from the refund ledger, so this cannot drift from the refunds
   * themselves.
   *
   * Note this will move historical figures the first time it runs against
   * reconciled data — that is the correction, not a regression.
   */
  async getTotalRevenue(userId: string, startDate?: string, endDate?: string): Promise<PaymentRepositoryResult<number>> {
    try {
      let query = this.supabase
        .from('payment_transactions')
        .select('amount, refunded_amount')
        .eq('user_id', userId)
        .in('status', ['succeeded', 'refunded']);

      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);

      const { data, error } = await query;
      if (error) throw error;

      const total =
        data?.reduce(
          (sum, t) => sum + (Number(t.amount) - Number(t.refunded_amount ?? 0)),
          0
        ) || 0;

      return { data: total, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get total revenue');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get transaction stats grouped by status
   */
  async getStatsByStatus(userId: string): Promise<PaymentRepositoryResult<{
    succeeded: { count: number; total: number };
    pending: { count: number; total: number };
    failed: { count: number; total: number };
    refunded: { count: number; total: number };
    all: { count: number; total: number };
  }>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_transactions')
        .select('status, amount, refund_status, refunded_amount')
        .eq('user_id', userId);

      if (error) throw error;

      const stats = {
        succeeded: { count: 0, total: 0 },
        pending: { count: 0, total: 0 },
        failed: { count: 0, total: 0 },
        refunded: { count: 0, total: 0 },
        all: { count: 0, total: 0 }
      };

      for (const t of data || []) {
        const amount = Number(t.amount) || 0;
        stats.all.count++;
        stats.all.total += amount;

        // Handle refunded transactions
        if (t.status === 'refunded' || t.refund_status === 'full') {
          stats.refunded.count++;
          stats.refunded.total += Number(t.refunded_amount) || amount;
        } else if (t.refund_status === 'partial') {
          // Partial refund: count in succeeded but track refund amount separately
          stats.succeeded.count++;
          stats.succeeded.total += amount - (Number(t.refunded_amount) || 0);
          stats.refunded.total += Number(t.refunded_amount) || 0;
        } else if (t.status === 'succeeded') {
          stats.succeeded.count++;
          stats.succeeded.total += amount;
        } else if (t.status === 'pending') {
          stats.pending.count++;
          stats.pending.total += amount;
        } else if (t.status === 'failed') {
          stats.failed.count++;
          stats.failed.total += amount;
        }
      }

      return { data: stats, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get transaction stats by status');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a refund for a transaction
   */
  async createRefund(
    transactionId: string,
    userId: string,
    refundDetails: {
      amount: number;
      reason?: string;
      processorRefundId?: string;
      isFullRefund: boolean;
    }
  ): Promise<PaymentRepositoryResult<PaymentTransaction>> {
    try {
      logger.info({ transactionId, userId, amount: refundDetails.amount }, 'Creating refund');

      const { data, error } = await this.supabase
        .from('payment_transactions')
        .update({
          refund_status: refundDetails.isFullRefund ? 'full' : 'partial',
          refunded_amount: refundDetails.amount,
          refunded_at: new Date().toISOString(),
          refund_reason: refundDetails.reason || null,
          processor_refund_id: refundDetails.processorRefundId || null,
          status: refundDetails.isFullRefund ? 'refunded' : 'succeeded',
          updated_at: new Date().toISOString()
        })
        .eq('id', transactionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ transactionId, refundAmount: refundDetails.amount }, 'Refund created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, transactionId, userId }, 'Failed to create refund');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get transactions that can be refunded
   */
  async getRefundableTransactions(
    userId: string,
    options: { contactId?: string; limit?: number; offset?: number } = {}
  ): Promise<PaymentRepositoryResult<PaymentTransaction[]>> {
    try {
      const { contactId, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'succeeded')
        .or('refund_status.eq.none,refund_status.is.null');

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get refundable transactions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get refunded transactions
   */
  async getRefundedTransactions(
    userId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<PaymentRepositoryResult<PaymentTransaction[]>> {
    try {
      const { limit = 50, offset = 0 } = options;

      const { data, error } = await this.supabase
        .from('payment_transactions')
        .select('*')
        .eq('user_id', userId)
        .in('refund_status', ['partial', 'full'])
        .order('refunded_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get refunded transactions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Record a manual payment (creates transaction for manual payments)
   */
  async recordManualPayment(
    userId: string,
    paymentDetails: {
      contactId?: string;
      invoiceId?: string;
      amount: number;
      currency: string;
      paymentMethod: 'cash' | 'bank_transfer' | 'check' | 'other';
      description?: string;
      notes?: string;
      receivedAt?: string;
    }
  ): Promise<PaymentRepositoryResult<PaymentTransaction>> {
    try {
      logger.info({
        userId,
        amount: paymentDetails.amount,
        method: paymentDetails.paymentMethod
      }, 'Recording manual payment');

      const { data, error } = await this.supabase
        .from('payment_transactions')
        .insert({
          user_id: userId,
          contact_id: paymentDetails.contactId || null,
          invoice_id: paymentDetails.invoiceId || null,
          amount: paymentDetails.amount,
          currency: paymentDetails.currency,
          status: 'succeeded',
          payment_method: paymentDetails.paymentMethod,
          description: paymentDetails.description || `Manual payment - ${paymentDetails.paymentMethod}`,
          processor_type: 'manual',
          paid_at: paymentDetails.receivedAt || new Date().toISOString(),
          metadata: {
            manual: true,
            notes: paymentDetails.notes
          },
          refund_status: 'none',
          refunded_amount: 0
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ transactionId: data.id, userId }, 'Manual payment recorded');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to record manual payment');
      return { data: null, error: error as Error };
    }
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Moved out of `app/api/stripe/webhook/route.ts` with no behaviour change
  // (CF-5 PR 3, CLAUDE.md rule 1). Each method issues exactly the query the
  // route issued inline: same table, operation, columns, filters in the same
  // order, `.limit`, payload and terminal. The webhook's characterisation
  // harness records the full chain, so a method that drifted would fail its
  // snapshot.
  //
  // No `user_id` filter, as an exception to rule 4, bounded per
  // docs/REPOSITORY_STRATEGY.md ("unscoped by design"): each doc below names the
  // owner check it relies on instead. A unit test asserts none adds one.
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, as in `ProcessedWebhookEventRepository` and the invoice section.
  // The route logs every error it acts on with the correlation and Stripe event
  // ids; a catch here would turn a thrown query into a quiet miss where the
  // route used to fail and let Stripe retry.

  /**
   * ⟨unscoped-by-design⟩ The first payment recorded under a Stripe reference:
   * by payment intent when there is one, otherwise by charge. Returns an array
   * (at most one row), as the route always read it. The filter comes after
   * `.limit(1)`, the order the route built it in.
   *
   * Owner check relied on: none in the route (FU-3). The key is a Stripe id from
   * a signature-verified `charge.dispute.*` or `charge.refunded` event, which no
   * business can choose, and the row found carries its own `user_id`, which is
   * what every later write uses.
   */
  async findFirstByStripeReference<C extends WebhookTransactionByReferenceColumns>(
    reference: WebhookStripeReference,
    columns: C
  ): Promise<WebhookTransactionResult<Array<WebhookTransactionFields[C]>>> {
    let query = this.supabase.from('payment_transactions').select(columns).limit(1);

    query = reference.paymentIntentId
      ? query.eq('stripe_payment_intent_id', reference.paymentIntentId)
      : query.eq('stripe_charge_id', reference.chargeId);

    const { data, error } = await query;
    return { data: data as Array<WebhookTransactionFields[C]> | null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ `charge.dispute.*`: the payment's new status and the
   * metadata the route built from the dispute (it keeps the status from before
   * the dispute, so winning restores it). Owner check relied on: the row was
   * found by the dispute's Stripe reference (`findFirstByStripeReference`), and
   * the id comes from that row, never from the event.
   */
  async recordDisputeState(id: string, state: WebhookDisputeState): Promise<WebhookTransactionResult<null>> {
    const { error } = await this.supabase
      .from('payment_transactions')
      .update({
        status: state.status,
        metadata: state.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ The payment recorded under a Stripe payment intent, or
   * `null`: `'id'` to dedupe a `payment_intent.succeeded`, `'id, invoice_id'`
   * for `invoice.paid` to find a row the other handler wrote (#257).
   *
   * Owner check relied on: the intent id is from a signed event or from Stripe's
   * own invoice, never from metadata. `payment_intent.succeeded` calls this
   * after `accountOwns` on the claimed owner; `invoice.paid` after `accountOwns`
   * on the invoice.
   */
  async findByPaymentIntentId<C extends WebhookTransactionByIntentColumns>(
    paymentIntentId: string,
    columns: C
  ): Promise<WebhookTransactionResult<WebhookTransactionFields[C]>> {
    const { data, error } = await this.supabase
      .from('payment_transactions')
      .select(columns)
      .eq('stripe_payment_intent_id', paymentIntentId)
      .limit(1)
      .maybeSingle<WebhookTransactionFields[C]>();
    return { data, error };
  }

  /**
   * ⟨unscoped-by-design⟩ `invoice.paid` (#257): attaches our invoice to a payment
   * row that `payment_intent.succeeded` recorded first without one. Writes
   * `invoice_id` only (no `updated_at`, as the route never did). Owner check
   * relied on: the invoice was proved owned (`accountOwns`), and the row was
   * found by the payment intent Stripe resolved for that invoice.
   */
  async attachToInvoice(id: string, invoiceId: string): Promise<WebhookTransactionResult<null>> {
    const { error } = await this.supabase
      .from('payment_transactions')
      .update({ invoice_id: invoiceId })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ `invoice.paid`: the id of a payment already recorded
   * against this invoice (succeeded or refunded), or `null`. It is what makes a
   * redelivery safe. Owner check relied on: the invoice was proved owned
   * (`accountOwns`) before this read.
   */
  async findSettledIdForInvoice(invoiceId: string): Promise<WebhookTransactionResult<{ id: string }>> {
    const { data, error } = await this.supabase
      .from('payment_transactions')
      .select('id')
      .eq('invoice_id', invoiceId)
      .in('status', ['succeeded', 'refunded'])
      .limit(1)
      .maybeSingle<{ id: string }>();
    return { data, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Records a payment the webhook saw settle. The row is
   * built by the route as an object literal and inserted as it is; nothing is
   * added, reordered or read back.
   *
   * Owner check relied on: the route proves `user_id` first. A standalone
   * payment's owner comes from connected-account metadata and is checked with
   * `accountOwns` (its contact, booking and service ids are vetted by
   * `ownedOrNull`, Fix-1 F-4); an invoice payment's owner is the invoice's,
   * proved with `accountOwns`.
   */
  async insertFromWebhook(row: NewWebhookTransactionRow): Promise<WebhookTransactionResult<null>> {
    const { error } = await this.supabase.from('payment_transactions').insert(row);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Records a plan period's payment and returns its id,
   * which the period row then links to. Same row type as `insertFromWebhook`.
   * Owner check relied on: the plan, whose `user_id` this row carries, was
   * proved owned (`accountOwns`) before anything was read for it.
   */
  async insertFromWebhookReturningId(
    row: NewWebhookTransactionRow
  ): Promise<WebhookTransactionResult<{ id: string }>> {
    const { data, error } = await this.supabase
      .from('payment_transactions')
      .insert(row)
      .select('id')
      .single<{ id: string }>();
    return { data, error };
  }
}

/**
 * What a caller must supply to raise an invoice. The payment, processor, retry
 * and Stripe fields are filled in later by whatever settles the invoice, and the
 * column defaults cover them until then, so they are optional here — callers
 * were already omitting them.
 */
export type CreatePaymentInvoiceInput =
  Omit<
    PaymentInvoice,
    | 'id' | 'created_at' | 'updated_at'
    | 'payment_method' | 'payment_received_at' | 'payment_notes'
    | 'processor_type' | 'processor_checkout_id' | 'processor_payment_id'
    | 'processor_customer_id' | 'processor_payment_method_id'
    | 'allow_online_payment'
    | 'retry_count' | 'last_retry_at' | 'next_retry_at'
    | 'stripe_invoice_id' | 'stripe_hosted_invoice_url' | 'stripe_invoice_pdf'
    | 'client_address'
    // MERGE FIX (2026-09-02, F4): every one of these is nullable or DB-defaulted, so none
    // belongs in the required set of an insert. They entered PaymentInvoice via the feature
    // branch's migrations while main's callers (CapabilityEngine.createInvoice,
    // payments-plugin-executor.buildInvoiceInsert) were written against the narrower row
    // type -- which is why the merged tree failed to compile:
    //   refund_status  DEFAULT 'none'  |  refunded_amount DEFAULT 0  |  refunded_at NULL
    //   client_name / client_email     (20260806_add_invoice_profile_fields, nullable)
    //   booking_id                     (nullable, "Optional link to booking")
    //   service_id                     (20260809214450, nullable)
    | 'refund_status' | 'refunded_amount' | 'refunded_at'
    | 'client_name' | 'client_email'
    | 'booking_id' | 'service_id'
  > &
  Partial<
    Pick<
      PaymentInvoice,
      | 'payment_method' | 'payment_received_at' | 'payment_notes'
      | 'processor_type' | 'processor_checkout_id' | 'processor_payment_id'
      | 'processor_customer_id' | 'processor_payment_method_id'
      | 'allow_online_payment'
      | 'retry_count' | 'last_retry_at' | 'next_retry_at'
      | 'stripe_invoice_id' | 'stripe_hosted_invoice_url' | 'stripe_invoice_pdf'
      | 'client_address'
      | 'refund_status' | 'refunded_amount' | 'refunded_at'
      | 'client_name' | 'client_email'
      | 'booking_id' | 'service_id'
    >
  >;

/**
 * Statuses that count as an issued, unpaid invoice.
 *
 * `overdue` is not a different kind of invoice from `sent` — it is a sent
 * invoice that has passed its due date. Treating it as a separate bucket made
 * the Sent figure shrink as invoices aged, which reads as money disappearing.
 * So Sent is the superset and Overdue is a flag on part of it; the two overlap
 * by design and must never be added together.
 */
export const ISSUED_INVOICE_STATUSES = ['sent', 'pending', 'overdue'] as const;

// ── Stripe webhook: invoice column lists and result shapes (CF-5 PR 2) ───────
// Each list is the exact select string the webhook issued inline before it moved
// here (docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
// §7.3.3). Literal types, so a caller can pass only these (SA C-3).

/** `invoice.payment_failed` / `.finalized` / `.marked_uncollectible`: find the row and its owner. */
export const WEBHOOK_INVOICE_LOOKUP_COLUMNS = 'id, invoice_number, user_id';
/** `invoice.paid`: what the receipt e-mail needs. */
export const WEBHOOK_INVOICE_RECEIPT_COLUMNS =
  'id, user_id, client_email, client_name, invoice_number, currency, booking_id';
/** `invoice.payment_failed`: what the client-timeline activity needs. */
export const WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS = 'contact_id, amount, currency';

/** Closed set of column lists `findByStripeInvoiceId` may select. */
export type WebhookInvoiceByStripeIdColumns = '*' | typeof WEBHOOK_INVOICE_LOOKUP_COLUMNS;
/** Closed set of column lists `readFieldsUnscoped` may select. */
export type WebhookInvoiceFieldColumns =
  | typeof WEBHOOK_INVOICE_RECEIPT_COLUMNS
  | typeof WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS;

export type WebhookInvoiceLookup = Pick<PaymentInvoice, 'id' | 'invoice_number' | 'user_id'>;

/** The row shape each `readFieldsUnscoped` column list returns. */
export interface WebhookInvoiceFields {
  [WEBHOOK_INVOICE_RECEIPT_COLUMNS]: Pick<
    PaymentInvoice,
    'id' | 'user_id' | 'client_email' | 'client_name' | 'invoice_number' | 'currency' | 'booking_id'
  >;
  [WEBHOOK_INVOICE_FAILED_ACTIVITY_COLUMNS]: Pick<PaymentInvoice, 'contact_id' | 'amount' | 'currency'>;
}

/** The two statuses the webhook sets on an invoice from a Stripe event, besides `paid`. */
export type WebhookInvoiceStatusFromStripe = 'overdue' | 'cancelled';

/** The Stripe-hosted documents of an invoice, as the Stripe event carries them. */
export interface WebhookInvoiceDocuments {
  hostedInvoiceUrl: string | null | undefined;
  invoicePdf: string | null | undefined;
}

/**
 * supabase-js's result, passed through unchanged (the same error object, so a
 * caller can still read `code`). Used by the webhook methods, which neither
 * catch nor log (see their section). The reused `findByStripeInvoiceId` keeps
 * `PaymentRepositoryResult` and logs errors other than PGRST116 (SA C-5).
 */
export interface WebhookInvoiceResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/** PostgREST's "no row" answer to `.single()`: a routine miss, not a fault. */
const NO_ROW_CODE = 'PGRST116';

// Invoice Repository
export class PaymentInvoiceRepository {
  private supabase: SupabaseClient;

  // Constructor injection (matches PaymentPlanRepository/Scheduling/CRM). The singleton export
  // below passes `supabaseServer`, keeping existing importers byte-compatible.
  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  async create(invoice: CreatePaymentInvoiceInput): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .insert(invoice)
        .select()
        .single();

      if (error) throw error;
      logger.info({ invoiceId: data.id }, 'Payment invoice created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create payment invoice');
      return { data: null, error: error as Error };
    }
  }

  async findById(id: string, userId: string): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find payment invoice');
      return { data: null, error: error as Error };
    }
  }

  async list(
    userId: string,
    options: {
      status?: string;
      contactId?: string;
      search?: string; // Search by invoice_number or contact name
      limit?: number;
      offset?: number;
      includeContact?: boolean;
    } = {}
  ): Promise<PaymentRepositoryResult<PaymentInvoice[]>> {
    try {
      const { status, contactId, search, limit = 50, offset = 0, includeContact = false } = options;

      // Use join to get contact info if requested
      const selectClause = includeContact
        ? '*, contact:crm_contacts(id, first_name, last_name, email)'
        : '*';

      let query = this.supabase
        .from('payment_invoices')
        .select(selectClause)
        .eq('user_id', userId);

      // A comma-separated status selects a group — 'sent,overdue' is one
      // filter over two stored statuses, not two filters.
      if (status) {
        const statuses = status.split(',').map(v => v.trim()).filter(Boolean);
        query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0]);
      }
      if (contactId) query = query.eq('contact_id', contactId);

      // Search by invoice number
      if (search) {
        const searchPattern = `%${search}%`;
        query = query.ilike('invoice_number', searchPattern);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      // Transform data to include contact_name if contact info was included
      const transformedData = (data || []).map((invoice: any) => {
        if (invoice.contact) {
          const contact = invoice.contact;
          const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.email || '';
          return {
            ...invoice,
            contact_name: contactName,
            contact: undefined // Remove nested object
          };
        }
        return invoice;
      });

      return { data: transformedData, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to list payment invoices');
      return { data: null, error: error as Error };
    }
  }

  async count(
    userId: string,
    options: {
      status?: string;
      contactId?: string;
    } = {}
  ): Promise<PaymentRepositoryResult<number>> {
    try {
      const { status, contactId } = options;

      let query = this.supabase
        .from('payment_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Same grouping rule as list(), so the total under a grouped filter
      // matches the rows it returns.
      if (status) {
        const statuses = status.split(',').map(v => v.trim()).filter(Boolean);
        query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0]);
      }
      if (contactId) query = query.eq('contact_id', contactId);

      const { count, error } = await query;
      if (error) throw error;

      return { data: count || 0, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to count payment invoices');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<PaymentInvoice>
  ): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ invoiceId: id }, 'Payment invoice updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update payment invoice');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Invoices raised for one booking.
   *
   * Call this BEFORE the booking is deleted: payment_invoices.booking_id is
   * ON DELETE SET NULL, so once the booking is gone the invoice lives on with
   * nothing pointing back at what it was for.
   */
  async findByBookingId(bookingId: string, userId: string): Promise<PaymentRepositoryResult<PaymentInvoice[]>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('booking_id', bookingId)
        .eq('user_id', userId);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, bookingId, userId }, 'Failed to find invoices for booking');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string, userId: string): Promise<PaymentRepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('payment_invoices')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ invoiceId: id }, 'Payment invoice deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete payment invoice');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The next invoice number, using the business's own prefix.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE PREFIX SETTING WAS IGNORED. This hardcoded `INV-`, so a business that
   * set `invoice_number_prefix` in its invoice settings got `INV-00007` anyway.
   * A prefix-aware generator existed beside it — `getNextInvoiceNumberWithPrefix`
   * — with ZERO callers: every path (the invoices route, the chat, the plugin
   * executor, stage billing, proposal acceptance) called this one.
   *
   * Resolved HERE rather than passed in, so all six call sites inherit it
   * without knowing it exists. A caller that has to remember to look up a
   * setting is a caller that will forget, and this is the number printed on a
   * document the business sends out.
   *
   * TWO OTHER FAULTS FIXED ON THE WAY, both of which corrupt the sequence:
   *
   *   `replace(/\D/g, '')` stripped every non-digit, so a prefix containing
   *   digits — "2026-INV", which is a perfectly ordinary thing to want — folded
   *   the year into the counter and produced numbers in the millions.
   *
   *   `order('created_at').limit(1)` took the most RECENTLY CREATED invoice, not
   *   the highest-numbered one. Backdate or import a single invoice and the
   *   sequence restarts from it, duplicating numbers already issued — which on a
   *   tax document is not a cosmetic problem.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async getNextInvoiceNumber(userId: string): Promise<PaymentRepositoryResult<string>> {
    try {
      /*
       * The business's own prefix, from its invoice settings.
       *
       * Read through `this.supabase` rather than the profile repository to avoid
       * a circular import between the two; still repository-layer code, so
       * CLAUDE.md rule 1 holds. A missing profile or an empty value falls back to
       * `INV`, which is what every existing invoice already carries.
       */
      const { data: profile } = await this.supabase
        .from('business_profiles')
        .select('invoice_number_prefix')
        .eq('user_id', userId)
        .maybeSingle();

      const prefix = (profile?.invoice_number_prefix || 'INV').trim() || 'INV';

      return this.getNextInvoiceNumberWithPrefix(userId, prefix);
    } catch (error) {
      logger.error({ err: error }, 'Failed to get next invoice number');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark an invoice as paid manually
   */
  async markAsPaid(
    invoiceId: string,
    userId: string,
    paymentDetails: {
      paymentMethod: string;
      processorType?: string;
      notes?: string;
      receivedAt?: string;
    }
  ): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      logger.info({ invoiceId, userId, method: paymentDetails.paymentMethod }, 'Marking invoice as paid');

      const { data, error } = await this.supabase
        .from('payment_invoices')
        .update({
          status: 'paid',
          paid_at: paymentDetails.receivedAt || new Date().toISOString(),
          payment_method: paymentDetails.paymentMethod,
          payment_received_at: paymentDetails.receivedAt || new Date().toISOString(),
          payment_notes: paymentDetails.notes || null,
          processor_type: paymentDetails.processorType || 'manual',
          next_retry_at: null, // Clear scheduled retry
          updated_at: new Date().toISOString()
        })
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ invoiceId }, 'Invoice marked as paid');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to mark invoice as paid');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get payable (unpaid) invoices
   */
  async getPayableInvoices(
    userId: string,
    options: { contactId?: string; limit?: number; offset?: number } = {}
  ): Promise<PaymentRepositoryResult<PaymentInvoice[]>> {
    try {
      const { contactId, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['sent', 'overdue']);

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      query = query
        .order('due_date', { ascending: true })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get payable invoices');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get invoices that need retry
   */
  async getInvoicesForRetry(userId: string): Promise<PaymentRepositoryResult<PaymentInvoice[]>> {
    try {
      const now = new Date().toISOString();

      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['sent', 'overdue'])
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', now)
        .order('next_retry_at', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get invoices for retry');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update retry info for an invoice
   */
  async updateRetryInfo(
    invoiceId: string,
    userId: string,
    retryInfo: {
      retryCount: number;
      lastRetryAt: string;
      nextRetryAt: string | null;
    }
  ): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .update({
          retry_count: retryInfo.retryCount,
          last_retry_at: retryInfo.lastRetryAt,
          next_retry_at: retryInfo.nextRetryAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId, userId }, 'Failed to update invoice retry info');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get overdue invoices.
   *
   * Generalized to serve both the AR-overdue detector and the ar_overdue_usd metric.
   * All filters default to sensible values so existing narrow use cases remain valid:
   *  - statuses:  unpaid states (defaults to pending/sent/overdue)
   *  - asOfDate:  due before this ISO timestamp (defaults to now)
   *  - minAmount: exclusive lower bound on `amount` (defaults to 0)
   *
   * Value column is `amount` (never the phantom `total_amount`). Always `user_id`-scoped.
   */
  async getOverdueInvoices(
    userId: string,
    opts?: { asOfDate?: string; statuses?: string[]; minAmount?: number }
  ): Promise<PaymentRepositoryResult<PaymentInvoice[]>> {
    try {
      const statuses = opts?.statuses ?? ['pending', 'sent', 'overdue'];
      const asOfDate = opts?.asOfDate ?? new Date().toISOString();
      const minAmount = opts?.minAmount ?? 0;

      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('user_id', userId)
        .in('status', statuses)
        .lt('due_date', asOfDate)
        .gt('amount', minAmount)
        .order('due_date', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get overdue invoices');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update overdue status for invoices past due date
   */
  async markOverdueInvoices(userId: string): Promise<PaymentRepositoryResult<number>> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await this.supabase
        .from('payment_invoices')
        .update({
          status: 'overdue',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('status', 'sent')
        /*
         * NEVER AN INVOICE WHOSE MONEY HAS MOVED.
         *
         * ─────────────────────────────────────────────────────────────────────
         * `status` alone is not enough to say an invoice is still owed — the
         * refund migration says so outright: `refund_status` is the field to
         * read, and `status` is a projection. An invoice can be paid, or paid
         * and refunded, while its status still reads `sent`, and this stamped
         * it `overdue`.
         *
         * Once it says `overdue` the invoice becomes a receivable on the
         * dashboard and a target for the chase, so the client is emailed asking
         * for money they already paid — and the Stripe link in that email shows
         * PAID, which is how it was found.
         *
         * `paid_at` and the refund fields are checked rather than inferred from
         * the status this very statement is about to overwrite.
         * ─────────────────────────────────────────────────────────────────────
         */
        .is('paid_at', null)
        .is('refunded_at', null)
        /*
         * `.eq`, NOT `.or('refund_status.is.null,refund_status.eq.none')`.
         *
         * The column is `NOT NULL DEFAULT 'none'` (20260828d), so the null arm
         * was unreachable — and `mutationOrSelect.guard` exists because an
         * `.or()` on a mutation that also asks for its rows back fails on
         * production PostgREST with 42703. That guard caught this before it
         * shipped; without it the overdue cron would have thrown on every run.
         */
        .eq('refund_status', 'none')
        .lt('due_date', today)
        .select();

      if (error) throw error;

      const count = data?.length || 0;
      if (count > 0) {
        logger.info({ userId, count }, 'Marked invoices as overdue');
      }
      return { data: count, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to mark overdue invoices');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The same sweep, for every business at once. Cron only.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * NO `user_id` FILTER, DELIBERATELY.
   *
   * "Past its due date" is a property of the invoice and the calendar, not of
   * who is looking. This is scheduled maintenance over the whole table, run by
   * the daily payment-reminders cron under the service role — there is no
   * caller whose tenancy could scope it, and scoping it would mean iterating
   * every business to issue the identical statement N times.
   *
   * It is the per-user `markOverdueInvoices` above that belongs on a request:
   * that one is the tenant-scoped version, kept for the routes that still call
   * it. This one must never be reachable from a request handler.
   * ───────────────────────────────────────────────────────────────────────────
   *
   * Idempotent — an invoice already marked no longer matches `status = 'sent'`,
   * so a second run in the same day writes nothing.
   */
  async markAllOverdueInvoices(): Promise<PaymentRepositoryResult<number>> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await this.supabase
        .from('payment_invoices')
        .update({
          status: 'overdue',
          updated_at: new Date().toISOString()
        })
        .eq('status', 'sent')
        .lt('due_date', today)
        .select('id');

      if (error) throw error;

      const count = data?.length || 0;
      logger.info({ count }, 'Swept overdue invoices across all businesses');
      return { data: count, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to sweep overdue invoices');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get invoice stats grouped by status
   */
  async getStatsByStatus(userId: string): Promise<PaymentRepositoryResult<{
    draft: { count: number; total: number };
    sent: { count: number; total: number };
    paid: { count: number; total: number };
    overdue: { count: number; total: number };
    cancelled: { count: number; total: number };
    all: { count: number; total: number };
  }>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('status, amount')
        .eq('user_id', userId);

      if (error) throw error;

      const stats = {
        draft: { count: 0, total: 0 },
        sent: { count: 0, total: 0 },
        paid: { count: 0, total: 0 },
        overdue: { count: 0, total: 0 },
        cancelled: { count: 0, total: 0 },
        all: { count: 0, total: 0 }
      };

      for (const inv of data || []) {
        const amount = Number(inv.amount) || 0;
        stats.all.count++;
        stats.all.total += amount;

        const status = inv.status as string;

        // An issued invoice counts as Sent whether or not it is also late, so
        // the Sent figure is every invoice the client has been asked to pay.
        if ((ISSUED_INVOICE_STATUSES as readonly string[]).includes(status)) {
          stats.sent.count++;
          stats.sent.total += amount;
        }

        // Overdue is a subset of the above, not a bucket beside it. Summing the
        // cards would therefore double-count these; `all` is the only total
        // that adds up.
        if (status === 'overdue') {
          stats.overdue.count++;
          stats.overdue.total += amount;
        }

        if (status === 'draft' || status === 'paid' || status === 'cancelled') {
          stats[status as 'draft' | 'paid' | 'cancelled'].count++;
          stats[status as 'draft' | 'paid' | 'cancelled'].total += amount;
        }
      }

      return { data: stats, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get invoice stats by status');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ Find invoice by Stripe invoice ID (for webhook
   * handling). Keyed by the Stripe invoice id of a signature-verified event,
   * which a business cannot choose; the webhook then checks that the sending
   * connected account owns the row (`accountOwns`) before it writes anything.
   *
   * `columns` defaults to the whole row (the `invoice.paid` lookup); the other
   * Connect invoice handlers pass `WEBHOOK_INVOICE_LOOKUP_COLUMNS` (CF-5 PR 2).
   *
   * `.single()`, so "no such invoice" is the PGRST116 error. For the webhook
   * that is a routine miss (plan invoices, invoices made directly in Stripe),
   * so it is not logged; any other error is (SA C-5 / Q-5). The error object
   * is returned either way, unchanged.
   *
   * No try/catch (CF-5 PR 2, like the webhook section below): a query that
   * REJECTS still reaches the caller, as the inline query it replaced did, so
   * the webhook answers 500 and Stripe retries instead of reading a rejection
   * as "no such invoice". supabase-js returns query errors rather than
   * throwing, so on that path nothing changes.
   */
  findByStripeInvoiceId(stripeInvoiceId: string): Promise<PaymentRepositoryResult<PaymentInvoice>>;
  findByStripeInvoiceId(
    stripeInvoiceId: string,
    columns: typeof WEBHOOK_INVOICE_LOOKUP_COLUMNS
  ): Promise<PaymentRepositoryResult<WebhookInvoiceLookup>>;
  async findByStripeInvoiceId(
    stripeInvoiceId: string,
    columns: WebhookInvoiceByStripeIdColumns = '*'
  ): Promise<PaymentRepositoryResult<PaymentInvoice | WebhookInvoiceLookup>> {
    const { data, error } = await this.supabase
      .from('payment_invoices')
      .select(columns)
      .eq('stripe_invoice_id', stripeInvoiceId)
      .single<PaymentInvoice | WebhookInvoiceLookup>();

    if (error) {
      if (error.code !== NO_ROW_CODE) {
        logger.error({ err: error, stripeInvoiceId }, 'Failed to find invoice by Stripe ID');
      }
      return { data: null, error };
    }
    return { data, error: null };
  }

  /**
   * The settlement state of one Stripe invoice id, where ABSENT IS AN ANSWER.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `findByStripeInvoiceId` above uses `.single()`, so "no such invoice" comes
   * back as an error. That is right for the webhook, which has a row in mind,
   * and wrong for the settlement gap check, whose whole purpose is to find
   * Stripe payments with NO local row: every real finding would arrive
   * indistinguishable from a database failure, and a check that cannot tell a
   * finding from a fault reports neither.
   *
   * So: `maybeSingle`, and three columns rather than the whole row, because a
   * reconciliation sweep needs no customer data to say "this is missing".
   * ───────────────────────────────────────────────────────────────────────────
   */
  async findSettlementStateByStripeInvoiceId(
    stripeInvoiceId: string
  ): Promise<PaymentRepositoryResult<{ id: string; status: string; paid_at: string | null } | null>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('id, status, paid_at')
        .eq('stripe_invoice_id', stripeInvoiceId)
        .maybeSingle();

      if (error) throw error;
      return { data: data ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, stripeInvoiceId }, 'Failed to read settlement state by Stripe invoice ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update Stripe invoice fields after invoice is finalized/sent
   */
  async updateStripeFields(
    invoiceId: string,
    userId: string,
    stripeFields: {
      stripe_invoice_id?: string;
      stripe_hosted_invoice_url?: string;
      stripe_invoice_pdf?: string;
      status?: PaymentInvoice['status'];
      sent_at?: string;
    }
  ): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .update({
          ...stripeFields,
          updated_at: new Date().toISOString()
        })
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ invoiceId, stripeFields: Object.keys(stripeFields) }, 'Updated Stripe invoice fields');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, invoiceId }, 'Failed to update Stripe invoice fields');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get next invoice number with custom prefix
   */
  async getNextInvoiceNumberWithPrefix(userId: string, prefix: string = 'INV'): Promise<PaymentRepositoryResult<string>> {
    try {
      /*
       * The prefix is USER INPUT and lands in two pattern languages.
       *
       * `%` and `_` are wildcards to `ilike`, so a prefix of `A_B` would match
       * `AxB` and pull another series' numbers into this one's maximum. `\` is
       * PostgREST's escape character for both.
       */
      const likePrefix = prefix.replace(/([\\%_])/g, '\\$1');

      /*
       * Ordered by NUMBER, not by creation date.
       *
       * `created_at desc` returned the most recently CREATED invoice, which is
       * not the highest-numbered one: import or backdate a single invoice and
       * the next number restarts from it, re-issuing numbers already sent. On a
       * tax document that is a duplicate, not a cosmetic slip. Numbers are
       * zero-padded, so lexical order matches numeric order; the scan below
       * still takes the true maximum, which covers any legacy row that is not.
       */
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('invoice_number')
        .eq('user_id', userId)
        .ilike('invoice_number', `${likePrefix}-%`)
        .order('invoice_number', { ascending: false })
        .limit(100);

      if (error) throw error;

      let maxNumber = 0;
      if (data && data.length > 0) {
        for (const invoice of data) {
          /*
           * Escaped for the regex too, and for the same reason: a prefix of
           * `INV.` would otherwise let `INVX-00003` match and poison the series.
           */
          const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = invoice.invoice_number.match(new RegExp(`^${safePrefix}-(\\d+)$`, 'i'));
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) maxNumber = num;
          }
        }
      }

      return { data: `${prefix}-${String(maxNumber + 1).padStart(5, '0')}`, error: null };
    } catch (error) {
      logger.error({ err: error, prefix }, 'Failed to get next invoice number with prefix');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create invoice with client details and optional Stripe fields
   */
  async createWithDetails(
    invoice: Omit<PaymentInvoice, 'id' | 'created_at' | 'updated_at'> & {
      client_name?: string;
      client_email?: string;
      client_address?: InvoiceAddress;
      stripe_invoice_id?: string;
    }
  ): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .insert({
          ...invoice,
          client_address: invoice.client_address || {}
        })
        .select()
        .single();

      if (error) throw error;
      logger.info({
        invoiceId: data.id,
        hasStripeId: !!invoice.stripe_invoice_id,
        clientEmail: invoice.client_email
      }, 'Payment invoice created with details');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create payment invoice with details');
      return { data: null, error: error as Error };
    }
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Moved out of `app/api/stripe/webhook/route.ts` with no behaviour change
  // (CF-5 PR 2, CLAUDE.md rule 1). Each method issues exactly the query the
  // route issued inline: same table, operation, columns, payload keys in the
  // same order, filter and terminal. The webhook's characterisation harness
  // records the full chain, so a method that drifted would fail its snapshot.
  //
  // No `user_id` filter, as an exception to rule 4, bounded per
  // docs/REPOSITORY_STRATEGY.md ("unscoped by design"): each doc below names the
  // owner check it relies on instead. A unit test asserts none adds one.
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, as in `ProcessedWebhookEventRepository`. The route logs every error
  // it acts on with the correlation and Stripe event ids; a catch here would
  // turn a thrown query into a quiet miss where the route used to fail and let
  // Stripe retry.

  /**
   * ⟨unscoped-by-design⟩ The whole invoice row by our own id, `.single()`.
   *
   * The id comes from metadata the CONNECTED ACCOUNT writes, so it proves
   * nothing. Owner check relied on: every caller compares the row's `user_id`
   * with the sending account's owner (`accountOwns`) before anything is written
   * (Fix-1, F-1).
   */
  async findByIdUnscoped(id: string): Promise<WebhookInvoiceResult<PaymentInvoice>> {
    const { data, error } = await this.supabase
      .from('payment_invoices')
      .select('*')
      .eq('id', id)
      .single<PaymentInvoice>();
    return { data, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Records the Stripe invoice id on our invoice, for
   * later lookups by Stripe id. Owner check relied on: the route has already
   * proved the sending account owns this row (`accountOwns`, moved ahead of
   * this write by Fix-1). Without that order, this write is how F-1 planted a
   * Stripe id on another business's invoice.
   */
  async recordStripeInvoiceId(id: string, stripeInvoiceId: string): Promise<WebhookInvoiceResult<null>> {
    const { error } = await this.supabase
      .from('payment_invoices')
      .update({
        stripe_invoice_id: stripeInvoiceId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ `invoice.paid`: marks the invoice paid and stores the
   * Stripe-hosted page and PDF. `paidAt` is the caller's, because the same
   * instant is written on the payment row. Owner check relied on: the row was
   * proved owned (`accountOwns`) before the payment row was written.
   *
   * Never touches `booking_id` (`noBookingGuess.guard`).
   */
  async markPaidFromStripeInvoice(
    id: string,
    paid: { paidAt: string } & WebhookInvoiceDocuments
  ): Promise<WebhookInvoiceResult<null>> {
    const { error } = await this.supabase
      .from('payment_invoices')
      .update({
        status: 'paid',
        paid_at: paid.paidAt,
        stripe_hosted_invoice_url: paid.hostedInvoiceUrl,
        stripe_invoice_pdf: paid.invoicePdf,
        updated_at: paid.paidAt,
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Connect `checkout.session.completed` for an invoice:
   * marks it paid. `paidAt` is the caller's (shared with the payment row).
   * Owner check relied on: the row was proved owned (`accountOwns`) right after
   * it was read.
   */
  async markPaidFromCheckout(id: string, paidAt: string): Promise<WebhookInvoiceResult<null>> {
    const { error } = await this.supabase
      .from('payment_invoices')
      .update({
        status: 'paid',
        paid_at: paidAt,
        updated_at: paidAt,
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ Mirrors a Stripe invoice state onto ours:
   * `invoice.payment_failed` → `overdue`, `invoice.marked_uncollectible` →
   * `cancelled`. Owner check relied on: the row was found by the event's Stripe
   * invoice id and proved owned (`accountOwns`, Fix-1).
   */
  async setStatusFromStripe(
    id: string,
    status: WebhookInvoiceStatusFromStripe
  ): Promise<WebhookInvoiceResult<null>> {
    const { error } = await this.supabase
      .from('payment_invoices')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ `invoice.finalized`: stores the Stripe-hosted page and
   * PDF. Owner check relied on: the row was found by the event's Stripe invoice
   * id and proved owned (`accountOwns`, Fix-1), so one business cannot replace
   * another's payment link.
   */
  async recordStripeDocuments(
    id: string,
    documents: WebhookInvoiceDocuments
  ): Promise<WebhookInvoiceResult<null>> {
    const { error } = await this.supabase
      .from('payment_invoices')
      .update({
        stripe_hosted_invoice_url: documents.hostedInvoiceUrl,
        stripe_invoice_pdf: documents.invoicePdf,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { data: null, error };
  }

  /**
   * ⟨unscoped-by-design⟩ A fixed column list of one invoice, `.maybeSingle()`:
   * the receipt fields (`invoice.paid`) or the failed-payment activity fields
   * (`invoice.payment_failed`). Owner check relied on: the row was proved owned
   * (`accountOwns`) earlier in the same handler.
   */
  async readFieldsUnscoped<C extends WebhookInvoiceFieldColumns>(
    id: string,
    columns: C
  ): Promise<WebhookInvoiceResult<WebhookInvoiceFields[C]>> {
    const { data, error } = await this.supabase
      .from('payment_invoices')
      .select(columns)
      .eq('id', id)
      .maybeSingle<WebhookInvoiceFields[C]>();
    return { data, error };
  }
}

// Stripe Connect Repository
export class StripeConnectRepository {
  private supabase: SupabaseClient;

  // Constructor injection (matches PaymentPlanRepository/Scheduling/CRM). The singleton export
  // below passes `supabaseServer`, keeping existing importers byte-compatible.
  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  async create(account: Omit<StripeConnectAccount, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentRepositoryResult<StripeConnectAccount>> {
    try {
      const { data, error } = await this.supabase
        .from('stripe_connect_accounts')
        .insert(account)
        .select()
        .single();

      if (error) throw error;
      logger.info({ accountId: data.id }, 'Stripe Connect account created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create Stripe Connect account');
      return { data: null, error: error as Error };
    }
  }

  async findByUserId(userId: string): Promise<PaymentRepositoryResult<StripeConnectAccount>> {
    try {
      const { data, error } = await this.supabase
        .from('stripe_connect_accounts')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(); // Use maybeSingle instead of single to avoid error on no rows

      if (error) throw error;
      // data will be null if no row found, which is valid (not an error)
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find Stripe Connect account');
      return { data: null, error: error as Error };
    }
  }

  async update(
    userId: string,
    updates: Partial<StripeConnectAccount>
  ): Promise<PaymentRepositoryResult<StripeConnectAccount>> {
    try {
      const { data, error } = await this.supabase
        .from('stripe_connect_accounts')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ userId }, 'Stripe Connect account updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update Stripe Connect account');
      return { data: null, error: error as Error };
    }
  }

  async delete(
    id: string,
    userId: string
  ): Promise<PaymentRepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('stripe_connect_accounts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ id, userId }, 'Stripe Connect account deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to delete Stripe Connect account');
      return { data: null, error: error as Error };
    }
  }

  /**
   * One page of connected accounts, across every business (keyset by user id).
   *
   * ───────────────────────────────────────────────────────────────────────────
   * DELIBERATELY NOT USER-SCOPED (CLAUDE.md rule 4). The settlement gap check
   * has to ask every connected account whether Stripe took money we never
   * recorded; an answer for one business cannot establish that. The caller is
   * the fail-closed cron (`/api/cron/stripe-settlement-gap`), which no user can
   * reach, and the read returns no money and no customer data: an account id
   * and the user it belongs to, so a finding can name the business.
   *
   * Keyset rather than offset so a page cannot skip or repeat a row while the
   * sweep is running, matching `pagePlans` in the credit leak check.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async pageAccounts(params: {
    afterUserId: string | null;
    limit: number;
  }): Promise<PaymentRepositoryResult<Array<Pick<StripeConnectAccount, 'user_id' | 'stripe_account_id'>>>> {
    try {
      let query = this.supabase
        .from('stripe_connect_accounts')
        .select('user_id, stripe_account_id')
        .order('user_id', { ascending: true })
        .limit(params.limit);

      if (params.afterUserId) query = query.gt('user_id', params.afterUserId);

      const { data, error } = await query;
      if (error) throw error;
      return { data: data ?? [], error: null };
    } catch (error) {
      logger.error({ err: error, afterUserId: params.afterUserId }, 'Failed to page Stripe Connect accounts');
      return { data: null, error: error as Error };
    }
  }

  // Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)
  //
  // Moved out of `lib/payments/stripeAccountContext.ts` (`resolveAccountOwner`)
  // with no behaviour change (CF-5 PR 5, FU-5 SA rule-1 ruling). It issues
  // exactly the read the resolver issued inline, on the client the resolver was
  // handed.
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, unlike the methods above. The resolver turns a returned error into
  // its own throw (FU-5: a failed read must never read as "no business"), and a
  // rejected query must still reach the webhook, which answers 500 so Stripe
  // retries.

  /**
   * ⟨unscoped-by-design⟩ The business that owns a connected account, by its
   * Stripe account id, or `null` when no Express row names it.
   *
   * Owner check relied on: none can apply, because the owner is the OUTPUT.
   * This is the inverse lookup `accountOwns` is built on: the id is the
   * `event.account` of a signature-verified Connect event, which a business
   * cannot choose, and only `user_id` is returned. Do not reuse it for a
   * caller-supplied account id.
   */
  async findOwnerIdByStripeAccountId(stripeAccountId: string): Promise<StripeConnectOwnerResult> {
    const { data, error } = await this.supabase
      .from('stripe_connect_accounts')
      .select('user_id')
      .eq('stripe_account_id', stripeAccountId)
      .maybeSingle<{ user_id: string }>();
    return { data, error };
  }
}

/** supabase-js's own result for `findOwnerIdByStripeAccountId`, error object kept. */
export interface StripeConnectOwnerResult {
  data: { user_id: string } | null;
  error: PostgrestError | null;
}

// Singleton exports
export const paymentTransactionRepository = new PaymentTransactionRepository();
export const paymentInvoiceRepository = new PaymentInvoiceRepository();
export const stripeConnectRepository = new StripeConnectRepository();
