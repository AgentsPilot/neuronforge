/**
 * GET /api/book/manage/[token]/calendar
 *
 * The appointment as a calendar file, for the client holding the link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The confirmation EMAIL has carried an `.ics` attachment for a long time, but
 * a client who archived that mail, or reads it on a phone that will not open
 * attachments, had no way back to it — and "add this to my calendar" is the
 * single most common thing someone wants from a booking link. The portal offers
 * it as an action; this is what that action downloads.
 *
 * It generates NOTHING new: `generateICSContent` is the same function the
 * confirmation email uses, so the event a client adds here is byte-for-byte the
 * event they were sent, down to the UID — which is what lets a calendar treat
 * it as the same appointment rather than a second copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHORIZATION
 *
 * The signed token, exactly as every other route under `/book/manage/[token]`.
 * It proves the holder was given this booking's link by email, and that is all
 * this returns: one appointment's time, service and business. A package returns
 * all of its meetings in the one file, because `generateICSContent` already
 * emits one VEVENT per session and tapping once should get the whole block.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';

import { createLogger } from '@/lib/logger';
import { generateICSContent, icsSequenceFor } from '@/lib/email/templates/booking-confirmation';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { supabaseServer } from '@/lib/supabaseServer';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';

const logger = createLogger({ module: 'API', service: 'BookingCalendar' });

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const decoded = verifyBookingToken(token);
    if (!decoded) {
      requestLogger.warn('Invalid or expired booking token');
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 401 });
    }

    const { bookingId } = decoded;

    const { data: booking, error } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        start_time,
        end_time,
        status,
        updated_at,
        user_id,
        parent_booking_id,
        contact:crm_contacts(first_name, last_name, email),
        service:scheduling_services(service_name)
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      requestLogger.warn({ err: error, bookingId }, 'Booking not found');
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    /*
     * A cancelled appointment is not offered as a calendar entry. The client
     * can still reach this URL from an old page in a tab, and handing them an
     * event for a meeting that is off would put it back in their calendar.
     */
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'This appointment was cancelled' },
        { status: 409 }
      );
    }

    if (!booking.start_time || !booking.end_time) {
      // A product purchase has no slot, so there is nothing to put in a diary.
      return NextResponse.json(
        { success: false, error: 'This booking has no appointment time' },
        { status: 409 }
      );
    }

    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
    const service = Array.isArray(booking.service) ? booking.service[0] : booking.service;

    /*
     * A package's meetings, so one tap files the whole block.
     *
     * The container itself is timeless, and its children carry the dates — the
     * same shape `sessions` has in the confirmation email, which is why they
     * can be handed straight to the generator.
     */
    const containerId = booking.parent_booking_id ?? booking.id;

    const { data: siblings } = await supabaseServer
      .from('scheduling_bookings')
      .select('start_time, end_time, status, occurrence_number')
      .eq('parent_booking_id', containerId)
      .eq('user_id', booking.user_id)
      .order('occurrence_number', { ascending: true });

    const sessions = (siblings ?? [])
      .filter(row => row.status !== 'cancelled' && row.start_time && row.end_time)
      .map(row => ({ start: new Date(row.start_time as string), end: new Date(row.end_time as string) }));

    const brand = await resolvePublicBranding({ by: 'bookingToken', token });

    const ics = generateICSContent(
      {
        bookingId: booking.id,
        clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || '',
        clientEmail: contact?.email || '',
        serviceName: service?.service_name || '',
        dateTime: new Date(booking.start_time),
        endTime: new Date(booking.end_time),
        /*
         * No location. `scheduling_bookings` and `scheduling_services` have no
         * such column — the confirmation email passes `undefined` here too, with
         * a TODO beside it — and naming one in the select made PostgREST reject
         * the whole query, which 404'd every appointment.
         */
        location: undefined,
        branding: { businessName: brand?.businessName || '' },
        // One meeting is not a package; passing a single session would change
        // its UID and make a calendar treat it as a different appointment from
        // the one the confirmation email filed.
        sessions: sessions.length > 1 ? sessions : undefined,
      } as Parameters<typeof generateICSContent>[0],
      { sequence: icsSequenceFor(booking.updated_at) }
    );

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE FILENAME, TWICE.
     *
     * A header value may only carry ASCII, and this business's services are
     * named in Hebrew — so building the name straight from `service_name`
     * threw inside the response constructor and the route answered 500 for
     * every appointment it has.
     *
     * RFC 6266 is the way out: a plain `filename=` that is always safe, and a
     * `filename*=UTF-8''…` beside it carrying the real name percent-encoded.
     * Every current browser prefers the second; anything that does not still
     * gets a file it can save.
     * ───────────────────────────────────────────────────────────────────────
     */
    const serviceName = service?.service_name || 'appointment';
    const asciiName =
      serviceName
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'appointment';

    return new NextResponse(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition':
          `attachment; filename="${asciiName}.ics"; ` +
          `filename*=UTF-8''${encodeURIComponent(`${serviceName}.ics`)}`,
        // The appointment can move; a cached file would re-add the old time.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    requestLogger.error({ err }, 'Could not build the calendar file');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (err as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
