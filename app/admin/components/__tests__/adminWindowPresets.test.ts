/**
 * @jest-environment node
 *
 * The shared admin window presets (finance & business health slice 1a,
 * SA-Q2, SA-W8): UTC edges, 7d / 30d include today, parity with the Activity
 * tab's `today` and `this_month`, the 92-day cap equal to the cost report's,
 * and that the module stays pure (imported here in a Node environment).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  ADMIN_WINDOW_CHOICES,
  ADMIN_WINDOW_MAX_DAYS,
  ADMIN_WINDOW_PRESETS,
  customRangeProblem,
  inclusiveDays,
  isRealDate,
  resolveAdminWindow,
  todayUtc,
} from '../adminWindowPresets';
import { resolvePreset } from '@/app/admin/business-os-llm/activityPresets';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

describe('resolveAdminWindow', () => {
  it.each([
    ['late in the day', '2026-10-09T23:59:59.999Z', { today: '2026-10-09', d7: '2026-10-03', d30: '2026-09-10', month: '2026-10-01' }],
    ['at midnight', '2026-10-09T00:00:00.000Z', { today: '2026-10-09', d7: '2026-10-03', d30: '2026-09-10', month: '2026-10-01' }],
    ['on a month start', '2026-02-01T08:00:00.000Z', { today: '2026-02-01', d7: '2026-01-26', d30: '2026-01-03', month: '2026-02-01' }],
    ['on a year start', '2027-01-01T00:00:00.000Z', { today: '2027-01-01', d7: '2026-12-26', d30: '2026-12-03', month: '2027-01-01' }],
    ['on Feb 29 in a leap year', '2028-02-29T12:00:00.000Z', { today: '2028-02-29', d7: '2028-02-23', d30: '2028-01-31', month: '2028-02-01' }],
  ])('%s', (_name, iso, expected) => {
    const now = new Date(iso);
    expect(resolveAdminWindow('today', now)).toEqual({ from: expected.today, to: expected.today });
    expect(resolveAdminWindow('7d', now)).toEqual({ from: expected.d7, to: expected.today });
    expect(resolveAdminWindow('30d', now)).toEqual({ from: expected.d30, to: expected.today });
    expect(resolveAdminWindow('this_month', now)).toEqual({ from: expected.month, to: expected.today });
  });

  it('7d and 30d include today: 7 and 30 inclusive days', () => {
    const now = new Date('2026-10-09T10:00:00.000Z');
    const d7 = resolveAdminWindow('7d', now);
    const d30 = resolveAdminWindow('30d', now);
    expect(inclusiveDays(d7.from, d7.to)).toBe(7);
    expect(inclusiveDays(d30.from, d30.to)).toBe(30);
  });

  it('parity: today and this_month resolve exactly as the Activity tab’s presets, over 50 instants', () => {
    const start = Date.UTC(2025, 11, 25, 0, 0, 0, 0);
    for (let i = 0; i < 50; i += 1) {
      // Steps of 37 h 13 min cross midnights, month ends and a year end.
      const now = new Date(start + i * (37 * 60 + 13) * 60 * 1000);
      expect(resolveAdminWindow('today', now)).toEqual(resolvePreset('today', now));
      expect(resolveAdminWindow('this_month', now)).toEqual(resolvePreset('this_month', now));
    }
  });

  it('lists the four presets, and custom only among the choices', () => {
    expect([...ADMIN_WINDOW_PRESETS]).toEqual(['today', '7d', '30d', 'this_month']);
    expect([...ADMIN_WINDOW_CHOICES]).toEqual(['today', '7d', '30d', 'this_month', 'custom']);
  });
});

describe('the 92-day cap', () => {
  it('equals the cost report’s MAX_WINDOW_DAYS (a literal here so the browser bundle stays clean)', () => {
    // Imported in the test only: the module itself must not import a server file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CREDIT_REPORT_LIMITS } = require('@/lib/business-os/credits/creditReport');
    expect(ADMIN_WINDOW_MAX_DAYS).toBe(CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS);
  });

  it('counts inclusive days', () => {
    expect(inclusiveDays('2026-01-01', '2026-04-02')).toBe(92);
    expect(inclusiveDays('2026-01-01', '2026-01-01')).toBe(1);
  });
});

describe('isRealDate and customRangeProblem', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');

  it('rejects malformed and impossible dates', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-2-3')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
  });

  it.each([
    ['a usable range', '2026-09-01', '2026-10-09', null],
    ['92 inclusive days', '2026-07-10', '2026-10-09', null],
    ['93 inclusive days', '2026-07-09', '2026-10-09', 'The window may be at most 92 days'],
    ['to before from', '2026-10-05', '2026-10-01', 'The start date must not be after the end date'],
    ['to tomorrow (no tolerance)', '2026-10-01', '2026-10-10', 'The end date must not be after today (UTC)'],
    ['a malformed date', '2026-10-1', '2026-10-09', 'Dates must be real dates, YYYY-MM-DD'],
  ])('%s', (_name, from, to, expected) => {
    expect(customRangeProblem(from, to, now)).toBe(expected);
  });

  it('todayUtc is the UTC date', () => {
    expect(todayUtc(new Date('2026-10-09T23:30:00.000-05:00'))).toBe('2026-10-10');
  });
});

describe('purity (SA-W8)', () => {
  it('has no use client directive, no React and no server-only or repository import', () => {
    const text = fs.readFileSync(path.join(process.cwd(), 'app/admin/components/adminWindowPresets.ts'), 'utf8');
    expect(text).not.toMatch(/^['"]use client['"]/m);
    expect(text).not.toMatch(/^\s*import\s/m);
  });
});
