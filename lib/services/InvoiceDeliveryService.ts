/**
 * What it means to send an invoice — in one place, for every caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Sending an invoice is not marking it `sent`. It is: refusing to send a paid or
 * cancelled one, raising it at Stripe when the business is set up for that,
 * otherwise rendering a branded PDF in the client's language and emailing it,
 * recording the status, writing the audit entry, and logging the activity
 * against the contact.
 *
 * All of that lived inside `POST /api/payments/invoices/[id]/send`, so only an
 * HTTP caller got it. The chat declared `invoices.send` in its catalog and had
 * no handler at all, so "send that invoice to Ofir" planned correctly and then
 * failed every single time with "declared but not implemented yet". The catalog
 * advertised a capability that could not work.
 *
 * This is the same move made for bookings: the sequence belongs below the route,
 * and both doors call it. The alternative — pointing the chat at
 * `paymentInvoiceRepository.update({status:'sent'})` — would have marked
 * invoices sent that nobody ever received, which is the failure mode this
 * codebase has already been bitten by twice.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/InvoiceDeliveryService
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  paymentInvoiceRepository,
  stripeConnectRepository,
} from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { generateInvoiceEmail } from '@/lib/email/templates/invoice';
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { generateInvoicePDFAsync } from '@/lib/pdf/InvoicePDFGenerator';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ service: 'InvoiceDeliveryService' });
const auditTrail = AuditTrailService.getInstance();

type ContextLogger = {
  debug: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
};

/**
 * This invoice cannot be sent, and the reason is the caller's to explain.
 *
 * A distinct type because none of these are system faults: a paid invoice, a
 * cancelled one, or one with no client email are all states the user can see and
 * act on. The route turns them into a 400; the chat turns them into a sentence.
 * A generic Error would have both of them saying "something went wrong" about a
 * situation the user could have fixed in ten seconds.
 */
export class InvoiceNotSendableError extends Error {
  constructor(
    message: string,
    readonly reason: 'already_paid' | 'cancelled' | 'no_client_email' | 'no_business_profile'
  ) {
    super(message);
    this.name = 'InvoiceNotSendableError';
  }
}

export interface SendInvoiceParams {
  invoiceId: string;
  userId: string;
  /** Raise and send through Stripe when the account supports it. */
  useStripe?: boolean;
  /** Overrides the business's own language. Mainly for testing. */
  language?: Locale;
  request?: NextRequest;
  logger?: ContextLogger;
}

export interface SendInvoiceOutcome {
  invoiceId: string;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  sentVia: 'stripe' | 'email';
  sentAt: string;
  /** True when this invoice had already been sent once. */
  resend: boolean;
}

const VALID_LOCALES: Locale[] = ['en', 'es', 'he'];

/**
 * Send an invoice to its client.
 *
 * Stripe first when asked for and available, because it gives the client a
 * hosted payment page; a branded PDF by email otherwise. A Stripe failure falls
 * through to email rather than failing the send — the client getting the invoice
 * matters more than which pipe carried it.
 */
