/**
 * Voiding and deleting an invoice — including at the processor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BOTH VERBS LIVE TOGETHER
 *
 * They share the only rule that really matters: NEITHER may touch an invoice
 * that has been paid. Voiding one tells the client it no longer applies, which
 * is a lie once they have paid it; deleting one leaves a transaction pointing at
 * a document that no longer exists.
 *
 * And they share a step the local row cannot express. An invoice raised through
 * Stripe has a hosted payment page of its own, and that page keeps working after
 * the row is gone. `DELETE /api/payments/invoices/[id]` did not void at Stripe —
 * so a deleted invoice stayed payable, and money could arrive for a document the
 * business had thrown away. The booking-delete path had this right; the invoice
 * path did not, and the chat was about to inherit the gap.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/invoiceLifecycle
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  paymentInvoiceRepository,
  stripeConnectRepository,
  type PaymentInvoice,
} from '@/lib/repositories/PaymentRepository';
import { isSettledInvoice } from '@/lib/payments/invoiceSettlement';

const logger = createLogger({ module: 'InvoiceLifecycle' });
const auditTrail = AuditTrailService.getInstance();

/** Raised when the invoice has been paid, which forbids both verbs. */
export class InvoiceSettledError extends Error {
  constructor(
    readonly invoice: PaymentInvoice,
    verb: 'voided' | 'deleted'
  ) {
    super(
      `Invoice ${invoice.invoice_number} has already been paid and cannot be ${verb}. ` +
        `Refund the payment first.`
    );
    this.name = 'InvoiceSettledError';
  }
}

/**
 * Stop the invoice being payable at the processor.
 *
 * Best effort by design: an invoice that is already void, already paid, or was
 * never finalized will be rejected by Stripe, and none of those should stop the
 * local change. Losing the void is worth a warning; refusing the whole operation
 * because of it is not.
 */
async function voidAtProcessor(invoice: PaymentInvoice, userId: string): Promise<boolean> {
  if (!invoice.stripe_invoice_id) return false;

  try {
    const account = await stripeConnectRepository.findByUserId(userId);
    const connectAccountId = account.data?.stripe_account_id;

    if (!connectAccountId) {
      logger.warn(
        { invoiceId: invoice.id, stripeInvoiceId: invoice.stripe_invoice_id },
        'No Stripe account to void the invoice through'
      );
      return false;
    }

    const { getStripeInvoiceService } = await import('@/lib/stripe/StripeInvoiceService');
    await getStripeInvoiceService().voidInvoice(invoice.stripe_invoice_id, connectAccountId);
    return true;
  } catch (err) {
    logger.warn(
      { err, invoiceId: invoice.id, stripeInvoiceId: invoice.stripe_invoice_id },
      'Failed to void invoice at Stripe; continuing with the local change'
    );
    return false;
  }
}

export interface InvoiceLifecycleParams {
  invoiceId: string;
  userId: string;
  request?: NextRequest;
}

export interface InvoiceLifecycleOutcome {
  invoiceId: string;
  invoiceNumber: string;
  voidedAtProcessor: boolean;
}

/** Load the invoice and refuse if it has been paid. */
async function loadUnsettled(
  invoiceId: string,
  userId: string,
  verb: 'voided' | 'deleted'
): Promise<{ invoice: PaymentInvoice | null; error: Error | null }> {
  const { data, error } = await paymentInvoiceRepository.findById(invoiceId, userId);

  if (error) return { invoice: null, error: error as Error };
  if (!data) return { invoice: null, error: new Error('Invoice not found') };
  if (isSettledInvoice(data)) return { invoice: null, error: new InvoiceSettledError(data, verb) };

  return { invoice: data, error: null };
}

/**
 * Cancel an invoice: it stands as a record, but stops being owed or payable.
 *
 * Preferred over deleting. The client may already have it in their inbox, and a
 * cancelled invoice they can look up explains itself where a missing one does not.
 */
export async function voidInvoice(
  params: InvoiceLifecycleParams
): Promise<{ data: InvoiceLifecycleOutcome | null; error: Error | null }> {
  const { invoiceId, userId, request } = params;

  const { invoice, error } = await loadUnsettled(invoiceId, userId, 'voided');
  if (error || !invoice) return { data: null, error };

  const voidedAtProcessor = await voidAtProcessor(invoice, userId);

  const { error: updateError } = await paymentInvoiceRepository.update(invoiceId, userId, {
    status: 'cancelled',
  });
  if (updateError) return { data: null, error: updateError as Error };

  auditTrail
    .log({
      action: 'PAYMENT_INVOICE_VOIDED',
      entityType: 'payment_invoice',
      entityId: invoiceId,
      userId,
      resourceName: invoice.invoice_number,
      details: { voidedAtProcessor },
      severity: 'warning',
      request,
    })
    .catch((err) => logger.warn({ err, invoiceId }, 'Audit failed (non-blocking)'));

  logger.info({ userId, invoiceId, voidedAtProcessor }, 'Invoice voided');

  return {
    data: { invoiceId, invoiceNumber: invoice.invoice_number, voidedAtProcessor },
    error: null,
  };
}

/** Remove the invoice entirely, after making sure nobody can still pay it. */
export async function deleteInvoice(
  params: InvoiceLifecycleParams
): Promise<{ data: InvoiceLifecycleOutcome | null; error: Error | null }> {
  const { invoiceId, userId, request } = params;

  const { invoice, error } = await loadUnsettled(invoiceId, userId, 'deleted');
  if (error || !invoice) return { data: null, error };

  // BEFORE the row goes. Afterwards there is nothing left to read the Stripe id
  // from, and the hosted page would stay payable forever.
  const voidedAtProcessor = await voidAtProcessor(invoice, userId);

  const { error: deleteError } = await paymentInvoiceRepository.delete(invoiceId, userId);
  if (deleteError) return { data: null, error: deleteError as Error };

  auditTrail
    .log({
      action: 'PAYMENT_INVOICE_DELETED',
      entityType: 'payment_invoice',
      entityId: invoiceId,
      userId,
      resourceName: invoice.invoice_number,
      details: { voidedAtProcessor },
      severity: 'warning',
      request,
    })
    .catch((err) => logger.warn({ err, invoiceId }, 'Audit failed (non-blocking)'));

  logger.info({ userId, invoiceId, voidedAtProcessor }, 'Invoice deleted');

  return {
    data: { invoiceId, invoiceNumber: invoice.invoice_number, voidedAtProcessor },
    error: null,
  };
}
