/**
 * The hours this business will actually accept, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * Until now the complete answer lived inside ONE API route — the public
 * booking page's availability endpoint. Its `calculateDaySlots` assembled the
 * weekday windows, the time off, the diary, the external calendar and the
 * buffer; the route then applied the notice and advance-days filters around
 * it. Everything else that wanted to know when a business was free either
 * asked that endpoint over HTTP or reimplemented a piece of it.
 *
 * That is how two definitions of a free hour appear, and this product has
 * already paid for one: `busyMeetings` said a cancelled meeting's hour was
 * free and offered it, while the database constraint still held it, so a
 * client picked a time from the public calendar and was told it had gone (see
 * `oneDefinitionOfATakenHour.guard.test.ts`).
 *
 * So the chat cannot be given its own copy. It asks this, the portal asks
 * this, and they cannot disagree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF RULE, AND ONLY ONE OF THEM BINDS THE OWNER
 *
 * The diary rules say whether the owner is genuinely free: working hours, time
 * off, existing appointments, the external calendar, the gap kept between
 * appointments, the service's own length. Nobody may book over those.
 *
 * `min_notice_hours` and `advance_booking_days` are different. They are the
 * business's policy toward CLIENTS — "do not book me with an hour's warning",
 * "do not book me a year out". When the OWNER books somebody in, those are not
 * constraints on reality; they are rules the owner is choosing to set aside.
 * An owner saying "book Tal in at four" should not be refused by their own
 * client-facing notice period.
 *
 * Hence `policy`. The portal passes `'client'` and behaves exactly as it
 * always has. The chat passes `'owner'`, which drops those two and nothing
 * else.
 *
 * @module lib/scheduling/bookableSlots
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { businessInstant, businessDateKey, shiftBusinessDateKey } from '@/lib/scheduling/businessTime';
import { resolveBusinessTimezone } from '@/lib/business-os/businessDay';
import { windowsForDate, hasAnyAvailability, type TimeOffEntry } from '@/lib/scheduling/availabilityWindows';
import { offeredStarts, busySpansOn } from '@/lib/scheduling/offeredStarts';
import { slotStepMinutes } from '@/lib/scheduling/slotInterval';
import { externalBusy } from '@/lib/scheduling/externalBusy';
import { busyMeetings } from '@/lib/scheduling/busyMeetings';
import { schedulingTimeOffRepository } from '@/lib/repositories/SchedulingTimeOffRepository';

const logger = createLogger({ module: 'bookableSlots', service: 'scheduling' });

/** An hour that can be taken: both ends as instants. */
export interface BookableSlot {
  start: string;
  end: string;
}

/**
 * Whose rules apply.
 *
 * `client` — everything, including the notice period and the advance window.
 * `owner`  — the diary only. See the module note.
 */
export type SlotPolicy = 'client' | 'owner';

/** What the service contributes to the search. */
interface ServiceShape {
  duration_minutes: number | null;
  buffer_minutes: number | null;
  min_notice_hours: number | null;
  advance_booking_days: number | null;
  is_scheduled: boolean | null;
}

/**
 * Does booking this service mean finding an hour for it?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE CONDITIONS, AND EACH ONE HAS BEEN WRITTEN INLINE SOMEWHERE ELSE.
 *
 *  · `is_scheduled` is the declared flag, read everywhere as `!== false`
 *    (clientJourney, intakeReach, businessShape, journeyReadiness). It says
 *    what the owner INTENDED this thing to be.
 *  · a duration, because without one there is no span to place. The public
 *    booking route says the same in its own words: "A service with no duration
 *    has no span to offer slots for — a course, a product."
 *  · a diary. A business that has never set any availability is not a business
 *    with a full calendar; its services are products, and looking for an hour
 *    in an empty week would refuse every booking it was asked to make.
 *
 * Any of the three absent and the booking is still REAL — it carries the
 * money, the intake form and the client journey, exactly as `createBooking`
 * already handles when no times are passed. It simply has no hour.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function needsAnHour(
  service: Pick<ServiceShape, 'duration_minutes' | 'is_scheduled'>,
  availability: unknown
): boolean {
  if (service.is_scheduled === false) return false;
  if (!(Number(service.duration_minutes) > 0)) return false;
  return hasAnyAvailability(availability);
}

/**
 * Every hour that could be taken for this service, in order.
 *
 * Reads once for the whole window — the profile, the time off, the diary and
 * the external calendar — then walks the days. Reading inside the day loop
 * would be one round trip per day for answers that do not change between them,
 * which is the note `calculateDaySlots` carries about its own parameters.
 */
