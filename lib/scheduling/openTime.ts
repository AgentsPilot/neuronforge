/**
 * How much of a day is still free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The platform could already compute bookable slots — the public booking widget
 * does it — but nothing exposed the answer to the owner. Asked "מה הזמינות שלי
 * ביום רביעי?" the chat had no readable notion of availability at all, so it
 * did the only thing its catalog allowed: it listed BOOKINGS. Two of them, one
 * completed and one cancelled, neither of which says anything about whether
 * Wednesday is free. Asked again, more plainly, it answered "0 שעות פתוחות
 * היום" — the wrong day, and a number it had no way to know.
 *
 * WHY NOT REUSE THE BOOKING WIDGET'S calculateDaySlots
 *
 * Two reasons, both correctness. It walks `setHours` on a `Date`, which is the
 * SERVER's clock — right only while the server and the business share a zone.
 * And it takes `windows[0]`, so a business that closes for lunch has its
 * afternoon silently amputated; its own comment admits this. Neither is
 * acceptable for a number presented as "you have N hours free".
 *
 * What IS shared is `windowsForDay`, the normaliser — every historical shape of
 * the stored availability JSON is decoded in exactly one place, which is what
 * stopped two callers guessing differently and both being wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/scheduling
 */

import { instantToWallClock, wallClockToInstant } from './wallClock';
import { DAY_NAMES, windowsForDate, type AvailabilityWindow, type TimeOffEntry } from './availabilityWindows';

/** A booking, as stored: instants, in whatever zone they were written. */
export interface BookedInterval {
  start: string;
  end: string | null;
}

export interface OpenTimeResult {
  /** `YYYY-MM-DD`, the day as the business reckons it. */
  date: string;
  weekday: string;
  /** False when the business simply does not work that day. */
  isWorkingDay: boolean;
  /** The configured hours, normalised. */
  windows: AvailabilityWindow[];
  /** Booked time, clipped to working hours and merged. */
  busy: AvailabilityWindow[];
  /** What is left. */
  free: AvailabilityWindow[];
  freeMinutes: number;
  bookedMinutes: number;
  /** How many appointments of `durationMinutes` still fit, when asked. */
  slots?: number;
}

const MINUTES_IN_DAY = 24 * 60;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The weekday name `windowsForDay` expects, for a calendar date.
 *
 * No timezone involved, and that is the point: `date` is already the day as the
 * business reckons it, and what weekday a calendar date falls on is the same
 * everywhere. The first version formatted an instant at noon UTC in the
 * business zone — which is fine up to about UTC+11 and wrong beyond it, since
 * noon UTC is already the next day in Auckland. Deriving a civil fact from an
 * instant was the mistake; the arithmetic below cannot drift.
 */
export function weekdayFor(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return DAY_NAMES[day];
}

/** Merge overlapping or touching ranges so booked time is never counted twice. */
function merge(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];

  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    // `<=` not `<`: two bookings that abut are one continuous busy block, and
    // counting the seam as free would offer a zero-length gap as bookable.
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  return merged;
}

/**
 * Free time on one day.
 *
 * `bookings` must already be filtered to the ones that actually occupy time —
 * a cancelled booking does not, and a completed one in the past does not make
 * the day less free in the future. That judgment belongs to the caller, which
 * knows which statuses its question is about.
 */
/**
 * How many appointments of `duration` fit in `minutes`, with `buffer` between
 * them.
 *
 * The gaps go BETWEEN meetings, so three of them need two gaps, not three —
 * `floor(minutes / (duration + buffer))` quietly reserves one too many and
 * loses a whole appointment from a day that had room for it.
 */
function fits(minutes: number, duration: number, buffer: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.floor((minutes + buffer) / (duration + buffer)));
}

