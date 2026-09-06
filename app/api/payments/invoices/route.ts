import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';
import { z } from 'zod';

const logger = createLogger({ module: 'PaymentInvoicesAPI' });
const auditTrail = AuditTrailService.getInstance();

const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit_price: z.number(),
  total: z.number(),
});

const CreateInvoiceSchema = z.object({
  contact_id: z.string().uuid().optional().nullable(),
  // The service being billed, when the invoice is for one. Attributes the
  // invoice in the reports page's revenue-by-service breakdown.
  service_id: z.string().uuid().optional().nullable(),
  invoice_number: z.string().optional(), // Will auto-generate if not provided
  client_name: z.string().min(1, 'Client name is required'),
  client_email: z.string().email('Valid email is required'),
  amount: z.number().positive(),
  currency: z.string().default('USD'),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).default('draft'),
  line_items: z.array(LineItemSchema).default([]),
  due_date: z.string().optional(),
  payment_terms: z.string().default('Due upon receipt'),
  notes: z.string().optional(),
  internal_notes: z.string().optional(),
  /**
   * Send it to the client now, rather than leaving a draft.
   *
   * Separate from `use_stripe` because they are two decisions and only one of
   * them is about Stripe. Writing an invoice to finish later is an ordinary
   * thing to want; so is sending one from a business that takes payment by
   * transfer, which `sendInvoice` handles by emailing the branded invoice with
   * its PDF attached.
   *
   * Defaults to false, so a caller that says nothing — the chat's draft
   * publisher does exactly this — keeps writing drafts as it does today.
   */
  send: z.boolean().optional().default(false),
  /**
   * When sending, prefer a Stripe-hosted invoice with online payment.
   *
   * Only meaningful alongside `send`, and only honoured when the business is
   * actually connected — `sendInvoice` checks `charges_enabled` itself and
   * falls back to the branded email rather than failing.
   */
  use_stripe: z.boolean().optional().default(false),
  /**
   * May this invoice be paid online?
   *
   * SEPARATE FROM `use_stripe`, and the separation is the whole point.
   * `use_stripe` is about this one send — it is false whenever the invoice is
   * created without sending. Collapsing the two would mean writing an invoice
   * with "Send via Stripe" ticked, choosing "create without sending", and
   * silently marking it transfer-only.
   *
   * Omitted leaves it NULL: no choice recorded, the business's own capability
   * decides, which is how every invoice behaved before this existed. That is
   * also what the chat's draft publisher sends, so its invoices are unchanged.
   */
  allow_online_payment: z.boolean().optional(),
});

