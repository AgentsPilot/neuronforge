/**
 * A package is paid for, so its meetings are on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MEETINGS WAIT FOR THE MONEY
 *
 * A package sold up front creates its meetings `pending` at acceptance. That is
 * not a formality: `pending` is a slot-holding status, so the hours are taken
 * the moment the client agrees and nobody else can book them — while the client
 * is not yet told the sessions are confirmed, because they have not paid.
 *
 * This is the other half. When the invoice settles, the meetings become
 * `confirmed` and the client is told, once, with every date in one email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A PAID INVOICE FINDS THEM
 *
 *   invoice → `proposals.created_invoice_id` → the quote
 *           → `proposals.package_booking_id` → the container
 *           → `scheduling_bookings.parent_booking_id` → the meetings
 *
 * Every link is a column written at acceptance; nothing is inferred from
 * shape. See 20261002_proposal_package_booking.sql for why the last one had to
 * exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER FATAL
 *
 * The money is recorded and the invoice is paid before this runs. A failure
 * here leaves the meetings `pending` — their slots still held, visible in the
 * owner's calendar, fixable — which is strictly better than failing a settled
 * payment that the caller would then retry. Same decision `settleInvoicePaid`
 * already makes about a plan stage it cannot move.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'confirmPackageOnPayment' });

export interface ConfirmPackageResult {
  /** The container, or null when this invoice did not bill a package. */
  containerId: string | null;
  /** The meetings moved from `pending` to `confirmed`. */
  confirmed: string[];
}

const NOTHING: ConfirmPackageResult = { containerId: null, confirmed: [] };

export async function confirmPackageOnPayment(
  client: SupabaseClient,
  invoiceId: string,
  paidAt: string
): Promise<ConfirmPackageResult> {
  /*
   * The quote this invoice came from, and the package it created.
   *
   * `package_booking_id` is null for every quote that is not a package, which
   * ends this in one query for the overwhelming majority of payments.
   */
  const { data: proposal, error: proposalError } = await client
    .from('proposals')
    .select('id, user_id, contact_id, package_booking_id, sessions')
    .eq('created_invoice_id', invoiceId)
    .not('package_booking_id', 'is', null)
    .maybeSingle();

  if (proposalError) {
    logger.error({ err: proposalError, invoiceId }, 'Could not look up a package for this invoice');
    return NOTHING;
  }

  if (!proposal?.package_booking_id) return NOTHING;

  const containerId = proposal.package_booking_id as string;
  const userId = proposal.user_id as string;

  /*
   * Only the `pending` ones, and only this owner's.
   *
   * `pending` is the filter that makes this safe to run twice — a redelivered
   * webhook settles nothing new, and a second pass finds nothing to move. It
   * also leaves alone a meeting the owner has already cancelled or completed
   * between acceptance and payment, which must not be resurrected by a payment
   * arriving late.
   */
  const { data: children, error: childrenError } = await client
    .from('scheduling_bookings')
    .update({ status: 'confirmed', updated_at: paidAt })
    .eq('parent_booking_id', containerId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id, start_time, end_time, occurrence_number');

  if (childrenError) {
    logger.error(
      { err: childrenError, invoiceId, containerId },
      'A package was paid for but its meetings could not be confirmed'
    );
    return { containerId, confirmed: [] };
  }

  const confirmed = (children ?? []).map(child => child.id as string);

  /*
   * The container follows its meetings.
   *
   * It holds no time and no slot, so its status is purely what the owner reads
   * on the purchase — and a purchase still reading `pending` after the money
   * arrived is the kind of disagreement that sends somebody looking for a
   * payment that is already there.
   */
  const { error: containerError } = await client
    .from('scheduling_bookings')
    .update({ status: 'confirmed', payment_status: 'paid', updated_at: paidAt })
    .eq('id', containerId)
    .eq('user_id', userId);

  if (containerError) {
    logger.error(
      { err: containerError, invoiceId, containerId },
      'A package was paid for but the purchase itself could not be marked confirmed'
    );
  }

  logger.info({ invoiceId, containerId, confirmed: confirmed.length }, 'Package confirmed on payment');

  if (confirmed.length === 0) return { containerId, confirmed };

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE EMAIL, AND THE CALENDAR.
   *
   * Both are best-effort and neither can fail the settlement: the meetings are
   * confirmed in the database, which is the fact that matters, and an email or
   * a calendar event that did not go out is visible and re-sendable. The
   * alternative — throwing here — would leave a settled payment the caller
   * retries, and a retry finds nothing pending and so sends nothing at all.
   *
   * The email goes to the FIRST meeting with all of the dates attached, which
   * is why there is one of them and not six. See `sendBookingConfirmation`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const meetings = (children ?? [])
    .slice()
    .sort((a, b) => Number(a.occurrence_number ?? 0) - Number(b.occurrence_number ?? 0));

  const sessions = meetings
    .filter(m => m.start_time && m.end_time)
    .map(m => ({ start: new Date(m.start_time as string), end: new Date(m.end_time as string) }));

  try {
    const { BookingEmailService } = await import('@/lib/services/BookingEmailService');
    const email = await BookingEmailService.sendBookingConfirmation(
      meetings[0].id as string,
      userId,
      { sessions, skipInvoice: true }
    );

    if (!email.sent) {
      logger.warn({ invoiceId, containerId, error: email.error }, 'Package confirmed but its email did not go out');
    }
  } catch (err) {
    logger.error({ err, invoiceId, containerId }, 'Package confirmed but its email threw');
  }

  /*
   * A calendar event per meeting, because each one is an hour in the owner's
   * day. Sequential rather than parallel: this calls an external calendar
   * through the plugin layer, and six at once is a rate limit for the sake of a
   * second saved in a path nobody is waiting on.
   */
  try {
    const { CalendarSyncService } = await import('@/lib/services/CalendarSyncService');
    const { schedulingBookingRepository, schedulingServiceRepository } = await import(
      '@/lib/repositories/SchedulingRepository'
    );

    for (const meeting of meetings) {
      /*
       * Re-read rather than reuse the update's rows: the sync needs the client's
       * name and email, which `findById` normalises onto the booking from the
       * joined contact, and the update above selected four columns.
       */
      const { data: booking } = await schedulingBookingRepository.findById(meeting.id as string, userId);
      if (!booking?.start_time) continue;

      const { data: service } = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (!service) continue;

      // `CalendarSyncService` is the singleton INSTANCE, not the class — the
      // same spelling `createBooking` uses.
      await CalendarSyncService.syncBookingToCalendar(booking, service, userId);
    }
  } catch (err) {
    // Never fatal: the appointments exist, and the owner's own calendar is a
    // mirror of them rather than the record.
    logger.error({ err, invoiceId, containerId }, 'Package confirmed but its calendar events failed');
  }

  return { containerId, confirmed };
}
