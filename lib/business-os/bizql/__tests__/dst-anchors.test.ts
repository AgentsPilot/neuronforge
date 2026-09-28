/**
 * Date anchors across a daylight-saving transition.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The existing `date-anchors.test.ts` asks these questions against the REAL
 * clock, so it only catches this on the handful of days a year when a zone is
 * mid-transition — it failed on 28 September 2026 and would have passed again
 * by October, with the bug still there.
 *
 * These pin the clock to each transition instead, so the two days a year that
 * break are checked on every run.
 *
 * WHAT WAS WRONG (two separate faults, one symptom)
 *
 *   1. `addDays` added a fixed 24 hours to an instant. A civil day either side
 *      of a transition is 23 or 25 hours, so a span across one landed in the
 *      neighbouring date: "the last 7 days" covered eight.
 *
 *   2. `startOfDayUtc` measured the zone's offset at NAIVE UTC MIDNIGHT — a
 *      different instant from the local midnight it was solving for, and on a
 *      transition day on the other side of the change. `start_of_week` came
 *      back a Saturday.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveDateExpr, startOfDayUtc, partsInZone } from '../dates';
import type { DateExpr } from '../types';

const dayOf = (iso: string) =>
  ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    new Date(`${iso}T00:00:00Z`).getUTCDay()
  ];

const daysBetween = (a: string, b: string) =>
  (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;

/**
 * Instants inside the week of a transition, one per hemisphere and direction.
 * Each is a real UTC moment on the day AFTER the clocks moved in that zone.
 */
const MOMENTS: { name: string; zone: string; now: string }[] = [
  // NZDT began 02:00 on Sunday 27 Sep 2026 (+12 → +13). This is the case that
  // was live when the bug was found.
  { name: 'Auckland, day after spring-forward', zone: 'Pacific/Auckland', now: '2026-09-27T22:00:00Z' },
  // IDT ended 02:00 on Sunday 25 Oct 2026 (+3 → +2).
  { name: 'Jerusalem, day after fall-back', zone: 'Asia/Jerusalem', now: '2026-10-25T12:00:00Z' },
  // EDT ended 02:00 on Sunday 1 Nov 2026 (−4 → −5).
  { name: 'New York, day after fall-back', zone: 'America/New_York', now: '2026-11-01T18:00:00Z' },
  // EDT began 02:00 on Sunday 8 Mar 2026 (−5 → −4).
  { name: 'New York, day after spring-forward', zone: 'America/New_York', now: '2026-03-08T18:00:00Z' },
];

describe.each(MOMENTS)('$name', ({ zone, now }) => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts the week on a Sunday', () => {
    const start = resolveDateExpr({ $date: 'start_of_week' } as DateExpr, zone, 'date');
    expect(dayOf(start)).toBe('sunday');
  });

  it('makes the week exactly seven days long', () => {
    const start = resolveDateExpr({ $date: 'start_of_week' } as DateExpr, zone, 'date');
    const end = resolveDateExpr({ $date: 'end_of_week' } as DateExpr, zone, 'date');
    expect(daysBetween(start, end)).toBe(7);
  });

  it('makes "the last 7 days" seven days, not eight', () => {
    const today = resolveDateExpr({ $date: 'today' } as DateExpr, zone, 'date');
    const weekAgo = resolveDateExpr(
      { $date: 'today', offset: { days: -7 } } as DateExpr, zone, 'date'
    );
    expect(daysBetween(weekAgo, today)).toBe(7);
  });

  it('keeps a four-week lookback at twenty-eight days', () => {
    const today = resolveDateExpr({ $date: 'today' } as DateExpr, zone, 'date');
    const monthAgo = resolveDateExpr(
      { $date: 'today', offset: { weeks: -4 } } as DateExpr, zone, 'date'
    );
    expect(daysBetween(monthAgo, today)).toBe(28);
  });

  it('puts tomorrow exactly one day after today', () => {
    const today = resolveDateExpr({ $date: 'today' } as DateExpr, zone, 'date');
    const tomorrow = resolveDateExpr({ $date: 'tomorrow' } as DateExpr, zone, 'date');
    expect(daysBetween(today, tomorrow)).toBe(1);
  });

  it('puts yesterday exactly one day before today', () => {
    const today = resolveDateExpr({ $date: 'today' } as DateExpr, zone, 'date');
    const yesterday = resolveDateExpr({ $date: 'yesterday' } as DateExpr, zone, 'date');
    expect(daysBetween(yesterday, today)).toBe(1);
  });
});

/**
 * The fault underneath both symptoms, asserted directly: midnight on the
 * transition day itself must still belong to that day.
 */
describe('startOfDayUtc on the transition day', () => {
  it.each([
    ['Pacific/Auckland', 2026, 9, 27],
    ['Asia/Jerusalem', 2026, 10, 25],
    ['America/New_York', 2026, 11, 1],
    ['America/New_York', 2026, 3, 8],
  ])('%s %s-%s-%s resolves to that same calendar day', (zone, y, m, d) => {
    const instant = startOfDayUtc(y as number, m as number, d as number, zone as string);
    expect(partsInZone(instant, zone as string)).toEqual({ y, m, d });
  });

  it('is unchanged on an ordinary day', () => {
    const instant = startOfDayUtc(2026, 6, 15, 'Pacific/Auckland');
    expect(partsInZone(instant, 'Pacific/Auckland')).toEqual({ y: 2026, m: 6, d: 15 });
  });
});
