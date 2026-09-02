import { SupabaseClient } from '@supabase/supabase-js';
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
  currency: string;
  business_type: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentRepositoryResult<T> = {
  data: T | null;
  error: Error | null;
};

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

  async getNextInvoiceNumber(userId: string): Promise<PaymentRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('invoice_number')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const lastNumber = parseInt(data[0].invoice_number.replace(/\D/g, '')) || 0;
        return { data: `INV-${String(lastNumber + 1).padStart(5, '0')}`, error: null };
      }

      return { data: 'INV-00001', error: null };
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
   * Find invoice by Stripe invoice ID (for webhook handling)
   */
  async findByStripeInvoiceId(stripeInvoiceId: string): Promise<PaymentRepositoryResult<PaymentInvoice>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('stripe_invoice_id', stripeInvoiceId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, stripeInvoiceId }, 'Failed to find invoice by Stripe ID');
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
      // Get all invoices with this prefix to find the highest number
      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('invoice_number')
        .eq('user_id', userId)
        .ilike('invoice_number', `${prefix}-%`)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      let maxNumber = 0;
      if (data && data.length > 0) {
        for (const invoice of data) {
          const match = invoice.invoice_number.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
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
}

// Singleton exports
export const paymentTransactionRepository = new PaymentTransactionRepository();
export const paymentInvoiceRepository = new PaymentInvoiceRepository();
export const stripeConnectRepository = new StripeConnectRepository();
