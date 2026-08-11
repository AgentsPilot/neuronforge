// lib/server/payments-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import {
  paymentInvoiceRepository,
  paymentTransactionRepository,
  type PaymentInvoice,
} from '@/lib/repositories/PaymentRepository';
import {
  paymentPlanRepository,
  type PaymentPlanInsert,
  type PaymentPlanUpdate,
  type InstallmentFrequency,
} from '@/lib/repositories/PaymentPlanRepository';
// READ-ONLY ownership check ONLY (M1). The delegate-only guardrail forbids the executor from
// WRITING crm_activities — the T3 trigger owns that on the succeeded-transaction path. A tenant
// ownership pre-check is a pure read; routing it through the repository (rather than a raw
// Supabase query) satisfies the mandatory repository pattern. We never create/update CRM rows here.
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';

const pluginName = 'payments';

type PaymentInvoiceInsert = Omit<PaymentInvoice, 'id' | 'created_at' | 'updated_at'>;

/**
 * Internal Payments plugin executor.
 *
 * Repository-backed: every operation delegates to the payment repositories
 * (`paymentInvoiceRepository` / `paymentTransactionRepository` / `paymentPlanRepository`), the sole
 * data path for the four wrapped payment tables. No external API and no OAuth — gated by the
 * `db_active` access strategy, so `connection.user_id` is a verified BOS tenant by the time an
 * action runs.
 *
 * GUARDRAILS:
 * - **Never moves money.** DB-record operations only. Charging / checkout / card refunds / Stripe
 *   Connect stay external leaves behind the existing Stripe flow — never invoked here.
 * - **Triggers own side-effects (delegate-only).** On a `succeeded` transaction, T3
 *   (`log_payment_activity`) inserts the `crm_activities` payment row (only when `contact_id` is set)
 *   and T4 (`update_invoice_on_payment`) flips the linked invoice to `paid`. The executor delegates
 *   and returns — it never re-emits a CRM activity nor manually sets an invoice `paid`.
 * - **M1 tenant-ownership pre-check.** T4's UPDATE is NOT `user_id`-scoped, so before recording a
 *   manual payment the executor verifies a caller-supplied `invoice_id` (and `contact_id`) belongs
 *   to the tenant — otherwise a caller could flip another tenant's invoice to `paid`.
 *
 * Accounting model: `record_manual_payment` is the canonical REVENUE-BEARING "payment received"
 * path (writes a transaction → T3/T4 → counts in `get_revenue`). `mark_invoice_paid` /
 * `mark_installment_paid` are STATUS-ONLY reconciliation ops — no transaction, no trigger, not
 * counted in revenue.
 */
