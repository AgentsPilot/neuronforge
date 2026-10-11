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
 */

import {
  ADMIN_WINDOW_PRESETS,
  isRealDate,
  resolveAdminWindow,
  type AdminWindowPreset,
} from '@/app/admin/components/adminWindowPresets';
import { formatUtc } from './adminFormat';
import type { AdminFilterField } from './useAdminFilters';

/** What the Window control holds. */
export type AdminWindowValue =
  | { kind: 'none' }
  | { kind: 'preset'; preset: AdminWindowPreset }
  | { kind: 'custom'; from: string | null; to: string | null }
  | { kind: 'linked'; from: string | null; to: string | null };

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

/** Parses the window's canonical keys (after the hook has applied the aliases). */
export function parseWindow(get: (key: string) => string | null): AdminWindowValue | undefined {
  const range = get('range');
  if (range !== null && isAdminWindowPreset(range)) return { kind: 'preset', preset: range };

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
}): AdminFilterField<AdminWindowValue> {
  return {
    keys: ['range', 'from', 'to'],
    aliases: options.aliases,
    defaultValue: options.defaultValue,
    parse: parseWindow,
    serialise: serialiseWindow,
    equals: windowEquals,
  };
}

/** The dates or bounds a value means at `now`. Pages map this onto their own server params (U-8). */
export type ResolvedWindow =
  | { kind: 'none' }
  | { kind: 'dates'; from: string | null; to: string | null }
  | { kind: 'linked'; from: string | null; to: string | null };

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
