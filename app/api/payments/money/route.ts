/**
 * The money list, grouped on the server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SERVER ENDPOINT AND NOT CLIENT-SIDE GROUPING
 *
 * The CRM drawer groups invoices and payments in the browser, which is correct
 * there: one contact's money is small enough to fetch whole, so every invoice
 * and every payment that settles it are both present.
 *
 * At business scale they are not. Both list components paginate server-side at
 * ten rows a page, and grouping across two independently paginated sources is
 * wrong in a way that looks right: if INV-00005 is on page 1 of invoices while
 * the transaction that settled it is on page 3 of transactions, the grouped row
 * shows "awaiting payment" for money that has already arrived. That is the exact
 * class of false statement this whole area of work exists to remove.
 *
 * So the grouping happens where both sides are visible at once — here — and the
 * page window is applied to the GROUPED items rather than to either source.
 *
 * It reuses `buildMoneyItems`, the same pure function the drawer uses, so the
 * two surfaces cannot drift into disagreeing about what a client has paid.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   GET /api/payments/money?limit=20&offset=0&filter=unpaid
 *
 * @module app/api/payments/money
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { buildMoneyItems, totalMoney, type MoneyItem, type MoneyPlan } from '@/lib/payments/moneyItems';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'MoneyListAPI' });

/**
 * How much money is read before grouping.
 *
 * Grouping needs both sides of a pairing in memory, so this cannot be the page
 * size — it has to cover everything that could belong to a row on the page. A
 * cap is still required, because an unbounded read is how a report takes the
 * database down.
 *
 * 2,000 records covers any realistic small business's history. When it is
 * exceeded the response says so via `truncated`, rather than quietly showing a
 * shorter list and letting the totals under-report.
 */
const GROUPING_CAP = 2000;

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  contact_id: z.string().uuid().optional(),
  filter: z.enum(['all', 'unpaid', 'paid', 'refunded', 'plans', 'draft', 'cancelled']).default('all'),
  search: z.string().max(200).optional(),
  sort: z.enum(['date', 'amount', 'client', 'status']).default('date'),
});

