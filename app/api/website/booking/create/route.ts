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
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { wallClockToInstant } from '@/lib/scheduling/wallClock';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { shouldTakePayment } from '@/lib/business-os/clientJourney';
import { openAttempt } from '@/lib/scheduling/abandonedBookings';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { syncBookingToOwnerCalendar } from '@/lib/scheduling/syncBookingCalendar';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
/*
 * Restored. The conversion call at the end of this route survived an import
 * tidy-up that took its import with it (1503dcd8), so `smartLinkRepository` was
 * a free variable in a file that reads as if it were imported.
 *
 * It is not a dead branch: `resolveVisitorSessionId()` ALWAYS returns an id, so
 * every booking from `/site/{subdomain}/book` carries `session_id` and reached
 * this line — throwing `ReferenceError` AFTER the booking row was written and
 * after the confirmation email was dispatched. The route's catch turned that
 * into a 500, so the client was told the booking failed for a booking that
 * exists, and the in-flight email was left racing an aborted request.
 */
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { buildAttributionFromRequest } from '@/lib/utils/attribution';
import { enrichCaptureAttribution } from '@/lib/business-os/enrichCaptureAttribution';
import { z } from 'zod';
import { ConsentInputSchema } from '@/lib/validation/consent';
import { recordConsent } from '@/lib/consent/recordConsent';
import { businessDateKey, businessHhmm, safeTimezone } from '@/lib/scheduling/businessTime';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';
import { closedDayVerdict } from '@/lib/scheduling/closedDay';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
/* The same readiness the owner's booking route and the website publish gate
   ask. One definition of "can this business honour this service", never a
   second opinion per surface. */
import { journeyGaps, isBlockingGap } from '@/lib/business-os/journeyReadiness';
import { sessionIdFromUrl } from '@/lib/utils/attribution';

const logger = createLogger({ module: 'WebsiteBookingCreateAPI' });

