// app/api/book/manage/[token]/route.ts
// Self-service booking management endpoint
// Allows clients to view their booking details using a signed token

import { resolvePortalAccess } from '@/lib/security/portalAccess';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';
import { NextRequest, NextResponse } from 'next/server';

import type { PortalResponse } from '@/types/portal';
import { createLogger } from '@/lib/logger';
import { generateBookingToken } from '@/lib/services/bookingToken';
import { generateProposalToken } from '@/lib/business-os/proposalToken';
import { generateInvoiceToken } from '@/lib/payments/invoiceAccessToken';
import { resolveIntakeForSending } from '@/lib/business-os/intake/resolveIntake';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';

const logger = createLogger({ module: 'API', service: 'BookingManage' });

/**
 * Is this appointment still the client's to move or call off?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `held` and `cancelled` are answers, and both make the offer a contradiction:
 * one cannot move a meeting that already happened, nor call off one that is
 * already off. The client portal was offering both, because it read the job's
 * `status` — which those outcomes deliberately leave alone.
 *
 * `no_show` is NOT excluded, and that is the point of listing them rather than
 * testing for "any outcome": a missed appointment is unresolved, and the client
 * choosing another time is exactly the right next move. The repository handles
 * it properly — moving the time opens a fresh attempt rather than rewriting the
 * one that was missed.
 */
