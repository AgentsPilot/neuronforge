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
function partsInZone(date: Date, timezone: string): { y: number; m: number; d: number } {
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
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (local.getTime() - utc.getTime()) / 60_000;
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

/** Midnight (local to `timezone`) of the given calendar day, as a UTC instant. */
function startOfDayUtc(y: number, m: number, d: number, timezone: string): Date {
  // Start from the naive UTC midnight, then correct by the zone's offset.
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offset = zoneOffsetMinutes(new Date(naive), timezone);
  return new Date(naive - offset * 60_000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
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
      resolved = addDays(today, 1);
      break;
    case 'yesterday':
      resolved = addDays(today, -1);
      break;
    // Synonyms for the day boundaries. The planner reaches for these naturally
    // when expressing "today" as a range, and rejecting them cost a repair pass
    // for no benefit — `today` already IS midnight.
    case 'start_of_day':
      resolved = today;
      break;
    case 'end_of_day':
      resolved = addDays(today, 1); // exclusive upper bound
      break;
    case 'start_of_week':
      // Week starts Sunday, matching this product's scheduling model.
      resolved = addDays(today, -localDow);
      break;
    case 'end_of_week':
      resolved = addDays(today, 6 - localDow + 1); // exclusive upper bound
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
      resolved = addDays(today, (target - localDow + 7) % 7);
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
    if (days || weeks) resolved = addDays(resolved, days + weeks * 7);
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
