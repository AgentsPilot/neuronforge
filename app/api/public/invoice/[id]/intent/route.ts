// app/api/public/invoice/[id]/intent/route.ts

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { createLogger } from '@/lib/logger';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'public-invoice-intent' });

/**
 * The secret a client's browser needs to pay THIS invoice, in the portal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECRET AND NOT A REDIRECT
 *
 * Paying used to mean leaving: `pay/route.ts` 302s to Stripe's hosted invoice
 * page, or to a Checkout Session when there is none. The client lands on
 * `invoice.stripe.com` in the middle of settling a bill from a business whose
 * page they were just on, and nothing around the card field is the business's.
 *
 * Handing the browser a client secret instead lets Stripe's Payment Element
 * render inside the invoice page. Stripe still owns the card fields — they are
 * its iframe — so nothing about PCI changes; only the frame around them does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS ROUTE EXISTS TO KEEP
 *
 * It CONFIRMS what Stripe already created. It does not create a PaymentIntent,
 * does not update one, and writes no metadata — above all not `owner_id`.
 *
 * That is not stylistic. `payment_intent.succeeded` and `invoice.paid` dedupe
 * on different keys, so both recording one payment ends in a unique-constraint
 * throw that leaves the money taken and the invoice unpaid. The only thing
 * preventing it is that an invoice's PaymentIntent is Stripe's own and carries
 * no `owner_id`, so the first handler drops it and `invoice.paid` stays the
 * single recorder. Stamping an owner here would remove that.
 * `app/api/stripe/__tests__/invoiceIntentsStayUnowned.guard.test.ts` asserts it.
 *
 * On this API version an Invoice has no `payment_intent`; the secret is
 * `confirmation_secret`, which is the same field the subscription path already
 * expands (`app/api/website/payment-intent/route.ts`).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const log = logger.child({ correlationId, invoiceId });

  try {
    /*
     * `supabaseServer` deliberately: this is an unauthenticated public route
     * and the invoice id in the URL is the authorisation, exactly as it is for
     * the page that renders it. Only the fields needed to raise a payment are
     * read, and none of them are another tenant's.
     */
    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('id, user_id, status, amount, currency, stripe_invoice_id, paid_at, refund_status')
      .eq('id', invoiceId)
      .maybeSingle();

    if (!invoice) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    // Nothing to collect. Said plainly rather than returning a secret that
    // would charge a second time.
    if (invoice.status === 'paid' || invoice.paid_at) {
      return NextResponse.json({ success: false, error: 'already_paid' }, { status: 409 });
    }
    if (invoice.refund_status && invoice.refund_status !== 'none') {
      return NextResponse.json({ success: false, error: 'refunded' }, { status: 409 });
    }
    if (!invoice.stripe_invoice_id) {
      // Agreed but never billed — a quote stage waiting on the business. There
      // is nothing at Stripe to pay against yet, and that is not an error.
      return NextResponse.json({ success: false, error: 'not_billed_yet' }, { status: 409 });
    }

    const capability = await resolvePaymentCollectionCapability(supabaseServer, invoice.user_id);
    if (!capability.canCollect) {
      log.info({ reason: capability.reason }, 'Invoice cannot be collected online');
      return NextResponse.json(
        { success: false, error: 'cannot_collect', reason: capability.reason },
        { status: 409 }
      );
    }

    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey || !process.env.STRIPE_SECRET_KEY) {
      log.error({}, 'Stripe keys are not configured');
      return NextResponse.json({ success: false, error: 'unconfigured' }, { status: 503 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    /*
     * Retrieved and EXPANDED, never created. `confirmation_secret` is the
     * secret for the intent Stripe raised when this invoice was finalised.
     */
    const stripeInvoice = await stripe.invoices.retrieve(
      invoice.stripe_invoice_id,
      { expand: ['confirmation_secret'] },
      { stripeAccount: capability.accountId }
    );

    const clientSecret = stripeInvoice.confirmation_secret?.client_secret ?? null;

    if (!clientSecret) {
      /*
       * A draft invoice has no intent behind it yet. Reported rather than
       * guessed at: finalising one here would bill a client from a GET.
       */
      log.warn(
        { stripeInvoiceId: invoice.stripe_invoice_id, status: stripeInvoice.status },
        'Invoice carries no confirmation secret'
      );
      return NextResponse.json({ success: false, error: 'no_secret' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      clientSecret,
      connectedAccountId: capability.accountId,
      publishableKey,
      amount: Number(invoice.amount ?? 0),
      currency: (invoice.currency ?? 'USD').toUpperCase(),
    });
  } catch (error) {
    log.error({ err: error }, 'Could not raise an invoice payment secret');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to start payment',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
