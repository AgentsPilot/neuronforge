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
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { paymentInvoiceRepository, stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { emitPaymentEvent } from '@/lib/services/PaymentEventService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingsAPI' });
const auditTrail = AuditTrailService.getInstance();

/**
 * Helper function to create an invoice for a booking
 * If user has Stripe Connect, creates and sends invoice via Stripe for online payment
 */
async function createBookingInvoice(
  userId: string,
  bookingId: string,
  service: SchedulingService,
  bookingData: {
    contact_id: string;
    contact_name: string;
    contact_email: string | null;
    start_time: string;
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

  // Create local invoice record
  const invoiceResult = await paymentInvoiceRepository.create({
    user_id: userId,
    contact_id: bookingData.contact_id,
    booking_id: bookingId, // Link invoice to booking for payment status sync
    invoice_number: invoiceNumberResult.data!,
    amount: service.price!,
    currency: service.currency,
    status: 'sent',
    // Client info for display on invoice
    client_name: bookingData.contact_name || null,
    client_email: bookingData.contact_email || null,
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
    notes: `Booking for ${bookingData.contact_name}`,
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

  let invoice = invoiceResult.data!;

  // Check if user has Stripe Connect account with charges enabled
  const stripeAccountResult = await stripeConnectRepository.findByUserId(userId);
  const stripeAccount = stripeAccountResult.data;

  if (stripeAccount?.stripe_account_id && stripeAccount.charges_enabled && bookingData.contact_email) {
    try {
      requestLogger.info({
        invoiceId: invoice.id,
        stripeAccountId: stripeAccount.stripe_account_id
      }, 'Creating Stripe invoice for booking');

      const stripeInvoiceService = getStripeInvoiceService();

      // Create invoice in Stripe
      const stripeInvoice = await stripeInvoiceService.createInvoice({
        connectAccountId: stripeAccount.stripe_account_id,
        customerEmail: bookingData.contact_email,
        customerName: bookingData.contact_name || 'Client',
        lineItems: [
          {
            description: service.service_name,
            quantity: 1,
            unit_price: Math.round(service.price! * 100), // Convert to cents
            total: Math.round(service.price! * 100)
          }
        ],
        dueDate: new Date(bookingData.start_time),
        currency: service.currency.toLowerCase(),
        description: `Invoice for ${service.service_name}`,
        metadata: {
          neuronforge_invoice_id: invoice.id,
          booking_id: bookingId,
          invoice_number: invoice.invoice_number
        }
      });

      // Send the invoice via Stripe (finalizes and emails)
      const sentStripeInvoice = await stripeInvoiceService.sendInvoice(
        stripeInvoice.invoiceId,
        stripeAccount.stripe_account_id
      );

      // Update local invoice with Stripe data
      const updateResult = await paymentInvoiceRepository.updateStripeFields(
        invoice.id,
        userId,
        {
          stripe_invoice_id: sentStripeInvoice.invoiceId,
          stripe_hosted_invoice_url: sentStripeInvoice.hostedInvoiceUrl || undefined,
          stripe_invoice_pdf: sentStripeInvoice.invoicePdf || undefined
        }
      );

      if (updateResult.data) {
        invoice = updateResult.data;
      }

      requestLogger.info({
        invoiceId: invoice.id,
        stripeInvoiceId: sentStripeInvoice.invoiceId,
        hostedUrl: sentStripeInvoice.hostedInvoiceUrl
      }, 'Stripe invoice created and sent for booking');

    } catch (stripeError) {
      // Log error but don't fail - local invoice is still valid
      requestLogger.error({
        err: stripeError,
        invoiceId: invoice.id
      }, 'Failed to create Stripe invoice, falling back to local invoice');
    }
  } else {
    requestLogger.debug({
      invoiceId: invoice.id,
      hasStripeAccount: !!stripeAccount?.stripe_account_id,
      chargesEnabled: stripeAccount?.charges_enabled,
      hasEmail: !!bookingData.contact_email
    }, 'Skipping Stripe invoice (not configured or missing email)');
  }

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
      dueDate,
      stripeInvoiceId: invoice.stripe_invoice_id || undefined
    }
  });

  // Schedule payment reminders for the invoice (non-blocking)
  paymentReminderService.scheduleInvoiceReminders(
    userId,
    invoice.id,
    bookingData.contact_id,
    dueDate
  ).catch(err => requestLogger.warn({ err, invoiceId: invoice.id }, 'Failed to schedule invoice reminders'));

  return invoice;
}

