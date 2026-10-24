/**
 * Tell the client that a payment request has been withdrawn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Voiding an invoice was completely silent. The client kept the original in
 * their inbox, the hosted payment page quietly stopped working, and nobody told
 * them why — so the best outcome was a confused reply, and the worst was a
 * client who paid days earlier from the copy they already held.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OPT-IN, AND THAT IS DELIBERATE
 *
 * `voidInvoice` has six callers. Most of them void in bulk as part of ending
 * something larger — `cancelQuoteStages` voids every unpaid invoice on a quote,
 * `stopBookingPlan` and `BookingLifecycleService` do the same for a booking —
 * and each of those already sends the client ONE email describing the whole
 * ending. Notifying from inside `voidInvoice` would put five "your payment
 * request was cancelled" emails underneath a single "the work has stopped".
 *
 * So the default is silence and the owner's explicit "cancel this payment" is
 * what asks for it. The decision sits with the caller that knows whether the
 * client is hearing about this some other way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER THROWS, NEVER BLOCKS
 *
 * The invoice is already void and the stage already released by the time this
 * runs. A failed email is worth a warning and nothing more: it must not turn a
 * completed cancellation into a failed request, or the owner presses the button
 * again against an invoice that is already cancelled.
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolveEmailBranding } from '@/lib/email/branding';
import { resolveUserLanguage } from '@/lib/business-os/userLanguage';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';
import { generatePaymentRequestCancelledEmail } from '@/lib/email/templates/invoice';
import type { EmailPlanPeriod } from '@/lib/email/templates/base-template';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ module: 'NotifyPaymentRequestCancelled' });

export async function notifyPaymentRequestCancelled(input: {
  invoiceId: string;
  userId: string;
}): Promise<{ sent: boolean }> {
  const { invoiceId, userId } = input;

  try {
    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('id, invoice_number, amount, currency, contact_id, client_email, client_name')
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!invoice) return { sent: false };

    /*
     * The contact first, falling back to what the invoice itself recorded. An
     * invoice can be raised for a client who is not a CRM contact, and that
     * client is exactly as entitled to be told their payment request is gone.
     */
    const { data: contact } = invoice.contact_id
      ? await supabaseServer
          .from('crm_contacts')
          .select('first_name, email')
          .eq('id', invoice.contact_id)
          .eq('user_id', userId)
          .maybeSingle()
      : { data: null };

    const toEmail = contact?.email ?? invoice.client_email ?? null;

    if (!toEmail) {
      /* Not an error: the cancellation itself has already happened correctly. */
      logger.info({ invoiceId }, 'Payment request cancelled, but there is no address to tell');
      return { sent: false };
    }

    /*
     * The whole plan this request belonged to, cancelled periods included, so
     * the client sees the same schedule they were sent before with this one
     * struck out. Found through the stage that carried the invoice — a one-off
     * invoice has no stage, and then no schedule is drawn.
     */
    const { data: ownStage } = await supabaseServer
      .from('payment_plan_installments')
      .select('payment_plan_id, booking_id')
      .eq('user_id', userId)
      .eq('invoice_id', invoiceId)
      .maybeSingle();

    let periods: EmailPlanPeriod[] = [];
    let planTotal: number | null = null;

    if (ownStage?.payment_plan_id && ownStage.booking_id) {
      /*
       * Scoped to the BOOKING as well as the plan. Plans are shared templates —
       * one on this account is used by ten bookings — so filtering by plan alone
       * would list another client's periods in this client's email.
       */
      const { data: stages } = await supabaseServer
        .from('payment_plan_installments')
        .select('installment_number, label, amount, due_date, status')
        .eq('user_id', userId)
        .eq('booking_id', ownStage.booking_id)
        .order('installment_number');

      periods = (stages ?? []).map(s => ({
        number: Number(s.installment_number),
        label: (s.label as string | null) ?? null,
        amount: Number(s.amount) || 0,
        dueDate: (s.due_date as string | null) ?? null,
        status: String(s.status),
      }));

      planTotal = periods.reduce((sum, p) => sum + p.amount, 0);
    }

    const { data: langRow } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', userId)
      .maybeSingle();

    /* The CLIENT's language, resolved the way every other client email does. */
    const locale = resolveUserLanguage({
      profileLanguage: langRow?.language ?? null,
    }).language as Locale;

    const branding = await resolveEmailBranding(userId, locale);

    const { subject, html } = generatePaymentRequestCancelledEmail({
      invoiceNumber: String(invoice.invoice_number),
      amount: Number(invoice.amount) || 0,
      currency: String(invoice.currency),
      clientFirstName:
        (contact?.first_name as string | null) ??
        (invoice.client_name as string | null) ??
        null,
      periods,
      planTotal,
      branding,
      locale,
    });

    const result = await sendEmail({
      kind: 'transactional',
      to: [toEmail],
      subject,
      html,
      /* The business as sender, not the platform. */
      ownerUserId: userId,
    });

    /* Recorded whether it sent or not, as every other client email is. */
    await recordEmailSend({
      userId,
      contactId: (invoice.contact_id as string | null) ?? null,
      toEmail,
      subject,
      bodyHtml: html,
      /* So the journey can label it, rather than showing the raw subject. */
      kind: 'payment_request_cancelled',
      result,
    });

    if (!result.sent) {
      logger.warn(
        { invoiceId, error: result.error ?? result.blocked },
        'Could not tell the client their payment request was cancelled'
      );
      return { sent: false };
    }

    logger.info({ invoiceId, to: toEmail }, 'Told the client the payment request was cancelled');
    return { sent: true };
  } catch (err) {
    logger.warn({ err, invoiceId }, 'Telling the client about the cancelled request threw');
    return { sent: false };
  }
}
