/**
 * Formatting shared by the Scheduled jobs & queues view and its per-queue item
 * list (moved here from JobsQueuesView.tsx by ADMIN_BOS_CLEANUP slice 7a,
 * OP-13, so the two share one copy without a circular import). No behaviour
 * change. A plain module, not a component: no imports, no 'use client'.
 *
 * Admin Layout Standard L-1b (C-5, CR-4): `formatUtc` moved out. Every Jobs
 * file prints time through the shared `app/admin/components/layout/adminFormat.ts`,
 * which has the same behaviour. `ageWords` stays here.
 */

/** "25 min", "4 h 0 min", "3 d 2 h"; "none" without a value. */
export function ageWords(minutes: number | null): string {
  if (minutes === null) return 'none';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}
