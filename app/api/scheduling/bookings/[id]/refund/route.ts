/**
 * Booking Refund API
 * POST /api/scheduling/bookings/[id]/refund
 *
 * Processes refunds for booking payments:
 * 1. If booking has payment_id -> uses payment blocks API
 * 2. If no payment_id but has Stripe transaction -> looks up by booking metadata
 * 3. If no Stripe transaction -> just updates payment_status (manual payment)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { refund, refundGroup, resolveRefundTargets } from '@/lib/payments/RefundService';
import { syncBookingPaymentState } from '@/lib/payments/syncBookingPaymentState';
import { BookingEmailService } from '@/lib/services/BookingEmailService';

const logger = createLogger({ module: 'BookingRefundAPI' });

const RefundSchema = z.object({
  refund_type: z.enum(['full', 'partial']),
  /**
   * Supplied by the client so a retry of one request replays instead of
   * refunding twice. Optional: absent, each call is its own intent, which is
   * the safe reading when the caller has not thought about it.
   */
  client_request_id: z.string().max(200).optional(),
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
  notify_contact: z.boolean().optional().default(true)
});


/**
 * Refund every payment on a booking, as one intent.
 *
 * Reports per-payment outcomes rather than a single boolean: Stripe refunds are
 * individually final, so seven successes and five failures is a real end state
 * and the owner has to be told which is which.
 */
