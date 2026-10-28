/**
 * How far ahead a business takes bookings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS HAS ITS OWN MODULE
 *
 * The number is needed in two places that must never disagree: the repository
 * that stamps it onto a new service, and the public date strips that decide
 * which days a client may choose. It cannot live in the repository, because a
 * `'use client'` component importing that would pull Supabase into the browser
 * bundle — the rule CLAUDE.md states outright.
 *
 * So it lives here, with no imports of its own, and both sides read it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NINETY, AND IT USED TO BE THIRTY
 *
 * Thirty was never a decision any business made. All 42 bookable services on
 * the platform carried exactly 30, because that was the fallback stamped at
 * creation and nobody had reason to revisit it.
 *
 * It became a real limit anyway: the public booking strips are bounded by this
 * value, so a client who wanted a date two months out had no way to ask for
 * one, and the business never learned they had tried.
 *
 * Three months is long enough for the bookings people genuinely plan ahead — a
 * course, a treatment block, a consultation after a holiday — and short enough
 * that a calendar stays meaningful. A business that wants a different window
 * still sets one, and that setting is still what the strips obey.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DEFAULT_ADVANCE_BOOKING_DAYS = 90;

/**
 * The window to offer for a given service, as a whole number of days.
 *
 * Takes the service's own setting where it has one, this default where it does
 * not, and never returns less than a day: a zero or a negative — from a bad
 * edit, or a column that arrived as a string — would otherwise render a date
 * strip with nothing in it, which reads as a business that cannot be booked at
 * all rather than one with an odd setting.
 */
export function bookableDaysFor(advanceBookingDays: number | null | undefined): number {
  const configured = Number(advanceBookingDays ?? DEFAULT_ADVANCE_BOOKING_DAYS);

  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : DEFAULT_ADVANCE_BOOKING_DAYS;
}
