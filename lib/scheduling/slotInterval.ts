/**
 * How far apart the times offered to a client are.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ANSWER, BECAUSE THERE ARE THREE DOORS INTO THE SAME DIARY.
 *
 * A client reaches the same business through a website, a landing page or a
 * smart link, and each of those had its own slot grid written into its own
 * route: `slotStartMins += 30` in `availableSlots.ts`, `const slotInterval = 30`
 * in the conversion route. They agreed only because both literals happened to
 * say thirty, and nothing made them agree about anything else — the website
 * applied the service's buffer to what counts as taken and the smart link did
 * not, so the same service offered a tighter slot through one door.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIRTY WAS WRONG, WHATEVER IT WAS SHARED BETWEEN.
 *
 * The grid had nothing to do with the service. It was a fixed half-hour, so:
 *
 *   · a 20-minute service got two starts an hour instead of three, and the
 *     third twenty minutes of every hour could never be sold;
 *   · a 50-minute service offered 09:00 AND 09:30, which overlap. Only one
 *     could ever be taken, and whichever the first client picked decided how
 *     much of the morning died with it: book 09:30, and 09:00 to 09:30 is
 *     unsellable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LENGTH PLUS THE GAP, SO THE DAY TILES AND NOTHING IS STRANDED.
 *
 * Stepping by the length alone is what most booking products do, and it leaves
 * time standing in the corner: a 60-minute service with a 15-minute gap, booked
 * at 09:00, holds the room until 10:15 — while the next aligned start is 10:00,
 * which clashes. 10:15 to 11:00 can then be sold to nobody.
 *
 * Stepping by 75 instead lays the day out end to end: 09:00, 10:15, 11:30. Each
 * appointment's gap is inside the rhythm rather than eaten out of the next slot.
 *
 * The owner's own grid is moved to the same rule, in the free-slots route, so
 * the two ends of the product never describe one diary differently.
 *
 * The gap is ALSO still widened into what counts as taken, which is not double
 * counting: the step keeps our own bookings apart, and the widening keeps an
 * appointment away from something off-grid — a meeting the owner typed in by
 * hand, or an event from a synced calendar.
 *
 * @module lib/scheduling/slotInterval
 */

/**
 * What to space slots by when the service does not say how long it is.
 *
 * A missing duration is missing information, and both routes already answered
 * it this way. Kept as the fallback rather than quietly inventing an hour,
 * which is the mistake that made every service implicitly an appointment.
 */
export const FALLBACK_SLOT_MINUTES = 30;

/** Nothing useful can be offered closer together than this. */
const FLOOR_MINUTES = 5;

/**
 * The gap between one offered start and the next.
 *
 * @param durationMinutes the service's own length, `null` where it declares none
 */
export function slotStepMinutes(
  durationMinutes: number | null | undefined,
  bufferMinutes?: number | null
): number {
  /*
   * Everything that is not a usable length falls back together: null, zero, a
   * negative, and the NaN a bad row can produce. `Number.isFinite` is the whole
   * test, because `null > 0` is false but `NaN > 0` is false too and only one
   * of those reads as obviously handled.
   */
  if (
    typeof durationMinutes !== 'number' ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return FALLBACK_SLOT_MINUTES;
  }

  /*
   * The gap is part of the RHYTHM, not just of what is taken.
   *
   * Spacing by the duration alone leaves the gap stranded: a 60-minute service
   * with 15 minutes after it, booked at 09:00, holds the room to 10:15 — and
   * the next aligned start is 10:00, which clashes, so 10:15 to 11:00 is
   * unsellable. Stepping by 75 tiles the day exactly and nothing is left over.
   *
   * `offeredStarts` is what keeps the times honest when a day is already
   * broken up: a free stretch that holds the appointment is always offered,
   * aligned where it can be.
   */
  const buffer =
    typeof bufferMinutes === 'number' && Number.isFinite(bufferMinutes) && bufferMinutes > 0
      ? bufferMinutes
      : 0;

  return Math.max(FLOOR_MINUTES, Math.round(durationMinutes + buffer));
}
