// app/api/public/invoice/[id]/intent/route.ts

import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { createLogger } from '@/lib/logger';
import { mayViewInvoice } from '@/lib/payments/invoiceAccessToken';
import { raiseInvoiceForPayment } from '@/lib/payments/raiseInvoiceForPayment';
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

  /*
   * This hands out a Stripe client secret, so it is throttled even though the id in front of it is unguessable.
   */
  const throttle = await rateLimit(request, 'invoice-intent', RATE_LIMITS.read);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);
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
      .select(
        'id, user_id, status, amount, currency, stripe_invoice_id, paid_at, refund_status, sent_at, created_at'
      )
      .eq('id', invoiceId)
      .maybeSingle();

    if (!invoice) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    /*
     * THE SAME DOOR AS THE PAGE.
     *
     * This endpoint hands out a Stripe client secret and states the amount and
     * the connected account, so it must not be reachable on terms the page
     * would refuse. An endpoint that is more permissive than the document it
     * serves is the way in, whatever the page does.
     *
     * `not_found`, matching the page's `notFound()`: an expired link should not
     * confirm that an invoice with this id exists.
     */
    const access = await mayViewInvoice({
      invoiceId,
      token: request.nextUrl.searchParams.get('t'),
      issuedAt: (invoice.sent_at as string | null) ?? (invoice.created_at as string | null),
    });

    if (!access.allowed) {
      log.info({ reason: access.reason }, 'Refused an invoice payment secret');
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE NUMBER THAT DECIDES WHEN BARE URLS STOP BEING HONOURED.
     *
     * `fresh` means this caller presented no token and was admitted only
     * because the invoice is younger than the grace window. Every link minted
     * since this shipped carries a token, so this count is made entirely of
     * links sent BEFORE it — and it should fall to zero within one window.
     *
     * When it does, `INVOICE_BARE_URL_GRACE_DAYS=0` collapses the rule to
     * "signed links only". Logged so that decision comes from a measurement
     * rather than from a guess at a date, which is also what an auditor asks
     * for: evidence of why a control was tightened when it was.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (access.reason === 'fresh') {
      log.info({ reason: 'fresh' }, 'Invoice payment secret served to a bare URL');
    }

    // Nothing to collect. Said plainly rather than returning a secret that
    // would charge a second time.
    if (invoice.status === 'paid' || invoice.paid_at) {
      return NextResponse.json({ success: false, error: 'already_paid' }, { status: 409 });
    }
    if (invoice.refund_status && invoice.refund_status !== 'none') {
      return NextResponse.json({ success: false, error: 'refunded' }, { status: 409 });
    }
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * RAISE IT IF IT IS NOT THERE YET.
     *
     * Accepting a quote raises the invoice at Stripe now, so most arrivals
     * already have one. Two kinds do not: invoices accepted before that
     * changed, and invoices a business wrote by hand.
     *
     * Without this they show bank details and no card — which is what broke
     * when the portal replaced the Pay LINK (which built a Checkout Session on
     * demand) with an embedded form (which needs the invoice to exist).
     *
     * Idempotent and silent: one invoice per debt, and Stripe emails nobody.
     * It never throws; a business with no processor gets `cannot_collect` and
     * keeps its bank details.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let stripeInvoiceId = invoice.stripe_invoice_id as string | null;

    if (!stripeInvoiceId) {
      const raised = await raiseInvoiceForPayment(invoice.id as string, invoice.user_id as string);

      if (!raised.ok) {
        log.info({ reason: raised.reason }, 'Invoice cannot be raised for card payment');
        return NextResponse.json({ success: false, error: 'not_billed_yet' }, { status: 409 });
      }

      stripeInvoiceId = raised.stripeInvoiceId;
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
      stripeInvoiceId,
      { expand: ['confirmation_secret'] },
      { stripeAccount: capability.accountId }
    );

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * STRIPE DECIDES WHETHER MONEY HAS MOVED. WE DO NOT.
     *
     * The check above reads OUR invoice row, and that row can be wrong: a
     * payment recorded by `payment_intent.succeeded` under its own key, then
     * `invoice.paid` failing to insert a second row for the same money, leaves
     * the money taken and `payment_invoices.status` still `overdue`. Ten
     * invoices on this database are in exactly that state.
     *
     * For those, everything above passes, a confirmation secret comes back —
     * Stripe keeps one on a settled invoice — and the Payment Element mounts
     * against a PaymentIntent that has already succeeded. It renders NOTHING,
     * which is Stripe refusing to charge a client twice, and the client sees
     * an empty box under a Pay button for a bill they have already paid.
     *
     * So the processor's own answer wins. This fixes the double-charge
     * attempt, not the stale row: reconciling that is a money write and
     * belongs nowhere near a public GET.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (stripeInvoice.status === 'paid' || Number(stripeInvoice.amount_due ?? 0) === 0) {
      log.warn(
        {
          stripeInvoiceId: invoice.stripe_invoice_id,
          ourStatus: invoice.status,
          stripeStatus: stripeInvoice.status,
        },
        'Invoice is settled at Stripe but not in our records; refusing to collect again'
      );
      return NextResponse.json({ success: false, error: 'already_paid' }, { status: 409 });
    }

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
