/**
 * Website Booking Confirmation API
 * POST - Create a confirmed booking after payment success
 *
 * This endpoint is called AFTER payment succeeds (or for simulated payment in preview mode).
 * It:
 * 1. Validates the booking request
 * 2. Checks slot availability (double-check)
 * 3. Creates/updates CRM contact
 * 4. Creates the booking with status 'confirmed'
 * 5. Creates CRM activity
 */

import { NextRequest, NextResponse } from 'next/server';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { syncBookingToOwnerCalendar } from '@/lib/scheduling/syncBookingCalendar';
import { z } from 'zod';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { emailLikePattern } from '@/lib/utils/emailMatch';

const logger = createLogger({ module: 'WebsiteBookingConfirmAPI' });

const ConfirmBookingSchema = z.object({
  subdomain: z.string().optional(),
  service_id: z.string().uuid('Invalid service ID'),
  start_time: z.string().min(1, 'Start time is required'),
  name: z.string().min(1, 'Name is required').max(200),
  /*
   * TRIMMED AND LOWERCASED BEFORE IT IS VALIDATED, NOT AFTER.
   *
   * `z.string().email()` REJECTS a stray space: " a@b.com" is invalid to Zod
   * and the route answered 400 "Invalid email address" over a perfectly good
   * address. The public booking form made that routine — it tested
   * `clientEmail.trim()` and then submitted `clientEmail` — so a visitor whose
   * keyboard or paste left a trailing space was told their own email was wrong,
   * with nothing to act on because it looks correct on screen.
   *
   * Lowercased for the other half: a domain is case-insensitive by spec and
   * every real provider treats the local part that way too, while the contact
   * lookups match with `=`. `Offir.Omer@…` therefore missed the existing
   * `offir.omer@…` row and created a SECOND contact, with its own bookings and
   * its own money hanging off it.
   *
   * At the boundary rather than the call sites: everything downstream — the
   * lookup, the insert, the email that gets sent — then works from one spelling.
   */
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  phone: z.string().optional(),
  notes: z.string().max(2000).optional(),
  timezone: z.string().optional().default('UTC'),
  payment_intent_id: z.string().optional(), // Stripe payment intent (for real payments)
  is_preview: z.boolean().optional() // True if payment was simulated
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /*
   * ── CLOSED, BECAUSE NOTHING CALLS IT AND ANYONE CAN ─────────────────────
   *
   * The note further down already said it: "Nothing in the app calls this
   * route today; the widgets use /finalize." Confirmed by search — no caller
   * in `app/` or `components/`.
   *
   * What it still did was accept an unauthenticated POST carrying only a
   * subdomain and a service id, and from that mint a `crm_contacts` row and a
   * `confirmed` booking that holds a slot. Both are public values. So it was
   * an open door into any business's CRM and calendar, kept ajar by nothing
   * but obscurity, and it predates every rule the live path now follows: it
   * creates the contact before any money, it writes its own find-or-create
   * copy, and it sets a pipeline stage no route is supposed to set.
   *
   * Refused rather than deleted. A deleted route 404s and tells the next
   * reader nothing; this says what replaced it, and stays greppable from the
   * logs if some caller nobody has found starts hitting it.
   */
  requestLogger.warn(
    { path: '/api/website/booking/confirm' },
    'Refused a call to the retired public confirm route'
  );

  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint has been retired. Bookings are created by /api/website/booking/finalize once a payment has been confirmed.',
      code: 'route_retired',
    },
    { status: 410 }
  );

  try {
    const body = await request.json();

    // Validate input
    const validationResult = ConfirmBookingSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid booking data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    let ownerId: string;

    // If subdomain is provided, look up website owner (public access)
    // Otherwise, use authenticated user (preview mode)
    if (data.subdomain && data.subdomain.trim()) {
      const { data: websitePage, error: pageError } = await getWebsitePageRepository(supabaseServer).findBySubdomainAny(data.subdomain);

      if (pageError || !websitePage) {
        requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }
      ownerId = websitePage.user_id;
    } else {
      // Authenticated access - use current user (preview mode)
      const user = await getUser();
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized' },
          { status: 401 }
        );
      }
      ownerId = user.id;
    }

    // Fetch the service
    const { data: service, error: serviceError } = await supabaseServer
      .from('scheduling_services')
      .select('id, service_name, duration_minutes, price, currency, is_active')
      .eq('id', data.service_id)
      .eq('user_id', ownerId)
      .single();

    if (serviceError || !service) {
      requestLogger.warn({ serviceId: data.service_id }, 'Service not found');
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    if (!service.is_active) {
      return NextResponse.json(
        { success: false, error: 'This service is currently unavailable' },
        { status: 400 }
      );
    }

    // Calculate end time
    const startTime = new Date(data.start_time);
    // A service that is not booked against a time has no duration, so its
    // "appointment" is a point rather than a span. Multiplying null gives NaN,
    // and an invalid end time is written to the row without complaint.
    const endTime = new Date(startTime.getTime() + (service.duration_minutes || 0) * 60 * 1000);

    /*
     * Check for conflicts (double-check availability).
     *
     * `busyMeetings` is bounded by the appointment's own span, so the window IS
     * the overlap test — anything it returns collides by definition.
     */
    const conflicts = await busyMeetings(
      supabaseServer,
      ownerId,
      startTime.toISOString(),
      endTime.toISOString()
    );

    if (conflicts.length > 0) {
      return NextResponse.json(
        { success: false, error: 'This time slot is no longer available' },
        { status: 409 }
      );
    }

    // Parse name into first_name and last_name
    const nameParts = data.name.trim().split(/\s+/);
    const clientFirstName = nameParts[0] || data.name;
    const clientLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    /*
     * The start of this owner's board, resolved in the repository that owns the
     * table. This was an inline read ending `|| 'lead'` — one of eight copies,
     * and a stage many pipelines do not contain.
     */
    const { data: resolvedFirstStage } =
      await crmPipelineStagesRepository.firstStageKey(ownerId);

    /*
     * A new contact starts at the beginning; the money promotes them.
     *
     * This guessed the client stage from English keys and fell back to the
     * literal `'client'` — a key a Hebrew pipeline does not contain, so the
     * contact was written with a stage matching no column on the board. It is
     * not this route's decision any more.
     *
     * WHAT MOVES THEM, NAMED CORRECTLY: `promote_contact_on_payment`, which
     * fires on a `payment_transactions` row that is `succeeded` with an amount
     * above zero, and resolves this business's own client stage by
     * `stage_type`. The comment here used to name
     * `promote_contact_on_confirmed_booking` — a trigger DROPPED in migration
     * 20260920, which replaced it precisely because confirmation is not
     * payment: a booking held for a free consultation is confirmed and owes
     * nothing, and a zero-amount row is bookkeeping rather than a sale.
     */
    const startingStage = resolvedFirstStage;

    requestLogger.debug({ startingStage }, 'Starting stage for a new contact');

    // Create/update CRM contact
    let contactId: string | null = null;

    // Check if contact already exists by email (use limit 1 to handle potential duplicates)
    const { data: existingContacts } = await supabaseServer
      .from('crm_contacts')
      .select('id, first_name, last_name, phone')
      .eq('user_id', ownerId)
      /* `ilike`, not `eq`: an address stored before this route started
         normalising is whatever the visitor typed, so a case-sensitive match
         misses it and a SECOND contact is created for the same person. The
         insert side is normalised now; this is what finds the rows that
         predate it. No wildcards in the value, so it stays an equality match
         in everything but case. */
      .ilike('email', emailLikePattern(data.email))
      .order('created_at', { ascending: true })
      .limit(1);

    const existingContact = existingContacts?.[0] || null;

    if (existingContact) {
      contactId = existingContact.id;
      // Update contact if we have new/better data
      const updates: Record<string, string | null> = {};
      if (!existingContact.first_name && clientFirstName) {
        updates.first_name = clientFirstName;
      }
      if (!existingContact.last_name && clientLastName) {
        updates.last_name = clientLastName;
      }
      if (!existingContact.phone && data.phone) {
        updates.phone = data.phone;
      }
      if (Object.keys(updates).length > 0) {
        await supabaseServer
          .from('crm_contacts')
          .update(updates)
          .eq('id', contactId);
        requestLogger.debug({ contactId, updates }, 'Updated existing contact with new data');
      }
    } else {
      // Create new contact
      const { data: newContact, error: contactError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: clientFirstName,
          last_name: clientLastName,
          email: data.email,
          phone: data.phone || null,
          source: 'website_booking',
          // The start of this owner's board. Money moves them on, not this
          // route — see the note where `startingStage` is resolved.
          ...(startingStage ? { stage: startingStage } : {})
        })
        .select('id')
        .single();

      if (contactError || !newContact) {
        requestLogger.error({ err: contactError }, 'Failed to create contact - cannot proceed without contact');
        return NextResponse.json(
          { success: false, error: 'Failed to create contact' },
          { status: 500 }
        );
      }
      contactId = newContact.id;
    }

    // Create the booking - already confirmed since payment succeeded
    // Note: client data is now stored only in crm_contacts (via contact_id)
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .insert({
        user_id: ownerId,
        service_id: data.service_id,
        contact_id: contactId, // Required - client data is in crm_contacts
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'confirmed',
        /**
         * Only free bookings are born paid.
         *
         * This read `price > 0 ? 'paid' : 'paid'` — a ternary with one answer —
         * and wrote NO `payment_transactions` row at all. So a priced booking
         * claimed the money had arrived while the platform held no record of it:
         * invisible to revenue, unrefundable, and impossible to reconcile.
         *
         * The route is unauthenticated and accepts `is_preview` to simulate a
         * payment, so this also stopped anyone who knew a subdomain and a
         * service id from minting confirmed, paid bookings.
         *
         * A priced booking now waits for the money to be recorded — by the
         * webhook, which is the only authority on whether Stripe actually took
         * it. Nothing in the app calls this route today; the widgets use
         * `/finalize`.
         */
        payment_status: (service.price ?? 0) > 0 ? 'pending' : 'paid',
        notes: data.notes || null,
        booking_source: 'website',
        timezone: data.timezone
      })
      .select('id, start_time, end_time')
      .single();

    if (bookingError || !booking) {
      requestLogger.error({ err: bookingError }, 'Failed to create booking');
      throw bookingError || new Error('Failed to create booking');
    }

    // NOTE: the booking `crm_activities` row is logged automatically by Postgres trigger T2
    // on the booking INSERT (contact_id set) — not inserted here (was double-logging).
    // (Scheduling plugin workplan §2 0.2.)

    // Send booking confirmation email (non-blocking)
    // skipInvoice=true since payment is already completed
    BookingEmailService.sendBookingConfirmation(booking.id, ownerId, { skipInvoice: true })
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Booking confirmation email failed'));

    /*
     * And put it in the owner's calendar (non-blocking).
     *
     * A booking made HERE — by a client, through the public site — never
     * reached the calendar, while one the owner made themselves always did. So
     * the hour showed as free to the only person who needed to know it was
     * taken. Never awaited: the appointment stands whether or not a calendar
     * plugin answers.
     */
    syncBookingToOwnerCalendar(booking.id, ownerId, requestLogger)
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Calendar sync failed'));

    // No payment receipt here. A receipt asserts that money arrived, and this
    // route no longer claims that for a priced booking — it records nothing, so
    // it has nothing to receipt. The webhook sends one when the payment is
    // actually recorded against the booking.

    requestLogger.info(
      { bookingId: booking.id, contactId, subdomain: data.subdomain, serviceId: data.service_id, isPreview: data.is_preview },
      'Booking confirmed successfully'
    );

    return NextResponse.json({
      success: true,
      message: 'Your booking has been confirmed!',
      booking: {
        id: booking.id,
        service: service.service_name,
        start_time: booking.start_time,
        end_time: booking.end_time,
        duration_minutes: service.duration_minutes,
        price: service.price,
        currency: service.currency,
        status: 'confirmed'
      },
      contact_id: contactId
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Booking confirmation failed');
    return NextResponse.json(
      { success: false, error: 'Failed to confirm booking' },
      { status: 500 }
    );
  }
}
