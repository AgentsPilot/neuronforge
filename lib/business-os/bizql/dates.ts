/**
 * Relative-date resolution for BizQL.
 *
 * Lets a caller say `{ $date: 'today' }` instead of computing a timestamp. That
 * matters more than it looks: chat-v3 needed three separate regex patterns for
 * "today" / "tomorrow" / "this week" bookings, in English only. One expression
 * plus one resolver replaces all of them, in every language, and gives the
 * automation kernel the same vocabulary for free — a stored automation that says
 * `{ $date: 'today' }` re-resolves correctly on every run instead of freezing a
 * date at authoring time.
 *
 * Timezone comes from the user's `business_profiles.timezone`. Getting this
 * wrong shifts "today's bookings" by up to a day for anyone outside UTC.
 *
 * @module lib/business-os/bizql
 */

import {
  BizQLValidationError,
  DATE_ANCHORS,
  isDateAnchor,
  isIsoCalendarDate,
  type DateExpr,
} from './types';
import type { FieldType } from '@/lib/business-os/catalog';

/**
 * Calendar parts of an instant, as seen in a given IANA timezone.
 * Uses Intl rather than a date library — no new dependency for this.
 */
export function partsInZone(date: Date, timezone: string): { y: number; m: number; d: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const [y, m, d] = formatter.format(date).split('-').map(Number);
  return { y, m, d };
}

/** Offset of a timezone from UTC, in minutes, at a given instant. */
function zoneOffsetMinutes(date: Date, timezone: string): number {
  /*
   * Read from Intl's own PARTS, not from parsing a formatted string.
   *
   * This was `new Date(date.toLocaleString('en-US', { timeZone: … }))` twice,
   * subtracted. That formats an instant into a human string and then asks
   * `Date` to parse it back — in the HOST's zone, with the host's idea of what
   * an unqualified "3/8/2026, 2:00:00 AM" means. On a spring-forward day that
   * wall clock does not exist where the host is, so the parse silently shifts
   * an hour and the offset came back as EDT on a date that was still EST.
   *
   * `formatToParts` hands back the numbers the zone actually shows, so nothing
   * is parsed and nothing depends on where this runs. `hourCycle: 'h23'` keeps
   * midnight as 00 rather than the 24 some locales produce.
   */
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const at = (type: string) => Number(parts.find(part => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second')
  );

  // Both sides truncated to the second: `asIfUtc` carries no milliseconds, and
  // the difference must be a whole number of minutes either way.
  return (asIfUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Does this value pin a specific calendar day anywhere inside it?
 *
 * Walks the whole structure rather than a known field: a named day arrives as a
 * filter value and as a written value equally often, and checking only one of
 * them misses half the cases.
 *
 * Lives here rather than beside either caller because both the plan cache and
 * the plan validator ask the same question of the same shape, for different
 * reasons.
 */
export function containsCalendarDate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCalendarDate);

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('$date' in record && isIsoCalendarDate(record.$date)) return true;

    return Object.values(record).some(containsCalendarDate);
  }

  return false;
}

