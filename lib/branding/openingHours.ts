/**
 * A business's weekly availability, said the way a visitor reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * "When are they open?" is the commonest question a small business's website is
 * asked, and until now the only way to answer it here was to start a booking
 * and look at which slots were offered. The hours were never missing — every
 * business that can publish has set them, because publishing is gated on it —
 * they simply had nowhere to appear.
 *
 * `contactBlockContent.ts` said as much in a comment: *"No profile column holds
 * opening hours as display copy, so this stays the block's own until there is
 * one to read."* True of a display string, but `scheduling_availability` holds
 * the hours themselves. This turns the one into the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DAYS ARE COLLAPSED
 *
 * Seven lines, five of them identical, is a table nobody reads. What a visitor
 * wants is the shape of the week — "Sun–Thu 09:00–17:00, Fri 09:00–13:00" —
 * and the exceptions are the part worth their attention.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE WEEK STARTS ON SUNDAY
 *
 * The stored object is keyed that way, and it is the working week of the market
 * this serves. Rotating to a Monday start for English would also mean collapsing
 * runs across the wrap — Sunday joining the end of the week it began — which is
 * a lot of cleverness spent making a correct answer look foreign to half the
 * businesses using it.
 *
 * @module lib/branding/openingHours
 */

export interface OpeningHoursRow {
  /** "Sun–Thu", or a single day. */
  days: string;
  /** "09:00–17:00", or two ranges joined, or the closed word. */
  hours: string;
}

type Slot = { start: string; end: string };
type Availability = Record<string, Slot[] | undefined>;

/** Keyed as the scheduling settings write them. */
const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const DAY_NAMES: Record<string, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
};

const CLOSED: Record<string, string> = {
  en: 'Closed',
  es: 'Cerrado',
  he: 'סגור',
};

/** The en dash pair readers expect, not a hyphen. */
const RANGE = '–';

function dayNames(locale: string): string[] {
  return DAY_NAMES[locale] ?? DAY_NAMES.en;
}

/**
 * One day's slots as a single string, or null when the day is not worked.
 *
 * Two slots means a business that closes for lunch, which is worth showing —
 * a visitor who turns up at 14:00 because the site said "09:00–18:00" has been
 * misled by a simplification.
 */
function dayHours(slots: Slot[] | undefined): string | null {
  if (!Array.isArray(slots) || slots.length === 0) return null;

  const ranges = slots
    .filter(slot => typeof slot?.start === 'string' && typeof slot?.end === 'string')
    .map(slot => `${slot.start}${RANGE}${slot.end}`);

  return ranges.length > 0 ? ranges.join(', ') : null;
}

/**
 * The week as a handful of rows, consecutive days with identical hours merged.
 *
 * Closed days are omitted rather than listed: a visitor reads this to find out
 * when they CAN come, and a business open two days a week should not have five
 * lines of "Closed" above the two that matter. The exception is a week with a
 * single gap in the middle of a run, which stays visible simply by breaking the
 * run in two.
 *
 * Returns an empty array for a business with no hours set, which every caller
 * must treat as "do not render this section" — an empty hours heading is worse
 * than no heading.
 */
export function openingHoursRows(
  availability: unknown,
  locale: string = 'en'
): OpeningHoursRow[] {
  if (!availability || typeof availability !== 'object') return [];

  const week = availability as Availability;
  const names = dayNames(locale);
  const rows: OpeningHoursRow[] = [];

  let runStart = -1;
  let runHours: string | null = null;

  const closeRun = (endIndex: number) => {
    if (runStart < 0 || !runHours) return;
    rows.push({
      days:
        runStart === endIndex
          ? names[runStart]
          : `${names[runStart]}${RANGE}${names[endIndex]}`,
      hours: runHours,
    });
    runStart = -1;
    runHours = null;
  };

  WEEK.forEach((key, index) => {
    const hours = dayHours(week[key]);

    if (hours === null) {
      // A closed day ends whatever run was open and is not itself recorded.
      closeRun(index - 1);
      return;
    }

    if (hours !== runHours) {
      closeRun(index - 1);
      runStart = index;
      runHours = hours;
    }
  });

  closeRun(WEEK.length - 1);

  return rows;
}

/** The word for a business with hours set on no day at all. */
export function closedLabel(locale: string = 'en'): string {
  return CLOSED[locale] ?? CLOSED.en;
}
