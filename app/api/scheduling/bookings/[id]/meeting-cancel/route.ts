/**
 * Call off the APPOINTMENT and leave the job running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT THE CANCEL ROUTE
 *
 * `…/cancel` ends the work: it writes `status: 'cancelled'`, stops the
 * proposal, cancels the payment stages and emails the client. Correct when the
 * job is off.
 *
 * This is the other case, and it had no route at all: the owner and the client
 * agree to proceed WITHOUT meeting. The site visit is off, the quote still gets
 * written. An owner in that position previously had to either cancel the whole
 * job or leave an appointment nobody would attend sitting there as an
 * unanswered question on the journey.
 *
 * So this records the outcome and little else: no status change, no proposal
 * stopped, no money moved.
 *
 * It DOES email the client. That was the original reading — "the client was
 * party to the decision" — and it only holds when the two of them agreed to
 * skip the meeting. An owner dropping it on their own leaves the client with
 * an appointment in their calendar that nobody will attend. The mail is the
 * `meetingOnly` variant, which names the date rather than the service, says
 * where the quote stands, and shows no money line, because none of it moved.
 *
 * `holdsSlot` excludes `cancelled`, so the hour returns to availability
 * immediately, which is the point of recording it at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'api/scheduling/bookings/meeting-cancel' });

/**
 * Nothing is required.
 *
 * Declared anyway (CLAUDE.md rule 2) so a caller that sends a body gets it
 * validated rather than ignored, and so adding a reason later does not mean
 * introducing validation to a route that never had any.
 */
const bodySchema = z
  .object({
    /**
     * Is the quote still coming? The owner's answer, from the dialog.
     *
     * Not derivable, which is why it is asked: "no proposal exists" is the
     * same data whether one is being written or none ever will be, and the
     * client reads an opposite message in the two cases.
     *
     * Defaults to true for a caller that says nothing — proceeding without
     * meeting is what this route is FOR, and it is the safer of the two to be
     * wrong about: it promises something still to come rather than
     * withdrawing on the owner's behalf.
     */
    proposalContinues: z.boolean().optional(),
  })
  .passthrough()
  .optional();

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const bookingId = params.id;
    if (!z.string().uuid().safeParse(bookingId).success) {
      return NextResponse.json({ success: false, error: 'Invalid booking id' }, { status: 400 });
    }

    /* Tolerated: this route takes no fields, and a client sending an empty body
       or none at all are both ordinary. */
    let proposalContinues = true;
    try {
      const body = bodySchema.parse(await request.json().catch(() => undefined));
      proposalContinues = body?.proposalContinues ?? true;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    /*
     * `cancelMeeting`, not `cancel`. The repository method carries the whole
     * distinction and the note explaining it; this route only decides who is
     * asking.
     */
    const result = await schedulingBookingRepository.cancelMeeting(
      bookingId,
      user.id,
      'owner',
      /* Kept on the booking, so the journey can ask about closing it. The
         email is not the only consumer of this answer. */
      proposalContinues
    );

    if (result.error || !result.data) {
      requestLogger.error(
        { err: result.error, bookingId, userId: user.id },
        'Could not cancel the meeting'
      );
      return NextResponse.json(
        { success: false, error: 'Could not cancel the meeting' },
        { status: 500 }
      );
    }

    /*
     * ── TELL THE CLIENT ─────────────────────────────────────────────────────
     *
     * This route sent nothing, on the reasoning that it "records a decision
     * the client was already party to". That holds when the two of them agreed
     * to skip the meeting; it does not hold when the owner drops it on their
     * own, and the client is then left with an appointment in their calendar
     * that nobody will attend.
     *
     * `meetingOnly` is what keeps it from reading as the job ending: the
     * subject names the DATE, the body says where the quote stands, and no
     * money line appears — cancelling a meeting does not move money, stopping
     * the job is the button that does.
     *
     * Non-blocking and deliberately after the write. The appointment IS
     * cancelled; a mail server having a bad minute must not undo that or fail
     * a request the owner has already seen succeed.
     */
    BookingEmailService.sendCancellationEmail(bookingId, user.id, undefined, {
      meetingOnly: { proposalContinues },
      /* The door left open, not an instruction: they may well not want
         another meeting, and the quote reaches them either way. */
      offerRebooking: true,
    }).catch(err =>
      requestLogger.error(
        { err, bookingId },
        'The meeting was cancelled but the client could not be told'
      )
    );

    /* Non-blocking, like every audit call (CLAUDE.md). An audit failure must
       not fail a write the owner has already seen succeed. */
    AuditTrailService.getInstance()
      .log({
        action: 'BOOKING_MEETING_CANCELLED',
        entityType: 'scheduling_booking',
        entityId: bookingId,
        userId: user.id,
        details: { scope: 'meeting_only', jobContinues: true },
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info({ bookingId, userId: user.id }, 'Meeting cancelled; the job continues');

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not cancel the meeting',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
