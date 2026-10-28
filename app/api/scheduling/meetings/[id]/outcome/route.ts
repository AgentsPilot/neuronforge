/**
 * POST /api/scheduling/meetings/[id]/outcome
 *
 * What happened at ONE session of a package.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE `bookings/[id]/complete`
 *
 * Every outcome path on the owner's side takes a BOOKING. That was the whole
 * truth while a package session was its own child booking: completing session
 * three meant completing booking three.
 *
 * A package is now ONE booking with N meetings, so there is no booking to
 * complete per session — and completing the container would claim all six
 * happened at once. This is the per-session equivalent, and it is where the
 * per-session money is triggered.
 *
 * Ordinary bookings keep using `bookings/[id]/complete` unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  schedulingBookingRepository,
  schedulingServiceRepository,
} from '@/lib/repositories/SchedulingRepository';
import { isEarlySessionOutcomeEnabled } from '@/lib/utils/featureFlags';
import type { CalendarEventRow } from '@/lib/services/CalendarSyncService';

const logger = createLogger({ module: 'SchedulingMeetingOutcomeAPI' });
const auditTrail = AuditTrailService.getInstance();

/*
 * `moved` is deliberately absent. It is written by the system when a
 * reschedule supersedes an attempt, never chosen by a person — offering it
 * here would let a caller free an hour without anything taking its place.
 */
const BodySchema = z.object({
  status: z.enum(['held', 'no_show', 'cancelled']),
  /**
   * Whether the client hears about it.
   *
   * Only `no_show` and `cancelled` reach anybody: marking a session HELD is a
   * record of something the client was present for, and mail about it would be
   * telling them what they already know.
   *
   * Defaults to false so a caller that does not ask never surprises a client.
   */
  notifyClient: z.boolean().optional(),
  /**
   * The hour booked IN PLACE of this one, when the owner took the offer.
   *
   * The caller books the replacement BEFORE recording the outcome, so the one
   * mail the client receives can list it. This names it, so the mail can also
   * explain it — otherwise the client reads "cancelled" over a list that grew
   * a date by itself.
   */
  replacementStart: z.string().optional(),
  /** What the client is told, for a session called off. */
  reason: z.string().max(1000).optional(),
  /**
   * Whether a MISSED session is billed.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `no_show` used to do nothing to the money, and nothing is not one of the
   * two honest answers. Only `held` bills a per-session stage and only
   * `cancelled` voids one, so a missed session left its stage reading
   * `pending` for ever: the client was neither charged nor released, and their
   * portal listed money against an hour no invoice would ever be raised for.
   *
   * The owner decides, because the system cannot: the client may have rung
   * ahead, or this may be the third time. The dialog defaults it to true, so
   * the common answer needs no thought and the waiver is deliberate.
   *
   * Meaningless on `held` (which always bills) and on `cancelled` (which
   * always voids), and ignored there rather than refused: a caller sending it
   * with an outcome that has its own answer is not making an error worth a
   * 400.
   * ───────────────────────────────────────────────────────────────────────────
   */
  chargeSession: z.boolean().optional(),
});

