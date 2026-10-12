/**
 * @jest-environment node
 *
 * Parity of the shared window's four whole-date extras (Admin Layout Standard
 * L-8a, D-2 (b)) with the Business OS AI Activity tab's own presets
 * (`activityPresets.resolvePreset`), which they replace on that tab.
 *
 * It lives here, beside `adminWindowPresets.test.ts`'s parity test, and not in
 * `layout/__tests__/`, so the shared folder's own tests never import a page
 * folder (SA S-1 on the L-8 workplan). The shared module copies the arithmetic
 * rather than importing it (S-3); this is what keeps the copy honest.
 */

import { resolveWindow } from '@/app/admin/components/layout/adminWindow';
import { resolvePreset } from '@/app/admin/business-os-llm/activityPresets';

const FOUR = ['yesterday', 'this_week', 'last_week', 'last_month'] as const;

const HOUR_MS = 60 * 60 * 1000;

/** 50 instants: the named edges first, then steps of 37 h 13 min across months and a year end. */
function instants(): Date[] {
  const named = [
    '2026-10-12T00:00:00.000Z', // a Monday, at midnight
    '2026-10-12T23:59:59.999Z', // a Monday, last millisecond
    '2026-10-18T12:00:00.000Z', // a Sunday
    '2026-10-18T23:59:59.999Z', // a Sunday, last millisecond
    '2027-01-01T00:00:00.000Z', // 1 January
    '2027-01-01T08:30:00.000Z',
    '2028-03-01T00:00:00.000Z', // 1 March of a leap year
    '2028-03-01T18:00:00.000Z',
    '2028-02-29T12:00:00.000Z', // 29 February
    '2026-03-01T06:00:00.000Z', // 1 March of a common year
  ].map((iso) => new Date(iso));
  const start = Date.UTC(2025, 11, 20, 3, 0, 0, 0);
  const stepped = Array.from({ length: 40 }, (_, i) => new Date(start + i * (37 * HOUR_MS + 13 * 60 * 1000)));
  return [...named, ...stepped];
}

describe('the four extras resolve exactly as the Activity tab presets did', () => {
  it('covers 50 instants, a Monday, a Sunday, 1 January and 1 March of a leap year among them', () => {
    const all = instants();
    expect(all).toHaveLength(50);
    expect(all.some((d) => d.getUTCDay() === 1)).toBe(true);
    expect(all.some((d) => d.getUTCDay() === 0)).toBe(true);
    expect(all.some((d) => d.getUTCMonth() === 0 && d.getUTCDate() === 1)).toBe(true);
    expect(all.some((d) => d.getUTCFullYear() === 2028 && d.getUTCMonth() === 2 && d.getUTCDate() === 1)).toBe(true);
  });

  it.each(FOUR)('%s', (extra) => {
    for (const now of instants()) {
      const expected = resolvePreset(extra, now);
      expect({ at: now.toISOString(), got: resolveWindow({ kind: 'extra', extra }, now) }).toEqual({
        at: now.toISOString(),
        got: { kind: 'dates', from: expected.from, to: expected.to },
      });
    }
  });
});