// GET /api/payments/invoices - List invoices
// Query param: include_stats=true to include stats by status
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const contact_id = searchParams.get('contact_id') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const includeStats = searchParams.get('include_stats') === 'true';

    requestLogger.info({ userId: user.id, status, contact_id, includeStats }, 'Listing payment invoices');

    // Catch up the stored status before reading.
    //
    // `markOverdueInvoices` existed but nothing ever called it, so an invoice
    // stayed 'sent' however long it was late: no overdue count, no overdue
    // filter, and a dashboard that reported zero outstanding while invoices
    // aged. Doing it here keeps the transition where the data is read, needs no
    // scheduled job, and is idempotent — it usually updates nothing.
    const overdueResult = await paymentInvoiceRepository.markOverdueInvoices(user.id);
    if (overdueResult.error) {
      // Not fatal: the list is still worth returning with stale statuses.
      requestLogger.warn({ err: overdueResult.error, userId: user.id }, 'Could not refresh overdue invoices');
    } else if (overdueResult.data) {
      requestLogger.info({ userId: user.id, marked: overdueResult.data }, 'Invoices moved to overdue');
    }

    // Fetch invoices, count, and optionally stats in parallel
    const promises: Promise<any>[] = [
      paymentInvoiceRepository.list(user.id, {
        status,
        contactId: contact_id,
        limit,
        offset
      }),
      paymentInvoiceRepository.count(user.id, {
        status,
        contactId: contact_id
      })
    ];

    if (includeStats) {
      promises.push(paymentInvoiceRepository.getStatsByStatus(user.id));
    }

    const results = await Promise.all(promises);
    const listResult = results[0];
    const countResult = results[1];
    const statsResult = includeStats ? results[2] : null;

    if (listResult.error) {
      requestLogger.error({ err: listResult.error }, 'Failed to list invoices');
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve invoices' },
        { status: 500 }
      );
    }

    const response: {
      success: boolean;
      data: any;
      total: number;
      stats?: any;
    } = {
      success: true,
      data: listResult.data,
      total: countResult.data || 0
    };

    if (includeStats && statsResult?.data) {
      response.stats = statsResult.data;
    }

    return NextResponse.json(response);

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/payments/invoices - Create invoice
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validated = CreateInvoiceSchema.parse(body);

    // Auto-generate invoice number if not provided
    let invoice_number = validated.invoice_number;
    if (!invoice_number) {
      const { data: nextNumber } = await paymentInvoiceRepository.getNextInvoiceNumber(user.id);
      invoice_number = nextNumber || 'INV-00001';
    }

    requestLogger.info({
      userId: user.id,
      invoiceNumber: invoice_number,
      clientName: validated.client_name,
      clientEmail: validated.client_email,
      amount: validated.amount
    }, 'Creating payment invoice');

    const { data, error } = await paymentInvoiceRepository.create({
      user_id: user.id,
      invoice_number,
      contact_id: validated.contact_id || null,
      service_id: validated.service_id || null,
      client_name: validated.client_name,
      client_email: validated.client_email,
      amount: validated.amount,
      currency: validated.currency,
      status: validated.status,
      line_items: validated.line_items,
      due_date: validated.due_date || null,
      payment_terms: validated.payment_terms,
      notes: validated.notes || null,
      internal_notes: validated.internal_notes || null,
      // Undefined stays undefined: the column is nullable and null means "no
      // choice recorded", which is not the same as "no online payment".
      allow_online_payment: validated.allow_online_payment,
      /*
       * The refund state a new invoice starts in.
       *
       * Required by `CreatePaymentInvoiceInput` since the refund columns were
       * added, and omitted here ever since — the one call that creates invoices
       * has not typechecked for the whole of that time. The database defaults
       * cover it at runtime, which is why nothing broke; stating them makes the
       * call honest and the file clean.
       */
      refund_status: 'none',
      refunded_amount: 0,
      refunded_at: null,
      // Initialize other fields
      sent_at: null,
      paid_at: null,
      stripe_invoice_id: null,
      stripe_hosted_invoice_url: null,
      stripe_invoice_pdf: null,
      client_address: null,
      booking_id: null,
    });

    if (error) {
      requestLogger.error({ err: error }, 'Failed to create invoice');
      return NextResponse.json(
        { success: false, error: 'Failed to create invoice' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditTrail.log({
      action: 'PAYMENT_INVOICE_CREATED',
      entityType: 'payment_invoice',
      entityId: data!.id,
      userId: user.id,
      resourceName: invoice_number,
      severity: 'info',
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    /*
     * Deliver it, when that is what was asked for.
     *
     * NOT awaited-and-fatal, and not fire-and-forget either. The invoice exists
     * the moment the row is written, so a delivery failure must not 500 away a
     * record that is really there — but it must not be silent, because the
     * whole complaint is a client who never received anything. So the outcome
     * travels back with the invoice and the caller can say which happened.
     *
     * `sendInvoice` owns the rest: the Stripe-hosted invoice or the branded
     * email, the PDF attachment, and moving the row from draft to sent.
     */
    let delivery: { sent: boolean; error?: string } | undefined;

    if (validated.send && data) {
      const sent = await sendInvoice({
        invoiceId: data.id,
        userId: user.id,
        useStripe: validated.use_stripe,
        request,
        logger: requestLogger,
      });

      delivery = sent.error
        ? { sent: false, error: sent.error.message }
        : { sent: true };

      if (sent.error) {
        requestLogger.error(
          { err: sent.error, invoiceId: data.id },
          'Invoice created but could not be delivered'
        );
      }
    }

    return NextResponse.json({ success: true, data, delivery }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ errors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