export async function sendInvoice(
  params: SendInvoiceParams
): Promise<{ data: SendInvoiceOutcome | null; error: Error | null }> {
  const { invoiceId, userId, useStripe = false, request } = params;
  const log = params.logger ?? logger;

  const { data: invoice, error: invoiceError } = await paymentInvoiceRepository.findById(
    invoiceId,
    userId
  );

  if (invoiceError || !invoice) {
    return { data: null, error: new Error('Invoice not found') };
  }

  // Sending a paid invoice asks the client to pay twice; sending a cancelled one
  // asks them to pay for something withdrawn. Neither is a resend.
  if (invoice.status === 'paid') {
    return {
      data: null,
      error: new InvoiceNotSendableError(
        `Invoice ${invoice.invoice_number} has already been paid.`,
        'already_paid'
      ),
    };
  }
  if (invoice.status === 'cancelled') {
    return {
      data: null,
      error: new InvoiceNotSendableError(
        `Invoice ${invoice.invoice_number} was cancelled.`,
        'cancelled'
      ),
    };
  }
  if (!invoice.client_email) {
    return {
      data: null,
      error: new InvoiceNotSendableError(
        `Invoice ${invoice.invoice_number} has no client email address to send to.`,
        'no_client_email'
      ),
    };
  }

  const resend = invoice.status === 'sent' || invoice.status === 'overdue';
  log.info({ userId, invoiceId, useStripe, resend }, 'Sending invoice');

  const { data: stripeAccount } = await stripeConnectRepository.findByUserId(userId);
  const canUseStripe = Boolean(
    stripeAccount && stripeAccount.charges_enabled && stripeAccount.onboarding_completed
  );

  let hostedInvoiceUrl: string | null = null;
  let invoicePdfUrl: string | null = null;
  let stripeInvoiceId: string | null = invoice.stripe_invoice_id;

  if (useStripe && canUseStripe && stripeAccount) {
    try {
      const stripeInvoiceService = getStripeInvoiceService();

      if (stripeInvoiceId) {
        const result = await stripeInvoiceService.sendInvoice(
          stripeInvoiceId,
          stripeAccount.stripe_account_id
        );
        hostedInvoiceUrl = result.hostedInvoiceUrl;
        invoicePdfUrl = result.invoicePdf;
      } else {
        const createResult = await stripeInvoiceService.createInvoice({
          connectAccountId: stripeAccount.stripe_account_id,
          customerEmail: invoice.client_email,
          customerName: invoice.client_name || invoice.client_email,
          lineItems: invoice.line_items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: Math.round(item.unit_price * 100), // Stripe works in cents.
            total: Math.round(item.total * 100),
          })),
          dueDate: invoice.due_date ? new Date(invoice.due_date) : defaultDueDate(),
          currency: invoice.currency.toLowerCase(),
          description: `Invoice ${invoice.invoice_number}`,
          metadata: {
            platform_invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
          },
        });

        stripeInvoiceId = createResult.invoiceId;

        const sendResult = await stripeInvoiceService.sendInvoice(
          stripeInvoiceId,
          stripeAccount.stripe_account_id
        );
        hostedInvoiceUrl = sendResult.hostedInvoiceUrl;
        invoicePdfUrl = sendResult.invoicePdf;
      }

      await paymentInvoiceRepository.updateStripeFields(invoiceId, userId, {
        stripe_invoice_id: stripeInvoiceId,
        stripe_hosted_invoice_url: hostedInvoiceUrl || undefined,
        stripe_invoice_pdf: invoicePdfUrl || undefined,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });

      log.info({ invoiceId, stripeInvoiceId }, 'Invoice sent via Stripe');
    } catch (stripeError) {
      // Deliberately not fatal: the email path below still reaches the client.
      log.error(
        { err: stripeError, invoiceId },
        'Failed to send via Stripe, falling back to email'
      );
    }
  }

  if (!hostedInvoiceUrl) {
    const emailed = await sendByEmail(invoice, userId, params.language, log);
    if (emailed) return { data: null, error: emailed };
  }

  const sentVia: 'stripe' | 'email' = hostedInvoiceUrl ? 'stripe' : 'email';
  const sentAt = new Date().toISOString();

  auditTrail
    .log({
      action: 'PAYMENT_INVOICE_SENT',
      entityType: 'payment_invoice',
      entityId: invoiceId,
      userId,
      resourceName: invoice.invoice_number,
      // `details`, not `metadata` — AuditLogInput has no `metadata` field, so
      // everything recorded under that name was being dropped.
      details: {
        client_email: invoice.client_email,
        amount: invoice.amount,
        currency: invoice.currency,
        stripe_invoice_id: stripeInvoiceId,
        sent_via: sentVia,
      },
      severity: 'info',
      request,
    })
    .catch((err) => log.warn({ err }, 'Audit failed (non-blocking)'));

  // The contact's timeline should show that they were billed.
  if (invoice.contact_id) {
    crmActivityRepository
      .create({
        user_id: userId,
        contact_id: invoice.contact_id,
        activity_type: 'invoice_sent',
        title: `Invoice Sent: ${invoice.invoice_number}`,
        description: `Invoice for ${invoice.currency} ${invoice.amount} sent to ${invoice.client_email}`,
        auto_logged: true,
        source_capability: 'payments',
        source_entity_id: invoiceId,
      })
      .catch((err) => log.warn({ err }, 'CRM activity logging failed (non-blocking)'));
  }

  return {
    data: { invoiceId, stripeInvoiceId, hostedInvoiceUrl, invoicePdfUrl, sentVia, sentAt, resend },
    error: null,
  };
}

