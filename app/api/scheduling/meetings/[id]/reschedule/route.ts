/**
 * POST /api/scheduling/meetings/[id]/reschedule
 *
 * Move ONE session of a package to a new hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE THE BOOKING'S RESCHEDULE
 *
 * Every reschedule path on the owner's side moves a BOOKING, and `syncMeeting`
 * then follows the booking's new clock into the meetings table. That is the
 * whole truth while a job has one appointment.
 *
 * A package is one booking with N meetings, and its booking is the PURCHASE —
 * it carries no clock at all, so there is nothing for a booking-shaped
 * reschedule to change. Under the old shape each session was its own booking
 * and this came for free; losing it was the one capability the split took away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A MOVE IS
 *
 * A second ATTEMPT at the same session: same `session_number`, next
 * `occurrence_number`, and the attempt it supersedes stamped `moved` so its
 * hour goes back on sale while the time already communicated to the client
 * survives on the journey. `move_meeting` (20261087) does both in one
 * transaction — see the long note there for why neither order works alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { isSlotTakenError } from '@/lib/business-os/bookingStatus';
import {
  schedulingBookingRepository,
  schedulingServiceRepository,
} from '@/lib/repositories/SchedulingRepository';
import { closedDayCheck } from '@/lib/services/BookingLifecycleService';
import type { CalendarEventRow } from '@/lib/services/CalendarSyncService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'SchedulingMeetingRescheduleAPI' });
const auditTrail = AuditTrailService.getInstance();

const BodySchema = z.object({
  start_time: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'not a real date'),
  /**
   * The new end, when the caller names one.
   *
   * The booking dialog sends both ends, because an owner moving a session can
   * also lengthen it. Ignoring this and re-deriving the length from the old
   * attempt meant a session stretched from 60 to 90 minutes moved to the right
   * hour and quietly stayed 60.
   */
  end_time: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'not a real date').optional(),
  /** Or the length, for a caller that would rather say it that way. */
  duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
  /** The owner was told the day is closed and said move it anyway. */
  allow_closed_day: z.boolean().optional().default(false),
  /** Whether the client is told. Default true: they are holding the old hour. */
  notify_client: z.boolean().optional().default(true),
});

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
        { success: false, error: 'A new start time is required' },
        { status: 400 }
      );
    }

    const meetingId = params.id;
    const input = parsed.data;

    /*
     * The attempt being moved, with the event it holds in the owner's diary.
     * Scoped by owner (CLAUDE.md rule 4) on a service-role client.
     */
    const { data: meeting, error: readError } = await supabaseServer
      .from('scheduling_meetings')
      .select(
        'id, booking_id, start_time, end_time, timezone, meeting_status, session_number, occurrence_number, external_calendar_event_id, calendar_sync_provider'
      )
      .eq('id', meetingId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError || !meeting) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * ONLY A MEETING THAT HAPPENED CANNOT BE MOVED.
     *
     * This refused every marked session, which put it at odds with the menu
     * that offers the action: `MeetingRowActions` deliberately keeps "change
     * time" available for one called off or missed, because the client
     * rebooking is the ordinary next move in both cases. The owner would have
     * been offered it and then told the session was settled.
     *
     * `held` is the exception, and for a package billed per session it is a
     * hard one: marking one held RAISES AND EMAILS ITS INVOICE, so moving the
     * date afterwards leaves the client's invoice and their appointment on two
     * different days.
     *
     * `move_meeting` handles a marked row correctly either way — it leaves the
     * outcome alone rather than stamping `moved` over it, so a cancelled
     * session keeps saying it was cancelled and the new attempt carries the
     * new hour.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (meeting.meeting_status === 'held') {
      return NextResponse.json(
        {
          success: false,
          code: 'already_held',
          error: 'This session already took place, and its invoice names that date.',
        },
        { status: 409 }
      );
    }

    /*
     * And one the owner called off stays off. The menu withholds the action
     * for the same reason: moving it would undo a decision through a control
     * that says something else, and the client has already been told the hour
     * is not happening. A session that should come back is added as a new one.
     *
     * A MISSED session is deliberately not here — nobody decided anything, and
     * another attempt at it is the ordinary next move.
     */
    if (meeting.meeting_status === 'cancelled') {
      return NextResponse.json(
        {
          success: false,
          code: 'called_off',
          error: 'This session was called off. Add a new one instead.',
        },
        { status: 409 }
      );
    }

    const previous = new Date(String(meeting.start_time));
    const start = new Date(input.start_time);

    /*
     * The new end, in the order the caller is most likely to have meant it:
     * an explicit end, then an explicit length, then the length this session
     * already had. The last is the common case — most moves keep the hour's
     * length and only change when it starts.
     */
    const explicitEnd = input.end_time ? new Date(input.end_time) : null;
    const previousMinutes = Math.max(
      5,
      Math.round((new Date(String(meeting.end_time)).getTime() - previous.getTime()) / 60_000)
    );
    const minutes = input.duration_minutes ?? previousMinutes;

    const end =
      explicitEnd && explicitEnd.getTime() > start.getTime()
        ? explicitEnd
        : new Date(start.getTime() + minutes * 60_000);

    const { data: booking } = await schedulingBookingRepository.findById(
      String(meeting.booking_id),
      user.id
    );

    if (!booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    /* The same question the booking path asks, through the same function. */
    if (!input.allow_closed_day) {
      const closed = await closedDayCheck(
        user.id,
        start.toISOString(),
        end.toISOString(),
        meeting.timezone ?? booking.timezone,
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

    const moved = await schedulingBookingRepository.moveMeeting(
      meetingId,
      user.id,
      start.toISOString(),
      end.toISOString(),
      'owner'
    );

    if (isSlotTakenError(moved.error)) {
      /*
       * Somebody else holds the new hour. Nothing changed — the release and the
       * insert are one transaction — so the session still has the time it had,
       * and that is what the client is told nothing about.
       */
      return NextResponse.json(
        { success: false, code: 'slot_taken', error: 'That hour has been taken.' },
        { status: 409 }
      );
    }

    if (moved.error || !moved.data) {
      requestLogger.error({ err: moved.error, meetingId }, 'Could not move the session');
      return NextResponse.json(
        { success: false, error: 'Failed to move this session' },
        { status: 500 }
      );
    }

    const newMeetingId = moved.data.id;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE OWNER'S DIARY FOLLOWS, AND THE EVENT MOVES WITH THE SESSION.
     *
     * The event belongs to the appointment, not to the attempt: updating it in
     * place keeps one entry at the new hour, where creating a new one would
     * leave the client's old time sitting in the diary forever.
     *
     * So the event is updated through the attempt that HOLDS it — the one just
     * superseded — and then its id is carried onto the new attempt and cleared
     * from the old. Without the carry, the next move would find no event and
     * create a second entry.
     *
     * Never fatal: the appointment has moved in the database, which is the
     * fact that matters, and a diary entry is a mirror of it.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (meeting.external_calendar_event_id) {
      try {
        const { CalendarSyncService } = await import('@/lib/services/CalendarSyncService');
        const { data: service } = await schedulingServiceRepository.findById(
          booking.service_id,
          user.id
        );

        if (service) {
          const updated = await CalendarSyncService.updateCalendarEvent(
            {
              ...booking,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
            },
            service,
            user.id,
            {
              id: meetingId,
              external_calendar_event_id: String(meeting.external_calendar_event_id),
              calendar_sync_provider: (meeting.calendar_sync_provider ??
                null) as CalendarEventRow['calendar_sync_provider'],
            }
          );

          if (updated.success) {
            await schedulingBookingRepository.updateMeetingCalendarSync(newMeetingId, user.id, {
              external_calendar_event_id: String(meeting.external_calendar_event_id),
              calendar_sync_provider: meeting.calendar_sync_provider
                ? String(meeting.calendar_sync_provider)
                : null,
              calendar_synced_at: new Date().toISOString(),
              calendar_sync_error: null,
            });

            await schedulingBookingRepository.updateMeetingCalendarSync(meetingId, user.id, {
              external_calendar_event_id: null,
              calendar_sync_provider: null,
            });
          }
        }
      } catch (err) {
        requestLogger.error({ err, meetingId }, 'Session moved but its calendar event did not');
      }
    }

    /*
     * The client is holding the old hour, so silence is the one thing this
     * must not do by default. Named with the SESSION's times: the purchase has
     * no clock, and without them the notice announces an invalid date.
     */
    if (input.notify_client) {
      try {
        const { BookingEmailService } = await import('@/lib/services/BookingEmailService');
        const mail = await BookingEmailService.sendRescheduledEmail(
          String(meeting.booking_id),
          user.id,
          previous,
          { sessionStart: start, sessionEnd: end }
        );

        if (!mail.sent) {
          requestLogger.warn(
            { meetingId, newMeetingId, error: mail.error },
            'Session moved but the client was not told'
          );
        }
      } catch (err) {
        requestLogger.error({ err, meetingId }, "A session's reschedule notice threw");
      }
    }

    auditTrail
      .log({
        action: 'SCHEDULING_SESSION_RESCHEDULED',
        userId: user.id,
        entityType: 'scheduling_meeting',
        entityId: newMeetingId,
        resourceName: meeting.session_number ? `Session ${meeting.session_number}` : 'Session',
        details: {
          bookingId: String(meeting.booking_id),
          supersededAttempt: meetingId,
          from: meeting.start_time,
          to: start.toISOString(),
        },
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info(
      { meetingId, newMeetingId, from: meeting.start_time, to: start.toISOString() },
      'Session moved'
    );

    return NextResponse.json({
      success: true,
      meeting: {
        id: newMeetingId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        session_number: meeting.session_number,
      },
      superseded: meetingId,
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
