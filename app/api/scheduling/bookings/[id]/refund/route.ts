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
import { refund, resolveRefundTarget } from '@/lib/payments/RefundService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';

const logger = createLogger({ module: 'BookingRefundAPI' });

const RefundSchema = z.object({
  refund_type: z.enum(['full', 'partial']),
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
  notify_contact: z.boolean().optional().default(true)
});

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

    const { refund_type, amount, reason, notify_contact } = parseResult.data;

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
    const target = await resolveRefundTarget({ userId: user.id, bookingId });

    if ('error' in target) {
      return NextResponse.json(
        { success: false, error: target.message, code: target.error },
        { status: target.error === 'NOT_FOUND' ? 404 : 400 }
      );
    }

    const outcome = await refund({
      userId: user.id,
      transactionId: target.transactionId,
      // Omitted for a full refund: everything still remaining, rather than the
      // original amount.
      amount: refund_type === 'partial' ? amount : undefined,
      reason,
      source: 'app',
      initiatedBy: user.id,
      clientRequestId: `booking:${bookingId}:${refund_type}:${amount ?? 'all'}`
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

    const fullyRefunded = settled?.refund_status === 'full';

    await supabaseServer
      .from('scheduling_bookings')
      .update({
        payment_status: fullyRefunded ? 'refunded' : 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .eq('user_id', user.id);

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
