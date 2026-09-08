/**
 * What it means to cancel a booking — in one place, for every caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Cancelling is not a status update. It is a status update AND removing the
 * appointment from the owner's calendar AND telling the client not to come.
 * Miss either of the last two and the database says "cancelled" while the
 * calendar still shows the slot and the client still turns up.
 *
 * That sequence lived inside `POST /api/scheduling/bookings/[id]/cancel`, so
 * only an HTTP caller got it. The chat cancelled through
 * `schedulingBookingRepository.cancel()` directly — which is just the update —
 * and so cancelled bookings silently, leaving the calendar and the client
 * untouched. Same verb, two different meanings, depending on which door you
 * came in through.
 *
 * So the sequence moved here and both doors call it. The rule this encodes:
 * anything a write MUST do to be true belongs below the route, never inside it.
 *
 * SIDE EFFECTS ARE AWAITED, not fired and forgotten. The route used to hand the
 * calendar delete and the email to floating promises after the response — on
 * serverless that is a race against the function freezing, and it is exactly the
 * work that must not be lost. Each is caught individually: a booking that is
 * cancelled but whose email bounced is a cancelled booking, and reporting
 * failure would be worse than the truth.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/BookingLifecycleService
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  schedulingBookingRepository,
  schedulingServiceRepository,
  type SchedulingBooking,
  type SchedulingService,
  type SchedulingRepositoryResult,
} from '@/lib/repositories/SchedulingRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { CalendarSyncService } from '@/lib/services/CalendarSyncService';
import { BookingEmailService } from '@/lib/services/BookingEmailService';
import {
  paymentInvoiceRepository,
  stripeConnectRepository,
  type PaymentInvoice,
} from '@/lib/repositories/PaymentRepository';
import { getStripeInvoiceService } from '@/lib/stripe/StripeInvoiceService';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { emitPaymentEvent } from '@/lib/services/PaymentEventService';

const logger = createLogger({ service: 'BookingLifecycleService' });
const auditTrail = AuditTrailService.getInstance();

/** Just enough of a Pino logger for a caller to pass its correlated child. */
type ContextLogger = {
  debug: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
};

export interface CancelBookingParams {
  bookingId: string;
  userId: string;
  reason?: string;
  /**
   * The originating HTTP request, when there is one. Only the audit trail uses
   * it — to record IP and user agent. Absent for the chat, which is a legitimate
   * caller rather than a degraded one.
   */
  request?: NextRequest;
  /** A caller's correlated child logger, so one cancellation reads as one story. */
  logger?: ContextLogger;
}

/** What actually happened to each side effect, so a caller can say so. */
export interface CancelBookingOutcome {
  booking: SchedulingBooking;
  calendarEventRemoved: boolean;
  clientNotified: boolean;
}

/**
 * Cancel a booking and make the cancellation real.
 *
 * The status update is the only step allowed to fail the operation: if the row
 * did not change, nothing was cancelled and there is nothing to notify anyone
 * about. Everything after it is best effort and reported in the outcome.
 */