export function computeOpenTime(args: {
  availability: unknown;
  /** `YYYY-MM-DD` in the business's own zone. */
  date: string;
  timeZone: string;
  bookings: BookedInterval[];
  /** Length of the appointment being fitted, when the question names a service. */
  durationMinutes?: number;
  /**
   * The business's closed days and short days for this date.
   *
   * Optional, and an omitted list means "none recorded" rather than "none
   * exist" — a caller that does not pass it gets the weekly hours, which is
   * what every caller got before the table was read at all.
   */
  timeOff?: TimeOffEntry[];
  /**
   * The gap the business keeps BETWEEN appointments — `buffer_minutes`.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The column has existed since the first scheduling migration, defaults to
   * 15, is commented "Time between appointments", and the service modal has
   * always let the owner set it. Nothing in any booking path ever read it, so
   * every slot offered — to the owner and to the client — was back to back.
   *
   * Applied by widening what is BUSY before subtracting it, which handles both
   * sides at once: an hour cannot end flush against the next meeting, and
   * cannot start flush after the last one. It deliberately does NOT widen the
   * working day's own edges: closing time is not an appointment, so the last
   * slot may run right up to it.
   *
   * `busy` and `bookedMinutes` keep reporting the TRUE booked time. The buffer
   * is unbookable, not booked, and the day's shape bar would otherwise draw a
   * meeting longer than it is.
   * ───────────────────────────────────────────────────────────────────────────
   */
  bufferMinutes?: number;
}): OpenTimeResult {
  const { availability, date, timeZone, bookings, durationMinutes, timeOff } = args;
  const bufferMinutes = Math.max(0, args.bufferMinutes ?? 0);

  const weekday = weekdayFor(date);
  /*
   * The DATE's windows, not the weekday's. Asked "am I free on Tuesday", the
   * chat used to answer from the weekly pattern alone and call a holiday a
   * working day.
   */
  const windows = windowsForDate(availability, date, timeOff ?? []);

  if (windows.length === 0) {
    return {
      date,
      weekday,
      isWorkingDay: false,
      windows: [],
      busy: [],
      free: [],
      freeMinutes: 0,
      bookedMinutes: 0,
      ...(durationMinutes ? { slots: 0 } : {}),
    };
  }

  /*
   * Bookings arrive as instants and the hours are naive wall-clock strings, so
   * one side has to move. Converting the instants into the business's wall
   * clock is the direction that works: the reverse would need a date attached
   * to "09:00", and across a DST boundary there is no single right answer.
   */
  const booked: Array<[number, number]> = [];

  for (const booking of bookings) {
    if (!booking.start) continue;

    const localStart = instantToWallClock(booking.start, timeZone);
    const localEnd = booking.end ? instantToWallClock(booking.end, timeZone) : null;

    // Only what actually lands on this day. A booking that starts the previous
    // evening and runs past midnight still consumes this morning, so it is
    // clipped rather than dropped.
    const startsToday = localStart.slice(0, 10) === date;
    const endsToday = localEnd ? localEnd.slice(0, 10) === date : startsToday;
    if (!startsToday && !endsToday) continue;

    const startMin = startsToday ? toMinutes(localStart.slice(11, 16)) : 0;
    const endMin = localEnd
      ? endsToday
        ? toMinutes(localEnd.slice(11, 16))
        : MINUTES_IN_DAY
      : startMin;

    if (endMin > startMin) booked.push([startMin, endMin]);
  }

  const busyRanges = merge(booked);

  /*
   * What a NEW appointment cannot touch: every booked range widened by the
   * buffer on both sides, then re-merged — two meetings an hour apart with a
   * 45-minute buffer leave no usable gap between them, and widening without
   * re-merging would report that gap twice.
   *
   * Identical to `busyRanges` when there is no buffer, which is what keeps
   * every existing caller's answer unchanged.
   */
  const blockedRanges: Array<[number, number]> = bufferMinutes
    ? merge(
        busyRanges.map(
          ([from, to]) => [from - bufferMinutes, to + bufferMinutes] as [number, number]
        )
      )
    : busyRanges;

  const free: AvailabilityWindow[] = [];
  const busy: AvailabilityWindow[] = [];
  let freeMinutes = 0;
  let bookedMinutes = 0;
  let slots = 0;

  for (const window of windows) {
    const windowStart = toMinutes(window.start);
    const windowEnd = toMinutes(window.end);

    /*
     * What is BOOKED, reported as it truly is — the timeline draws from this,
     * and a block widened by the buffer would show a meeting longer than it
     * was. Clipped to the window: time booked outside working hours is real,
     * but it is not time the business was offering, so counting it would make
     * a day look more than fully booked.
     */
    for (const [busyStart, busyEnd] of busyRanges) {
      const overlapStart = Math.max(busyStart, windowStart);
      const overlapEnd = Math.min(busyEnd, windowEnd);
      if (overlapEnd <= overlapStart) continue;

      busy.push({ start: toClock(overlapStart), end: toClock(overlapEnd) });
      bookedMinutes += overlapEnd - overlapStart;
    }

    /* What is BOOKABLE, which is the same thing plus the gaps around it. */
    let cursor = windowStart;

    for (const [blockedStart, blockedEnd] of blockedRanges) {
      const overlapStart = Math.max(blockedStart, windowStart);
      const overlapEnd = Math.min(blockedEnd, windowEnd);
      if (overlapEnd <= overlapStart) continue;

      if (overlapStart > cursor) {
        free.push({ start: toClock(cursor), end: toClock(overlapStart) });
        freeMinutes += overlapStart - cursor;
        if (durationMinutes) slots += fits(overlapStart - cursor, durationMinutes, bufferMinutes);
      }

      cursor = Math.max(cursor, overlapEnd);
    }

    if (cursor < windowEnd) {
      free.push({ start: toClock(cursor), end: toClock(windowEnd) });
      freeMinutes += windowEnd - cursor;
      if (durationMinutes) slots += fits(windowEnd - cursor, durationMinutes, bufferMinutes);
    }
  }

  return {
    date,
    weekday,
    isWorkingDay: true,
    windows,
    busy,
    free,
    freeMinutes,
    bookedMinutes,
    ...(durationMinutes ? { slots } : {}),
  };
}

