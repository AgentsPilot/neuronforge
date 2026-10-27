/**
 * Which times are already taken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE DEFINITION, FIVE CALLERS
 *
 * Five places ask this question: the public availability list, the two booking
 * routes that re-check at the moment of writing, the owner-side diary, and the
 * recurring materialiser. Each had its own copy of the filter, and they had
 * already drifted — one asked "not cancelled", which kept a no-show's time shut
 * for good.
 *
 * A slot wrongly held is revenue that cannot be booked, and a slot wrongly free
 * is two clients in one room. Both are silent. So the question gets one
 * answer, here, and the callers read intervals rather than build filters.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS READS `scheduling_meetings` AND NOT THE BOOKING
 *
 * An appointment occupies time. A job does not — it may span months and hold no
 * slot at all. `scheduling_meetings` is the table of appointments, so it is the
 * one that can answer this, and it answers from two columns instead of a join.
 *
 * A JOB being called off also frees its time, and that fact lives on the
 * booking. Rather than join to fetch it on the hottest read in the product, the
 * consequence is recorded once where it happens: `cancel()` writes
 * `meeting_status: 'cancelled'` for any meeting not yet held, and migration
 * 20261075 backfilled the 58 historical rows. Parity against live data: zero
 * disagreements with `holdsSlot()`, and zero in the future.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HOLDS A SLOT
 *
 * `NULL` — nobody has said what happened yet, so the time is committed. This is
 * the normal state of every future appointment, and it is why the filter cannot
 * be written as `NOT IN ('no_show','cancelled')`: in SQL, `NULL NOT IN (…)` is
 * NULL, not true, and every unmarked meeting would vanish from the result —
 * every future slot would read as free.
 *
 * `held` — it happened. It keeps its time so that nothing is ever booked
 * retrospectively over a meeting that took place.
 *
 * `no_show` and `cancelled` free the time. The client did not come, or the work
 * was called off; either way nobody is in the room.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { MEETING_HOLDS_SLOT_FILTER } from '@/lib/business-os/bookingStatus';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'busyMeetings' });

/** A span of committed time. Both ends are ISO strings, as stored. */
export interface BusyInterval {
  start_time: string;
  end_time: string;
}

/**
 * The meetings that hold time for `userId` between `from` and `to`.
 *
 * Returns `[]` on failure, and logs. That is deliberate at this layer and
 * deliberately NOT the whole safety story: an empty result makes every slot
 * look free, so the two write paths re-check under the database's own overlap
 * constraint, which is what actually prevents a double booking. This function
 * is for showing a client what to pick, and a failed read there must not blank
 * the calendar.
 *
 * @param client  Any Supabase client. The caller chooses: a public page reads
 *                with the service role because it has no session, while the
 *                owner-side diary reads as the owner.
 * @param userId  CLAUDE.md rule 4. Always filtered, never optional — a missing
 *                filter here would expose one business's diary on another's
 *                booking page.
 * @param excludeBookingId
 *                A booking whose own meetings do not count as busy.
 *
 *                Only ever the one being EDITED. Rescheduling an appointment
 *                reads the diary to show what is free, and its own hour is in
 *                that diary — so without this the owner opening a booking at
 *                10:00 is told 10:00 is taken, by itself, and the hour they
 *                are looking at is the one hour the picker will not offer.
 *
 *                Deliberately not a general "ignore these" list: anything
 *                wider is a way to hide a real clash. Both write paths still
 *                re-check under the database's overlap constraint, which does
 *                not take this argument at all.
 */