// Subdomain or userCode is optional - if not provided, authenticated user is used (preview mode)
// start_time is optional - if not provided, booking is created without scheduling (for courses, products, etc.)
const BookingSchema = z.object({
  /*
   * The visitor id the booking page was carrying.
   *
   * Sent from the browser because this is a POST to an API route: the page's
   * `_sid` is in the PAGE's URL, and `buildAttributionFromRequest` reading the
   * request URL finds nothing here. Without it the click that produced this
   * booking can never be matched to it.
   */
  session_id: z.string().max(128).optional(),
  /** The public page the visitor booked from, e.g. /c/abc123/book. */
  page_url: z.string().max(2048).optional(),
  /* The language the booking page was rendering in, so an abandoned-booking
     email is written in it rather than in the business's own. */
  locale: z.string().max(10).optional(),
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
  timezone: z.string().optional().default('UTC'),
  /*
   * Marketing consent, where the client ticked the box on the details step.
   * Optional in every sense: absent is normal, false is normal, and neither
   * can fail the booking.
   */
  consent: ConsentInputSchema
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

    /*
     * ── THE CLICK THAT BROUGHT THEM, FROM THE PAGE THEY WERE ON ───────────
     *
     * `session_id` has to be sent by the browser, because `_sid` lives in the
     * PAGE's address and an API route reading its own URL finds nothing. The
     * live widget never sent it — the same omission as `page_url` — so on a
     * smart link the attempt stored no session and `markConversion` below
     * never fired: the click was recorded, the booking it produced was not.
     *
     * Taken from `page_url` rather than asking the browser a second time. It
     * already carries `_sid`, the helper that reads it is the one attribution
     * uses, and a value derived from what was sent cannot be forgotten by the
     * next caller.
     */
    const sessionId =
      data.session_id ?? sessionIdFromUrl(data.page_url, new URL(request.url).origin) ?? null;


    // Extract attribution data from request (UTM params, referrer, etc.)
    const attribution = buildAttributionFromRequest(request, {
      /*
       * The page the visitor was on, not this route's own path.
       *
       * `buildAttributionFromRequest` falls back to `url.pathname`, and for a
       * POST to an API route that is the API route — so every contact ever
       * created recorded `capture_page_url` as '/api/website/...'. The field
       * existed and stored the one value that cannot answer the question it was
       * added for: which page converts.
       */
      pageUrl: data.page_url,
      captureChannel: 'booking',
      sessionId: sessionId ?? undefined,
      generateSessionId: true
    });

    /*
     * Where they came from: the page KIND, and the smart link if one sent them.
     * Shared with every other capture route, because five copies of this had
     * drifted into three different answers — see `enrichCaptureAttribution`.
     */
    await enrichCaptureAttribution(attribution, {
      subdomain: data.subdomain,
      pageUrl: data.page_url,
    });

    let ownerId: string;

    // Track hidden service names for validation (only used for public access)
    const hiddenServiceNames: Set<string> = new Set();

    // If subdomain is provided, look up website owner (public access)
    // If userCode is provided, look up business profile owner (standalone booking page)
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

    /*
     * THE WHOLE SERVICE ROW, NOT A LIST OF COLUMNS TYPED OUT HERE.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This named eight columns by hand, and the row has thirty. Everything
     * unnamed arrived `undefined` — and the code BELOW asks questions of fields
     * this select could not know it would need.
     *
     * Three bugs, all the same shape, all silent:
     *
     *   `collection`        omitted, so "is money taken here at all" could not
     *                       be consulted even in principle and fell back to
     *                       price.
     *
     *   `sale_mode`         omitted one bug later: a quoted service has no price
     *                       yet, so it looked FREE — and free files the contact
     *                       as a client on the spot. Asking for a quote made you
     *                       a client before anyone had named a figure.
     *
     *   `payment_type` and  omitted, so `isInstallmentPlan` inside
     *   `installment_count` `createBookingInvoice` read two undefined fields,
     *                       answered "no plan", and billed the whole total as
     *                       one invoice. A service sold as "2 × ₪400" invoiced
     *                       the client ₪800 and wrote no instalments at all.
     *
     * The owner's path never had any of these, because it does not type a list:
     * `findById` is `.select('*')`. Same client, same `id` + `user_id` scoping,
     * every column — including the ones added after this line was written.
     *
     * A hand-typed column list cannot know what its callers will ask for. That
     * is the bug class, and this is the end of it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: service, error: serviceError } =
      await schedulingServiceRepository.findById(data.service_id, ownerId);

    if (serviceError || !service) {
      requestLogger.warn({ serviceId: data.service_id }, 'Service not found');
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      );
    }

    /*
     * BOOKABLE IS BOTH FLAGS, AND THIS SURFACE ONLY CHECKED ONE.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * `SchedulingServiceRepository.BOOKABLE` is `{ is_active: true, status:
     * 'active' }`, and its own comment says it exists "so the next surface
     * cannot pick one and forget the other". This route forgot `status`.
     *
     * Three public routes read the catalogue through `listBookable` and honour
     * both — the availability endpoint, the services block and the public site.
     * This is the route that actually TAKES the booking, and it accepted a
     * DRAFT service that none of those three would have offered. Editing a
     * service reverts it to draft, so any service mid-edit was publicly
     * bookable while absent from every list.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (!service.is_active || service.status !== 'active') {
      requestLogger.warn(
        { serviceId: data.service_id, isActive: service.is_active, status: service.status },
        'Booking refused: the service is not published'
      );
      return NextResponse.json(
        { success: false, error: 'This service is currently unavailable' },
        { status: 400 }
      );
    }

    /*
     * AND THE BUSINESS HAS TO BE ABLE TO HONOUR IT.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The owner's own booking route has gated on this for some time
     * (`app/api/scheduling/bookings/route.ts`), on the reasoning that a
     * client-side gate is a convenience and the route is the authority. The
     * PUBLIC route — the one a client actually uses — never asked at all.
     *
     * So a client could book an invoiced service from a business with no
     * invoice company name, no tax id, no address and no payment instructions,
     * and be sent an invoice built from none of them. That is the reported
     * failure, and it is the one surface where the client, not the owner, pays
     * for the omission.
     *
     * `isBlockingGap` keeps the card processor OUT of this: a service sold by
     * card with no Stripe falls back to an invoice and is perfectly valid. What
     * blocks is hours, timezone and invoicing — the three a client-facing
     * promise cannot be kept without.
     *
     * FAILS OPEN, exactly as the owner's route does: `journeyGaps` reaches the
     * database three times, and an outage there must not stop a business taking
     * work. Only a gap positively found refuses.
     *
     * The message names nothing. Which fields a business has not filled in is
     * the OWNER's information; a client gets "unavailable" and the owner gets
     * the detail on their own dashboard.
     * ─────────────────────────────────────────────────────────────────────────
     */
    try {
      const blocking = (
        await journeyGaps(ownerId, [
          {
            name: service.service_name,
            is_scheduled: service.is_scheduled,
            collection: service.collection,
            price: service.price,
            /* A quote ends in an invoice too — see `JourneyReadinessService.sale_mode`. */
            sale_mode: service.sale_mode,
          },
        ])
      ).filter(isBlockingGap);

      if (blocking.length > 0) {
        requestLogger.warn(
          { ownerId, serviceId: data.service_id, gaps: blocking.map(g => g.kind) },
          'Public booking refused: the business cannot honour this service yet'
        );
        return NextResponse.json(
          { success: false, error: 'This service is currently unavailable' },
          { status: 400 }
        );
      }
    } catch (error) {
      requestLogger.error(
        { err: error, ownerId, serviceId: data.service_id },
        'Readiness check failed; allowing the booking rather than losing it'
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

    // `safeTimezone` validates against Intl; the bare `||` it replaces only
    // caught null, so an unrecognised stored zone reached the booking record
    // and every hour rendered from it afterwards.
    const bookingTimezone = safeTimezone(ownerPrefs?.timezone || data.timezone);

    // Determine if this is a scheduled booking (has start_time) or non-scheduled (course, product, etc.)
    const isScheduledBooking = !!data.start_time;
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    if (isScheduledBooking) {
      // Calculate end time for scheduled bookings
      startTime = new Date(wallClockToInstant(data.start_time!, bookingTimezone));
      endTime = new Date(startTime.getTime() + (service.duration_minutes || 0) * 60 * 1000);

      /*
       * Check for conflicts (only for scheduled bookings).
       *
       * `busyMeetings` is bounded by the appointment's own span, so the window
       * IS the overlap test — anything it returns collides by definition.
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

      /*
       * ─────────────────────────────────────────────────────────────────────
       * AND IS THE BUSINESS OPEN THAT DAY?
       *
       * The slot list this page offers already applies the closed days, so a
       * client reaching here means a page left open across the owner recording
       * a holiday — or a POST that never saw the list. Either way the hour is
       * not for sale, and a client cannot overrule the owner's diary the way
       * the owner can from their own calendar.
       *
       * Answered with the same sentence as a taken slot: it is the same
       * instruction — that time is not available, choose another — and the
       * owner's holiday is not a client's business.
       *
       * An unreadable list lets the booking through, which is the choice this
       * page's availability route already makes: a business whose booking page
       * refuses everyone loses more than one booking on a closed day costs.
       * ─────────────────────────────────────────────────────────────────────
       */
      const dateKey = businessDateKey(startTime, bookingTimezone);

      const { data: timeOff, error: timeOffError } = await schedulingTimeOffRepository.list(
        ownerId,
        { from: dateKey, to: dateKey }
      );

      if (timeOffError) {
        requestLogger.warn(
          { err: timeOffError, ownerId },
          'Time off unreadable; the booking is allowed'
        );
      } else {
        const closed = closedDayVerdict(timeOff ?? [], dateKey, {
          start: businessHhmm(startTime, bookingTimezone),
          end: businessHhmm(endTime, bookingTimezone),
        });

        if (closed.closed) {
          requestLogger.info(
            { ownerId, date: dateKey, kind: closed.kind },
            'Public booking refused: the day is closed'
          );
          return NextResponse.json(
            { success: false, error: 'This time slot is no longer available' },
            { status: 409 }
          );
        }
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
      /* A quoted service takes no money here — see `shouldTakePayment`. Its
         price is the starting figure for a quote, not an agreed amount, and
         the journey the client walked has no payment step in it. */
      saleMode: service.sale_mode,
    });

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * A SERVICE THAT TAKES MONEY WRITES NOTHING YET.
     *
     * Everything above this line is a CHECK — the service is bookable, the
     * business can honour it, the slot is free, the day is not a holiday. Every
     * write is below it: the contact, the consent, the booking.
     *
     * For a card payment the client now leaves to pay, and may never come back.
     * Writing the booking here is what left a `pending` row holding the slot
     * against every other client, permanently: `pending` is in
     * `SLOT_HOLDING_STATUSES`, `scheduling_bookings_no_overlap` enforces it in
     * the database, no cron releases it, and `checkout.session.expired` is
     * handled only for the platform's own billing.
     *
     * So the journey is recorded instead. `abandoned_bookings` holds what they
     * typed and blocks nothing — no availability check reads it. The booking,
     * and the contact, are created by `finalize` once the payment has actually
     * succeeded.
     *
     * AN EARLY RETURN rather than a condition threaded through the four hundred
     * lines below. Those lines are fifteen recorded production bugs deep, and
     * every one of them is about writing the right thing in the right order for
     * a booking that is being made NOW. Interleaving a second meaning through
     * them is how the sixteenth gets written; returning before any of them run
     * leaves every other service type on exactly the code it ran yesterday.
     *
     * The six paths that take no money at this point — free, invoice-collected,
     * card with no processor connected, quote request, product, package — fall
     * straight through. For them this route IS the last stage of the journey,
     * so there is no window in which to abandon anything.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (requiresPayment) {
      const attemptId = await openAttempt({
        userId: ownerId,
        serviceId: data.service_id,
        firstName: clientFirstName,
        lastName: clientLastName,
        email: data.email,
        phone: data.phone ?? null,
        startTime: startTime ? startTime.toISOString() : null,
        endTime: endTime ? endTime.toISOString() : null,
        timezone: bookingTimezone,
        source: 'website',
        sessionId,
        /* Where they were, for the rebook button. Not rebuilt from the service:
           a page reached by custom domain, landing page or smart link cannot be
           reconstructed from the service id alone. */
        pageUrl: data.page_url ?? null,
        locale: data.locale ?? null,
      });

      requestLogger.info(
        { attemptId, serviceId: data.service_id, hasSlot: Boolean(startTime) },
        'Payment required — recorded the attempt, booking deferred to finalize'
      );

      return NextResponse.json({
        success: true,
        requires_payment: true,
        /*
         * No `booking` key, deliberately.
         *
         * The client used to read `data.booking.id` here and carry it to the
         * payment step. There is no booking to carry any more, and returning an
         * attempt id under that name would have `finalize` look up a booking
         * that does not exist — failing AFTER the client had paid. The absence
         * is what makes an un-updated caller fail loudly and immediately.
         */
        attempt_id: attemptId,
        service: {
          id: service.id,
          name: service.service_name,
          price: service.price,
          currency: service.currency,
        },
      });
    }

    /*
     * The start of this owner's board, resolved in the repository that owns the
     * table. This was an inline read ending `|| 'lead'` — one of eight copies,
     * and a stage many pipelines do not contain.
     */
    const { data: resolvedFirstStage } =
      await crmPipelineStagesRepository.firstStageKey(ownerId);

    /*
     * Kept as a string here, unlike the other call sites: it is compared below
     * as well as inserted, and `crm_contacts.stage` is `DEFAULT 'lead'` anyway.
     */
    const firstStage = resolvedFirstStage ?? 'lead';

    /*
     * A new contact starts at the beginning. Always.
     *
     * This route used to decide the client stage itself — free service, so they
     * are a client now — which is how a quote request produced a client. It no
     * longer decides at all: `promote_contact_on_payment (which replaced the dropped promote_contact_on_confirmed_booking, 20260920)` moves them
     * the moment the booking below is written `confirmed`, which for a free
     * service is immediately and for a quote request is not at all.
     *
     * One rule, in one place, reached by every path that confirms a booking.
     */
    const isQuoteRequest = service.sale_mode === 'proposal';
    const contactStage = firstStage;

    requestLogger.info(
      {
        price: service.price,
        saleMode: service.sale_mode,
        requiresPayment,
        isQuoteRequest,
        contactStage,
        firstStage,
      },
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
     * Marketing consent, where the client gave it.
     *
     * After the contact, and non-blocking: a failure here loses a consent
     * record, never a booking. An untouched checkbox writes nothing at all —
     * it is not a withdrawal, and treating it as one would silently
     * unsubscribe somebody who opted in on a different form last month.
     */
    void recordConsent({
      userId: ownerId,
      contactId,
      email: data.email,
      consent: data.consent,
      sourceSurface: 'booking',
      sourcePageUrl: data.page_url ?? null,
      attribution,
    });

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
        /*
         * A quote request is not a confirmed appointment.
         *
         * `requiresPayment` is false for a quoted service — there is nothing to
         * charge until a price exists — so this wrote it `confirmed`, and the
         * line below wrote it `paid` because the price is 0. A request for a
         * quotation was therefore recorded as a booking that had happened and
         * been paid for, which is why the CRM moved the contact to the client
         * stage: by every field on the row, they were one.
         *
         * It stays PENDING until the quote is written and accepted.
         */
        status: requiresPayment || isQuoteRequest ? 'pending' : 'confirmed',
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
        /*
         * And a quote has nothing paid about it either. Zero is not the price
         * of this job; it is the absence of one.
         */
        payment_status: isQuoteRequest || (service.price || 0) > 0 ? 'pending' : 'paid',
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

    // NOTE: the booking `crm_activities` row is logged automatically by Postgres trigger T2
    // (log_booking_activity_trigger) on the booking INSERT when contact_id is set. We do NOT
    // insert it here — doing so double-logged the activity. (Scheduling plugin workplan §2 0.2.)

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
          /* No cast. It was `service as never`, and that cast is precisely why
             the missing plan columns never surfaced: it told TypeScript to stop
             checking the one shape that would have named them. The repository
             returns a real `SchedulingService`, so the types line up. */
          service,
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

    // Send booking confirmation email
    // Only for FREE bookings - paid bookings get confirmation after payment in Stripe webhook
    if (!requiresPayment) {
      /*
       * AWAITED, not fired and forgotten.
       *
       * ───────────────────────────────────────────────────────────────────────
       * These two were dispatched as bare promises and the response was returned
       * underneath them. Nothing owns work that outlives its request: a
       * serverless invocation is frozen the moment it responds, and a dev server
       * reloading drops it just the same. When that happened the client's
       * confirmation, their intake request and the `booking_confirmation_sent`
       * activity all vanished together, with no error anywhere — the `.catch`
       * below never ran, because nothing rejected. The booking existed, the
       * client heard nothing.
       *
       * It is not theoretical: booking 4cd6a797 (2026-09-28 14:03:53, website)
       * has its `booking_created` activity — written before the response — and
       * none of the three effects below, while an identical booking 11 minutes
       * later has all of them.
       *
       * `allSettled` so a failing send is still only a warning: the booking is
       * made either way, and the client is already looking at a confirmation
       * screen. The cost is that they wait for the mail to be handed to the
       * transport, which is the right trade for the one email that tells them
       * the appointment is real.
       * ───────────────────────────────────────────────────────────────────────
       */
      const [confirmation, intakeRequest] = await Promise.allSettled([
        // `skipInvoice` when one was just raised: its payment link travels with
        // the confirmation rather than in a second email.
        BookingEmailService.sendBookingConfirmation(booking.id, ownerId, bookingInvoice
          ? {
              skipInvoice: true,
              invoiceId: bookingInvoice.id,
              stripeHostedInvoiceUrl: bookingInvoice.stripe_hosted_invoice_url || undefined,
            }
          : undefined),
        // Send intake form request email
        // This helps clients prepare for their appointment
        BookingEmailService.sendIntakeFormRequest(booking.id, ownerId),
      ]);

      if (confirmation.status === 'rejected') {
        requestLogger.warn({ err: confirmation.reason, bookingId: booking.id }, 'Booking confirmation email failed');
      } else if (!confirmation.value?.sent) {
        requestLogger.warn(
          { bookingId: booking.id, error: confirmation.value?.error },
          'Booking confirmation email was not delivered to any transport'
        );
      }

      if (intakeRequest.status === 'rejected') {
        requestLogger.warn({ err: intakeRequest.reason, bookingId: booking.id }, 'Intake form request email failed');
      }

      /*
       * No email to the owner for a booking, deliberately — see the note in
       * /finalize. It is already in their calendar and in the briefing, and an
       * alert per booking is what teaches somebody to ignore the sender.
       */
      /*
       * And put it in the owner's calendar (non-blocking).
       *
       * Only for a booking that is CONFIRMED and has a time. A paid one is
       * still `pending` here and is synced by `/finalize` once the money is
       * recorded; a quote request is pending by design and is not an
       * appointment at all; and a service with no slot has no hour to block.
       *
       * See `lib/scheduling/syncBookingCalendar` for why this was missing.
       */
      if (!isQuoteRequest && isScheduledBooking) {
        syncBookingToOwnerCalendar(booking.id, ownerId, requestLogger)
          .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Calendar sync failed'));
      }
    }

    requestLogger.info(
      { bookingId: booking.id, subdomain: data.subdomain, serviceId: data.service_id, requiresPayment, isScheduledBooking },
      'Booking created successfully'
    );

    /*
     * Close the loop from click to booking.
     *
     * `markConversion` matches the click on `session_id`, which is why the id
     * had to travel from the smart-link redirect through the page and into this
     * request. It has existed and been called by nothing, so no smart link has
     * ever reported a conversion.
     *
     * Non-blocking and never fatal: the booking is made, and a business must
     * not lose one because attribution failed.
     */
    if (sessionId) {
      smartLinkRepository
        .markConversion(sessionId, 'booking')
        .catch(err => requestLogger.warn({ err }, 'Could not mark the smart-link conversion'));
    }

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
