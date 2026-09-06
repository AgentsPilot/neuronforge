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
  if (!availability || typeof availability !== 'object') return [];

  const raw = (availability as Record<string, unknown>)[dayName];
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
