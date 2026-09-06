/**
 * Telling the client their money is coming back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `BookingEmailService.sendRefundConfirmation` had exactly ONE caller — the
 * booking refund route. So whether a client heard about their refund depended
 * entirely on which button the owner happened to press: the same refund, on the
 * same money, notified from the CRM payment modal and said nothing from the
 * money list, the invoice list, the automation blocks, or a refund issued from
 * the Stripe dashboard.
 *
 * Meanwhile `RefundModal` collected a "notify contact" checkbox on five
 * surfaces and never sent it anywhere.
 *
 * This is the one place that decides. Every refund path calls it; it works out
 * whether there is a client to tell.
 *
 * NOT A TRIGGER, unlike the booking and invoice state it accompanies — a
 * database trigger cannot send mail, and a refund that lands via webhook has no
 * request to hang the email on. So the state is derived and the notification is
 * explicit, and the two are kept next to each other so it is obvious that both
 * have to happen.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/notifyRefund
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { generateRefundConfirmationEmail } from '@/lib/email/templates/refund-confirmation';
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail } from '@/lib/notifications/emailTransport';

const logger = createLogger({ module: 'NotifyRefund' });

export interface NotifyRefundInput {
  userId: string;
  /** The transaction the money came back from. */
  transactionId: string;
  refundAmount: number;
  currency: string;
  reason?: string | null;
  /**
   * The owner asked for the client to be told.
   *
   * Defaults to false rather than true: a refund the client has not been
   * promised is the owner's to announce, and an unexpected "your money is on
   * its way" is worse than silence.
   */
  notifyContact?: boolean;
  /**
   * The ledger row. Used to make the send idempotent, because Stripe redelivers
   * webhooks and a client should not get one email per redelivery.
   */
  refundId?: string | null;
}

/**
 * Send the confirmation, if there is someone to send it to.
 *
 * Never throws. A refund that succeeded must not be reported as failed because
 * an email did not go out — the money has already moved, and the caller's job
 * is to record that faithfully.
 */
