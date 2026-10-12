/**
 * Date-only due dates (finance slice 2b, T2): AC-57 at the UTC midnight edge,
 * AC-74 (the logic half: unchanged in two process time zones), and every
 * value that is not a real date is "unknown", never past due.
 */

import { todayUtc } from '@/app/admin/components/adminWindowPresets';
import { daysPastDue, isDueDate, isPastDue } from '../dueDates';

describe('isDueDate', () => {
  it('accepts a real YYYY-MM-DD only', () => {
    expect(isDueDate('2026-09-30')).toBe(true);
    expect(isDueDate('2024-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2025-02-29', '', '2026-9-30', '2026-09-30T00:00:00Z', null, undefined, 20260930]) {
      expect({ bad, ok: isDueDate(bad) }).toEqual({ bad, ok: false });
    }
  });
});

describe('AC-57: past due is strictly before today’s UTC date', () => {
  // The request's one clock, either side of midnight UTC.
  const BEFORE_MIDNIGHT = new Date('2026-09-30T23:59:00Z');
  const AFTER_MIDNIGHT = new Date('2026-10-01T00:01:00Z');

  it('a due date of 2026-09-30 is not past due at 23:59 UTC that day, and is 1 day past due at 00:01 UTC the next', () => {
    expect(todayUtc(BEFORE_MIDNIGHT)).toBe('2026-09-30');
    expect(isPastDue('2026-09-30', todayUtc(BEFORE_MIDNIGHT))).toBe(false);
    expect(daysPastDue('2026-09-30', todayUtc(BEFORE_MIDNIGHT))).toBe(0);

    expect(todayUtc(AFTER_MIDNIGHT)).toBe('2026-10-01');
    expect(isPastDue('2026-09-30', todayUtc(AFTER_MIDNIGHT))).toBe(true);
    expect(daysPastDue('2026-09-30', todayUtc(AFTER_MIDNIGHT))).toBe(1);
  });

  it('a due date equal to today is never past due; a future one is not either', () => {
    expect(isPastDue('2026-10-01', '2026-10-01')).toBe(false);
    expect(isPastDue('2026-10-02', '2026-10-01')).toBe(false);
  });

  it('counts whole days across a month, a year and a leap day', () => {
    expect(daysPastDue('2026-10-05', '2026-10-12')).toBe(7);
    expect(daysPastDue('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysPastDue('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('a value that is not a real date is unknown: never past due, no day count', () => {
    for (const bad of [null, '', '2026-02-30', '2026-09-30T00:00:00Z', 'soon']) {
      expect(isPastDue(bad, '2026-10-01')).toBe(false);
      expect(daysPastDue(bad, '2026-10-01')).toBeNull();
    }
    expect(isPastDue('2026-09-30', 'not-today')).toBe(false);
    expect(daysPastDue('2026-09-30', '2026-13-01')).toBeNull();
  });
});

describe('AC-74 (logic half): the result does not depend on the process time zone', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(['America/New_York', 'Pacific/Auckland', 'UTC'])('in %s, 2026-09-30 is past due by 1 on 2026-10-01 and not on 2026-09-30', (zone) => {
    process.env.TZ = zone;
    expect(isPastDue('2026-09-30', '2026-10-01')).toBe(true);
    expect(daysPastDue('2026-09-30', '2026-10-01')).toBe(1);
    expect(isPastDue('2026-09-30', '2026-09-30')).toBe(false);
    expect(todayUtc(new Date('2026-09-30T23:59:00Z'))).toBe('2026-09-30');
  });
});
