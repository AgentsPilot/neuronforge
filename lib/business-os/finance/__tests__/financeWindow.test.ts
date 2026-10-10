/**
 * The finance page's window and K-1 span arithmetic (slice 1a, SA-Q12).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { isEmptySpan, k1Spans, resolveFinanceWindow } from '../financeWindow';

const iso = (d: Date) => d.toISOString();

describe('resolveFinanceWindow', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');

  it('a preset is resolved from the server clock, half-open over whole UTC days', () => {
    const w = resolveFinanceWindow({ preset: '7d', from: '2020-01-01', to: '2020-01-02' }, now);
    expect(w.from).toBe('2026-10-03');
    expect(w.to).toBe('2026-10-09');
    expect(iso(w.start)).toBe('2026-10-03T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-10-10T00:00:00.000Z');
  });

  it('this_month runs from the 1st to the end of today', () => {
    const w = resolveFinanceWindow({ preset: 'this_month' }, now);
    expect([w.from, w.to]).toEqual(['2026-10-01', '2026-10-09']);
  });

  it('a custom window uses the validated dates', () => {
    const w = resolveFinanceWindow({ preset: 'custom', from: '2026-09-01', to: '2026-09-30' }, now);
    expect(iso(w.start)).toBe('2026-09-01T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('a custom window without dates is a programming error', () => {
    expect(() => resolveFinanceWindow({ preset: 'custom' }, now)).toThrow();
  });
});

describe('k1Spans', () => {
  it('Oct 9 2026: previous span is Sep 1 to Sep 9 at the same time, and before the cut-over (true today)', () => {
    const s = k1Spans(new Date('2026-10-09T10:30:00.000Z'));
    expect(iso(s.current.from)).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(s.current.to)).toBe('2026-10-09T10:30:00.000Z');
    expect(iso(s.previous.from)).toBe('2026-09-01T00:00:00.000Z');
    expect(iso(s.previous.to)).toBe('2026-09-09T10:30:00.000Z');
    expect(s.previousBeforeCutover).toBe(true);
  });

  it('Nov 9 2026: the previous span starts after the cut-over', () => {
    expect(k1Spans(new Date('2026-11-09T10:30:00.000Z')).previousBeforeCutover).toBe(false);
  });

  it('Mar 31 10:00: the previous span is clamped to the whole of February, never into March', () => {
    const s = k1Spans(new Date('2027-03-31T10:00:00.000Z'));
    expect(iso(s.previous.from)).toBe('2027-02-01T00:00:00.000Z');
    expect(iso(s.previous.to)).toBe('2027-03-01T00:00:00.000Z');
  });

  it('leap year Mar 30: clamped to Feb 29 inclusive', () => {
    const s = k1Spans(new Date('2028-03-30T00:00:00.000Z'));
    expect(iso(s.previous.to)).toBe('2028-03-01T00:00:00.000Z');
    const s2 = k1Spans(new Date('2028-03-29T06:00:00.000Z'));
    expect(iso(s2.previous.to)).toBe('2028-02-29T06:00:00.000Z');
  });

  it('Jan 15: the previous span is in December of the previous year', () => {
    const s = k1Spans(new Date('2027-01-15T12:00:00.000Z'));
    expect(iso(s.previous.from)).toBe('2026-12-01T00:00:00.000Z');
    expect(iso(s.previous.to)).toBe('2026-12-15T12:00:00.000Z');
  });

  it('exactly at a month start: both spans are empty (nothing to read, exact 0)', () => {
    const s = k1Spans(new Date('2026-12-01T00:00:00.000Z'));
    expect(isEmptySpan(s.current)).toBe(true);
    expect(isEmptySpan(s.previous)).toBe(true);
    expect(iso(s.previous.from)).toBe(iso(s.previous.to));
  });
});
