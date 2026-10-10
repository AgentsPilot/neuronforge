/**
 * Shared admin formatters (Admin Layout Standard C-5, §5.11). One formatter so
 * every admin page prints time the same way.
 *
 * L-1a ships `formatUtc` only (its consumer is Health's "As of" line).
 * `formatUtcDate` and `formatCount` arrive with the first pilot that uses them.
 *
 * `formatUtc` is a copy of `components/jobs/jobsFormat.ts` `formatUtc`, with
 * identical behaviour, so the L-1b swap in Jobs is a no-op. Jobs keeps its
 * copy until then.
 */

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
