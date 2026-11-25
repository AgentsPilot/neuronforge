/**
 * Turning a day's open hours into the times a client can actually pick.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT IN A ROUTE ANY MORE
 *
 * It lived inside `app/api/website/scheduling/availability`, which is the
 * ANONYMOUS endpoint the public booking page uses. That endpoint resolves the
 * business from a subdomain or a user code, and falls back to the signed-in
 * user when given neither.
 *
 * The portal's reschedule panel called it with neither, so a client following
 * their own booking link was answered 401, and the panel renders a refusal and
 * an empty diary identically: "No slots is a legitimate answer; a failed lookup
 * renders the same way." The owner, testing in a browser already signed in,
 * saw slots every time. That is the whole of "sometimes there are no hours".
 *
 * A client holding a booking token has already proved their right to see that
 * booking's options, so the fix is for the token route to answer the question
 * itself. Both routes now call this, which is the point: two implementations of
 * "what can be booked" would disagree about overlaps, notice or time off, and
 * the client would be offered an hour the business would then refuse.
 *
 * @module lib/scheduling/availableSlots
 */

import { businessClock, businessDateKey } from '@/lib/scheduling/businessTime';
/* One grid for every public surface. See the module. */
import { slotStepMinutes } from '@/lib/scheduling/slotInterval';
import { offeredStarts, busySpansOn } from '@/lib/scheduling/offeredStarts';

/** A window in the owner's own clock, as stored. */
export interface TimeSlot {
  start: string; // HH:mm
  end: string;   // HH:mm
}

/**
 * Generate time slots for a given day based on availability and service duration
 *
 * Note: Availability times (e.g., "09:00" to "17:00") are in the business owner's timezone.
 * We construct slot times as if they're in UTC for simplicity, then display them
 * with the correct timezone formatting.
 */