export async function cancelBooking(
  params: CancelBookingParams
): Promise<SchedulingRepositoryResult<CancelBookingOutcome>> {
  const { bookingId, userId, reason, request } = params;
  const log = params.logger ?? logger;

  log.info({ bookingId, userId, reason }, 'Cancelling booking');

  const result = await schedulingBookingRepository.cancel(bookingId, userId, reason);

  if (result.error) return { data: null, error: result.error };
  if (!result.data) {
    return { data: null, error: new Error('Booking not found') };
  }

  const booking = result.data;

  // The client's own name, for the audit entry. A failure here must not stop a
  // cancellation that has already happened, so it degrades to 'Client'.
  let contactName = 'Client';
  if (booking.contact_id) {
    const contactResult = await crmContactRepository.findById(booking.contact_id, userId);
    if (contactResult.data) {
      contactName =
        `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim() ||
        'Client';
    }
  }

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_CANCELLED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: `Booking for ${contactName}`,
      // `details`, not `metadata` — the audit input has no `metadata` field, so
      // the reason passed under that name was being dropped on the floor.
      details: { reason },
      request,
    })
    .catch(err => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  // Only bookings that reached an external calendar have an event to remove.
  //
  // Both services below REPORT failure rather than throwing it, so the try/catch
  // is for the unexpected and the returned flag is what actually decides the
  // outcome. Trusting the absence of a throw would report every failed delete as
  // a success — which is the class of bug this whole module exists to end.
  let calendarEventRemoved = false;
  if (booking.external_calendar_event_id) {
    try {
      const sync = await CalendarSyncService.deleteCalendarEvent(booking, userId);
      calendarEventRemoved = sync.success;
      if (!sync.success) {
        log.warn({ bookingId, error: sync.error }, 'Calendar event delete failed');
      }
    } catch (err) {
      log.warn({ err, bookingId }, 'Calendar event delete threw');
    }
  }

  let clientNotified = false;
  try {
    const email = await BookingEmailService.sendCancellationEmail(bookingId, userId, reason);
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId, error: email.error }, 'Cancellation email not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId }, 'Cancellation email threw');
  }

  log.info(
    { bookingId, userId, calendarEventRemoved, clientNotified },
    'Booking cancelled'
  );

  return {
    data: { booking, calendarEventRemoved, clientNotified },
    error: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * CREATING A BOOKING
 *
 * Same argument as cancelling, with more at stake. Creating a booking is not an
 * insert: it is a conflict check, an insert, a calendar event, an invoice, and a
 * confirmation to the client. A row written without those is an appointment that
 * exists only in the database — absent from the owner's calendar, possibly
 * double-booked, unbilled, and unknown to the person expected to attend.
 *
 * The route did all of it and the chat could not book at all, which was the
 * honest state of affairs. Declaring `bookings.create` against the repository
 * would have been the dishonest one.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The requested time cannot be given away.
 *
 * A distinct type because it is the one create failure that is not an error in
 * the system — the caller asked for something legitimate that is already taken,
 * and both callers need to say which, in their own words: the route as a 409,
 * the chat as a sentence offering another time.
 */
export class BookingSlotUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'overlap' | 'external_calendar',
    readonly conflictingBooking?: {
      id: string;
      start_time: string;
      end_time: string;
      status: string;
    }
  ) {
    super(message);
    this.name = 'BookingSlotUnavailableError';
  }
}

export interface CreateBookingParams {
  userId: string;
  serviceId: string;
  /** Already resolved and verified to belong to this user. */
  contactId: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  notes?: string;
  bookingSource?: string;
  /** Raise an invoice when the service is priced. Defaults to true. */
  createInvoice?: boolean;
  sendIntakeForm?: boolean;
  /**
   * The contact's name and email, when the caller already has them. Looked up
   * from `contactId` otherwise, so a caller that only knows the id — the chat —
   * still gets a correctly addressed invoice and confirmation.
   */
  contactName?: string;
  contactEmail?: string | null;
  request?: NextRequest;
  logger?: ContextLogger;
}

export interface CreateBookingOutcome {
  booking: SchedulingBooking;
  invoice: PaymentInvoice | null;
  calendarSynced: boolean;
  clientNotified: boolean;
}

/**
 * Create a booking and everything that makes it a real appointment.
 *
 * Fails the whole operation only for the things that must not be papered over:
 * a conflicting slot, and the insert itself. An invoice or an email that fails
 * afterwards leaves a booking that genuinely exists, and is reported rather than
 * rolled back.
 */
export async function createBooking(
  params: CreateBookingParams
): Promise<SchedulingRepositoryResult<CreateBookingOutcome>> {
  const {
    userId,
    serviceId,
    contactId,
    startTime,
    endTime,
    timezone,
    notes,
    bookingSource,
    createInvoice = true,
    sendIntakeForm = false,
    request,
  } = params;
  const log = params.logger ?? logger;

  log.info({ userId, serviceId, contactId, startTime }, 'Creating booking');

  // 1. The slot must be free — of this user's own bookings, and of anything in
  //    the calendar they actually live by. Both refuse the booking outright:
  //    double-booking someone is not a warning.
  const overlapCheck = await schedulingBookingRepository.checkOverlap(userId, startTime, endTime);

  if (overlapCheck.error) {
    return { data: null, error: overlapCheck.error };
  }

  if (overlapCheck.data && overlapCheck.data.length > 0) {
    const conflict = overlapCheck.data[0];
    log.warn({ userId, conflictingBookingId: conflict.id, startTime }, 'Double booking attempt');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        `This time overlaps an existing booking at ${new Date(conflict.start_time).toISOString()}`,
        'overlap',
        {
          id: conflict.id,
          start_time: conflict.start_time,
          end_time: conflict.end_time,
          status: conflict.status,
        }
      ),
    };
  }

  const isBlockedByExternal = await CalendarSyncService.isSlotBlockedByExternalEvent(
    userId,
    startTime,
    endTime
  );

  if (isBlockedByExternal) {
    log.warn({ userId, startTime }, 'Booking blocked by external calendar event');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        'This time is blocked by an event in your external calendar',
        'external_calendar'
      ),
    };
  }

  // 2. Insert.
  const result = await schedulingBookingRepository.create({
    user_id: userId,
    service_id: serviceId,
    contact_id: contactId,
    start_time: startTime,
    end_time: endTime,
    timezone,
    notes,
    booking_source: bookingSource,
  } as Parameters<typeof schedulingBookingRepository.create>[0]);

  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: new Error('Failed to create booking') };

  const booking = result.data;

  // 3. Who the booking is for — needed by the invoice and the confirmation, so
  //    it is resolved rather than assumed when the caller did not supply it.
  let contactName = params.contactName ?? '';
  let contactEmail = params.contactEmail ?? null;

  if (!contactName || contactEmail === null) {
    const contactResult = await crmContactRepository.findById(contactId, userId);
    if (contactResult.data) {
      contactName =
        contactName ||
        `${contactResult.data.first_name || ''} ${contactResult.data.last_name || ''}`.trim();
      contactEmail = contactEmail ?? contactResult.data.email ?? null;
    }
  }

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_CREATED',
      userId,
      entityType: 'scheduling_booking',
      entityId: booking.id,
      resourceName: `Booking for ${contactName || 'Client'}`,
      details: { service_id: serviceId, contact_id: contactId, start_time: startTime },
      request,
    })
    .catch(err => log.warn({ err, bookingId: booking.id }, 'Audit failed (non-blocking)'));

  const serviceResult = await schedulingServiceRepository.findById(serviceId, userId);
  const service = serviceResult.data;

  // 4. Put it in the calendar the owner actually looks at.
  let calendarSynced = false;
  if (service) {
    try {
      const sync = await CalendarSyncService.syncBookingToCalendar(booking, service, userId);
      calendarSynced = sync.success;
      if (!sync.success) {
        /*
         * "Not connected" is not a failure.
         *
         * Most businesses have never linked a calendar, so every booking they
         * made logged a warning saying calendar sync had failed — for a feature
         * they never switched on. A warning that fires on the normal path stops
         * being read, and takes the real ones with it.
         */
        const notConfigured = sync.error === 'Calendar sync not enabled';
        if (notConfigured) {
          log.debug({ bookingId: booking.id }, 'No calendar connected; skipping sync');
        } else {
          log.warn({ bookingId: booking.id, error: sync.error }, 'Calendar sync failed');
        }
      }
    } catch (err) {
      log.warn({ err, bookingId: booking.id }, 'Calendar sync threw');
    }
  }

  // 5. Bill for it, when there is something to bill. A failure here is logged
  //    and reported, never fatal — the appointment stands either way.
  let invoice: PaymentInvoice | null = null;
  const shouldInvoice = !!service && !!service.price && service.price > 0 && createInvoice;

  if (shouldInvoice) {
    try {
      invoice = await createBookingInvoice(
        userId,
        booking.id,
        service!,
        {
          contact_id: contactId,
          contact_name: contactName || 'Client',
          contact_email: contactEmail,
          start_time: startTime,
        },
        log
      );
    } catch (err) {
      log.warn({ err, bookingId: booking.id }, 'Failed to create invoice for booking');
    }
  }

  // 6. A paid booking makes someone a client rather than a lead. Non-blocking:
  //    a pipeline stage is bookkeeping, not part of the appointment.
  if (shouldInvoice) {
    crmPipelineStagesRepository
      .findActiveClientStage(userId)
      .then(async stageResult => {
        if (stageResult.data) {
          await crmContactRepository.updateStage(contactId, userId, stageResult.data.stage_key);
          log.info(
            { contactId, newStage: stageResult.data.stage_key },
            'Contact moved to active client stage for paid booking'
          );
        }
      })
      .catch(err => log.warn({ err, contactId }, 'Failed to update contact stage'));
  }

  // 7. Tell the client. `skipInvoice` because step 5 already raised and sent it;
  //    the payment link travels with the confirmation instead of separately.
  let clientNotified = false;
  try {
    const email = await BookingEmailService.sendBookingConfirmation(booking.id, userId, {
      skipInvoice: true,
      invoiceId: invoice?.id,
      stripeHostedInvoiceUrl: invoice?.stripe_hosted_invoice_url || undefined,
    });
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId: booking.id, error: email.error }, 'Confirmation email not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId: booking.id }, 'Confirmation email threw');
  }

  // 8. Intake form, when asked for. The empty `intake_responses` is what makes
  //    the journey timeline show "intake pending" rather than nothing.
  if (sendIntakeForm) {
    await schedulingBookingRepository.update(booking.id, userId, {
      intake_responses: { template_id: '', template_key: 'pending', responses: {} },
    });

    /*
     * `manual`, because the OWNER asked for this one.
     *
     * `send_after_booking` answers a different question — "send it for me
     * automatically, for bookings clients make themselves". A business that
     * sends intake by hand has that switch off, and reading it here refused
     * the exact act the toggle in the booking dialog exists to perform: the
     * owner ticked "send intake form", the booking confirmation arrived, and
     * the intake email was silently skipped.
     *
     * The client-booking routes (`website/booking/create`, `finalize`) stay
     * automatic — nobody is present there to press anything.
     */
    BookingEmailService.sendIntakeFormRequest(booking.id, userId, { manual: true }).catch(err =>
      log.warn({ err, bookingId: booking.id }, 'Intake form request email failed')
    );
  }

  log.info(
    { bookingId: booking.id, userId, calendarSynced, clientNotified, invoiceId: invoice?.id },
    'Booking created'
  );

  return {
    data: { booking, invoice, calendarSynced, clientNotified },
    error: null,
  };
}

/**
 * Raise the invoice for a booking, through Stripe when the business is set up
 * for it and locally when it is not.
 *
 * Moved verbatim from the bookings route so that a booking made from the chat is
 * billed exactly like one made from the dashboard. Throws on the local insert —
 * an unbilled booking should be reported — but swallows Stripe failures, since a
 * local invoice the owner can chase is a working outcome.
 */
/**
 * Raise the invoice for a booking.
 *
 * Exported because the WEBSITE booking flow needs it too. A service set to
 * `collection: 'invoice'` took no money online, and the public route raised no
 * invoice at all — so a ₪200 booking was marked paid, billed nobody, and the
 * client received a confirmation with nothing to pay against. This is the one
 * producer of booking invoices; there must not be a second.
 */
export async function createBookingInvoice(
  userId: string,
  bookingId: string,
  service: SchedulingService,
  bookingData: {
    contact_id: string;
    contact_name: string;
    contact_email: string | null;
    start_time: string;
  },
  log: ContextLogger
): Promise<PaymentInvoice> {
  const invoiceNumberResult = await paymentInvoiceRepository.getNextInvoiceNumber(userId);
  if (invoiceNumberResult.error) {
    throw invoiceNumberResult.error;
  }

  // Payable by the time the service happens.
  const dueDate = new Date(bookingData.start_time).toISOString().split('T')[0];

  const invoiceResult = await paymentInvoiceRepository.create({
    user_id: userId,
    contact_id: bookingData.contact_id,
    booking_id: bookingId, // Links payment status back to the booking.
    service_id: service.id, // What was billed, for the revenue-by-service breakdown.
    invoice_number: invoiceNumberResult.data!,
    amount: service.price!,
    currency: service.currency,
    status: 'sent',
    client_name: bookingData.contact_name || null,
    client_email: bookingData.contact_email || null,
    line_items: [
      {
        description: service.service_name,
        quantity: 1,
        unit_price: service.price!,
        total: service.price!,
      },
    ],
    due_date: dueDate,
    payment_terms: 'Due on service date',
    notes: `Booking for ${bookingData.contact_name}`,
    internal_notes: `Auto-generated for booking ${bookingId}`,
    sent_at: new Date().toISOString(),
    paid_at: null,
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
    next_retry_at: null,
  } as Parameters<typeof paymentInvoiceRepository.create>[0]);

  if (invoiceResult.error) {
    throw invoiceResult.error;
  }

  let invoice = invoiceResult.data!;

  const stripeAccountResult = await stripeConnectRepository.findByUserId(userId);
  const stripeAccount = stripeAccountResult.data;

  if (
    stripeAccount?.stripe_account_id &&
    stripeAccount.charges_enabled &&
    bookingData.contact_email
  ) {
    try {
      log.info(
        { invoiceId: invoice.id, stripeAccountId: stripeAccount.stripe_account_id },
        'Creating Stripe invoice for booking'
      );

      const stripeInvoiceService = getStripeInvoiceService();

      const stripeInvoice = await stripeInvoiceService.createInvoice({
        connectAccountId: stripeAccount.stripe_account_id,
        customerEmail: bookingData.contact_email,
        customerName: bookingData.contact_name || 'Client',
        lineItems: [
          {
            description: service.service_name,
            quantity: 1,
            unit_price: Math.round(service.price! * 100), // Stripe works in cents.
            total: Math.round(service.price! * 100),
          },
        ],
        dueDate: new Date(bookingData.start_time),
        currency: service.currency.toLowerCase(),
        description: `Invoice for ${service.service_name}`,
        metadata: {
          neuronforge_invoice_id: invoice.id,
          booking_id: bookingId,
          invoice_number: invoice.invoice_number,
        },
      });

      // Finalizes and emails it.
      const sentStripeInvoice = await stripeInvoiceService.sendInvoice(
        stripeInvoice.invoiceId,
        stripeAccount.stripe_account_id
      );

      const updateResult = await paymentInvoiceRepository.updateStripeFields(invoice.id, userId, {
        stripe_invoice_id: sentStripeInvoice.invoiceId,
        stripe_hosted_invoice_url: sentStripeInvoice.hostedInvoiceUrl || undefined,
        stripe_invoice_pdf: sentStripeInvoice.invoicePdf || undefined,
      });

      if (updateResult.data) {
        invoice = updateResult.data;
      }

      log.info(
        { invoiceId: invoice.id, stripeInvoiceId: sentStripeInvoice.invoiceId },
        'Stripe invoice created and sent for booking'
      );
    } catch (stripeError) {
      // The local invoice is still valid and still owed.
      log.error(
        { err: stripeError, invoiceId: invoice.id },
        'Failed to create Stripe invoice, falling back to local invoice'
      );
    }
  } else {
    log.debug(
      {
        invoiceId: invoice.id,
        hasStripeAccount: !!stripeAccount?.stripe_account_id,
        chargesEnabled: stripeAccount?.charges_enabled,
        hasEmail: !!bookingData.contact_email,
      },
      'Skipping Stripe invoice (not configured or missing email)'
    );
  }

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
      stripeInvoiceId: invoice.stripe_invoice_id || undefined,
    },
  });

  paymentReminderService
    .scheduleInvoiceReminders(userId, invoice.id, bookingData.contact_id, dueDate)
    .catch(err => log.warn({ err, invoiceId: invoice.id }, 'Failed to schedule invoice reminders'));

  return invoice;
}

/* ────────────────────────────────────────────────────────────────────────────
 * MOVING A BOOKING
 *
 * Same argument once more. Changing `start_time` is not rescheduling: the
 * calendar still holds the old slot and the client still arrives at the old
 * time. Both of those are what "rescheduled" means to the two people involved.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RescheduleBookingParams {
  bookingId: string;
  userId: string;
  startTime: string;
  endTime: string;
  request?: NextRequest;
  logger?: ContextLogger;
}

export interface RescheduleBookingOutcome {
  booking: SchedulingBooking;
  previousStart: string;
  calendarUpdated: boolean;
  clientNotified: boolean;
}

/**
 * Move a booking to a new time.
 *
 * Refuses a slot that is already taken, for the same reason `createBooking`
 * does — moving an appointment on top of another one is a double booking that
 * happens to have arrived by a different route. The booking's own row is
 * excluded from that check, or every reschedule would collide with itself.
 */
export async function rescheduleBooking(
  params: RescheduleBookingParams
): Promise<SchedulingRepositoryResult<RescheduleBookingOutcome>> {
  const { bookingId, userId, startTime, endTime, request } = params;
  const log = params.logger ?? logger;

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  const previousStart = existing.data.start_time;

  // Unchanged times are a no-op, not a reschedule: emailing a client to tell
  // them nothing moved is worse than doing nothing.
  if (
    new Date(previousStart).getTime() === new Date(startTime).getTime() &&
    new Date(existing.data.end_time).getTime() === new Date(endTime).getTime()
  ) {
    return {
      data: {
        booking: existing.data,
        previousStart,
        calendarUpdated: false,
        clientNotified: false,
      },
      error: null,
    };
  }

  const overlap = await schedulingBookingRepository.checkOverlap(userId, startTime, endTime);
  if (overlap.error) return { data: null, error: overlap.error };

  const clash = (overlap.data ?? []).find((b) => b.id !== bookingId);
  if (clash) {
    log.warn({ userId, bookingId, conflictingBookingId: clash.id }, 'Reschedule would double-book');
    return {
      data: null,
      error: new BookingSlotUnavailableError(
        `That time overlaps an existing booking at ${new Date(clash.start_time).toISOString()}`,
        'overlap',
        {
          id: clash.id,
          start_time: clash.start_time,
          end_time: clash.end_time,
          status: clash.status,
        }
      ),
    };
  }

  const result = await schedulingBookingRepository.update(bookingId, userId, {
    start_time: startTime,
    end_time: endTime,
  });

  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: new Error('Booking not found') };

  const booking = result.data;

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_RESCHEDULED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: `Booking moved to ${startTime}`,
      details: { from: previousStart, to: startTime },
      request,
    })
    .catch((err) => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  let calendarUpdated = false;
  if (booking.external_calendar_event_id) {
    try {
      const service = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (service.data) {
        const sync = await CalendarSyncService.updateCalendarEvent(booking, service.data, userId);
        calendarUpdated = sync.success;
        if (!sync.success) {
          log.warn({ bookingId, error: sync.error }, 'Calendar event update failed');
        }
      }
    } catch (err) {
      log.warn({ err, bookingId }, 'Calendar event update threw');
    }
  }

  // The client is told what changed, so the email needs the OLD time.
  let clientNotified = false;
  try {
    const email = await BookingEmailService.sendRescheduledEmail(
      bookingId,
      userId,
      new Date(previousStart)
    );
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId, error: email.error }, 'Reschedule email not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId }, 'Reschedule email threw');
  }

  log.info({ bookingId, userId, calendarUpdated, clientNotified }, 'Booking rescheduled');

  return {
    data: { booking, previousStart, calendarUpdated, clientNotified },
    error: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * DELETING A BOOKING
 *
 * Distinct from cancelling, and rarer. Cancelling keeps the record and tells the
 * client; deleting removes it as if it never happened, which is only right for
 * something entered by mistake.
 *
 * Money is what makes it dangerous. `payment_invoices.booking_id` is ON DELETE
 * SET NULL, so an invoice OUTLIVES its booking as an orphan — still owed, still
 * payable through its Stripe link, and no longer traceable to anything. So an
 * unpaid invoice goes with the booking, and a paid one blocks the delete
 * outright: money that changed hands is a record to refund deliberately, not to
 * erase.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Raised when the booking has been paid for, which forbids deleting it. */
export class BookingPaidError extends Error {
  constructor(
    readonly invoiceNumbers: string[],
    readonly paidAmount: number
  ) {
    super(
      'This booking has already been paid for and cannot be deleted. ' +
        'Refund the payment first, or cancel the booking instead.'
    );
    this.name = 'BookingPaidError';
  }
}

export interface DeleteBookingOutcome {
  bookingId: string;
  deletedInvoices: string[];
}

export async function deleteBooking(params: {
  bookingId: string;
  userId: string;
  request?: NextRequest;
  logger?: ContextLogger;
}): Promise<SchedulingRepositoryResult<DeleteBookingOutcome>> {
  const { bookingId, userId, request } = params;
  const log = params.logger ?? logger;

  const { isSettledInvoice } = await import('@/lib/payments/invoiceSettlement');
  const { paymentTransactionRepository } = await import('@/lib/repositories/PaymentRepository');
  const { deleteInvoice } = await import('@/lib/payments/invoiceLifecycle');

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  const invoicesResult = await paymentInvoiceRepository.findByBookingId(bookingId, userId);
  if (invoicesResult.error) return { data: null, error: invoicesResult.error as Error };

  const bookingInvoices = invoicesResult.data || [];

  const { bookingPaymentState } = await import('@/lib/payments/bookingPaymentState');

  /*
   * Does this booking still HOLD money?
   *
   * It used to ask `payment_status === 'refunded'`, which only the booking
   * refund route ever writes. So money refunded from the money list, the CRM
   * drawer, or the Stripe dashboard left the booking reading `paid` and this
   * guard refused the delete, telling the owner to "refund the payment first"
   * about money already returned.
   *
   * Derived from the payments themselves instead, which every refund path
   * updates by trigger. `netHeld` also gets partial refunds right: a booking
   * with £40 of £100 returned is still holding £60 and is still undeletable.
   */
  const settledResult = await paymentTransactionRepository.findSettledForBooking(
    bookingId,
    bookingInvoices.map((inv) => inv.id),
    userId
  );
  if (settledResult.error) return { data: null, error: settledResult.error as Error };
  const settledPayments = settledResult.data || [];

  const money = bookingPaymentState(settledPayments);

  /*
   * An invoice marked paid with no payment recorded against it still counts.
   *
   * Marking an invoice paid by hand is a normal thing to do, and the money is
   * just as real for having arrived by bank transfer. Its refunded amount is
   * derived by trigger, so the same subtraction applies.
   */
  const invoiceHeld = bookingInvoices
    .filter(isSettledInvoice)
    .filter((inv) => !settledPayments.some((t) => t.invoice_id === inv.id))
    .reduce(
      (sum, inv) => sum + Math.max(0, (Number(inv.amount) || 0) - (Number(inv.refunded_amount) || 0)),
      0
    );

  const heldAmount = Math.round((money.netHeld + invoiceHeld) * 100) / 100;

  if (heldAmount > 0) {
    const paidInvoices = bookingInvoices.filter(isSettledInvoice);
    const paidAmount = heldAmount;

    log.info({ userId, bookingId }, 'Refused to delete a booking that has been paid for');

    return {
      data: null,
      error: new BookingPaidError(
        paidInvoices.map((inv) => inv.invoice_number),
        paidAmount
      ),
    };
  }

  // Nothing is owed and nothing is held: drop the OPEN invoices raised for this
  // booking, voiding each at the processor first so nobody can still open the
  // hosted page and pay for a session that no longer exists.
  const openInvoices = bookingInvoices.filter((inv) => !isSettledInvoice(inv));
  const deletedInvoices: string[] = [];

  for (const invoice of openInvoices) {
    const removed = await deleteInvoice({ invoiceId: invoice.id, userId, request });
    if (removed.error) return { data: null, error: removed.error };
    deletedInvoices.push(invoice.invoice_number);
  }

  const result = await schedulingBookingRepository.delete(bookingId, userId);
  if (result.error) return { data: null, error: result.error };

  auditTrail
    .log({
      action: 'SCHEDULING_BOOKING_DELETED',
      userId,
      entityType: 'scheduling_booking',
      entityId: bookingId,
      resourceName: `Booking ${bookingId}`,
      details: { deletedInvoices },
      severity: 'warning',
      request,
    })
    .catch((err) => log.warn({ err, bookingId }, 'Audit failed (non-blocking)'));

  log.info({ bookingId, userId, deletedInvoices: deletedInvoices.length }, 'Booking deleted');

  return { data: { bookingId, deletedInvoices }, error: null };
}

/**
 * Ask the client to fill in the intake form for their appointment.
 *
 * The empty `intake_responses` is not decoration: it is what makes the journey
 * timeline show "intake pending" rather than nothing, so the owner can see they
 * are waiting on the client.
 */
export async function sendIntakeForm(params: {
  bookingId: string;
  userId: string;
  logger?: ContextLogger;
}): Promise<SchedulingRepositoryResult<{ bookingId: string; clientNotified: boolean }>> {
  const { bookingId, userId } = params;
  const log = params.logger ?? logger;

  const existing = await schedulingBookingRepository.findById(bookingId, userId);
  if (existing.error) return { data: null, error: existing.error };
  if (!existing.data) return { data: null, error: new Error('Booking not found') };

  if (existing.data.intake_completed_at) {
    return {
      data: null,
      error: new Error('The client has already completed the intake form for this booking.'),
    };
  }

  if (!existing.data.intake_responses) {
    await schedulingBookingRepository.update(bookingId, userId, {
      intake_responses: { template_id: '', template_key: 'pending', responses: {} },
    });
  }

  let clientNotified = false;
  try {
    // The owner (or the assistant on their behalf) pressed Send — manual, for
    // the same reason as the creation path above.
    const email = await BookingEmailService.sendIntakeFormRequest(bookingId, userId, {
      manual: true,
    });
    clientNotified = email.sent;
    if (!email.sent) {
      log.warn({ bookingId, error: email.error }, 'Intake form request not sent');
    }
  } catch (err) {
    log.warn({ err, bookingId }, 'Intake form request threw');
  }

  log.info({ bookingId, userId, clientNotified }, 'Intake form requested');

  return { data: { bookingId, clientNotified }, error: null };
}
