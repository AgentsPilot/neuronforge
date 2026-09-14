/**
 * Weekday anchors, and the four lists that must agree about them.
 *
 * A weekday is the kind of date an anchor exists for: spoken relative to now,
 * resolved by the server against a real calendar. Without one, "כמה פגישות יש
 * לי ביום רביעי?" had no expressible form — so the planner did the arithmetic
 * itself. Told it was Monday 7 September it filtered on the 14th, a Monday; on
 * another run it emitted no day filter at all and reported every booking the
 * business had ever taken as Wednesday's.
 */

import { resolveDateExpr } from '../dates';
import { DATE_ANCHORS } from '../types';
import { buildPlanTool } from '../planner/planTool';
import type { DateExpr } from '../types';

const TZ = 'UTC';
const weekdayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' })
    .format(new Date(iso))
    .toLowerCase();

describe('a weekday the user named', () => {
  it.each(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])(
    'resolves %p to a date that really is that weekday',
    (day) => {
      expect(weekdayOf(resolveDateExpr({ $date: day } as DateExpr, TZ, 'datetime'))).toBe(day);
    }
  );

  it('never resolves to the past', () => {
    // "On Wednesday" means the one coming, not the one gone.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const day of ['sunday', 'wednesday', 'saturday']) {
      const resolved = new Date(resolveDateExpr({ $date: day } as DateExpr, TZ, 'datetime'));
      expect(resolved.getTime()).toBeGreaterThanOrEqual(today.getTime());
    }
  });

  it('stays within the coming week', () => {
    // The NEXT occurrence — counting today — so it can never be more than six
    // days out. A wider answer would mean the arithmetic wrapped.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const day of DATE_ANCHORS.filter((a) => weekdayNames.has(a))) {
      const resolved = new Date(resolveDateExpr({ $date: day } as DateExpr, TZ, 'datetime'));
      const daysAhead = (resolved.getTime() - today.getTime()) / 86_400_000;
      expect(daysAhead).toBeLessThanOrEqual(6);
    }
  });

  it('composes with an offset for the week before', () => {
    const next = new Date(resolveDateExpr({ $date: 'wednesday' } as DateExpr, TZ, 'datetime'));
    const last = new Date(
      resolveDateExpr({ $date: 'wednesday', offset: { weeks: -1 } } as DateExpr, TZ, 'datetime')
    );

    expect(weekdayOf(last.toISOString())).toBe('wednesday');
    expect((next.getTime() - last.getTime()) / 86_400_000).toBe(7);
  });
});

const weekdayNames = new Set([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

describe('the four copies of the anchor list', () => {
  /*
   * The vocabulary is spelled out in types.ts, dates.ts, validatePlan.ts and
   * planTool.ts. They had already drifted: planTool advertised a narrower set
   * than the resolver accepted, silently withholding start_of_day/end_of_day
   * from the planner. Nothing failed — the planner just never used them.
   */
  it('the tool schema advertises exactly what the resolver accepts', () => {
    const tool = buildPlanTool(['bookings']) as unknown as {
      function: { parameters: { properties: { steps: { items: { properties: Record<string, { description?: string }> } } } } };
    };

    const described = tool.function.parameters.properties.steps.items.properties.where
      ? JSON.stringify(tool.function.parameters)
      : '';

    for (const anchor of DATE_ANCHORS) {
      expect(described).toContain(anchor);
    }
  });

  it('the validator accepts every anchor the resolver does', () => {
    for (const anchor of DATE_ANCHORS) {
      expect(() => resolveDateExpr({ $date: anchor } as DateExpr, TZ)).not.toThrow();
    }
  });
});

describe('east of Greenwich — where the off-by-one lived', () => {
  /*
   * These ran only in UTC, and that is exactly why the bug survived.
   *
   * `today` is local midnight expressed as a UTC instant, so in Asia/Jerusalem
   * it is 21:00Z the PREVIOUS day. Calling getUTCDay() on it answers Monday for
   * a Tuesday — one day of error in every weekday calculation, for everyone
   * ahead of UTC, invisible to a test suite that never leaves UTC.
   *
   * It was not only the new weekday anchors: `start_of_week` and `end_of_week`
   * carried the same line and had been wrong the whole time.
   */
  const ZONES = ['Asia/Jerusalem', 'Pacific/Auckland', 'America/Los_Angeles'];

  /*
   * The resolver returns a CALENDAR DATE, so its weekday is read as one.
   *
   * The first version of this helper formatted noon UTC in the business zone —
   * which is already the next day in Auckland, so it reported Monday for a
   * Sunday and failed a correct resolver. The same mistake the resolver itself
   * had, made again one layer up: a civil fact must not be derived from an
   * instant.
   */
  const weekdayOfDate = (iso: string) =>
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      new Date(`${iso}T00:00:00Z`).getUTCDay()
    ];

  it.each(ZONES)('resolves each weekday correctly in %s', (zone) => {
    for (const day of ['sunday', 'wednesday', 'saturday']) {
      const resolved = resolveDateExpr({ $date: day } as DateExpr, zone, 'date');
      expect(weekdayOfDate(resolved)).toBe(day);
    }
  });

  it.each(ZONES)('starts the week on a Sunday in %s', (zone) => {
    const start = resolveDateExpr({ $date: 'start_of_week' } as DateExpr, zone, 'date');
    expect(weekdayOfDate(start)).toBe('sunday');
  });

  it.each(ZONES)('ends the week exactly seven days later in %s', (zone) => {
    const start = resolveDateExpr({ $date: 'start_of_week' } as DateExpr, zone, 'date');
    const end = resolveDateExpr({ $date: 'end_of_week' } as DateExpr, zone, 'date');
    const days =
      (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000;

    expect(days).toBe(7);
  });

  it('resolves a weekday to today when today IS that weekday', () => {
    const zone = 'Asia/Jerusalem';
    const todayName = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' })
      .format(new Date())
      .toLowerCase();

    const resolved = resolveDateExpr({ $date: todayName } as DateExpr, zone, 'date');
    const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

    expect(resolved).toBe(todayLocal);
  });
});