export function generateTimeSlots(
  date: string,
  dayAvailability: TimeSlot[],
  durationMinutes: number,
  existingBookings: { start_time: string; end_time: string }[],
  externalEvents: { start_time: string; end_time: string }[],
  timezone: string = 'UTC',
  /*
   * The gap the business keeps BETWEEN appointments — `buffer_minutes`.
   *
   * The column has existed since the first scheduling migration, defaults to
   * 15 and is editable in the service modal, and nothing in any booking path
   * read it: this page offered clients hours flush against the owner's
   * existing meetings. Applied by widening what is taken, so an hour can
   * neither end against the next meeting nor start against the last.
   *
   * The working day's own edges are deliberately NOT widened: closing time is
   * not an appointment, so the last slot may run right up to it.
   */
  bufferMinutes: number = 0
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];

  // Availability times (e.g., "14:00" to "17:00") are in the business owner's local time.
  // We generate slots as "date + time" strings that represent wall-clock time,
  // NOT UTC. The client displays these directly without timezone conversion.

  /*
   * "Now", and "is the requested date today", both where the BUSINESS is.
   * Read in the server's zone (UTC on Vercel) these hid slots that were still
   * bookable for a business behind UTC, and offered slots that had already
   * passed for one ahead of it.
   */
  const now = new Date();
  const { hour: nowHours, minute: nowMinutes } = businessClock(now, timezone);
  const todayStr = businessDateKey(now, timezone);
  const isToday = date === todayStr;

  /*
   * ── WHAT IS BUSY *ON THIS DAY* ────────────────────────────────────────────
   *
   * The overlap tests below compare an appointment's HOUR AND MINUTE against
   * the slot's, because a slot is a wall-clock time and `businessClock` answers
   * in exactly that form. What `businessClock` does NOT answer is which day,
   * and nothing here asked — so an appointment at 10:00 on the 25th blocked the
   * 10:00 slot on every other date it was handed alongside.
   *
   * That stayed hidden while every caller passed one day's bookings. The
   * portal's open-dates sweep passes a whole month's in one call, on the stated
   * reasoning that "an appointment three weeks away cannot overlap" a day's own
   * windows. It can, and did: ~38 appointments spread over a month cover
   * 09:00-17:00 between them, so EVERY working day came back with nothing free
   * and the client's reschedule diary greyed out the entire month.
   *
   * Filtered here rather than at that call site, so the assumption the callers
   * already make is simply true, and a future caller handing over a wide list
   * gets the right answer instead of a silent one.
   *
   * The comparison is an overlap on date keys, not equality: a booking that
   * starts the previous evening and runs past midnight, or a multi-day external
   * event straddling this date entirely, both still occupy hours of it.
   *
   * Each surviving row is reduced to the minutes of THIS day it takes up, which
   * also closes a second hole in the same arithmetic. A span running from 22:00
   * to 10:00 the next morning gave `start 1320, end 600` — a backwards range
   * that no slot can overlap — so an appointment running into the morning left
   * that morning entirely for sale. Clipping to the day's own edges states the
   * span the way the comparison can actually read it.
   *
   * The buffer is folded in here rather than per slot: it is a property of the
   * appointment, and the old code recomputed it for every slot of every day.
   */
  const busyMinutesOn = (rows: { start_time: string; end_time: string }[]) =>
    busySpansOn({ date, timezone, rows, bufferMinutes });

  const bookingsToday = busyMinutesOn(existingBookings);
  const eventsToday = busyMinutesOn(externalEvents);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * OFFERED FROM WHAT IS FREE, NOT FILTERED OUT OF THE WHOLE DAY.
   *
   * This used to tile every window from its opening and drop whatever clashed,
   * which is what most booking products do and what leaves time stranded: a
   * 45-minute service with a 15-minute gap, booked at 09:00 and 11:00, has
   * 09:45 to 11:00 genuinely free and the aligned grid lands on 09:45 and 10:30
   * — both clashing — so an hour the owner can see in their diary was offered
   * to nobody.
   *
   * `offeredStarts` works from the free stretches instead and guarantees the
   * thing that matters: a stretch that holds the appointment always gets a
   * start. The owner's own grid has worked this way for a while
   * (`slotsInWindows`); this is the client side catching up to it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   */
  const toMins = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
  };

  const step = slotStepMinutes(durationMinutes, bufferMinutes);

  for (const window of dayAvailability) {
    const windowStartMins = toMins(window.start);
    const windowEndMins = toMins(window.end);

    const starts = offeredStarts({
      windowStart: windowStartMins,
      windowEnd: windowEndMins,
      durationMinutes,
      stepMinutes: step,
      /* Both kinds of taken time, already widened by the business's gap. */
      busy: [...bookingsToday, ...eventsToday],
    });

    for (const slotStartMins of starts) {
      const slotEndMins = slotStartMins + durationMinutes;

      const slotHour = Math.floor(slotStartMins / 60);
      const slotMinute = slotStartMins % 60;
      const endSlotHour = Math.floor(slotEndMins / 60);
      const endSlotMinute = slotEndMins % 60;

      // Format as HH:mm
      const slotStartStr = `${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`;
      const slotEndStr = `${String(endSlotHour).padStart(2, '0')}:${String(endSlotMinute).padStart(2, '0')}`;

      // Create datetime strings (these are wall-clock time, not UTC)
      const startDateTime = `${date}T${slotStartStr}:00`;
      const endDateTime = `${date}T${slotEndStr}:00`;

      /* An hour that has gone is not bookable, and the server refuses it. The
         overlap tests this used to repeat are gone: `offeredStarts` only ever
         returns starts inside a free stretch. */
      const isPastSlot = isToday && (slotHour < nowHours || (slotHour === nowHours && slotMinute <= nowMinutes));
      if (isPastSlot) continue;

      // Format display time (12-hour format)
      const displayHour = slotHour % 12 || 12;
      const amPm = slotHour >= 12 ? 'PM' : 'AM';

      slots.push({
        start_time: startDateTime,
        end_time: endDateTime,
        display_time: `${displayHour}:${String(slotMinute).padStart(2, '0')} ${amPm}`
      });
    }
  }

  return slots;
}
