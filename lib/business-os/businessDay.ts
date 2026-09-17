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
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE TABLES GET CONFUSED FOR EACH OTHER. ONLY ONE IS AUTHORITATIVE.
 *
 *   user_preferences.timezone   THE SOURCE. Written by the settings page and
 *                               mirrored by `/api/user/profile`. Read by the
 *                               availability API, the booking routes, every
 *                               client-facing email, and the language provider
 *                               that supplies the clock to every screen.
 *
 *   profiles.timezone           A REAL COLUMN, and a real trap. Written by
 *                               `/api/user/profile` and, until recently, read
 *                               on its own by the Business OS scheduling
 *                               dialog. It drifted: three accounts held
 *                               `Asia/Jerusalem` here against `UTC` there. The
 *                               route now mirrors into `user_preferences` on
 *                               every write, and
 *                               `scripts/backfill-timezone-preferences.ts`
 *                               closed the drift already in the data. Do not
 *                               read it directly.
 *
 *   business_profiles.timezone  DOES NOT EXIST, and never has.
 *                               BusinessProfileRepository says so explicitly
 *                               and excludes it from its Insert/Update shapes.
 *                               Reading it returns `undefined`, which silently
 *                               becomes UTC.
 *
 * Two of the three fail SILENTLY — one by drifting, one by being absent — which
 * is why this resolution is a named function rather than an inline `??`.
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

/**
 * The UTC instant at which a wall-clock time occurs in a given zone.
 *
 * The inverse of `localHourIn`, and the piece that was missing. Availability is
 * stored as wall-clock strings — "09:00" means nine in the morning WHERE THE
 * BUSINESS IS — and turning one into a real moment needs the zone. Building it
 * with `new Date(...)` or `setHours` instead uses whatever zone the reader's
 * browser happens to be in, which is how a New York business viewed from
 * Jerusalem ends up being offered slots at two in the morning.
 *
 * Two passes, because the offset depends on the instant and the instant depends
 * on the offset. The first guess treats the wall clock as UTC and corrects by
 * the offset there; the second re-reads the offset at the corrected instant, so
 * a time that falls on a daylight-saving change lands on the right side of it.
 *
 * Times that do not exist (the spring-forward hour) resolve to the instant the
 * clock jumps to; times that happen twice (autumn) resolve to the first. Both
 * are the conventional answers and neither can be avoided — there is no such
 * wall-clock moment to return.
 */
export function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const zone = isUsableTimezone(timezone) ? timezone : 'UTC';
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstPass = naive - zoneOffsetMs(new Date(naive), zone);
  return new Date(naive - zoneOffsetMs(new Date(firstPass), zone));
}

/** How far ahead of UTC `zone` is at this instant, in milliseconds. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: string) => Number(parts.find(part => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour') % 24,
    at('minute'),
    at('second')
  );

  return asUtc - instant.getTime();
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
