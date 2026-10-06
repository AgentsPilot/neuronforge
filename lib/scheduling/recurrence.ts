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