/** Which rows a filter keeps. Applied after grouping, so it filters ROWS not sources. */
function matchesFilter(item: MoneyItem, filter: string): boolean {
  switch (filter) {
    case 'unpaid':
      return ['awaiting_payment', 'overdue', 'failed'].includes(item.status);
    case 'paid':
      return ['paid', 'partially_refunded', 'refunded'].includes(item.status);
    case 'refunded':
      return item.refunded > 0;
    case 'plans':
      return item.method === 'plan';
    // Draft and cancelled had no filter at all, so those invoices could not be
    // found from this list.
    case 'draft':
      return item.status === 'draft';
    case 'cancelled':
      return item.status === 'cancelled';
    default:
      return true;
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
      contact_id: url.searchParams.get('contact_id') ?? undefined,
      filter: url.searchParams.get('filter') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      // Was missing, so `sort` always fell back to its default: the dropdown
      // re-fetched and returned the same date-ordered list, with no error to
      // show anything had gone wrong.
      sort: url.searchParams.get('sort') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid query' }, { status: 400 });
    }

    const { limit, offset, contact_id, filter, search, sort } = parsed.data;

    // Refresh overdue before reading, exactly as /api/payments/invoices does.
    // Without it an invoice only becomes overdue when somebody happens to visit
    // the other page, so this list would quietly under-report what is late.
    await paymentInvoiceRepository.markOverdueInvoices(user.id).catch(err =>
      requestLogger.warn({ err }, 'Could not refresh overdue invoices (non-blocking)')
    );

    // Both sides plus the bookings that head the rows. Scoped by the session's
    // user on every one — that is the only tenant boundary in this system.
    const invoiceQuery = supabaseServer
      .from('payment_invoices')
      // Everything a row needs to say who, what and by when. The previous
      // select carried ids only, so the list could not name a client or a
      // service even though both were sitting in the row.
      .select('id, invoice_number, amount, currency, status, due_date, paid_at, created_at, contact_id, booking_id, refunded_amount, refund_status, client_name, client_email, line_items, stripe_invoice_id, stripe_hosted_invoice_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(GROUPING_CAP);

    const transactionQuery = supabaseServer
      .from('payment_transactions')
      // The contact join the transactions list already uses, plus the fields a
      // support conversation needs: how it was paid, and its Stripe reference.
      // `metadata` carries which plan period a payment is — the flag the drawer
      // reads to label it a payment plan rather than a service, and the numbers
      // the browser phrases in the reader's language. Left out of this list, a
      // plan payment arrived indistinguishable from an ad-hoc one: labelled
      // "שירות", and titled with the English sentence the webhook stored.
      .select('id, amount, currency, status, description, metadata, invoice_id, booking_id, service_id, contact_id, paid_at, created_at, refunded_amount, refund_status, payment_method, refunded_at, refund_reason, processor_type, stripe_payment_intent_id, stripe_charge_id, contact:crm_contacts(first_name, last_name, email)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(GROUPING_CAP);

    const bookingQuery = supabaseServer
      .from('scheduling_bookings')
      .select('id, start_time, created_at, contact_id, service:scheduling_services(service_name)')
      .eq('user_id', user.id)
      .order('start_time', { ascending: false })
      .limit(GROUPING_CAP);

    const [invoices, transactions, bookings] = await Promise.all([
      contact_id ? invoiceQuery.eq('contact_id', contact_id) : invoiceQuery,
      contact_id ? transactionQuery.eq('contact_id', contact_id) : transactionQuery,
      contact_id ? bookingQuery.eq('contact_id', contact_id) : bookingQuery,
    ]);

    if (invoices.error || transactions.error || bookings.error) {
      throw invoices.error ?? transactions.error ?? bookings.error;
    }

    const truncated =
      (invoices.data?.length ?? 0) >= GROUPING_CAP ||
      (transactions.data?.length ?? 0) >= GROUPING_CAP;

    if (truncated) {
      // Said out loud rather than left to be inferred from a short list. A
      // silently truncated money report is a wrong money report.
      requestLogger.warn({ userId: user.id }, 'Money list hit the grouping cap; totals are partial');
    }

    // The projected periods of any payment plan, so a plan row can show
    // "2 of 3" and expand into its schedule. `plansByBookingId` was never
    // passed before, which meant `item.plan` was always undefined, `method` was
    // never 'plan', and the plans filter could only ever return nothing.
    const plansByBookingId: Record<string, MoneyPlan> = {};
    const bookingIds = (bookings.data ?? []).map(b => b.id);

    if (bookingIds.length > 0) {
      const { data: installments, error: installmentError } = await supabaseServer
        .from('payment_plan_installments')
        // `currency` rides along so the totals card can keep an installment in
        // its own bucket: a plan need not bill in the currency of the booking
        // its row is grouped under.
        .select('id, payment_plan_id, booking_id, installment_number, amount, currency, due_date, status, paid_at, transaction_id')
        .eq('user_id', user.id)
        .in('booking_id', bookingIds)
        .order('installment_number');

      if (installmentError) {
        // Said out loud. Discarded, this made every payment plan vanish from the
        // list and the `plans` filter return nothing — indistinguishable from a
        // business that has no plans.
        requestLogger.warn({ err: installmentError }, 'Could not read payment plan installments');
      }

      for (const row of installments ?? []) {
        if (!row.booking_id) continue;
        const plan = (plansByBookingId[row.booking_id] ??= {
          id: row.payment_plan_id ?? row.booking_id,
          installmentCount: 0,
          periodsPaid: 0,
          status: 'active',
          periods: [],
        });

        plan.periods.push({
          id: row.id,
          installmentNumber: row.installment_number,
          amount: Number(row.amount),
          currency: row.currency,
          dueDate: row.due_date,
          status: row.status,
          paidAt: row.paid_at,
          transactionId: row.transaction_id,
        });
        plan.installmentCount = plan.periods.length;
        // Counted from the periods themselves rather than a stored figure, so
        // the "2 of 3" on screen cannot disagree with the rows beneath it.
        plan.periodsPaid = plan.periods.filter(p => p.status === 'paid').length;
      }
    }

    /*
     * The plans themselves, so a stopped plan does not read as running.
     *
     * `plansByBookingId` is built from the projected INSTALLMENTS, which carry
     * no plan status — so every plan was labelled `active`, cancelled ones
     * included, and there was no handle to stop one from this screen because the
     * subscription's own id never reached the client.
     */
    if (bookingIds.length > 0) {
      const { data: subscriptions } = await supabaseServer
        .from('payment_plan_subscriptions')
        .select('id, booking_id, status')
        .eq('user_id', user.id)
        .in('booking_id', bookingIds);

      for (const subscription of subscriptions ?? []) {
        const plan = subscription.booking_id
          ? plansByBookingId[subscription.booking_id]
          : undefined;
        if (!plan) continue;

        plan.subscriptionId = subscription.id;
        plan.status = subscription.status ?? plan.status;
      }
    }

    const allItems = buildMoneyItems({
      plansByBookingId,
      invoices: invoices.data ?? [],
      // PostgREST returns a to-one join as an object, but the generated types
      // say array. Normalised here so the shape the grouping sees is the shape
      // it declares.
      transactions: (transactions.data ?? []).map(t => ({
        ...t,
        contact: Array.isArray(t.contact) ? t.contact[0] ?? null : t.contact ?? null,
      })),
      bookings: (bookings.data ?? []).map(booking => {
        const service = booking.service as { service_name?: string } | null;
        return {
          id: booking.id,
          title: service?.service_name ?? 'Booking',
          // Products carry no time slot, so they fall back to their order date.
          startTime: booking.start_time ?? booking.created_at ?? null,
          contactId: booking.contact_id,
        };
      }),
    });

    const needle = search?.trim().toLowerCase();
    const filtered = allItems
      .filter(item => matchesFilter(item, filter))
      .filter(item => {
        if (!needle) return true;
        // Client name, email, invoice number and amount — what the old lists
        // matched. Searching only the title meant an invoice could not be found
        // by the person it was sent to.
        const haystack = [
          item.title,
          item.contactName,
          String(item.amount),
          ...item.entries.flatMap(e => [e.invoiceNumber, e.contactName, e.contactEmail, e.description]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });

    /**
     * Order, applied before the page window.
     *
     * Sorting the twenty rows already fetched would reorder the page rather than
     * the list — "largest first" would show the largest of an arbitrary twenty.
     *
     * `status` orders by how much it wants attention rather than alphabetically:
     * a list sorted by status exists to bring problems to the top, and
     * "cancelled" before "overdue" is the wrong end.
     */
    const STATUS_URGENCY = ['failed', 'overdue', 'awaiting_payment', 'partially_refunded', 'refunded', 'paid', 'draft', 'cancelled'];

    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case 'amount':
          return b.amount - a.amount;
        case 'client':
          return (a.contactName ?? '\uffff').localeCompare(b.contactName ?? '\uffff');
        case 'status':
          return STATUS_URGENCY.indexOf(a.status) - STATUS_URGENCY.indexOf(b.status);
        default:
          return (b.date ?? '').localeCompare(a.date ?? '');
      }
    });

    // Totals cover the WHOLE filtered set, not the page. A total that only
    // counted the visible rows would change as the reader paged, which is worse
    // than no total.
    const totals = totalMoney(sorted);

    return NextResponse.json({
      success: true,
      data: {
        items: sorted.slice(offset, offset + limit),
        total: filtered.length,
        totals,
        truncated,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to build the money list');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
