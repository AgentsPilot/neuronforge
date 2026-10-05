/**
 * One wall clock for a business, wherever its owner is sitting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO END
 *
 * A single booking was showing three different times:
 *
 *   stored   2026-09-21T04:00:00+00:00   the instant, and it was always right
 *   drawer   12:00 AM                    the BROWSER's zone, via getHours()
 *   email     4:00 AM                    the booking row's `timezone` column
 *   business  7:00 AM                    Asia/Jerusalem, where the work happens
 *
 * Nothing was corrupt. Every layer rendered that instant faithfully, in a
 * different zone, because each had its own idea of which zone was authoritative:
 * the booking modal used the owner's laptop, emails used a column stamped at
 * creation, and the public booking page used `user_preferences.timezone`. They
 * agree only when all three happen to match, and the moment an owner travels,
 * or the preference is left at its `UTC` default, they do not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS AUTHORITATIVE, AND WHAT IS NOT
 *
 * The BUSINESS's timezone decides every displayed time. Not the browser: an
 * owner checking their diary from abroad must see the hours their clients will
 * turn up at, not the hours where the laptop is.
 *
 * The stored instant stays exactly as it is. `start_time` is an absolute moment
 * with an offset, which is what makes overlap checks, reminders and every cron
 * correct regardless of display — they compare instants, and they must keep
 * comparing instants. Nothing here changes a stored value; this is only about
 * which wall clock that instant is read against.
 *
 * @module lib/scheduling/businessTime
 */

/**
 * The fallback when a business has never set one.
 *
 * `UTC` rather than the machine's zone, deliberately. A server default that
 * follows the host makes the same booking render differently in development and
 * in production, and silently changes behaviour when a deployment region moves.
 * UTC is wrong for almost every business, but it is wrong the SAME way
 * everywhere, which is what makes it diagnosable.
 */
export const FALLBACK_TIMEZONE = 'UTC';

/** A zone Intl can actually resolve, or the fallback. */
export function safeTimezone(timezone: string | null | undefined): string {
  const zone = timezone?.trim();
  if (!zone) return FALLBACK_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    // A stored zone can be anything: an old IANA name, a hand-edited row, a
    // browser guess from a locale we do not carry. Throwing here would take a
    // booking list down over a display detail.
    return FALLBACK_TIMEZONE;
  }
}

/**
 * The parts of an instant as they read on a given wall clock.
 *
 * `Intl` is the only thing in the platform that knows what 04:00Z is called in
 * Jerusalem in September, including the daylight-saving rule that changes the
 * answer twice a year. Doing this with a fixed offset would be correct for
 * about half the year.
 */
function partsIn(date: Date, timezone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return Object.fromEntries(
    formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
}

/**
 * An instant, written as the `datetime-local` input wants it, on the business's
 * clock.
 *
 * This is what replaces `getHours()` in the booking modal. The input has no
 * concept of a zone — it shows whatever string it is given — so the string has
 * to already be the business's wall clock rather than the browser's.
 */
export function toBusinessLocalInput(date: Date, timezone: string): string {
  const zone = safeTimezone(timezone);
  const p = partsIn(date, zone);
  // `hour12: false` yields "24" for midnight in some engines; the input wants
  // "00", and an hour of 24 makes it reject the value silently.
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/**
 * The reverse: a wall-clock string the owner typed, as the instant it means.
 *
 * `new Date("2026-09-21T12:00")` is parsed in the RUNTIME's zone, which is the
 * browser — the exact assumption being removed. The offset for that zone on
 * that date is measured and applied instead, so 12:00 typed by an owner in
 * Toronto means the same instant as 12:00 typed by one in Tel Aviv, provided
 * the business is the same.
 *
 * Measured rather than looked up, because the offset depends on the DATE: a
 * booking either side of a daylight-saving change has a different one.
 */
export function fromBusinessLocalInput(local: string, timezone: string): Date {
  const zone = safeTimezone(timezone);

  // Read the wall clock as if it were UTC, then ask how far that guess is from
  // the truth in the target zone, and correct by exactly that much.
  const asUtc = new Date(`${local}:00Z`);
  if (Number.isNaN(asUtc.getTime())) return new Date(NaN);

  const p = partsIn(asUtc, zone);
  const roundTrip = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    p.hour === '24' ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );

  return new Date(asUtc.getTime() - (roundTrip - asUtc.getTime()));
}

/**
 * Where a slot ends, given the wall clock it starts at and how long it runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH ENDS ON THE BUSINESS CLOCK, WHICH IS THE WHOLE POINT.
 *
 * The booking dialog computed this itself, and read the typed start with
 * `new Date(...)` — the browser's clock — before writing the end back on the
 * business's. The two cancel out only when the owner happens to be sitting in
 * their own business's zone, so an owner in Israel running a New York business
 * typed 10:00 for an hour-long service and was shown an end of 04:00: seven
 * hours out, the exact gap between the zones, and before the start. Every
 * appointment, for exactly the owners the timezone setting exists for.
 *
 * It lives here rather than in the dialog because two handlers there need the
 * same answer, and because a calculation that can only be got wrong when the
 * machine is somewhere unusual has to be testable with the machine moved —
 * which `__tests__/crossZone.guard.test.ts` does and a component cannot.
 *
 * NOT `start + duration` on the string: the duration is added to the INSTANT,
 * so an appointment that runs across a daylight-saving change ends at the right
 * wall clock rather than an hour out.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @returns The end as a `datetime-local` string on the business's clock, or
 *   `null` when the start is not a usable wall clock.
 */
export function endOfBusinessLocal(
  startLocal: string,
  durationMinutes: number,
  timezone: string
): string | null {
  const zone = safeTimezone(timezone);

  /*
   * THE SHAPE IS CHECKED HERE, because failing to parse is not what happens.
   *
   * `fromBusinessLocalInput('')` builds `new Date(':00Z')`, and V8 does not
   * reject that — it answers **31 December 1999**. So does `'not a time:00Z'`.
   * An absent start therefore did not produce an Invalid Date anyone could test
   * for; it quietly produced an end in 1999 and wrote it into the field.
   *
   * `datetime-local` emits exactly `YYYY-MM-DDTHH:mm`, with seconds only where a
   * `step` asks for them. Anything else is not a wall clock this can add to.
   */
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startLocal ?? '')) return null;

  const start = fromBusinessLocalInput(startLocal, zone);
  // Belt and braces: a well-shaped string can still name a date that is not
  // real (month 19), and `Intl` throws when asked to format an Invalid Date.
  if (Number.isNaN(start.getTime())) return null;

  const minutes = Number.isFinite(durationMinutes) ? durationMinutes : 0;
  return toBusinessLocalInput(new Date(start.getTime() + minutes * 60 * 1000), zone);
}

