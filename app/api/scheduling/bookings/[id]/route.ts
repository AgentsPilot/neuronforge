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
  ISSUED_INVOICE_STATUSES,
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
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence, activityMoment } from '@/lib/business-os/activityText';
import { supabaseServer } from '@/lib/supabaseServer';
import { settleInvoicePaid } from '@/lib/payments/invoiceSettlement';

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

    /*
     * ───────────────────────────────────────────────────────────────────────
     * A SETTLED BOOKING IS A RECORD, NOT A PLAN.
     *
     * `completed` and `cancelled` are terminal: the meeting happened or it did
     * not, and neither can be moved, reassigned to another client, or turned
     * into a different service afterwards. This route accepted all of it —
     * there was no status check anywhere in the handler — so a completed
     * appointment could be rewritten into a different one, leaving the invoice
     * raised against it describing something that never took place.
     *
     * Notes and status stay open. Writing up a session after it happens is the
     * normal use of the screen once a meeting is over, and a status can still
     * be corrected — a no-show marked completed by mistake has to be fixable.
     */
    const SETTLED = ['completed', 'cancelled'];
    const MEETING_FACTS = [
      'service_id',
      'contact_id',
      'start_time',
      'end_time',
      'timezone',
      'client_first_name',
      'client_last_name',
      'client_email',
      'client_phone',
    ] as const;

    if (SETTLED.includes(oldBooking.status)) {
      const attempted = MEETING_FACTS.filter(field => {
        const next = (bookingUpdateData as Record<string, unknown>)[field];
        return next !== undefined && next !== (oldBooking as Record<string, unknown>)[field];
      });

      if (attempted.length > 0) {
        requestLogger.info(
          { userId: user.id, bookingId, status: oldBooking.status, attempted },
          'Refused to rewrite a settled booking'
        );
        return NextResponse.json(
          {
            success: false,
            error: `This booking is ${oldBooking.status} and cannot be changed.`,
            reason: 'booking_settled',
            fields: attempted,
          },
          { status: 409 }
        );
      }
    }

    // 4. Update booking (only pass actual DB columns, not send_intake_form flag)
    const result = await schedulingBookingRepository.update(bookingId, user.id, bookingUpdateData);

    /*
     * Money marked on the booking is money marked on its invoice.
     *
     * The contact drawer's "mark as paid" sets `payment_status` here and
     * stopped — leaving the invoice behind that booking at `sent`. The invoice
     * is the only record the money side reads, so the client had paid, the
     * booking said so, and the briefing, the unpaid-invoice gap, the overdue
     * detector and the revenue-at-risk total all went on reporting the amount
     * as owed. One £500 session reported as a debt by four surfaces at once.
     *
     * The mirror already exists: settling an invoice confirms its booking
     * (`invoices/[id]/mark-paid`). Only this direction was missing, so which
     * screen the owner happened to use decided whether the two agreed.
     *
     * Found by `booking_id` rather than `bookings.invoice_id`, which is null on
     * real rows — the link is written on the invoice, not on the booking.
     *
     * Non-blocking: the booking update has already succeeded and is what the
     * owner asked for; a settlement that fails is logged, not thrown.
     */
    if (!result.error && bookingUpdateData.payment_status === 'paid') {
      const { data: openInvoices, error: lookupError } = await supabaseServer
        .from('payment_invoices')
        // `contact_id`, `amount` and `currency` as well as the id: the
        // settlement records a payment, and a payment needs a payer and a sum.
        .select('id, contact_id, amount, currency, invoice_number')
        .eq('user_id', user.id)
        .eq('booking_id', bookingId)
        .in('status', [...ISSUED_INVOICE_STATUSES]);

      if (lookupError) {
        requestLogger.warn({ err: lookupError, bookingId }, 'Could not look up the booking\'s invoice');
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE SAME SETTLEMENT THE PROCESSOR USES.
       *
       * This called `paymentInvoiceRepository.markAsPaid`, which updates
       * `payment_invoices` and nothing else. The mark-paid route and every
       * processor path go through `settleInvoicePaid`, which ALSO writes a
       * `payment_transactions` row. Two ways to settle an invoice, and only one
       * of them recorded that money had arrived.
       *
       * That row is not bookkeeping. `promote_contact_on_payment` is a trigger
       * ON `payment_transactions` — money arriving is what makes someone a
       * client — so an invoice settled through this path left the contact
       * stranded at whatever stage they were in. A quoted job's deposit was
       * collected, the client stayed "Qualified", and nothing in the pipeline
       * showed the business had won the work.
       *
       * It also left the invoice paid with no payment behind it, which the
       * settlement helper explicitly refuses to allow and the money reports
       * read as a discrepancy.
       *
       * One path, so manual money and processor money are recorded identically.
       */
      for (const invoice of openInvoices ?? []) {
        try {
          await settleInvoicePaid(supabaseServer, {
            invoiceId: invoice.id,
            userId: user.id,
            contactId: invoice.contact_id,
            amount: invoice.amount,
            currency: invoice.currency,
            // Money that arrived outside any processor — a transfer, cash, a
            // card read in the room. Exactly what `mark-paid` records by hand.
            paymentMethod: 'manual',
            processorType: 'manual',
            // No Stripe account was involved, and saying so explicitly is what
            // stops the refund path trying to return money through one.
            accountContext: {
              stripe_connect_account_id: null,
              charge_account_kind: 'platform',
              account_resolution: 'recorded',
            },
            description: `Invoice ${invoice.invoice_number}`,
            metadata: { source: 'booking_marked_paid' },
          });

          requestLogger.info({ bookingId, invoiceId: invoice.id }, 'Invoice settled from the booking');
        } catch (err) {
          requestLogger.warn(
            { err, bookingId, invoiceId: invoice.id },
            'Booking marked paid but its invoice could not be settled'
          );
        }
      }
    }

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

    /*
     * What changed, on the contact's timeline.
     *
     * The client-facing reschedule link records the move; the owner moving the
     * same appointment from the dashboard recorded nothing, so half the changes
     * to a booking were invisible depending on who made them.
     *
     * A time change and a cancellation are different events and read as
     * different sentences. Anything else about the booking is not worth a row.
     */
    if (oldBooking?.contact_id) {
      const { data: ownerProfile } = await supabaseServer
        .from('business_profiles')
        .select('language')
        .eq('user_id', user.id)
        .maybeSingle();
      const ownerLocale = ownerProfile?.language || 'en';
      const zone = result.data.timezone || oldBooking.timezone || undefined;

      const movedTo = validated.start_time && validated.start_time !== oldBooking.start_time
        ? result.data.start_time
        : null;

      /*
       * A status move is its own event, and each one reads differently.
       *
       * "Completed", "no show" and "cancelled" are the three outcomes an owner
       * audits a client on — a no-show in particular is the thing they want to
       * see a pattern of — so each gets its own row and its own sentence rather
       * than a generic "booking updated".
       *
       * Only a real transition: re-saving a booking that was already completed
       * writes nothing.
       */
      const STATUS_EVENTS: Record<string, string> = {
        cancelled: 'booking_cancelled',
        completed: 'booking_completed',
        no_show: 'booking_no_show',
        confirmed: 'booking_confirmed',
      };
      const statusMoved =
        validated.status &&
        validated.status !== oldBooking.status &&
        STATUS_EVENTS[validated.status]
          ? validated.status
          : null;

      const when = activityMoment(oldBooking.start_time, ownerLocale, zone) || '';

      if (movedTo) {
        crmActivityRepository.create({
          user_id: user.id,
          contact_id: oldBooking.contact_id,
          activity_type: 'booking_rescheduled',
          title: activitySentence('booking_rescheduled', {
            from: when,
            to: activityMoment(movedTo, ownerLocale, zone) || '',
          }, ownerLocale),
          description: JSON.stringify({
            kind: 'booking_rescheduled',
            from: oldBooking.start_time,
            to: movedTo,
            timeZone: zone,
          }),
          auto_logged: true,
          source_capability: 'scheduling',
          source_entity_id: bookingId,
          activity_date: movedTo,
        }).catch(err => requestLogger.warn({ err }, 'Reschedule activity logging failed (non-blocking)'));
      }

      if (statusMoved) {
        const kind = STATUS_EVENTS[statusMoved];
        crmActivityRepository.create({
          user_id: user.id,
          contact_id: oldBooking.contact_id,
          activity_type: kind,
          title: activitySentence(kind, { date: when }, ownerLocale),
          description: JSON.stringify({
            kind,
            from: oldBooking.start_time,
            previousStatus: oldBooking.status,
            reason: validated.cancellation_reason || undefined,
            timeZone: zone,
          }),
          auto_logged: true,
          source_capability: 'scheduling',
          source_entity_id: bookingId,
          activity_date: oldBooking.start_time || undefined,
        }).catch(err => requestLogger.warn({ err }, 'Booking-status activity logging failed (non-blocking)'));
      }
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

    if (timeActuallyChanged) {
      /*
       * ─────────────────────────────────────────────────────────────────────
       * A RESCHEDULE THAT SENDS NOTHING MUST SAY SO.
       *
       * Two faults, and together they made moving a booking look like it had
       * told the client when it had not.
       *
       *  1. `.catch()` only fires on a THROWN error, and
       *     `sendRescheduledEmail` does not throw when it refuses — it RETURNS
       *     `{ sent: false, error }` at three exits: booking not found, no
       *     client email, service not found. Every one of those passed through
       *     the catch untouched and nothing was logged at all. This is the
       *     same trap the intake block below already documents, fixed there
       *     and not here.
       *
       *  2. The send was gated on `status === 'confirmed' && contact_id`, and
       *     a booking failing either was skipped in silence. A pending booking
       *     is still a time a client is holding; moving it without a word is
       *     the worst version of this, because the client keeps the old one.
       *
       * The gate stays — a booking with no contact has nobody to write to —
       * but every path now says what it did, so "the client got no email" is
       * answerable from the log instead of being invisible.
       */
      const notifiable = result.data.status !== 'cancelled' && Boolean(result.data.contact_id);

      if (!notifiable) {
        requestLogger.warn(
          { bookingId, status: result.data.status, hasContact: Boolean(result.data.contact_id) },
          'Booking time changed but the client was not emailed'
        );
      } else {
        BookingEmailService.sendRescheduledEmail(
          bookingId,
          user.id,
          new Date(oldBooking.start_time)
        )
          .then(emailResult => {
            if (emailResult.sent) {
              requestLogger.info({ bookingId }, 'Reschedule email sent');
            } else {
              requestLogger.warn(
                { bookingId, reason: emailResult.error },
                'Reschedule email refused'
              );
            }
          })
          .catch(err => requestLogger.error({ err, bookingId }, 'Reschedule email threw'));
      }
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

      /*
       * MANUAL: the owner ticked "send the intake form" on this booking.
       *
       * Two faults here, and together they made the toggle look like it worked
       * while sending nothing:
       *
       *  1. Called without `manual`, so it consulted `send_after_booking` — the
       *     "send it for me automatically" switch. An owner who had turned that
       *     off, and was therefore using this toggle precisely because they send
       *     by hand, was refused.
       *
       *  2. `.catch()` only catches a THROWN error. `sendIntakeFormRequest`
       *     RETURNS `{ sent: false }` on refusal, so the failure passed through
       *     the catch untouched and nothing was logged at all. The booking still
       *     gained its intake step, so the journey said a form had been
       *     requested when none had left the building.
       */
      BookingEmailService.sendIntakeFormRequest(bookingId, user.id, { manual: true })
        .then(result => {
          if (!result.sent) {
            requestLogger.error(
              { bookingId, reason: result.error },
              'Intake form was requested on this booking but the email did not send'
            );
          }
        })
        .catch(err => requestLogger.error({ err, bookingId }, 'Intake form request email threw'));
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
