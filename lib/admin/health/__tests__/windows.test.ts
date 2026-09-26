/**
 * The Health windows and the spend sums (admin reorganisation slice 4,
 * SA C-1 exactness per sub-window, C-3 interval algebra).
 */

import { computeHealthWindows, summariseSpend, toAuditDateParam, toUsd } from '../windows';

const NOW = new Date('2026-09-26T10:30:45.678Z');
const W = computeHealthWindows(NOW);
const at = (d: Date, deltaMs = 0) => new Date(d.getTime() + deltaMs).toISOString();

describe('computeHealthWindows (C-3)', () => {
  it('floors the end to the minute and derives every bound from it', () => {
    expect(W.end.toISOString()).toBe('2026-09-26T10:30:00.000Z');
    expect(W.last24hStart.toISOString()).toBe('2026-09-25T10:30:00.000Z');
    expect(W.previous24hStart.toISOString()).toBe('2026-09-24T10:30:00.000Z');
    expect(W.last7dStart.toISOString()).toBe('2026-09-19T10:30:00.000Z');
    expect(W.previous7dStart.toISOString()).toBe('2026-09-12T10:30:00.000Z');
  });

  it('the audit link format is offsetless UTC minutes', () => {
    expect(toAuditDateParam(W.last24hStart)).toBe('2026-09-25T10:30');
  });
});

describe('toUsd', () => {
  it('parses numeric strings and treats junk as 0', () => {
    expect(toUsd('0.0123')).toBeCloseTo(0.0123);
    expect(toUsd(2)).toBe(2);
    expect(toUsd(null)).toBe(0);
    expect(toUsd('abc')).toBe(0);
  });
});

describe('summariseSpend: which window a row lands in (C-3)', () => {
  it('current windows are inclusive at both ends; previous windows are half-open', () => {
    const rows = [
      { created_at: at(W.end), cost_usd: 1 }, // end: in 24 h and 7 d
      { created_at: at(W.last24hStart), cost_usd: 2 }, // 24 h start: in 24 h (inclusive), not in prev 24 h
      { created_at: at(W.last24hStart, -1), cost_usd: 4 }, // just before: prev 24 h, and 7 d
      { created_at: at(W.previous24hStart), cost_usd: 8 }, // prev 24 h start: in prev 24 h
      { created_at: at(W.last7dStart), cost_usd: 16 }, // 7 d start: in 7 d, not in prev 7 d
      { created_at: at(W.last7dStart, -1), cost_usd: 32 }, // prev 7 d
      { created_at: at(W.previous7dStart), cost_usd: 64 }, // prev 7 d start: in prev 7 d
    ];
    const s = summariseSpend(rows, W, true);
    expect(s.spend24h.value).toBe(3);
    expect(s.spendPrev24h.value).toBe(12);
    expect(s.spend7d.value).toBe(1 + 2 + 4 + 8 + 16);
    expect(s.spendPrev7d.value).toBe(32 + 64);
    expect(s.calls24h.value).toBe(2);
    expect(s.calls7d.value).toBe(5);
  });
});

describe('summariseSpend: exactness per sub-window (C-1)', () => {
  it('a completed read is exact everywhere', () => {
    const s = summariseSpend([], W, true);
    for (const m of [s.spend24h, s.spendPrev24h, s.spend7d, s.spendPrev7d]) expect(m.exact).toBe(true);
  });

  it('ceiling hit, but the read reached past 24 h: 24 h figures are exact, the 7-day ones are not', () => {
    const rows = [
      { created_at: at(W.end, -60_000), cost_usd: 1 },
      { created_at: at(W.last24hStart, -3_600_000 * 30), cost_usd: 1 }, // older than the previous-24h start
    ];
    const s = summariseSpend(rows, W, false);
    expect(s.spend24h.exact).toBe(true);
    expect(s.spendPrev24h.exact).toBe(true);
    expect(s.spend7d.exact).toBe(false);
    expect(s.spendPrev7d.exact).toBe(false);
  });

  it('ceiling hit inside the 24 h window: nothing is exact', () => {
    const rows = [{ created_at: at(W.end, -60_000), cost_usd: 1 }];
    const s = summariseSpend(rows, W, false);
    expect(s.spend24h.exact).toBe(false);
    expect(s.spendPrev24h.exact).toBe(false);
  });

  it('a boundary tie is NOT assumed complete (strict <)', () => {
    const rows = [{ created_at: at(W.last24hStart), cost_usd: 1 }];
    const s = summariseSpend(rows, W, false);
    expect(s.spend24h.exact).toBe(false);
  });

  it('the oldest row one millisecond past the start proves the window complete', () => {
    const rows = [{ created_at: at(W.last24hStart, -1), cost_usd: 1 }];
    const s = summariseSpend(rows, W, false);
    expect(s.spend24h.exact).toBe(true);
    expect(s.spendPrev24h.exact).toBe(false);
  });
});
