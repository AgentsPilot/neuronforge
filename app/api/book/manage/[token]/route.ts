// app/api/book/manage/[token]/route.ts
// Self-service booking management endpoint
// Allows clients to view their booking details using a signed token

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken, generateBookingToken } from '@/lib/services/BookingEmailService';
import { generateProposalToken } from '@/lib/business-os/proposalToken';
import { resolveIntakeForSending } from '@/lib/business-os/intake/resolveIntake';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';

const logger = createLogger({ module: 'API', service: 'BookingManage' });

// GET /api/book/manage/[token]
// Returns booking details for the token holder
/**
 * The other meetings of this package, each with its own link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns [] for an ordinary booking, which is almost all of them — one query,
 * and only when the row says it belongs to a package.
 *
 * `canModify` is computed per meeting against the SAME notice window the cancel
 * and reschedule routes enforce, so the page never offers an action that is
 * about to be refused. The token is minted here because this request has just
 * proved the caller holds a valid one for this client's booking; signing a
 * sibling for the same address grants nothing new.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function packageMeetings(
  booking: { id: string; parent_booking_id?: string | null; user_id: string },
  clientEmail: string,
  noticeHours: number,
  now: Date
) {
  const containerId = booking.parent_booking_id ?? booking.id;

  const { data: rows } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, start_time, end_time, status, occurrence_number')
    .eq('parent_booking_id', containerId)
    .eq('user_id', booking.user_id)
    .order('occurrence_number', { ascending: true });

  if (!rows?.length) return [];

  return rows.map(row => {
    const start = row.start_time ? new Date(row.start_time as string) : null;
    const hoursAway = start ? (start.getTime() - now.getTime()) / 3_600_000 : null;

    return {
      id: row.id as string,
      occurrenceNumber: row.occurrence_number as number | null,
      startTime: row.start_time as string | null,
      endTime: row.end_time as string | null,
      status: row.status as string,
      /*
       * The same three conditions the single booking is judged by: it has to be
       * standing, dated, and far enough away.
       */
      canModify: row.status === 'confirmed' && hoursAway !== null && hoursAway > noticeHours,
      /** Why not, when not — so the row can say it rather than go quiet. */
      tooSoon: row.status === 'confirmed' && hoursAway !== null && hoursAway <= noticeHours,
      token: generateBookingToken(row.id as string, clientEmail),
      /** This one, so the page can mark where the client came in. */
      isCurrent: row.id === booking.id,
    };
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Verify token
    const decoded = verifyBookingToken(token);
    if (!decoded) {
      requestLogger.warn('Invalid or expired booking token');
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;
    requestLogger.info({ bookingId }, 'Fetching booking for self-service');

    /*
     * Fetched with the service and the contact.
     *
     * `min_notice_hours` is the business's own notice rule, which the cancel and
     * reschedule routes already enforce. This page hardcoded 24, so a service
     * asking for 48 told the client they could still cancel and then refused
     * them. Same number on both sides now.
     *
     * NOTHING but column names may appear between these backticks: PostgREST is
     * sent the string verbatim and rejects the whole select on anything else,
     * which 404s every client's link. Comments go here.
     *
     * Note: client_* fields removed from scheduling_bookings - now JOINed from
     * crm_contacts.
     */
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        contact_id,
        start_time,
        end_time,
        timezone,
        status,
        payment_status,
        notes,
        intake_completed_at,
        user_id,
        contact:crm_contacts(
          first_name,
          last_name,
          email,
          phone
        ),
        service:scheduling_services(
          id,
          service_name,
          description,
          duration_minutes,
          price,
          currency,
          min_notice_hours,
          sale_mode,
          is_scheduled
        ),
        parent_booking_id,
        occurrence_number
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      requestLogger.warn({ error, bookingId }, 'Booking not found');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Get contact data from the JOIN
    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
    const contactEmail = contact?.email || '';

    // Verify the email matches the token's email (security check)
    if (contactEmail.toLowerCase() !== email.toLowerCase()) {
      requestLogger.warn({ bookingId, tokenEmail: email, contactEmail }, 'Email mismatch');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    /*
     * The business's real identity, from the one public resolver.
     *
     * This used to be a direct profile select whose result was flattened into
     * `primaryColor: '#4F46E5'` with a comment explaining that the column did
     * not exist. It was half right — there is no `primary_color` column — but
     * the colour was never missing: it lives in `theme`, the same JSONB the
     * confirmation email that carried this very link already reads. So a client
     * got a correctly branded email and then landed on a platform-indigo page.
     */
    const brand = await resolvePublicBranding({ by: 'userId', userId: booking.user_id });

    /*
     * Whether the client may still change this themselves.
     *
     * ───────────────────────────────────────────────────────────────────────────
     * A PRODUCT HAS NO START TIME, AND THE 24-HOUR RULE IS MEANINGLESS FOR IT.
     *
     * `start_time` is nullable — `20260803_allow_null_booking_times.sql` — and
     * this read it straight into `new Date()`, which turns null into the Unix
     * epoch. Everything downstream then followed from a date in 1970: the
     * appointment card showed "1 January 1970", and `hoursUntilBooking` came out
     * around minus half a million, so `canModify` was false. The client clicked
     * Cancel in their confirmation email, were shown a 1970 appointment, and told
     * it was too late to cancel it.
     *
     * Both halves are now decisions rather than arithmetic accidents: an order
     * has no self-service window because there is no slot to free, and the
     * hours are only counted when there is a time to count to.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const now = new Date();
    const startTime = booking.start_time ? new Date(booking.start_time) : null;
    const hoursUntilBooking = startTime
      ? (startTime.getTime() - now.getTime()) / (1000 * 60 * 60)
      : null;

    const service = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const noticeHours = Number(
      (service as { min_notice_hours?: number } | null)?.min_notice_hours ?? 24
    );

    const canModify =
      booking.status === 'confirmed' &&
      hoursUntilBooking !== null &&
      hoursUntilBooking > noticeHours;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * WHERE THE QUOTE STANDS, when this booking exists to produce one.
     *
     * A `sale_mode: 'proposal'` service is a consultation that ends in a price:
     * the client comes in, the business works something out, a quote follows.
     * Until now the portal showed the appointment and stopped, so a client who
     * had the meeting a fortnight ago saw "took place" and nothing else — no
     * sign that a quote was coming, no sign that one had already been sent, and
     * nothing to open. The only way to find out was to email and ask.
     *
     * Two states, and the client should never have to guess which they are in:
     *   · nothing raised yet — say it is being prepared;
     *   · raised — say where it stands, name the figure, and link to it.
     *
     * The NEWEST is the one that counts. A revised quote supersedes the one
     * before it, and showing a client the first of three would quote them a
     * price nobody is offering any more.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * WHAT THE CLIENT OWES, OR HAS PAID — for every kind of booking.
     *
     * The card showed money only where the SERVICE carried a price, which is
     * one of the nine shapes this business actually sells. A consultation
     * quoted at ₪450, an appointment invoiced to be paid later, a product on a
     * six-period plan: in all of those the service's own price is zero or
     * irrelevant, and the client was shown nothing at all about money they owe.
     *
     * Derived from the invoices and the plan rather than from
     * `booking.payment_status`, which holds only `pending | paid | refunded`
     * and cannot say how much, by when, or how far through a plan someone is.
     * `payment_status` is still the fallback where there are no invoices —
     * a checkout that settled straight to a transaction — because there it is
     * the only answer anyone has.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const [{ data: invoices }, { data: installments }] = await Promise.all([
      supabaseServer
        .from('payment_invoices')
        .select('amount, currency, status, due_date')
        .eq('booking_id', booking.id)
        .eq('user_id', booking.user_id),
      supabaseServer
        .from('payment_plan_installments')
        .select('status, amount, currency, due_date, invoice_id')
        .eq('booking_id', booking.id)
        .eq('user_id', booking.user_id),
    ]);

    /* Everything still standing: a cancelled or voided invoice is not owed. */
    const owing = (invoices ?? []).filter(invoice =>
      ['draft', 'sent', 'overdue'].includes(String(invoice.status))
    );
    const settled = (invoices ?? []).filter(invoice => String(invoice.status) === 'paid');

    /*
     * AGREED BUT NOT YET BILLED.
     *
     * A quote's stages are projected the moment it is accepted and invoiced one
     * at a time — a deposit now, a milestone when the work is done. Counting
     * only invoices made six of this business's bookings report nothing owed
     * while the client had agreed to pay, because the next stage had not been
     * raised yet.
     *
     * `invoice_id IS NULL` is what keeps it from double counting: a stage that
     * HAS been billed is already in `owing` above, under its invoice.
     */
    const unbilled = (installments ?? []).filter(
      row => String(row.status) === 'pending' && !row.invoice_id
    );

    const outstanding =
      owing.reduce((sum, invoice) => sum + Number(invoice.amount ?? 0), 0) +
      unbilled.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    const paidTotal = settled.reduce((sum, invoice) => sum + Number(invoice.amount ?? 0), 0);

    /*
     * The soonest deadline, since that is the one that matters to the client.
     *
     * A stage with no due date is waiting on the BUSINESS — a milestone billed
     * when the work is done — so it contributes a sum but never a deadline, and
     * the client is not given a date nobody set.
     */
    const dueDate =
      [
        ...owing.map(invoice => invoice.due_date as string | null),
        ...unbilled.map(row => row.due_date as string | null),
      ]
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null;

    const plan =
      installments && installments.length > 0
        ? {
            paid: installments.filter(row => String(row.status) === 'paid').length,
            total: installments.length,
          }
        : null;

    const moneyCurrency =
      (owing[0]?.currency as string) ||
      (settled[0]?.currency as string) ||
      (unbilled[0]?.currency as string) ||
      ((service as { currency?: string | null } | null)?.currency ?? null);

    const payment = {
      /*
       * `refunded` first: money that went back is the most recent thing that
       * happened to it, and reporting an outstanding balance on a refunded
       * booking would ask a client to pay for something they were released from.
       */
      state:
        booking.payment_status === 'refunded'
          ? ('refunded' as const)
          : outstanding > 0
            ? ('due' as const)
            : paidTotal > 0 || booking.payment_status === 'paid'
              ? ('paid' as const)
              : ('none' as const),
      amount: outstanding > 0 ? outstanding : paidTotal > 0 ? paidTotal : null,
      currency: moneyCurrency,
      dueDate,
      overdue: owing.some(invoice => String(invoice.status) === 'overdue'),
      plan,
    };

    /*
     * Whether this booking has a form to fill in at all. Asked of the service
     * as well as the business, because a quote request or a product has no
     * occasion for one however the settings are configured.
     */
    const { form: intakeForm } =
      booking.status === 'cancelled'
        ? { form: null }
        : await resolveIntakeForSending(booking.user_id, {
            service: service as { sale_mode?: string | null; is_scheduled?: boolean | null } | null,
          });

    const quotesExpected =
      (service as { sale_mode?: string | null } | null)?.sale_mode === 'proposal';

    let quote: {
      status: string;
      total: number | null;
      currency: string | null;
      token: string | null;
    } | null = null;

    if (quotesExpected) {
      const { data: proposal } = await supabaseServer
        .from('proposals')
        .select('id, status, total, currency')
        .eq('booking_id', booking.id)
        .eq('user_id', booking.user_id)
        .neq('status', 'superseded')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (proposal) {
        quote = {
          status: proposal.status as string,
          total: proposal.total === null ? null : Number(proposal.total),
          currency: (proposal.currency as string) || null,
          /*
           * Its own signed link, minted the same way and for the same reason
           * the package's sibling tokens are: this request has already proved
           * the caller holds a valid token for this client's address, and the
           * quote is addressed to that same client. A `draft` gets none — it
           * has not been sent, and a link would be the business showing work it
           * has not finished.
           */
          token:
            contactEmail && proposal.status !== 'draft'
              ? generateProposalToken(proposal.id as string, contactEmail)
              : null,
        };
      }
    }

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
        clientEmail: contactEmail,
        startTime: booking.start_time,
        endTime: booking.end_time,
        timezone: booking.timezone,
        status: booking.status,
        paymentStatus: booking.payment_status,
        notes: booking.notes,
        service: booking.service,
        canReschedule: canModify,
        canCancel: canModify,
        /*
         * Null, not 0, when there is no appointment. Zero reads as "it is
         * happening now", which is a different and wrong statement.
         */
        hoursUntilBooking:
          hoursUntilBooking === null ? null : Math.max(0, Math.floor(hoursUntilBooking)),
        /** False for a product purchase: nothing about it is scheduled. */
        isScheduled: Boolean(booking.start_time)
      },
      /** Null unless this booking is one that produces a quote. */
      quote: quotesExpected ? quote : undefined,
      /** True when a quote is expected and none has been raised yet. */
      awaitingQuote: quotesExpected && !quote,
      /** What is owed or has been paid, however this booking was sold. */
      payment,
      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE INTAKE FORM, as the portal needs to know about it.
       *
       * The form had exactly one way in: the link in the email that asked for
       * it. A client who archived that mail, or filled half of it in and came
       * back later, had no route to it from the portal — and one who HAD
       * completed it got no acknowledgement anywhere, so the only way to be
       * sure was to open the old link and see.
       *
       * `required` asks the same question the sending path asks, through the
       * same function, so the portal cannot offer a form the business would
       * refuse to send — it is withheld when intake is switched off, when
       * nothing is published, and when the service is one with no occasion for
       * a form (a quote request, a product).
       * ───────────────────────────────────────────────────────────────────────
       */
      intake: {
        required: Boolean(intakeForm),
        completed: Boolean(booking.intake_completed_at),
      },
      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE WHOLE BLOCK, when this booking is one meeting of a package.
       *
       * The client had a link to the FIRST meeting and to nothing else. Every
       * later one arrives with its own reminder 24 hours ahead — which, for a
       * service whose notice window is 24 hours, is exactly when the policy
       * stops allowing a change. So a client wanting to cancel session five a
       * month in advance could not, and the one time they were handed a link
       * was the time it was refused.
       *
       * Each sibling carries its OWN signed token, minted here because the
       * server already knows the client's address and has just proved it
       * matches this token. The cancel and reschedule routes are untouched:
       * they verify a token and enforce the notice window exactly as they do
       * for a single booking, which is the whole point — same policy, one
       * meeting at a time.
       * ───────────────────────────────────────────────────────────────────────
       */
      meetings: await packageMeetings(booking, contactEmail, noticeHours, now),
      business: brand ? {
        name: brand.businessName,
        logoUrl: brand.logoUrl,
        /** Complete — pages read colours from here rather than guessing. */
        theme: brand.theme,
        /**
         * Retained so the pages that still read a flat colour keep working
         * while they are migrated onto `theme`. Deprecated: remove once none
         * of the `/book/manage/*` pages reference it.
         */
        primaryColor: brand.theme.colors.primary,
        websiteUrl: brand.info.websiteUrl,
        language: brand.locale,
        dir: brand.dir,
        userCode: brand.userCode,
        info: brand.info
      } : null
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching booking');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch booking' },
      { status: 500 }
    );
  }
}
