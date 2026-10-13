/**
 * "Every Tuesday at 10, twelve times" — expanded into twelve real dates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE IS AN INPUT METHOD, NOT A RECORD.
 *
 * `proposals.sessions` stores explicit dates and will keep doing so: the dates
 * are what the client agreed to, a dispute reads them, and every reader — the
 * diary, the email, the client's own calendar — needs the moments rather than a
 * rule it has to re-expand and possibly disagree about.
 *
 * What was wrong was making the OWNER type them. Twelve pickers is not a
 * feature. So the rule lives here, in front of the storage: the owner describes
 * the pattern once, this expands it, and every date stays individually editable
 * afterwards — which is what you need the moment one week is a holiday.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT STEPS DATES AND LEAVES THE CLOCK ALONE.
 *
 * Every function here works on `YYYY-MM-DD` keys and never on instants. That is
 * what makes "weekly at 10:00" stay at 10:00 across a daylight-saving change:
 * the hour the owner typed is applied once, at the end, on the business's
 * clock. Stepping instants by 7 × 24 hours moves the appointment an hour in
 * spring and an hour back in autumn — correct arithmetic, wrong answer.
 *
 * MONTHLY IS BY DAY OF MONTH, clamped. The 31st of January repeats on the 28th
 * of February (29th in a leap year) and then on the 31st of March — anchored to
 * the ORIGINAL day, so a short month does not drag the whole series earlier.
 * "A month is not 30 days" is the same lesson `planSchedule` records about
 * instalments.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly';

/** How many days each cadence steps, where it steps in days at all. */
const DAY_STEP: Partial<Record<Cadence, number>> = { weekly: 7, biweekly: 14 };

/** The cap is a year of weekly sessions. Beyond that it is a subscription. */
export const MAX_OCCURRENCES = 52;

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Days in a month, 1-indexed month. Handles leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The date keys of a recurring series, starting ON the first one.
 *
 * @param firstKey `YYYY-MM-DD`, the first meeting's date
 * @param count    how many meetings in total, including the first
 * @returns `count` keys, or `[]` if the inputs make no sense
 */
export function recurringDateKeys(firstKey: string, cadence: Cadence, count: number): string[] {
  if (!isDateKey(firstKey)) return [];
  if (!Number.isFinite(count) || count < 1) return [];

  const total = Math.min(Math.floor(count), MAX_OCCURRENCES);
  const [year, month, day] = firstKey.split('-').map(Number);

  const step = DAY_STEP[cadence];
  if (step) {
    /*
     * Noon UTC as the anchor, purely to do calendar arithmetic without a zone:
     * midnight is one DST hour away from the previous day in several zones, and
     * this function must not know or care which zone the business is in.
     */
    const anchor = Date.UTC(year, month - 1, day, 12);
    return Array.from({ length: total }, (_, i) => {
      const at = new Date(anchor + i * step * 86_400_000);
      return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
    });
  }

  // Monthly: the same day of the month, clamped to the month's length, and
  // always measured from the ORIGINAL day rather than the last one used.
  return Array.from({ length: total }, (_, i) => {
    const monthIndex = month - 1 + i;
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonth = (monthIndex % 12) + 1;
    const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
    return `${targetYear}-${pad(targetMonth)}-${pad(clampedDay)}`;
  });
}

/**
 * The same series as `datetime-local` values, which is what the date inputs in
 * the quote dialog hold.
 *
 * @param time `HH:MM` on the BUSINESS's clock — the hour the client turns up at
 */
export function recurringLocalInputs(
  firstKey: string,
  time: string,
  cadence: Cadence,
  count: number
): string[] {
  if (!/^\d{2}:\d{2}$/.test(time)) return [];
  return recurringDateKeys(firstKey, cadence, count).map(key => `${key}T${time}`);
}

/**
 * Which cadence produced a series, read back from its dates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: THE SERIES IS THE ONLY RECORD OF ITS OWN RHYTHM.
 *
 * A quote stores `sessions.dates` and nothing else — six instants, with no
 * field saying how they were spaced. So reopening a fortnightly package showed
 * its six correct dates above a cadence chip reading "every week", because the
 * chip had no source but its own initial value.
 *
 * That is not only a wrong label. The chip drives regeneration: changing the
 * first meeting or the count re-spaces every date after it, so a fortnightly
 * course edited through a chip that says weekly collapses to weekly.
 *
 * Strictly the inverse of `recurringDateKeys` — it asks that function, rather
 * than measuring the gap itself, so the two can never disagree about a month.
 * A hand-adjusted series matches no cadence and returns null: better to say
 * nothing than to name a rhythm the dates do not actually follow.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param keys `YYYY-MM-DD` keys, in order, starting with the first meeting
 * @returns the cadence that generates exactly these keys, or `null`
 */
