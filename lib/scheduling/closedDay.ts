/**
 * Is the owner booking a client into a day they closed?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Time off reached every surface that PUBLISHES an hour — the website, the smart
 * link, the chat — and none that TAKES a booking. So the owner closed 7 October,
 * opened their own calendar, and booked a client into it: no warning anywhere,
 * a confirmation email naming a day the business is shut, and a reminder the
 * morning of.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT ASK
 *
 * Only what the owner said about THAT DATE — a closed range, or a short day.
 * Not the weekly pattern: owners put a client in at 7am or on a Sunday they do
 * not normally work all the time, and refusing that would be the platform
 * arguing with someone about their own diary. A date they explicitly closed is
 * a different statement, and the one they want held to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT IS A WARNING, NOT A LAW
 *
 * The verdict says what is wrong and lets the caller decide. The owner's dialog
 * turns it into "Book anyway", because seeing one client during a holiday is a
 * real thing a business does — what is not real is doing it by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { covers, type TimeOffEntry } from './availabilityWindows';

export type ClosedDayVerdict =
  | { closed: false }
  /** The whole date is off. */
  | { closed: true; kind: 'all_day'; reason: string | null }
  /** The date is open, but shorter than the hour being booked. */
  | { closed: true; kind: 'short_day'; reason: string | null; hours: { start: string; end: string } };

const OPEN: ClosedDayVerdict = { closed: false };

const isTime = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);

const reasonOf = (entry: TimeOffEntry): string | null => {
  const text = typeof entry.reason === 'string' ? entry.reason.trim() : '';
  return text || null;
};

/**
 * @param timeOff the entries for this business — more than this date is fine
 * @param dateKey `YYYY-MM-DD` on the BUSINESS's calendar, never the browser's
 * @param slot    `HH:MM`–`HH:MM` on the business's clock. Omit to ask only
 *                whether the date itself is closed, which is what a date picker
 *                needs before a time has been chosen.
 */
export function closedDayVerdict(
  timeOff: TimeOffEntry[] | null | undefined,
  dateKey: string,
  slot?: { start: string; end: string }
): ClosedDayVerdict {
  if (!dateKey) return OPEN;

  const onThisDate = (timeOff || []).filter(entry => covers(entry, dateKey));
  if (onThisDate.length === 0) return OPEN;

  const allDay = onThisDate.find(entry => entry.exception_type === 'unavailable');
  if (allDay) return { closed: true, kind: 'all_day', reason: reasonOf(allDay) };

  const short = onThisDate.find(entry => entry.exception_type === 'custom_hours');
  if (!short) return OPEN;

  const start = short.custom_hours?.start;
  const end = short.custom_hours?.end;

  /*
   * Unreadable hours close the date, which is exactly what `windowsForDate`
   * does with the same row. The two must not disagree: a date the booking page
   * treats as closed and the owner's dialog treats as open is the shape of the
   * bug this module exists to fix. The route validates these on the way in, so
   * reaching this is a legacy row or a hand-edit.
   */
  if (!isTime(start) || !isTime(end) || end <= start) {
    return { closed: true, kind: 'all_day', reason: reasonOf(short) };
  }

  // No time chosen yet: the date is open, just shorter.
  if (!slot) return OPEN;

  const within = slot.start >= start && slot.end <= end && slot.end > slot.start;
  if (within) return OPEN;

  return { closed: true, kind: 'short_day', reason: reasonOf(short), hours: { start, end } };
}
