/**
 * Invoice Send API
 * POST /api/payments/invoices/[id]/send
 *
 * The delivery sequence itself lives in InvoiceDeliveryService, so the chat can
 * send an invoice the same way this route does. It used to live here, which is
 * why `invoices.send` was declared in the chat catalog with no handler behind
 * it and failed every time it was asked for.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { sendInvoice, InvoiceNotSendableError } from '@/lib/services/InvoiceDeliveryService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'InvoiceSendAPI' });

const SendInvoiceSchema = z.object({
  // Default false: a PDF by email is preferred over raising a Stripe invoice.
  use_stripe: z.boolean().default(false),
  message: z.string().optional(),
  language: z.enum(['en', 'es', 'he']).optional()
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: invoiceId } = await params;
    const body = await request.json().catch(() => ({}));
    const { use_stripe, language } = SendInvoiceSchema.parse(body);

    const result = await sendInvoice({
      invoiceId,
      userId: user.id,
      useStripe: use_stripe,
      language,
      request,
      logger: requestLogger
    });

    if (result.error) {
      // A paid, cancelled or address-less invoice is something the user can see
      // and act on, so it reads back as their message rather than a 500.
      /*
       * A PAID invoice is not a refusal — it is a different document.
       *
       * "Send the invoice" from an owner whose client just asked for it means
       * "send them the paperwork for this money". Before it was paid that is an
       * invoice; after, it is a receipt. Refusing with "already paid" answers a
       * question nobody asked and leaves the owner forwarding things by hand.
       */
      if (result.error instanceof InvoiceNotSendableError && result.error.reason === 'already_paid') {
        const { data: invoice } = await supabaseServer
          .from('payment_invoices')
          .select('client_email, client_name, amount, currency, invoice_number, booking_id')
          .eq('id', invoiceId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!invoice?.client_email) {
          return NextResponse.json(
            { success: false, error: result.error.message, reason: result.error.reason },
            { status: 400 }
          );
        }

        const receipt = await BookingEmailService.sendPaymentReceipt(user.id, {
          customerEmail: invoice.client_email,
          customerName: invoice.client_name || '',
          amount: Number(invoice.amount),
          currency: invoice.currency || 'USD',
          receiptNumber: invoice.invoice_number,
          bookingId: invoice.booking_id ?? undefined,
        });

        requestLogger.info({ invoiceId, sent: receipt.sent }, 'Paid invoice re-sent as a receipt');

        return NextResponse.json({
          success: receipt.sent,
          sentAs: 'receipt',
          error: receipt.sent ? undefined : receipt.error || 'Could not send the receipt',
        });
      }

      if (result.error instanceof InvoiceNotSendableError) {
        return NextResponse.json(
          { success: false, error: result.error.message, reason: result.error.reason },
          { status: 400 }
        );
      }

      const notFound = result.error.message === 'Invoice not found';
      requestLogger.error({ err: result.error, invoiceId }, 'Failed to send invoice');
      return NextResponse.json(
        { success: false, error: notFound ? 'Invoice not found' : 'Failed to send invoice' },
        { status: notFound ? 404 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        invoice_id: result.data!.invoiceId,
        stripe_invoice_id: result.data!.stripeInvoiceId,
        hosted_invoice_url: result.data!.hostedInvoiceUrl,
        invoice_pdf_url: result.data!.invoicePdfUrl,
        sent_via: result.data!.sentVia,
        sent_at: result.data!.sentAt
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