export function cadenceOf(keys: string[]): Cadence | null {
  if (keys.length < 2 || !keys.every(isDateKey)) return null;

  const cadences: Cadence[] = ['weekly', 'biweekly', 'monthly'];

  return (
    cadences.find(cadence => {
      const generated = recurringDateKeys(keys[0], cadence, keys.length);
      return (
        generated.length === keys.length && generated.every((key, i) => key === keys[i])
      );
    }) ?? null
  );
}

/**
 * Where the next meeting of a series falls.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A package's seventh meeting is not an arbitrary hour. A course that runs
 * every second Thursday at 09:30 runs every second Thursday at 09:30 — that is
 * what the client agreed to and what their diary says. Opening the booking
 * dialog on "tomorrow, the next free hour" asks the owner to work out a date
 * the series already decided, and invites a date that breaks the rhythm.
 *
 * So: take the last meeting, step once by the cadence the series is actually
 * spaced at, and keep its time of day.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DIARY DRIFTS, AND AN AGREEMENT DOES NOT.
 *
 * On the reporting account the second session was moved from the 22nd to the
 * 23rd, so the real gaps read 15, 13, 14, 14 days. No cadence generates that,
 * and the whole series went unnamed — the dialog opened on today, for a course
 * that is plainly fortnightly. One rescheduled meeting must not cost the other
 * five their rhythm.
 *
 * So `agreed` is the second opinion: the dates the QUOTE sold, which never
 * move. Where the diary names no cadence and the agreement does, the next
 * meeting is one step past THE LAST MEETING IN THE DIARY — not past the last
 * one sold, which would propose a date already behind, and would propose the
 * same one again every time the owner added another.
 *
 * Returns null only when neither can name a rhythm. The caller then falls back
 * to its own default, which is honest: nothing here knows where the next one
 * goes.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param locals the meetings as `YYYY-MM-DDTHH:MM` on the BUSINESS's clock,
 *               in any order
 * @param agreed the dates the quote sold, same form — used only when the diary
 *               itself has drifted off the pattern
 * @returns the next one in the same form, or `null`
 */
export function nextInSeries(locals: string[], agreed?: string[]): string | null {
  const ordered = [...locals].filter(local => local && local.length >= 16).sort();
  if (ordered.length < 1) return null;

  const keys = ordered.map(local => local.slice(0, 10));
  const cadence = ordered.length >= 2 ? cadenceOf(keys) : null;

  if (!cadence) {
    /*
     * The agreement's rhythm, applied to the diary's last meeting. Stepped
     * rather than regenerated because the series demonstrably does NOT follow
     * the pattern from its first date — regenerating would propose a date the
     * diary has already passed.
     */
    const sold = [...(agreed ?? [])].filter(local => local && local.length >= 10).sort();
    const soldCadence = sold.length >= 2 ? cadenceOf(sold.map(local => local.slice(0, 10))) : null;
    if (!soldCadence) return null;

    const last = ordered[ordered.length - 1];
    const step = recurringDateKeys(last.slice(0, 10), soldCadence, 2);
    if (step.length < 2) return null;

    return `${step[1]}T${last.slice(11, 16)}`;
  }

  /*
   * Generated from the FIRST meeting, one occurrence longer — not stepped from
   * the last one.
   *
   * Monthly is measured from the original day of the month and clamped to each
   * month's length, so a series anchored on the 31st reads 31 Jan, 28 Feb, 31
   * Mar. Stepping from 28 Feb would take the clamp as the anchor and give 28
   * Mar, quietly walking the whole series backwards a few days a year. Asking
   * the generator for one more of the same series cannot drift from it.
   */
  const whole = recurringDateKeys(keys[0], cadence, ordered.length + 1);
  if (whole.length <= ordered.length) return null;

  const last = ordered[ordered.length - 1];
  return `${whole[whole.length - 1]}T${last.slice(11, 16)}`;
}
