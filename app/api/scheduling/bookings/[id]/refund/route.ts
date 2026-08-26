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
import Stripe from 'stripe';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { paymentTransactionRepository } from '@/lib/repositories/PaymentRepository';
import { BookingEmailService } from '@/lib/services/BookingEmailService';

// Use platform Stripe directly for refunds (website bookings use platform Stripe)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia'
});

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

    // 4. Try to find payment transaction
    let transaction = null;

    // First, check if booking has payment_id
    if (booking.payment_id) {
      const txResult = await paymentTransactionRepository.findById(booking.payment_id, user.id);
      if (txResult.data) {
        transaction = txResult.data;
        requestLogger.info({ transactionId: transaction.id }, 'Found transaction by payment_id');
      }
    }

    // If no transaction yet, try to find by booking_id in metadata
    if (!transaction) {
      const { data: txByBooking } = await supabaseServer
        .from('payment_transactions')
        .select('*')
        .eq('user_id', user.id)
        .contains('metadata', { booking_id: bookingId })
        .single();

      if (txByBooking) {
        transaction = txByBooking;
        requestLogger.info({ transactionId: transaction.id }, 'Found transaction by booking metadata');

        // Update booking with the payment_id we found
        await supabaseServer
          .from('scheduling_bookings')
          .update({ payment_id: transaction.id })
          .eq('id', bookingId)
          .eq('user_id', user.id);
      }
    }

    // 5. Process refund
    if (transaction && (transaction.stripe_payment_intent_id || transaction.stripe_charge_id)) {
      // Has Stripe transaction - process actual refund
      requestLogger.info({
        transactionId: transaction.id,
        stripePaymentIntent: transaction.stripe_payment_intent_id
      }, 'Processing Stripe refund');

      const refundAmount = refund_type === 'full' ? transaction.amount : amount;

      if (!refundAmount || refundAmount <= 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid refund amount' },
          { status: 400 }
        );
      }

      // Process refund through platform Stripe directly
      // Website bookings use platform Stripe, not user-connected processors
      const processorType = transaction.processor_type || 'stripe';

      if (processorType !== 'manual') {
        requestLogger.info({
          processorType,
          stripePaymentIntent: transaction.stripe_payment_intent_id,
          stripeChargeId: transaction.stripe_charge_id,
          refundAmount
        }, 'Processing refund through platform Stripe');

        try {
          // Stripe expects amount in cents
          const amountInCents = Math.round(refundAmount * 100);

          let refund: Stripe.Refund;

          if (transaction.stripe_payment_intent_id) {
            // Refund by payment intent
            refund = await stripe.refunds.create({
              payment_intent: transaction.stripe_payment_intent_id,
              amount: amountInCents,
              reason: 'requested_by_customer'
            });
          } else if (transaction.stripe_charge_id) {
            // Refund by charge ID
            refund = await stripe.refunds.create({
              charge: transaction.stripe_charge_id,
              amount: amountInCents,
              reason: 'requested_by_customer'
            });
          } else {
            throw new Error('No Stripe payment intent or charge ID found');
          }

          requestLogger.info({
            refundId: refund.id,
            refundStatus: refund.status,
            refundAmount: refund.amount
          }, 'Stripe refund processed successfully');

        } catch (stripeError) {
          requestLogger.error({ err: stripeError }, 'Stripe refund failed');
          return NextResponse.json(
            {
              success: false,
              error: stripeError instanceof Error ? stripeError.message : 'Refund failed'
            },
            { status: 500 }
          );
        }
      }

      // Update transaction record
      const totalRefunded = (transaction.refunded_amount || 0) + refundAmount;
      const isFullyRefunded = totalRefunded >= transaction.amount;

      await supabaseServer
        .from('payment_transactions')
        .update({
          refunded_amount: totalRefunded,
          status: isFullyRefunded ? 'refunded' : 'partially_refunded',
          refund_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id)
        .eq('user_id', user.id);

      // Update booking payment_status
      await supabaseServer
        .from('scheduling_bookings')
        .update({
          payment_status: isFullyRefunded ? 'refunded' : 'paid',
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .eq('user_id', user.id);

      requestLogger.info({
        bookingId,
        refundAmount,
        totalRefunded,
        isFullyRefunded
      }, 'Stripe refund processed successfully');

      // Send refund confirmation email (non-blocking)
      if (notify_contact) {
        BookingEmailService.sendRefundConfirmation(bookingId, user.id, {
          refundAmount,
          originalAmount: transaction.amount,
          currency: transaction.currency || 'USD',
          refundType: isFullyRefunded ? 'full' : 'partial',
          reason,
          isManualRefund: false
        }).catch(err => requestLogger.warn({ err }, 'Failed to send refund email (non-blocking)'));
      }

      return NextResponse.json({
        success: true,
        refunded_amount: refundAmount,
        total_refunded: totalRefunded,
        refund_status: isFullyRefunded ? 'full' : 'partial',
        processor: 'stripe'
      });

    } else {
      // No Stripe transaction - manual payment, just update status
      requestLogger.info({ bookingId }, 'Manual payment - updating status only');

      await supabaseServer
        .from('scheduling_bookings')
        .update({
          payment_status: 'refunded',
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .eq('user_id', user.id);

      // If there's a transaction record without Stripe, update it too
      if (transaction) {
        await supabaseServer
          .from('payment_transactions')
          .update({
            status: 'refunded',
            refund_reason: reason,
            refunded_amount: transaction.amount,
            updated_at: new Date().toISOString()
          })
          .eq('id', transaction.id)
          .eq('user_id', user.id);
      }

      // Get refund amount from transaction or service price
      const serviceData = booking.service as { price?: number; currency?: string } | null;
      const manualRefundAmount = transaction?.amount || serviceData?.price || 0;
      const manualRefundCurrency = transaction?.currency || serviceData?.currency || 'USD';

      // Send refund confirmation email (non-blocking)
      if (notify_contact && manualRefundAmount > 0) {
        BookingEmailService.sendRefundConfirmation(bookingId, user.id, {
          refundAmount: manualRefundAmount,
          originalAmount: manualRefundAmount,
          currency: manualRefundCurrency,
          refundType: 'full',
          reason,
          isManualRefund: true
        }).catch(err => requestLogger.warn({ err }, 'Failed to send refund email (non-blocking)'));
      }

      return NextResponse.json({
        success: true,
        refund_status: 'full',
        processor: 'manual',
        message: 'Payment status updated (manual payment - no actual refund processed)'
      });
    }

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