export async function bookableSlots(args: {
  userId: string;
  serviceId: string;
  /** Business date key, inclusive. Defaults to the business's today. */
  from?: string;
  /** How many days to walk from `from`. */
  days: number;
  policy: SlotPolicy;
}): Promise<BookableSlot[]> {
  const { userId, serviceId, days, policy } = args;

  const [{ data: service }, { data: profile }] = await Promise.all([
    supabaseServer
      .from('scheduling_services')
      .select('duration_minutes, buffer_minutes, min_notice_hours, advance_booking_days, is_scheduled')
      .eq('id', serviceId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseServer
      .from('business_profiles')
      .select('scheduling_availability')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (!service) return [];

  const availability = (profile as { scheduling_availability?: unknown } | null)?.scheduling_availability;
  const shape = service as unknown as ServiceShape;

  if (!needsAnHour(shape, availability)) return [];

  /*
   * The business's own clock, which is the only one any of this means
   * anything in. `user_preferences.timezone` is the authority — see
   * `resolveBusinessTimezone`; `business_profiles.timezone` does not exist.
   */
  const { data: prefs } = await supabaseServer
    .from('user_preferences')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();

  const { timezone } = resolveBusinessTimezone({
    preferencesTimezone: (prefs as { timezone?: string | null } | null)?.timezone,
  });

  const duration = Number(shape.duration_minutes);
  const buffer = Number(shape.buffer_minutes ?? 0) || 0;
  const firstDay = args.from ?? businessDateKey(new Date(), timezone);

  /* The window to read the diary over, as instants. */
  const rangeStart = businessInstant(firstDay, '00:00', timezone).toISOString();
  const lastDay = shiftBusinessDateKey(firstDay, days);
  const rangeEnd = businessInstant(lastDay, '00:00', timezone).toISOString();

  const [timeOff, meetings, external] = await Promise.all([
    /* Through the repository the portal uses, scoped to the same window —
       not a raw select, which would be a second opinion about which rows
       count as time off. */
    schedulingTimeOffRepository
      .list(userId, { from: firstDay, to: lastDay })
      .then(({ data }) => (data ?? []) as TimeOffEntry[])
      .catch(() => [] as TimeOffEntry[]),
    busyMeetings(supabaseServer, userId, rangeStart, rangeEnd).catch(() => []),
    externalBusy(userId, rangeStart, rangeEnd).catch(() => []),
  ]);

  const busy = [...meetings, ...external];

  /*
   * The two client-facing rules, applied only for a client. `now` is read
   * once so every day in the walk is measured against the same instant.
   */
  const now = Date.now();
  const earliest =
    policy === 'client' ? now + (Number(shape.min_notice_hours ?? 24) || 0) * 3_600_000 : now;
  const latest =
    policy === 'client'
      ? now + (Number(shape.advance_booking_days ?? 30) || 0) * 86_400_000
      : Number.POSITIVE_INFINITY;

  const step = slotStepMinutes(duration, buffer);
  const found: BookableSlot[] = [];

  let dayKey = firstDay;

  for (let i = 0; i < days; i++) {
    const windows = windowsForDate(availability, dayKey, timeOff);

    if (windows.length > 0) {
      const busySpans = busySpansOn({ date: dayKey, timezone, rows: busy, bufferMinutes: buffer });

      for (const window of windows) {
        const starts = offeredStarts({
          windowStart: toMinutes(window.start),
          windowEnd: toMinutes(window.end),
          durationMinutes: duration,
          stepMinutes: step,
          busy: busySpans,
        });

        for (const at of starts) {
          const start = businessInstant(dayKey, toClock(at), timezone);
          const ms = start.getTime();

          /* An hour already gone is not a slot, whoever is asking. */
          if (ms < earliest || ms > latest) continue;

          found.push({
            start: start.toISOString(),
            end: new Date(ms + duration * 60_000).toISOString(),
          });
        }
      }
    }

    dayKey = shiftBusinessDateKey(dayKey, 1);
  }

  found.sort((a, b) => a.start.localeCompare(b.start));

  logger.debug(
    { userId, serviceId, policy, days, slots: found.length },
    'Bookable slots computed'
  );

  return found;
}

/* ── choosing one ──────────────────────────────────────────────────────── */

/**
 * The slot that wastes the least of the diary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT SIMPLY THE FIRST ONE
 *
 * Anyone can take the earliest free hour. The reason an owner would hand this
 * to an agent at all is that the agent can see the whole week and they cannot:
 * placing a 60-minute appointment in the middle of a 90-minute opening strands
 * 30 minutes that nothing can ever be sold into, and doing that four times is
 * a day's work lost without a single visible mistake.
 *
 * So each candidate is scored by what it LEAVES BEHIND, and the best score
 * wins. Earliest is the tie-break, not the rule.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS WASTE, AND WHY IT NEEDS THE SHORTEST SERVICE
 *
 * A gap is wasted only if nothing could be sold into it. Twenty minutes is
 * dead for a massage studio whose shortest service is an hour, and perfectly
 * good for a clinic selling fifteen-minute consults. Without that number
 * "waste" has no meaning, so the caller passes it.
 *
 * The buffer is NOT waste. It is space the owner deliberately configured
 * between appointments, and an optimiser that eats it to look efficient has
 * removed the breathing room they asked for. It is already inside the busy
 * spans by the time slots are generated, so it is never a candidate here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY AN EMPTY DIARY FALLS BACK TO EARLIEST BY ITSELF
 *
 * A day with nothing in it has no edges to sit against and no gaps to strand —
 * every slot in it scores identically, so the tie-break decides and the agent
 * books the first hour. That is the right answer for a business with a quiet
 * week, and it arrives without a rule saying so.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function bestSlot(
  slots: BookableSlot[],
  args: {
    /** Everything already in the diary, as instants. Buffer NOT applied. */
    busy: Array<{ start_time: string; end_time: string }>;
    /** The shortest thing this business sells, in minutes. */
    shortestServiceMinutes: number;
  }
): BookableSlot | null {
  if (slots.length === 0) return null;

  const edges = args.busy
    .flatMap(b => [Date.parse(b.start_time), Date.parse(b.end_time)])
    .filter(ms => Number.isFinite(ms));

  /* A business with nothing booked: every slot scores the same, so this is
     the earliest, which `slots` is already sorted by. */
  if (edges.length === 0) return slots[0];

  const sellable = Math.max(1, args.shortestServiceMinutes) * 60_000;

  let best = slots[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const slot of slots) {
    const start = Date.parse(slot.start);
    const end = Date.parse(slot.end);

    /*
     * The nearest edge on each side. A slot that begins exactly where an
     * appointment ended extends a block; one that ends exactly where the next
     * begins closes a gap. Both leave nothing behind.
     */
    const before = edges.filter(e => e <= start).sort((a, b) => b - a)[0];
    const after = edges.filter(e => e >= end).sort((a, b) => a - b)[0];

    let stranded = 0;

    if (before !== undefined) {
      const gap = start - before;
      /* A gap smaller than anything sellable is dead space this placement
         created. A gap large enough to sell is not waste — it is inventory. */
      if (gap > 0 && gap < sellable) stranded += gap;
    }

    if (after !== undefined) {
      const gap = after - end;
      if (gap > 0 && gap < sellable) stranded += gap;
    }

    /*
     * ─────────────────────────────────────────────────────────────────────
     * AND NOTHING IS CHARGED FOR OPENING AN EMPTY DAY.
     *
     * There was a penalty here — "it spends a whole free day to place one
     * appointment" — and it was wrong twice. At one sellable unit it meant no
     * empty day could ever beat a day with something in it, and a live
     * booking went THIRTEEN DAYS OUT rather than take a free tomorrow.
     * Reduced to one minute it did the same thing, because this score has no
     * cost for delay at all: any slot scoring zero, anywhere inside the
     * ninety-day horizon, beats a slot tomorrow scoring one minute.
     *
     * The honest model is that only WASTE costs something. Stranded minutes
     * are real — nothing can be sold into them. A quiet Wednesday is not
     * waste; it is a day with nothing booked, which is a fact about demand
     * rather than about this placement.
     *
     * So: equal waste, earliest wins — the list is sorted and the comparison
     * is strict. An empty diary scores every slot zero and books tomorrow. A
     * busy one still packs, because a slot that strands half an hour loses to
     * one that strands nothing even if the tidy one is later.
     * ─────────────────────────────────────────────────────────────────────
     */

    if (stranded < bestScore) {
      bestScore = stranded;
      best = slot;
    }
    /* Equal scores keep the earlier one: `slots` is sorted, and the first to
       reach a score is the soonest that achieves it. */
  }

  return best;
}


function toMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + (m || 0);
}

function toClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
