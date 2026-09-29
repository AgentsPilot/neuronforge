/**
 * Deleting a client, and what deleting a client costs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: the database contradicted itself and every delete 500'd.
 *
 * Two migrations disagreed, and nothing noticed for weeks:
 *
 *   · `20260727_cancel_bookings_on_contact_delete.sql` put a BEFORE DELETE
 *     trigger on `crm_contacts` that cleared the way by deleting the contact's
 *     bookings — but only `WHERE start_time > now()`.
 *   · `20260810_remove_client_fields_and_total_amount.sql` made
 *     `scheduling_bookings.contact_id` NOT NULL and left its foreign key as
 *     `ON DELETE SET NULL`.
 *
 * So for any booking the trigger did not take — one already in the past, or one
 * with no time at all — Postgres tried to write NULL into a column that forbids
 * it and refused the whole delete:
 *
 *     23502: null value in column "contact_id" of relation "scheduling_bookings"
 *            violates not-null constraint
 *
 * `NULL > now()` is NULL, never true, so a PRODUCT booking — a course, anything
 * bought without a time — blocked its client's deletion permanently. On the
 * account where this was found, that was every contact who had ever booked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES INSTEAD
 *
 * The bookings are dealt with here, in code that can be read, tested and can
 * explain itself, rather than by a trigger acting behind the application's back
 * with a rule nobody could see.
 *
 *   · Bookings that carry no money go with the contact, whatever their date.
 *   · Money stops the whole thing. A client the business has actually been paid
 *     by is a financial record, and deleting them would leave transactions
 *     pointing at nobody. The owner is told what is holding it, and the drawer
 *     already offers Deactivate for exactly this case.
 *
 * Every booking is ASKED before any is deleted. A guard that only refused when
 * it reached the paid booking would already have destroyed the two before it,
 * and there is no way back from that.
 *
 * This is the same line `deleteBooking` draws one level down, and it shares that
 * function's money test (`heldOnBooking`) rather than keeping a second opinion.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/ContactLifecycleService
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  crmContactRepository,
  type CRMContactRepositoryResult,
} from '@/lib/repositories/CRMContactRepository';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { isSettledInvoice } from '@/lib/payments/invoiceSettlement';
import { deleteInvoice } from '@/lib/payments/invoiceLifecycle';
import { deleteBooking, heldOnBooking } from '@/lib/services/BookingLifecycleService';

const logger = createLogger({ service: 'ContactLifecycleService' });

/** Just enough of a Pino logger for a caller to pass its correlated child. */
type ContextLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
};

/**
 * Deliberately generous, and deliberately not silent.
 *
 * Both repository list methods default to 50 rows. Deleting only the first 50
 * of a client's bookings and then failing on the rest is the shape of bug this
 * whole module exists to end, so the scan asks for far more than any real
 * client has and REFUSES if it comes back full rather than assuming it saw
 * everything.
 */
const SCAN_LIMIT = 200;

/**
 * Raised when the client has been paid, which forbids deleting them.
 *
 * Carries the figures rather than a sentence, because the message is shown in
 * three languages and the numbers are the only part that is not translatable.
 */
export class ContactHoldsMoneyError extends Error {
  constructor(
    readonly heldAmount: number,
    readonly bookingCount: number,
    readonly invoiceNumbers: string[]
  ) {
    super(
      'This client has payments recorded against them and cannot be deleted. ' +
        'Refund the payments first, or deactivate the client instead.'
    );
    this.name = 'ContactHoldsMoneyError';
  }
}

export interface DeleteContactOutcome {
  contactId: string;
  /** Bookings removed along with the client — none of them carried money. */
  deletedBookings: number;
  /** Invoice numbers removed with them, for the audit line. */
  deletedInvoices: string[];
}

