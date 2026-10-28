/**
 * POST /api/scheduling/bookings/[id]/meetings
 *
 * Add a meeting to a package that is already running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A block of six is agreed, approved and under way, and then the owner needs a
 * seventh date: the client missed one, or a course ran long, or they simply
 * want another. Without this the only way is a standalone booking, which lands
 * in the drawer as a separate job and belongs to no purchase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MONEY IS THE OWNER'S ANSWER, NOT AN INFERENCE
 *
 * `charge: false` — the meeting is part of what was already paid for. A make-up
 *   for a missed session, or goodwill. Nothing is billed, ever.
 *
 * `charge: true` — only meaningful on a package billed AFTER EACH MEETING,
 *   where the client is already paying session by session: a stage of its own
 *   is created, waiting, bound to this meeting, and billed when it is marked
 *   held like every other. The plan's total grows by that stage, because the
 *   plan is the record of what will be collected.
 *
 * On a package PAID UP FRONT a charge is refused. The client paid one agreed
 * sum for the block; billing them more for a seventh session is selling them
 * something else, and that is a quote, not a button.
 *
 * The accepted proposal is never touched. `accepted_snapshot` is what settles a
 * dispute and it records what was agreed on the day — see `recordAcceptance`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  createBooking,
  closedDayCheck,
  BookingSlotUnavailableError,
  BookingOnClosedDayError,
} from '@/lib/services/BookingLifecycleService';
import { isSlotTakenError } from '@/lib/business-os/bookingStatus';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { nextSessionSlots } from '@/lib/scheduling/nextSessionSlot';

/**
 * What to call the stage a newly added session bills.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Follows the wording already on the plan — "פגישה 6" becomes "פגישה 9" —
 * because a client reads these as one list, and the same thing named two ways
 * is the shape that gets misread. The label was the quote's entire title plus a
 * number, so the plan read "פגישה 1 … פגישה 6" and then "חבילת טיפולים לטיפול
 * לילד עם ADHD (9)": long enough to crowd the row, and clearly a different kind
 * of name from its neighbours.
 *
 * `sessionNumber` is the SESSION this stage bills, not the stage's own place in
 * the plan, and those diverge the moment a session is added without a charge:
 * the eighth payment on this plan bills the ninth session, because session
 * eight was goodwill. Numbering the label by the stage would read tidier beside
 * the row number and would be a lie about which meeting the client is paying
 * for. The row already carries its own ordinal; the label says what it is for.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function nextStageLabel(
  previousLabel: string | null,
  sessionNumber: number,
  quoteTitle: string
): string {
  if (!previousLabel) return `${quoteTitle} (${sessionNumber})`;

  /*
   * The last number in the label is the part that moves; whatever sits either
   * side of it is the name the owner chose and is kept exactly.
   *
   * The suffix group is not cosmetic. Labels written as "Package (13)" end in a
   * bracket, so a pattern anchored on the digits alone matches nothing — and
   * this function would hand back the previous label verbatim, putting the same
   * name on two stages, which is worse than the mismatch it set out to fix.
   */
  const trailing = previousLabel.match(/^(.*?)(\d+)(\D*)$/);
  if (trailing) return `${trailing[1]}${sessionNumber}${trailing[3]}`;

  /* Named without a number — "On completion" — so numbering it would invent a
     sequence that is not there. */
  return previousLabel;
}

const logger = createLogger({ module: 'PackageMeetingsAPI' });
const auditTrail = AuditTrailService.getInstance();

