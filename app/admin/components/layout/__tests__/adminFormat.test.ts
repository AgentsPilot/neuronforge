/**
 * The shared UTC formatter (Admin Layout Standard C-5, §5.11): the same output
 * as Jobs' `formatUtc`, so the L-1b swap is a no-op.
 */

import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { formatUtc as jobsFormatUtc } from '@/app/admin/components/jobs/jobsFormat';

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

  it('matches the Jobs copy on every sample (L-1b swap is a no-op)', () => {
    for (const sample of ['2026-10-09T14:02:59.000Z', '2026-10-09T16:02:00+02:00', null, '', 'not a date']) {
      expect(formatUtc(sample)).toBe(jobsFormatUtc(sample));
    }
  });
});
