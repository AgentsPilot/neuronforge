/**
 * Website Booking Finalization API
 * POST - Finalize a booking after payment succeeds
 *
 * This endpoint:
 * 1. Updates the booking status to 'confirmed' and payment_status to 'paid'
 * 2. Creates/updates the CRM contact (if not already created)
 * 3. Links the contact to the booking
 * 4. Creates the CRM activity log
 *
 * Called after payment succeeds for paid services.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBookingFinalizeAPI' });

const FinalizeSchema = z.object({
  subdomain: z.string().optional(),
  booking_id: z.string().uuid('Invalid booking ID')
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json();

    // Validate input
    const validationResult = FinalizeSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.flatten() }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    // Look up the booking
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, service_id, client_first_name, client_last_name, client_email, client_phone, start_time, contact_id, status, payment_status')
      .eq('id', data.booking_id)
      .single();

    if (bookingError || !booking) {
      requestLogger.warn({ bookingId: data.booking_id }, 'Booking not found');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // Verify subdomain matches booking owner (if provided)
    if (data.subdomain) {
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('user_id')
        .eq('subdomain', data.subdomain)
        .single();

      if (pageError || !websitePage || websitePage.user_id !== booking.user_id) {
        requestLogger.warn({ subdomain: data.subdomain, bookingUserId: booking.user_id }, 'Subdomain mismatch');
        return NextResponse.json(
          { success: false, error: 'Booking not found' },
          { status: 404 }
        );
      }
    }

    const ownerId = booking.user_id;

    // Get user's pipeline stages to find the "active client" stage for paid bookings
    // Look for stages with keys like 'active_client', 'active', 'client' (in order of preference)
    const { data: pipelineStages } = await supabaseServer
      .from('crm_pipeline_stages')
      .select('stage_key, position')
      .eq('user_id', ownerId)
      .order('position', { ascending: true });

    // Find the best "active client" stage for a paid customer
    // Priority: 'active_client' > 'active' > 'client' > highest position stage
    let activeClientStage = 'client'; // fallback default
    if (pipelineStages && pipelineStages.length > 0) {
      const stageKeys = pipelineStages.map(s => s.stage_key);
      if (stageKeys.includes('active_client')) {
        activeClientStage = 'active_client';
      } else if (stageKeys.includes('active')) {
        activeClientStage = 'active';
      } else if (stageKeys.includes('client')) {
        activeClientStage = 'client';
      } else {
        // Use the stage with highest position (most progressed in pipeline)
        // but not 'completed', 'inactive', or 'past_client'
        const validStages = pipelineStages.filter(
          s => !['completed', 'inactive', 'past_client'].includes(s.stage_key)
        );
        if (validStages.length > 0) {
          activeClientStage = validStages[validStages.length - 1].stage_key;
        }
      }
    }

    requestLogger.debug({ activeClientStage, pipelineStages }, 'Determined active client stage for paid booking');

    // Create/update CRM contact if not already linked
    let contactId = booking.contact_id;

    if (!contactId) {
      // Check if contact already exists by email
      const { data: existingContact } = await supabaseServer
        .from('crm_contacts')
        .select('id, first_name, last_name, phone')
        .eq('user_id', ownerId)
        .eq('email', booking.client_email)
        .single();

      if (existingContact) {
        contactId = existingContact.id;
        // Update contact with new data and upgrade to active client stage (they paid)
        const updates: Record<string, string | null> = {
          stage: activeClientStage // Upgrade to active client since they completed payment
        };
        if (!existingContact.first_name && booking.client_first_name) {
          updates.first_name = booking.client_first_name;
        }
        if (!existingContact.last_name && booking.client_last_name) {
          updates.last_name = booking.client_last_name;
        }
        if (!existingContact.phone && booking.client_phone) {
          updates.phone = booking.client_phone;
        }
        await supabaseServer
          .from('crm_contacts')
          .update(updates)
          .eq('id', contactId);
        requestLogger.debug({ contactId, stage: activeClientStage }, 'Updated existing contact - upgraded to active client');
      } else {
        // Create new contact as active client (they paid)
        const { data: newContact, error: contactError } = await supabaseServer
          .from('crm_contacts')
          .insert({
            user_id: ownerId,
            first_name: booking.client_first_name,
            last_name: booking.client_last_name,
            email: booking.client_email,
            phone: booking.client_phone || null,
            source: 'website_booking',
            stage: activeClientStage // Direct to active client since they completed payment
          })
          .select('id')
          .single();

        if (contactError) {
          requestLogger.warn({ err: contactError }, 'Failed to create contact');
        } else if (newContact) {
          contactId = newContact.id;
          requestLogger.info({ contactId, stage: activeClientStage }, 'Created new active client contact from paid booking');
        }
      }
    }

    // Get service name for activity logging
    const { data: service } = await supabaseServer
      .from('scheduling_services')
      .select('service_name')
      .eq('id', booking.service_id)
      .single();

    // Update booking with contact_id and confirmed status
    const { error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update({
        contact_id: contactId,
        status: 'confirmed',
        payment_status: 'paid'
      })
      .eq('id', data.booking_id);

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, error: 'Failed to finalize booking' },
        { status: 500 }
      );
    }

    // Create CRM activity (non-blocking)
    if (contactId) {
      const startTime = new Date(booking.start_time);
      supabaseServer
        .from('crm_activities')
        .insert({
          user_id: ownerId,
          contact_id: contactId,
          activity_type: 'booking',
          title: `Booking: ${service?.service_name || 'Service'}`,
          description: `Booked via website for ${startTime.toLocaleString()} (paid)`,
          activity_date: startTime.toISOString(),
          auto_logged: true,
          source_capability: 'scheduling',
          source_entity_id: booking.id
        })
        .then(({ error }) => {
          if (error) {
            requestLogger.warn({ err: error }, 'Failed to create activity (non-blocking)');
          }
        });
    }

    requestLogger.info(
      { bookingId: booking.id, contactId },
      'Booking finalized successfully'
    );

    return NextResponse.json({
      success: true,
      message: 'Booking confirmed!',
      booking: {
        id: booking.id,
        status: 'confirmed',
        payment_status: 'paid',
        contact_id: contactId
      }
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Booking finalization failed');
    return NextResponse.json(
      { success: false, error: 'Failed to finalize booking' },
      { status: 500 }
    );
  }
}
