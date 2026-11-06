/**
 * The lock date of a deletion request (DL-1b; workplan D-4; SA W-11):
 * `businessDayFor(now, zone, 14).startUtc`, day 1 being the local day the
 * grace period starts. Asia/Jerusalem is UTC+2 in winter and UTC+3 in summer;
 * its 2026 summer time ends on Sunday 25 October.
 */

import { closureLockAt } from '../closureDates';
import { GRACE_DAYS } from '../closureLifecycle';

describe('closureLockAt (SA W-11)', () => {
  it('is the start of local day 15: 14 calendar days after the local request day', () => {
    expect(GRACE_DAYS).toBe(14);
    // 4 Nov 2026, 12:00 in Jerusalem (UTC+2) → 18 Nov 00:00 local = 17 Nov 22:00 UTC.
    expect(closureLockAt(new Date('2026-11-04T10:00:00.000Z'), 'Asia/Jerusalem')).toEqual({
      lockAt: '2026-11-17T22:00:00.000Z',
      lockTimezone: 'Asia/Jerusalem',
    });
  });

  it('a request at 23:30 local and one at 00:10 local the next day lock a day apart', () => {
    const late = closureLockAt(new Date('2026-11-04T21:30:00.000Z'), 'Asia/Jerusalem'); // 23:30 on 4 Nov
    const early = closureLockAt(new Date('2026-11-04T22:10:00.000Z'), 'Asia/Jerusalem'); // 00:10 on 5 Nov
    expect(late.lockAt).toBe('2026-11-17T22:00:00.000Z'); // 18 Nov 00:00 local
    expect(early.lockAt).toBe('2026-11-18T22:00:00.000Z'); // 19 Nov 00:00 local
  });

  it('the DST week: requested in summer time, locked at a local midnight in winter time', () => {
    // 20 Oct 2026, 10:00 in Jerusalem (UTC+3). Day 15 is 3 Nov, after the change: 00:00 local = 2 Nov 22:00 UTC.
    expect(closureLockAt(new Date('2026-10-20T07:00:00.000Z'), 'Asia/Jerusalem').lockAt).toBe('2026-11-02T22:00:00.000Z');
    // Requested on the day of the change itself (25 Oct, 12:00 local, UTC+2 by then).
    expect(closureLockAt(new Date('2026-10-25T10:00:00.000Z'), 'Asia/Jerusalem').lockAt).toBe('2026-11-07T22:00:00.000Z');
  });

  it('NULL (not asked) → UTC, and the stored zone says so', () => {
    expect(closureLockAt(new Date('2026-11-04T10:00:00.000Z'), null)).toEqual({ lockAt: '2026-11-18T00:00:00.000Z', lockTimezone: 'UTC' });
  });

  it('an unusable zone name → UTC (never a throw)', () => {
    expect(closureLockAt(new Date('2026-11-04T10:00:00.000Z'), 'Mars/Olympus_Mons')).toEqual({ lockAt: '2026-11-18T00:00:00.000Z', lockTimezone: 'UTC' });
    expect(closureLockAt(new Date('2026-11-04T10:00:00.000Z'), '   ')).toEqual({ lockAt: '2026-11-18T00:00:00.000Z', lockTimezone: 'UTC' });
  });

  it('a stored UTC choice stays UTC', () => {
    expect(closureLockAt(new Date('2026-11-04T23:59:00.000Z'), 'UTC')).toEqual({ lockAt: '2026-11-18T00:00:00.000Z', lockTimezone: 'UTC' });
  });
});
