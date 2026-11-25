/**
 * The owner's time, as held by a calendar that is not ours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS BESIDE `busyMeetings`
 *
 * An owner who connects Google or Outlook in availability settings is telling
 * us one thing: the hours in that diary are not for sale. `busyMeetings` cannot
 * see them — it reads `scheduling_meetings`, and a dentist appointment the owner
 * booked from their phone was never a row in our database.
 *
 * So every surface that asks "is this hour free" has to ask twice, and until now
 * they disagreed about whether to:
 *
 *   · the portal's RESCHEDULE route asked both, in two hand-written copies;
 *   · the subdomain availability LIST asked both;
 *   · the smart-link availability list asked only `busyMeetings`;
 *   · and both routes that actually WRITE the booking asked only
 *     `busyMeetings` — so the last gate before a client's appointment is
 *     created was the one that could not see the owner's diary.
 *
 * That last line is the one that mattered. The lists are advisory: a stale page,
 * a POST from a script, or two clients a second apart all arrive at the write
 * path, and the write path is where "this slot is no longer available" has to be
 * true. A client could be given an hour the owner was already out for, and
 * nothing in the product would ever say so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT FAILS SOFT, AND THAT IS DELIBERATE
 *
 * A calendar we cannot reach must not stop a business taking bookings. An
 * unreadable diary returns no intervals, which is the same choice
 * `busyMeetings` makes for its own failures and the one the availability routes
 * already made: a booking page that refuses everyone costs more than one
 * double-booked hour.
 *
 * The cost of that choice is bounded in a way the opposite is not — the cron
 * re-syncs every five minutes, and the owner can see the clash on their own
 * calendar. Refusing every booking while Google has a bad afternoon is silent
 * and total.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { externalCalendarEventRepository } from '@/lib/repositories/ExternalCalendarEventRepository';
import { createLogger } from '@/lib/logger';
import type { BusyInterval } from '@/lib/scheduling/busyMeetings';

const logger = createLogger({ module: 'externalBusy' });

/**
 * Spans in the owner's synced calendars that overlap the window.
 *
 * Returned in `busyMeetings`' own shape, so the two lists concatenate and
 * `overlapsBusy` reads both without knowing which is which.
 *
 * `getBusySlots` already selects by overlap rather than containment, so an
 * all-day event, or one that started yesterday and runs into this morning,
 * counts.
 */
export async function externalBusy(
  userId: string,
  startISO: string,
  endISO: string
): Promise<BusyInterval[]> {
  try {
    const { data, error } = await externalCalendarEventRepository.getBusySlots(
      userId,
      startISO,
      endISO
    );

    if (error) {
      logger.warn(
        { err: error, userId },
        'Could not read the owner external calendar; treating those hours as free'
      );
      return [];
    }

    return (data || []).map(slot => ({
      start_time: slot.start,
      end_time: slot.end,
    }));
  } catch (err) {
    logger.warn(
      { err, userId },
      'Could not read the owner external calendar; treating those hours as free'
    );
    return [];
  }
}
