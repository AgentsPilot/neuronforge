/**
 * POST /api/scheduling/bookings/[id]/no-show
 * Mark a booking as no-show.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ROUTES CAN SET THIS STATUS, AND THEY USED TO DISAGREE.
 *
 * `PATCH /bookings/[id]` writes a `booking_no_show` row on the contact's
 * timeline; this one did not. So whether a missed appointment appeared in a
 * client's history depended on which control the owner happened to use — the
 * quick action here, or the status dropdown in the drawer.
 *
 * That silently undermined the thing the PATCH route's own comment says the row
 * is FOR: "a no-show in particular is the thing they want to see a pattern of".
 * It also starves `ret_no_show_spike`, the insight that watches for exactly
 * that pattern.
 *
 * The activity is written here now, from the same helpers, so the two paths
 * record the same history.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { BookingEmailService } from '@/lib/services/BookingEmailService';

const logger = createLogger({ module: 'SchedulingBookingNoShowAPI' });
const auditTrail = AuditTrailService.getInstance();

const NoShowSchema = z.object({
  /**
   * Whether to invite the client to book again.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * DEFAULTS TO FALSE, AND THAT IS THE WHOLE DESIGN.
   *
   * A no-show is a JUDGEMENT the owner records, and it can be wrong: the client
   * was stuck in traffic, went to the wrong address, or did turn up and nobody
   * marked them present. The owner also knows things this system never will —
   * that the client rang ahead, or is in hospital.
   *
   * Sending automatically spends that knowledge before anyone is consulted. The
   * two mistakes are not equally bad either: not sending costs one rebooking,
   * and the owner can still pick up the phone. Sending wrongly tells someone who
   * was at a funeral, or who was sitting in the waiting room, that they did not
   * turn up.
   *
   * So the owner ticks it, per booking, knowing the circumstances.
   * ───────────────────────────────────────────────────────────────────────────
   */
  notifyClient: z.boolean().optional().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input. An absent body is the old behaviour: mark it, tell nobody.
    const body = await request.json().catch(() => ({}));
    const parsed = NoShowSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { notifyClient } = parsed.data;

    /*
     * Whether the caller SAID anything about notifying, as opposed to the
     * schema's default.
     *
     * `notifyClient: false` is what an unticked toggle sends — and also what a
     * client bundle predating the confirmation dialog sends, because it posts
     * an empty body. Those are very different situations ("the owner chose not
     * to" versus "the owner was never asked"), and telling them apart from a
     * log saved a second round of guessing once already.
     */
    const choiceWasMade = body !== null && typeof body === 'object' && 'notifyClient' in body;

    const bookingId = params.id;
    requestLogger.info(
      { userId: user.id, bookingId, notifyClient, choiceWasMade },
      'Marking booking as no-show'
    );

    /*
     * Read BEFORE the write. The activity sentence needs the appointment's own
     * time and the status it is moving from, and the update returns the new row.
     */
    const { data: previous } = await schedulingBookingRepository.findById(bookingId, user.id);

    // 3. Mark as no-show
    const result = await schedulingBookingRepository.markNoShow(bookingId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to mark booking as no-show');
      return NextResponse.json(
        { success: false, error: 'Failed to mark booking as no-show' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    /*
     * 4. The contact's own timeline — the same row `PATCH /bookings/[id]`
     * writes, from the same helpers, so the two paths cannot tell different
     * stories about the same client.
     *
     * Only on a real transition: re-marking a booking that was already a
     * no-show should not stack up rows suggesting it happened twice.
     */
    const contactId = previous?.contact_id ?? result.data.contact_id;
    const statusMoved = previous ? previous.status !== 'no_show' : true;

    if (contactId && statusMoved) {
      const { data: ownerProfile } = await supabaseServer
        .from('business_profiles')
        .select('language')
        .eq('user_id', user.id)
        .maybeSingle();

      const ownerLocale = ownerProfile?.language || 'en';
      const zone = result.data.timezone || previous?.timezone || undefined;
      const when = activityMoment(previous?.start_time ?? result.data.start_time, ownerLocale, zone) || '';

      crmActivityRepository
        .create({
          user_id: user.id,
          contact_id: contactId,
          activity_type: 'booking_no_show',
          title: activitySentence('booking_no_show', { date: when }, ownerLocale),
          description: JSON.stringify({
            kind: 'booking_no_show',
            from: previous?.start_time ?? result.data.start_time,
            previousStatus: previous?.status,
            timeZone: zone,
          }),
          auto_logged: true,
          source_capability: 'scheduling',
          source_entity_id: bookingId,
          activity_date: previous?.start_time ?? result.data.start_time ?? undefined,
        })
        .catch(err =>
          requestLogger.warn({ err }, 'No-show activity logging failed (non-blocking)')
        );
    }

    /*
     * 5. The invitation to rebook, only when asked for.
     *
     * Non-blocking, like every other client email on this path: the status
     * change is the thing the owner asked for, and a mail failure must not
     * report it as unsaved.
     */
    if (notifyClient) {
      BookingEmailService.sendMissedAppointmentEmail(bookingId, user.id)
        .then(email => {
          if (!email.sent) {
            requestLogger.warn({ bookingId, reason: email.error }, 'Rebooking invitation not sent');
          }
        })
        .catch(err => requestLogger.error({ err, bookingId }, 'Rebooking invitation failed'));
    }

    // 6. Get contact name for audit log
    let contactName = 'Client';
    if (result.data.contact_id) {
      const contactResult = await crmContactRepository.findById(result.data.contact_id, user.id);
      if (contactResult.data) {
        contactName = `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim() || 'Client';
      }
    }

    // 7. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_NO_SHOW',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: bookingId,
        resourceName: `Booking for ${contactName}`,
        changes: { notifyClient },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 8. Return success
    requestLogger.info({ bookingId, userId: user.id, notifyClient }, 'Booking marked as no-show');
    return NextResponse.json({
      success: true,
      booking: result.data
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
