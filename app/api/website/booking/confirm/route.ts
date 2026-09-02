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
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBookingConfirmAPI' });

const ConfirmBookingSchema = z.object({
  subdomain: z.string().optional(),
  service_id: z.string().uuid('Invalid service ID'),
  start_time: z.string().min(1, 'Start time is required'),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  notes: z.string().max(2000).optional(),
  timezone: z.string().optional().default('UTC'),
  payment_intent_id: z.string().optional(), // Stripe payment intent (for real payments)
  is_preview: z.boolean().optional() // True if payment was simulated
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

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
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('user_id')
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

    // Check for conflicts (double-check availability)
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

    // Parse name into first_name and last_name
    const nameParts = data.name.trim().split(/\s+/);
    const clientFirstName = nameParts[0] || data.name;
    const clientLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    // Get user's pipeline stages to find the best "active client" stage for paid customers
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key, position')
      .eq('user_id', ownerId)
      .order('position', { ascending: true });

    // Find best "active client" stage - priority: 'active_client' > 'active' > 'client' > highest non-terminal
    let activeClientStage = 'client'; // fallback
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

    requestLogger.debug({ activeClientStage, pipelineStages }, 'Determined active client stage for paid booking');

    // Create/update CRM contact
    let contactId: string | null = null;

    // Check if contact already exists by email (use limit 1 to handle potential duplicates)
    const { data: existingContacts } = await supabaseServer
      .from('crm_contacts')
      .select('id, first_name, last_name, phone')
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
          stage: activeClientStage // Use user's active client pipeline stage
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

    // Note: Activity is auto-created by log_booking_activity_trigger (scheduling_bookings table trigger)

    // Send booking confirmation email (non-blocking)
    // skipInvoice=true since payment is already completed
    BookingEmailService.sendBookingConfirmation(booking.id, ownerId, { skipInvoice: true })
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Booking confirmation email failed'));

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
