/**
 * Exchange rates slice 1d: the page's history-window helper (D-8, §5.6,
 * SQ-27, SQ-29, FR-32; SA §13.6 step 4). Pure, so no environment is needed.
 */

import type { AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import {
  HISTORY_DEFAULT_WINDOW,
  historyPeriodText,
  historyWindowDates,
  historyWindowParams,
} from '../historyWindow';

const MID = new Date('2026-10-20T15:30:00.000Z');
const FIRST = new Date('2026-10-01T00:00:00.000Z');
const LAST = new Date('2026-10-31T23:59:59.999Z');

const preset = (name: 'today' | '7d' | '30d' | 'this_month'): AdminWindowValue => ({ kind: 'preset', preset: name });

describe('HISTORY_DEFAULT_WINDOW', () => {
  it('is This month (D-8)', () => {
    expect(HISTORY_DEFAULT_WINDOW).toEqual({ kind: 'preset', preset: 'this_month' });
  });
});

describe('historyWindowDates: every preset in UTC (SQ-29)', () => {
  it.each([
    ['today', MID, { from: '2026-10-20', to: '2026-10-20' }],
    ['7d', MID, { from: '2026-10-14', to: '2026-10-20' }],
    ['30d', MID, { from: '2026-09-21', to: '2026-10-20' }],
    ['this_month', MID, { from: '2026-10-01', to: '2026-10-20' }],
    ['today', FIRST, { from: '2026-10-01', to: '2026-10-01' }],
    ['7d', FIRST, { from: '2026-09-25', to: '2026-10-01' }],
    ['30d', FIRST, { from: '2026-09-02', to: '2026-10-01' }],
    ['this_month', FIRST, { from: '2026-10-01', to: '2026-10-01' }],
    ['today', LAST, { from: '2026-10-31', to: '2026-10-31' }],
    ['7d', LAST, { from: '2026-10-25', to: '2026-10-31' }],
    ['30d', LAST, { from: '2026-10-02', to: '2026-10-31' }],
    ['this_month', LAST, { from: '2026-10-01', to: '2026-10-31' }],
  ] as const)('%s at %s', (name, now, expected) => {
    expect(historyWindowDates(preset(name), now)).toEqual(expected);
  });

  it('a custom range is sent as given', () => {
    expect(historyWindowDates({ kind: 'custom', from: '2026-09-01', to: '2026-09-15' }, MID)).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it.each([
    ['a custom range missing a date', { kind: 'custom', from: '2026-09-01', to: null }],
    ['a custom range with no dates', { kind: 'custom', from: null, to: null }],
    ['no window', { kind: 'none' }],
    ['a linked window', { kind: 'linked', from: '2026-09-01', to: '2026-09-15' }],
  ] as const)('%s falls back to This month', (_name, value) => {
    expect(historyWindowDates(value as AdminWindowValue, MID)).toEqual({ from: '2026-10-01', to: '2026-10-20' });
  });
});

describe('historyWindowParams', () => {
  it('holds exactly from and to', () => {
    const params = historyWindowParams(preset('7d'), MID);
    expect([...params.keys()]).toEqual(['from', 'to']);
    expect(params.toString()).toBe('from=2026-10-14&to=2026-10-20');
  });
});

describe('historyPeriodText (FR-32)', () => {
  it.each([
    [preset('today'), 'today'],
    [preset('7d'), 'in the last 7 days'],
    [preset('30d'), 'in the last 30 days'],
    [preset('this_month'), 'this month'],
    [{ kind: 'custom', from: '2026-10-01', to: '2026-10-15' }, 'from 2026-10-01 to 2026-10-15 (UTC)'],
    [{ kind: 'custom', from: '2026-10-01', to: null }, 'this month'],
    [{ kind: 'none' }, 'this month'],
  ] as const)('%j → %s', (value, text) => {
    expect(historyPeriodText(value as AdminWindowValue)).toBe(text);
  });
});
