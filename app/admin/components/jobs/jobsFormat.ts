/**
 * Formatting shared by the Scheduled jobs & queues view and its per-queue item
 * list (moved here from JobsQueuesView.tsx by ADMIN_BOS_CLEANUP slice 7a,
 * OP-13, so the two share one copy without a circular import). No behaviour
 * change. A plain module, not a component: no imports, no 'use client'.
 */

/**
 * "YYYY-MM-DD HH:mm UTC" for any ISO timestamp, whatever its offset (QA-L2).
 * The value is converted to UTC through Date, never sliced as text, so a
 * database that answers in another timezone (e.g. "+02:00") can never show a
 * local time labelled "UTC".
 */
export function formatUtc(iso: string | null): string {
  if (!iso) return '—';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '—';
  const utcIso = time.toISOString();
  return `${utcIso.slice(0, 10)} ${utcIso.slice(11, 16)} UTC`;
}

/** "25 min", "4 h 0 min", "3 d 2 h"; "none" without a value. */
export function ageWords(minutes: number | null): string {
  if (minutes === null) return 'none';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}
