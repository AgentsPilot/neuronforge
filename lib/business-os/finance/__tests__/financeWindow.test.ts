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

// ── DF-6 (§11L, E-75, SA-Q92): since it started, one business ────────────────
import { cutoverClamp, CHARGING_CUTOVER_FLOOR_MS } from '@/lib/business-os/credits/aiActivity';

describe('DF-6: resolveFinanceWindow since_start (AC-257, AC-258)', () => {
  const now = new Date('2026-10-17T12:34:56.789Z');

  it('AC-257: starts at the cut-over instant and ends at the injected now; from / to are the UTC dates', () => {
    const w = resolveFinanceWindow({ preset: 'since_start' }, now);
    expect(w.preset).toBe('since_start');
    expect(iso(w.start)).toBe('2026-09-29T16:50:53.914Z');
    expect(w.start.getTime()).toBe(CHARGING_CUTOVER_FLOOR_MS);
    expect(iso(w.end)).toBe('2026-10-17T12:34:56.789Z');
    expect([w.from, w.to]).toEqual(['2026-09-29', '2026-10-17']);
  });

  it('client from / to are ignored (SA-W6)', () => {
    const plain = resolveFinanceWindow({ preset: 'since_start' }, now);
    const withDates = resolveFinanceWindow({ preset: 'since_start', from: '2020-01-01', to: '2020-01-02' }, now);
    expect(withDates).toEqual(plain);
  });

  it('is not capped at 92 days (a clock in March 2027)', () => {
    const w = resolveFinanceWindow({ preset: 'since_start' }, new Date('2027-03-01T08:00:00.000Z'));
    expect([w.from, w.to]).toEqual(['2026-09-29', '2027-03-01']);
    expect(iso(w.end)).toBe('2027-03-01T08:00:00.000Z');
  });

  it('the end is a copy of now, not the same object', () => {
    const w = resolveFinanceWindow({ preset: 'since_start' }, now);
    expect(w.end).not.toBe(now);
  });

  it('AC-258: coverage is after_cutover and the read starts at the cut-over', () => {
    const w = resolveFinanceWindow({ preset: 'since_start' }, now);
    const clamp = cutoverClamp(w.start, w.end);
    expect(clamp.coverage).toBe('after_cutover');
    expect(clamp.readFrom?.getTime()).toBe(CHARGING_CUTOVER_FLOOR_MS);
  });

  it('deliberate: a clock before the cut-over (tests only) gives an empty span, read as entirely before it', () => {
    const w = resolveFinanceWindow({ preset: 'since_start' }, new Date('2026-09-01T00:00:00.000Z'));
    expect(w.end.getTime()).toBeLessThan(w.start.getTime());
    expect(cutoverClamp(w.start, w.end).coverage).toBe('entirely_before_cutover');
  });
});
