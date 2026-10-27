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
import { businessDayFor, resolveBusinessTimezone } from '@/lib/business-os/businessDay';
import { parseMoneySearch, matchesTerms } from '@/lib/payments/moneySearchTerms';
import {
  buildMoneyItems,
  isLateEntry,
  isLatePeriod,
  todayKey,
  totalMoney,
  type MoneyItem,
  type MoneyPlan,
} from '@/lib/payments/moneyItems';

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
  /*
   * Raised from 100 for the EXPORT.
   *
   * The whole filtered set already exists in memory here — the response slices
   * a page out of `sorted` — and the underlying reads are bounded by
   * GROUPING_CAP regardless, so this cannot return more than that whatever is
   * asked for. The old ceiling meant the orders page's "Export all orders"
   * could only ever save one page, and said nothing about the rest.
   */
  limit: z.coerce.number().int().min(1).max(GROUPING_CAP).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  contact_id: z.string().uuid().optional(),
  filter: z
    .enum(['all', 'unpaid', 'overdue', 'paid', 'refunded', 'plans', 'draft', 'cancelled'])
    .default('all'),
  search: z.string().max(200).optional(),
  sort: z.enum(['date', 'amount', 'client', 'status']).default('date'),
  /**
   * Which kind of row the page window is cut from.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE PAGE WINDOW HAS TO BE CUT PER KIND, OR THE VIEW LIES.
   *
   * The two kinds are shown as two views — a booking CONTAINS its money, an
   * invoice with no booking IS the money — but the split used to happen in the
   * browser, over the ten rows this endpoint had already chosen. So each view
   * showed its share of one mixed page: with 19 bookings and 3 standalone
   * invoices, page 2 held ten bookings and nothing else, and "invoices without
   * an order" rendered empty while the pager still offered three pages. Page 3
   * was the mirror image, with the orders view blank.
   *
   * Paging within the chosen kind is the only arrangement where the count, the
   * pages and the rows agree.
   *
   * Deliberately NOT applied to the summary strip, which keeps describing the
   * whole book for the same reason the KPI filter does not narrow it: figures
   * that re-derive from the view offering them cannot be compared.
   * ───────────────────────────────────────────────────────────────────────────
   */
  kind: z.enum(['all', 'booking', 'standalone']).default('all'),
  /**
   * HOW the money was collected, which is a different axis from `filter`.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `filter` answers "what state is it in" — collected, outstanding, overdue.
   * This answers "how does it arrive" — a bill the owner sends and marks paid,
   * or a card charged at the time. An owner told by the advisor that ₪510 of
   * INVOICES is open needs both halves of that sentence, and until now only
   * the state half was askable: every method was mixed into one list, with no
   * way to narrow to the bills.
   *
   * Its own parameter rather than more `filter` values, because the two have to
   * COMBINE. Folding it in would make "outstanding" and "invoices" mutually
   * exclusive, and the one question behind this change is their intersection.
   *
   * `plan` is the exception that proves the rest: `filter: 'plans'` already
   * filters on `item.method`, and is unreachable from the UI because no tile or
   * control ever set it. It stays for API callers; the new control is how a
   * person reaches it.
   *
   * Like `kind`, deliberately NOT applied to the summary strip. The figures
   * must stay comparable across whatever is being looked at.
   * ───────────────────────────────────────────────────────────────────────────
   */
  method: z.enum(['any', 'invoice', 'direct', 'plan']).default('any'),
});

