/**
 * QA edge probes for the Health evaluator and windows (admin reorganisation
 * slice 4): invalid rule sets that must not throw, a missing tile in the rule
 * set, the OI-P1 note boundary, and the lower-bound invariant with a red
 * absolute rule.
 */

import { evaluateHealth, type HealthInputs } from '../evaluateHealth';
import { HEALTH_RULES } from '../rules';
import { computeHealthWindows, summariseSpend } from '../windows';

const W = computeHealthWindows(new Date('2026-09-26T10:30:00Z'));
const m = (value: number, exact = true) => ({ value, exact });

function inputs(over: Partial<HealthInputs> = {}): HealthInputs {
  return {
    windows: W,
    settings: { ok: true, value: { areasOff: 0, callsOff: 0, ignored: 0, adjusted: 0, offAreas: [], ignoredAreas: [] } },
    failures: { ok: true, value: { failed24h: 0, failed7d: 0, completed24h: 0 } },
    spend: {
      ok: true,
      value: {
        sums: {
          spend24h: m(0), spendPrev24h: m(0), spend7d: m(0), spendPrev7d: m(0), calls24h: m(0), calls7d: m(0),
        },
        callsKnown: true,
      },
    },
    critical: { ok: true, value: { last24h: 0, last7d: 0 } },
    entitlements: { ok: true, value: { effective: 'off', refused: false } },
    ...over,
  };
}

const byId = (tiles: ReturnType<typeof evaluateHealth>, id: string) => tiles.find((t) => t.id === id)!;

describe('QA: invalid rule sets never throw and isolate to their tile', () => {
  const bad: Array<[string, unknown]> = [
    ['missing (undefined)', undefined],
    ['null', null],
    ['a rule with a null condition', [{ id: 'x', priority: 1, colour: 'amber', description: 'd', condition: null }]],
    ['a NaN priority', [{ id: 'x', priority: NaN, colour: 'amber', description: 'd', condition: { kind: 'atLeast', metric: 'spend24h', value: 1 } }]],
    ['a green colour', [{ id: 'x', priority: 1, colour: 'green', description: 'd', condition: { kind: 'atLeast', metric: 'spend24h', value: 1 } }]],
    ['another tile\'s metric', [{ id: 'x', priority: 1, colour: 'red', description: 'd', condition: { kind: 'atLeast', metric: 'failed24h', value: 1 } }]],
    ['a description saying OK', [{ id: 'x', priority: 1, colour: 'amber', description: 'All OK', condition: { kind: 'atLeast', metric: 'spend24h', value: 1 } }]],
    ['an unknown kind', [{ id: 'x', priority: 1, colour: 'amber', description: 'd', condition: { kind: 'atMost', metric: 'spend24h', value: 1 } }]],
  ];

  it.each(bad)('spend rules %s → spend unavailable, the other tiles unaffected, error reported', (_label, spendRules) => {
    const onRuleError = jest.fn();
    const rules = { ...HEALTH_RULES, bos_ai_spend: spendRules } as unknown as typeof HEALTH_RULES;
    let tiles: ReturnType<typeof evaluateHealth> = [];
    expect(() => {
      tiles = evaluateHealth(inputs(), { rules, onRuleError });
    }).not.toThrow();
    expect(byId(tiles, 'bos_ai_spend').status).toBe('unavailable');
    expect(byId(tiles, 'bos_ai_failures').status).toBe('neutral');
    expect(byId(tiles, 'bos_ai_settings').status).toBe('neutral');
    expect(onRuleError).toHaveBeenCalledTimes(1);
    expect(onRuleError.mock.calls[0][0].tile).toBe('bos_ai_spend');
  });

  it('a lower-bound spend input with an invalid rule list is unavailable, never Normal', () => {
    const t = byId(
      evaluateHealth(
        inputs({
          spend: {
            ok: true,
            value: {
              sums: { spend24h: m(1, false), spendPrev24h: m(0, false), spend7d: m(1, false), spendPrev7d: m(0, false), calls24h: m(10000, false), calls7d: m(10000, false) },
              callsKnown: true,
            },
          },
        }),
        { rules: { ...HEALTH_RULES, bos_ai_spend: null } as unknown as typeof HEALTH_RULES }
      ),
      'bos_ai_spend'
    );
    expect(t.status).toBe('unavailable');
  });
});

describe('QA: C-18 with a red absolute rule', () => {
  it('"at least $25" matches the $20 red rule first (red beats the lower-bound amber)', () => {
    const t = byId(
      evaluateHealth(
        inputs({
          spend: {
            ok: true,
            value: {
              sums: { spend24h: m(25, false), spendPrev24h: m(0, false), spend7d: m(25, false), spendPrev7d: m(0, false), calls24h: m(10000, false), calls7d: m(10000, false) },
              callsKnown: true,
            },
          },
        })
      ),
      'bos_ai_spend'
    );
    expect(t.status).toBe('red');
    expect(t.matchedRuleId).toBe('spend.ceiling24h');
    expect(t.figures.every((f) => f.value.startsWith('at least'))).toBe(true);
  });
});

describe('QA: the OI-P1 note boundary', () => {
  const withCalls = (calls24h: number, calls7d: number) =>
    byId(
      evaluateHealth(
        inputs({
          spend: {
            ok: true,
            value: {
              sums: { spend24h: m(0), spendPrev24h: m(0), spend7d: m(0), spendPrev7d: m(0), calls24h: m(calls24h), calls7d: m(calls7d) },
              callsKnown: true,
            },
          },
        })
      ),
      'bos_ai_spend'
    ).figures;

  it('exactly 1,000 calls → no note; 1,001 → the note', () => {
    const [f24a, f7a] = withCalls(1000, 1000);
    expect(f24a.note).toBeNull();
    expect(f7a.note).toBeNull();
    const [f24b, f7b] = withCalls(1000, 1001);
    expect(f24b.note).toBeNull();
    expect(f7b.note).toMatch(/OI-P1/);
  });
});

describe('QA: summariseSpend edges', () => {
  it('rows with an unparseable timestamp or cost are skipped / counted as $0, never throw', () => {
    const s = summariseSpend(
      [
        { created_at: 'not-a-date', cost_usd: 5 },
        { created_at: new Date(W.end.getTime() - 1000).toISOString(), cost_usd: 'abc' },
        { created_at: new Date(W.end.getTime() - 1000).toISOString(), cost_usd: null },
      ],
      W,
      true
    );
    expect(s.spend24h).toEqual({ value: 0, exact: true });
    expect(s.calls24h).toEqual({ value: 2, exact: true });
  });

  it('a row newer than the end (clock skew) is ignored and does not affect exactness', () => {
    const s = summariseSpend([{ created_at: new Date(W.end.getTime() + 1).toISOString(), cost_usd: 9 }], W, true);
    expect(s.spend24h.value).toBe(0);
  });

  it('an incomplete read whose oldest row is exactly the 7-day start: 24 h exact, 7 d NOT exact (strict <)', () => {
    const s = summariseSpend(
      [
        { created_at: W.end.toISOString(), cost_usd: 1 },
        { created_at: W.last7dStart.toISOString(), cost_usd: 1 },
      ],
      W,
      false
    );
    expect(s.spend24h.exact).toBe(true);
    expect(s.spendPrev24h.exact).toBe(true);
    expect(s.spend7d.exact).toBe(false);
    expect(s.spendPrev7d.exact).toBe(false);
  });
});
