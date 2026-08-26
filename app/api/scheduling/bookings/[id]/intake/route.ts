/**
 * Intake Edit API
 *
 * GET /api/scheduling/bookings/[id]/intake - Get intake responses and template
 * PUT /api/scheduling/bookings/[id]/intake - Update intake responses
 * POST /api/scheduling/bookings/[id]/intake - Resend intake form email to contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'IntakeEditAPI' });
const auditTrail = AuditTrailService.getInstance();

// Validation schema for updating responses
const updateIntakeSchema = z.object({
  responses: z.record(z.unknown())
});

/**
 * GET /api/scheduling/bookings/[id]/intake
 * Get intake responses and template for a booking
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: bookingId } = await params;
    requestLogger.info({ userId: user.id, bookingId }, 'Fetching intake responses');

    // 2. Get intake responses
    const result = await intakeRepository.getIntakeResponses(bookingId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, bookingId }, 'Failed to fetch intake responses');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch intake responses' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'No intake responses found' },
        { status: 404 }
      );
    }

    // 3. Get the template
    const templateResult = await intakeRepository.getTemplateById(result.data.template_id);

    return NextResponse.json({
      success: true,
      intake: result.data,
      template: templateResult.data
    });

  } catch (error) {
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

/**
 * PUT /api/scheduling/bookings/[id]/intake
 * Update intake responses for a booking
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: bookingId } = await params;

    // 2. Validate input
    const body = await request.json();
    const validated = updateIntakeSchema.parse(body);

    requestLogger.info({ userId: user.id, bookingId }, 'Updating intake responses');

    // 3. Update intake responses
    const result = await intakeRepository.updateIntakeResponses(
      bookingId,
      user.id,
      validated.responses
    );

    if (result.error) {
      requestLogger.error({ err: result.error, bookingId }, 'Failed to update intake responses');
      return NextResponse.json(
        { success: false, error: result.error.message || 'Failed to update intake responses' },
        { status: 500 }
      );
    }

    // 4. Audit log (non-blocking)
    auditTrail.log({
      action: 'INTAKE_RESPONSES_UPDATED',
      userId: user.id,
      entityType: 'booking',
      entityId: bookingId,
      changes: { responses: 'updated' },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ bookingId }, 'Intake responses updated successfully');

    return NextResponse.json({
      success: true,
      message: 'Intake responses updated'
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
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

/**
 * POST /api/scheduling/bookings/[id]/intake
 * Resend intake form email to the contact
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: bookingId } = await params;
    requestLogger.info({ userId: user.id, bookingId }, 'Resending intake form email');

    // 2. Verify booking exists and belongs to user
    const bookingResult = await schedulingBookingRepository.findById(bookingId, user.id);
    if (bookingResult.error || !bookingResult.data) {
      requestLogger.error({ err: bookingResult.error, bookingId }, 'Booking not found');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    const booking = bookingResult.data;

    // 3. Check if booking is in valid status (not cancelled)
    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Cannot send intake form for cancelled booking' },
        { status: 400 }
      );
    }

    // 4. Check if user has an intake template enabled
    const templateResult = await intakeRepository.getEnabledTemplateForUser(user.id);
    if (!templateResult.data) {
      return NextResponse.json(
        { success: false, error: 'No intake form configured. Please enable an intake form in settings first.' },
        { status: 400 }
      );
    }

    // 5. Send intake form email
    const emailResult = await BookingEmailService.sendIntakeFormRequest(bookingId, user.id);

    if (!emailResult.sent) {
      requestLogger.error({ err: emailResult.error, bookingId }, 'Failed to send intake form email');
      return NextResponse.json(
        { success: false, error: emailResult.error || 'Failed to send intake form email' },
        { status: 500 }
      );
    }

    // 6. Audit log (non-blocking)
    auditTrail.log({
      action: 'INTAKE_EMAIL_RESENT',
      userId: user.id,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: booking.client_email,
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ bookingId, clientEmail: booking.client_email }, 'Intake form email sent successfully');

    return NextResponse.json({
      success: true,
      message: 'Intake form email sent successfully'
    });

  } catch (error) {
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