export async function busyMeetings(
  client: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  excludeBookingId?: string | null
): Promise<BusyInterval[]> {
  let query = client
    .from('scheduling_meetings')
    .select('start_time, end_time')
    .eq('user_id', userId)
    /*
     * Overlap, not containment. A meeting that starts before the window and
     * runs into it still occupies the window's opening slots, and asking
     * `start_time >= from` would miss it — which is how a long appointment
     * across a day boundary gets double booked.
     */
    .lt('start_time', to)
    .gt('end_time', from)
    .or(MEETING_HOLDS_SLOT_FILTER);

  if (excludeBookingId) {
    query = query.neq('booking_id', excludeBookingId);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ err: error, userId, from, to }, 'Failed to read busy meetings');
    return [];
  }

  const meetings = (data ?? []) as BusyInterval[];

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND A BOOKING THAT HOLDS ITS HOUR WITHOUT A MEETING ROW.
   *
   * Everything above rests on one assumption, stated at the top of this file:
   * a slot-holding booking always has a meeting, so reading the meetings is the
   * same as reading the bookings. That was measured — "zero disagreements with
   * holdsSlot(), and zero in the future" — and it is no longer true.
   *
   * Measured 2026-10-26: booking 5160bd88, `confirmed`, 09:00 on the 28th, with
   * no row in `scheduling_meetings` at all. The planner could not see it, so it
   * offered that hour as free and even recommended it. The owner picked it and
   * the save was refused by `scheduling_bookings_no_overlap`, which reads the
   * BOOKING's own columns and needs no meeting to exist.
   *
   * That is the worst shape this module names: "a slot wrongly free is two
   * clients in one room", caught only by the database, after the owner had been
   * told the hour was the best one available.
   *
   * So the question is asked of the bookings too, and the predicate below is
   * the constraint's, copied: the same statuses, the same `meeting_status IS
   * NULL OR 'held'`, the same requirement for real times. The constraint's own
   * comment says it "must stay in step with holdsSlot() and
   * MEETING_HOLDS_SLOT_FILTER" — this is what keeps the reader in step with it.
   *
   * ONLY the bookings with no meeting are added. Where a meeting exists it is
   * already in `meetings` above with the authoritative hour, which matters
   * because a MOVED meeting carries a time its booking row does not.
   *
   * A second read on a hot path, and deliberately: the note above avoided a
   * join to keep this fast, and the cost of being wrong is a double booking.
   * It is one indexed window on (user_id, start_time), and it returns nothing
   * on a tenant whose data holds the original assumption.
   * ───────────────────────────────────────────────────────────────────────────
   */
  let orphans = client
    .from('scheduling_bookings')
    .select('id, start_time, end_time, scheduling_meetings(id)')
    .eq('user_id', userId)
    .lt('start_time', to)
    .gt('end_time', from)
    .in('status', ['confirmed', 'pending', 'completed'])
    /* `NULL` or `held`, exactly as the constraint has it — and never written as
       `NOT IN (…)`, which is NULL for an unmarked meeting and would drop every
       future appointment. */
    .or('meeting_status.is.null,meeting_status.eq.held');

  if (excludeBookingId) {
    orphans = orphans.neq('id', excludeBookingId);
  }

  const { data: bookingRows, error: bookingError } = await orphans;

  if (bookingError) {
    /*
     * Soft, like the rest of this module: the meetings are already a correct
     * answer for every booking that has one, and returning nothing here would
     * free every hour in the window rather than add the few it could not read.
     */
    logger.error(
      { err: bookingError, userId, from, to },
      'Could not check for slot-holding bookings without a meeting'
    );
    return meetings;
  }

  const withoutMeeting = (bookingRows ?? []).filter(
    row => !((row as { scheduling_meetings?: unknown[] }).scheduling_meetings ?? []).length
  );

  if (withoutMeeting.length > 0) {
    /*
     * Worth saying out loud. Each one is a booking whose hour only the database
     * can defend, and the row should not exist — see
     * `aBookingWithoutAMeetingStillHoldsItsHour.guard`.
     */
    logger.warn(
      { userId, bookingIds: withoutMeeting.map(r => (r as { id: string }).id) },
      'Bookings hold time with no meeting row; counted as busy from the booking itself'
    );
  }

  return [
    ...meetings,
    ...withoutMeeting.map(row => {
      const r = row as { start_time: string; end_time: string };
      return { start_time: r.start_time, end_time: r.end_time };
    }),
  ];
}

/**
 * Does `[start, end)` collide with any committed time?
 *
 * Half-open on purpose: a meeting ending at 10:00 and one starting at 10:00 do
 * not overlap, which is what makes back-to-back appointments bookable.
 */
export function overlapsBusy(
  start: string | Date,
  end: string | Date,
  busy: BusyInterval[]
): boolean {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();

  return busy.some(b => {
    const bs = new Date(b.start_time).getTime();
    const be = new Date(b.end_time).getTime();
    return s < be && e > bs;
  });
}
