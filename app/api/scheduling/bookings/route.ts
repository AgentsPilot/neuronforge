/**
 * POST /api/scheduling/bookings
 * GET /api/scheduling/bookings
 * Scheduling bookings endpoints - create and list bookings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository, schedulingServiceRepository, SchedulingService } from '@/lib/repositories/SchedulingRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { emitPaymentEvent } from '@/lib/services/PaymentEventService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingsAPI' });
const auditTrail = AuditTrailService.getInstance();

/**
 * Helper function to create an invoice for a booking
 */
async function createBookingInvoice(
  userId: string,
  bookingId: string,
  service: SchedulingService,
  bookingData: {
    client_first_name: string;
    client_last_name?: string;
    client_email: string;
    start_time: string;
    contact_id?: string;
  },
  requestLogger: ReturnType<typeof logger.child>
) {
  // Generate invoice number
  const invoiceNumberResult = await paymentInvoiceRepository.getNextInvoiceNumber(userId);
  if (invoiceNumberResult.error) {
    throw invoiceNumberResult.error;
  }

  // Calculate due date (service start time)
  const dueDate = new Date(bookingData.start_time).toISOString().split('T')[0];

  // Create invoice
  const invoiceResult = await paymentInvoiceRepository.create({
    user_id: userId,
    contact_id: bookingData.contact_id || null,
    invoice_number: invoiceNumberResult.data!,
    amount: service.price!,
    currency: service.currency,
    status: 'sent',
    line_items: [
      {
        description: service.service_name,
        quantity: 1,
        unit_price: service.price!,
        total: service.price!
      }
    ],
    due_date: dueDate,
    payment_terms: 'Due on service date',
    notes: `Booking for ${bookingData.client_first_name} ${bookingData.client_last_name || ''}`.trim(),
    internal_notes: `Auto-generated for booking ${bookingId}`,
    sent_at: new Date().toISOString(),
    paid_at: null,
    // Payment fields
    payment_method: null,
    payment_received_at: null,
    payment_notes: null,
    processor_type: null,
    processor_checkout_id: null,
    processor_payment_id: null,
    processor_customer_id: null,
    processor_payment_method_id: null,
    retry_count: 0,
    last_retry_at: null,
    next_retry_at: null
  });

  if (invoiceResult.error) {
    throw invoiceResult.error;
  }

  const invoice = invoiceResult.data!;

  // Emit invoice created event
  await emitPaymentEvent(userId, {
    eventType: 'invoice.created',
    entityType: 'invoice',
    entityId: invoice.id,
    contactId: bookingData.contact_id,
    metadata: {
      bookingId,
      serviceName: service.service_name,
      amount: service.price,
      currency: service.currency,
      dueDate
    }
  });

  // Schedule payment reminders for the invoice (non-blocking)
  if (bookingData.contact_id) {
    paymentReminderService.scheduleInvoiceReminders(
      userId,
      invoice.id,
      bookingData.contact_id,
      dueDate
    ).catch(err => requestLogger.warn({ err, invoiceId: invoice.id }, 'Failed to schedule invoice reminders'));
  }

  return invoice;
}

// Validation schemas
const createBookingSchema = z.object({
  service_id: z.string().uuid(),
  client_first_name: z.string().min(1),
  client_last_name: z.string().optional(),
  client_email: z.string().email(),
  client_phone: z.string().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  timezone: z.string().optional(),
  notes: z.string().optional(),
  booking_source: z.string().optional(),
  // Payment options
  contact_id: z.string().uuid().optional(),
  create_invoice: z.boolean().optional().default(true),
  payment_plan_id: z.string().uuid().optional()
});

