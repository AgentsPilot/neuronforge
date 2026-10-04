/**
 * The Activity tab's window presets (FR-B3, AC-B3): UTC, ISO weeks, and the
 * edges a calendar gets wrong — a Sunday, a Monday, the 1st of a month,
 * 1 January and a leap February.
 */

import { ACTIVITY_PRESETS, resolvePreset } from '../activityPresets';

const at = (iso: string) => new Date(iso);

describe('resolvePreset', () => {
  it('covers the six presets, in order', () => {
    expect(ACTIVITY_PRESETS).toEqual(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month']);
  });

  it('on a Thursday mid-month', () => {
    const now = at('2026-10-15T13:00:00Z'); // Thursday
    expect(resolvePreset('today', now)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(resolvePreset('yesterday', now)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(resolvePreset('this_week', now)).toEqual({ from: '2026-10-12', to: '2026-10-15' });
    expect(resolvePreset('last_week', now)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(resolvePreset('this_month', now)).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(resolvePreset('last_month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('on a Sunday, the ISO week still started the Monday before', () => {
    const now = at('2026-10-18T23:59:59Z'); // Sunday
    expect(resolvePreset('this_week', now)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(resolvePreset('last_week', now)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('on a Monday, this week is one day', () => {
    const now = at('2026-10-19T00:00:00Z'); // Monday
    expect(resolvePreset('this_week', now)).toEqual({ from: '2026-10-19', to: '2026-10-19' });
    expect(resolvePreset('last_week', now)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('on the 1st of a month, this month is one day and yesterday is last month', () => {
    const now = at('2026-11-01T08:00:00Z');
    expect(resolvePreset('this_month', now)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(resolvePreset('yesterday', now)).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(resolvePreset('last_month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('on 1 January, last month is the previous December and last week crosses the year', () => {
    const now = at('2027-01-01T12:00:00Z'); // Friday
    expect(resolvePreset('last_month', now)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(resolvePreset('yesterday', now)).toEqual({ from: '2026-12-31', to: '2026-12-31' });
    expect(resolvePreset('this_week', now)).toEqual({ from: '2026-12-28', to: '2027-01-01' });
    expect(resolvePreset('last_week', now)).toEqual({ from: '2026-12-21', to: '2026-12-27' });
  });

  it('in March of a leap year, last month ends on 29 February', () => {
    expect(resolvePreset('last_month', at('2028-03-10T00:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolvePreset('last_month', at('2027-03-10T00:00:00Z'))).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('uses the UTC date, not the local one, at a day boundary', () => {
    // 23:30 UTC on the 15th is the 16th east of UTC; the preset follows UTC.
    expect(resolvePreset('today', at('2026-10-15T23:30:00Z'))).toEqual({ from: '2026-10-15', to: '2026-10-15' });
  });

  it('no preset is longer than the route accepts (92 days)', () => {
    for (const p of ACTIVITY_PRESETS) {
      const { from, to } = resolvePreset(p, at('2026-03-31T12:00:00Z'));
      expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBeLessThanOrEqual(92);
    }
  });
});
