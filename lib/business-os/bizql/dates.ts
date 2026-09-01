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

import type { DateExpr } from './types';
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

  let resolved: Date;

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
    case 'start_of_week': {
      // Week starts Sunday, matching this product's scheduling model.
      const dow = new Date(today).getUTCDay();
      resolved = addDays(today, -dow);
      break;
    }
    case 'end_of_week': {
      const dow = new Date(today).getUTCDay();
      resolved = addDays(today, 6 - dow + 1); // exclusive upper bound
      break;
    }
    case 'start_of_month':
      resolved = startOfDayUtc(y, m, 1, zone);
      break;
    case 'end_of_month':
      resolved = startOfDayUtc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, zone);
      break;
    default:
      resolved = today;
  }

  if (expr.offset) {
    const { days = 0, weeks = 0, months = 0 } = expr.offset;
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