const addSchema = z.object({
  /** When the new meeting starts, as an instant. */
  start_time: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'not a real date'),
  /** How long it runs. Defaults to the length of the meetings already sold. */
  duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
  /** Bill it like the others. Only valid on a per-session package. */
  charge: z.boolean().optional().default(false),
  /** The owner was told the day is closed and said add it anyway. */
  allow_closed_day: z.boolean().optional().default(false),
  /**
   * Tell the client about this session on its own.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * True everywhere it has ever been: an owner adding a seventh session to a
   * block means the client to hear about it, and "A session has been added to
   * your package" is the whole point.
   *
   * FALSE for a REPLACEMENT offered on the cancel or no-show dialog. That
   * session is half of one event, and the other half — the hour being given
   * back — is about to send its own mail carrying every session of the block
   * with its state and its share of the payment. Two mails a second apart,
   * the first of them listing a block that no longer exists, is worse than
   * one: the client reads "your session on the 20th is cancelled" over a list
   * with no replacement in it, and then a second note about a session appearing
   * from nowhere.
   *
   * So the caller books the replacement FIRST and silently, and the outcome
   * mail that follows is the one the client reads — by then the list contains
   * the cancelled session, the new one, and what each is worth.
   * ───────────────────────────────────────────────────────────────────────────
   */
  notify: z.boolean().optional().default(true),
  /**
   * The session this one REPLACES, when it is a replacement.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The cancel and no-show dialogs book the replacement BEFORE recording the
   * outcome, so the one email the client receives lists every session
   * including the new one. The consequence is that at this moment the session
   * being called off is still standing — and the "block is full" refusal below
   * counts it. An upfront block of three therefore refused its own
   * replacement, every time: the hour was cancelled and nothing took its
   * place.
   *
   * Naming it here excludes it from that count, exactly as `excluding` does on
   * the GET. The two are the same question asked a second apart, and they have
   * to agree — otherwise the dialog offers a replacement the write then
   * refuses, which is what happened.
   *
   * Verified to belong to this package before it is honoured, so it cannot be
   * used to push a block past what was agreed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  replaces: z.string().optional(),
});

/**
 * GET — where a replacement session WOULD go, and whether one is allowed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The cancel and no-show dialogs offer to add a replacement, and the owner has
 * to see the hour before they agree to it. Working that out needs three things
 * the browser does not have: the proposal's agreed session count, the whole
 * diary (an hour may be sold to another client entirely), and the rule about
 * which outcomes free a place.
 *
 * So it is answered here, by the same reads the POST below makes — which is
 * also what keeps the offer and the refusal from disagreeing. Answering it in
 * the drawer from the sessions it happens to have loaded would propose hours
 * that are already taken, because the drawer only ever sees one contact.
 *
 * `excluding` is the session about to be called off or marked missed. It has
 * not been written yet when the dialog opens, so the count has to be told to
 * leave it out — otherwise a block at its agreed size reports no room for the
 * very replacement the owner is being offered.
 *
 * Read-only, and never fails the dialog: anything unexpected answers "no
 * replacement", and the owner places the session by hand as before.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const NONE = NextResponse.json({ success: true, canAdd: false, proposedStart: null });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const excluding = request.nextUrl.searchParams.get('excluding');

    /*
     * ── THE ID MAY BE A SESSION, NOT THE PURCHASE ───────────────────────────
     *
     * A package session has no booking of its own. The drawer builds a card
     * for each one out of the container's and OVERWRITES `id` with the
     * MEETING's id, keeping the purchase in `parent_booking_id` — so every
     * control on a session row calls its handlers with a meeting id in the
     * place a booking id normally goes.
     *
     * Asking for that id's sessions therefore found none, and this answered
     * "no replacement" for every package in the product: the toggle never
     * appeared on the one surface it was built for.
     *
     * So an id with no sessions of its own is tried as a MEETING, and that
     * meeting's booking is the container. Resolved HERE rather than at the
     * call site, because the caller cannot know which of the two it is
     * holding — and because every other handler on that row is already built
     * around the same convention, which must not be disturbed to fix this.
     */
    let containerId = params.id;

    const sessionsOf = async (id: string) =>
      (
        await supabaseServer
          .from('scheduling_meetings')
          .select('id, start_time, end_time, meeting_status')
          .eq('booking_id', id)
          .eq('user_id', user.id)
          .not('session_number', 'is', null)
      ).data;

    let sessionRows = await sessionsOf(containerId);

    if (!sessionRows?.length) {
      const { data: asMeeting } = await supabaseServer
        .from('scheduling_meetings')
        .select('booking_id')
        .eq('id', containerId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!asMeeting?.booking_id) return NONE;

      containerId = String(asMeeting.booking_id);
      sessionRows = await sessionsOf(containerId);
    }

    if (!sessionRows?.length) return NONE;

    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('sessions')
      .eq('package_booking_id', containerId)
      .eq('user_id', user.id)
      .maybeSingle();

    const shape = proposal?.sessions as
      | { dates?: unknown[]; bill_per_session?: boolean; duration_minutes?: number }
      | null;

    const perSession = shape?.bill_per_session === true;
    const agreed = Array.isArray(shape?.dates) ? shape!.dates!.length : 0;

    /* The same test the POST makes, plus the session being answered right now,
       which is about to stop holding its place. */
    const occupies = (row: { id: string; meeting_status: string | null }) =>
      row.id !== excluding &&
      row.meeting_status !== 'cancelled' &&
      row.meeting_status !== 'no_show' &&
      row.meeting_status !== 'moved';

    const standing = sessionRows.filter(occupies).length;

    /* A per-session block is never full — it is billed as it goes. An upfront
       block is, and then there is nothing to offer. */
    if (!perSession && agreed > 0 && standing >= agreed) return NONE;

    const minutes = (() => {
      const first = sessionRows.find(row => row.start_time && row.end_time);
      if (!first) return shape?.duration_minutes ?? 60;
      const span =
        (new Date(String(first.end_time)).getTime() -
          new Date(String(first.start_time)).getTime()) /
        60_000;
      return Number.isFinite(span) && span > 0 ? span : (shape?.duration_minutes ?? 60);
    })();

    /*
     * The whole diary for the stretch a proposal could land in, not just this
     * package's own hours: the rhythm may walk straight into another client.
     * Twelve rhythms is the furthest `nextSessionSlot` will look.
     */
    const latest = sessionRows
      .map(row => new Date(String(row.start_time)).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .pop();

    if (!latest) return NONE;

    const from = new Date(Math.max(latest, Date.now())).toISOString();
    const to = new Date(Math.max(latest, Date.now()) + 400 * 24 * 60 * 60 * 1000).toISOString();

    const busy = await busyMeetings(supabaseServer, user.id, from, to);

    /*
     * ── THE RHYTHM IS READ FROM THE WHOLE SERIES, THE COUNT IS NOT ──────────
     *
     * `occupies` answers "does this session still hold a place", and the
     * session being called off does not — that is what frees room for the
     * replacement. It is a different question from "when does this block
     * meet", and reading the schedule through the same filter got it wrong:
     * cancelling the last standing session left NO dates to read, so the one
     * case where an owner most wants a replacement offered got none.
     *
     * The dates of a series are facts about the series whatever became of each
     * hour, so the schedule is read from all of them. Only `moved` is dropped,
     * because a superseded attempt is not a date the block ever met on — its
     * replacement is already in this list.
     */
    /*
     * The proposal, AND the beats after it.
     *
     * One date was not enough. The rhythm's next beat can be right about the
     * pattern and wrong about the week — the owner is away, the room is taken
     * by something this app cannot see, or the client simply cannot make it —
     * and the only answer available then was to decline the replacement and
     * place the session by hand. Offering the following free hours lets them
     * say "not that Tuesday, the one after" without leaving the dialog.
     *
     * `proposedStart` stays the first of them, so every existing caller and
     * the email that names the hour read exactly what they read before.
     */
    /*
     * Ask for MORE than will be offered, because some will be dropped.
     *
     * `nextSessionSlots` knows which hours are taken — `busyMeetings` is the
     * owner's whole diary, the same source the public availability list reads
     * — but it does not know which DAYS the business works. A block that meets
     * Tuesdays keeps proposing Tuesdays long after the owner has closed them,
     * and the only place that was noticed was the write, which refuses with
     * `closed_day` after the owner has already agreed.
     *
     * So the closed-day rule now runs where the dates are OFFERED, with the
     * same function the write uses. Eight candidates in, up to four out.
     */
    const candidates = nextSessionSlots(
      sessionRows
        .filter(row => row.meeting_status !== 'moved')
        .map(row => String(row.start_time)),
      {
        durationMinutes: minutes,
        busy: busy.map(interval => ({ start: interval.start_time, end: interval.end_time })),
        count: 8,
      }
    );

    /* The container's zone decides what "that day" means — a slot at 23:00 UTC
       is a different weekday in Jerusalem, and the closed-day rule is about
       the owner's calendar, not the server's. */
    const { data: containerForZone } = await supabaseServer
      .from('scheduling_bookings')
      .select('timezone')
      .eq('id', containerId)
      .eq('user_id', user.id)
      .maybeSingle();

    const proposedStarts: string[] = [];
    for (const iso of candidates) {
      if (proposedStarts.length >= 4) break;
      const closed = await closedDayCheck(
        user.id,
        iso,
        new Date(new Date(iso).getTime() + minutes * 60_000).toISOString(),
        (containerForZone as { timezone?: string | null } | null)?.timezone,
        requestLogger
      );
      if (!closed) proposedStarts.push(iso);
    }

    const proposedStart = proposedStarts[0] ?? null;

    return NextResponse.json({
      success: true,
      canAdd: Boolean(proposedStart),
      proposedStart,
      /** The alternatives, proposal first. Empty when there is nothing free. */
      proposedStarts,
      durationMinutes: minutes,
      /*
       * Which KIND of package this is, so the caller books the replacement the
       * way this block is sold.
       *
       * On an UPFRONT block the money is already in: the replacement takes the
       * cancelled session's portion and is never billed again. On a PER-SESSION
       * block nothing has been paid for the hour that was called off — it is
       * billed when it is HELD — so its replacement has to carry a stage of its
       * own, or the client receives a session nobody ever invoices.
       *
       * Asked here rather than guessed there: the drawer has no proposal, and
       * `charge: true` against an upfront block is refused outright.
       */
      billsPerSession: perSession,
      /* The purchase the replacement is added to, which is not necessarily the
         id this was called with — see the resolution above. */
      containerId,
    });
  } catch (err) {
    /* The dialog still opens; it just makes no offer. */
    requestLogger.warn({ err, containerId: params.id }, 'Could not propose a replacement session');
    return NONE;
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const containerId = params.id;
    const input = addSchema.parse(await request.json());

    const { data: container, error: containerError } = await schedulingBookingRepository.findById(
      containerId,
      user.id
    );

    if (containerError || !container) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    /*
     * It has to BE a purchase. A meeting of a package cannot own meetings, and
     * hanging one off an ordinary appointment would make a package out of
     * something nobody sold as one.
     */
    if (container.parent_booking_id) {
      return NextResponse.json(
        { success: false, code: 'not_a_package', error: 'This is a meeting, not a purchase.' },
        { status: 400 }
      );
    }

    const { data: siblings } = await schedulingBookingRepository.findChildren(containerId, user.id);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE NEW SHAPE: SESSIONS ARE MEETINGS ON THIS BOOKING.
     *
     * A package used to be a container plus one child BOOKING per date, which
     * `findChildren` returns. Since the split it is one booking with N rows in
     * `scheduling_meetings`.
     *
     * Reading both is not politeness here, it is a correctness requirement:
     * finding no children and carrying on would add a CHILD BOOKING to a
     * package made of meetings. The readers prefer children where they exist,
     * so that one added row would become the whole package on screen and hide
     * the six sessions the client actually holds.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: sessionMeetings } = await supabaseServer
      .from('scheduling_meetings')
      .select('id, session_number, meeting_status')
      .eq('booking_id', containerId)
      .eq('user_id', user.id)
      .not('session_number', 'is', null)
      .order('session_number', { ascending: false });

    const asMeetings = !siblings?.length && Boolean(sessionMeetings?.length);

    if (!siblings?.length && !asMeetings) {
      return NextResponse.json(
        { success: false, code: 'not_a_package', error: 'This booking has no meetings.' },
        { status: 400 }
      );
    }

    /*
     * The quote that sold it — for how long each meeting runs, how the block is
     * billed, and which plan a new stage would belong to.
     */
    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('id, title, sessions, created_plan_id, contact_id, currency')
      .eq('package_booking_id', containerId)
      .eq('user_id', user.id)
      .maybeSingle();

    const perSession = Boolean(
      (proposal?.sessions as { bill_per_session?: boolean } | null)?.bill_per_session
    );

    if (input.charge && !perSession) {
      /*
       * The client paid one agreed sum for the block. Billing more for an extra
       * session is selling them something else, which is a quote.
       */
      return NextResponse.json(
        {
          success: false,
          code: 'cannot_charge_upfront_package',
          error: 'This package was paid for in full. Send a quote to sell another session.',
        },
        { status: 400 }
      );
    }

    /*
     * ── AN UPFRONT BLOCK CANNOT GROW BEYOND WHAT WAS AGREED ─────────────────
     *
     * A package paid in ONE sum is a contract for a stated number of sessions
     * at a stated total. Adding a session beyond that count changes what was
     * agreed without changing what was paid: the client's own total is then
     * wrong against the quote they accepted, and the extra session has no
     * money behind it at all — `packageSessionLines` shows it with a blank
     * figure, because there genuinely isn't one.
     *
     * The guard above already refuses to CHARGE for one here. This refuses to
     * add it free, which is the other half of the same rule. Another session
     * means another agreement: a new quote, or a new booking.
     *
     * ── AND ONLY FOR AN UPFRONT BLOCK ───────────────────────────────────────
     *
     * A package billed PER SESSION is untouched, deliberately. There each
     * session is paid after it is held, so a seventh on a block of six is
     * priced the moment it happens and no agreed total is contradicted — which
     * is the scenario the comment at the control itself describes ("a seventh
     * on a block of six") and which must keep working.
     *
     * ── A REPLACEMENT IS NOT AN EXTRA ───────────────────────────────────────
     *
     * Counted over sessions that still OCCUPY A PLACE, not every row ever
     * written. So calling one off and adding another in its place is allowed —
     * the count returns to the agreed number — while growing the block is
     * refused.
     *
     * A NO-SHOW frees a place too, and for a different reason than a
     * cancellation. It is not that the session was never delivered; the hour
     * was held and the owner waited. It is that the owner may choose to offer
     * a make-up, and this count is what decides whether they CAN.
     *
     * The money says the other thing, and deliberately. `packageSessionLines`
     * excludes only CANCELLED sessions from its shares, so a no-show keeps its
     * portion — it consumed real money — and a make-up added after one shows
     * no figure at all. Which is the truth: that session is free, given by an
     * owner who need not have given it. A cancelled session's portion does
     * move, because nothing was consumed.
     */
    const agreedDates = (proposal?.sessions as { dates?: unknown[] } | null)?.dates;
    const agreedCount = Array.isArray(agreedDates) ? agreedDates.length : 0;

    /*
     * ── WHICH SESSION THIS ONE STANDS IN FOR ────────────────────────────────
     *
     * Two things need it and they are not the same thing:
     *
     *   the COUNT below, because the hour being called off no longer holds its
     *   place and an upfront block would otherwise refuse its own replacement;
     *
     *   the ROW itself, so the link survives the request. Without it nothing
     *   can afterwards tell a session that has been made up from one that is
     *   still waiting — see 20261095 for why a count cannot answer that.
     *
     * Declared here, above the upfront-only guard, because the LINK matters on
     * every package. A per-session block has no ceiling to refuse against, so
     * the count never runs for it — and leaving the id inside that guard meant
     * its replacements were written with no link at all.
     *
     * Honoured only for a meeting that really is one of this package's, so a
     * stray id can neither buy an extra session nor point the link at a
     * stranger.
     */
    const replacedId =
      input.replaces && (sessionMeetings ?? []).some(row => row.id === input.replaces)
        ? input.replaces
        : null;

    if (!perSession && agreedCount > 0) {
      /*
       * Whichever shape this package is in — `asMeetings` is the same switch
       * every other count on this route uses. Reading only the new shape would
       * leave the rule unenforced on a legacy container, whose sessions are
       * child BOOKINGS and whose cancelled ones carry `status: 'cancelled'`
       * rather than a meeting status.
       */
      /** Neither called off nor missed: the session still owes the client an hour. */
      const occupied = (status: string | null | undefined) =>
        status !== 'cancelled' && status !== 'no_show';

      const standing = asMeetings
        ? (sessionMeetings ?? []).filter(
            row => row.id !== replacedId && occupied(row.meeting_status)
          ).length
        : (siblings ?? []).filter(
            child =>
              occupied((child as { status?: string | null }).status) &&
              occupied((child as { meeting_status?: string | null }).meeting_status)
          ).length;

      if (standing >= agreedCount) {
        return NextResponse.json(
          {
            success: false,
            code: 'package_already_complete',
            error: `This package was agreed as ${agreedCount} sessions and paid for in full. To arrange more, send a new quote or create another booking.`,
          },
          { status: 400 }
        );
      }
    }

    const minutes =
      input.duration_minutes ??
      (proposal?.sessions as { duration_minutes?: number } | null)?.duration_minutes ??
      60;

    const start = new Date(input.start_time);
    const end = new Date(start.getTime() + minutes * 60_000);

    /*
     * The highest number so far, not the count: a package whose third meeting
     * was deleted still has a sixth, and reusing its number would put two
     * meetings in the same place in the series.
     */
    const nextNumber = asMeetings
      ? Math.max(0, ...(sessionMeetings ?? []).map(row => Number(row.session_number ?? 0))) + 1
      : Math.max(0, ...(siblings ?? []).map(child => Number(child.occurrence_number ?? 0))) + 1;

    /** How many sessions the package had before this one, for the stage numbers. */
    const sessionsSoFar = asMeetings ? (sessionMeetings ?? []).length : (siblings ?? []).length;

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * A SESSION ADDED TO THE NEW SHAPE IS A MEETING, AND STILL GETS THE FOUR
     * THINGS `createBooking` WOULD HAVE GIVEN IT.
     *
     * Those are the reason this route went through `createBooking` at all: the
     * closed-day question, the overlap refusal, the calendar event, and the
     * client's confirmation. A session has no booking to create, so each is
     * done here against the meeting:
     *
     *   · closed day — `closedDayCheck`, the same function `createBooking`
     *     calls, so "the business is shut that day" is one answer not two;
     *   · overlap — `scheduling_meetings_no_overlap` (20261085) refuses it, and
     *     it is the ONLY constraint that can: the purchase carries no time, so
     *     the bookings constraint skips it entirely;
     *   · the calendar — recorded on the MEETING, or six sessions would
     *     overwrite one column and be re-created on the next sync;
     *   · the email — the purchase has no clock, so the session's own hour is
     *     passed in, or the client is told about 1970.
     * ───────────────────────────────────────────────────────────────────────────
     */
    /** The row that was added: a meeting in the new shape, a booking in the old. */
    let addedId: string;
    /** What it looks like, for the caller that has to draw it. */
    let addedRow: Record<string, unknown> | null = null;
    /** Whether the client was told, which only the branch that sent it knows. */
    let clientNotified = false;

    if (asMeetings) {
      if (!input.allow_closed_day) {
        const closed = await closedDayCheck(
          user.id,
          start.toISOString(),
          end.toISOString(),
          container.timezone,
          requestLogger
        );

        if (closed) {
          return NextResponse.json(
            {
              success: false,
              code: 'closed_day',
              error: closed.error.message,
              closed: {
                kind: closed.error.kind,
                date: closed.error.dateKey,
                reason: closed.error.closedReason,
                hours: closed.error.hours ?? null,
              },
            },
            { status: 409 }
          );
        }
      }

      const session = await schedulingBookingRepository.createMeeting({
        user_id: user.id,
        booking_id: containerId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        timezone: container.timezone,
        session_number: nextNumber,
        /* The first attempt at this new session. */
        occurrence_number: 1,
        /*
         * What it stands in for, when it is a replacement. Already validated
         * above as a session of THIS package — the same check that lets it be
         * left out of the block-full count — so it cannot point at a stranger.
         */
        replaces_meeting_id: replacedId,
      });

      if (isSlotTakenError(session.error)) {
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: 'That hour has been taken.' },
          { status: 409 }
        );
      }

      if (session.error || !session.data) {
        requestLogger.error({ err: session.error, containerId }, 'Could not add the session');
        return NextResponse.json(
          { success: false, error: 'Failed to add the meeting' },
          { status: 500 }
        );
      }

      addedId = session.data.id;
      addedRow = {
        id: addedId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        session_number: nextNumber,
        status: container.status,
        meeting_status: null,
      };

      /* The owner's diary, recorded on the session so the next sync knows it
         exists. Never fatal: the appointment is real either way. */
      try {
        const { CalendarSyncService } = await import('@/lib/services/CalendarSyncService');
        const { data: service } = await schedulingServiceRepository.findById(
          container.service_id,
          user.id
        );

        if (service) {
          await CalendarSyncService.syncBookingToCalendar(
            {
              ...container,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              /* Not the purchase's: borrowing it would update one event over
                 and over instead of creating this session's. */
              external_calendar_event_id: null,
            },
            service,
            user.id,
            addedId
          );
        }
      } catch (err) {
        requestLogger.error({ err, containerId, meetingId: addedId }, 'Session added but its calendar event failed');
      }

      /*
       * The client is told AFTER the money is settled, further down — not
       * here. The stage is created below, and whether this session is charged
       * is the one thing the mail has to say that the date does not: a client
       * who has already paid for a block by instalment should read about an
       * extra charge in the same message that gives them the hour, not from
       * an invoice arriving later.
       */
    } else {

    /*
     * Through `createBooking`, so an added meeting gets everything an ordinary
     * one does — the overlap check, the closed-day question, the calendar event,
     * the client's confirmation — with `createInvoice: false`, because a
     * package's money is the purchase's and is billed by a stage or not at all.
     */
    const created = await createBooking({
      userId: user.id,
      serviceId: container.service_id,
      contactId: container.contact_id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: container.timezone,
      status: container.status === 'pending' ? 'pending' : 'confirmed',
      parentBookingId: containerId,
      occurrenceNumber: nextNumber,
      bookingSource: 'proposal',
      createInvoice: false,
      allowClosedDay: input.allow_closed_day,
      request,
      logger: requestLogger,
    });

    if (created.error) {
      if (created.error instanceof BookingOnClosedDayError) {
        return NextResponse.json(
          {
            success: false,
            code: 'closed_day',
            error: created.error.message,
            closed: {
              kind: created.error.kind,
              date: created.error.dateKey,
              reason: created.error.closedReason,
              hours: created.error.hours ?? null,
            },
          },
          { status: 409 }
        );
      }

      if (created.error instanceof BookingSlotUnavailableError) {
        return NextResponse.json(
          { success: false, code: 'slot_taken', error: created.error.message },
          { status: 409 }
        );
      }

      requestLogger.error({ err: created.error, containerId }, 'Could not add the meeting');
      return NextResponse.json(
        { success: false, error: 'Failed to add the meeting' },
        { status: 500 }
      );
    }

      addedId = created.data!.booking.id;
      addedRow = created.data!.booking as unknown as Record<string, unknown>;
      clientNotified = Boolean(created.data!.clientNotified);
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * ITS OWN STAGE, when the owner said to bill it.
     *
     * The amount is COPIED from the stages already on this plan rather than
     * recomputed from the total: it is what the client has been paying per
     * session, and a seventh priced differently from the first six would be a
     * change to the deal nobody mentioned.
     *
     * Non-fatal. The meeting exists and is in the client's calendar; a stage
     * that failed is money not yet billed, which the owner can see and fix,
     * where failing the whole request would leave them re-adding a meeting that
     * is already there.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let stageId: string | null = null;
    /** What this session costs the client, when the owner charged for it. */
    let chargedLabel: string | null = null;

    if (input.charge && perSession && proposal?.created_plan_id) {
      const { data: existing } = await supabaseServer
        .from('payment_plan_installments')
        .select('amount, currency, installment_number, label')
        .eq('payment_plan_id', proposal.created_plan_id)
        .eq('user_id', user.id)
        .order('installment_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const amount = Number(existing?.amount ?? 0);

      if (amount > 0) {
        const { data: rows, error: stageError } = await paymentPlanRepository.createInstallments([
          {
            user_id: user.id,
            payment_plan_id: proposal.created_plan_id,
            contact_id: container.contact_id,
            proposal_id: proposal.id,
            /*
             * The job the money belongs to, and WHICH session it bills.
             *
             * For the new shape the session has no booking of its own, so the
             * stage points at the purchase and names the meeting — otherwise
             * every added session's stage would share one `booking_id` with the
             * rest and `billSessionOnCompletion` could not tell them apart.
             */
            booking_id: asMeetings ? containerId : addedId,
            meeting_id: asMeetings ? addedId : null,
            installment_number: Number(existing?.installment_number ?? sessionsSoFar) + 1,
            amount,
            currency: String(existing?.currency ?? proposal.currency ?? 'USD'),
            /* Named like the stages beside it, after the session it bills —
               see `nextStageLabel`. */
            label: nextStageLabel(
              (existing?.label as string | null) ?? null,
              nextNumber,
              proposal.title as string
            ),
            trigger: 'manual',
            due_date: null,
            status: 'pending',
          },
        ] as Parameters<typeof paymentPlanRepository.createInstallments>[0]);

        if (stageError) {
          requestLogger.error(
            { err: stageError, containerId, meetingId: addedId },
            'Meeting added but its stage could not be created'
          );
        } else {
          stageId = rows?.[0]?.id ?? null;

          /*
           * Only when a stage actually exists. Announcing a charge the write
           * failed to create would promise the client an invoice nobody can
           * raise — and the owner would have no idea the two disagreed.
           */
          if (stageId) {
            chargedLabel = new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: String(existing?.currency ?? proposal.currency ?? 'USD'),
            }).format(amount);
          }

          /*
           * The plan's total follows its stages. Left behind, the plan would
           * say ₪500 while owing ₪583.33, and every total built from it would
           * disagree with the invoices it raises.
           */
          const { data: plan } = await supabaseServer
            .from('payment_plans')
            .select('total_amount, installment_count')
            .eq('id', proposal.created_plan_id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (plan) {
            await supabaseServer
              .from('payment_plans')
              .update({
                total_amount: Number(plan.total_amount ?? 0) + amount,
                installment_count: Number(plan.installment_count ?? sessionsSoFar) + 1,
              })
              .eq('id', proposal.created_plan_id)
              .eq('user_id', user.id);
          }
        }
      }
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND NOW THE CLIENT IS TOLD, once everything about this session is true.
     *
     * The old shape sends its own confirmation from inside `createBooking`;
     * this is the new one, where there is no booking to confirm — the session
     * is a meeting on a purchase the client already holds.
     *
     * `addedSession` is what stops it reading as a brand-new appointment: a
     * client with six sessions was receiving a mail indistinguishable from the
     * one that confirms a standalone booking, with no sign it was a seventh
     * added to their block. The charge line appears only when a stage was
     * actually created.
     *
     * Never fatal. The session exists and is in the diary; mail that did not
     * go out is visible on the journey and re-sendable.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (asMeetings && input.notify) {
      try {
        const { BookingEmailService } = await import('@/lib/services/BookingEmailService');
        const mail = await BookingEmailService.sendBookingConfirmation(containerId, user.id, {
          sessions: [{ start, end }],
          skipInvoice: true,
          addedSession: { chargedAmount: chargedLabel },
        });

        clientNotified = mail.sent;

        if (!mail.sent) {
          requestLogger.warn(
            { containerId, meetingId: addedId, error: mail.error },
            'Session added but the client was not told'
          );
        }
      } catch (err) {
        requestLogger.error({ err, containerId }, "A session's confirmation threw");
      }
    }

    auditTrail
      .log({
        action: 'SCHEDULING_PACKAGE_MEETING_ADDED',
        userId: user.id,
        entityType: asMeetings ? 'scheduling_meeting' : 'scheduling_booking',
        entityId: addedId,
        resourceName: `Meeting ${nextNumber} of ${proposal?.title ?? 'a package'}`,
        details: { containerId, charged: Boolean(stageId), occurrenceNumber: nextNumber },
        request,
      })
      .catch(err => requestLogger.warn({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { containerId, meetingId: addedId, occurrenceNumber: nextNumber, charged: Boolean(stageId) },
      'Meeting added to a package'
    );

    return NextResponse.json({
      success: true,
      /* The row that was added, whichever table it went to. */
      meeting: addedRow,
      charged: Boolean(stageId),
      client_notified: clientNotified,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined,
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
