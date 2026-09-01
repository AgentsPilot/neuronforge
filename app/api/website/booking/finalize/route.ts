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
import Stripe from 'stripe';
import {
  locatePaymentIntentAccount,
  resolveUserConnectAccounts,
  type ChargeAccountColumns,
} from '@/lib/payments/stripeAccountContext';
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

    // Look up the booking with contact data via JOIN
    // Note: client_* fields removed from scheduling_bookings - now JOINed from crm_contacts
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .select(`
        id,
        user_id,
        service_id,
        start_time,
        contact_id,
        status,
        payment_status,
        contact:crm_contacts(
          id,
          first_name,
          last_name,
          email,
          phone
        )
      `)
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

    // Get contact data from the JOIN
    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;

    // Contact should already exist from /create endpoint (contact_id is NOT NULL)
    // Just upgrade the stage to 'active_client' since payment succeeded
    const contactId = booking.contact_id;

    if (!contactId) {
      // This should not happen since contact_id is now NOT NULL in the database
      requestLogger.error({ bookingId: booking.id }, 'Contact missing - contact_id is required');
      return NextResponse.json(
        { success: false, error: 'Booking is missing contact information' },
        { status: 500 }
      );
    }

    // Upgrade contact stage from 'lead' to 'active_client' since payment succeeded
    await supabaseServer
      .from('crm_contacts')
      .update({ stage: activeClientStage })
      .eq('id', contactId);
    requestLogger.info({ contactId, stage: activeClientStage }, 'Upgraded contact to active client after payment');

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
      // Which Stripe account this charge lives on — asked of Stripe, not taken
      // from the browser.
      //
      // This route finalises from the client, so nothing it sends is evidence.
      // The account still has to be recorded here or the payment is
      // unrefundable: these are direct charges, and a refund issued against the
      // wrong account either errors or returns money from the wrong balance.
      //
      // A failure to resolve is not fatal. The payment is real and must be
      // recorded either way; it is simply marked unresolved, which makes the
      // refund path refuse rather than guess, and puts the row in the
      // reconciler's queue.
      let accountContext: ChargeAccountColumns = {
        stripe_connect_account_id: null,
        charge_account_kind: 'platform',
        account_resolution: 'unknown',
      };

      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        const candidates = await resolveUserConnectAccounts(supabaseServer, ownerId);
        accountContext = await locatePaymentIntentAccount(
          stripe,
          data.payment_intent_id,
          candidates
        );
      } catch (accountError) {
        requestLogger.warn(
          { err: accountError, paymentIntentId: data.payment_intent_id },
          'Could not resolve the Stripe account for this payment; recording it as unresolved'
        );
      }

      const { data: paymentTransaction, error: paymentError } = await supabaseServer
        .from('payment_transactions')
        .insert({
          ...accountContext,
          user_id: ownerId,
          contact_id: contactId,
          service_id: booking.service_id, // Proper column for revenue tracking (added in migration 20260809)
          // Note: booking_id will be added as proper column in future migration
          // For now, keep in metadata for backward compatibility
          stripe_payment_intent_id: data.payment_intent_id,
          amount: serviceDetails.price,  // SINGLE source of truth for payment amount
          currency: serviceDetails.currency || 'USD',
          status: data.payment_status === 'paid' ? 'succeeded' : 'pending',
          payment_method: 'card',
          processor_type: 'stripe', // Required for refunds to work correctly
          description: `Booking: ${service?.service_name || 'Service'}`,
          metadata: {
            booking_id: booking.id,  // Will be moved to proper column in future migration
            // Removed service_id from metadata - it's now in proper column above
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

    // Update booking with confirmed status and payment transaction reference
    // Note: contact_id should already be set from /create, but update it to be safe
    const updateData: Record<string, string | number | null> = {
      contact_id: contactId,
      status: 'confirmed',
      payment_status: data.payment_status || 'paid'
      // Removed total_amount - payment amount should only exist in payment_transactions
      // This prevents double-counting in revenue calculations
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

    // Note: Activity is auto-created by log_booking_activity_trigger (scheduling_bookings table trigger)

    // Send booking confirmation email (non-blocking)
    // skipInvoice=true since payment is already completed
    BookingEmailService.sendBookingConfirmation(booking.id, ownerId, { skipInvoice: true })
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Booking confirmation email failed'));

    // Send intake form request email (non-blocking)
    // This helps clients prepare for their appointment
    BookingEmailService.sendIntakeFormRequest(booking.id, ownerId)
      .catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Intake form request email failed'));

    // Send payment receipt (non-blocking) - reuse serviceDetails from earlier
    if (serviceDetails?.price && serviceDetails.price > 0 && contact?.email) {
      const clientName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
      BookingEmailService.sendPaymentReceipt(ownerId, {
        customerEmail: contact.email,
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
