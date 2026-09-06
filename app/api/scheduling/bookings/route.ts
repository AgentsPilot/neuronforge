/**
 * POST /api/scheduling/bookings
 * GET /api/scheduling/bookings
 * Scheduling bookings endpoints - create and list bookings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import {
  createBooking,
  BookingSlotUnavailableError
} from '@/lib/services/BookingLifecycleService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingsAPI' });

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
        // `list` returns them ordered by position, so [0] is the entry stage.
        const stagesResult = await crmPipelineStagesRepository.list(user.id);
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

    // 4. Create the booking — conflict checks, calendar, invoice, confirmation.
    //
    // The whole sequence lives in BookingLifecycleService so the chat creates a
    // booking the same way this route does. Doing it here meant an appointment
    // booked any other way skipped the overlap check, the calendar and the
    // client's confirmation.
    const result = await createBooking({
      userId: user.id,
      serviceId: validated.service_id,
      contactId,
      startTime: validated.start_time,
      endTime: validated.end_time,
      timezone: validated.timezone,
      notes: validated.notes,
      bookingSource: validated.booking_source,
      createInvoice: validated.create_invoice,
      sendIntakeForm: validated.send_intake_form,
      contactName,
      contactEmail,
      request,
      logger: requestLogger
    });

    if (result.error) {
      // A taken slot is not a failure of the system — it is an answer, and the
      // client needs the conflicting booking to choose another time.
      if (result.error instanceof BookingSlotUnavailableError) {
        return NextResponse.json(
          {
            success: false,
            error: result.error.reason === 'overlap' ? 'Time slot conflict' : 'Time slot blocked',
            message: result.error.message,
            conflicting_booking: result.error.conflictingBooking
          },
          { status: 409 }
        );
      }

      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create booking');
      return NextResponse.json(
        { success: false, error: 'Failed to create booking' },
        { status: 500 }
      );
    }

    // 5. Return success
    return NextResponse.json({
      success: true,
      booking: result.data!.booking,
      invoice: result.data!.invoice
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
