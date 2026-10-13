/**
 * The admin time window, pure (Admin Layout Standard C-8, §5.6 U-6 to U-8).
 *
 * What the filter bar's Window control holds, how it lives in the URL
 * (`range`, `from`, `to`) and what dates it means. Presets resolve through
 * `adminWindowPresets.ts` (SA ruling on L-1b Q-13 / L-1c Q-2: reused in place,
 * the one named S-3 exception), so the finance page and every layout page
 * agree on what "7 days" means.
 *
 * Two kinds of explicit window share `range=custom` and are told apart by the
 * form of their bounds: whole UTC dates (`custom`, what the Custom row applies)
 * and minute-form or ISO-instant bounds (`linked`, what inbound links such as
 * the Health tiles carry). Linked bounds are kept byte for byte (U-7, SA-R-1)
 * and a minute is never passed through Date, which would read it as local time.
 *
 * L-2a adds the window extras (D-2 (b)): windows a page already offered beyond
 * the standard five, kept as a page's own buttons. They are opt-in per page
 * (`windowFilter({ extras })`, `DatePresets extras`), so a page that lists none
 * still ignores `range=90d` (U-4).
 *
 * L-8a adds Business OS AI Activity's four (D-2 (b), U-6 names): `yesterday`,
 * `this_week`, `last_week`, `last_month`, resolved to whole UTC dates with ISO
 * weeks (Monday to Sunday), exactly as that page's own `activityPresets.ts`
 * did. The resolution is copied here, not imported, because the shared folder
 * may not import a page folder (S-3); a parity test beside the existing one in
 * `app/admin/components/__tests__/` pins the two equal.
 */

import {
  ADMIN_WINDOW_PRESETS,
  isRealDate,
  resolveAdminWindow,
  todayUtc,
  type AdminWindowPreset,
} from '@/app/admin/components/adminWindowPresets';
import { formatUtc } from './adminFormat';
import type { AdminFilterField } from './useAdminFilters';

/** What the Window control holds. */
export type AdminWindowValue =
  | { kind: 'none' }
  | { kind: 'preset'; preset: AdminWindowPreset }
  | { kind: 'custom'; from: string | null; to: string | null }
  | { kind: 'linked'; from: string | null; to: string | null }
  | { kind: 'extra'; extra: AdminWindowExtra };

/** Only what a page keeps today (D-2 (b)); a later page adds its own here. */
export const ADMIN_WINDOW_EXTRAS = ['24h', '90d', 'yesterday', 'this_week', 'last_week', 'last_month'] as const;
export type AdminWindowExtra = (typeof ADMIN_WINDOW_EXTRAS)[number];

export const ADMIN_WINDOW_EXTRA_LABELS: Readonly<Record<AdminWindowExtra, string>> = {
  '24h': '24 hours',
  '90d': '90 days',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  last_month: 'Last month',
};

export const ADMIN_WINDOW_LABELS: Readonly<Record<AdminWindowPreset | 'custom', string>> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  this_month: 'This month',
  custom: 'Custom',
};

export function isAdminWindowPreset(value: string): value is AdminWindowPreset {
  return (ADMIN_WINDOW_PRESETS as readonly string[]).includes(value);
}

const MINUTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

type BoundForm = 'date' | 'minute' | 'instant';

const inRange = (text: string | undefined, max: number) => text === undefined || Number(text) <= max;

/** The form of one bound, or null when it is none of the three U-7 forms (then it is ignored, U-4). */
export function boundForm(raw: string): BoundForm | null {
  if (isRealDate(raw)) return 'date';
  const minute = MINUTE.exec(raw);
  if (minute) {
    return isRealDate(minute[1]) && inRange(minute[2], 23) && inRange(minute[3], 59) ? 'minute' : null;
  }
  const instant = INSTANT.exec(raw);
  if (instant) {
    const [, date, hours, minutes, seconds, offsetHours, offsetMinutes] = instant;
    const fieldsOk =
      isRealDate(date) &&
      inRange(hours, 23) &&
      inRange(minutes, 59) &&
      inRange(seconds, 59) &&
      inRange(offsetHours, 23) &&
      inRange(offsetMinutes, 59);
    return fieldsOk && Number.isFinite(Date.parse(raw)) ? 'instant' : null;
  }
  return null;
}

/**
 * Parses the window's canonical keys (after the hook has applied the aliases).
 * `range` names an extra only when the page lists that extra.
 */
export function parseWindow(
  get: (key: string) => string | null,
  extras: readonly AdminWindowExtra[] = [],
): AdminWindowValue | undefined {
  const range = get('range');
  if (range !== null && isAdminWindowPreset(range)) return { kind: 'preset', preset: range };
  const extra = extras.find((listed) => listed === range);
  if (extra !== undefined) return { kind: 'extra', extra };

  // `from` / `to` present with `range` absent, `custom` or unknown: custom is implied (U-7).
  const rawFrom = get('from');
  const rawTo = get('to');
  const fromForm = rawFrom === null ? null : boundForm(rawFrom);
  const toForm = rawTo === null ? null : boundForm(rawTo);
  const from = fromForm ? rawFrom : null;
  const to = toForm ? rawTo : null;
  if (from === null && to === null) return undefined;

  if (fromForm === 'minute' || fromForm === 'instant' || toForm === 'minute' || toForm === 'instant') {
    // No ordering check: the route has always been given these as sent.
    return { kind: 'linked', from, to };
  }
  if (from !== null && to !== null && from > to) return undefined;
  return { kind: 'custom', from, to };
}

