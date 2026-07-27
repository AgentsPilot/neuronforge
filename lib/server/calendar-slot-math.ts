// lib/server/calendar-slot-math.ts
//
// Pure, deterministic, network-free slot-computation core for the Google
// Calendar `list_available_slots` action. NOTHING in this module reads the
// wall clock (`Date.now()`) or performs I/O — every time-dependent input
// (notably `earliestBookableMs`) is passed in by the caller. This is what
// makes the whole slot algorithm unit-testable in isolation (CR-5).
//
// Timezone/DST strategy (SA OQ2 → rule A): timezone math is done with the
// built-in `Intl.DateTimeFormat` idiom already used in the codebase
// (`lib/pilot/transforms/StructuredTransforms.ts` — the WP-31 "today-in-tz"
// computation). No new dependency. The single DST-sensitive operation —
// converting a local wall-clock time in a zone to an absolute UTC epoch —
// lives in `wallClockToUtcEpoch` and follows the mandated guess-and-correct
// structure (CR-1).

/** Milliseconds interval on the absolute (UTC-epoch) timeline. */
export interface Interval {
  startMs: number;
  endMs: number;
}

/** A working-hours rule: which weekdays + a wall-clock HH:MM window in the zone. */
export interface WorkingWindow {
  days: string[]; // lowercase weekday names, e.g. ["monday","tuesday"]
  start: string; // "HH:MM" wall-clock in `timeZone`
  end: string; // "HH:MM" wall-clock in `timeZone`
}

/** Working hours: an IANA time zone + one or more windows. */
export interface WorkingHours {
  timeZone: string;
  windows: WorkingWindow[];
}

/** Fully-resolved, clock-free input to the slot computation. */
export interface ComputeAvailableSlotsInput {
  rangeStartMs: number;
  rangeEndMs: number;
  /** Busy blocks already fetched (start/end only), on the absolute timeline. */
  busyIntervals: Interval[];
  workingHours: WorkingHours;
  slotDurationMs: number;
  bufferMs: number;
  /** Earliest instant a slot may start (= now + min_notice). Passed in — never read here. */
  earliestBookableMs: number;
  maxSlots: number;
}

/** An emitted slot as UTC `Z` RFC3339 instants. */
export interface Slot {
  start: string;
  end: string;
}

/** Weekday names indexed by `Date.getUTCDay()` (0 = Sunday). */
export const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a "HH:MM" 24-hour wall-clock string.
 * Returns null when the value is not a valid HH:MM in [00:00, 23:59].
 */
export function parseHhMm(value: unknown): { hours: number; minutes: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Resolve the UTC offset (ms) of `timeZone` at absolute instant `utcMs`.
 *
 * The offset is defined so that the local wall-clock reading at `utcMs`,
 * interpreted as if it were a UTC instant, equals `utcMs + offset`.
 * (e.g. New York in winter → offset = -5h.)
 *
 * Uses `Intl.DateTimeFormat(...).formatToParts` — the same house idiom as
 * StructuredTransforms.ts — so it is DST-correct: the offset is queried
 * per-instant, not assumed fixed.
 */
function getZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  // Some engines render midnight as hour "24" under h23 — normalise to 0.
  let hour = Number(map.hour) % 24;
  if (!Number.isFinite(hour)) hour = 0;

  const wallAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );

  return wallAsUtc - utcMs;
}

/**
 * Convert a wall-clock date+time in `timeZone` to an absolute UTC epoch (ms).
 *
 * This is the ONLY DST-sensitive step in the algorithm. It follows the mandated
 * guess-and-correct structure (CR-1):
 *   1. Guess `desired` = the wall-clock treated as if it were UTC.
 *   2. Resolve the offset at that guess and correct: `utc = desired - offset`.
 *   3. Re-derive the offset at `utc`; if it changed (a DST boundary was crossed),
 *      correct once more and verify consistency.
 *
 * DST-transition policy (documented, CR-1) — as stated below it holds for
 * western / negative-offset zones (US, EU), the dominant case:
 *   - Nonexistent local time (spring-forward gap): shift FORWARD to the next
 *     valid instant. Returning `desired - offsetBefore` yields exactly that
 *     forward-shifted instant.
 *   - Ambiguous local time (fall-back overlap): pick the EARLIER offset. The
 *     first guess naturally resolves to the earlier (pre-transition) offset
 *     because `desired`-as-UTC falls before the transition instant.
 *
 * Caveat (eastern / positive-offset zones, e.g. Australia/Sydney): the
 * guess-and-correct resolves to the OPPOSITE branch (gap → backward, ambiguous
 * → later offset). Both still yield a VALID absolute instant — only the
 * gap/overlap disambiguation differs. This branch is reachable only for a
 * wall-clock time INSIDE the 1-hour DST transition window; business-hours
 * `working_hours` (e.g. 09:00–17:00) never specify such a time, so there is
 * zero impact on slot output. Generalizing per-hemisphere is a tracked
 * nice-to-have, not fixed here.
 */
