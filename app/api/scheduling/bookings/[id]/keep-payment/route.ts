/**
 * The owner has decided to keep the money a cancelling client had paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANSWER THE CARD NEVER LET THEM GIVE
 *
 * `booking_cancelled` raises a row whenever a client calls off a booking the
 * owner is holding money for, and offers one thing: refund it. That is the
 * right default and the consequential half — but it is not the only legitimate
 * answer. A deposit forfeited inside its own cancellation window is ordinary,
 * agreed in advance, and the owner's to keep.
 *
 * Nothing could record that. The gap's filter reads "money owed stays until it
 * is given back", so an owner who decided to keep it was asked again the next
 * day, and the day after, with no way to say the decision had been made. The
 * one row on the card that cannot be dismissed was the one about money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN ACTIVITY, NOT A COLUMN — THE SAME SHAPE AS ITS MIRROR
 *
 * `POST .../keep-after-refund` answers the opposite question ("the money went
 * back, is the session still on?") and records it as a CRM activity, for the
 * reason its own comment gives: there is no column for a decision, and
 * inventing one to hold an answer would be a migration for a sentence.
 *
 * This does the same, so both answers live in one place — the client's
 * timeline — where the owner can see what was decided and when. The gap reads
 * it back and stops asking.
 *
 * Deliberately touches NO money and NO booking. It records a judgement. The
 * payment stays exactly where it already was; this only stops the platform
 * pretending the question is still open.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'API', service: 'KeepPaymentAfterCancellation' });
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

    const { data: booking, error } = await schedulingBookingRepository.findById(bookingId, user.id);

    if (error || !booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    if (!booking.contact_id) {
      /* The decision lives on the contact's timeline; without one there is
         nowhere to record it, and nothing for the gap to read back. */
      return NextResponse.json(
        { success: false, code: 'no_contact', error: 'This booking has no contact' },
        { status: 400 }
      );
    }

    const { data: ownerProfile } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', user.id)
      .maybeSingle();

    /* The owner's own language: this sentence is read in their CRM timeline
       and nowhere else, so it is written in the language they read. */
    const ownerLocale = ownerProfile?.language || 'en';
    const when = activityMoment(booking.start_time, ownerLocale, booking.timezone || undefined) || '';

    const activity = await crmActivityRepository.create({
      user_id: user.id,
      contact_id: booking.contact_id,
      activity_type: 'booking_payment_kept',
      title: activitySentence('booking_payment_kept', { date: when }, ownerLocale),
      /* A judgement the owner made, not something the platform observed. */
      auto_logged: false,
      source_capability: 'scheduling',
      /* The booking this answers for — what the dashboard row matches on. */
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
        action: 'BOOKING_PAYMENT_KEPT',
        /* The audit enum's own name for it; `booking` is not a member. */
        entityType: 'scheduling_booking',
        entityId: bookingId,
        userId: user.id,
        severity: 'info',
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ bookingId }, 'Payment kept after a client cancellation');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
