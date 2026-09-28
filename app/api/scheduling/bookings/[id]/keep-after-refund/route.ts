/**
 * "This refunded appointment is still going ahead."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A refund taken in the Stripe dashboard reaches the money — the ledger, the
 * invoice and `payment_status` all end up right — and reaches nothing else. The
 * appointment stays `confirmed` in the diary and the client still gets "see you
 * tomorrow" for a session they were refunded for.
 *
 * Cancelling on their behalf would be wrong: money goes back as goodwill while
 * the session still happens, or a deposit is returned while the job continues
 * on new terms. So the platform asks instead, and this is the owner answering
 * "leave it alone".
 *
 * It records a decision rather than changing one, which is why it writes an
 * activity and touches no booking column: the dashboard row and the held
 * reminder both read that marker, so one answer clears both.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/scheduling/bookings/[id]/keep-after-refund
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'API', service: 'KeepBookingAfterRefund' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: bookingId } = await params;

    /*
     * Read through the repository, which scopes by `user_id` — this is the
     * ownership check, not a convenience. Without it any caller could write a
     * marker against somebody else's booking and silence their reminder.
     */
    const { data: booking, error } = await schedulingBookingRepository.findById(bookingId, user.id);

    if (error || !booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    if (!booking.contact_id) {
      // The marker lives on the contact's timeline; without one there is
      // nowhere to record the decision.
      return NextResponse.json(
        { success: false, code: 'no_contact', error: 'This booking has no contact' },
        { status: 400 }
      );
    }

    /*
     * The OWNER's language and the booking's own zone — the same pair the
     * no-show route beside this one uses, so the two rows on a contact's
     * timeline cannot end up in different languages or different clocks.
     */
    const { data: ownerProfile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', user.id)
      .maybeSingle();

    const ownerLocale = ownerProfile?.language || 'en';
    const when = activityMoment(booking.start_time, ownerLocale, booking.timezone || undefined) || '';

    const activity = await crmActivityRepository.create({
      user_id: user.id,
      contact_id: booking.contact_id,
      activity_type: 'booking_refund_kept',
      title: activitySentence('booking_refund_kept', { date: when }, ownerLocale),
      auto_logged: false,
      source_capability: 'scheduling',
      // The booking this answers for. Both readers — the dashboard row and the
      // held reminder — match on this.
      source_entity_id: bookingId,
    });

    if (activity.error) {
      requestLogger.error({ err: activity.error, bookingId }, 'Could not record the decision');
      return NextResponse.json(
        { success: false, error: 'Could not record the decision' },
        { status: 500 }
      );
    }

    auditTrail
      .log({
        action: 'BOOKING_KEPT_AFTER_REFUND',
        // The audit enum's own name for it; `booking` is not a member.
        entityType: 'scheduling_booking',
        entityId: bookingId,
        userId: user.id,
        severity: 'info',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ bookingId }, 'Refunded booking kept by the owner');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
