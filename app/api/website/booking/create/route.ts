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

    // Check if service is hidden on website (only for public access)
    if (hiddenServiceNames.has(service.service_name)) {
      return NextResponse.json(
        { success: false, error: 'This service is currently unavailable' },
        { status: 400 }
      );
    }

    // Determine if this is a scheduled booking (has start_time) or non-scheduled (course, product, etc.)
    const isScheduledBooking = !!data.start_time;
    let startTime: Date | null = null;
    let endTime: Date | null = null;

    if (isScheduledBooking) {
      // Calculate end time for scheduled bookings
      startTime = new Date(data.start_time!);
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

    // Determine if payment is required
    const requiresPayment = service.price !== null && service.price > 0;

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

    // Create the booking
    // Note: client data is now stored only in crm_contacts (via contact_id)
    // For paid services: status is 'pending' until payment is confirmed
    // For non-scheduled bookings (courses, products): start_time and end_time are null
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .insert({
        user_id: ownerId,
        service_id: data.service_id,
        contact_id: contactId,  // Required - client data is in crm_contacts
        start_time: startTime?.toISOString() || null,
        end_time: endTime?.toISOString() || null,
        status: requiresPayment ? 'pending' : 'confirmed',
        payment_status: requiresPayment ? 'pending' : 'paid',
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
    // (log_booking_activity_trigger) on the booking INSERT when contact_id is set. We do NOT
    // insert it here — doing so double-logged the activity. (Scheduling plugin workplan §2 0.2.)

    // Send booking confirmation email (non-blocking)
    // Only for FREE bookings - paid bookings get confirmation after payment in Stripe webhook
    if (!requiresPayment) {
      BookingEmailService.sendBookingConfirmation(booking.id, ownerId)
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
