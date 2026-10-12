/**
 * Shared admin formatters (Admin Layout Standard C-5, §5.11). One formatter so
 * every admin page prints time the same way.
 *
 * L-1a shipped `formatUtc` (Health's "As of" line); L-1b adds `formatCount`
 * (the Jobs KPI values); L-1c adds `formatUtcTime` (the filter bar's "Read at"
 * line). `formatUtcDate` arrives with the first pilot that uses it.
 *
 * `formatUtc` began as a copy of the Jobs formatter. Since L-1b Jobs has no
 * copy of its own: every Jobs file prints time through this one (CR-4).
 */

import { isRealDate } from '@/app/admin/components/adminWindowPresets';

/**
 * "YYYY-MM-DD HH:mm UTC" for any ISO timestamp, whatever its offset. The value
 * is converted to UTC through Date, never sliced as text, so a database that
 * answers in another timezone (e.g. "+02:00") can never show a local time
 * labelled "UTC" (F-58). Em dash for null or an invalid value.
 */
export function formatUtc(iso: string | null): string {
  if (!iso) return '—';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '—';
  const utcIso = time.toISOString();
  return `${utcIso.slice(0, 10)} ${utcIso.slice(11, 16)} UTC`;
}

/**
 * Thousands separators per §5.11 ("12,345"), always en-US so every admin
 * shows the same digits whatever the browser locale. Em dash for a value
 * that is not a finite number (NaN, Infinity), never "NaN".
 */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

/**
 * "HH:mm UTC" for any ISO timestamp (the filter bar's "Read at HH:mm UTC",
 * §5.5 part 6). Through Date like `formatUtc`, so an offset instant shows its
 * UTC time. Em dash for null or an invalid value.
 */
export function formatUtcTime(iso: string | null): string {
  const full = formatUtc(iso);
  return full === '—' ? full : full.slice(11);
}

/**
 * A date-only value ("YYYY-MM-DD", a SQL DATE such as a due date) shown as that
 * same calendar date in any process time zone (§5.11; INV-00013). Arrived with
 * its first pilot, finance slice 2b (AC-74). It is never passed through a Date:
 * a real date is returned as its own text, so no time zone can move it a day.
 * Em dash for null, a date that does not exist, or anything that is not
 * date-only (a timestamp goes through `formatUtc`).
 */
export function formatUtcDate(value: string | null): string {
  if (value === null || !isRealDate(value)) return '—';
  return value;
}