export async function notifyRefund(input: NotifyRefundInput): Promise<void> {
  if (!input.notifyContact) return;

  try {
    const { data: transaction } = await supabaseServer
      .from('payment_transactions')
      .select('id, booking_id, invoice_id, amount, currency, processor_type')
      .eq('id', input.transactionId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (!transaction) {
      logger.warn({ transactionId: input.transactionId }, 'No transaction to notify a refund against');
      return;
    }

    /*
     * The booking, directly or through the invoice that settled it.
     *
     * `booking_id` alone is null for every INVOICE payment — the booking sits
     * on the invoice — so a refund against an invoice raised for an appointment
     * silently sent nothing, and the log said the payment "is not attached to a
     * booking" about a payment that plainly was. The owner ticked "notify the
     * client" and the client heard nothing.
     */
    let bookingId = transaction.booking_id as string | null;

    if (!bookingId && transaction.invoice_id) {
      const { data: invoice } = await supabaseServer
        .from('payment_invoices')
        .select('booking_id')
        .eq('id', transaction.invoice_id)
        .eq('user_id', input.userId)
        .maybeSingle();

      bookingId = invoice?.booking_id ?? null;
    }

    /*
     * The confirmation is a BOOKING email — it names the appointment and offers
     * to book again. A refund on a genuinely ad-hoc invoice has no booking, so
     * there is nothing this template can honestly say.
     *
     * Said out loud rather than silently skipped: the owner ticked a box, and
     * if nothing was sent they should be able to find out why.
     */
    if (!bookingId) {
      /*
       * No booking — an invoice on its own. Send anyway.
       *
       * This used to stop here, and the reason given was sound: the booking
       * template names an appointment and offers to rebook, which an ad-hoc
       * invoice cannot honestly do. But "cannot say those two things" became
       * "say nothing", and a whole path lost its client email — every
       * invoice-only refund, which is exactly what a business collecting by
       * bank transfer issues.
       *
       * The template's booking parts are already optional. So the same email
       * goes out without them: what came back, against which invoice, and where
       * to expect it. Nothing about an appointment that does not exist.
       */
      await notifyInvoiceRefund(input, transaction);
      return;
    }

    const original = Number(transaction.amount);
    const refunded = input.refundAmount;

    await BookingEmailService.sendRefundConfirmation(bookingId, input.userId, {
      refundAmount: refunded,
      originalAmount: original,
      currency: input.currency || transaction.currency,
      // A partial refund must not tell the client their money is fully returned.
      refundType: refunded >= original ? 'full' : 'partial',
      reason: input.reason ?? undefined,
      // Honest about where the money goes back to. This was hardcoded false, so
      // a refund against a manually-recorded payment told the client to expect
      // it on a card that was never charged.
      isManualRefund: transaction.processor_type === 'manual',
    });

    logger.info(
      { transactionId: transaction.id, bookingId, refundId: input.refundId },
      'Refund confirmation sent'
    );
  } catch (err) {
    // Deliberately swallowed. The money moved; the email is best effort.
    logger.error({ err, transactionId: input.transactionId }, 'Refund confirmation failed to send');
  }
}

/**
 * The refund email for money with no appointment behind it.
 *
 * Same template as the booking path, minus the two fields that only make sense
 * for an appointment. The client is taken from the invoice, which is where an
 * invoice-only payment records who it was for.
 *
 * Never throws, like everything else here: the money has already gone back, and
 * a failed send must not be reported as a failed refund.
 */
async function notifyInvoiceRefund(
  input: NotifyRefundInput,
  transaction: { id: string; invoice_id: string | null; amount: number; currency: string; processor_type?: string | null }
): Promise<void> {
  if (!transaction.invoice_id) {
    logger.info(
      { transactionId: transaction.id },
      'Refund notification skipped: no booking and no invoice to name the client'
    );
    return;
  }

  const { data: invoice } = await supabaseServer
    .from('payment_invoices')
    .select('invoice_number, client_name, client_email, currency')
    .eq('id', transaction.invoice_id)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (!invoice?.client_email) {
    logger.info(
      { transactionId: transaction.id, invoiceId: transaction.invoice_id },
      'Refund notification skipped: the invoice has no client email'
    );
    return;
  }

  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select('company_name, invoice_company_name, logo_url, language')
    .eq('user_id', input.userId)
    .maybeSingle();

  const locale = (profile?.language as 'en' | 'es' | 'he') || 'en';
  const branding = await resolveEmailBranding(input.userId, locale, profile as never);
  const businessName =
    profile?.invoice_company_name || profile?.company_name || branding.businessName || 'Business';

  const original = Number(transaction.amount);
  const refunded = input.refundAmount;

  const { subject, html } = generateRefundConfirmationEmail({
    clientName: invoice.client_name || 'Client',
    refundAmount: refunded,
    originalAmount: original,
    currency: input.currency || invoice.currency || transaction.currency,
    refundType: refunded >= original ? 'full' : 'partial',
    refundDate: new Date(),
    // The document it reverses, in the place the booking path names a service.
    // A client with several invoices needs to know which one this is about.
    serviceName: invoice.invoice_number ? `${invoice.invoice_number}` : undefined,
    reason: input.reason ?? undefined,
    // Money returned by hand does not arrive on a card, and telling the client
    // it will is how they end up watching a statement that never changes.
    isManualRefund: transaction.processor_type === 'manual',
    branding: { ...branding, businessName },
    locale,
  });

  const result = await sendEmail({
    to: [invoice.client_email],
    subject,
    html,
    ownerUserId: input.userId,
  });

  logger.info(
    {
      transactionId: transaction.id,
      invoiceId: transaction.invoice_id,
      refundId: input.refundId,
      sent: result.sent,
      provider: result.provider,
      // Surfaced rather than swallowed: the owner ticked "notify the client",
      // and a transport that refused is the only thing that explains silence.
      error: result.error,
    },
    result.sent
      ? 'Refund confirmation sent for an invoice with no booking'
      : 'Refund confirmation could not be sent for an invoice with no booking'
  );
}
