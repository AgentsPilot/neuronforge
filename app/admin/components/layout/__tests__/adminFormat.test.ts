/**
 * The shared formatters (Admin Layout Standard C-5, §5.11).
 *
 * L-1b (CR-4): Jobs' own copy of `formatUtc` is deleted, so the parity test
 * against it is gone. The swap is proven by `jobsQueues.render` "the page
 * renders a +02:00 start as UTC", which now runs through this formatter.
 */

import { formatCount, formatUtc, formatUtcTime } from '@/app/admin/components/layout/adminFormat';
// Finance slice 2b (AC-74): a separate import, so the line above stays unedited (SA-WR-21).
import { formatUtcDate } from '@/app/admin/components/layout/adminFormat';
import * as fs from 'fs';
import * as path from 'path';

describe('formatUtc', () => {
  it('prints a Z instant as "YYYY-MM-DD HH:mm UTC"', () => {
    expect(formatUtc('2026-10-09T14:02:59.000Z')).toBe('2026-10-09 14:02 UTC');
  });

  it('converts an offset instant to UTC through Date, never by slicing the text', () => {
    expect(formatUtc('2026-10-09T16:02:00+02:00')).toBe('2026-10-09 14:02 UTC');
    // Crosses midnight: the date changes too.
    expect(formatUtc('2026-10-10T01:30:00+02:00')).toBe('2026-10-09 23:30 UTC');
  });

  it('shows an em dash for null, an empty string and an invalid value', () => {
    expect(formatUtc(null)).toBe('—');
    expect(formatUtc('')).toBe('—');
    expect(formatUtc('not a date')).toBe('—');
  });
});

describe('formatCount', () => {
  it('prints thousands separators (§5.11)', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(12345)).toBe('12,345');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('shows an em dash for a value that is not a finite number, never "NaN"', () => {
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatCount(Number.NEGATIVE_INFINITY)).toBe('—');
  });
});

describe('formatUtcTime (L-1c, the "Read at" line)', () => {
  it('prints "HH:mm UTC", converting an offset through Date', () => {
    expect(formatUtcTime('2026-10-09T14:02:59.000Z')).toBe('14:02 UTC');
    expect(formatUtcTime('2026-10-10T01:30:00+02:00')).toBe('23:30 UTC');
  });

  it('shows an em dash for null and an invalid value', () => {
    expect(formatUtcTime(null)).toBe('—');
    expect(formatUtcTime('not a date')).toBe('—');
  });
});

describe('formatUtcDate (finance slice 2b, AC-74: a date-only value is never moved a day)', () => {
  const ZONES = ['America/New_York', 'Pacific/Auckland'];
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(ZONES)('2026-09-30 renders as 2026-09-30 with the process in %s', (zone) => {
    process.env.TZ = zone;
    expect(formatUtcDate('2026-09-30')).toBe('2026-09-30');
    expect(formatUtcDate('2026-01-01')).toBe('2026-01-01');
    expect(formatUtcDate('2024-02-29')).toBe('2024-02-29');
  });

  it('non-vacuity: the same date passed through Date really does move a day in those zones', () => {
    // Midnight UTC is the evening before in New York, and the next day's noon in Auckland is still the 30th:
    // so the control uses the start and end of the UTC day (dateOnlyIsNotMidnightUTC's method).
    expect(new Date('2026-09-30').toLocaleDateString('en-CA', { timeZone: 'America/New_York' })).toBe('2026-09-29');
    expect(new Date('2026-09-30T23:59:00Z').toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })).toBe('2026-10-01');
  });

  it('shows an em dash for null, an empty string, a date that does not exist and a timestamp', () => {
    expect(formatUtcDate(null)).toBe('—');
    expect(formatUtcDate('')).toBe('—');
    expect(formatUtcDate('2026-02-30')).toBe('—');
    expect(formatUtcDate('2026-09-30T00:00:00Z')).toBe('—');
    expect(formatUtcDate('30/09/2026')).toBe('—');
  });

  it('its body never builds a Date (no new Date, no Date.parse): the text is returned as it is', () => {
    const code = fs.readFileSync(path.join(process.cwd(), 'app/admin/components/layout/adminFormat.ts'), 'utf8');
    const start = code.indexOf('export function formatUtcDate');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start).split(/\r?\n\}\r?\n/)[0];
    expect(body).toMatch(/isRealDate/);
    expect(body).not.toMatch(/new Date|Date\.parse/);
    // Planted negative control: the rule sees a Date in a body.
    expect('return new Date(value).toISOString();').toMatch(/new Date|Date\.parse/);
  });
});