/**
 * Midnight (local to `timezone`) of the given calendar day, as a UTC instant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO passes, and the second one is not a refinement — it is the answer.
 *
 * A single pass measured the zone's offset at NAIVE UTC MIDNIGHT, then applied
 * it. But naive midnight is a different instant from the local midnight being
 * solved for — thirteen hours apart for Auckland — and on a daylight-saving
 * transition day the two fall on OPPOSITE SIDES of the change. The offset
 * measured is then the wrong one, and the result lands in the neighbouring
 * calendar day.
 *
 * Auckland, 27 September 2026, the day NZDT began at 2am:
 *
 *   naive midnight   2026-09-27T00:00Z   is 13:00 NZDT (+13) that day
 *   one pass         −13h → 2026-09-26T11:00Z   = 23:00 on the 26th   wrong day
 *   two passes       re-measure there: +12 → 2026-09-26T12:00Z = midnight on
 *                    the 27th                                         correct
 *
 * That one day was enough to make `start_of_week` a Saturday and "this week" an
 * eight-day window for every business in the zone.
 *
 * The second pass re-measures at the candidate instant, which is on the correct
 * side of the transition. On an ordinary day both offsets are identical and the
 * second pass changes nothing. Where local midnight does not exist at all — the
 * few zones that spring forward AT midnight — this settles on the instant the
 * clock jumped to, which is the first moment of that civil day.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function startOfDayUtc(y: number, m: number, d: number, timezone: string): Date {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timezone) * 60_000);
  return new Date(naive - zoneOffsetMinutes(guess, timezone) * 60_000);
}

/**
 * The same wall-clock day, `days` later, on the business's own calendar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT `getTime() + days * 86_400_000`, which is what this was.
 *
 * Every date in this module is an INSTANT standing for a civil day: the
 * business's midnight, expressed in UTC. Adding a fixed 24 hours to that only
 * reaches the next midnight in a zone whose offset never moves. Across a
 * daylight-saving transition the civil day is 23 or 25 hours long, so the
 * result lands an hour short or an hour over and falls into the NEIGHBOURING
 * calendar date.
 *
 * Measured on 28 September 2026, the day after New Zealand moved to NZDT:
 *
 *                 UTC              Pacific/Auckland
 *   today         27 Sep (Sun)     28 Sep (Mon)     — correct, no arithmetic
 *   last 7 days   20 Sep (Sun)     20 Sep (Sun)     — should be the 21st
 *   start_of_week 27 Sep (Sun)     26 Sep (Sat)     — should be the 27th
 *
 * So the chat answered "the last 7 days" over an eight-day window and started
 * "this week" on a Saturday — for as long as the span kept crossing the
 * transition, which for a four-week lookback is four weeks. Nothing looked
 * wrong: the number returned is a real number, over the wrong days.
 *
 * The arithmetic therefore happens on the CALENDAR, where a day is always a
 * day, and the result is turned back into an instant afterwards. `Date.UTC`
 * normalises overflow, so day 0 and day 32 land in the right month without a
 * special case. Same rule as `shiftBusinessDateKey` on the scheduling side.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function addDays(date: Date, days: number, timezone: string): Date {
  const { y, m, d } = partsInZone(date, timezone);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return startOfDayUtc(
    moved.getUTCFullYear(),
    moved.getUTCMonth() + 1,
    moved.getUTCDate(),
    timezone
  );
}

/**
 * Resolve a DateExpr to a value suitable for the target field type.
 *
 * `date` columns get `YYYY-MM-DD`; `datetime` columns get a full ISO instant.
 * Comparing a timestamptz column against a bare date string is a classic
 * off-by-one, so the field type decides the format.
 */
/**
 * Weekday name to `Date.getUTCDay()` index.
 *
 * Read from the business's CALENDAR PARTS, never from `today`.
 *
 * `today` is local midnight expressed as a UTC instant, so for any zone ahead
 * of UTC it lands on the previous UTC day — midnight in Jerusalem is 21:00Z
 * yesterday, and `getUTCDay()` on it answers Monday for a Tuesday. That is one
 * day of error in every weekday calculation, silently, for everyone east of
 * Greenwich.
 */
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function resolveDateExpr(
  expr: DateExpr,
  timezone: string = 'UTC',
  fieldType: FieldType = 'datetime'
): string {
  const now = new Date();

  let zone = timezone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }

  const { y, m, d } = partsInZone(now, zone);
  const today = startOfDayUtc(y, m, d, zone);

  /*
   * The business's own weekday, from its calendar date rather than from the
   * instant. See WEEKDAY_INDEX above for why the instant cannot be used.
   */
  const localDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  let resolved: Date;

  /*
   * A day the user named, e.g. "set the due date to 30 October".
   *
   * Handled before the anchor check because it is not an anchor and never will
   * be: anchors are relative to now, and this is not. Read in the business's own
   * timezone so "30 October" means that date where they are, not wherever the
   * server happens to run.
   */
  if (isIsoCalendarDate(expr.$date)) {
    const [year, month, day] = expr.$date.split('-').map(Number);
    return finishDate(startOfDayUtc(year, month, day, zone), expr.offset, zone, fieldType);
  }

  if (!isDateAnchor(expr.$date)) {
    throw new BizQLValidationError([
      `'${String(expr.$date)}' is not a date anchor or a calendar date. Use one of: ` +
        `${DATE_ANCHORS.join(', ')} — with an offset for a window, ` +
        `e.g. { $date: 'today', offset: { days: -7 } } — or a specific day as ` +
        `YYYY-MM-DD, e.g. { $date: '2026-10-30' }.`,
    ]);
  }

  switch (expr.$date) {
    case 'now':
      resolved = now;
      break;
    case 'today':
      resolved = today;
      break;
    case 'tomorrow':
      resolved = addDays(today, 1, zone);
      break;
    case 'yesterday':
      resolved = addDays(today, -1, zone);
      break;
    // Synonyms for the day boundaries. The planner reaches for these naturally
    // when expressing "today" as a range, and rejecting them cost a repair pass
    // for no benefit — `today` already IS midnight.
    case 'start_of_day':
      resolved = today;
      break;
    case 'end_of_day':
      resolved = addDays(today, 1, zone); // exclusive upper bound
      break;
    case 'start_of_week':
      // Week starts Sunday, matching this product's scheduling model.
      resolved = addDays(today, -localDow, zone);
      break;
    case 'end_of_week':
      resolved = addDays(today, 6 - localDow + 1, zone); // exclusive upper bound
      break;
    case 'start_of_month':
      resolved = startOfDayUtc(y, m, 1, zone);
      break;
    case 'end_of_month':
      resolved = startOfDayUtc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, zone);
      break;
    case 'sunday':
    case 'monday':
    case 'tuesday':
    case 'wednesday':
    case 'thursday':
    case 'friday':
    case 'saturday': {
      /*
       * The next occurrence, counting today.
       *
       * Asked on a Wednesday, "ביום רביעי" means today — nobody skips a week to
       * talk about the day they are standing in. Any other day means the one
       * coming. "Last Wednesday" is this anchor with {offset:{weeks:-1}}, which
       * is why no separate backwards form is needed.
       */
      const target = WEEKDAY_INDEX[expr.$date];
      resolved = addDays(today, (target - localDow + 7) % 7, zone);
      break;
    }
    default:
      /*
       * An anchor nobody defined.
       *
       * This used to fall through to `today`, which is the most dangerous
       * possible default: `created_at >= last_7_days` became `created_at >=
       * today` and matched almost nothing, so a weekly report rendered "0 new
       * leads" and read as a quiet week rather than as a broken filter. An
       * empty result is indistinguishable from a real one, so it has to fail
       * loudly instead.
       */
      throw new BizQLValidationError([
        `'${String(expr.$date)}' is not a date anchor. Use one of: ` +
          `${DATE_ANCHORS.join(', ')} — with an offset for a window, ` +
          `e.g. { $date: 'today', offset: { days: -7 } }.`,
      ]);
  }

  return finishDate(resolved, expr.offset, zone, fieldType);
}

