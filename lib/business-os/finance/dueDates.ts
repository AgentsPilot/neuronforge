/**
 * Date-only due dates (finance & business health slice 2b, S2-F5, SA-W33,
 * AC-57, AC-74). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md § Date-only
 * due dates.
 *
 * A due date is a SQL DATE, sent as `YYYY-MM-DD` text. It is a calendar day,
 * not an instant, so it is NEVER passed through a Date here (INV-00013: a
 * date-only value read as midnight UTC shows the day before in any zone west
 * of UTC). Every comparison is on the text, after `isRealDate`; the one day
 * count goes through the shared presets helper, which anchors both days at
 * an explicit `T00:00:00.000Z` and reads them back in UTC.
 *
 * PURE: no clock. Today's UTC date is computed once by the builder from the
 * request's one clock (`todayUtc(now)`) and passed in.
 *
 * @module lib/business-os/finance/dueDates
 */

import { inclusiveDays, isRealDate } from '@/app/admin/components/adminWindowPresets';

/** A real calendar date written `YYYY-MM-DD`. Anything else, NULL included, is not a due date ("Unknown"). */
export function isDueDate(value: unknown): value is string {
  return typeof value === 'string' && isRealDate(value);
}

/**
 * Past due = strictly before today's UTC date: a due date equal to today is
 * NOT past due (AC-57). `YYYY-MM-DD` text orders like the dates it names, so
 * the comparison is on the text, only after both are checked. A due date that
 * is not a real date is never past due by accident.
 */
export function isPastDue(dueDate: unknown, todayUtc: string): boolean {
  return isDueDate(dueDate) && isDueDate(todayUtc) && dueDate < todayUtc;
}

/** Whole UTC days from the due date to today (0 on the due date itself); null when either is not a real date. */
export function daysPastDue(dueDate: unknown, todayUtc: string): number | null {
  if (!isDueDate(dueDate) || !isDueDate(todayUtc)) return null;
  return inclusiveDays(dueDate, todayUtc) - 1;
}