export class PaymentsPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    const userId: string | undefined = connection?.user_id;
    if (!userId) {
      throw new Error('access_denied: missing user context for Payments operation');
    }
    const params = parameters || {};

    switch (actionName) {
      // ---------------- INVOICES ----------------
      case 'create_invoice': {
        this.requireParam(params.amount, 'amount');
        // Repo `invoice_number` is NOT NULL — generate it before create (mirrors SafeExecutionLayer).
        const numberResult = await paymentInvoiceRepository.getNextInvoiceNumber(userId);
        if (numberResult.error || !numberResult.data) {
          throw new Error('Failed to generate invoice number');
        }
        return this.unwrap(
          await paymentInvoiceRepository.create(this.buildInvoiceInsert(userId, numberResult.data, params))
        );
      }

      case 'list_invoices':
        return this.unwrap(
          await paymentInvoiceRepository.list(userId, {
            status: params.status,
            contactId: params.contact_id,
            search: params.search,
            includeContact: params.include_contact === true,
            limit: params.limit,
            offset: params.offset,
          })
        );

      case 'get_invoice':
        this.requireParam(params.id, 'id');
        return this.unwrap(await paymentInvoiceRepository.findById(params.id, userId));

      case 'update_invoice':
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await paymentInvoiceRepository.update(params.id, userId, this.buildInvoiceUpdate(params))
        );

      case 'send_invoice':
        // Status-only (status→sent). No email dispatch — delivery is an external leaf.
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await paymentInvoiceRepository.update(params.id, userId, {
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
        );

      case 'cancel_invoice':
        // Financial records are never hard-deleted — cancel only (status→cancelled).
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await paymentInvoiceRepository.update(params.id, userId, { status: 'cancelled' })
        );

      case 'mark_invoice_paid':
        // STATUS-ONLY (M2): no transaction, no trigger, NOT counted in revenue. Use
        // record_manual_payment for a real payment received.
        this.requireParam(params.id, 'id');
        this.requireParam(params.payment_method, 'payment_method');
        return this.unwrap(
          await paymentInvoiceRepository.markAsPaid(params.id, userId, {
            paymentMethod: params.payment_method,
            processorType: params.processor_type,
            notes: params.notes,
            receivedAt: params.received_at,
          })
        );

      case 'count_invoices':
        return this.unwrap(await paymentInvoiceRepository.count(userId, { status: params.status }));

      // ---------------- TRANSACTIONS ----------------
      case 'list_transactions':
        return this.unwrap(
          await paymentTransactionRepository.list(userId, {
            status: params.status,
            contactId: params.contact_id,
            limit: params.limit,
            offset: params.offset,
          })
        );

      case 'get_transaction':
        this.requireParam(params.id, 'id');
        return this.unwrap(await paymentTransactionRepository.findById(params.id, userId));

      case 'record_manual_payment':
        return this.recordManualPayment(userId, params);

      case 'create_refund_record': {
        // DB refund RECORD only — no processor call. M6: a partial refund keeps status 'succeeded'
        // (T4 harmlessly re-marks the already-paid invoice); a full refund sets 'refunded' (no trigger).
        this.requireParam(params.transaction_id, 'transaction_id');
        this.requireParam(params.amount, 'amount');
        return this.unwrap(
          await paymentTransactionRepository.createRefund(params.transaction_id, userId, {
            amount: params.amount,
            reason: params.reason,
            processorRefundId: params.processor_refund_id,
            isFullRefund: params.is_full_refund === true,
          })
        );
      }

      case 'get_revenue':
        return this.unwrap(
          await paymentTransactionRepository.getTotalRevenue(userId, params.start_date, params.end_date)
        );

      // ---------------- PLANS ----------------
      case 'create_plan':
        this.requireParam(params.name, 'name');
        this.requireParam(params.total_amount, 'total_amount');
        this.requireParam(params.currency, 'currency');
        this.requireParam(params.installment_count, 'installment_count');
        this.requireParam(params.installment_amount, 'installment_amount');
        this.requireParam(params.installment_frequency, 'installment_frequency');
        return this.unwrap(await paymentPlanRepository.create(this.buildPlanInsert(userId, params)));

      case 'list_plans':
        return this.unwrap(
          await paymentPlanRepository.list(userId, {
            serviceId: params.service_id,
            isActive: params.is_active,
            currency: params.currency,
            limit: params.limit,
            offset: params.offset,
          })
        );

      case 'get_plan':
        this.requireParam(params.id, 'id');
        return this.unwrap(await paymentPlanRepository.findById(params.id, userId));

      case 'update_plan':
        this.requireParam(params.id, 'id');
        return this.unwrap(
          await paymentPlanRepository.update(params.id, userId, this.buildPlanUpdate(params))
        );

      case 'deactivate_plan':
        // Soft delete (is_active→false); the plan record is retained.
        this.requireParam(params.id, 'id');
        return this.unwrap(await paymentPlanRepository.delete(params.id, userId));

      case 'create_installments':
        this.requireParam(params.plan_id, 'plan_id');
        this.requireParam(params.contact_id, 'contact_id');
        this.requireParam(params.start_date, 'start_date');
        return this.unwrap(
          await paymentPlanRepository.createInstallmentsForBooking(
            params.plan_id,
            userId,
            params.contact_id,
            params.start_date,
            {
              bookingId: params.booking_id,
              currency: params.currency,
              customAmount: params.custom_amount,
            }
          )
        );

      case 'list_installments':
        this.requireParam(params.plan_id, 'plan_id');
        return this.unwrap(
          await paymentPlanRepository.getInstallments(params.plan_id, userId, {
            contactId: params.contact_id,
            bookingId: params.booking_id,
            status: params.status,
          })
        );

      case 'mark_installment_paid':
        // STATUS-ONLY (same family as mark_invoice_paid): no transaction written. Link a
        // transaction_id from record_manual_payment for the revenue-bearing record.
        this.requireParam(params.installment_id, 'installment_id');
        this.requireParam(params.payment_method, 'payment_method');
        return this.unwrap(
          await paymentPlanRepository.markInstallmentPaid(params.installment_id, userId, {
            paymentMethod: params.payment_method,
            processorType: params.processor_type,
            transactionId: params.transaction_id,
          })
        );

      case 'cancel_installments':
        this.requireParam(params.plan_id, 'plan_id');
        this.requireParam(params.contact_id, 'contact_id');
        return this.unwrap(
          await paymentPlanRepository.cancelInstallments(params.plan_id, params.contact_id, userId)
        );

      case 'get_plan_summary':
        this.requireParam(params.plan_id, 'plan_id');
        this.requireParam(params.contact_id, 'contact_id');
        return this.unwrap(
          await paymentPlanRepository.getPlanSummaryForContact(params.plan_id, params.contact_id, userId)
        );

      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /** Internal plugins hold no token — trivial active status. */
  protected async performConnectionTest(connection: any): Promise<any> {
    return { status: 'active', internal: true, user_id: connection?.user_id };
  }

  // ---------------- record_manual_payment (M1 ownership guard + delegate-only) ----------------

  /**
   * Record a manual/external payment as a succeeded transaction.
   *
   * M1 (load-bearing): T4's `UPDATE payment_invoices … WHERE id = NEW.invoice_id` is NOT
   * `user_id`-scoped, and `recordManualPayment` trusts a caller-supplied `invoiceId`. Without the
   * pre-check a caller could flip ANOTHER tenant's invoice to `paid`. So verify ownership of a
   * supplied `invoice_id` (and `contact_id`, defense-in-depth against a dangling cross-tenant
   * `crm_activities` reference from T3) BEFORE delegating. A not-found row (or lookup error) → deny.
   *
   * Delegate-only: after the guard we call `recordManualPayment` and RETURN — T3 logs the CRM
   * activity and T4 flips the invoice; the executor never does either itself.
   */
  private async recordManualPayment(userId: string, params: any): Promise<any> {
    this.requireParam(params.amount, 'amount');
    this.requireParam(params.payment_method, 'payment_method');

    if (params.invoice_id) {
      const invoice = await paymentInvoiceRepository.findById(params.invoice_id, userId);
      if (invoice.error || !invoice.data) {
        throw new Error('access_denied: invoice does not belong to this account');
      }
    }

    if (params.contact_id) {
      const contact = await crmContactRepository.findById(params.contact_id, userId);
      if (contact.error || !contact.data) {
        throw new Error('access_denied: contact does not belong to this account');
      }
    }

    return this.unwrap(
      await paymentTransactionRepository.recordManualPayment(userId, {
        amount: params.amount,
        currency: params.currency || 'ILS',
        paymentMethod: params.payment_method,
        invoiceId: params.invoice_id,
        contactId: params.contact_id,
        description: params.description,
        notes: params.notes,
        receivedAt: params.received_at,
      })
    );
  }

  // ---------------- helpers ----------------

  private unwrap<T>(result: { data: T | null; error: Error | null }): T | null {
    if (result.error) throw result.error;
    return result.data;
  }

  private requireParam(value: unknown, name: string): void {
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }

  private buildInvoiceInsert(userId: string, invoiceNumber: string, params: any): PaymentInvoiceInsert {
    const amount: number = params.amount;
    const rawItems = Array.isArray(params.line_items) ? params.line_items : [];
    const lineItems =
      rawItems.length > 0
        ? rawItems.map((item: any) => ({
            description: item.description,
            quantity: item.quantity ?? 1,
            unit_price: item.unit_price,
            total: item.total ?? (item.quantity ?? 1) * item.unit_price,
          }))
        : [{ description: params.description || 'Services', quantity: 1, unit_price: amount, total: amount }];

    return {
      user_id: userId,
      contact_id: params.contact_id || null,
      invoice_number: invoiceNumber,
      amount,
      currency: params.currency || 'ILS',
      status: 'draft',
      line_items: lineItems,
      due_date: params.due_date || null,
      payment_terms: params.payment_terms || 'due_on_receipt',
      notes: params.notes || null,
      internal_notes: params.internal_notes || null,
      sent_at: null,
      paid_at: null,
      payment_method: null,
      payment_received_at: null,
      payment_notes: null,
      processor_type: null,
      processor_checkout_id: null,
      processor_payment_id: null,
      processor_customer_id: null,
      processor_payment_method_id: null,
      retry_count: 0,
      last_retry_at: null,
      next_retry_at: null,
    };
  }

  private buildInvoiceUpdate(params: any): Partial<PaymentInvoice> {
    const update: Partial<PaymentInvoice> = {};
    for (const key of ['status', 'amount', 'due_date', 'notes', 'internal_notes'] as const) {
      if (params[key] !== undefined) (update as any)[key] = params[key];
    }
    return update;
  }

  private buildPlanInsert(userId: string, params: any): PaymentPlanInsert {
    const insert: PaymentPlanInsert = {
      user_id: userId,
      name: params.name,
      total_amount: params.total_amount,
      currency: params.currency,
      installment_count: params.installment_count,
      installment_amount: params.installment_amount,
      installment_frequency: params.installment_frequency as InstallmentFrequency,
    };
    for (const key of ['service_id', 'description', 'supported_currencies', 'allowed_processors', 'preferred_processor', 'is_active'] as const) {
      if (params[key] !== undefined) (insert as any)[key] = params[key];
    }
    return insert;
  }

  private buildPlanUpdate(params: any): PaymentPlanUpdate {
    const update: PaymentPlanUpdate = {};
    for (const key of ['name', 'description', 'total_amount', 'currency', 'installment_count', 'installment_amount', 'installment_frequency', 'supported_currencies', 'allowed_processors', 'preferred_processor', 'is_active'] as const) {
      if (params[key] !== undefined) (update as any)[key] = params[key];
    }
    return update;
  }
}
