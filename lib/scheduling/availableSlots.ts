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

  for (const window of dayAvailability) {
    // Parse window times (HH:mm format)
    const [startHour, startMin] = window.start.split(':').map(Number);
    const [endHour, endMin] = window.end.split(':').map(Number);

    // Convert to minutes for easier math
    const windowStartMins = startHour * 60 + startMin;
    const windowEndMins = endHour * 60 + endMin;

    // Generate slots in this window
    let slotStartMins = windowStartMins;

    while (slotStartMins + durationMinutes <= windowEndMins) {
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

      // Check if slot is in the past (for today only)
      const isPastSlot = isToday && (slotHour < nowHours || (slotHour === nowHours && slotMinute <= nowMinutes));

      // Check if slot overlaps with any existing booking
      // Note: bookings are stored with timezone info, need to compare carefully
      /*
       * A stored booking is an instant; `slotStartMins` is the business's wall
       * clock. Reading the booking's hours in the server's zone compared two
       * different clocks, so an existing 14:00 appointment in New York did not
       * block the 14:00 slot — it blocked 18:00. A client rescheduling could
       * book straight over an appointment the owner already had.
       */
      const overlapsBooking = existingBookings.some(booking => {
        const s = businessClock(new Date(booking.start_time), timezone);
        const e = businessClock(new Date(booking.end_time), timezone);
        const bookingStartMins = s.hour * 60 + s.minute - bufferMinutes;
        const bookingEndMins = e.hour * 60 + e.minute + bufferMinutes;
        return slotStartMins < bookingEndMins && slotEndMins > bookingStartMins;
      });

      // Check if slot overlaps with any external calendar event
      /* Same for a Google/Outlook event: an instant, read on the business's clock. */
      const overlapsExternal = externalEvents.some(event => {
        const s = businessClock(new Date(event.start_time), timezone);
        const e = businessClock(new Date(event.end_time), timezone);
        const eventStartMins = s.hour * 60 + s.minute - bufferMinutes;
        const eventEndMins = e.hour * 60 + e.minute + bufferMinutes;
        return slotStartMins < eventEndMins && slotEndMins > eventStartMins;
      });

      // Only add slot if it doesn't overlap with anything and is in the future
      if (!overlapsBooking && !overlapsExternal && !isPastSlot) {
        // Format display time (12-hour format)
        const displayHour = slotHour % 12 || 12;
        const amPm = slotHour >= 12 ? 'PM' : 'AM';

        slots.push({
          start_time: startDateTime,
          end_time: endDateTime,
          display_time: `${displayHour}:${String(slotMinute).padStart(2, '0')} ${amPm}`
        });
      }

      // Move to next slot (30-minute increments)
      slotStartMins += 30;
    }
  }

  return slots;
}
