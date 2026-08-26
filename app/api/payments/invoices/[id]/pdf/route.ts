/**
 * Invoice PDF API
 * GET /api/payments/invoices/[id]/pdf
 *
 * Returns PDF for an invoice.
 * - If Stripe invoice exists: Redirects to Stripe's hosted PDF URL
 * - If no Stripe: Generates custom PDF using InvoicePDFGenerator
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { generateInvoicePDFAsync } from '@/lib/pdf/InvoicePDFGenerator';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ module: 'InvoicePDFAPI' });

export async function GET(
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

    requestLogger.info({ userId: user.id, invoiceId }, 'Fetching invoice PDF');

    // 2. Fetch the invoice
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

    // 3. Check if we have a Stripe PDF URL
    if (invoice.stripe_invoice_pdf) {
      requestLogger.info({ invoiceId, stripeUrl: invoice.stripe_invoice_pdf }, 'Redirecting to Stripe PDF');
      return NextResponse.redirect(invoice.stripe_invoice_pdf);
    }

    // 4. If we have a Stripe invoice ID but no PDF URL, fetch it from Stripe
    if (invoice.stripe_invoice_id) {
      const { data: stripeAccount } = await stripeConnectRepository.findByUserId(user.id);

      if (stripeAccount?.stripe_account_id) {
        try {
          const stripeInvoiceService = getStripeInvoiceService();
          const pdfUrl = await stripeInvoiceService.getInvoicePdf(
            invoice.stripe_invoice_id,
            stripeAccount.stripe_account_id
          );

          if (pdfUrl) {
            // Cache the PDF URL for future requests
            await paymentInvoiceRepository.updateStripeFields(invoiceId, user.id, {
              stripe_invoice_pdf: pdfUrl
            });

            requestLogger.info({ invoiceId, stripeUrl: pdfUrl }, 'Redirecting to fetched Stripe PDF');
            return NextResponse.redirect(pdfUrl);
          }
        } catch (stripeError) {
          requestLogger.error({ err: stripeError, invoiceId }, 'Failed to fetch Stripe PDF URL');
          // Fall through to generate custom PDF
        }
      }
    }

    // 5. Generate custom PDF using InvoicePDFGenerator
    requestLogger.info({ invoiceId }, 'Generating custom PDF');

    // Get business profile for invoice settings and vertical
    const { data: settingsWithProfile } = await businessProfileRepository.getInvoiceSettingsWithProfile(user.id);

    if (!settingsWithProfile) {
      requestLogger.warn({ invoiceId }, 'No business profile found for PDF generation');
      return NextResponse.json(
        { success: false, error: 'Business profile not configured. Please set up your invoice settings first.' },
        { status: 400 }
      );
    }

    // Get language - priority: query param > business profile > user_preferences > default 'en'
    const langParam = request.nextUrl.searchParams.get('lang');
    const validLocales: Locale[] = ['en', 'es', 'he'];
    let language: Locale = 'en';

    if (langParam && validLocales.includes(langParam as Locale)) {
      language = langParam as Locale;
    } else if (settingsWithProfile.language && validLocales.includes(settingsWithProfile.language as Locale)) {
      language = settingsWithProfile.language as Locale;
    } else {
      // Fallback to user_preferences
      const { data: userPrefs } = await supabaseServer
        .from('user_preferences')
        .select('preferred_language')
        .eq('user_id', user.id)
        .single();
      if (userPrefs?.preferred_language && validLocales.includes(userPrefs.preferred_language as Locale)) {
        language = userPrefs.preferred_language as Locale;
      }
    }

    requestLogger.info({ invoiceId, language, langParam, dbLanguage: settingsWithProfile.language }, 'Using language for PDF generation');

    // Get contact details if linked
    let contactName: string | undefined;
    let contactEmail: string | undefined;
    let contactPhone: string | undefined;
    let contactAddress: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } | undefined;

    if (invoice.contact_id) {
      const { data: contact } = await crmContactRepository.findById(invoice.contact_id, user.id);
      if (contact) {
        contactName = contact.full_name;
        contactEmail = contact.email || undefined;
        contactPhone = contact.phone || undefined;
        // Check if contact has address fields
        if (contact.address || contact.city || contact.country) {
          contactAddress = {
            line1: contact.address || undefined,
            city: contact.city || undefined,
            state: contact.state || undefined,
            postal_code: contact.zip || undefined,
            country: contact.country || undefined,
          };
        }
      }
    }

    // Generate the PDF (async)
    const pdfBuffer = await generateInvoicePDFAsync({
      invoice,
      businessSettings: {
        invoice_company_name: settingsWithProfile.invoice_company_name,
        invoice_address: settingsWithProfile.invoice_address || {},
        invoice_tax_id: settingsWithProfile.invoice_tax_id,
        invoice_bank_name: settingsWithProfile.invoice_bank_name,
        invoice_bank_account: settingsWithProfile.invoice_bank_account,
        invoice_bank_routing: settingsWithProfile.invoice_bank_routing,
        invoice_payment_instructions: settingsWithProfile.invoice_payment_instructions,
        invoice_footer_text: settingsWithProfile.invoice_footer_text,
        invoice_number_prefix: settingsWithProfile.invoice_number_prefix || 'INV',
        invoice_logo_url: settingsWithProfile.invoice_logo_url,
      },
      businessName: settingsWithProfile.company_name || undefined,
      businessVertical: settingsWithProfile.vertical || undefined,
      contactName,
      contactEmail,
      contactPhone,
      contactAddress,
      language,
    });

    requestLogger.info({ invoiceId }, 'Custom PDF generated successfully');

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.invoice_number}.pdf"`,
        'Cache-Control': 'private, max-age=3600'
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to get invoice PDF');
    return NextResponse.json(
      { success: false, error: 'Failed to get invoice PDF' },
      { status: 500 }
    );
  }
}