async function refundWholeBooking(input: {
  userId: string;
  bookingId: string;
  transactionIds: string[];
  reason?: string;
  notifyContact: boolean;
  clientRequestId?: string;
  requestLogger: typeof logger;
}) {
  const group = await refundGroup({
    userId: input.userId,
    transactionIds: input.transactionIds,
    reason: input.reason,
    source: 'app',
    initiatedBy: input.userId,
    clientRequestId: input.clientRequestId,
  });

  const state = await syncBookingPaymentState(input.bookingId, input.userId);
  const complete = group.succeeded === group.requested;

  input.requestLogger.info(
    {
      bookingId: input.bookingId,
      requested: group.requested,
      succeeded: group.succeeded,
      refundedTotal: group.refundedTotal,
    },
    'Booking refunded in full'
  );

  // One email for the whole booking. Told per period, a client with a
  // twelve-month plan would receive twelve refund confirmations at once.
  if (input.notifyContact && group.refundedTotal > 0) {
    BookingEmailService.sendRefundConfirmation(input.bookingId, input.userId, {
      refundAmount: group.refundedTotal,
      originalAmount: state.collected,
      currency: group.currency ?? '',
      refundType: state.status === 'refunded' ? 'full' : 'partial',
      reason: input.reason,
      isManualRefund: false,
    }).catch(err =>
      input.requestLogger.warn({ err }, 'Failed to send refund email (non-blocking)')
    );
  }

  return NextResponse.json(
    {
      success: complete,
      refunded_amount: group.refundedTotal,
      refund_status: state.status === 'refunded' ? 'full' : 'partial',
      payments: group.legs,
      error: complete
        ? undefined
        : `${group.succeeded} of ${group.requested} payments were refunded.`,
    },
    { status: complete ? 200 : 409 }
  );
}

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

    // 2. Validate input
    const body = await request.json();
    const parseResult = RefundSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { refund_type, amount, reason, notify_contact, client_request_id } = parseResult.data;

    requestLogger.info({ bookingId, refundType: refund_type, amount }, 'Processing booking refund');

    // 3. Get booking with service details for refund amount
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, payment_id, payment_status, service_id, service:scheduling_services(price, currency)')
      .eq('id', bookingId)
      .eq('user_id', user.id)
      .single();

    if (bookingError || !booking) {
      requestLogger.warn({ bookingId }, 'Booking not found');
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    if (booking.payment_status !== 'paid') {
      return NextResponse.json(
        { success: false, error: 'Booking is not in paid status' },
        { status: 400 }
      );
    }

    // 4. The refund itself belongs to RefundService.
    //
    // This route used to do all of it: find the transaction, call Stripe with a
    // PLATFORM client (which cannot see a connected account's payment intent, so
    // it failed for every real charge), and write refunded_amount by hand with a
    // status the schema does not declare. None of that is booking-specific, and
    // keeping a second copy of it is how the two refund paths drifted apart.
    //
    // What stays here is what only this route knows: the booking's own
    // payment_status, and telling the client.
    const targets = await resolveRefundTargets({ userId: user.id, bookingId });

    if ('error' in targets) {
      return NextResponse.json(
        { success: false, error: targets.message, code: targets.error },
        { status: targets.error === 'NOT_FOUND' ? 404 : 400 }
      );
    }

    /*
     * A booking can hold several payments — a deposit and a balance, or every
     * period of a payment plan.
     *
     * This route took the NEWEST one and refunded that. On a twelve-period plan
     * that returned one twelfth of the money, then read that single
     * transaction's `refund_status` and marked the entire booking refunded. The
     * owner saw "refunded" over eleven-twelfths of the money still held.
     *
     * A full refund of a booking means all of it; a partial amount is a
     * statement about ONE payment and cannot be split honestly across several.
     */
    if (targets.transactionIds.length > 1 && refund_type === 'full') {
      return await refundWholeBooking({
        userId: user.id,
        bookingId,
        transactionIds: targets.transactionIds,
        reason,
        notifyContact: notify_contact,
        clientRequestId: client_request_id,
        requestLogger,
      });
    }

    if (targets.transactionIds.length > 1) {
      return NextResponse.json(
        {
          success: false,
          code: 'AMBIGUOUS_TARGET',
          error:
            'This booking has more than one payment. Refund a specific payment from the payments list, or refund the booking in full.',
          payment_count: targets.transactionIds.length,
        },
        { status: 409 }
      );
    }

    const target = { transactionId: targets.transactionIds[0] };

    const outcome = await refund({
      userId: user.id,
      transactionId: target.transactionId,
      // Omitted for a full refund: everything still remaining, rather than the
      // original amount.
      amount: refund_type === 'partial' ? amount : undefined,
      reason,
      source: 'app',
      initiatedBy: user.id,
      /**
       * The CALLER's request id, not a hash of what was asked for.
       *
       * This was `booking:{id}:{type}:{amount}` — stable across separate,
       * legitimate intents. Two £50 partial refunds a week apart produced the
       * same key, so the second collided on the unique index, returned as a
       * replay, and this route then updated the booking and emailed the client
       * about a refund that never happened.
       *
       * A request id identifies a REQUEST. Two requests to refund £50 are two
       * requests; only a retry of the same one should collapse.
       */
      clientRequestId: client_request_id ?? crypto.randomUUID()
    });

    if (!outcome.ok) {
      requestLogger.warn({ bookingId, code: outcome.code }, 'Refund refused');
      return NextResponse.json(
        { success: false, error: outcome.message, code: outcome.code },
        { status: outcome.code === 'NOT_FOUND' ? 404 : 409 }
      );
    }

    // The transaction and the invoice are updated by trigger from the ledger.
    // The booking is not, so it is set here — read back rather than assumed,
    // since whether this was a full refund depends on what came before it.
    const { data: settled } = await supabaseServer
      .from('payment_transactions')
      .select('refund_status, amount, currency')
      .eq('id', target.transactionId)
      .maybeSingle();

    // The BOOKING's state, from all of its money — not from this one payment's
    // `refund_status`, which said "refunded" for a booking still holding the
    // rest of it.
    const state = await syncBookingPaymentState(bookingId, user.id);
    const fullyRefunded = state.status === 'refunded';

    // Only after the money actually moved. Fired before, this told clients
    // about refunds that had failed.
    if (notify_contact) {
      BookingEmailService.sendRefundConfirmation(bookingId, user.id, {
        refundAmount: outcome.amount,
        originalAmount: Number(settled?.amount ?? outcome.amount),
        currency: outcome.currency,
        refundType: fullyRefunded ? 'full' : 'partial',
        reason,
        isManualRefund: false
      }).catch(err => requestLogger.warn({ err }, 'Failed to send refund email (non-blocking)'));
    }

    requestLogger.info(
      { bookingId, refundId: outcome.refundId, amount: outcome.amount, fullyRefunded },
      'Booking refund complete'
    );

    return NextResponse.json({
      success: true,
      refunded_amount: outcome.amount,
      refund_status: fullyRefunded ? 'full' : 'partial',
      replayed: outcome.replayed
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to process refund');
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process refund'
      },
      { status: 500 }
    );
  }
}
