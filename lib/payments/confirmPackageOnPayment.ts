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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TWO SHAPES, AND BOTH HAVE TO WORK.
   *
   * A package used to be a container plus one CHILD BOOKING per date. It is now
   * one booking with N rows in `scheduling_meetings`, and the dates sold before
   * the change still exist in the old shape — a client can pay next week for a
   * package accepted last month.
   *
   * So the children are tried first and, finding none, the meetings are read
   * instead. Nothing has to be migrated for a payment to land correctly, which
   * is the whole reason this is a fallback rather than a replacement.
   *
   * WHAT "CONFIRMED" MEANS IN THE NEW SHAPE
   *
   * There is no per-session status to move: the sessions are meetings, and a
   * meeting's row carries what HAPPENED at it, not whether the job is paid for.
   * The one status is the container's, which the block below sets — so for a
   * package of meetings, confirming is a single-row update and the list here is
   * what the email and the calendar need, not a set of rows that changed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const usingChildren = (children ?? []).length > 0;

  let sessionRows = (children ?? []) as Array<Record<string, unknown>>;

  if (!usingChildren) {
    const { data: meetingRows, error: meetingsError } = await client
      .from('scheduling_meetings')
      .select('id, start_time, end_time, session_number, occurrence_number, meeting_status')
      .eq('booking_id', containerId)
      .eq('user_id', userId)
      /*
       * Only what is still to happen. A session the owner cancelled or marked
       * between acceptance and payment must not be resurrected by a payment
       * arriving late, and a superseded attempt must not be announced as a
       * date — it is an hour that was given back. This is the same intent the
       * `status = 'pending'` filter carries on the children above.
       */
      .is('meeting_status', null)
      .order('session_number', { ascending: true })
      .order('occurrence_number', { ascending: true });

    if (meetingsError) {
      logger.error(
        { err: meetingsError, invoiceId, containerId },
        'A package was paid for but its sessions could not be read'
      );
      return { containerId, confirmed: [] };
    }

    /*
     * One row per session: the LATEST attempt at each, which is the time the
     * client actually holds. Ordered above, so the last one seen per session
     * wins.
     */
    const bySession = new Map<string, Record<string, unknown>>();
    for (const row of meetingRows ?? []) {
      bySession.set(String(row.session_number ?? row.id), row as Record<string, unknown>);
    }
    sessionRows = [...bySession.values()];
  }

  const confirmed = sessionRows.map(row => String(row.id));

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
  const meetings = sessionRows
    .slice()
    .sort(
      (a, b) =>
        /* Sessions in the order sold; attempts fall back to the old key, which
           is the only number a child booking has. */
        Number(a.session_number ?? a.occurrence_number ?? 0) -
        Number(b.session_number ?? b.occurrence_number ?? 0)
    );

  const sessions = meetings
    .filter(m => m.start_time && m.end_time)
    .map(m => ({ start: new Date(m.start_time as string), end: new Date(m.end_time as string) }));

  try {
    const { BookingEmailService } = await import('@/lib/services/BookingEmailService');
    const email = await BookingEmailService.sendBookingConfirmation(
      /*
       * The booking the email is ABOUT. In the old shape that was the first
       * child, which carried a clock of its own; in the new one the sessions
       * have no booking and the purchase is the only one there is.
       *
       * `sessions` above is what the email prints either way, and the
       * confirmation takes its headline time from the first of them when the
       * booking has none — see `sendBookingConfirmation`. Without that it
       * announced an Invalid Date to the client.
       */
      usingChildren ? String(meetings[0].id) : containerId,
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

    /*
     * The job the sync describes. Re-read rather than reusing the update's
     * rows: it needs the client's name and email, which `findById` normalises
     * onto the booking from the joined contact.
     *
     * In the new shape that is read ONCE, for the container, and each session
     * borrows it with its own hours put in — the client, the service and the
     * title are the same for all six, and only the clock differs.
     */
    const { data: container } = usingChildren
      ? { data: null }
      : await schedulingBookingRepository.findById(containerId, userId);

    for (const meeting of meetings) {
      const { data: booking } = usingChildren
        ? await schedulingBookingRepository.findById(String(meeting.id), userId)
        : {
            data: container
              ? {
                  ...container,
                  start_time: String(meeting.start_time),
                  end_time: String(meeting.end_time),
                  /*
                   * Not the container's. Borrowing it would make the sync
                   * believe this session's event already existed and update
                   * that one event six times over, leaving one entry in the
                   * diary for six appointments.
                   */
                  external_calendar_event_id: null,
                }
              : null,
          };

      if (!booking?.start_time) continue;

      const { data: service } = await schedulingServiceRepository.findById(booking.service_id, userId);
      if (!service) continue;

      // `CalendarSyncService` is the singleton INSTANCE, not the class — the
      // same spelling `createBooking` uses.
      await CalendarSyncService.syncBookingToCalendar(
        booking,
        service,
        userId,
        /* Record the event on the SESSION, so six of them do not overwrite one
           column and get re-created on the next sync. */
        usingChildren ? null : String(meeting.id)
      );
    }
  } catch (err) {
    // Never fatal: the appointments exist, and the owner's own calendar is a
    // mirror of them rather than the record.
    logger.error({ err, invoiceId, containerId }, 'Package confirmed but its calendar events failed');
  }

  return { containerId, confirmed };
}
