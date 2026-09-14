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

import { instantToWallClock } from './wallClock';
import { DAY_NAMES, windowsForDay, type AvailabilityWindow } from './availabilityWindows';

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
export function computeOpenTime(args: {
  availability: unknown;
  /** `YYYY-MM-DD` in the business's own zone. */
  date: string;
  timeZone: string;
  bookings: BookedInterval[];
  /** Length of the appointment being fitted, when the question names a service. */
  durationMinutes?: number;
}): OpenTimeResult {
  const { availability, date, timeZone, bookings, durationMinutes } = args;

  const weekday = weekdayFor(date);
  const windows = windowsForDay(availability, weekday);

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

  const free: AvailabilityWindow[] = [];
  const busy: AvailabilityWindow[] = [];
  let freeMinutes = 0;
  let bookedMinutes = 0;
  let slots = 0;

  for (const window of windows) {
    const windowStart = toMinutes(window.start);
    const windowEnd = toMinutes(window.end);

    let cursor = windowStart;

    for (const [busyStart, busyEnd] of busyRanges) {
      // Clipped to the window: time booked outside working hours is real, but
      // it is not time the business was offering, so counting it would make a
      // day look more than fully booked.
      const overlapStart = Math.max(busyStart, windowStart);
      const overlapEnd = Math.min(busyEnd, windowEnd);
      if (overlapEnd <= overlapStart) continue;

      busy.push({ start: toClock(overlapStart), end: toClock(overlapEnd) });
      bookedMinutes += overlapEnd - overlapStart;

      if (overlapStart > cursor) {
        free.push({ start: toClock(cursor), end: toClock(overlapStart) });
        freeMinutes += overlapStart - cursor;
        if (durationMinutes) slots += Math.floor((overlapStart - cursor) / durationMinutes);
      }

      cursor = Math.max(cursor, overlapEnd);
    }

    if (cursor < windowEnd) {
      free.push({ start: toClock(cursor), end: toClock(windowEnd) });
      freeMinutes += windowEnd - cursor;
      if (durationMinutes) slots += Math.floor((windowEnd - cursor) / durationMinutes);
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
