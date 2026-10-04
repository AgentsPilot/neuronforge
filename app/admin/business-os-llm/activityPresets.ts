/**
 * The Activity tab's window presets (FR-B3), resolved in UTC.
 *
 * UTC, not the admin's clock, for the reason `format.ts` gives: two admins
 * reading the same incident must read the same window, and the ledger, the
 * audit trail and the server logs are all UTC. Weeks are ISO weeks (Monday to
 * Sunday). Pure: `now` is passed in, so every edge is testable.
 */

export const ACTIVITY_PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
export type ActivityPreset = (typeof ACTIVITY_PRESETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** UTC midnight of the day `now` falls on. */
function utcMidnight(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** The inclusive UTC dates a preset means, as `YYYY-MM-DD`. */
export function resolvePreset(preset: ActivityPreset, now: Date): { from: string; to: string } {
  const today = utcMidnight(now);
  // Monday = 0 … Sunday = 6 (getUTCDay is Sunday = 0).
  const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - daysSinceMonday * DAY_MS;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  switch (preset) {
    case 'today':
      return { from: isoDate(today), to: isoDate(today) };
    case 'yesterday':
      return { from: isoDate(today - DAY_MS), to: isoDate(today - DAY_MS) };
    case 'this_week':
      return { from: isoDate(monday), to: isoDate(today) };
    case 'last_week':
      return { from: isoDate(monday - 7 * DAY_MS), to: isoDate(monday - DAY_MS) };
    case 'this_month':
      return { from: isoDate(Date.UTC(year, month, 1)), to: isoDate(today) };
    case 'last_month':
      // Day 0 of this month is the last day of the previous one; Date.UTC
      // rolls a negative month back into the previous year.
      return { from: isoDate(Date.UTC(year, month - 1, 1)), to: isoDate(Date.UTC(year, month, 0)) };
  }
}
