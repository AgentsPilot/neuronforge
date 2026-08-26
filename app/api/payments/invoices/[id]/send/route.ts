/**
 * Invoice Send API
 * POST /api/payments/invoices/[id]/send
 *
 * Sends an invoice to the client.
 * - If Stripe invoice exists: Uses Stripe to send professional email with payment link
 * - If no Stripe: Sends custom email with PDF attachment (using InvoicePDFGenerator)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { generateInvoiceEmail } from '@/lib/email/templates/invoice';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { generateInvoicePDFAsync } from '@/lib/pdf/InvoicePDFGenerator';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Locale } from '@/lib/i18n/config';
import { z } from 'zod';

const logger = createLogger({ module: 'InvoiceSendAPI' });
const auditTrail = AuditTrailService.getInstance();

const SendInvoiceSchema = z.object({
  // If true, will create Stripe invoice if one doesn't exist
  // Default is false - we prefer sending email with PDF attachment
  use_stripe: z.boolean().default(false),
  // Custom message to include in email (for non-Stripe sends)
  message: z.string().optional(),
  // Override language for testing (optional - defaults to user's business profile language)
  language: z.enum(['en', 'es', 'he']).optional()
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: invoiceId } = await params;

    // 2. Validate input
    const body = await request.json().catch(() => ({}));
    const { use_stripe, language: requestLanguage } = SendInvoiceSchema.parse(body);

    // 3. Fetch the invoice
    const { data: invoice, error: invoiceError } = await paymentInvoiceRepository.findById(
      invoiceId,
      user.id
    );

    if (invoiceError || !invoice) {
      requestLogger.warn({ invoiceId }, 'Invoice not found');
      return NextResponse.json(
        { success: false, error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Check invoice status - can send draft or sent invoices (for resending)
    // Cannot resend cancelled or paid invoices
    if (invoice.status === 'cancelled' || invoice.status === 'paid') {
      return NextResponse.json(
        { success: false, error: `Cannot send invoice with status '${invoice.status}'.` },
        { status: 400 }
      );
    }

    const isResend = invoice.status === 'sent' || invoice.status === 'overdue';

    requestLogger.info({ userId: user.id, invoiceId, useStripe: use_stripe, isResend }, 'Sending invoice');

    // Check if invoice has client email
    if (!invoice.client_email) {
      return NextResponse.json(
        { success: false, error: 'Invoice must have a client email address' },
        { status: 400 }
      );
    }

    // 4. Check for Stripe Connect account
    const { data: stripeAccount } = await stripeConnectRepository.findByUserId(user.id);

    // Determine if we can use Stripe
    const canUseStripe = stripeAccount &&
      stripeAccount.charges_enabled &&
      stripeAccount.onboarding_completed;

    let hostedInvoiceUrl: string | null = null;
    let invoicePdfUrl: string | null = null;
    let stripeInvoiceId: string | null = invoice.stripe_invoice_id;

    // 5. Send via Stripe if possible and requested
    if (use_stripe && canUseStripe && stripeAccount) {
      const stripeInvoiceService = getStripeInvoiceService();

      try {
        // If we already have a Stripe invoice, just send it
        if (stripeInvoiceId) {
          requestLogger.info({ stripeInvoiceId }, 'Sending existing Stripe invoice');

          const result = await stripeInvoiceService.sendInvoice(
            stripeInvoiceId,
            stripeAccount.stripe_account_id
          );

          hostedInvoiceUrl = result.hostedInvoiceUrl;
          invoicePdfUrl = result.invoicePdf;
        } else {
          // Create new Stripe invoice and send
          requestLogger.info({ invoiceId }, 'Creating and sending new Stripe invoice');

          // Convert line items to Stripe format (amounts in cents)
          const stripeLineItems = invoice.line_items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: Math.round(item.unit_price * 100), // Convert to cents
            total: Math.round(item.total * 100)
          }));

          // Create the invoice
          const createResult = await stripeInvoiceService.createInvoice({
            connectAccountId: stripeAccount.stripe_account_id,
            customerEmail: invoice.client_email!,
            customerName: invoice.client_name || invoice.client_email!,
            lineItems: stripeLineItems,
            dueDate: invoice.due_date ? new Date(invoice.due_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            currency: invoice.currency.toLowerCase(),
            description: `Invoice ${invoice.invoice_number}`,
            metadata: {
              platform_invoice_id: invoice.id,
              invoice_number: invoice.invoice_number
            }
          });

          stripeInvoiceId = createResult.invoiceId;

          // Send the invoice
          const sendResult = await stripeInvoiceService.sendInvoice(
            stripeInvoiceId,
            stripeAccount.stripe_account_id
          );

          hostedInvoiceUrl = sendResult.hostedInvoiceUrl;
          invoicePdfUrl = sendResult.invoicePdf;
        }

        // Update invoice with Stripe details
        await paymentInvoiceRepository.updateStripeFields(invoiceId, user.id, {
          stripe_invoice_id: stripeInvoiceId,
          stripe_hosted_invoice_url: hostedInvoiceUrl || undefined,
          stripe_invoice_pdf: invoicePdfUrl || undefined,
          status: 'sent',
          sent_at: new Date().toISOString()
        });

        requestLogger.info({
          invoiceId,
          stripeInvoiceId,
          hostedUrl: hostedInvoiceUrl
        }, 'Invoice sent via Stripe');

      } catch (stripeError: any) {
        requestLogger.error({ err: stripeError, invoiceId }, 'Failed to send via Stripe, falling back to email');
        // Fall through to email sending
      }
    }

    // 6. Send via custom email with PDF attachment (if Stripe didn't succeed)
    if (!hostedInvoiceUrl) {
      // 6. Send via custom email with PDF attachment
      requestLogger.info({ invoiceId }, 'Sending invoice via email (non-Stripe mode)');

      try {
        // Get business profile for branding and invoice settings
        const { data: settingsWithProfile } = await businessProfileRepository.getInvoiceSettingsWithProfile(user.id);

        if (!settingsWithProfile) {
          return NextResponse.json(
            { success: false, error: 'Business profile not configured. Please set up your invoice settings first.' },
            { status: 400 }
          );
        }

        // Get contact details if linked
        let contactName: string | undefined;
        let contactEmail: string | undefined;
        let contactPhone: string | undefined;

        if (invoice.contact_id) {
          const { data: contact } = await crmContactRepository.findById(invoice.contact_id, user.id);
          if (contact) {
            contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || undefined;
            contactEmail = contact.email || undefined;
            contactPhone = contact.phone || undefined;
          }
        }

        // Get user's language - priority: request override > business profile > user_preferences > default 'en'
        const validLocales: Locale[] = ['en', 'es', 'he'];
        let dbLanguage = settingsWithProfile.language;

        // If business_profiles.language is null, check user_preferences as fallback
        if (!dbLanguage) {
          const { data: userPrefs } = await supabaseServer
            .from('user_preferences')
            .select('preferred_language')
            .eq('user_id', user.id)
            .single();
          if (userPrefs?.preferred_language) {
            dbLanguage = userPrefs.preferred_language;
            requestLogger.info({ userId: user.id, preferredLanguage: dbLanguage }, 'Using language from user_preferences fallback');
          }
        }

        // Use request language if provided, otherwise use db language, otherwise default to 'en'
        let userLocale: Locale = 'en';
        if (requestLanguage && validLocales.includes(requestLanguage)) {
          userLocale = requestLanguage;
        } else if (dbLanguage && validLocales.includes(dbLanguage as Locale)) {
          userLocale = dbLanguage as Locale;
        }

        requestLogger.info({
          invoiceId,
          userLocale,
          dbLanguage,
          requestLanguage,
          isHebrew: userLocale === 'he',
          languageSource: requestLanguage ? 'request' : (dbLanguage ? 'database' : 'default')
        }, 'Using locale for invoice email and PDF');

        // Generate email content
        const lineItems = (invoice.line_items || []).map(item => ({
          description: item.description || 'Service',
          quantity: item.quantity || 1,
          unitPrice: item.unit_price || 0,
          amount: (item.quantity || 1) * (item.unit_price || 0),
        }));

        // If no line items, create a default one
        if (lineItems.length === 0) {
          lineItems.push({
            description: 'Service',
            quantity: 1,
            unitPrice: invoice.amount,
            amount: invoice.amount,
          });
        }

        // Create a payment link URL (public endpoint - no auth required)
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.neuronforge.app';
        const paymentUrl = `${baseUrl}/api/public/invoice/${invoice.id}/pay`;

        const businessName = settingsWithProfile.company_name || settingsWithProfile.invoice_company_name || 'Business';

        const { subject, html } = generateInvoiceEmail({
          clientName: invoice.client_name || contactName || 'Client',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.amount,
          currency: invoice.currency,
          dueDate: invoice.due_date ? new Date(invoice.due_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          lineItems,
          paymentUrl,
          branding: {
            businessName,
            primaryColor: '#3B82F6', // Default blue
            secondaryColor: '#1E40AF', // Darker blue
            logoUrl: settingsWithProfile.invoice_logo_url || undefined,
          },
          locale: userLocale,
        });

        // Generate PDF attachment
        requestLogger.info({ invoiceId, language: userLocale }, 'Generating invoice PDF for attachment');

        const pdfBuffer = await generateInvoicePDFAsync({
          invoice,
          businessSettings: {
            invoice_company_name: settingsWithProfile.invoice_company_name,
            invoice_address: settingsWithProfile.invoice_address,
            invoice_tax_id: settingsWithProfile.invoice_tax_id,
            invoice_bank_name: settingsWithProfile.invoice_bank_name,
            invoice_bank_account: settingsWithProfile.invoice_bank_account,
            invoice_bank_routing: settingsWithProfile.invoice_bank_routing,
            invoice_payment_instructions: settingsWithProfile.invoice_payment_instructions,
            invoice_footer_text: settingsWithProfile.invoice_footer_text,
            invoice_number_prefix: settingsWithProfile.invoice_number_prefix,
            invoice_logo_url: settingsWithProfile.invoice_logo_url,
          },
          businessName,
          businessVertical: settingsWithProfile.vertical || undefined,
          language: userLocale,
        });

        requestLogger.info({
          invoiceId,
          pdfSize: pdfBuffer?.length || 0,
          pdfIsBuffer: Buffer.isBuffer(pdfBuffer)
        }, 'PDF generated for attachment');

        // Send email with PDF attachment
        // Note: We don't use ownerUserId here - platform emails should be sent via
        // Resend or system Gmail, not the user's personal Gmail plugin
        const emailResult = await sendEmail({
          to: [invoice.client_email!],
          subject,
          html,
          attachments: [{
            filename: `${invoice.invoice_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }],
        });

        if (!emailResult.sent) {
          requestLogger.error({ invoiceId, error: emailResult.error }, 'Failed to send invoice email');
          return NextResponse.json(
            { success: false, error: `Failed to send email: ${emailResult.error || 'No email transport configured'}` },
            { status: 500 }
          );
        }

        requestLogger.info({ invoiceId, provider: emailResult.provider }, 'Invoice email sent successfully');

        // Update invoice status
        await paymentInvoiceRepository.update(invoiceId, user.id, {
          status: 'sent',
          sent_at: new Date().toISOString()
        });

      } catch (emailError) {
        requestLogger.error({ err: emailError, invoiceId }, 'Failed to send invoice email');
        return NextResponse.json(
          { success: false, error: 'Failed to send invoice email' },
          { status: 500 }
        );
      }
    }

    // 7. Audit log
    auditTrail.log({
      action: 'PAYMENT_INVOICE_SENT',
      entityType: 'payment_invoice',
      entityId: invoiceId,
      userId: user.id,
      resourceName: invoice.invoice_number,
      metadata: {
        client_email: invoice.client_email,
        amount: invoice.amount,
        currency: invoice.currency,
        stripe_invoice_id: stripeInvoiceId,
        sent_via: canUseStripe && use_stripe ? 'stripe' : 'email'
      },
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 8. Log CRM activity for invoice sent (HIPAA compliance)
    if (invoice.contact_id) {
      crmActivityRepository.create({
        user_id: user.id,
        contact_id: invoice.contact_id,
        activity_type: 'invoice_sent',
        title: `Invoice Sent: ${invoice.invoice_number}`,
        description: `Invoice for ${invoice.currency} ${invoice.amount} sent to ${invoice.client_email}`,
        auto_logged: true,
        source_capability: 'payments',
        source_entity_id: invoiceId
      }).catch(err => requestLogger.warn({ err }, 'CRM activity logging failed (non-blocking)'));
    }

    // 9. Return success
    return NextResponse.json({
      success: true,
      data: {
        invoice_id: invoiceId,
        stripe_invoice_id: stripeInvoiceId,
        hosted_invoice_url: hostedInvoiceUrl,
        invoice_pdf_url: invoicePdfUrl,
        sent_via: canUseStripe && use_stripe ? 'stripe' : 'email',
        sent_at: new Date().toISOString()
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to send invoice');
    return NextResponse.json(
      { success: false, error: 'Failed to send invoice' },
      { status: 500 }
    );
  }
}