function settleable(meetingStatus: string | null | undefined): boolean {
  return meetingStatus !== 'held' && meetingStatus !== 'cancelled';
}

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
  now: Date,
  /**
   * Packages this booking SOLD, which hold their sessions themselves.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Without these, a consultation that sold a package listed no dates at all.
   *
   * Everything below walks DOWNWARDS from `parent_booking_id ?? id`, which
   * answers "what else is in my package" for a client already inside one. A
   * consultation that SOLD a package is outside it: no parent, no children, so
   * both queries asked about its own id and found nothing — the same blind
   * spot that had already hidden the invoice.
   * ───────────────────────────────────────────────────────────────────────────
   */
  soldContainerIds: string[] = []
) {
  const containerId = booking.parent_booking_id ?? booking.id;

  const containerIds = [...new Set([containerId, ...soldContainerIds])];

  const { data: rows } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, start_time, end_time, status, meeting_status, occurrence_number, parent_booking_id')
    .in('parent_booking_id', containerIds)
    .eq('user_id', booking.user_id)
    /* By package first, then by session within it: two packages sold from one
       consultation would otherwise interleave their numbering. */
    .order('parent_booking_id', { ascending: true })
    .order('occurrence_number', { ascending: true });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE NEW SHAPE: SESSIONS ARE MEETINGS ON ONE BOOKING.
   *
   * A package used to be a container plus one child BOOKING per date, which is
   * what the query above finds. Since the split it is one booking with N rows
   * in `scheduling_meetings`, and that query finds nothing — so a client
   * opening their link saw a purchase with no dates on it at all.
   *
   * Both are read. A package sold last month is still child bookings, and its
   * client can open their link today.
   *
   * `canModify` is FALSE for these, deliberately and not as an oversight. The
   * reschedule and cancel routes this page posts to take a BOOKING id, and a
   * session has none — offering the button would produce an action that fails
   * after the client has chosen a new time. Saying nothing is better than
   * that, and the page already renders a row it cannot offer to change.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (!rows?.length) {
    const { data: sessionRows } = await supabaseServer
      .from('scheduling_meetings')
      .select('id, start_time, end_time, meeting_status, session_number, occurrence_number, booking_id, replaces_meeting_id')
      .in('booking_id', containerIds)
      .eq('user_id', booking.user_id)
      .not('session_number', 'is', null)
      .order('session_number', { ascending: true })
      .order('occurrence_number', { ascending: true });

    if (!sessionRows?.length) return [];

    /*
     * One row per session: the CURRENT attempt at each, which is the hour the
     * client actually holds. A `moved` attempt is an hour they gave back, and
     * showing it would tell them to turn up at a time nobody is expecting them.
     */
    /*
     * Keyed by the booking AND the session number.
     *
     * The number alone was enough while this only ever read one package. Now
     * that a consultation can hand over two, session 1 of the second would
     * silently overwrite session 1 of the first — a client shown half of what
     * they bought, with no sign that anything was missing.
     */
    /*
     * ── WHICH SESSIONS HAVE ALREADY BEEN MADE UP ───────────────────────────
     *
     * A replacement points AT the session it stands in for
     * (`replaces_meeting_id`, migration 20261095). One pass over every row
     * rather than a lookup per session.
     *
     * This is the fact the portal could not previously get at, and no count
     * can supply it: on a package with two missed sessions, one made up and
     * one still waiting on the client, both read identically through any
     * aggregate. The migration's own note measures exactly that case.
     */
    const alreadyReplaced = new Set(
      sessionRows
        .map(row => row.replaces_meeting_id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id))
    );

    const current = new Map<string, (typeof sessionRows)[number]>();

    for (const row of sessionRows) {
      if (row.meeting_status === 'moved') continue;
      current.set(`${row.booking_id}#${row.session_number}`, row);
    }

    return [...current.values()]
      .sort(
        (a, b) =>
          String(a.booking_id).localeCompare(String(b.booking_id)) ||
          Number(a.session_number) - Number(b.session_number)
      )
      .map(row => {
        const session = Number(row.session_number);
        const start = row.start_time ? new Date(row.start_time as string) : null;
        const hoursAway = start ? (start.getTime() - now.getTime()) / 3_600_000 : null;
        const open = settleable(row.meeting_status as string | null);

        return {
          id: row.id as string,
          occurrenceNumber: session,
          startTime: row.start_time as string | null,
          endTime: row.end_time as string | null,
          /* A session has no status of its own; what it carries instead is
             whether it has happened. */
          status: open ? 'confirmed' : 'cancelled',
          /*
           * The REAL outcome, because the line above cannot carry it.
           *
           * `settleable` excludes only `held` and `cancelled` — a no-show is
           * deliberately still settleable, because a missed session is
           * unresolved and picking another time is the right next move. So a
           * missed session arrives as `confirmed` and the list drew it as an
           * ordinary upcoming hour, with nothing to say it had been missed.
           *
           * `PortalMeetings` already carries this field for the same reason.
           */
          meetingStatus: (row.meeting_status as string | null) ?? null,
          /*
           * Something already stands in for this hour.
           *
           * Moving it would leave the client holding two: the replacement they
           * were given, and whatever this one was moved to. So it is reported
           * and the action is withheld — see `canModify` below.
           */
          alreadyReplaced: alreadyReplaced.has(row.id as string),
          /*
           * ─────────────────────────────────────────────────────────────────
           * THE SAME THREE CONDITIONS AS EVERY OTHER ROW: standing, dated,
           * and far enough away.
           *
           * These were all `false` while a session could not be moved at all —
           * the reschedule route took a BOOKING id and a session has none. It
           * takes `meetingId` now, checked against the booking the token
           * names, so a client holding a link to one package can move its own
           * hours and nothing else.
           * ─────────────────────────────────────────────────────────────────
           */
          /*
           * This session has been moved at least once.
           *
           * `occurrence_number` counts ATTEMPTS at one session —
           * SchedulingRepository: "moving session 3 writes `session_number: 3,
           * occurrence_number: 2`" — so anything past the first attempt is an
           * hour that changed after the client booked it. The list already
           * hides the `moved` rows and shows only the current attempt, which
           * is right, but it left no sign that the hour on screen is not the
           * hour they were originally given.
           *
           * Not to be confused with `occurrenceNumber` above, which carries
           * the SESSION number — the "4" in "session 4 of 8".
           */
          wasMoved: Number(row.occurrence_number ?? 1) > 1,
          /* A session that has already been made up is not moved again. */
          canModify:
            open &&
            !alreadyReplaced.has(row.id as string) &&
            hoursAway !== null &&
            hoursAway > noticeHours,
          tooSoon:
            open &&
            !alreadyReplaced.has(row.id as string) &&
            hoursAway !== null &&
            hoursAway <= noticeHours,
          /*
           * The PURCHASE's token, which is the only booking there is — and the
           * one this request has just proved the caller holds a link to.
           * `meetingId` is what says which session it is about; the route
           * refuses a meeting that is not this booking's.
           */
          token: generateBookingToken(containerId, clientEmail),
          meetingId: row.id as string,
          isCurrent: false,
        };
      });
  }

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
      canModify:
        row.status === 'confirmed' &&
        settleable(row.meeting_status as string | null) &&
        hoursAway !== null &&
        hoursAway > noticeHours,
      /** Why not, when not — so the row can say it rather than go quiet. */
      tooSoon:
        row.status === 'confirmed' &&
        settleable(row.meeting_status as string | null) &&
        hoursAway !== null &&
        hoursAway <= noticeHours,
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

  /*
   * The portal itself. Generous: a client reloads this, and the page calls it again after every change.
   */
  const throttle = await rateLimit(request, 'portal-read', RATE_LIMITS.read);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

  try {
    // Verify token
    /*
     * Either a signed link or a booking id backed by the grant cookie.
     *
     * The id alone is never enough — it is what sits in the address bar
     * precisely because holding it grants nothing. `resolvePortalAccess` tells
     * the two apart by shape and requires a grant naming THIS booking for the
     * id form, so a cookie for one booking cannot open another.
     */
    const access = resolvePortalAccess(token, request.headers.get('cookie'));
    if (!access) {
      /*
       * The failure budget. A client reloading is noise on the `ok` counter;
       * a run of rejected tokens from one address is somebody trying keys, and
       * this is the only counter that can tell the two apart.
       */
      const failures = await rateLimit(request, 'portal-read', RATE_LIMITS.read, 'failure');
      if (!failures.allowed) return tooManyRequests(RATE_LIMITS.read.windowSeconds);

      requestLogger.warn('Invalid or expired booking token');
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = access;
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
    /*
     * `meeting_status` is selected alongside `status`: the appointment's own
     * outcome stopped being answerable from the job's status when held and
     * no-show began writing here instead. See `settleable`.
     *
     * Said here rather than inside the select, which is a STRING sent to
     * PostgREST — a comment in it travels to the server as part of the column
     * list, and a backtick in it ends the template literal.
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
        meeting_status,
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
      /*
       * And nobody has settled the appointment. `status` alone was the whole
       * question only while every outcome overwrote it; marking a meeting held
       * now leaves the job `confirmed`, so this went on offering the CLIENT
       * "change the time" and "cancel the meeting" for an appointment the owner
       * had already recorded as having taken place.
       */
      settleable(booking.meeting_status as string | null) &&
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
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE MONEY BELONGS TO THE PACKAGE, NOT TO ONE MEETING OF IT.
     *
     * A package writes ONE instalment per child booking — six meetings, six
     * rows of ₪74.99, each carrying the `booking_id` of the meeting it pays
     * for. Asking for this booking's rows alone therefore returned exactly
     * one, and the portal told a client with a six-payment agreement that
     * their plan was "0 of 1 payments made", listing a single period named
     * "meeting 3". Every sibling payment they had agreed to was invisible, and
     * the one number they could see was the one least worth knowing.
     *
     * The family is the container plus its children, which is the same set
     * `packageMeetings` lists further down from the same `containerId`. An
     * ordinary booking has no children, so `moneyIds` collapses to `[its own
     * id]` and both queries below are byte-for-byte what they were.
     *
     * Invoices are widened with the instalments deliberately: splitting them
     * would make `paid` count against one set and `total` against another, and
     * a plan that is 2-of-6 paid would report 0-of-6. `portalMoneyIsOneAnswer`
     * exists because this page has already said two things about one balance.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const moneyContainerId = booking.parent_booking_id ?? booking.id;

    const { data: familyRows } = await supabaseServer
      .from('scheduling_bookings')
      .select('id')
      .eq('parent_booking_id', moneyContainerId)
      .eq('user_id', booking.user_id);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AND THE PACKAGE THIS BOOKING SOLD, WHICH IS WHERE ITS MONEY WENT.
     *
     * A quote accepted up front bills the PURCHASE, not the consultation it
     * came out of: `raiseInvoice` points the invoice at the package container
     * so the owner can refund it from the one row that represents the block.
     * That is right, and it left the client with nothing to pay.
     *
     * The walk above only goes DOWNWARDS — a booking, its container, its
     * siblings. A consultation that sold a package is none of those: it has no
     * parent and no children, so `moneyIds` collapsed to its own id and the
     * invoice sitting on the container was invisible. The client accepted a
     * ₪700 quote and their portal showed no payment at all.
     *
     * `proposals.package_booking_id` records exactly which container each
     * accepted quote created, and the block below already reads that link in
     * the other direction to decide which booking a session belongs to. This
     * is the same relationship, followed the other way, for the same reason:
     * the client and the owner must be looking at one agreement.
     *
     * Containers only. Their sessions are picked up by the family walk once a
     * client opens one of them, and adding every session here would widen the
     * balance of a consultation that happens to have sold two packages.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: soldPackages } = await supabaseServer
      .from('proposals')
      .select('package_booking_id')
      .eq('booking_id', booking.id)
      .eq('user_id', booking.user_id)
      .not('package_booking_id', 'is', null);

    const soldContainerIds = (soldPackages ?? [])
      .map(row => row.package_booking_id as string)
      .filter(id => id && id !== moneyContainerId);

    const moneyIds = [
      ...new Set([
        ...(familyRows?.length
          ? [moneyContainerId, ...familyRows.map(row => row.id as string)]
          : [booking.id]),
        ...soldContainerIds,
      ]),
    ];

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE BOOKING THE PACKAGE WAS SOLD FROM, WHICH IS WHAT THE CLIENT BOUGHT.
     *
     * A package is a dateless CONTAINER booking plus one child per session.
     * Every child carries its own token, so opening the portal from session
     * two made session two the lead card — "Friday 23 October" at the top,
     * above a list of all six, as though the client had bought that one
     * meeting and happened to have five others.
     *
     * The container is not the answer either. It is a delivery vehicle with no
     * date, no quote and no conversation attached. What the client actually
     * agreed to was the consultation where the quote was accepted, and
     * `proposals.package_booking_id` records exactly which package each
     * accepted quote created — so the host is that proposal's `booking_id`.
     *
     * This is the rule `foldPackageMeetings` in the CRM contact drawer already
     * applies owner-side, and the two must agree: the owner and the client
     * looking at the same package should be counting the same bookings.
     *
     * Falls back to the container, deliberately, for a quote sold COLD — there
     * is no booking behind it to host the sessions, so the purchase is its own
     * subject. Dateless, which the card renders by leading with the service
     * name instead of a numeral.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let parentRow: {
      id: string;
      status: string;
      start_time: string | null;
      end_time: string | null;
      timezone: string | null;
      service_name: string | null;
      duration_minutes: number | null;
    } | null = null;

    if (booking.parent_booking_id) {
      const { data: sold } = await supabaseServer
        .from('proposals')
        .select('booking_id')
        .eq('package_booking_id', booking.parent_booking_id)
        .eq('user_id', booking.user_id)
        .not('booking_id', 'is', null)
        .limit(1);

      const hostId = (sold?.[0]?.booking_id as string | undefined) ?? booking.parent_booking_id;

      const { data: host } = await supabaseServer
        .from('scheduling_bookings')
        .select(
          'id, status, start_time, end_time, timezone, service:scheduling_services(service_name, duration_minutes)'
        )
        .eq('id', hostId)
        .eq('user_id', booking.user_id)
        .maybeSingle();

      if (host) {
        const hostService = Array.isArray(host.service) ? host.service[0] : host.service;
        parentRow = {
          id: host.id as string,
          status: host.status as string,
          start_time: (host.start_time as string | null) ?? null,
          end_time: (host.end_time as string | null) ?? null,
          timezone: (host.timezone as string | null) ?? null,
          service_name: (hostService?.service_name as string | null) ?? null,
          duration_minutes: (hostService?.duration_minutes as number | null) ?? null,
        };
      }
    }

    const [{ data: invoices }, { data: installments }] = await Promise.all([
      supabaseServer
        .from('payment_invoices')
        .select('id, amount, currency, status, due_date, refunded_amount, refunded_at')
        .in('booking_id', moneyIds)
        .eq('user_id', booking.user_id),
      supabaseServer
        .from('payment_plan_installments')
        .select('installment_number, label, status, amount, currency, due_date, paid_at, invoice_id')
        .in('booking_id', moneyIds)
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

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * MONEY PAID BY CARD, WITH NO INVOICE BEHIND IT.
     *
     * This route read `payment_invoices` and `payment_plan_installments` and
     * nothing else, so a booking sold through website checkout — where the
     * client pays on the spot and no invoice is ever raised — had no money in
     * the portal at all. `state` still resolved to 'paid', because it falls
     * back to `booking.payment_status`, so the client's own page read
     * "paid · 0 ILS" over a card payment that had gone through.
     *
     * Live case: booking 0a35468e, ₪150 succeeded on transaction 9c31e502,
     * `payment_invoices` empty.
     *
     * `invoice_id IS NULL` is what stops this double counting: a transaction
     * that settled an invoice is already in `settled` above, under that
     * invoice's own amount. Only the direct ones are added here — the same
     * dedupe rule `unbilled` uses for stages, and the same three-links-to-a
     * -booking problem `RefundService` solves for refunding.
     *
     * Refunds come along for the ride. `refunded_amount` is maintained on the
     * transaction by the refund ledger exactly as it is on an invoice, so a
     * card payment that was partly returned now reports that too, instead of
     * the portal going quiet about it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: directPayments } = await supabaseServer
      .from('payment_transactions')
      .select('id, amount, currency, status, refunded_amount, refunded_at, invoice_id')
      .in('booking_id', moneyIds)
      .eq('user_id', booking.user_id)
      .in('status', ['succeeded', 'refunded']);

    const directCard = (directPayments ?? []).filter(row => !row.invoice_id);

    const paidTotal =
      settled.reduce((sum, invoice) => sum + Number(invoice.amount ?? 0), 0) +
      directCard.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    /*
     * WHAT CAME BACK, which the portal was silent about.
     *
     * ───────────────────────────────────────────────────────────────────────────
     * `state` reached 'refunded' only when `booking.payment_status` did, and that
     * takes a FULL refund. A client refunded ₪2,250 of ₪9,000 opened their portal
     * to "₪9,000 paid · 2 of 2 payments" — the money was back in their account
     * and the one page they can check said nothing about it.
     *
     * Summed from the invoices, because a job billed in stages has a refund
     * against whichever stage was returned, and `refunded_amount` is derived by
     * trigger from the `payment_refunds` ledger on each.
     *
     * The paid total stays what was paid. The client paid it; the refund is a
     * second event and reads as one.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const refundedTotal =
      (invoices ?? []).reduce(
        (sum, invoice) => sum + Number((invoice as { refunded_amount?: number }).refunded_amount ?? 0),
        0
      ) +
      /* And against a direct card payment, which has no invoice to carry it. */
      directCard.reduce((sum, row) => sum + Number(row.refunded_amount ?? 0), 0);

    /* The most recent, for a job returned in more than one go. */
    const refundedAt =
      [
        ...(invoices ?? []).map(invoice => (invoice as { refunded_at?: string | null }).refunded_at),
        ...directCard.map(row => row.refunded_at as string | null),
      ]
        .filter((at): at is string => Boolean(at))
        .sort()
        .pop() ?? null;

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

    /*
     * THE PAYMENTS THEMSELVES, and what came back against each.
     *
     * ───────────────────────────────────────────────────────────────────────────
     * The portal reported "2 of 2 paid" and a single total. For a job billed in
     * stages that is a summary of something the client cannot see: which payment
     * was which, and — once money is returned — which one it came off. A client
     * refunded ₪2,250 could read the figure and still not know which of their two
     * ₪4,500 payments it related to.
     *
     * A refund attaches to the INVOICE a period raised, so the periods are joined
     * to the invoices already fetched above. A period never invoiced has none,
     * which is correct: nothing was charged, so nothing came back.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const refundByInvoice = new Map<string, number>();

    for (const invoice of invoices ?? []) {
      const amount = Number((invoice as { refunded_amount?: number }).refunded_amount ?? 0);
      const id = (invoice as { id?: string }).id;
      if (id && amount > 0) refundByInvoice.set(id, amount);
    }

    const plan =
      installments && installments.length > 0
        ? {
            /*
             * ─────────────────────────────────────────────────────────────
             * A CALLED-OFF SESSION IS NOT A PAYMENT THEY STILL OWE.
             *
             * `total` counted every stage, cancelled ones included, so a
             * package with three sessions called off told the client "0 of
             * 11 payments made" when only 8 can ever be made. The figure
             * they are being asked for is right; the one describing their
             * progress through it was not.
             *
             * The rows themselves still list a cancelled stage, which is
             * honest — it says בוטלה and carries no amount owing.
             * ─────────────────────────────────────────────────────────────
             */
            paid: installments.filter(row => String(row.status) === 'paid').length,
            total: installments.filter(row => String(row.status) !== 'cancelled').length,
            periods: [...installments]
              /*
                BY INSTALMENT NUMBER, which is the agreement's own order.
                ─────────────────────────────────────────────────────────
                This sorted by due date and renumbered, and a MILESTONE has no
                due date — it falls due when the work is done. Null sorted as
                the empty string, which precedes every real date, so a two-stage
                job listed its final milestone as "1." and its deposit as "2.".

                The refund then appeared against the wrong number: right data,
                wrong row, which is worse than not showing it. The column that
                answers "which payment is this" already exists.
              */
              .sort(
                (a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0)
              )
              .map(row => ({
                number: Number(row.installment_number ?? 0),
                /* The milestone's NAME. "1." and "2." cannot tell a client which
                   payment a refund came off; "עם סיום העבודה" can. Null on a
                   uniform instalment plan, where the number is the whole name. */
                label: (row.label as string | null) ?? null,
                amount: Number(row.amount ?? 0),
                status: String(row.status),
                dueDate: (row.due_date as string | null) ?? null,
                /*
                 * ─────────────────────────────────────────────────────────
                 * WHEN IT WAS ACTUALLY PAID, WHICH IS A DIFFERENT DATE.
                 *
                 * Only `dueDate` was sent, so a settled stage showed the day
                 * it had been DUE: "₪1,000 · Monday 23 November · paid",
                 * about money that arrived on 9 October. A client reading
                 * their own record was told the wrong date for their own
                 * payment.
                 *
                 * And a milestone has no due date at all — it falls due when
                 * the work is done — so the second stage showed no date
                 * whatsoever despite being paid on a known day.
                 * ─────────────────────────────────────────────────────────
                 */
                paidAt: (row.paid_at as string | null) ?? null,
                refunded:
                  typeof row.invoice_id === 'string'
                    ? refundByInvoice.get(row.invoice_id) ?? null
                    : null,
              })),
          }
        : null;

    const moneyCurrency =
      (owing[0]?.currency as string) ||
      (settled[0]?.currency as string) ||
      (unbilled[0]?.currency as string) ||
      /* The card payment's own currency. Without this a checkout-paid booking
         fell through to the service's, and showed an amount labelled in the
         wrong one whenever a client was priced outside the business default. */
      (directCard[0]?.currency as string) ||
      ((service as { currency?: string | null } | null)?.currency ?? null);

    /*
     * ───────────────────────────────────────────────────────────────────────
     * SOMEWHERE TO PAY, BESIDE THE AMOUNT.
     *
     * The portal already SAID what was outstanding — "לתשלום ₪400", whether it
     * was overdue, "2 of 6 paid" — and offered no way to act on any of it. A
     * client who wanted to pay had to go back and find the original invoice
     * email, which is the email they could not find.
     *
     * The link goes to the public invoice page rather than straight to a card
     * checkout, because that page already resolves card, bank transfer or
     * written instructions per invoice and honours the business's own "Send via
     * Stripe" choice. Sending a client to a checkout that a transfer-only
     * business never offered would be a different bug.
     *
     * The SOONEST unpaid one, since that is the deadline shown next to it.
     * Non-fatal: a failure here leaves the portal exactly as it was.
     * ───────────────────────────────────────────────────────────────────────
     */
    let payUrl: string | null = null;
    /*
     * The invoice ITSELF, not only a link to it.
     *
     * The portal used to hand the page a `/invoice/{id}` URL and nothing else,
     * so paying meant navigating: the client left the booking they were
     * looking at for a page of their own, which is the thing every other task
     * on this portal stopped doing. With the id, the page can mount the same
     * payment panel that page mounts, in a card under the booking.
     *
     * `payUrl` stays, because the invoice page is still a real surface — the
     * link in the invoice email points at it, and it prints.
     */
    let payInvoiceId: string | null = null;

    try {
      const { data: openRows } = await supabaseServer
        .from('payment_invoices')
        .select('id, status, due_date, paid_at, refund_status, amount')
        /* The same family the balance above was summed over. Scoping the link
           to this meeting alone while the amount beside it covers the package
           would show a client what they owe and no way to pay it. */
        .in('booking_id', moneyIds)
        .eq('user_id', booking.user_id)
        .in('status', ['sent', 'overdue'])
        .order('due_date', { ascending: true });

      /*
       * The ledger, not the status. An invoice refunded without first being
       * marked paid keeps `sent` — the exact shape that had two clients chased
       * for money they had already been given back. Showing that client a Pay
       * button would be the same bug wearing a different hat.
       */
      const payable = (openRows ?? []).find(
        row =>
          !row.paid_at &&
          (!row.refund_status || row.refund_status === 'none') &&
          Number(row.amount ?? 0) > 0
      );

      if (payable) {
        payInvoiceId = payable.id as string;
        /* Signed. The portal pays in place and rarely follows this, but it is
           still a client-facing link and must not rely on the invoice being
           young enough for the bare-URL grace window. */
        payUrl = `/invoice/${payable.id}?t=${await generateInvoiceToken(payable.id as string)}`;
      }
    } catch (err) {
      requestLogger.warn({ err, bookingId }, 'Could not resolve a pay link (non-blocking)');
    }

    /* Hoisted: signing reads the contact address, so it cannot sit inside an
       object literal. Only where something is actually owed. */
    const payAccessToken =
      outstanding > 0 && payInvoiceId ? await generateInvoiceToken(payInvoiceId) : null;

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
      /* Reported whatever the state says: a PARTIAL refund leaves the booking
         'paid', which is true and silent about the part that came back. */
      refunded: refundedTotal > 0 ? refundedTotal : null,
      refundedAt,
      plan,
      /*
       * Only where money is genuinely outstanding. An unbilled quote stage —
       * agreed but not yet raised — counts toward `outstanding` and has no
       * invoice to pay against, so it correctly yields no link.
       */
      payUrl: outstanding > 0 ? payUrl : null,
      /** The same invoice, for paying in place rather than navigating. */
      invoiceId: outstanding > 0 ? payInvoiceId : null,
      /*
       * Its access token, so the in-portal panel can present one to
       * `/api/public/invoice/[id]/intent` exactly as the invoice page does.
       *
       * Minted here because this request has already proved the caller holds a
       * valid booking token, and the invoice is this booking's own — the same
       * reasoning as signing a sibling meeting. It grants nothing the caller
       * did not already have, and it means the portal's Pay card does not
       * depend on the invoice being young enough for the bare-URL window.
       */
      invoiceToken: payAccessToken,
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

    /*
     * Whether a quote is EXPECTED on this booking — which is a different
     * question from whether one exists.
     *
     * It gates the "a quote is coming" placeholder, and only that. A service
     * sold on request promises the client a price; an ordinary booking does
     * not, and telling its client to sit tight for a quote nobody is writing
     * would be an invention.
     */
    const quotesExpected =
      (service as { sale_mode?: string | null } | null)?.sale_mode === 'proposal';

    let quote: {
      status: string;
      total: number | null;
      currency: string | null;
      token: string | null;
    } | null = null;

    /*
     * ALWAYS LOOKED FOR, whatever the service says.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This ran only when `sale_mode === 'proposal'`, and the quote builder has
     * no such restriction: it takes any booking, and a `serviceId` that may be
     * null. So an owner could raise and send a quote against an ordinary
     * booking, the client would open their portal, and there was nothing there
     * — no quote, no price, and no way to accept or decline it. The one screen
     * the client was sent to could not show the thing they were sent it for.
     *
     * Existence is the honest test. If a proposal was written against this
     * booking and sent, the client it was addressed to may see it and answer
     * it, regardless of how the service behind it happens to be configured.
     * ─────────────────────────────────────────────────────────────────────────
     */
    {
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

    /*
      ANNOTATED, so the page's type cannot drift from what is actually sent.
      `business` is deliberately outside the annotation: the pages read the
      brand from `PublicBrandProvider`, not from this payload, and modelling
      the whole `PublicBrand` here would tie the wire format to a server type.
    */
    const payload: PortalResponse & { business: unknown } = {
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
        /*
          The NORMALISED service, not `booking.service`.

          PostgREST returns an embedded relation as an object for a
          many-to-one join and as an array otherwise, and the generated types
          widen it to an array — which is why line ~205 above already does
          `Array.isArray(booking.service) ? booking.service[0] : booking.service`
          before this route uses it for anything itself.

          That normalisation was not applied to the value actually SENT. The
          client reads `booking.service?.service_name`, so on any response
          where the relation came back as an array the service name, duration
          and price would all be silently undefined — the appointment card with
          no service on it. Sending the same value this route trusts closes
          that, and is what the response type now asserts.
        */
        service,
        canReschedule: canModify,
        canCancel: canModify,
        /*
         * Null, not 0, when there is no appointment. Zero reads as "it is
         * happening now", which is a different and wrong statement.
         */
        hoursUntilBooking:
          hoursUntilBooking === null ? null : Math.max(0, Math.floor(hoursUntilBooking)),
        /** False for a product purchase: nothing about it is scheduled. */
        isScheduled: Boolean(booking.start_time),
        /** What this session was sold as; null for everything but a package. */
        parent: parentRow
          ? {
              id: parentRow.id,
              status: parentRow.status,
              startTime: parentRow.start_time,
              endTime: parentRow.end_time,
              timezone: parentRow.timezone,
              serviceName: parentRow.service_name,
              durationMinutes: parentRow.duration_minutes,
            }
          : null
      },
      /** The quote raised against this booking, if any was. */
      quote: quote ?? undefined,
      /*
       * True when a quote is expected, none has been raised — AND the price is
       * still open.
       *
       * `sale_mode: 'proposal'` says how a service is SOLD, not where this
       * booking got to. A business that quotes for a job and then agrees the
       * figure in conversation books the work and writes the plan directly,
       * and no `proposals` row is ever created. The service still says
       * 'proposal' forever, so the portal told a client sitting on an agreed
       * six-payment plan that their quote was "being prepared" and would be
       * emailed when ready — directly above the plan stating the price.
       *
       * `state === 'none'` is the test that distinguishes them: it means
       * nothing is owed and nothing has been paid, which is the only condition
       * under which a client is genuinely still waiting on a figure. Once
       * money exists, whatever raised it has already answered the question.
       */
      awaitingQuote: quotesExpected && !quote && payment.state === 'none',
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
      /* `soldContainerIds` so a consultation that sold a package lists the
         sessions it bought, not an empty schedule — the same set the money
         lookup above had to be widened with, for the same reason. */
      meetings: await packageMeetings(booking, contactEmail, noticeHours, now, soldContainerIds),
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
    };

    return NextResponse.json(payload);

  } catch (error) {
    requestLogger.error({ err: error }, 'Error fetching booking');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch booking' },
      { status: 500 }
    );
  }
}
