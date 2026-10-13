/**
 * The shared admin date-window presets (finance & business health slice 1a,
 * SA-Q2): Today, 7d, 30d, This month, and Custom. Resolved in UTC.
 *
 * A SIBLING of `app/admin/business-os-llm/activityPresets.ts`, not an edit of
 * it: that module's list drives the Activity tab's buttons. `today` and
 * `this_month` resolve exactly as Activity's do (pinned by a parity test).
 * `7d` / `30d` are the last 7 / 30 UTC days INCLUDING today.
 *
 * PURE and isomorphic (SA-W8): no React, no `'use client'`, no server-only
 * import. The admin page and the admin route both import it; the route
 * re-resolves the preset with its own clock, so the URL is input, never
 * authority.
 */

export const ADMIN_WINDOW_PRESETS = ['today', '7d', '30d', 'this_month'] as const;
export type AdminWindowPreset = (typeof ADMIN_WINDOW_PRESETS)[number];

/** Every value the `preset` filter accepts: the presets plus a custom range. */
export const ADMIN_WINDOW_CHOICES = [...ADMIN_WINDOW_PRESETS, 'custom'] as const;
export type AdminWindowChoice = (typeof ADMIN_WINDOW_CHOICES)[number];

/**
 * The longest custom window, in INCLUSIVE days. A literal, not an import of
 * `CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS`, so the browser bundle does not pull
 * in a server module; the test pins the two equal.
 */
export const ADMIN_WINDOW_MAX_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** UTC midnight of the day `now` falls on. */
function utcMidnight(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Today's UTC date, `YYYY-MM-DD`. */
export function todayUtc(now: Date): string {
  return isoDate(utcMidnight(now));
}

/** A real calendar date written `YYYY-MM-DD` (rejects 2026-02-30). */
export function isRealDate(value: string): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Days from `from` to `to`, both counted. Both must be real dates. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}

/** The inclusive UTC dates a preset means, as `YYYY-MM-DD`. */
export function resolveAdminWindow(preset: AdminWindowPreset, now: Date): { from: string; to: string } {
  const today = utcMidnight(now);
  switch (preset) {
    case 'today':
      return { from: isoDate(today), to: isoDate(today) };
    case '7d':
      return { from: isoDate(today - 6 * DAY_MS), to: isoDate(today) };
    case '30d':
      return { from: isoDate(today - 29 * DAY_MS), to: isoDate(today) };
    case 'this_month':
      return { from: isoDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: isoDate(today) };
  }
}

/**
 * Why a custom range is refused, or null when it is usable. The same rules the
 * route's Zod schema applies (to not before from, not after today UTC, at most
 * `ADMIN_WINDOW_MAX_DAYS` inclusive days), so the page's URL parser and the
 * server cannot disagree.
 */
export function customRangeProblem(from: string, to: string, now: Date): string | null {
  if (!isRealDate(from) || !isRealDate(to)) return 'Dates must be real dates, YYYY-MM-DD';
  if (from > to) return 'The start date must not be after the end date';
  if (to > todayUtc(now)) return 'The end date must not be after today (UTC)';
  if (inclusiveDays(from, to) > ADMIN_WINDOW_MAX_DAYS) {
    return `The window may be at most ${ADMIN_WINDOW_MAX_DAYS} days`;
  }
  return null;
}