/**
 * An instant as a human-readable time on the business's clock.
 *
 * For lists and summaries, where a `datetime-local` string would be unreadable.
 */
export function formatBusinessTime(
  date: Date,
  timezone: string,
  locale: string = 'en-US',
  options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: safeTimezone(timezone) }).format(date);
}

/**
 * The calendar date an instant falls on, on the business's clock.
 *
 * Availability is stored per weekday, so "tomorrow" has to mean tomorrow WHERE
 * THE WORK HAPPENS. Asking the browser gives the wrong day either side of
 * midnight: 9pm Monday in New York is already Tuesday in Tel Aviv, and a slot
 * builder that disagrees about the day offers hours from the wrong one.
 */
export function businessDateKey(date: Date, timezone: string): string {
  const p = partsIn(date, safeTimezone(timezone));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * A business wall clock — a date and an "HH:mm" from its availability — as the
 * instant it means.
 *
 * This is what replaces `setHours()` in the slot builders. `setHours` writes
 * the BROWSER's clock, so a window stored as 09:00–17:00 became 9am wherever
 * the owner's laptop happened to be: 9am in Los Angeles is 6pm in New York, and
 * the dialog offered a client six hours of appointments the business is closed
 * for.
 */
export function businessInstant(dateKey: string, hhmm: string, timezone: string): Date {
  const [hour = '0', minute = '0'] = hhmm.split(':');
  const local = `${dateKey}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  return fromBusinessLocalInput(local, timezone);
}

/**
 * The hour and minute an instant lands on, on the business's clock.
 *
 * For the week grid, which positions a booking by multiplying its hour by a row
 * height. `getHours()` there meant a booking sat in the row matching the
 * OWNER'S LAPTOP: the same 2pm appointment drew in the 2pm row in the office
 * and in the 7am row from abroad, overlapping whatever genuinely was at 7am.
 *
 * Returned as numbers rather than a formatted string because the caller does
 * arithmetic with them, and parsing a formatted time back into a number is how
 * the 12/24-hour bugs start.
 */
export function businessClock(date: Date, timezone: string): { hour: number; minute: number } {
  const p = partsIn(date, safeTimezone(timezone));
  return {
    // "24" is midnight in some engines, and 24 * rowHeight is a whole day off.
    hour: p.hour === '24' ? 0 : Number(p.hour),
    minute: Number(p.minute),
  };
}

/** The same calendar date, `offset` days later, on the business's clock. */
/**
 * `HH:MM` on the business's clock.
 *
 * The form every rule about opening hours is written in — `scheduling_services.
 * availability` and `scheduling_availability_exceptions.custom_hours` both store
 * `'09:00'` strings — so comparing an instant against them needs exactly this
 * and nothing else. Three call sites had written the pad out by hand.
 */
export function businessHhmm(date: Date, timezone: string): string {
  const { hour, minute } = businessClock(date, timezone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function shiftBusinessDateKey(dateKey: string, offset: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Built and read in UTC so the arithmetic cannot pick up a host offset.
  const moved = new Date(Date.UTC(y, m - 1, d + offset));
  return moved.toISOString().slice(0, 10);
}
