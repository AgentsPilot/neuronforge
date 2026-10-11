/**
 * The shared formatters (Admin Layout Standard C-5, §5.11).
 *
 * L-1b (CR-4): Jobs' own copy of `formatUtc` is deleted, so the parity test
 * against it is gone. The swap is proven by `jobsQueues.render` "the page
 * renders a +02:00 start as UTC", which now runs through this formatter.
 */

import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';

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