// Validation schemas
// Contact can be provided directly OR created from client_* fields
const createBookingSchema = z.object({
  service_id: z.string().uuid(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  timezone: z.string().optional(),
  notes: z.string().optional(),
  booking_source: z.string().optional(),
  // Contact - either provide contact_id OR client_* fields to create/find contact
  contact_id: z.string().uuid().optional(),
  // Client fields for creating/finding contact (used if contact_id not provided)
  client_first_name: z.string().optional(),
  client_last_name: z.string().optional(),
  client_email: z.string().email().optional(),
  client_phone: z.string().optional(),
  // Payment options
  create_invoice: z.boolean().optional().default(true),
  payment_plan_id: z.string().uuid().optional(),
  // Intake form option
  send_intake_form: z.boolean().optional().default(false)
}).refine(
  data => data.contact_id || (data.client_first_name && data.client_email),
  { message: 'Either contact_id or (client_first_name + client_email) is required' }
);

const listBookingsSchema = z.object({
  service_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
  // Use .refine for date validation to accept ISO strings with any valid format
  start_date: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
  end_date: z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
  limit: z.number().min(1).max(500).optional(), // Increased max to 500 for calendar views
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
      { userId: user.id, serviceId: validated.service_id, contactId: validated.contact_id, clientEmail: validated.client_email },
      'Creating booking'
    );

    // 3. Resolve contact_id - create or find contact if not provided
    let contactId = validated.contact_id;
    let contactName = '';
    let contactEmail: string | null = null;

    if (!contactId && validated.client_email) {
      // Try to find existing contact by email
      const existingContactResult = await crmContactRepository.findByEmail(
        validated.client_email,
        user.id
      );

      if (existingContactResult.data) {
        contactId = existingContactResult.data.id;
        contactName = `${existingContactResult.data.first_name || ''} ${existingContactResult.data.last_name || ''}`.trim();
        contactEmail = existingContactResult.data.email || null;
        requestLogger.debug({ contactId, email: validated.client_email }, 'Found existing contact');
      } else {
        // Create new contact - get user's first pipeline stage
        const stagesResult = await pipelineStagesRepo.findByUser(user.id);
        const firstStage = stagesResult.data?.[0]?.stage_key || 'lead';

        const newContactResult = await crmContactRepository.create({
          user_id: user.id,
          first_name: validated.client_first_name || '',
          last_name: validated.client_last_name || null,
          email: validated.client_email,
          phone: validated.client_phone || null,
          stage: firstStage,
          tags: [],
          source: 'booking'
        });

        if (newContactResult.error) {
          requestLogger.error({ err: newContactResult.error }, 'Failed to create contact for booking');
          return NextResponse.json(
            { success: false, error: 'Failed to create contact' },
            { status: 500 }
          );
        }

        contactId = newContactResult.data!.id;
        contactName = `${validated.client_first_name || ''} ${validated.client_last_name || ''}`.trim();
        contactEmail = validated.client_email;
        requestLogger.info({ contactId, email: validated.client_email, stage: firstStage }, 'Created new contact for booking');
      }
    } else if (contactId) {
      // Fetch contact name and email for logging/invoicing
      const contactResult = await crmContactRepository.findById(contactId, user.id);
      if (contactResult.data) {
        contactName = `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim();
        // Use client_email from request if provided, otherwise fall back to database email
        contactEmail = validated.client_email || contactResult.data.email || null;
      }
    }

    if (!contactId) {
      return NextResponse.json(
        { success: false, error: 'Contact is required for booking' },
        { status: 400 }
      );
    }

    // 4. Check for double booking (existing bookings)
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
          message: `This time slot overlaps with an existing booking at ${new Date(conflictingBooking.start_time).toLocaleTimeString()}`,
          conflicting_booking: {
            id: conflictingBooking.id,
            start_time: conflictingBooking.start_time,
            end_time: conflictingBooking.end_time,
            status: conflictingBooking.status
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

    // 5. Create booking
    const result = await schedulingBookingRepository.create({
      user_id: user.id,
      service_id: validated.service_id,
      contact_id: contactId,
      start_time: validated.start_time,
      end_time: validated.end_time,
      timezone: validated.timezone,
      notes: validated.notes,
      booking_source: validated.booking_source
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create booking');
      return NextResponse.json(
        { success: false, error: 'Failed to create booking' },
        { status: 500 }
      );
    }

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_CREATED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: result.data!.id,
        resourceName: `Booking for ${contactName || 'Client'}`,
        metadata: {
          service_id: validated.service_id,
          contact_id: contactId,
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

    // 7b. Create invoice if service has a price and invoice creation is requested
    const { create_invoice } = validated;
    requestLogger.info({
      serviceExists: !!service,
      servicePrice: service?.price,
      createInvoice: create_invoice,
      contactEmail: contactEmail,
      contactId: contactId,
      bookingId: result.data!.id
    }, 'Checking invoice creation conditions');

    if (service && service.price && service.price > 0 && create_invoice !== false) {
      try {
        const invoiceResult = await createBookingInvoice(
          user.id,
          result.data!.id,
          service,
          {
            contact_id: contactId,
            contact_name: contactName || 'Client',
            contact_email: contactEmail,
            start_time: validated.start_time
          },
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
    } else {
      requestLogger.info({
        bookingId: result.data!.id,
        reason: !service ? 'service not found' :
                !service.price ? 'no price set' :
                service.price <= 0 ? 'price is zero or negative' :
                create_invoice === false ? 'invoice creation disabled' : 'unknown'
      }, 'Invoice creation skipped');
    }

    // 7a. Move contact to "active client" stage if this is a paid booking (non-blocking)
    if (service && service.price && service.price > 0 && contactId) {
      crmPipelineStagesRepository.findActiveClientStage(user.id)
        .then(async (stageResult) => {
          if (stageResult.data) {
            const activeStage = stageResult.data;
            await crmContactRepository.updateStage(contactId, user.id, activeStage.stage_key);
            requestLogger.info({
              contactId,
              newStage: activeStage.stage_key,
              stageLabel: activeStage.stage_label
            }, 'Contact moved to active client stage for paid booking');
          }
        })
        .catch(err => requestLogger.warn({ err, contactId }, 'Failed to update contact stage for paid booking'));
    }

    // 7b. Send booking confirmation email (non-blocking)
    // Skip invoice email since we've already created the invoice above
    // Pass invoice ID and Stripe hosted URL so email can include payment link
    requestLogger.info({
      bookingId: result.data!.id,
      invoiceId: invoiceData?.id,
      stripeHostedUrl: invoiceData?.stripe_hosted_invoice_url,
      hasInvoice: !!invoiceData
    }, 'Sending booking confirmation email with invoice data');

    BookingEmailService.sendBookingConfirmation(result.data!.id, user.id, {
      skipInvoice: true,
      invoiceId: invoiceData?.id,
      stripeHostedInvoiceUrl: invoiceData?.stripe_hosted_invoice_url || undefined
    }).catch(err => requestLogger.warn({ err, bookingId: result.data!.id }, 'Booking confirmation email failed'));

    // 8. Send intake form request if requested (non-blocking)
    if (validated.send_intake_form) {
      // Mark the booking as having intake requested by setting empty intake_responses
      // This allows the journey timeline to show "intake pending" status
      await schedulingBookingRepository.update(result.data!.id, user.id, {
        intake_responses: {
          template_id: '',
          template_key: 'pending',
          responses: {}
        }
      });

      BookingEmailService.sendIntakeFormRequest(result.data!.id, user.id)
        .catch(err => requestLogger.warn({ err, bookingId: result.data!.id }, 'Intake form request email failed'));
    }

    // 9. Return success
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
    requestLogger.info({
      userId: user.id,
      bookingsCount: result.data?.length || 0,
      bookings: result.data?.map(b => ({
        id: b.id.substring(0, 8),
        start: b.start_time,
        status: b.status,
        contact_id: b.contact_id
      }))
    }, 'Returning bookings');

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