export function wallClockToUtcEpoch(
  year: number,
  month: number, // 1-12
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): number {
  // Wall-clock treated as if it were a UTC instant.
  const desired = Date.UTC(year, month - 1, day, hours, minutes);

  const offset1 = getZoneOffsetMs(desired, timeZone);
  const utc1 = desired - offset1;
  const offset2 = getZoneOffsetMs(utc1, timeZone);

  // Consistent: the instant maps back to the requested wall-clock. Also the
  // ambiguous fall-back case — offset1 is the earlier (pre-transition) offset.
  if (offset1 === offset2) {
    return utc1;
  }

  // Offsets differ → we are adjacent to a DST boundary. Try the second offset.
  const utc2 = desired - offset2;
  const offset3 = getZoneOffsetMs(utc2, timeZone);
  if (offset2 === offset3) {
    return utc2;
  }

  // Neither candidate is self-consistent → the requested wall-clock time does
  // not exist (spring-forward gap). Policy: shift forward. `utc1` (using the
  // pre-transition offset) is the forward-shifted valid instant.
  return utc1;
}

/**
 * Extract the zone-local calendar date (y/m/d) of an absolute instant.
 */
function getZonedDateParts(
  utcMs: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

/**
 * Sort + coalesce overlapping/adjacent intervals into a minimal set.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Expand each interval by `bufferMs` on BOTH sides (padding around busy blocks).
 */
export function padIntervals(intervals: Interval[], bufferMs: number): Interval[] {
  if (bufferMs <= 0) return intervals.map((iv) => ({ ...iv }));
  return intervals.map((iv) => ({
    startMs: iv.startMs - bufferMs,
    endMs: iv.endMs + bufferMs,
  }));
}

/**
 * Subtract `blocked` intervals from a single `free` window, returning the
 * remaining free sub-windows in order. Overlap-tolerant: `blocked` need not be
 * pre-merged (CR-3 belt-and-suspenders), though callers merge it anyway.
 */
export function subtractIntervals(free: Interval, blocked: Interval[]): Interval[] {
  let segments: Interval[] = [{ ...free }];
  for (const b of blocked) {
    const next: Interval[] = [];
    for (const seg of segments) {
      // No overlap → keep the segment intact.
      if (b.endMs <= seg.startMs || b.startMs >= seg.endMs) {
        next.push(seg);
        continue;
      }
      // Left remainder.
      if (b.startMs > seg.startMs) {
        next.push({ startMs: seg.startMs, endMs: b.startMs });
      }
      // Right remainder.
      if (b.endMs < seg.endMs) {
        next.push({ startMs: b.endMs, endMs: seg.endMs });
      }
    }
    segments = next;
  }
  return segments;
}

/**
 * Slice a free window into back-to-back fixed-length slots. Emits a slot only
 * when it fully fits (`slotStart + duration <= windowEnd`) — the trailing
 * partial slot at the boundary is dropped (the classic off-by-one guard).
 */
export function sliceIntoSlots(window: Interval, slotDurationMs: number): Interval[] {
  const slots: Interval[] = [];
  if (slotDurationMs <= 0) return slots;
  let start = window.startMs;
  while (start + slotDurationMs <= window.endMs) {
    slots.push({ startMs: start, endMs: start + slotDurationMs });
    start += slotDurationMs;
  }
  return slots;
}

/**
 * Expand working-hours rules into concrete dated windows on the absolute
 * timeline across `[rangeStartMs, rangeEndMs]`, in `timeZone`.
 *
 * For each zone-local calendar date overlapping the range: match rules by
 * weekday, convert each rule's HH:MM wall-clock to a UTC epoch (the DST step),
 * UNION same-day windows (CR-2 — avoids duplicate/overlapping slots), then clip
 * to the range. Days are walked ascending, so the result is chronological.
 */
export function expandWorkingWindows(
  rangeStartMs: number,
  rangeEndMs: number,
  workingHours: WorkingHours,
): Interval[] {
  const { timeZone, windows } = workingHours;
  const result: Interval[] = [];
  if (rangeEndMs <= rangeStartMs || windows.length === 0) return result;

  const startDate = getZonedDateParts(rangeStartMs, timeZone);
  const endDate = getZonedDateParts(rangeEndMs, timeZone);

  // Walk calendar dates using UTC-midnight anchors. UTC has no DST, so adding
  // MS_PER_DAY always advances exactly one calendar date.
  let cursor = Date.UTC(startDate.year, startDate.month - 1, startDate.day);
  const endAnchor = Date.UTC(endDate.year, endDate.month - 1, endDate.day);

  while (cursor <= endAnchor) {
    const anchor = new Date(cursor);
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + 1;
    const d = anchor.getUTCDate();
    const weekday = WEEKDAY_NAMES[anchor.getUTCDay()];

    const dayWindows: Interval[] = [];
    for (const w of windows) {
      const matches = w.days.some((day) => String(day).toLowerCase() === weekday);
      if (!matches) continue;
      const startHm = parseHhMm(w.start);
      const endHm = parseHhMm(w.end);
      if (!startHm || !endHm) continue;
      const startMs = wallClockToUtcEpoch(y, m, d, startHm.hours, startHm.minutes, timeZone);
      const endMs = wallClockToUtcEpoch(y, m, d, endHm.hours, endHm.minutes, timeZone);
      if (endMs > startMs) dayWindows.push({ startMs, endMs });
    }

    // CR-2: union same-day windows before they are sliced.
    for (const win of mergeIntervals(dayWindows)) {
      const s = Math.max(win.startMs, rangeStartMs);
      const e = Math.min(win.endMs, rangeEndMs);
      if (e > s) result.push({ startMs: s, endMs: e });
    }

    cursor += MS_PER_DAY;
  }

  return result;
}

/**
 * Compute available booking slots. Pure and deterministic — see module header.
 *
 * Pipeline (all on the absolute UTC-epoch timeline):
 *   1. Expand working-hours into concrete dated windows (DST-correct).
 *   2. Merge busy → pad by buffer on both sides → RE-MERGE (CR-3).
 *   3. Apply the earliest-bookable floor to each window.
 *   4. Subtract blocked intervals → free runs.
 *   5. Slice each free run into fixed-length slots (no partial slot).
 *   6. Collect chronologically, capped at `maxSlots`.
 */
export function computeAvailableSlots(input: ComputeAvailableSlotsInput): Slot[] {
  const {
    rangeStartMs,
    rangeEndMs,
    busyIntervals,
    workingHours,
    slotDurationMs,
    bufferMs,
    earliestBookableMs,
    maxSlots,
  } = input;

  const slots: Slot[] = [];
  if (maxSlots <= 0 || slotDurationMs <= 0) return slots;

  // 1. Working windows.
  const workingWindows = expandWorkingWindows(rangeStartMs, rangeEndMs, workingHours);

  // 2. Blocked = merged busy, padded by buffer, RE-MERGED so padded overlaps
  //    don't corrupt the subtraction (CR-3).
  const mergedBusy = mergeIntervals(busyIntervals);
  const blocked = bufferMs > 0 ? mergeIntervals(padIntervals(mergedBusy, bufferMs)) : mergedBusy;

  for (const win of workingWindows) {
    // 3. Earliest-bookable floor: trim the start; skip windows fully in the past.
    const flooredStart = Math.max(win.startMs, earliestBookableMs);
    if (flooredStart >= win.endMs) continue;
    const floored: Interval = { startMs: flooredStart, endMs: win.endMs };

    // 4. Subtract blocked → free runs.
    const freeRuns = subtractIntervals(floored, blocked);

    // 5 + 6. Slice, collect chronologically, cap.
    for (const run of freeRuns) {
      for (const slot of sliceIntoSlots(run, slotDurationMs)) {
        if (slots.length >= maxSlots) return slots;
        slots.push({
          start: new Date(slot.startMs).toISOString(),
          end: new Date(slot.endMs).toISOString(),
        });
      }
    }
  }

  return slots;
}
