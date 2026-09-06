// app/api/book/manage/[token]/route.ts
// Self-service booking management endpoint
// Allows clients to view their booking details using a signed token

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';

const logger = createLogger({ module: 'API', service: 'BookingManage' });

// GET /api/book/manage/[token]
// Returns booking details for the token holder
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

    // Fetch booking with service and contact details
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
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
          currency
        )
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

    // Calculate if booking can be rescheduled/cancelled
    const startTime = new Date(booking.start_time);
    const now = new Date();
    const hoursUntilBooking = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const canModify = booking.status === 'confirmed' && hoursUntilBooking > 24;

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
        hoursUntilBooking: Math.max(0, Math.floor(hoursUntilBooking))
      },
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
