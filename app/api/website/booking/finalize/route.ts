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
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBookingFinalizeAPI' });

const FinalizeSchema = z.object({
  subdomain: z.string().optional(),
  booking_id: z.string().uuid('Invalid booking ID'),
  payment_intent_id: z.string().optional(),
  payment_status: z.enum(['pending', 'paid', 'failed']).optional()
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

    // Get service details for payment transaction record
    const { data: serviceDetails } = await supabaseServer
      .from('scheduling_services')
      .select('price, currency')
      .eq('id', booking.service_id)
      .single();

    // Create payment transaction record if we have a payment_intent_id
    let paymentTransactionId: string | null = null;
    if (data.payment_intent_id && serviceDetails?.price) {
      const { data: paymentTransaction, error: paymentError } = await supabaseServer
        .from('payment_transactions')
        .insert({
          user_id: ownerId,
          contact_id: contactId,
          stripe_payment_intent_id: data.payment_intent_id,
          amount: serviceDetails.price,
          currency: serviceDetails.currency || 'USD',
          status: data.payment_status === 'paid' ? 'succeeded' : 'pending',
          payment_method: 'card',
          description: `Booking: ${service?.service_name || 'Service'}`,
          metadata: {
            booking_id: booking.id,
            service_id: booking.service_id,
            source: 'website_booking'
          },
          paid_at: data.payment_status === 'paid' ? new Date().toISOString() : null
        })
        .select('id')
        .single();

      if (paymentError) {
        requestLogger.warn({ err: paymentError }, 'Failed to create payment transaction (non-blocking)');
      } else {
        paymentTransactionId = paymentTransaction?.id || null;
        requestLogger.info({ paymentTransactionId, paymentIntentId: data.payment_intent_id }, 'Payment transaction created');
      }
    }

    // Update booking with contact_id, confirmed status, and payment transaction reference
    const updateData: Record<string, string | null> = {
      contact_id: contactId,
      status: 'confirmed',
      payment_status: data.payment_status || 'paid'
    };

    // Store payment transaction ID reference (UUID) instead of Stripe intent ID
    if (paymentTransactionId) {
      updateData.payment_id = paymentTransactionId;
    }

    const { error: updateError } = await supabaseServer
      .from('scheduling_bookings')
      .update(updateData)
      .eq('id', data.booking_id);

    if (updateError) {
      requestLogger.error({ err: updateError }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, error: 'Failed to finalize booking' },
        { status: 500 }
      );
    }

    // Create CRM activity (non-blocking)
    // NOTE: the booking `crm_activities` row is logged automatically by Postgres trigger T2 on
    // the booking UPDATE-to-confirmed (contact_id set) — not inserted here (was double-logging).
    // (Scheduling plugin workplan §2 0.2.)

    // Send booking confirmation email (non-blocking)
    // skipInvoice=true since payment is already completed
    BookingEmailService.sendBookingConfirmation(booking.id, ownerId, { skipInvoice: true })
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Booking confirmation email failed'));

    // Send intake form request email (non-blocking)
    // This helps clients prepare for their appointment
    BookingEmailService.sendIntakeFormRequest(booking.id, ownerId)
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Intake form request email failed'));

    // Send payment receipt (non-blocking) - reuse serviceDetails from earlier
    if (serviceDetails?.price && serviceDetails.price > 0) {
      const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');
      BookingEmailService.sendPaymentReceipt(ownerId, {
        customerEmail: booking.client_email,
        customerName: clientName,
        amount: serviceDetails.price,
        currency: serviceDetails.currency,
        bookingId: booking.id
      }).catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Payment receipt email failed'));
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
