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
    const endTime = new Date(startTime.getTime() + service.duration_minutes * 60 * 1000);

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

    // Create/update CRM contact
    let contactId: string | null = null;

    // Check if contact already exists by email
    const { data: existingContact } = await supabaseServer
      .from('crm_contacts')
      .select('id, first_name, last_name, phone')
      .eq('user_id', ownerId)
      .eq('email', data.email)
      .single();

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
          stage: 'client' // Mark as client since they paid
        })
        .select('id')
        .single();

      if (contactError) {
        requestLogger.warn({ err: contactError }, 'Failed to create contact (proceeding without)');
      } else if (newContact) {
        contactId = newContact.id;
      }
    }

    // Create the booking - already confirmed since payment succeeded
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .insert({
        user_id: ownerId,
        service_id: data.service_id,
        contact_id: contactId,
        client_first_name: clientFirstName,
        client_last_name: clientLastName,
        client_email: data.email,
        client_phone: data.phone || null,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        status: 'confirmed',
        payment_status: service.price && service.price > 0 ? 'paid' : 'paid',
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

    // Send payment receipt if service has a price (non-blocking)
    if (service.price && service.price > 0) {
      BookingEmailService.sendPaymentReceipt(ownerId, {
        customerEmail: data.email,
        customerName: data.name,
        amount: service.price,
        currency: service.currency,
        bookingId: booking.id,
        paymentMethod: data.payment_intent_id ? 'Card' : undefined
      }).catch(err => requestLogger.warn({ err, bookingId: booking.id }, 'Payment receipt email failed'));
    }

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
