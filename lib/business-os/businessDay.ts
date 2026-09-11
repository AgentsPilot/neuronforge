/**
 * The business's own day.
 *
 * Every daily surface — the briefing card, the morning email, anything that
 * says "today" — has to agree on when today starts, and it has to be the
 * business's midnight rather than the server's. On Vercel the server is UTC, so
 * `new Date().setHours(0,0,0,0)` gives a Jerusalem business a day that began at
 * 03:00 their time and a Los Angeles business one that began at 17:00 the day
 * before. Both are wrong, and both are wrong silently.
 *
 * The date arithmetic is NOT reimplemented here. `partsInZone` and
 * `startOfDayUtc` come from the BizQL date resolver, which already handles DST
 * transitions and is covered by its own tests. This module adds the two things
 * that resolver cannot give a scheduled job: an injectable clock, and the
 * business's wall-clock hour.
 */

import { partsInZone, startOfDayUtc } from '@/lib/business-os/bizql/dates';

export interface BusinessDay {
  /** Validated IANA zone actually used. 'UTC' when the input was unusable. */
  timezone: string;
  /** The day as the business writes it, 'YYYY-MM-DD'. */
  date: string;
  /** First instant of the day, inclusive. ISO. */
  startUtc: string;
  /** First instant of the NEXT day, exclusive. ISO. */
  endUtc: string;
  /** The business's wall clock right now, 0-23. */
  localHour: number;
}

export interface TimezoneResolution {
  timezone: string;
  source: 'user_preferences' | 'default';
}

/**
 * Where the business timezone actually lives.
 *
 * `business_profiles.timezone` has never existed — BusinessProfileRepository
 * says so explicitly and excludes it from its Insert/Update shapes. The value
 * is on `user_preferences.timezone`, written by the settings page. Code that
 * reads it from the profile gets `undefined` and silently falls back to UTC,
 * which is why this resolution is a named function rather than an inline `??`.
 */
export function resolveBusinessTimezone(input: {
  preferencesTimezone?: string | null;
}): TimezoneResolution {
  const candidate = input.preferencesTimezone?.trim();

  if (candidate && isUsableTimezone(candidate)) {
    return { timezone: candidate, source: 'user_preferences' };
  }

  return { timezone: 'UTC', source: 'default' };
}

/** Does this string name a zone Intl will accept? */
export function isUsableTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The business day containing `now`, or `dayOffset` days from it.
 *
 * `now` is a parameter rather than a call to `new Date()` so that the cron, the
 * API route and the tests can all be pointed at the same instant. A scheduled
 * job that cannot be told what time it is cannot be tested across a midnight.
 */
export function businessDayFor(now: Date, timezone: string, dayOffset = 0): BusinessDay {
  const zone = isUsableTimezone(timezone) ? timezone : 'UTC';

  const { y, m, d } = partsInZone(now, zone);

  /*
   * Offset by calendar day, not by 86_400_000ms.
   *
   * A DST transition makes a local day 23 or 25 hours long, so adding a fixed
   * number of milliseconds to a midnight lands at 23:00 or 01:00 of the wrong
   * day twice a year. Shifting the calendar date and re-resolving midnight
   * asks the zone where that day actually starts.
   */
  const shifted = new Date(Date.UTC(y, m - 1, d + dayOffset));
  const target = {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };

  const next = new Date(Date.UTC(target.y, target.m - 1, target.d + 1));

  const start = startOfDayUtc(target.y, target.m, target.d, zone);
  const end = startOfDayUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), zone);

  return {
    timezone: zone,
    date: isoDate(target.y, target.m, target.d),
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    localHour: localHourIn(now, zone),
  };
}

/**
 * The wall-clock hour in a zone, 0-23.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which some engines render as
 * "24" at midnight — a value no comparison against a morning window expects.
 * The `% 24` is belt and braces for engines that ignore the cycle hint.
 */
export function localHourIn(instant: Date, timezone: string): number {
  const zone = isUsableTimezone(timezone) ? timezone : 'UTC';

  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(instant);

  return Number(hour) % 24;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