const listBookingsSchema = z.object({
  service_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional()
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = createBookingSchema.parse(body);

    requestLogger.info(
      { userId: user.id, serviceId: validated.service_id, clientEmail: validated.client_email },
      'Creating booking'
    );

    // 3. Check for double booking (existing bookings)
    const overlapCheck = await schedulingBookingRepository.checkOverlap(
      user.id,
      validated.start_time,
      validated.end_time
    );

    if (overlapCheck.error) {
      requestLogger.error({ err: overlapCheck.error, userId: user.id }, 'Failed to check booking overlap');
      return NextResponse.json(
        { success: false, error: 'Failed to validate booking time' },
        { status: 500 }
      );
    }

    if (overlapCheck.data && overlapCheck.data.length > 0) {
      const conflictingBooking = overlapCheck.data[0];
      requestLogger.warn(
        { userId: user.id, conflictingBookingId: conflictingBooking.id, startTime: validated.start_time },
        'Double booking attempt detected'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Time slot conflict',
          message: 'This time slot overlaps with an existing booking',
          conflicting_booking: {
            id: conflictingBooking.id,
            client_name: `${conflictingBooking.client_first_name} ${conflictingBooking.client_last_name || ''}`.trim(),
            start_time: conflictingBooking.start_time,
            end_time: conflictingBooking.end_time
          }
        },
        { status: 409 }
      );
    }

    // 3b. Check for external calendar event blocking
    const isBlockedByExternal = await CalendarSyncService.isSlotBlockedByExternalEvent(
      user.id,
      validated.start_time,
      validated.end_time
    );

    if (isBlockedByExternal) {
      requestLogger.warn(
        { userId: user.id, startTime: validated.start_time },
        'Booking blocked by external calendar event'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Time slot blocked',
          message: 'This time slot is blocked by an event in your external calendar'
        },
        { status: 409 }
      );
    }

    // 4. Create booking
    // Destructure to exclude fields that don't exist in database
    const { create_invoice, payment_plan_id, ...bookingData } = validated;
    const result = await schedulingBookingRepository.create({
      user_id: user.id,
      ...bookingData
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create booking');
      return NextResponse.json(
        { success: false, error: 'Failed to create booking' },
        { status: 500 }
      );
    }

    // 5. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_CREATED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: result.data!.id,
        resourceName: `Booking for ${validated.client_first_name} ${validated.client_last_name || ''}`.trim(),
        metadata: {
          service_id: validated.service_id,
          start_time: validated.start_time
        },
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 6. Sync to calendar and handle payments (non-blocking but awaited for response)
    // Get the service for calendar event details and pricing
    const serviceResult = await schedulingServiceRepository.findById(validated.service_id, user.id);
    const service = serviceResult.data;
    let invoiceData = null;

    // 6a. Calendar sync (non-blocking)
    if (service && result.data) {
      CalendarSyncService.syncBookingToCalendar(result.data, service, user.id)
        .catch(err => requestLogger.warn({ err, bookingId: result.data!.id }, 'Calendar sync failed'));
    }

    // 6b. Create invoice if service has a price and invoice creation is requested
    if (service && service.price && service.price > 0 && create_invoice !== false) {
      try {
        const invoiceResult = await createBookingInvoice(
          user.id,
          result.data!.id,
          service,
          validated,
          requestLogger
        );

        if (invoiceResult) {
          invoiceData = invoiceResult;
          requestLogger.info({
            bookingId: result.data!.id,
            invoiceId: invoiceResult.id
          }, 'Invoice created for booking');
        }
      } catch (invoiceError) {
        requestLogger.warn({ err: invoiceError, bookingId: result.data!.id }, 'Failed to create invoice for booking');
        // Don't fail the booking if invoice creation fails
      }
    }

    // 7. Send booking confirmation email (non-blocking)
    // Skip invoice email since we've already created the invoice above
    BookingEmailService.sendBookingConfirmation(result.data!.id, user.id, { skipInvoice: true })
      .catch(err => requestLogger.warn({ err, bookingId: result.data!.id }, 'Booking confirmation email failed'));

    // 8. Return success
    requestLogger.info({ bookingId: result.data!.id, userId: user.id }, 'Booking created successfully');
    return NextResponse.json({
      success: true,
      booking: result.data,
      invoice: invoiceData
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = {
      service_id: searchParams.get('service_id') || undefined,
      contact_id: searchParams.get('contact_id') || undefined,
      status: (searchParams.get('status') || undefined) as 'confirmed' | 'cancelled' | 'completed' | 'no_show' | undefined,
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined
    };

    // Validate
    const validated = listBookingsSchema.parse(queryParams);

    requestLogger.info({ userId: user.id, params: validated }, 'Listing bookings');

    // 3. Get bookings
    const result = await schedulingBookingRepository.list(user.id, {
      serviceId: validated.service_id,
      contactId: validated.contact_id,
      status: validated.status,
      startDate: validated.start_date,
      endDate: validated.end_date,
      limit: validated.limit,
      offset: validated.offset
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list bookings');
      return NextResponse.json(
        { success: false, error: 'Failed to list bookings' },
        { status: 500 }
      );
    }

    // 4. Return success
    return NextResponse.json({
      success: true,
      bookings: result.data,
      limit: validated.limit || 50,
      offset: validated.offset || 0
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