/**
 * Apply the offset and render, shared by both ways of naming a day.
 *
 * Extracted so an anchor and a calendar date cannot drift on the two things
 * that are easy to get subtly wrong — month arithmetic clamping, and whether a
 * `date` column is compared against a bare day or a timestamp.
 */
function finishDate(
  start: Date,
  offset: DateExpr['offset'],
  zone: string,
  fieldType: FieldType
): string {
  let resolved = start;

  if (offset) {
    const { days = 0, weeks = 0, months = 0 } = offset;
    if (days || weeks) resolved = addDays(resolved, days + weeks * 7, zone);
    if (months) {
      const p = partsInZone(resolved, zone);
      const total = p.m - 1 + months;
      const targetYear = p.y + Math.floor(total / 12);
      const targetMonth = ((total % 12) + 12) % 12;
      // Clamp the day so 31 Jan + 1 month lands on the last day of February.
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      resolved = startOfDayUtc(targetYear, targetMonth + 1, Math.min(p.d, lastDay), zone);
    }
  }

  if (fieldType === 'date') {
    const p = partsInZone(resolved, zone);
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }

  return resolved.toISOString();
}

/**
 * The anchors a worked-out date is allowed to become, in the order tried.
 *
 * Order is the whole safety argument. Every candidate here resolves to the SAME
 * calendar day as the date being replaced, so the query returns exactly the same
 * rows today whichever one wins — the order only decides what the plan means
 * when it is re-run from the cache next month.
 *
 * So the single-day anchors come first: if the model wrote today's date, `today`
 * is what it meant, even on the 1st of the month when `start_of_month` would
 * also match. Month and week bounds come next, which is what "this month"
 * actually needs. Weekdays come last: they resolve to the NEXT occurrence, so
 * they only ever match a date inside the coming week and are the weakest claim
 * about intent.
 */
