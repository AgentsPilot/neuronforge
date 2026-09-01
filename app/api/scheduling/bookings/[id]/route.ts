/**
 * GET /api/scheduling/bookings/[id]
 * PUT /api/scheduling/bookings/[id]
 * DELETE /api/scheduling/bookings/[id]
 * Individual scheduling booking endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { schedulingBookingRepository, schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import {
  paymentInvoiceRepository,
  paymentTransactionRepository,
  stripeConnectRepository,
  type PaymentInvoice
} from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { isSettledInvoice } from '@/lib/payments/invoiceSettlement';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import { z } from 'zod';

const logger = createLogger({ module: 'SchedulingBookingAPI' });
const auditTrail = AuditTrailService.getInstance();

/**
 * Void an invoice at Stripe so a deleted booking's invoice stops being payable.
 *
 * Best effort by design: the local row is going away either way, and a Stripe
 * invoice that is already void, paid or never finalized will reject the call.
 * Losing the void is worth a warning, not a failed delete.
 */
async function voidStripeInvoice(
  invoice: PaymentInvoice,
  userId: string,
  // Structural, so any child logger shape fits without a cast.
  requestLogger: { warn: (context: Record<string, unknown>, message: string) => void }
): Promise<void> {
  if (!invoice.stripe_invoice_id) return;

  try {
    const stripeAccount = await stripeConnectRepository.findByUserId(userId);
    const connectAccountId = stripeAccount.data?.stripe_account_id;
    if (!connectAccountId) {
      requestLogger.warn({
        invoiceId: invoice.id, stripeInvoiceId: invoice.stripe_invoice_id
      }, 'No Stripe account to void the invoice through');
      return;
    }

    await getStripeInvoiceService().voidInvoice(invoice.stripe_invoice_id, connectAccountId);
  } catch (err) {
    requestLogger.warn({
      err, invoiceId: invoice.id, stripeInvoiceId: invoice.stripe_invoice_id
    }, 'Failed to void Stripe invoice; deleting the local record anyway');
  }
}

// Validation schema for updates
// Note: client_* fields removed - client data is now only in crm_contacts (via contact_id)
const updateBookingSchema = z.object({
  // Booking time updates
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  timezone: z.string().optional(),
  // Contact update (to link to different contact)
  contact_id: z.string().uuid().optional(),
  // Status updates
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
  cancellation_reason: z.string().optional(),
  // Payment updates
  payment_status: z.enum(['pending', 'paid', 'refunded']).optional(),
  payment_id: z.string().optional(),
  // Notes
  notes: z.string().optional(),
  internal_notes: z.string().optional(),
  // Reminder tracking
  reminder_24hr_sent: z.boolean().optional(),
  reminder_2hr_sent: z.boolean().optional(),
  // Intake form - allow sending intake form after initial booking
  send_intake_form: z.boolean().optional()
});

