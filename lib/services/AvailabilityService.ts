/**
 * The weekly hours clients can book into.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SERVICE AND NOT A CATALOG FIELD
 *
 * Availability is one JSON column on `business_profiles`:
 *
 *   { "monday": [{ "start": "09:00", "end": "17:00" }], "friday": [], … }
 *
 * Every other write in this system names a column and a value. This one names a
 * DAY inside a structure, and the rest of the structure has to survive
 * untouched — a write that replaced the whole map would close every other day
 * the business is open, and nothing in the sentence "change Tuesday to 9-2" says
 * anything about Wednesday.
 *
 * So the map is never handed to a planner to author. It is read, one day is
 * edited, and it is written back whole, with every key present. That also makes
 * the two operations honest about what they mean: setting hours REPLACES the
 * day, because naming the hours a day has is a statement about the whole day.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/AvailabilityService
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'AvailabilityService' });
const auditTrail = AuditTrailService.getInstance();

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export interface TimeRange {
  start: string;
  end: string;
}

export type WeeklyAvailability = Record<Weekday, TimeRange[]>;

/** The caller said something this service will not act on. */
export class AvailabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityInputError';
  }
}

/** Every day present, so a partial stored value cannot lose a weekday. */
function emptyWeek(): WeeklyAvailability {
  return WEEKDAYS.reduce((week, day) => {
    week[day] = [];
    return week;
  }, {} as WeeklyAvailability);
}

/**
 * Accept the day however it was said, and only if it is genuinely a weekday.
 *
 * Case and surrounding whitespace vary with how the planner echoes the user's
 * words; anything else is refused rather than guessed. Silently ignoring an
 * unrecognised day would report success for a change that never happened.
 */
export function parseWeekday(value: unknown): Weekday {
  const normalised = String(value ?? '').trim().toLowerCase();
  const match = WEEKDAYS.find((day) => day === normalised);

  if (!match) {
    throw new AvailabilityInputError(
      `'${value}' is not a day of the week. Use one of: ${WEEKDAYS.join(', ')}.`
    );
  }
  return match;
}

/**
 * Normalise a time to 24-hour `HH:MM`.
 *
 * "9", "9:00", "09:00" and "9am" all mean the same opening time, and a person
 * saying "change Tuesday to 9-2" means 14:00 by "2" — an afternoon closing time
 * is the only reading that makes sense of a range. That inference is applied
 * ONLY to the closing time of a range, and only when it would otherwise fall
 * before the opening one, so an explicit "02:00" is left alone.
 */
export function parseTime(value: unknown, label: string): string {
  const raw = String(value ?? '').trim().toLowerCase();

  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(raw);
  if (!match) {
    throw new AvailabilityInputError(`'${value}' is not a time. Use HH:MM, e.g. 09:00.`);
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) {
    throw new AvailabilityInputError(`'${value}' is not a valid ${label}.`);
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface SetAvailabilityParams {
  userId: string;
  day: unknown;
  start?: unknown;
  end?: unknown;
  /** Empty the day instead of setting hours. */
  clear?: boolean;
  request?: NextRequest;
}

export interface AvailabilityOutcome {
  day: Weekday;
  ranges: TimeRange[];
  availability: WeeklyAvailability;
}

/**
 * Set — or clear — one weekday's working hours.
 *
 * Reads the current week, replaces exactly one day, writes it back whole.
 */
export async function setDayAvailability(
  params: SetAvailabilityParams
): Promise<{ data: AvailabilityOutcome | null; error: Error | null }> {
  const { userId, request } = params;

  try {
    const day = parseWeekday(params.day);

    let ranges: TimeRange[] = [];
    if (!params.clear) {
      const start = parseTime(params.start, 'start time');
      let end = parseTime(params.end, 'end time');

      // A day that starts and ends at the same moment is CLOSED.
      //
      // Asked "I don't work Fridays any more", the planner reaches for
      // set_availability with 00:00–00:00 rather than clear_availability. That
      // is not ambiguous — a zero-length working day is no working day — so it
      // is read as closed rather than refused.
      //
      // It must be caught HERE, before the afternoon inference below: left to
      // that, 00:00–00:00 would become 00:00–12:00 and Friday would be written
      // as a morning shift, silently, the exact opposite of what was said.
      if (start === end) {
        logger.info({ userId, day }, 'Zero-length day read as closed');
        return finish(day, [], userId, request);
      }

      // "9 to 2" means 14:00. Applied only when the stated end would otherwise
      // precede the start, so an explicit overnight "22:00–02:00" is untouched
      // and a genuine 02:00 close is never rewritten to 14:00 by surprise.
      if (end <= start) {
        const [endHour, endMinute] = end.split(':').map(Number);
        if (endHour < 12) {
          const shifted = `${String(endHour + 12).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
          if (shifted > start) end = shifted;
        }
      }

      if (end <= start) {
        throw new AvailabilityInputError(
          `A working day cannot end at ${end} when it starts at ${start}.`
        );
      }

      ranges = [{ start, end }];
    }

    return finish(day, ranges, userId, request);
  } catch (error) {
    return { data: null, error: error as Error };
  }
}

/** Read the week, replace one day, write it back whole. */
async function finish(
  day: Weekday,
  ranges: TimeRange[],
  userId: string,
  request?: NextRequest
): Promise<{ data: AvailabilityOutcome | null; error: Error | null }> {
  try {
    const { data: profile, error: readError } = await supabaseServer
      .from('business_profiles')
      .select('id, scheduling_availability')
      .eq('user_id', userId)
      .maybeSingle();

    if (readError) return { data: null, error: readError as Error };

    // Merged over a full empty week: a stored value missing a weekday — an older
    // shape, a partial write — must not leave that day absent from what we save.
    const availability: WeeklyAvailability = {
      ...emptyWeek(),
      ...((profile?.scheduling_availability as WeeklyAvailability) ?? {}),
      [day]: ranges,
    };

    const { error: writeError } = profile
      ? await supabaseServer
          .from('business_profiles')
          .update({
            scheduling_availability: availability,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
      : await supabaseServer.from('business_profiles').insert({
          user_id: userId,
          // NOT NULL, and unknown for someone who never finished onboarding.
          vertical: 'other',
          scheduling_availability: availability,
        });

    if (writeError) return { data: null, error: writeError as Error };

    auditTrail
      .log({
        action: 'SCHEDULING_AVAILABILITY_UPDATED',
        userId,
        entityType: 'business_profile',
        entityId: profile?.id ?? userId,
        resourceName: day,
        details: { day, ranges },
        request,
      })
      .catch((err) => logger.warn({ err, userId }, 'Audit failed (non-blocking)'));

    logger.info({ userId, day, ranges }, 'Availability updated');

    return { data: { day, ranges, availability }, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}
