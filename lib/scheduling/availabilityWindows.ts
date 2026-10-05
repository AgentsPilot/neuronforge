/**
 * Reading working hours out of `business_profiles.scheduling_availability`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COLUMN, THREE READERS, THREE DIFFERENT ASSUMPTIONS.
 *
 * The editor writes an ARRAY of ranges per day, because a day can have more
 * than one — a morning and an evening with a gap between them:
 *
 *   { "monday": [{ "start": "09:00", "end": "17:00" }], "friday": [] }
 *
 * But only one of the three endpoints that read it agreed. The public booking
 * page expected a single `{ start, end }` and asked for `.start` on an array,
 * getting `undefined` and skipping every day. The website booking endpoint
 * expected an older `{ start, end, enabled }` and asked for `.enabled`, getting
 * `undefined` and skipping every day. Both then reported success with zero
 * slots, so a business with Sunday to Wednesday 09:00-17:00 configured showed
 * clients no times at all, and nothing anywhere said why.
 *
 * So the shapes are handled once, here, and the readers ask this instead of
 * reaching into the JSON themselves. All three historical shapes are accepted:
 * rows written by older versions are still in the table, and a migration that
 * rewrote them would have to be right about every one of them on the first try.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface AvailabilityWindow {
  /** `HH:MM`, 24-hour. */
  start: string;
  end: string;
}

/** Sunday first, matching `Date.getDay()`. */
export const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value);
}

/**
 * One day's windows, whatever shape the row was written in.
 *
 * Returns `[]` for a closed day - including the zero-length window an editor
 * can produce when a day is switched off by setting its start equal to its end.
 * A window whose end is not after its start would generate no slots anyway, and
 * dropping it here keeps that decision in one place rather than in each caller's
 * loop condition.
 */
export function windowsForDay(
  availability: unknown,
  dayName: string
): AvailabilityWindow[] {
  if (!availability) return [];

  /*
   * The column is sometimes a JSON STRING, not an object.
   *
   * `countOpenDays` in the stats route has always parsed for this case, and
   * this did not — it returned no windows for a string, so the two disagreed
   * about the same row: readiness counted open days while every caller of this
   * (the publish gate, the booking page, the journey check) read the business
   * as having no hours at all.
   *
   * Parsed here rather than at each call site, because "what are this day's
   * windows" is exactly the question this function exists to answer, whatever
   * shape the column came back in.
   */
  let source: unknown = availability;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return [];
    }
  }

  if (!source || typeof source !== 'object') return [];

  const raw = (source as Record<string, unknown>)[dayName];
  if (!raw) return [];

  // An array of ranges (current), or a single range object (older rows).
  const candidates = Array.isArray(raw) ? raw : [raw];

  return candidates.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const window = entry as Record<string, unknown>;

    // The oldest shape carried `enabled`. Absent means enabled - an array entry
    // exists precisely because the day is open, and requiring the flag is what
    // made the website endpoint skip every day.
    if (window.enabled === false) return [];

    if (!isTime(window.start) || !isTime(window.end)) return [];
    if (window.end <= window.start) return [];

    return [{ start: window.start, end: window.end }];
  });
}

/** Whether any day has an open window. */
export function hasAnyAvailability(availability: unknown): boolean {
  return DAY_NAMES.some(day => windowsForDay(availability, day).length > 0);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * TIME OFF: the one date that is not like its weekday
 *
 * `scheduling_availability_exceptions` has been in the schema since 20260722
 * with full RLS, and until now NOTHING read it and nothing wrote it — its only
 * other appearances in the tree were the data-ownership and purge registries.
 * So a business closed for a holiday went on publishing slots for it, and a
 * client could book a day the owner was away. The owner's only defence was to
 * notice and cancel.
 *
 * Applied HERE, in the function every surface already asks "what are this day's
 * hours": the public booking page, the smart-link page, the publish gate and the
 * journey check. Adding it to each caller instead is how the booking page and
 * the website endpoint came to disagree about `enabled` — the bug the comment
 * above records.
 * ───────────────────────────────────────────────────────────────────────────── */

/** One row of `scheduling_availability_exceptions`, as this file needs it. */
export interface TimeOffEntry {
  /** `'unavailable'` closes the dates; `'custom_hours'` replaces their hours. */
  exception_type?: string | null;
  /**
   * What the owner called it — 'Sukkot', 'annual leave'.
   *
   * Nothing that computes an hour reads this; it exists so a refusal can name
   * the day back to the owner. "You are closed on 7 Oct (Sukkot)" is actionable
   * where "you are closed" invites a hunt through the settings dialog.
   */
  reason?: string | null;
  /** `YYYY-MM-DD`, inclusive, in the business's own calendar. */
  start_date?: string | null;
  end_date?: string | null;
  /** `{ start: 'HH:MM', end: 'HH:MM' }` when the type is `custom_hours`. */
  custom_hours?: { start?: unknown; end?: unknown } | null;
}

/**
 * The weekday name `windowsForDay` expects, for a calendar date.
 *
 * Noon UTC, purely to name the day: `new Date('2026-09-21')` is midnight UTC,
 * and reading its weekday in any zone behind UTC gives the day before. Three
 * call sites wrote this out separately; it lives here now so a fourth cannot
 * get it wrong.
 */
export function weekdayNameFor(dateKey: string): string {
  const at = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  return DAY_NAMES[at.getUTCDay()];
}

/**
 * Whether a date key falls inside an entry's inclusive range.
 *
 * Exported so `closedDay.ts` can ask the same question this file answers. Two
 * copies of an inclusive-range rule is how one surface ends up disagreeing with
 * another about whether the last day of a holiday is closed.
 */
export function covers(entry: TimeOffEntry, dateKey: string): boolean {
  const from = typeof entry.start_date === 'string' ? entry.start_date.slice(0, 10) : null;
  const to = typeof entry.end_date === 'string' ? entry.end_date.slice(0, 10) : from;
  if (!from || !to) return false;
  // ISO dates compare correctly as strings, which is why the column is a DATE.
  return dateKey >= from && dateKey <= to;
}

/**
 * One DATE's windows: its weekday's hours, with time off applied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three rules, in this order:
 *
 *   1. Any `unavailable` entry covering the date closes it. Closed wins over
 *      everything — an owner who has recorded both "away" and "short hours" for
 *      one date is away.
 *
 *   2. A `custom_hours` entry REPLACES the weekday's windows rather than
 *      narrowing them. "On this date my hours are 09:00–13:00" is what the
 *      owner said, and replacing handles both cases with one rule: a short day,
 *      and opening a day that is normally closed. Intersecting would have
 *      silently refused the second.
 *
 *   3. Otherwise the weekday's ordinary hours.
 *
 * An entry whose times cannot be read closes the date. The owner recorded an
 * intention to RESTRICT it, and a restriction we cannot parse must not be read
 * as business as usual — losing a day's bookings is recoverable, selling an hour
 * the owner is not there for is not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function windowsForDate(
  availability: unknown,
  dateKey: string,
  timeOff: TimeOffEntry[] = []
): AvailabilityWindow[] {
  const day = weekdayNameFor(dateKey);
  if (!day) return [];

  const onThisDate = (timeOff || []).filter(entry => covers(entry, dateKey));

  if (onThisDate.some(entry => entry.exception_type === 'unavailable')) return [];

  const custom = onThisDate.find(entry => entry.exception_type === 'custom_hours');
  if (custom) {
    const start = custom.custom_hours?.start;
    const end = custom.custom_hours?.end;
    if (!isTime(start) || !isTime(end) || end <= start) return [];
    return [{ start, end }];
  }

  return windowsForDay(availability, day);
}