export async function GET(
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

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId }, 'Fetching booking');

    // 2. Get booking
    const result = await schedulingBookingRepository.findById(bookingId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to fetch booking');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch booking' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      booking: result.data
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

export async function PUT(
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
    const validated = updateBookingSchema.parse(body);

    // Extract send_intake_form flag (not a DB column, just a trigger to send email)
    const { send_intake_form, ...bookingUpdateData } = validated;

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId, updates: Object.keys(bookingUpdateData), sendIntakeForm: send_intake_form }, 'Updating booking');

    // 3. Fetch old booking first (for time change comparison)
    const oldBookingResult = await schedulingBookingRepository.findById(bookingId, user.id);
    if (oldBookingResult.error || !oldBookingResult.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }
    const oldBooking = oldBookingResult.data;

    // 4. Update booking (only pass actual DB columns, not send_intake_form flag)
    const result = await schedulingBookingRepository.update(bookingId, user.id, bookingUpdateData);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to update booking');
      return NextResponse.json(
        { success: false, error: 'Failed to update booking' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 5. Get contact name for audit log
    let contactName = 'Client';
    if (result.data.contact_id) {
      const contactResult = await crmContactRepository.findById(result.data.contact_id, user.id);
      if (contactResult.data) {
        contactName = `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim() || 'Client';
      }
    }

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_UPDATED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: bookingId,
        resourceName: `Booking for ${contactName}`,
        changes: validated,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 7. Sync calendar event if booking has one (non-blocking)
    if (result.data.external_calendar_event_id) {
      schedulingServiceRepository.findById(result.data.service_id, user.id)
        .then(serviceResult => {
          if (serviceResult.data && result.data) {
            // If booking was cancelled, delete the calendar event
            if (validated.status === 'cancelled' || validated.status === 'no_show') {
              CalendarSyncService.deleteCalendarEvent(result.data, user.id)
                .catch(err => requestLogger.warn({ err, bookingId }, 'Calendar event delete failed'));
            } else {
              // Otherwise update the calendar event
              CalendarSyncService.updateCalendarEvent(result.data, serviceResult.data, user.id)
                .catch(err => requestLogger.warn({ err, bookingId }, 'Calendar event update failed'));
            }
          }
        })
        .catch(err => requestLogger.warn({ err }, 'Failed to get service for calendar sync'));
    }

    // 8. Send update email if time ACTUALLY changed and booking is confirmed (non-blocking)
    // Compare old vs new times to avoid sending email when only other fields changed (like intake toggle)
    const oldStartTime = new Date(oldBooking.start_time).getTime();
    const oldEndTime = new Date(oldBooking.end_time).getTime();
    const newStartTime = validated.start_time ? new Date(validated.start_time).getTime() : oldStartTime;
    const newEndTime = validated.end_time ? new Date(validated.end_time).getTime() : oldEndTime;
    const timeActuallyChanged = oldStartTime !== newStartTime || oldEndTime !== newEndTime;

    if (timeActuallyChanged && result.data.status === 'confirmed' && result.data.contact_id) {
      BookingEmailService.sendRescheduledEmail(
        bookingId,
        user.id,
        new Date(oldBooking.start_time)
      ).catch(err => requestLogger.warn({ err, bookingId }, 'Reschedule email failed'));
    }

    // 9. Send intake form if requested (non-blocking)
    // Only send if booking doesn't already have intake data
    if (send_intake_form && !oldBooking.intake_responses && !oldBooking.intake_completed_at) {
      requestLogger.info({ bookingId, userId: user.id }, 'Sending intake form request for existing booking');

      // Mark the booking as having intake requested by setting empty intake_responses
      // This allows the journey timeline to show "intake pending" status
      await schedulingBookingRepository.update(bookingId, user.id, {
        intake_responses: {
          template_id: '',
          template_key: 'pending',
          responses: {}
        }
      });

      BookingEmailService.sendIntakeFormRequest(bookingId, user.id)
        .catch(err => requestLogger.warn({ err, bookingId }, 'Intake form request email failed'));
    }

    // 10. Return success
    requestLogger.info({ bookingId, userId: user.id }, 'Booking updated successfully');
    return NextResponse.json({
      success: true,
      booking: result.data
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

export async function DELETE(
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

    const bookingId = params.id;
    requestLogger.info({ userId: user.id, bookingId }, 'Deleting booking');

    // 2. Get booking first (for audit trail)
    const getResult = await schedulingBookingRepository.findById(bookingId, user.id);
    if (getResult.error || !getResult.data) {
      return NextResponse.json(
        { success: false, error: 'Booking not found' },
        { status: 404 }
      );
    }

    // 3. Settle what was billed for this booking before touching the booking.
    //
    // payment_invoices.booking_id is ON DELETE SET NULL, so an invoice outlives
    // its booking as an orphan: still owed, still payable through its Stripe
    // link, and no longer traceable to anything. So an unpaid invoice goes with
    // the booking, and a paid one blocks the delete outright — money that
    // changed hands is a record to refund deliberately, not to erase.
    const invoicesResult = await paymentInvoiceRepository.findByBookingId(bookingId, user.id);
    if (invoicesResult.error) {
      requestLogger.error({ err: invoicesResult.error, userId: user.id, bookingId }, 'Failed to load invoices for booking');
      return NextResponse.json(
        { success: false, error: 'Failed to delete booking' },
        { status: 500 }
      );
    }

    const bookingInvoices = invoicesResult.data || [];

    // A refund leaves the invoice sitting at 'paid' — refunding updates the
    // booking and the transaction, never the invoice — so the booking's own
    // payment_status is what says whether the money went back.
    const wasRefunded = getResult.data.payment_status === 'refunded';
    const paidInvoices = wasRefunded
      ? []
      : bookingInvoices.filter(isSettledInvoice);

    // Money can also have arrived without the invoice being marked paid.
    const settledResult = await paymentTransactionRepository.findSettledForBooking(
      bookingId,
      bookingInvoices.map(inv => inv.id),
      user.id
    );
    if (settledResult.error) {
      requestLogger.error({ err: settledResult.error, userId: user.id, bookingId }, 'Failed to check payments for booking');
      return NextResponse.json(
        { success: false, error: 'Failed to delete booking' },
        { status: 500 }
      );
    }
    const settledPayments = settledResult.data || [];

    if (paidInvoices.length > 0 || settledPayments.length > 0) {
      requestLogger.info({
        userId: user.id,
        bookingId,
        paidInvoices: paidInvoices.map(inv => inv.invoice_number),
        settledPayments: settledPayments.length
      }, 'Refused to delete booking that has been paid for');

      return NextResponse.json(
        {
          success: false,
          code: 'BOOKING_HAS_PAID_INVOICE',
          error: 'This booking has already been paid for and cannot be deleted. Refund the payment first, or cancel the booking instead.',
          details: {
            paid_invoice_numbers: paidInvoices.map(inv => inv.invoice_number),
            paid_amount: [
              ...paidInvoices.map(inv => Number(inv.amount) || 0),
              ...settledPayments
                .filter(t => !t.invoice_id || !paidInvoices.some(inv => inv.id === t.invoice_id))
                .map(t => Number(t.amount) || 0)
            ].reduce((sum, amount) => sum + amount, 0)
          }
        },
        { status: 409 }
      );
    }

    // Nothing is owed to the client and nothing is held from them: drop the
    // OPEN invoices raised for this booking, voiding each at the processor
    // first so nobody can still open the hosted page and pay for a session that
    // no longer exists. An invoice that was paid and later refunded is left
    // alone — deleting a settled record would erase financial history.
    const openInvoices = bookingInvoices.filter(inv => !isSettledInvoice(inv));
    for (const invoice of openInvoices) {
      await voidStripeInvoice(invoice, user.id, requestLogger);

      const invoiceDeleteResult = await paymentInvoiceRepository.delete(invoice.id, user.id);
      if (invoiceDeleteResult.error) {
        requestLogger.error({
          err: invoiceDeleteResult.error, userId: user.id, bookingId, invoiceId: invoice.id
        }, 'Failed to delete invoice for booking');
        return NextResponse.json(
          { success: false, error: 'Failed to delete the invoice for this booking' },
          { status: 500 }
        );
      }

      auditTrail
        .log({
          action: 'PAYMENT_INVOICE_DELETED',
          userId: user.id,
          entityType: 'payment_invoice',
          entityId: invoice.id,
          resourceName: invoice.invoice_number,
          severity: 'warning',
          request
        })
        .catch(err => requestLogger.error({ err }, 'Audit failed'));
    }

    // 4. Delete booking
    const result = await schedulingBookingRepository.delete(bookingId, user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id, bookingId }, 'Failed to delete booking');
      return NextResponse.json(
        { success: false, error: 'Failed to delete booking' },
        { status: 500 }
      );
    }

    // 5. Get contact name for audit log
    let deleteContactName = 'Client';
    if (getResult.data.contact_id) {
      const deleteContactResult = await crmContactRepository.findById(getResult.data.contact_id, user.id);
      if (deleteContactResult.data) {
        deleteContactName = `${deleteContactResult.data.first_name || ''} ${deleteContactResult.data.last_name || ''}`.trim() || 'Client';
      }
    }

    // 6. Audit log (non-blocking)
    auditTrail
      .log({
        action: 'SCHEDULING_BOOKING_DELETED',
        userId: user.id,
        entityType: 'scheduling_booking',
        entityId: bookingId,
        resourceName: `Booking for ${deleteContactName}`,
        request
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 7. Return success
    requestLogger.info({
      bookingId,
      userId: user.id,
      deletedInvoices: openInvoices.length
    }, 'Booking deleted successfully');
    return NextResponse.json({
      success: true,
      message: 'Booking deleted successfully',
      deleted_invoices: openInvoices.map(inv => inv.invoice_number)
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
