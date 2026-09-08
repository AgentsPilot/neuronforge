// app/api/book/manage/[token]/cancel/route.ts
// Self-service booking cancellation endpoint

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken, BookingEmailService } from '@/lib/services/BookingEmailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'API', service: 'BookingCancel' });

const cancelSchema = z.object({
  reason: z.string().optional()
});

// POST /api/book/manage/[token]/cancel
// Cancel the booking
export async function POST(
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
      return NextResponse.json(
        { success: false, code: 'invalid_link', error: 'Invalid or expired link' },
        { status: 401 }
      );
    }

    const { bookingId, email } = decoded;

    // Parse body (optional reason)
    let reason: string | undefined;
    try {
      const body = await request.json();
      const validated = cancelSchema.parse(body);
      reason = validated.reason;
    } catch {
      // Body is optional, continue without reason
    }

    // Fetch booking with contact email via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    /*
     * The service comes too, for its `min_notice_hours` — the same rule the
     * reschedule route applies. Both said "24 hours" whatever the business had
     * configured.
     */
    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        contact_id,
        start_time,
        status,
        contact:crm_contacts(email),
        service:scheduling_services(min_notice_hours)
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json(
        { success: false, code: 'not_found', error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Get contact email from JOIN and verify it matches the token
    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
    const contactEmail = contact?.email || '';
    if (contactEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { success: false, code: 'not_found', error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Validate booking can be cancelled
    const startTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (booking.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, code: 'not_cancellable', error: 'This booking cannot be cancelled' },
        { status: 400 }
      );
    }

    // The service's own notice period, not a hardcoded day — see the query above.
    const bookingService = Array.isArray(booking.service) ? booking.service[0] : booking.service;
    const noticeHours =
      (bookingService as { min_notice_hours?: number } | null)?.min_notice_hours ?? 24;

    if (hoursUntilBooking < noticeHours) {
      return NextResponse.json(
        {
          success: false,
          // A code, not a sentence: this page is read in three languages and
          // the reason was arriving in English regardless.
          code: 'too_late',
          hours: noticeHours,
          error: `Bookings must be cancelled at least ${noticeHours} hours in advance`,
        },
        { status: 400 }
      );
    }

    // Cancel booking
    const { data: updatedBooking, error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: reason ? `Client cancelled: ${reason}` : 'Cancelled by client',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to cancel booking');
      return NextResponse.json(
        { success: false, code: 'cancel_failed', error: 'Failed to cancel booking' },
        { status: 500 }
      );
    }

    requestLogger.info({ bookingId, reason }, 'Booking cancelled by client');

    // Send cancellation email (non-blocking)
    BookingEmailService.sendCancellationEmail(bookingId, booking.user_id, reason)
      .catch(err => requestLogger.warn({ err }, 'Cancellation email failed (non-blocking)'));

    return NextResponse.json({
      success: true,
      message: 'Booking cancelled successfully',
      booking: {
        id: updatedBooking.id,
        status: updatedBooking.status
      }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error cancelling booking');
    return NextResponse.json(
      { success: false, code: 'cancel_failed', error: 'Failed to cancel booking' },
      { status: 500 }
    );
  }
}
