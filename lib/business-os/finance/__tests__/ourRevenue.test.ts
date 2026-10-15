/**
 * The per-currency combiner (finance & business health slice 5a, T3): AC-122
 * (USD 10.00 boost net + USD 79.00 plan = USD 89.00), E-34 and SA-W63 (when an
 * absent part is an exact 0), AC-125 / AC-126's K-5 halves, and the five K-5
 * kinds that moved here from boostRevenue.test.ts (SA-W59): one, several, none,
 * unknown failed, unknown cut off / unreadable. Nothing ever adds two currencies.
 */

import { combineOurRevenue, type PartByCurrency } from '../ourRevenue';

const part = (lines: Array<[string | null, number | null]> | null, cutOff = false): PartByCurrency => ({
  lines: lines === null ? null : lines.map(([currency, minor]) => ({ currency, minor })),
  cutOff,
});

describe('AC-122: boosts net plus plans received, per currency', () => {
  it('the owner account, October 2026: USD 1000 + USD 7900 → one, USD, 89', () => {
    const result = combineOurRevenue({ boosts: part([['USD', 1000]]), plans: part([['USD', 7900]]) });
    expect(result.k5).toEqual({ kind: 'one', currency: 'USD', net: 89 });
    expect(result.totals).toEqual([{ currency: 'USD', boostsNet: 10, plansReceived: 79, total: 89 }]);
  });

  it('two currencies → several, 2; each total in its own currency; nothing adds them', () => {
    const result = combineOurRevenue({ boosts: part([['USD', 1000]]), plans: part([['EUR', 2500], ['USD', 7900]]) });
    expect(result.k5).toEqual({ kind: 'several', currencies: 2 });
    expect(result.totals).toEqual([
      { currency: 'EUR', boostsNet: 0, plansReceived: 25, total: 25 },
      { currency: 'USD', boostsNet: 10, plansReceived: 79, total: 89 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/114/);
  });

  it.each([
    ['the boosts read failed', part(null), part([['USD', 7900]])],
    ['the plans read failed', part([['USD', 1000]]), part(null)],
    ['both failed', part(null), part(null)],
  ])('%s → totals null, K-5 unknown failed', (_n, boosts, plans) => {
    expect(combineOurRevenue({ boosts, plans })).toEqual({ totals: null, k5: { kind: 'unknown', reason: 'failed' } });
  });
});

describe('E-34 / SA-W63: when an absent part is an exact 0', () => {
  it('plans only, the boosts read exact → total = plans', () => {
    const result = combineOurRevenue({ boosts: part([]), plans: part([['USD', 7900]]) });
    expect(result.totals).toEqual([{ currency: 'USD', boostsNet: 0, plansReceived: 79, total: 79 }]);
    expect(result.k5).toEqual({ kind: 'one', currency: 'USD', net: 79 });
  });

  it('plans only, the boosts read CUT OFF → that currency is Unknown (cut_off)', () => {
    const result = combineOurRevenue({ boosts: part([], true), plans: part([['USD', 7900]]) });
    expect(result.totals).toEqual([{ currency: 'USD', boostsNet: null, plansReceived: 79, total: null }]);
    expect(result.k5).toEqual({ kind: 'unknown', reason: 'cut_off' });
  });

  it('boosts only, the plans read cut off → Unknown (cut_off)', () => {
    const result = combineOurRevenue({ boosts: part([['USD', 1000]]), plans: part([], true) });
    expect(result.k5).toEqual({ kind: 'unknown', reason: 'cut_off' });
  });

  it('an unreadable plan line (minor null) → Unknown (unreadable)', () => {
    const result = combineOurRevenue({ boosts: part([['USD', 1000]]), plans: part([['USD', null]]) });
    expect(result.totals).toEqual([{ currency: 'USD', boostsNet: 10, plansReceived: null, total: null }]);
    expect(result.k5).toEqual({ kind: 'unknown', reason: 'unreadable' });
  });

  it('a boost net null → Unknown (unreadable)', () => {
    expect(combineOurRevenue({ boosts: part([['USD', null]]), plans: part([]) }).k5).toEqual({ kind: 'unknown', reason: 'unreadable' });
  });

  it('the Unknown currency is never exact', () => {
    const result = combineOurRevenue({ boosts: part([]), plans: part([[null, 500]]) });
    expect(result.totals).toEqual([{ currency: null, boostsNet: null, plansReceived: null, total: null }]);
    expect(result.k5).toEqual({ kind: 'unknown', reason: 'unreadable' });
  });

  it('an overflowing sum → Unknown, never a wrong figure', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const result = combineOurRevenue({ boosts: part([['USD', big]]), plans: part([['USD', big]]) });
    expect(result.totals![0].total).toBeNull();
    expect(result.k5).toEqual({ kind: 'unknown', reason: 'unreadable' });
  });

  it('the Unknown currency sorts last', () => {
    const result = combineOurRevenue({ boosts: part([[null, 1], ['USD', 1]]), plans: part([['EUR', 1]]) });
    expect(result.totals!.map((t) => t.currency)).toEqual(['EUR', 'USD', null]);
  });
});

describe('the five K-5 kinds (moved from boostRevenue.test.ts, SA-W59)', () => {
  it('one currency, exact → one', () => {
    expect(combineOurRevenue({ boosts: part([['USD', 1000]]), plans: part([]) }).k5).toEqual({ kind: 'one', currency: 'USD', net: 10 });
  });

  it('a full refund nets to 0: one, USD, 0 (a real 0, not "no data")', () => {
    expect(combineOurRevenue({ boosts: part([['USD', 0]]), plans: part([]) }).k5).toEqual({ kind: 'one', currency: 'USD', net: 0 });
  });

  it('several', () => {
    expect(combineOurRevenue({ boosts: part([['EUR', 700], ['USD', 1000]]), plans: part([]) }).k5).toEqual({ kind: 'several', currencies: 2 });
  });

  it('AC-126: neither part has a line → none ("No data yet")', () => {
    expect(combineOurRevenue({ boosts: part([]), plans: part([]) })).toEqual({ totals: [], k5: { kind: 'none' } });
  });

  it('AC-125: one currency at the ceiling → unknown cut_off', () => {
    expect(combineOurRevenue({ boosts: part([['USD', null]], true), plans: part([]) }).k5).toEqual({ kind: 'unknown', reason: 'cut_off' });
  });
});