export function serialiseWindow(value: AdminWindowValue): Readonly<Record<string, string>> {
  switch (value.kind) {
    case 'none':
      return {};
    case 'preset':
      return { range: value.preset };
    case 'extra':
      return { range: value.extra };
    case 'custom':
    case 'linked': {
      const out: Record<string, string> = { range: 'custom' };
      if (value.from !== null) out.from = value.from;
      if (value.to !== null) out.to = value.to;
      return out;
    }
  }
}

export function windowEquals(a: AdminWindowValue, b: AdminWindowValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'preset' && b.kind === 'preset') return a.preset === b.preset;
  if (a.kind === 'extra' && b.kind === 'extra') return a.extra === b.extra;
  if ((a.kind === 'custom' || a.kind === 'linked') && (b.kind === 'custom' || b.kind === 'linked')) {
    return a.from === b.from && a.to === b.to;
  }
  return true;
}

/** One filter field owning the keys `range`, `from`, `to` (U-5, U-6, U-7). */
export function windowFilter(options: {
  defaultValue: AdminWindowValue;
  /** Legacy names, read forever and never written (U-9), e.g. date_from → from. */
  aliases?: Readonly<Record<string, 'from' | 'to'>>;
  /** The page's own extra windows (D-2 (b)); none by default. */
  extras?: readonly AdminWindowExtra[];
}): AdminFilterField<AdminWindowValue> {
  const extras = options.extras ?? [];
  return {
    keys: ['range', 'from', 'to'],
    aliases: options.aliases,
    defaultValue: options.defaultValue,
    parse: (get) => parseWindow(get, extras),
    serialise: serialiseWindow,
    equals: windowEquals,
  };
}

/** The dates or bounds a value means at `now`. Pages map this onto their own server params (U-8). */
export type ResolvedWindow =
  | { kind: 'none' }
  | { kind: 'dates'; from: string | null; to: string | null }
  | { kind: 'linked'; from: string | null; to: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The four whole-date extras (L-8a). UTC, weeks Monday to Sunday; the same
 * arithmetic as `app/admin/business-os-llm/activityPresets.ts` (parity-tested).
 */
function resolveDateExtra(
  extra: 'yesterday' | 'this_week' | 'last_week' | 'last_month',
  now: Date,
): { from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Monday = 0 … Sunday = 6 (getUTCDay is Sunday = 0).
  const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - daysSinceMonday * DAY_MS;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  switch (extra) {
    case 'yesterday':
      return { from: isoDate(today - DAY_MS), to: isoDate(today - DAY_MS) };
    case 'this_week':
      return { from: isoDate(monday), to: isoDate(today) };
    case 'last_week':
      return { from: isoDate(monday - 7 * DAY_MS), to: isoDate(monday - DAY_MS) };
    case 'last_month':
      // Day 0 of this month is the last day of the previous one; Date.UTC rolls
      // a negative month back into the previous year.
      return { from: isoDate(Date.UTC(year, month - 1, 1)), to: isoDate(Date.UTC(year, month, 0)) };
  }
}

export function resolveWindow(value: AdminWindowValue, now: Date): ResolvedWindow {
  switch (value.kind) {
    case 'none':
      return { kind: 'none' };
    case 'preset': {
      const { from, to } = resolveAdminWindow(value.preset, now);
      return { kind: 'dates', from, to };
    }
    case 'custom':
      return { kind: 'dates', from: value.from, to: value.to };
    case 'linked':
      return { kind: 'linked', from: value.from, to: value.to };
    case 'extra':
      if (value.extra !== '24h' && value.extra !== '90d') {
        return { kind: 'dates', ...resolveDateExtra(value.extra, now) };
      }
      if (value.extra === '90d') {
        // The last 90 UTC calendar days including today (U-8), as Costs' 90 days.
        const to = todayUtc(now);
        const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - 89 * DAY_MS).toISOString().slice(0, 10);
        return { kind: 'dates', from, to };
      }
      // "24 hours" is an exact rolling window: now minus 24 h to now. It depends
      // on the clock to the millisecond, so a page must never key a request on
      // this result (AI cost & usage maps the extra to `period=1` instead), and
      // DatePresets seeds empty inputs from it, as for a linked value (SA S-6).
      return {
        kind: 'linked',
        from: new Date(now.getTime() - DAY_MS).toISOString(),
        to: now.toISOString(),
      };
  }
}

/** One bound as shown in UTC: a date as is, a minute with a space (never through Date), an instant in UTC. */
function boundLabel(raw: string): string {
  const form = boundForm(raw);
  if (form === 'minute') return raw.replace('T', ' ');
  if (form === 'instant') {
    const full = formatUtc(raw);
    return full.endsWith(' UTC') ? full.slice(0, -4) : full;
  }
  return raw;
}

/** "Linked window A to B UTC"; one-sided: "Linked window from A UTC" / "Linked window up to B UTC". */
export function linkedWindowLabel(value: { from: string | null; to: string | null }): string {
  const { from, to } = value;
  if (from !== null && to !== null) return `Linked window ${boundLabel(from)} to ${boundLabel(to)} UTC`;
  if (from !== null) return `Linked window from ${boundLabel(from)} UTC`;
  if (to !== null) return `Linked window up to ${boundLabel(to)} UTC`;
  return 'Linked window';
}
