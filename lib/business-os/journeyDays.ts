/**
 * A booking's journey, grouped into the days it actually happened on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The journey strip rendered every step as an evenly spaced row, which says the
 * same thing about a booking whether its steps happened in one afternoon or
 * across a month. For the booking this was designed against, four things
 * happened between 15:32 and 16:02 on 2 September and the session is on the
 * 29th — twenty-seven days later, drawn as one more identical row.
 *
 * So the strip is dated instead: one marker per DAY, the entries beneath it,
 * and the wait between days given its own segment. That last part is often the
 * most useful thing on the screen, because a long gap is where clients go quiet.
 *
 * Pure, and separate from the component, because the grouping is the part worth
 * testing: undated steps, everything on one day, and a gap that spans a month
 * all have to come out right, and none of them is convenient to reproduce by
 * clicking through a drawer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/journeyDays
 */

/** Only what the grouping needs; the caller's step type can carry anything else. */
export interface DatedStep {
  timestamp?: string | null;
}

export interface JourneyDayGroup<T> {
  kind: 'day';
  /** `YYYY-MM-DD` in local time, or `undated`. Stable, so it can be a React key. */
  key: string;
  /** Midnight of that day, or null for the undated group. */
  date: Date | null;
  steps: T[];
}

export interface JourneyWaitGroup {
  kind: 'wait';
  key: string;
  /** Whole days between the two groups either side of this gap. */
  days: number;
}

export type JourneyGroup<T> = JourneyDayGroup<T> | JourneyWaitGroup;

const DAY_MS = 86_400_000;

/**
 * How long a gap has to be before it is worth drawing.
 *
 * Consecutive days are just the journey moving along. A week is a wait, and it
 * is the thing an owner wants to see — so this sits low enough to catch a
 * client who went quiet and high enough not to annotate every ordinary booking.
 */
export const WAIT_THRESHOLD_DAYS = 3;

/** Local midnight, so a 23:50 step and a 00:10 step are different days. */
function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parse(timestamp: string | null | undefined): Date | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Group steps by day, in the order given, with waits between distant days.
 *
 * ORDER IS PRESERVED, deliberately: the caller has already decided what order
 * the journey reads in, and re-sorting here would silently reorder a booking
 * whose steps are intentionally sequenced rather than chronological.
 *
 * UNDATED STEPS keep their place rather than being dropped or swept to the end.
 * A step with no timestamp is usually one that has not happened yet — the
 * session itself, an intake form not yet returned — and it belongs where the
 * journey puts it, not in a bucket at the bottom.
 */
export function groupJourneyByDay<T extends DatedStep>(steps: T[]): JourneyGroup<T>[] {
  const groups: JourneyGroup<T>[] = [];
  let current: JourneyDayGroup<T> | null = null;

  for (const step of steps) {
    const at = parse(step.timestamp);
    const key = at ? dayKey(at) : 'undated';

    if (current && current.key === key) {
      current.steps.push(step);
      continue;
    }

    /*
     * A gap worth drawing, between two DATED days.
     *
     * Measured from midnight to midnight so "2 Sep 23:00 → 3 Sep 08:00" is one
     * day rather than nine hours, which is how a person reads a calendar.
     */
    if (current?.date && at) {
      const gap = Math.round((startOfDay(at).getTime() - current.date.getTime()) / DAY_MS);

      if (gap >= WAIT_THRESHOLD_DAYS) {
        groups.push({ kind: 'wait', key: `wait-${current.key}-${key}`, days: gap });
      }
    }

    current = { kind: 'day', key, date: at ? startOfDay(at) : null, steps: [step] };
    groups.push(current);
  }

  return groups;
}