/** Which rows a filter keeps. Applied after grouping, so it filters ROWS not sources. */
function matchesFilter(item: MoneyItem, filter: string): boolean {
  switch (filter) {
    case 'unpaid':
      return ['awaiting_payment', 'overdue', 'failed'].includes(item.status);
    /*
     * Late, which is a subset of unpaid rather than a rival to it.
     *
     * A row is late when the processor or the overdue sweep said so, OR when a
     * plan period's own due date has passed — periods never carry that status,
     * so a plan months behind would otherwise be invisible to this filter while
     * the overdue FIGURE counted it. The two must agree or clicking the figure
     * shows an emptier list than the number promised.
     */
    case 'overdue': {
      const today = todayKey();
      // The same two rules the figure counts with, so clicking it cannot show a
      // shorter list than the number promised.
      return (
        item.entries.some(entry => isLateEntry(entry, today)) ||
        (item.plan?.periods ?? []).some(
          period =>
            period.status !== 'paid' &&
            period.status !== 'cancelled' &&
            isLatePeriod(period, today)
        )
      );
    }
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
      kind: url.searchParams.get('kind') ?? undefined,
      method: url.searchParams.get('method') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid query' }, { status: 400 });
    }

    const { limit, offset, contact_id, filter, search, sort, kind, method } = parsed.data;

    /*
     * No overdue refresh here any more — the daily payment-reminders cron does
     * the stamping. This ran an UPDATE over `payment_invoices` on every load of
     * the orders page, ahead of the three reads below it.
     *
     * WHAT DOES NOT CHANGE, which is the part that matters:
     *
     * `moneyStatus` maps a stored 'overdue' to 'overdue' and everything else —
     * 'sent' included — to 'awaiting_payment'. Both are in the `unpaid` filter
     * and both are in `OUTSTANDING_STATUSES`, so a late invoice appears in the
     * same filtered lists and the same outstanding totals either way. No row
     * appears or disappears from this endpoint because of this removal.
     *
     * What changes is the LABEL, for at most a day: a newly late invoice reads
     * "awaiting payment" until the cron stamps it, and sorts and exports under
     * that word. The filter that finds it is unaffected.
     */

    // Both sides plus the bookings that head the rows. Scoped by the session's
    // user on every one — that is the only tenant boundary in this system.
    const invoiceQuery = supabaseServer
      .from('payment_invoices')
      // Everything a row needs to say who, what and by when. The previous
      // select carried ids only, so the list could not name a client or a
      // service even though both were sitting in the row.
      .select('id, invoice_number, amount, currency, status, due_date, paid_at, created_at, contact_id, booking_id, refunded_amount, refund_status, sent_at, client_name, client_email, line_items, stripe_invoice_id, stripe_hosted_invoice_url')
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
      /*
       * The client comes from `crm_contacts`, NOT from the booking row.
       *
       * `scheduling_bookings.client_first_name` and its siblings were dropped by
       * `20260810_remove_client_fields_and_total_amount.sql`, which in the same
       * breath made `contact_id` NOT NULL — so every booking has a contact and
       * the join always resolves. Selecting the dropped columns does not degrade
       * gracefully: PostgREST rejects the whole statement with 42703 and the
       * orders list 500s.
       *
       * Same join the transactions query above uses.
       */
      /*
       * `parent_booking_id` rides along so a package can be ONE order.
       *
       * A package or accepted quote writes a head booking plus one child per
       * session, and the payment plan bills a session at a time. Without this
       * column the grouping has no way to know the six sessions of a 450 quote
       * are one thing, and renders six rows of 74.99 each labelled
       * "payment plan · 1 payment".
       */
      .select('id, start_time, created_at, contact_id, parent_booking_id, contact:crm_contacts(first_name, last_name), service:scheduling_services(service_name)')
      .eq('user_id', user.id)
      .order('start_time', { ascending: false })
      .limit(GROUPING_CAP);

    const [invoices, transactions, bookings, preferences] = await Promise.all([
      contact_id ? invoiceQuery.eq('contact_id', contact_id) : invoiceQuery,
      contact_id ? transactionQuery.eq('contact_id', contact_id) : transactionQuery,
      contact_id ? bookingQuery.eq('contact_id', contact_id) : bookingQuery,
      /*
       * The clock, read ALONGSIDE the data rather than before it.
       *
       * It is only needed to turn "october" into a span, which happens after
       * all of this is in hand — so a sequential read here added a round trip
       * to every load of the page, including the ones with nothing typed in the
       * search at all.
       */
      supabaseServer.from('user_preferences').select('timezone').eq('user_id', user.id).maybeSingle(),
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

    /*
     * What came back, per invoice, from the invoices ALREADY READ above.
     *
     * A refund is derived onto the invoice a period raised, never onto the
     * installment row, so the schedule cannot show it without this join. No
     * extra query: `refunded_amount` is already in the invoice select, because
     * the list rows need it too.
     */
    const refundByInvoice = new Map<string, number>();
    for (const invoice of invoices.data ?? []) {
      const amount = Number(invoice.refunded_amount ?? 0);
      if (amount > 0) refundByInvoice.set(String(invoice.id), amount);
    }

    /*
     * And what came back per CHARGE, for the periods that raised no invoice.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The note above is right that a refund is derived onto the invoice a
     * period raised — for a plan BILLED BY INVOICE. A plan charged to a card
     * raises none: Stripe charges the subscription and the refund lands on the
     * `payment_transactions` row, so `invoice_id` on the period is null and the
     * invoice map can never answer for it.
     *
     * Measured 2026-10-26: booking f8df6318, period 1 of 2, $30 charged and
     * returned in full as two refunds of $10 and $20. The drawer's own detail
     * panel read "Refunded · $30.00" off the transaction, while the schedule
     * above it showed "1/2 paid" with period 1 on a green dot — the two halves
     * of one screen disagreeing about the same money.
     *
     * No extra query: `refunded_amount` is already in the transaction select,
     * because the list rows need it too — the same reasoning as the invoice map.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const refundByTransaction = new Map<string, number>();
    for (const transaction of transactions.data ?? []) {
      const amount = Number(transaction.refunded_amount ?? 0);
      if (amount > 0) refundByTransaction.set(String(transaction.id), amount);
    }

    if (bookingIds.length > 0) {
      const { data: installments, error: installmentError } = await supabaseServer
        .from('payment_plan_installments')
        // `currency` rides along so the totals card can keep an installment in
        // its own bucket: a plan need not bill in the currency of the booking
        // its row is grouped under.
        .select('id, payment_plan_id, booking_id, installment_number, amount, currency, due_date, status, paid_at, transaction_id, trigger, invoice_id')
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
          /*
           * How this period becomes billable, and whether it has been.
           * `unpaidPeriods` needs both to tell a debt from an agreement: a
           * milestone nobody has billed is money agreed, not money owed.
           */
          trigger: row.trigger,
          invoiceId: row.invoice_id,
          /* So the schedule can say WHICH period a refund came off, which a
             single total on the row above can never answer.

             The invoice FIRST, because an invoiced period's refund is derived
             onto it; then the charge, for a card-billed period that has no
             invoice at all. Reading only the first left every plan charged to
             a card showing its periods as plainly paid. */
          refundedAmount:
            (typeof row.invoice_id === 'string'
              ? refundByInvoice.get(row.invoice_id) ?? null
              : null) ??
            (typeof row.transaction_id === 'string'
              ? refundByTransaction.get(row.transaction_id) ?? null
              : null),
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
          // The package this session belongs to, so `buildMoneyItems` can fold
          // the sessions and their plan into the one order that was sold.
          parentId: booking.parent_booking_id ?? null,
          // PostgREST returns a to-one join as an object; normalised the same
          // way the transactions mapping above does. Null rather than an empty
          // string when nothing is there, so the fallback chain continues.
          clientName: (() => {
            const c = Array.isArray(booking.contact) ? booking.contact[0] ?? null : booking.contact ?? null;
            return [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || null;
          })(),
        };
      }),
    });

    /*
     * THE SEARCH, READ AS TERMS.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `>500` and `october` are questions about numbers and dates, and the old
     * search could answer neither: it joined every field into one string and
     * asked whether the typed text was a substring of it. "800" matched ₪1,800
     * and invoice 0800, and no date was in the string at all, so the question a
     * money list is asked most often — what came in last month — had no answer.
     *
     * `parseMoneySearch` is the SAME call the search field uses to draw its
     * chips, so a chip on screen and the rows beneath it cannot disagree about
     * what is being filtered.
     *
     * Periods are calendar spans on the BUSINESS's clock, not the server's. A
     * row at 22:00 on 31 October in Jerusalem is 20:00 UTC the same day, but one
     * at 01:00 on 1 November is 23:00 on the 31st in UTC — so a UTC comparison
     * puts it in October for a business that has already turned the page.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /*
     * A failed clock read is NOT fatal: `resolveBusinessTimezone` falls back to
     * UTC, which can move a period boundary by hours but still answers. Failing
     * the whole money list because a preferences row would not load would be
     * the wrong trade.
     */
    const { timezone } = resolveBusinessTimezone({
      preferencesTimezone: preferences.data?.timezone,
    });
    const terms = parseMoneySearch(search ?? '', businessDayFor(new Date(), timezone).date);

    /** An instant as the business writes the date, 'YYYY-MM-DD'. */
    const businessDate = (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return null;
      // 'en-CA' renders ISO order, which is what makes a string compare work.
      return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at);
    };

    /*
     * SEARCH FIRST, FILTER SECOND — and they are kept apart on purpose.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * These used to be one chain, so `totals` described whatever the KPI filter
     * had left. The summary strip reads those totals, and every cell in it is a
     * filter — so clicking "Collected" sent back a response in which outstanding,
     * overdue, cancelled and refunded were all 0, and the strip rewrote itself to
     * four zeroes and one figure. Each click reset the very numbers being
     * compared, which is the opposite of what a summary is for.
     *
     * So the strip gets the whole book and the list gets the filtered slice:
     *
     *   `searched`  — the search applied, the KPI filter NOT. The summary.
     *   `filtered`  — both applied. The rows, the count, the pages.
     *
     * The search stays in both because narrowing to one client should narrow
     * their figures too; it is the reader asking a different question, not the
     * strip filtering itself.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const searched = allItems.filter(item => {
      if (terms.length === 0) return true;
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

      return matchesTerms(terms, {
        amount: item.amount,
        day: businessDate(item.date),
        haystack,
      });
    });

    /*
     * Kind and filter together, because both narrow the LIST. `total` below is
     * this set's size, so the pager offers exactly the pages the chosen view
     * actually has — which is the bug this fixes. A caller that sends no `kind`
     * (the CRM drawer via `fetchContactMoney`) defaults to 'all' and sees the
     * mixed list it always did.
     */
    /*
     * A MIXED ROW BELONGS TO BOTH, which is why this is not a plain equality.
     *
     * A booking can hold a card-paid session AND an invoiced programme, and
     * `moneyItems` marks that row `mixed` rather than picking a side. A strict
     * `item.method === method` would then hide it from Invoices and from Direct
     * alike — findable only under "any", which is the mirror image of the bug
     * these two lists were merged to fix: instead of a row appearing twice, it
     * appears nowhere.
     *
     * It genuinely contains money of each kind, so it answers to each.
     */
    const matchesMethod = (item: MoneyItem) =>
      method === 'any' || item.method === method || item.method === 'mixed';

    const filtered = searched.filter(
      item => matchesFilter(item, filter) && (kind === 'all' || item.kind === kind) && matchesMethod(item)
    );

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

    /*
     * Totals come from `searched`, NOT from `sorted`.
     *
     * Two reasons, and they are different. Not the page, because a total that
     * counted only the visible rows would change as the reader paged. Not the
     * filtered set either, because the strip these feed IS the filter — figures
     * that re-derive from the filter they offer cannot be compared against each
     * other, which is the one thing a summary exists for.
     *
     * Unaffected by this: a caller that sends no `filter` (the CRM drawer via
     * `fetchContactMoney`) defaults to 'all', where `searched` and `filtered`
     * are the same set.
     */
    const totals = totalMoney(searched);

    return NextResponse.json({
      success: true,
      data: {
        items: sorted.slice(offset, offset + limit),
        /** Rows matching BOTH search and filter — what paginates. */
        total: filtered.length,
        totals,
        /** Rows behind `totals`, so the strip can count what it is summing. */
        summaryCount: searched.length,
        truncated,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to build the money list');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
