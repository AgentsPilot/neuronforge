/**
 * Tell the clients, before the business disappears.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A deletion cascade takes every booking row with it silently. Somebody who
 * booked a session for next Tuesday would simply turn up — no email, no
 * explanation, and no record on either side that the appointment ever existed.
 * That is the one part of deleting an account that happens to people who did
 * not ask for it.
 *
 * So every appointment still ahead is CANCELLED properly first, one at a time,
 * through `cancelBooking` — the same path the owner's own cancel button uses.
 * That matters more than it looks: cancelling is not a status update. It
 * removes the event from the owner's connected calendar, withdraws any quote
 * riding on the booking, writes the audit entry, and emails the client. A loop
 * that only wrote `status = 'cancelled'` would leave every one of those undone,
 * including appointments still sitting in a Google Calendar that outlives this
 * account entirely.
 *
 * WHAT THE CLIENT IS TOLD
 *
 * The ordinary cancellation email, with two changes: the reason says the
 * business has ceased operating and to contact the owner directly, and the
 * "Book Again" invitation is suppressed — it would contradict the message and
 * point at a page that stopped existing a moment ago.
 *
 * Written in the BUSINESS's language, not the owner's interface language. The
 * distinction is real and has bitten this codebase before.
 *
 * NEVER FATAL. A client who cannot be emailed — no address on the booking, a
 * transport failure — must not trap somebody in an account they asked to
 * delete. Failures are counted and returned so the caller can say what
 * happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { cancelBooking } from '@/lib/services/BookingLifecycleService';
import { getBusinessLocale } from '@/lib/services/BookingEmailService';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { emailTranslations } from '@/lib/email/templates/translations';

const logger = createLogger({ module: 'CancelBookingsForClosure' });

/**
 * How many appointments this will cancel before giving up.
 *
 * A backstop, not a business rule: no real business has 500 future
 * appointments, and a runaway loop inside a deletion is worth bounding. If it
 * is ever hit, `capped` says so rather than the caller quietly believing every
 * client was told.
 */
const MAX_BOOKINGS = 500;

/** One page of the scan. Nothing about this number is significant. */
const PAGE_SIZE = 50;

export interface ClosureCancellations {
  /** Appointments successfully cancelled. */
  cancelled: number;
  /** Of those, how many reached the client as an email. */
  clientsNotified: number;
  /** Appointments that could not be cancelled at all. */
  failed: number;
  /** True when `MAX_BOOKINGS` was reached and bookings were left untouched. */
  capped: boolean;
}

export async function cancelFutureBookingsForClosure(
  userId: string
): Promise<ClosureCancellations> {
  const result: ClosureCancellations = {
    cancelled: 0,
    clientsNotified: 0,
    failed: 0,
    capped: false,
  };

  const locale = await getBusinessLocale(userId);
  const reason = emailTranslations.bookingCancellation.closedReason[locale];

  /*
   * Confirmed is the only live status — the other three (`cancelled`,
   * `completed`, `no_show`) are all terminal, so there is nothing left to
   * cancel on any of them.
   *
   * Scanned from now forward. A booking whose time has already passed is
   * history, and telling that client their appointment "has been cancelled"
   * would simply be false.
   *
   * Re-queried from offset 0 each round ON PURPOSE: each cancellation moves a
   * booking out of the `confirmed` filter, so the remaining ones shift down to
   * fill the page. Advancing an offset would step over that many bookings every
   * time and leave most clients unwritten to.
   */
  const now = new Date().toISOString();

  /*
   * Every booking id already tried, successfully or not.
   *
   * A booking that FAILS to cancel stays `confirmed`, so it comes back on the
   * next page for as long as the scan runs. Without this it would be retried
   * and re-counted every round — and the loop would only end by exhausting the
   * cap. Skipping what has been attempted is also the termination condition: a
   * page with nothing new on it means there is nothing left to do.
   */
  const attempted = new Set<string>();

  while (attempted.size < MAX_BOOKINGS) {
    const page = await schedulingBookingRepository.list(userId, {
      status: 'confirmed',
      startDate: now,
      limit: PAGE_SIZE,
    });

    if (page.error) {
      logger.error({ err: page.error, userId }, 'Could not read the upcoming bookings');
      break;
    }

    const pending = (page.data ?? []).filter(booking => !attempted.has(booking.id));
    if (pending.length === 0) break;

    for (const booking of pending) {
      if (attempted.size >= MAX_BOOKINGS) {
        result.capped = true;
        break;
      }

      attempted.add(booking.id);

      try {
        const outcome = await cancelBooking({
          bookingId: booking.id,
          userId,
          reason,
          offerRebooking: false,
          logger,
        });

        if (outcome.error || !outcome.data) {
          result.failed += 1;
          logger.warn(
            { bookingId: booking.id, userId, err: outcome.error },
            'Could not cancel a booking on closure'
          );
          continue;
        }

        result.cancelled += 1;
        if (outcome.data.clientNotified) result.clientsNotified += 1;
      } catch (err) {
        result.failed += 1;
        logger.warn({ err, bookingId: booking.id, userId }, 'Cancelling a booking threw on closure');
      }
    }

    if (result.capped) break;
  }

  if (result.capped) {
    logger.warn(
      { userId, limit: MAX_BOOKINGS },
      'Hit the cancellation cap; some upcoming bookings were not cancelled and their clients were not told'
    );
  }

  logger.info({ userId, ...result }, 'Upcoming bookings cancelled for closure');

  return result;
}