/**
 * The bookable starts inside a day's free windows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `computeOpenTime` answers WHEN the business is open and not already busy, as
 * clock ranges. This turns that into the discrete hours a person can actually
 * pick — the grid in the booking dialog, and the slot list a client sees.
 *
 * It lives beside `computeOpenTime` because the two are one question asked at
 * two resolutions, and because the public availability route had its own copy
 * of this stepping loop. A second copy is how the owner's dialog and the
 * client's page came to disagree about which hours exist.
 *
 * A slot is offered only when the whole service fits before the window closes:
 * a 60-minute service in a window ending at 17:00 has no 16:30 start. Stepping
 * is independent of duration — a 30-minute step over a 60-minute service is how
 * a half-past start becomes possible at all, which is what lets a booking close
 * an awkward gap instead of stranding it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function slotsInWindows(args: {
  /** `YYYY-MM-DD`, the day as the business reckons it. */
  date: string;
  /** Normally `computeOpenTime(...).free`. */
  windows: AvailabilityWindow[];
  timeZone: string;
  durationMinutes: number;
  /**
   * Minutes between candidate starts. Defaults to the appointment's own
   * length, so a 60-minute service is offered on the hour.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This was a fixed 30, on the reasoning that a half-past start is what lets
   * a booking close an awkward gap exactly. What it produced was a column of
   * times half an hour apart for an hour-long service — which reads as a list
   * of half-hour meetings, and that is how it was read.
   * ───────────────────────────────────────────────────────────────────────────
   */
  stepMinutes?: number;
  /**
   * The wall clock the step counts from — normally the day's opening hour.
   *
   * Without it the steps count from each FREE WINDOW's own start, and a window
   * beginning at 10:15 (a meeting ending at 10:00, plus the gap the business
   * keeps) offers 10:15, 11:15, 12:15 for the rest of the day. The hours are
   * correct and nobody reads them as hours.
   *
   * Anchored to the day instead, the same window offers 11:00 and 12:00: one
   * clock for the whole day, whatever time the meetings in it happen to end.
   */
  anchor?: string;
  /**
   * Drop any start at or before this instant.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * An hour that has gone is not a bookable hour, and offering it is worse than
   * offering nothing: the server refuses a booking in the past, so every one of
   * those is a click that ends in a refusal. On the day a dialog is opened,
   * most of the grid can be behind the clock — a business open from 09:00, read
   * at 11:12, had 09:00, 09:30, 10:00, 10:30 and 11:00 all on offer.
   *
   * It also kept the DAY COUNTS wrong: "6 free" for a day with two hours left.
   *
   * Optional because the rule belongs to the caller: a route answering "what is
   * bookable now" passes it, and a test or a report asking what a day's shape
   * WAS must not have the past quietly removed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  notBefore?: Date;
}): Array<{ start: string; end: string; available: boolean }> {
  const { date, windows, timeZone, durationMinutes, notBefore, anchor } = args;

  if (!durationMinutes || durationMinutes <= 0) return [];

  const stepMinutes = args.stepMinutes ?? durationMinutes;
  const anchorAt = anchor ? toMinutes(anchor) : null;

  const out: Array<{ start: string; end: string; available: boolean }> = [];

  for (const window of windows) {
    const opens = toMinutes(window.start);
    const closes = toMinutes(window.end);

    /*
     * The first start on the day's own grid that this window can hold. With no
     * anchor it is simply the window's opening, which is the old behaviour.
     */
    const offset = anchorAt === null ? 0 : (((opens - anchorAt) % stepMinutes) + stepMinutes) % stepMinutes;
    const firstStart = offset === 0 ? opens : opens + (stepMinutes - offset);

    /*
     * The wall clock the owner typed, resolved in the BUSINESS's zone. Built
     * from the date string rather than a Date object: a `new Date()` here
     * would resolve in the server's zone, which is UTC on Vercel, and a
     * business open at 09:00 in New York would publish 09:00 UTC — 05:00 in
     * its own reception.
     */
    const offer = (at: number) => {
      const start = wallClockToInstant(`${date}T${toClock(at)}:00`, timeZone);
      const end = wallClockToInstant(`${date}T${toClock(at + durationMinutes)}:00`, timeZone);

      /* Strictly after: a slot starting exactly now is already starting. */
      if (notBefore && new Date(start).getTime() <= notBefore.getTime()) return false;

      out.push({ start, end, available: true });
      return true;
    };

    let offered = 0;

    for (let at = firstStart; at + durationMinutes <= closes; at += stepMinutes) {
      if (offer(at)) offered += 1;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AN OPENING THAT FITS IS NEVER LEFT UNOFFERED.
     *
     * Anchoring the steps to the day keeps the grid on the hour, and it has a
     * hole: a window that genuinely holds the appointment but contains no
     * aligned start disappears entirely. A meeting ending at 10:00 and another
     * at 12:00, with the business's fifteen minutes either side, leaves
     * 10:15–11:45 — ninety minutes, room for an hour-long service — and 11:00
     * runs past the end of it, so nothing at all was offered. The owner saw
     * free time on the timeline with no hour under it.
     *
     * So when the clock grid comes up empty, the window's own earliest legal
     * start is offered instead. A quarter-past hour appears only where the
     * alternative was nothing.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (offered === 0 && opens + durationMinutes <= closes) offer(opens);
  }

  return out;
}