const ANCHOR_PREFERENCE = [
  'today',
  'tomorrow',
  'yesterday',
  'start_of_month',
  'end_of_month',
  'start_of_week',
  'end_of_week',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Turn a date the model WORKED OUT back into the anchor it meant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS RATHER THAN ANOTHER PROMPT RULE
 *
 * Asked "how many bookings did I have this month", gpt-4o-mini reliably answers
 * with the right query and the wrong kind of date:
 *
 *   where: start_time gte {"$date":"2026-09-01"}, lt {"$date":"2026-09-09"}
 *
 * The plan is correct today and wrong forever after, which is what the digit
 * rule catches — the request names no number, so the date was computed rather
 * than read. But rejecting it costs two repair calls and the model does not
 * change its answer: measured over the generated corpus this was **18 of 40
 * failures**, the single largest class, and the `period` shape scored 46%.
 *
 * The prompt already says to prefer an anchor, in two places. A third telling
 * is not the missing piece — the information is. Both of those dates ARE
 * anchors on today's clock: `2026-09-01` is `start_of_month` and `2026-09-09`
 * is `tomorrow`. That is a fact we can compute, so we compute it instead of
 * asking the model to.
 *
 * SAFETY
 *
 * Only fires when the digit rule would have rejected the plan anyway — no digit
 * anywhere in the request. A user who says "on 30 October" keeps their absolute
 * date, because that one was READ, not invented.
 *
 * Only substitutes an anchor that resolves to the same calendar day, so the
 * rewritten plan returns identical rows in this turn. What changes is the
 * NEXT run of a cached plan, which is exactly the bug the digit rule exists to
 * prevent.
 *
 * A date no anchor matches is left alone and still fails validation. Silence
 * would be worse than the error.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @returns how many dates were rewritten, for logging.
 */
export function anchorizeInventedDates(
  plan: unknown,
  userMessage: string | undefined,
  timezone: string = 'UTC'
): number {
  // Same trigger as validateNamedDateHasDigits: a number in the request means
  // the user named a day and the date is theirs to keep.
  if (userMessage === undefined || /\d/.test(userMessage)) return 0;

  const resolvedAnchors = new Map<string, string>();
  for (const anchor of ANCHOR_PREFERENCE) {
    try {
      resolvedAnchors.set(anchor, resolveDateExpr({ $date: anchor }, timezone, 'date'));
    } catch {
      // An anchor that will not resolve simply cannot be a candidate.
    }
  }

  let rewritten = 0;

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value === null || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;

    // An offset means the model was already thinking relatively; substituting
    // the base of an arithmetic expression it wrote is a guess too far.
    if (isIsoCalendarDate(record.$date) && record.offset === undefined) {
      const match = ANCHOR_PREFERENCE.find((a) => resolvedAnchors.get(a) === record.$date);
      if (match) {
        record.$date = match;
        rewritten += 1;
      }
    }

    Object.values(record).forEach(walk);
  };

  walk(plan);
  return rewritten;
}

/**
 * Date anchors said the way a person says them, in each supported language.
 *
 * Read in BOTH directions and deliberately kept in one place: the answer line
 * turns `start_of_month` into "the start of this month", and the pending-fill
 * path turns a reply of "מחר" back into `{$date:'tomorrow'}`. Two copies of
 * this table would drift, and a drift here means a date field quietly taking
 * prose.
 */
export const ANCHOR_WORDS: Record<string, Record<string, string>> = {
  now: { en: 'now', he: 'עכשיו', es: 'ahora' },
  today: { en: 'today', he: 'היום', es: 'hoy' },
  tomorrow: { en: 'tomorrow', he: 'מחר', es: 'mañana' },
  yesterday: { en: 'yesterday', he: 'אתמול', es: 'ayer' },
  start_of_day: { en: 'the start of today', he: 'תחילת היום', es: 'el inicio de hoy' },
  end_of_day: { en: 'the end of today', he: 'סוף היום', es: 'el fin de hoy' },
  start_of_week: { en: 'the start of this week', he: 'תחילת השבוע', es: 'el inicio de esta semana' },
  end_of_week: { en: 'the end of this week', he: 'סוף השבוע', es: 'el fin de esta semana' },
  start_of_month: { en: 'the start of this month', he: 'תחילת החודש', es: 'el inicio de este mes' },
  end_of_month: { en: 'the end of this month', he: 'סוף החודש', es: 'el fin de este mes' },
  sunday: { en: 'Sunday', he: 'ראשון', es: 'domingo' },
  monday: { en: 'Monday', he: 'שני', es: 'lunes' },
  tuesday: { en: 'Tuesday', he: 'שלישי', es: 'martes' },
  wednesday: { en: 'Wednesday', he: 'רביעי', es: 'miércoles' },
  thursday: { en: 'Thursday', he: 'חמישי', es: 'jueves' },
  friday: { en: 'Friday', he: 'שישי', es: 'viernes' },
  saturday: { en: 'Saturday', he: 'שבת', es: 'sábado' },
};