/** What each outcome is called in the trail. */
const AUDIT_ACTION = {
  held: 'SCHEDULING_SESSION_HELD',
  no_show: 'SCHEDULING_SESSION_NO_SHOW',
  cancelled: 'SCHEDULING_SESSION_CANCELLED',
} as const;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'A session outcome must be held, no_show or cancelled' },
        { status: 400 }
      );
    }

    const meetingId = params.id;
    const { status } = parsed.data;

    /*
     * Read once, before anything is written: the hour decides whether this
     * outcome is allowed at all, and the calendar columns are needed after it
     * to take the right entry out of the owner's diary.
     */
    const { data: scheduled, error: scheduledError } =
      await schedulingBookingRepository.findMeetingById(meetingId, user.id);

    if (scheduledError) {
      requestLogger.error(
        { err: scheduledError, meetingId },
        "Could not read a session before recording its outcome"
      );
      return NextResponse.json(
        { success: false, error: 'Could not record what happened at this session' },
        { status: 500 }
      );
    }

    if (!scheduled) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * AN HOUR THAT HAS NOT ARRIVED CANNOT HAVE HAPPENED.
     *
     * `held` and `no_show` are both assertions about the past, and both now
     * BILL: held always, missed unless the owner waives it. So either one, sent
     * against a session three weeks out, invoices a client for work nobody has
     * done — and emails them about it.
     *
     * The drawer has always refused to offer those controls before the hour
     * passed. Nothing refused them HERE, which made the gate a property of one
     * surface rather than of the rule: the chat, a script, a second tab with
     * stale state, or a future action all reached straight past it.
     *
     * `cancelled` is deliberately exempt and must stay so. Calling off a
     * session that has not happened yet is the ONLY time calling one off makes
     * sense, and it is the common case.
     *
     * The testing flag opens this too, by design. It is the one switch for
     * walking the money path on a package whose first session is weeks away,
     * and having it open the button while the server refused would make it
     * useless. Removing the flag then tightens both sides at once, which is
     * what makes it safe to remove.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (status === 'held' || status === 'no_show') {
      /*
       * The same comparison `isMeetingPastDue` makes, on START rather than end:
       * an owner marking a session held at ten to the hour, while the client is
       * still in the room, is recording something true.
       */
      const startsAt = scheduled.start_time ? new Date(scheduled.start_time) : null;
      const inTheFuture = Boolean(startsAt && startsAt.getTime() > Date.now());

      if (inTheFuture && !isEarlySessionOutcomeEnabled()) {
        requestLogger.warn(
          { meetingId, status, startTime: scheduled.start_time },
          'Refused an outcome for a session whose hour has not arrived'
        );
        return NextResponse.json(
          {
            success: false,
            code: 'session_not_yet_due',
            error: 'This session has not happened yet.',
          },
          { status: 409 }
        );
      }
    }

    /*
     * A missed session the owner chose not to charge for. Defaulting to TRUE
     * here matters as much as it does in the dialog: a caller that omits the
     * field gets the chargeable reading, so a session is never waived by
     * silence. Waiving is something a caller has to say.
     */
    const waived = status === 'no_show' && parsed.data.chargeSession === false;

    const result = await schedulingBookingRepository.setMeetingOutcome(
      meetingId,
      user.id,
      status,
      'owner',
      { releaseStage: waived }
    );

    if (result.error) {
      requestLogger.error(
        { err: result.error, userId: user.id, meetingId, status },
        "Failed to record a session's outcome"
      );
      return NextResponse.json(
        { success: false, error: 'Could not record what happened at this session' },
        { status: 500 }
      );
    }

    /*
     * Null with no error means the session already had an answer, or does not
     * belong to this owner. Reported as success: the state the caller asked
     * for is the state on the row, and two presses must not look like a fault.
     */
    if (!result.data) {
      return NextResponse.json({ success: true, alreadyRecorded: true });
    }

    const { bookingId, sessionNumber } = result.data;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * A SESSION BILLS ITSELF WHEN IT IS HELD.
     *
     * A package sold "after each meeting" is approved with nothing due: each
     * session carries a stage of its own, waiting. Marking it held is the
     * event that bills it.
     *
     * The MEETING is passed, which is the whole point. Six stages share the
     * container's `booking_id`, so a lookup keyed on the job would bill the
     * lowest-numbered stage whichever session actually happened.
     *
     * Never fatal: the outcome is already recorded, and a stage left unbilled
     * is visible in the drawer one button away. Throwing here would tell the
     * owner the session had not been marked.
     * ───────────────────────────────────────────────────────────────────────
     */
    let billed: { stageId: string; invoiceId: string | null; amount: number | null } | null = null;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * A MISSED SESSION BILLS THE SAME WAY, unless the owner waived it.
     *
     * The hour was held and nobody came, so the money question is settled the
     * same way as for a session that happened: through the one function that
     * knows how, keyed on the MEETING so it bills this session's stage rather
     * than the lowest-numbered one.
     *
     * The waiver takes the other road entirely: `releaseStage` above voided
     * the stage and lowered the plan's total before we got here, so there is
     * nothing left to bill and nothing to do.
     * ───────────────────────────────────────────────────────────────────────
     */
    const billsNow = status === 'held' || (status === 'no_show' && !waived);

    if (billsNow) {
      const { billSessionOnCompletion } = await import('@/lib/payments/billSessionOnCompletion');
      billed = await billSessionOnCompletion(bookingId, user.id, meetingId);

      if (billed) {
        requestLogger.info(
          { userId: user.id, bookingId, meetingId, status, stageId: billed.stageId, invoiceId: billed.invoiceId },
          status === 'held' ? 'Held session billed' : 'Missed session billed'
        );
      }
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE HOUR GOES OUT OF THE OWNER'S DIARY TOO.
     *
     * Calling off a session freed it in the two places the code owns — the
     * availability query and the database's overlap constraint, both of which
     * read `meeting_status` — and left it standing in the owner's actual
     * calendar, which is the one they look at.
     *
     * So the hour was genuinely bookable and looked taken. Availability is
     * computed from our own rows and never consults the connected calendar, so
     * the platform would offer that slot to the next client while the owner,
     * reading their diary, believed they were busy. The client meanwhile kept
     * an invitation to an appointment that is not happening.
     *
     * `deleteCalendarEvent` has taken a MEETING since 20261087, precisely so
     * one entry of six can be removed, and `aSessionsDiaryEntry.guard.test.ts`
     * pins that it reads the id off the meeting. Nothing ever passed one. This
     * is that missing half.
     *
     * WHAT becomes of the entry is not decided here: `settleSessionDiaryEntry`
     * owns that rule, because stopping a whole package applies the same one to
     * each of its sessions. In short, a cancellation whose hour is still ahead
     * is deleted, and anything already past is kept and labelled with what
     * happened.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (status !== 'held') {
      try {
        const { settleSessionDiaryEntry } = await import(
          '@/lib/scheduling/settleSessionDiaryEntry'
        );

        const { data: booking } = await schedulingBookingRepository.findById(
          bookingId,
          user.id
        );

        const { data: service } = booking?.service_id
          ? await schedulingServiceRepository.findById(booking.service_id, user.id)
          : { data: null };

        if (booking && service) {
          const settled = await settleSessionDiaryEntry({
            booking,
            service,
            userId: user.id,
            meeting: {
              id: scheduled.id,
              external_calendar_event_id: scheduled.external_calendar_event_id,
              calendar_sync_provider:
                scheduled.calendar_sync_provider as CalendarEventRow['calendar_sync_provider'],
              start_time: scheduled.start_time,
              end_time: scheduled.end_time,
            },
            outcome: status,
          });

          requestLogger.info(
            { meetingId, bookingId, status, diary: settled.action, ok: settled.ok },
            "Settled a session's diary entry"
          );
        }
      } catch (err) {
        requestLogger.error(
          { err, meetingId, bookingId },
          "Settling a session's diary entry threw"
        );
      }
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE CLIENT HEARS ABOUT IT, AND ABOUT THE RIGHT HOUR.
     *
     * Under the old shape a session was its own booking, so calling one off
     * went through the booking routes and the client got mail naming that
     * date. There is no such booking now, and sending nothing would mean a
     * client whose session was cancelled is never told.
     *
     * Both emails take the PURCHASE — the only booking there is — plus the
     * session's own hour, because the purchase has no clock and the mail would
     * otherwise announce 1970. `sessionStart` is ignored for any booking that
     * does have a time, so every ordinary cancellation is untouched.
     *
     * Never fatal: the outcome is recorded, and mail that did not go out is
     * visible on the journey and re-sendable.
     * ───────────────────────────────────────────────────────────────────────
     */
    /*
     * ── WHETHER THE CLIENT WAS ACTUALLY TOLD ────────────────────────────────
     *
     * `null` means no mail was due here — a held meeting, or an outcome the
     * owner asked not to notify on. `false` means one was due and did not go,
     * and that is the case the owner must see: the outcome below returns
     * `success: true` either way, so a silent failure read on screen as "the
     * client has been told".
     *
     * Measured on this account: of five meetings cancelled by an owner, two
     * produced no client email and no `email_sends` row of any kind — nothing
     * on the journey to notice, nothing to re-send, and a server log line as
     * the only trace. Every refusal inside the sender was ruled out against
     * those bookings (contact, address and service were all present and
     * identical to the ones that did send), so the cause is still open. This
     * does not fix that cause; it makes the next occurrence visible instead of
     * silent, which is what it will take to find it.
     */
    let clientNotified: boolean | null = null;
    let notifyError: string | null = null;

    if (parsed.data.notifyClient && status !== 'held' && result.data.startTime) {
      try {
        const { BookingEmailService } = await import('@/lib/services/BookingEmailService');

        const mail =
          status === 'cancelled'
            ? await BookingEmailService.sendCancellationEmail(bookingId, user.id, parsed.data.reason, {
                sessionStart: result.data.startTime,
                replacementStart: parsed.data.replacementStart ?? null,
                /*
                 * ───────────────────────────────────────────────────────────
                 * THE MEETING'S EMAIL, NOT THE ORDER'S.
                 *
                 * Without this the client received the full cancellation:
                 * "ההזמנה בוטלה · ההזמנה שלך בוטלה", a money line about
                 * nothing having been paid and nothing to refund, and an
                 * invitation to sign up again — about a package whose other
                 * five sessions were untouched and already paid for by stage.
                 *
                 * `meetingOnly` is what the meeting-cancel route has always
                 * passed: the subject names the DATE, no money line appears,
                 * and the body says where the work stands. For a package that
                 * resolves to "the work goes ahead exactly as agreed", which
                 * is both true and the thing the client needs to read.
                 *
                 * `proposalContinues: true` so the quote is looked up rather
                 * than short-circuited — an accepted one is exactly what a
                 * package has.
                 * ───────────────────────────────────────────────────────────
                 */
                meetingOnly: { proposalContinues: true },
                /*
                 * NO "choose another time" BUTTON.
                 *
                 * It is right for a consultation, where rebooking is the
                 * client's to arrange. It is wrong for a package: the owner
                 * decided this hour is not happening, and the drawer withholds
                 * the move for the same reason. Inviting the client to pick a
                 * replacement would contradict that decision from the one
                 * surface the owner cannot see.
                 *
                 * A session that should come back is one the OWNER adds.
                 */
                offerRebooking: false,
              })
            : await BookingEmailService.sendMissedAppointmentEmail(bookingId, user.id, {
                sessionStart: result.data.startTime,
                /* So the session list marks THIS row, and so the money beside
                   it is whatever the decision above just made it. */
                meetingId,
                /* The hour booked to make up for it, when the owner took that
                   offer. The mail then names it instead of inviting the client
                   to choose one — the two are alternatives. */
                replacementStart: parsed.data.replacementStart ?? null,
              });

        clientNotified = mail.sent;
        notifyError = mail.sent ? null : mail.error ?? 'The email did not go out';

        if (!mail.sent) {
          requestLogger.warn(
            { meetingId, bookingId, status, error: mail.error },
            "A session's outcome was recorded but the client was not told"
          );
        }
      } catch (err) {
        /* Still not fatal — the outcome stands. But it is no longer silent. */
        clientNotified = false;
        notifyError = err instanceof Error ? err.message : 'The email threw';

        requestLogger.error({ err, meetingId, bookingId, status }, "A session's email threw");
      }
    }

    auditTrail
      .log({
        action: AUDIT_ACTION[status],
        userId: user.id,
        entityType: 'scheduling_meeting',
        entityId: meetingId,
        resourceName: sessionNumber ? `Session ${sessionNumber}` : 'Session',
        details: { bookingId, sessionNumber, invoiceId: billed?.invoiceId ?? null },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info({ userId: user.id, meetingId, bookingId, status }, 'Session outcome recorded');

    return NextResponse.json({
      success: true,
      meetingId,
      bookingId,
      status,
      billed: billed ? { stageId: billed.stageId, invoiceId: billed.invoiceId, amount: billed.amount } : null,
      /* See `clientNotified` above: null = none was due, false = one was due
         and did not go. The caller shows the owner the difference. */
      clientNotified,
      notifyError,
    });
  } catch (error) {
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