export async function deleteContact(params: {
  contactId: string;
  userId: string;
  request?: NextRequest;
  logger?: ContextLogger;
}): Promise<CRMContactRepositoryResult<DeleteContactOutcome>> {
  const { contactId, userId, request } = params;
  const log = params.logger ?? logger;

  const bookingsResult = await schedulingBookingRepository.list(userId, {
    contactId,
    limit: SCAN_LIMIT,
  });
  if (bookingsResult.error) return { data: null, error: bookingsResult.error as Error };

  const bookings = bookingsResult.data || [];
  if (bookings.length >= SCAN_LIMIT) {
    return {
      data: null,
      error: new Error(
        `This client has more than ${SCAN_LIMIT} bookings. Delete them from the calendar first, ` +
          'so nothing is removed that you have not seen.'
      ),
    };
  }

  /*
   * Everything the client's own invoices hold, over and above their bookings'.
   *
   * An invoice raised straight against a contact has no booking to be found
   * through, and `payment_invoices.contact_id` is ON DELETE SET NULL — so
   * deleting the client would leave it standing as an orphan: still owed, still
   * payable through its hosted link, and no longer attached to anybody. Settled
   * ones are money and stop the delete; open ones go with the client, the same
   * way `deleteBooking` treats the ones it finds.
   */
  const invoicesResult = await paymentInvoiceRepository.list(userId, {
    contactId,
    limit: SCAN_LIMIT,
  });
  if (invoicesResult.error) return { data: null, error: invoicesResult.error as Error };

  const bookingIds = new Set(bookings.map((booking) => booking.id));
  const looseInvoices = (invoicesResult.data || []).filter(
    (invoice) => !invoice.booking_id || !bookingIds.has(invoice.booking_id)
  );

  /* ── Ask everything, before deleting anything ─────────────────────────── */

  let held = 0;
  let paidBookings = 0;
  const paidInvoiceNumbers: string[] = [];

  for (const booking of bookings) {
    const money = await heldOnBooking(booking.id, userId);
    if (money.error) return { data: null, error: money.error as Error };

    const amount = money.data?.heldAmount ?? 0;
    if (amount > 0) {
      held += amount;
      paidBookings += 1;
      paidInvoiceNumbers.push(
        ...(money.data?.invoices ?? []).filter(isSettledInvoice).map((inv) => inv.invoice_number)
      );
    }
  }

  for (const invoice of looseInvoices.filter(isSettledInvoice)) {
    const outstanding = Math.max(
      0,
      (Number(invoice.amount) || 0) - (Number(invoice.refunded_amount) || 0)
    );
    if (outstanding > 0) {
      held += outstanding;
      paidInvoiceNumbers.push(invoice.invoice_number);
    }
  }

  if (held > 0) {
    log.info(
      { userId, contactId, held, paidBookings },
      'Refused to delete a client who has been paid'
    );
    return {
      data: null,
      error: new ContactHoldsMoneyError(
        Math.round(held * 100) / 100,
        paidBookings,
        paidInvoiceNumbers
      ),
    };
  }

  /* ── Nothing is held: take the bookings, then the client ──────────────── */

  const deletedInvoices: string[] = [];

  for (const booking of bookings) {
    const removed = await deleteBooking({
      bookingId: booking.id,
      userId,
      request,
      logger: params.logger,
    });
    /*
     * Any failure here stops the whole delete. Some bookings may already be
     * gone, which is not ideal — but each one removed was one nothing was owed
     * on, and carrying on past an error we do not understand is how a client
     * ends up half-deleted.
     */
    if (removed.error) return { data: null, error: removed.error };
    deletedInvoices.push(...(removed.data?.deletedInvoices ?? []));
  }

  for (const invoice of looseInvoices.filter((inv) => !isSettledInvoice(inv))) {
    const removed = await deleteInvoice({ invoiceId: invoice.id, userId, request });
    if (removed.error) return { data: null, error: removed.error };
    deletedInvoices.push(invoice.invoice_number);
  }

  const result = await crmContactRepository.delete(contactId, userId);
  if (result.error) return { data: null, error: result.error };

  log.info(
    { userId, contactId, deletedBookings: bookings.length, deletedInvoices: deletedInvoices.length },
    'Contact deleted with its bookings'
  );

  return {
    data: { contactId, deletedBookings: bookings.length, deletedInvoices },
    error: null,
  };
}
