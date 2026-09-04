/**
 * Website Booking Creation API
 * POST - Create a booking from the public website booking widget
 *
 * This endpoint:
 * 1. Validates the booking request
 * 2. Checks slot availability
 * 3. Creates/updates CRM contact (unless skip_contact=true for paid services)
 * 4. Creates the booking linked to the contact
 *
 * For paid services: Use skip_contact=true to defer contact creation until
 * after payment succeeds. Call /api/website/booking/finalize after payment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { wallClockToInstant } from '@/lib/scheduling/wallClock';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { shouldTakePayment } from '@/lib/business-os/clientJourney';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { buildAttributionFromRequest, type LeadSourceMetadata } from '@/lib/utils/attribution';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBookingCreateAPI' });

// Subdomain or userCode is optional - if not provided, authenticated user is used (preview mode)
// start_time is optional - if not provided, booking is created without scheduling (for courses, products, etc.)
const BookingSchema = z.object({
  // Transform empty strings to undefined so they're treated as "not provided"
  subdomain: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  // userCode is an alternative to subdomain for standalone booking pages (/c/[userCode]/book)
  userCode: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  service_id: z.string().uuid('Invalid service ID'),
  // Optional - when not provided or empty, creates non-scheduled booking (courses, products)
  // Transform empty strings to undefined so they're treated as "not provided"
  start_time: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional().transform(val => val && val.trim() ? val : undefined),
  notes: z.string().max(2000).optional().transform(val => val && val.trim() ? val : undefined),
  timezone: z.string().optional().default('UTC')
  // Removed skip_contact - we now always create contact first, using stage to differentiate lead vs active_client
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();

    // Validate input
    const validationResult = BookingSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid booking data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    // Extract attribution data from request (UTM params, referrer, etc.)
    const attribution = buildAttributionFromRequest(request, {
      captureChannel: 'booking',
      generateSessionId: true
    });

    let ownerId: string;

    // Track hidden service names for validation (only used for public access)
    let hiddenServiceNames: Set<string> = new Set();

    // If subdomain is provided, look up website owner (public access)
    // If userCode is provided, look up business profile owner (standalone booking page)
    // Otherwise, use authenticated user (preview mode)
    if (data.subdomain && data.subdomain.trim()) {
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('id, user_id')
        .eq('subdomain', data.subdomain)
        .single();

      if (pageError || !websitePage) {
        requestLogger.warn({ subdomain: data.subdomain }, 'Website not found');
        return NextResponse.json(
          { success: false, error: 'Website not found' },
          { status: 404 }
        );
      }
      ownerId = websitePage.user_id;

      // Fetch hidden service names from the services block content
      try {
        const blockRepo = new WebsiteBlockRepository(supabaseServer);
        const blocksResult = await blockRepo.findByPageId(websitePage.id);
        if (blocksResult.data) {
          const servicesBlock = blocksResult.data.find(b => b.block_type === 'services');
          if (servicesBlock) {
            const savedServices = (servicesBlock.content as Record<string, unknown>)?.services as Array<{ name: string; hidden?: boolean }> | undefined;
            if (savedServices && Array.isArray(savedServices)) {
              savedServices.forEach(s => {
                if (s.name && s.hidden === true) {
                  hiddenServiceNames.add(s.name);
                }
              });
            }
          }
        }
      } catch (err) {
        requestLogger.warn({ err }, 'Failed to fetch hidden service flags');
      }
    } else if (data.userCode && data.userCode.trim()) {
      // Standalone booking page - look up business profile by userCode
      const { data: businessProfile, error: profileError } = await supabaseServer
        .from('business_profiles')
        .select('user_id')
        .eq('user_code', data.userCode.toLowerCase())
        .single();

      if (profileError || !businessProfile) {
        requestLogger.warn({ userCode: data.userCode }, 'Business not found');
        return NextResponse.json(
          { success: false, error: 'Business not found' },
          { status: 404 }
        );
      }
      ownerId = businessProfile.user_id;
      // Note: For standalone booking pages, we don't check hidden services
      // (the services are already filtered in the availability API)
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
      // `collection` is what decides whether money is taken here at all. The
      // select omitted it, so the decision below could not consult it even in
      // principle and fell back to price.
      .select('id, service_name, duration_minutes, price, currency, is_active, collection')
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

    // Check if service is hidden on website (only for public access)
    if (hiddenServiceNames.has(service.service_name)) {
      return NextResponse.json(
        { success: false, error: 'This service is currently unavailable' },
        { status: 400 }
      );
    }

    /*
     * The hour belongs to the business, so the booking is measured in the
     * business's timezone — and stored as the instant that hour actually is.
     *
     * Two bugs met here. The zone came from `data.timezone`, whatever the
     * CLIENT's browser reported, so one diary held bookings labelled
     * `America/New_York` and `UTC` at once. And `new Date(naive)` parses a
     * string with no offset as SERVER-local, so the slot a client picked at
     * 13:00 was stored as 13:00Z and read back — correctly, in the business's
     * own zone — as 09:00. Four hours lost between the button and the row.
     *
     * The timezone is read from `user_preferences`, which is where the settings
     * page writes it.
     */
    const { data: ownerPrefs } = await supabaseServer
      .from('user_preferences')
      .select('timezone')
      .eq('user_id', ownerId)
      .maybeSingle();

    const bookingTimezone = ownerPrefs?.timezone || data.timezone || 'UTC';

    // Determine if this is a scheduled booking (has start_time) or non-scheduled (course, product, etc.)
    const isScheduledBooking = !!data.start_time;
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    if (isScheduledBooking) {
      // Calculate end time for scheduled bookings
      startTime = new Date(wallClockToInstant(data.start_time!, bookingTimezone));
      endTime = new Date(startTime.getTime() + (service.duration_minutes || 0) * 60 * 1000);

      // Check for conflicts (only for scheduled bookings)
      const { data: conflicts } = await supabaseServer
        .from('scheduling_bookings')
        .select('id')
        .eq('user_id', ownerId)
        .neq('status', 'cancelled')
        .or(`and(start_time.lt.${endTime.toISOString()},end_time.gt.${startTime.toISOString()})`);

      if (conflicts && conflicts.length > 0) {
        return NextResponse.json(
          { success: false, error: 'This time slot is no longer available' },
          { status: 409 }
        );
      }
    }

    // Parse name into first_name and last_name
    const nameParts = data.name.trim().split(/\s+/);
    const clientFirstName = nameParts[0] || data.name;
    const clientLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    /**
     * Whether this booking takes money here, decided the same way the client's
     * journey was drawn.
     *
     * This was `price > 0`, which is a different question. A service billed
     * afterwards has a price and takes no card; a service set to collect by card
     * takes none either when the business has no processor. Both were treated as
     * "requires payment", which set the booking `pending`, suppressed the
     * confirmation email, and told the client to go and pay — with nothing on the
     * other side. The invoice never went out either, because the email that
     * carries it is the one that was suppressed.
     */
    const capability = await resolvePaymentCollectionCapability(supabaseServer, ownerId);

    const requiresPayment = shouldTakePayment({
      price: service.price,
      collection: service.collection,
      processorReady: capability.canCollect,
    });

    // Get user's pipeline stages to determine appropriate stages
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key, position')
      .eq('user_id', ownerId)
      .order('position', { ascending: true });

    // First stage for leads (paid services that need payment first)
    const firstStage = pipelineStages?.[0]?.stage_key || 'lead';

    // Find best "active client" stage for free services (they're immediately clients)
    // Priority: 'active_client' > 'active' > 'client' > highest non-terminal stage > first stage
    let activeClientStage = firstStage;
    if (pipelineStages && pipelineStages.length > 0) {
      const stageKeys = pipelineStages.map(s => s.stage_key);
      if (stageKeys.includes('active_client')) {
        activeClientStage = 'active_client';
      } else if (stageKeys.includes('active')) {
        activeClientStage = 'active';
      } else if (stageKeys.includes('client')) {
        activeClientStage = 'client';
      } else {
        // Use the stage with highest position but not terminal stages
        const validStages = pipelineStages.filter(
          s => !['completed', 'inactive', 'past_client'].includes(s.stage_key)
        );
        if (validStages.length > 0) {
          activeClientStage = validStages[validStages.length - 1].stage_key;
        }
      }
    }

    // Determine contact stage based on payment requirement
    // For paid services: start at first pipeline stage (will be upgraded after payment)
    // For free services: directly set as active client (no payment barrier)
    const contactStage = requiresPayment ? firstStage : activeClientStage;

    requestLogger.info(
      { price: service.price, requiresPayment, contactStage, firstStage, activeClientStage },
      'Contact creation decision - always creating contact first'
    );

    // ALWAYS create or find contact (for both free and paid services)
    // This ensures contact exists before booking, enabling better tracking and email capabilities
    let contactId: string | null = null;

    // Check if contact already exists by email (use limit 1 to handle potential duplicates)
    const { data: existingContacts } = await supabaseServer
      .from('crm_contacts')
      .select('id, first_name, last_name, phone, stage')
      .eq('user_id', ownerId)
      .eq('email', data.email)
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
      // Don't downgrade stage - if they were already active_client, keep them there
      // Only upgrade lead to active_client for free services
      if (existingContact.stage === 'lead' && contactStage === 'active_client') {
        updates.stage = 'active_client';
      }
      if (Object.keys(updates).length > 0) {
        await supabaseServer
          .from('crm_contacts')
          .update(updates)
          .eq('id', contactId);
        requestLogger.debug({ contactId, updates }, 'Updated existing contact with new data');
      }
    } else {
      // Create new contact with appropriate stage and attribution
      const { data: newContact, error: contactError } = await supabaseServer
        .from('crm_contacts')
        .insert({
          user_id: ownerId,
          first_name: clientFirstName,
          last_name: clientLastName,
          email: data.email,
          phone: data.phone || null,
          source: 'website_booking',
          stage: contactStage,  // 'lead' for paid services, 'active_client' for free
          source_metadata: attribution as unknown as Record<string, unknown>  // Store full attribution data
        })
        .select('id')
        .single();

      if (contactError) {
        requestLogger.warn({ err: contactError }, 'Failed to create contact (proceeding without)');
      } else if (newContact) {
        contactId = newContact.id;
        requestLogger.info({ contactId, stage: contactStage }, 'Created new contact for booking');
      }
    }

    /*
     * Reuse the booking this client already has waiting, rather than adding
     * another.
     *
     * ─────────────────────────────────────────────────────────────────────
     * This route inserted unconditionally, so it produced one booking per
     * CALL rather than one per purchase. Two ways that bites, and one
     * checkout hit both:
     *
     *   1. A double submit. Two rows landed 68ms apart — the browser mounting
     *      the step twice, which is exactly what React does in development
     *      and what a double-click does anywhere. Only the second was ever
     *      paid; the first sat `pending` forever.
     *   2. Coming back. A client who reaches payment, abandons, and returns
     *      ten minutes later got a second booking for the same seat.
     *
     * The contact was already deduped by email a few lines up. The booking
     * was not, so one purchase left three rows on the owner's contact card,
     * two of them dead — and no way to tell which was real.
     *
     * Only an UNPAID booking is reusable. A paid one is a completed sale, and
     * a client buying the same service again deserves a second booking; that
     * is the case this must not collapse. `start_time` is matched too, so
     * booking two different slots of the same service stays two bookings —
     * `is` for the null of a non-scheduled product, `eq` otherwise, because
     * `eq(null)` matches nothing in PostgREST and would silently defeat this.
     * ─────────────────────────────────────────────────────────────────────
     */
    let reusable: { id: string; start_time: string | null; end_time: string | null } | null = null;

    if (contactId) {
      let pendingQuery = supabaseServer
        .from('scheduling_bookings')
        .select('id, start_time, end_time')
        .eq('user_id', ownerId)
        .eq('service_id', data.service_id)
        .eq('contact_id', contactId)
        .eq('status', 'pending')
        .eq('payment_status', 'pending');

      pendingQuery = startTime
        ? pendingQuery.eq('start_time', startTime.toISOString())
        : pendingQuery.is('start_time', null);

      const { data: existingPending } = await pendingQuery
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingPending) {
        reusable = existingPending;
        requestLogger.info(
          { bookingId: existingPending.id, contactId, serviceId: data.service_id },
          'Reusing the unpaid booking this client already had'
        );
      }
    }

    // Create the booking
    // Note: client data is now stored only in crm_contacts (via contact_id)
    // For paid services: status is 'pending' until payment is confirmed
    // For non-scheduled bookings (courses, products): start_time and end_time are null
    const insertResult = reusable
      ? { data: reusable, error: null }
      : await supabaseServer
      .from('scheduling_bookings')
      .insert({
        user_id: ownerId,
        service_id: data.service_id,
        contact_id: contactId,  // Required - client data is in crm_contacts
        start_time: startTime?.toISOString() || null,
        end_time: endTime?.toISOString() || null,
        status: requiresPayment ? 'pending' : 'confirmed',
        /*
         * Owing money is not the same as having paid it.
         *
         * This read `requiresPayment ? 'pending' : 'paid'`, which is only right
         * when the service is FREE. A service set to `collection: 'invoice'`
         * takes no money online — `shouldTakePayment` is false — so a ₪200
         * booking was written straight to `paid` having billed nobody. The
         * owner's money list showed it collected, and no invoice existed.
         *
         * Paid means paid: price zero, or nothing to collect.
         */
        payment_status: (service.price || 0) > 0 ? 'pending' : 'paid',
        notes: data.notes || null,
        booking_source: 'website',
        timezone: bookingTimezone
      })
      .select('id, start_time, end_time')
      .single();

    const { data: booking, error: bookingError } = insertResult;

    /*
     * The appointment itself, on the client's timeline.
     *
     * Nothing recorded a booking being made: the drawer showed the emails about
     * it and never the event, so the first thing in a client's history was a
     * confirmation for something that appeared from nowhere.
     */
    if (!bookingError && booking && contactId) {
      const { data: ownerProfile } = await supabaseServer
        .from('business_profiles')
        .select('language')
        .eq('user_id', ownerId)
        .maybeSingle();
      const ownerLocale = ownerProfile?.language || 'en';
      const when = activityMoment(booking.start_time, ownerLocale, bookingTimezone);

      crmActivityRepository.create({
        user_id: ownerId,
        contact_id: contactId,
        activity_type: 'booking_created',
        // No date phrase for a course or a product, which has no time at all.
        title: activitySentence(
          when ? 'booking_created_dated' : 'booking_created',
          { service: service.service_name, date: when || '' },
          ownerLocale
        ),
        description: JSON.stringify({
          kind: 'booking_created',
          service: service.service_name,
          bookingDate: booking.start_time || undefined,
          timeZone: bookingTimezone,
        }),
        auto_logged: true,
        source_capability: 'scheduling',
        source_entity_id: booking.id,
        activity_date: booking.start_time || undefined,
      }).catch(err => requestLogger.warn({ err }, 'Booking-created activity logging failed (non-blocking)'));
    }

    if (bookingError || !booking) {
      requestLogger.error({ err: bookingError }, 'Failed to create booking');
      throw bookingError || new Error('Failed to create booking');
    }

    // Note: Activity is auto-created by log_booking_activity_trigger (scheduling_bookings table trigger)

    /*
     * Bill for it, when the business bills rather than charges.
     *
     * `collection: 'invoice'` means the money is not taken at the point of
     * booking — but it IS owed. The website flow raised no invoice at all, so a
     * ₪200 booking produced a confirmation email, no bill, and nothing for the
     * client to pay against. Only the owner-created path invoiced; a client who
     * booked through the business's own website did not.
     *
     * `createBookingInvoice` is that same producer, exported rather than
     * copied — one invoice numbering sequence, one shape of row.
     */
    let bookingInvoice: { id: string; stripe_hosted_invoice_url?: string | null } | null = null;
    const billsByInvoice = !requiresPayment && (service.price || 0) > 0;

    if (billsByInvoice && contactId) {
      try {
        const { createBookingInvoice } = await import('@/lib/services/BookingLifecycleService');
        const clientName = [clientFirstName, clientLastName].filter(Boolean).join(' ').trim();

        bookingInvoice = await createBookingInvoice(
          ownerId,
          booking.id,
          service as never,
          {
            contact_id: contactId,
            contact_name: clientName || 'Client',
            contact_email: data.email,
            // Products have no slot; the invoice still needs a due date, and
            // `new Date(null)` would make it 1 January 1970.
            start_time: booking.start_time ?? new Date().toISOString(),
          },
          requestLogger as never
        );

        requestLogger.info(
          { bookingId: booking.id, invoiceId: bookingInvoice?.id },
          'Invoice raised for a booking the business bills for'
        );
      } catch (err) {
        // Loud: the appointment exists and nobody has been billed for it.
        requestLogger.error({ err, bookingId: booking.id }, 'Failed to raise the invoice for this booking');
      }
    }

    // Send booking confirmation email (non-blocking)
    // Only for FREE bookings - paid bookings get confirmation after payment in Stripe webhook
    if (!requiresPayment) {
      // `skipInvoice` when one was just raised: its payment link travels with
      // the confirmation rather than in a second email.
      BookingEmailService.sendBookingConfirmation(booking.id, ownerId, bookingInvoice
        ? {
            skipInvoice: true,
            invoiceId: bookingInvoice.id,
            stripeHostedInvoiceUrl: bookingInvoice.stripe_hosted_invoice_url || undefined,
          }
        : undefined)
        .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Booking confirmation email failed'));

      // Send intake form request email (non-blocking)
      // This helps clients prepare for their appointment
      BookingEmailService.sendIntakeFormRequest(booking.id, ownerId)
        .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Intake form request email failed'));
    }

    requestLogger.info(
      { bookingId: booking.id, subdomain: data.subdomain, serviceId: data.service_id, requiresPayment, isScheduledBooking },
      'Booking created successfully'
    );

    return NextResponse.json({
      success: true,
      message: requiresPayment
        ? 'Booking created. Please complete payment to confirm.'
        : 'Your booking has been confirmed!',
      booking: {
        id: booking.id,
        service: service.service_name,
        start_time: booking.start_time,
        end_time: booking.end_time,
        duration_minutes: service.duration_minutes,
        price: service.price,
        currency: service.currency,
        requires_payment: requiresPayment,
        status: requiresPayment ? 'pending' : 'confirmed',
        is_scheduled: isScheduledBooking
      }
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Booking creation failed');
    return NextResponse.json(
      { success: false, error: 'Failed to create booking' },
      { status: 500 }
    );
  }
}
