/**
 * POST /api/scheduling/bookings/[id]/cancel
 * Cancel a booking with optional reason
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { cancelBooking } from '@/lib/services/BookingLifecycleService';
import { OWNER_CANCEL_REASONS } from '@/lib/business-os/cancellationReasons';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingCancelAPI' });

const cancelBookingSchema = z.object({
  /*
   * REQUIRED, from the OWNER's list — the longer one.
   *
   * The owner sees what a client never reports: a no-show, a double booking, a
   * duplicate, a slot that was moved rather than dropped. Those last three are
   * the codes that let a report stop counting non-cancellations as cancellations.
   */
  reason_code: z.enum(OWNER_CANCEL_REASONS),
  reason: z.string().max(1000).optional(),
  /*
   * Whether the note above reaches the client's email.
   *
   * Defaults to TRUE, which is the behaviour this route has always had. The
   * owner turns it off when the note is for their own records — and the client
   * then gets a neutral phrasing of the reason instead of nothing, so the email
   * still explains itself.
   */
  share_note_with_client: z.boolean().optional().default(true)
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    // 2. Validate input
    const body = await request.json();
    const validated = cancelBookingSchema.parse(body);

    const bookingId = params.id;

    // 3. Cancel — status, calendar and client notification together.
    //
    // The sequence lives in BookingLifecycleService so that the chat cancels a
    // booking the same way this route does. It used to live here, which meant
    // cancelling from anywhere else updated a status and stopped there.
    const result = await cancelBooking({
      bookingId,
      userId: user.id,
      reason: validated.reason,
      cancelReason: validated.reason_code,
      cancelNote: validated.reason,
      // The owner pressed it. `cancelledBy` is the column that replaces parsing
      // CLIENT_CANCELLED_PREFIX out of the prose.
      cancelledBy: 'owner',
      shareNoteWithClient: validated.share_note_with_client,
      request,
      logger: requestLogger
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to cancel booking');
      const notFound = result.error.message === 'Booking not found';
      return NextResponse.json(
        { success: false, error: notFound ? 'Booking not found' : 'Failed to cancel booking' },
        { status: notFound ? 404 : 500 }
      );
    }

    /*
     * 4. Return success — including what the cancellation did NOT do.
     *
     * Unpaid invoices were closed, so nothing chases the client for an
     * appointment that is not happening. Money already paid was deliberately
     * left alone: a refund moves real money and belongs to a person. The
     * drawer uses these two to ask the owner about it while they are still
     * looking at the booking, rather than leaving it to be noticed later.
     */
    return NextResponse.json({
      success: true,
      booking: result.data!.booking,
      client_notified: result.data!.clientNotified,
      invoices_cancelled: result.data!.invoicesCancelled,
      amount_held: result.data!.amountHeld,
      held_currency: result.data!.heldCurrency,
      /*
       * A payment plan still charging this client, reported and left running —
       * ending someone's payment arrangement is not a side effect of calling
       * off one appointment. The drawer asks about it while the owner is still
       * looking at the booking.
       */
      plan_live: result.data!.planLive,
      periods_remaining: result.data!.periodsRemaining
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
