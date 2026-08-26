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
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
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
  private supabase = supabaseServer;

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

  async getTotalRevenue(userId: string, startDate?: string, endDate?: string): Promise<PaymentRepositoryResult<number>> {
    try {
      let query = this.supabase
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('status', 'succeeded');

      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);

      const { data, error } = await query;
      if (error) throw error;

      const total = data?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;
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

// Invoice Repository
export class PaymentInvoiceRepository {
  private supabase = supabaseServer;

  async create(invoice: Omit<PaymentInvoice, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentRepositoryResult<PaymentInvoice>> {
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

      if (status) query = query.eq('status', status);
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

      if (status) query = query.eq('status', status);
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
   * Get overdue invoices
   */
  async getOverdueInvoices(userId: string): Promise<PaymentRepositoryResult<PaymentInvoice[]>> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await this.supabase
        .from('payment_invoices')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'sent')
        .lt('due_date', today)
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

        const status = inv.status as keyof typeof stats;
        if (stats[status]) {
          stats[status].count++;
          stats[status].total += amount;
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
  private supabase;

  constructor(supabaseClient = supabaseServer) {
    this.supabase = supabaseClient;
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
