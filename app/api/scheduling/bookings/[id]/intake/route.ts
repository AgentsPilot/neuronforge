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

    /*
     * 3. The questions come WITH the answers.
     *
     * This looked the template up by id in `intake_form_templates` — a table
     * that no longer exists, so the lookup threw. It does not need to exist: a
     * submission stores the questions it was answered against, which is what
     * keeps it readable after the form is edited and republished. Older rows
     * had their labels backfilled by the same migration that dropped the table.
     *
     * `template` stays in the response shape, always null, so a caller still
     * reading it gets nothing rather than an error.
     */
    return NextResponse.json({
      success: true,
      intake: result.data,
      template: null
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
      entityType: 'scheduling_booking',
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

    /*
     * 4. Send it. The gate lives in one place, and this is not it.
     *
     * There used to be a pre-flight check here asking whether the business had
     * a collectable template — a second opinion on a question the email service
     * already answers, and one that queried `user_intake_settings.template_id`,
     * a column the intake migration dropped. It threw, returned no data, and
     * this endpoint refused with "no intake form configured" for a business
     * whose form was published and working.
     *
     * `sendIntakeFormRequest` resolves the published form and reports which of
     * the three things is in the way. That answer is the one the owner sees.
     */
    // Manual: the owner pressed Send on this one booking.
    const emailResult = await BookingEmailService.sendIntakeFormRequest(bookingId, user.id, {
      manual: true,
    });

    if (!emailResult.sent) {
      requestLogger.warn({ err: emailResult.error, bookingId }, 'Intake form email not sent');
      /*
       * A refusal the owner can act on is a 400, not a 500. "Your intake form
       * has not been published yet" is not a server fault, and answering 500
       * makes the button look broken instead of telling them what to do.
       */
      const ownerFixable =
        emailResult.error === 'Your intake form has not been published yet' ||
        emailResult.error === 'Automatic sending is switched off for this business' ||
        emailResult.error === 'No intake form configured';

      return NextResponse.json(
        { success: false, error: emailResult.error || 'Failed to send intake form email' },
        { status: ownerFixable ? 400 : 500 }
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