/** Net 30, when the invoice itself does not say. */
function defaultDueDate(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * The non-Stripe path: a branded email carrying a PDF, in the client's language.
 *
 * @returns an Error when the send failed, or null on success.
 */
async function sendByEmail(
  invoice: Awaited<ReturnType<typeof paymentInvoiceRepository.findById>>['data'] & object,
  userId: string,
  requestLanguage: Locale | undefined,
  log: ContextLogger
): Promise<Error | null> {
  try {
    const { data: settings } =
      await businessProfileRepository.getInvoiceSettingsWithProfile(userId);

    if (!settings) {
      return new InvoiceNotSendableError(
        'Your business profile is not set up yet, so the invoice has no sender details.',
        'no_business_profile'
      );
    }

    let contactName: string | undefined;
    if (invoice.contact_id) {
      const { data: contact } = await crmContactRepository.findById(invoice.contact_id, userId);
      if (contact) {
        contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || undefined;
      }
    }

    // The client reads this, so it goes out in the business's language:
    // an explicit override first, then the profile, then the stored preference.
    let dbLanguage = settings.language;
    if (!dbLanguage) {
      const { data: prefs } = await supabaseServer
        .from('user_preferences')
        .select('preferred_language')
        .eq('user_id', userId)
        .single();
      dbLanguage = prefs?.preferred_language ?? null;
    }

    const locale: Locale =
      requestLanguage && VALID_LOCALES.includes(requestLanguage)
        ? requestLanguage
        : dbLanguage && VALID_LOCALES.includes(dbLanguage as Locale)
          ? (dbLanguage as Locale)
          : 'en';

    const lineItems = (invoice.line_items || []).map((item) => ({
      description: item.description || 'Service',
      quantity: item.quantity || 1,
      unitPrice: item.unit_price || 0,
      amount: (item.quantity || 1) * (item.unit_price || 0),
    }));

    // An invoice with no line items still has a total to bill.
    if (lineItems.length === 0) {
      lineItems.push({
        description: 'Service',
        quantity: 1,
        unitPrice: invoice.amount,
        amount: invoice.amount,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.app';
    const paymentUrl = `${baseUrl}/api/public/invoice/${invoice.id}/pay`;
    const businessName =
      settings.company_name || settings.invoice_company_name || 'Business';

    // Colours and fonts come from the user's website theme; the invoice logo
    // stays whatever invoice settings define — it is configured per invoice,
    // not per website, so the theme must not override it.
    const branding = await resolveEmailBranding(userId, locale, settings);

    const { subject, html } = generateInvoiceEmail({
      clientName: invoice.client_name || contactName || 'Client',
      invoiceNumber: invoice.invoice_number,
      amount: invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.due_date ? new Date(invoice.due_date) : defaultDueDate(),
      lineItems,
      paymentUrl,
      branding: { ...branding, businessName, logoUrl: settings.logo_url || undefined },
      locale,
    });

    const pdfBuffer = await generateInvoicePDFAsync({
      invoice,
      businessSettings: {
        invoice_company_name: settings.invoice_company_name,
        invoice_address: settings.invoice_address,
        invoice_tax_id: settings.invoice_tax_id,
        invoice_bank_name: settings.invoice_bank_name,
        invoice_bank_account: settings.invoice_bank_account,
        invoice_bank_routing: settings.invoice_bank_routing,
        invoice_payment_instructions: settings.invoice_payment_instructions,
        invoice_footer_text: settings.invoice_footer_text,
        invoice_number_prefix: settings.invoice_number_prefix,
        logo_url: settings.logo_url,
      },
      businessName,
      businessVertical: settings.vertical || undefined,
      language: locale,
      // The attachment wears the same design as the mail carrying it.
      branding: {
        primaryColor: branding.primaryColor,
        accentColor: branding.secondaryColor,
        headingFont: branding.headingFont,
        bodyFont: branding.bodyFont,
      },
    });

    // No `ownerUserId`: platform mail goes through Resend or system Gmail, not
    // the user's own Gmail connection.
    const emailResult = await sendEmail({
      to: [invoice.client_email!],
      subject,
      html,
      attachments: [
        {
          filename: `${invoice.invoice_number}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    if (!emailResult.sent) {
      log.error({ invoiceId: invoice.id, error: emailResult.error }, 'Invoice email not sent');
      return new Error(
        `Failed to send email: ${emailResult.error || 'No email transport configured'}`
      );
    }

    // Only after the mail is away — an invoice marked sent that nobody received
    // is the exact bug this module exists to prevent.
    await paymentInvoiceRepository.update(invoice.id, userId, {
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    log.info({ invoiceId: invoice.id, provider: emailResult.provider }, 'Invoice email sent');
    return null;
  } catch (error) {
    log.error({ err: error, invoiceId: invoice.id }, 'Failed to send invoice email');
    return error instanceof InvoiceNotSendableError ? error : new Error('Failed to send invoice email');
  }
}
