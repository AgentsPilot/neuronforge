/**
 * Which starts a day can actually hold, given what is already in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, IN THREE SENTENCES
 *
 *   1. Starts are spaced by the appointment PLUS the gap the business keeps
 *      after it, so a day of them tiles exactly and nothing is stranded.
 *   2. Each FREE stretch is packed from its own beginning, so nothing that
 *      could hold the appointment is ever left unoffered.
 *   3. On a day with nothing in it the stretch is the window itself, so the
 *      first time offered is the hour the business opens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY RULE 2 EXISTS, WHICH IS THE WHOLE REASON THIS MODULE DOES
 *
 * The public pages used to tile the WHOLE day and then drop whatever clashed.
 * That is what most booking products do, and it stands time up in the corner:
 * a 45-minute service with a 15-minute gap, booked at 09:00 and 11:00, leaves
 * 09:45 to 11:00 free — room for the appointment — and the aligned grid lands
 * on 09:45 (clashes) and 10:30 (clashes), so the hour is offered to nobody. The
 * owner sees a hole in the diary that no client can book.
 *
 * Working from the FREE stretches rather than the whole day is what fixes it,
 * and it is not a new idea here: `slotsInWindows` in `openTime.ts` — the
 * owner's own grid — has done exactly this for a while, down to the same
 * fallback. This module is that reasoning, made available to the client-facing
 * generators so both ends of the product answer the same question the same way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS MINUTES FROM MIDNIGHT, ON THE BUSINESS'S OWN CLOCK
 *
 * No dates, no zones, no instants. The callers each hold a different
 * representation — one walks wall-clock strings, the other walks UTC instants —
 * and both can reduce a day to minutes. Keeping the arithmetic in one unit is
 * what stops the two drifting apart again.
 *
 * @module lib/scheduling/offeredStarts
 */

import { businessClock, businessDateKey } from '@/lib/scheduling/businessTime';

/** A stretch that is NOT available, already widened by the business's gap. */
export interface BusySpan {
  startMins: number;
  endMins: number;
}

/**
 * The starts to offer inside one open window.
 *
 * @returns minutes from midnight, ascending, each one a start the appointment
 *          genuinely fits into.
 */
export function offeredStarts(args: {
  /** The window the business is open, in minutes from midnight. */
  windowStart: number;
  windowEnd: number;
  /** How long the appointment itself runs. */
  durationMinutes: number;
  /**
   * How far apart consecutive starts sit — normally the duration plus the gap.
   * Decided by `slotInterval.ts`, never here: this module places starts, it
   * does not choose the rhythm.
   */
  stepMinutes: number;
  /** Everything already taken, clipped to this day and widened by the gap. */
  busy: BusySpan[];
}): number[] {
  const { windowStart, windowEnd, durationMinutes, stepMinutes, busy } = args;

  if (!(durationMinutes > 0)) return [];
  /* A step of zero would spin for ever on a page a client is waiting for. */
  const step = stepMinutes > 0 ? stepMinutes : durationMinutes;

  const starts: number[] = [];

  for (const free of freeStretches(windowStart, windowEnd, busy)) {
    /*
     * PACKED FROM THE STRETCH'S OWN BEGINNING, NOT FROM A CLOCK GRID.
     *
     * An aligned grid wastes the head of every stretch it does not happen to
     * land on, and that waste is unsellable: an afternoon window opening at
     * 13:20 on an hourly grid offers 14:00 and leaves 15:00 to 16:00 free with
     * nothing under it, because the next grid position falls past the close.
     * Measured exactly that way before this changed.
     *
     * Packing from `free.startMins` is the only rule that cannot strand time:
     * each stretch is filled end to end, and whatever is left at the tail is
     * genuinely too short to hold the appointment.
     *
     * On an EMPTY day the stretch IS the window, so the first start is the hour
     * the business opens and the times read exactly as they always did. The
     * ragged ones appear only where the day is already broken up, which is the
     * moment an owner most wants the leftovers sold.
     */
    for (let at = free.startMins; at + durationMinutes <= free.endMins; at += step) {
      starts.push(at);
    }
  }

  return starts.sort((a, b) => a - b);
}

/**
 * The window, less everything taken out of it.
 *
 * Spans are clipped to the window and merged before subtracting, so two
 * appointments that overlap — or one that runs past the other's end — cut one
 * hole rather than producing a negative stretch between them.
 */
function freeStretches(
  windowStart: number,
  windowEnd: number,
  busy: BusySpan[]
): Array<{ startMins: number; endMins: number }> {
  const clipped = busy
    .map(span => ({
      startMins: Math.max(span.startMins, windowStart),
      endMins: Math.min(span.endMins, windowEnd),
    }))
    .filter(span => span.endMins > span.startMins)
    .sort((a, b) => a.startMins - b.startMins);

  const merged: Array<{ startMins: number; endMins: number }> = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.startMins <= last.endMins) {
      last.endMins = Math.max(last.endMins, span.endMins);
    } else {
      merged.push({ ...span });
    }
  }

  const free: Array<{ startMins: number; endMins: number }> = [];
  let at = windowStart;
  for (const span of merged) {
    if (span.startMins > at) free.push({ startMins: at, endMins: span.startMins });
    at = Math.max(at, span.endMins);
  }
  if (at < windowEnd) free.push({ startMins: at, endMins: windowEnd });

  return free;
}

/**
 * Taken time, as minutes of ONE day on the business's clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Lifted out of `generateTimeSlots` so the smart-link route can run the same
 * arithmetic instead of its own. It had its own, in instants, and the two
 * disagreed about what a taken hour was.
 *
 * Three things it gets right that a naive read does not:
 *
 *   · a booking is an INSTANT and the window is the business's wall clock, so
 *     the hours are read in the business's zone. Read in the server's zone, a
 *     14:00 appointment in New York blocked 18:00 and a client could book over
 *     it;
 *   · a span that starts the previous evening or ends the next morning still
 *     occupies hours of THIS day, so it is clipped to the day's own edges
 *     rather than producing a backwards range no slot can overlap;
 *   · the business's gap widens it at both ends, so an appointment can neither
 *     start against the last one nor end against the next.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function busySpansOn(args: {
  /** `YYYY-MM-DD`, the day as the business reckons it. */
  date: string;
  timezone: string;
  rows: Array<{ start_time: string; end_time: string }>;
  /** `buffer_minutes`; widens every span at both ends. */
  bufferMinutes?: number | null;
}): BusySpan[] {
  const { date, timezone, rows } = args;
  const buffer =
    typeof args.bufferMinutes === 'number' && Number.isFinite(args.bufferMinutes) && args.bufferMinutes > 0
      ? args.bufferMinutes
      : 0;

  return (rows || [])
    .map(row => {
      const start = new Date(row.start_time);
      const end = new Date(row.end_time);
      const startKey = businessDateKey(start, timezone);
      const endKey = businessDateKey(end, timezone);

      /* `YYYY-MM-DD` sorts lexically, so string comparison is date comparison. */
      if (startKey > date || endKey < date) return null;

      const s = businessClock(start, timezone);
      const e = businessClock(end, timezone);
      const MIDNIGHT = 24 * 60;

      return {
        startMins: (startKey < date ? 0 : s.hour * 60 + s.minute) - buffer,
        endMins: (endKey > date ? MIDNIGHT : e.hour * 60 + e.minute) + buffer,
      };
    })
    .filter((span): span is BusySpan => span !== null);
}
