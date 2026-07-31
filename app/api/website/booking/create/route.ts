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
import { z } from 'zod';

const logger = createLogger({ module: 'WebsiteBookingCreateAPI' });

// Subdomain is optional - if not provided, authenticated user is used (preview mode)
const BookingSchema = z.object({
  subdomain: z.string().optional(),
  service_id: z.string().uuid('Invalid service ID'),
  start_time: z.string().min(1, 'Start time is required'),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  notes: z.string().max(2000).optional(),
  timezone: z.string().optional().default('UTC'),
  // Skip contact creation for paid services - contact will be created after payment
  skip_contact: z.boolean().optional().default(false)
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

    let ownerId: string;

    // Track hidden service names for validation (only used for public access)
    let hiddenServiceNames: Set<string> = new Set();

    // If subdomain is provided, look up website owner (public access)
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

    // Calculate end time
    const startTime = new Date(data.start_time);
    const endTime = new Date(startTime.getTime() + service.duration_minutes * 60 * 1000);

    // Check for conflicts
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

    // Determine if payment is required
    const requiresPayment = service.price !== null && service.price > 0;

    requestLogger.info(
      { skip_contact: data.skip_contact, price: service.price, requiresPayment },
      'Contact creation decision'
    );

    // Create contact only if not skipped (for paid services, contact is created after payment)
    let contactId: string | null = null;

    if (!data.skip_contact) {
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
            stage: 'lead'
          })
          .select('id')
          .single();

        if (contactError) {
          requestLogger.warn({ err: contactError }, 'Failed to create contact (proceeding without)');
        } else if (newContact) {
          contactId = newContact.id;
        }
      }
    } else {
      requestLogger.debug({ email: data.email }, 'Skipping contact creation (paid service - will create after payment)');
    }

    // Create the booking
    // Note: scheduling_bookings uses client_first_name/client_last_name (not client_name), booking_source (not source)
    // For paid services: status is 'pending' until payment is confirmed
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

    // Create activity (non-blocking) for all bookings with a contact
    if (contactId) {
      supabaseServer
        .from('crm_activities')
        .insert({
          user_id: ownerId,
          contact_id: contactId,
          activity_type: 'booking',
          title: `Booking: ${service.service_name}`,
          description: `Booked via website for ${startTime.toLocaleString()}`,
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
      { bookingId: booking.id, subdomain: data.subdomain, serviceId: data.service_id, requiresPayment },
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
        status: requiresPayment ? 'pending' : 'confirmed'
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
