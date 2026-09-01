/**
 * Chat usage arithmetic.
 *
 * The summariser is pure so this can test the part worth being sure about: the
 * denominators. Every headline figure here is a ratio, and each one has a way of
 * being quietly wrong —
 *
 *   - counting CALLS as turns understates cost per question and hides repairs;
 *   - counting cache-hit rows as calls inflates "calls made";
 *   - letting a repaired turn vote twice on the cache layer skews the hit rate;
 *   - dividing by turns when most rows predate the turn id flatters everything.
 *
 * A wrong number here is worse than no number: it would be used to justify a
 * decision about where to spend effort.
 */

import { summarise, type UsageRow } from '../telemetry/usageReport';

const FROM = '2026-08-27T00:00:00Z';
const TO = '2026-08-27T23:59:59Z';

const row = (over: Partial<UsageRow>): UsageRow => ({
  session_id: null,
  activity_type: 'plan',
  activity_name: null,
  model_name: 'gpt-4o-mini',
  input_tokens: 1000,
  output_tokens: 100,
  cost_usd: 0.001,
  latency_ms: 2000,
  success: true,
  created_at: FROM,
  ...over,
});

describe('chat usage summary', () => {
  it('counts questions, not API calls', () => {
    // One question that needed a repair is ONE turn and TWO calls. Reporting it
    // as two questions halves the apparent cost of asking something.
    const report = summarise(
      [
        row({ session_id: 't1', activity_type: 'plan' }),
        row({ session_id: 't1', activity_type: 'repair' }),
        row({ session_id: 't2', activity_type: 'plan' }),
      ],
      FROM,
      TO
    );

    expect(report.turns).toBe(2);
    expect(report.calls).toBe(3);
    expect(report.costPerTurnUsd).toBeCloseTo(0.0015, 6);
  });

  it('counts a cache hit as a turn served but not a call made', () => {
    // The whole reason the zero-cost row exists: without it these three turns
    // look like one, and the hit rate is unmeasurable.
    const report = summarise(
      [
        row({ session_id: 't1', activity_type: 'plan' }),
        row({ session_id: 't2', activity_type: 'cache_hit', activity_name: 'exact', cost_usd: 0, input_tokens: 0, output_tokens: 0 }),
        row({ session_id: 't3', activity_type: 'cache_hit', activity_name: 'exact', cost_usd: 0, input_tokens: 0, output_tokens: 0 }),
      ],
      FROM,
      TO
    );

    expect(report.turns).toBe(3);
    expect(report.calls).toBe(1);
    expect(report.cache).toEqual({ exact: 2, semantic: 0, miss: 1, hitRate: 0.6667 });
    // Three questions answered for the price of one.
    expect(report.costPerTurnUsd).toBeCloseTo(0.000333, 6);
  });

  it('distinguishes the two cache layers', () => {
    const report = summarise(
      [
        row({ session_id: 't1', activity_type: 'cache_hit', activity_name: 'exact', cost_usd: 0 }),
        row({ session_id: 't2', activity_type: 'cache_hit', activity_name: 'semantic', cost_usd: 0 }),
      ],
      FROM,
      TO
    );

    expect(report.cache.exact).toBe(1);
    expect(report.cache.semantic).toBe(1);
    expect(report.cache.hitRate).toBe(1);
  });

  it('does not let a repaired turn vote twice on the cache layer', () => {
    // Two rows, one turn. Counting rows would report two misses out of one turn.
    const report = summarise(
      [
        row({ session_id: 't1', activity_type: 'plan' }),
        row({ session_id: 't1', activity_type: 'repair' }),
      ],
      FROM,
      TO
    );

    expect(report.cache.miss).toBe(1);
    expect(report.repairs).toBe(1);
    expect(report.repairRate).toBe(1);
  });

  it('reports how much of the window is attributable, so old data cannot mislead', () => {
    // Rows written before the turn id existed. Reporting a confident cost per
    // turn over these would divide real spend by a fraction of the real turns.
    const report = summarise(
      [
        row({ session_id: null }),
        row({ session_id: null }),
        row({ session_id: null }),
        row({ session_id: 't1' }),
      ],
      FROM,
      TO
    );

    expect(report.turnsCovered).toBe(0.25);
    expect(report.turns).toBe(1);
  });

  it('returns null rather than a fake zero when nothing can be attributed', () => {
    const report = summarise([row({ session_id: null })], FROM, TO);

    expect(report.turns).toBe(0);
    expect(report.costPerTurnUsd).toBeNull();
    expect(report.repairRate).toBeNull();
    expect(report.cache.hitRate).toBeNull();
  });

  it('surfaces the prompt/completion split, since prompt is where the cost is', () => {
    const report = summarise(
      [row({ session_id: 't1', input_tokens: 2500, output_tokens: 130 })],
      FROM,
      TO
    );

    expect(report.promptShare).toBeCloseTo(0.9506, 4);
  });

  it('handles an empty window without dividing by zero', () => {
    const report = summarise([], FROM, TO);

    expect(report).toMatchObject({
      turns: 0,
      calls: 0,
      totalCostUsd: 0,
      costPerTurnUsd: null,
      medianLatencyMs: null,
      turnsCovered: 1,
    });
  });

  it('counts failures separately from turns', () => {
    const report = summarise(
      [
        row({ session_id: 't1', success: false }),
        row({ session_id: 't2', success: true }),
      ],
      FROM,
      TO
    );

    expect(report.failures).toBe(1);
    expect(report.turns).toBe(2);
  });
});

describe('mixed windows, where the history has no turn id', () => {
  it('never divides the whole spend by the attributed turns', () => {
    // The bug the report itself caught in its first live run: today's total
    // included 997 untracked eval calls while only 10 rows carried a turn id,
    // so cost-per-turn read $0.060 against a true $0.0006 — a hundredfold wrong,
    // in the direction that would have sent someone optimising the wrong thing.
    const report = summarise(
      [
        // Legacy: real spend, no turn id.
        row({ session_id: null, cost_usd: 1.0 }),
        row({ session_id: null, cost_usd: 1.0 }),
        // Instrumented: one turn, one cent.
        row({ session_id: 't1', cost_usd: 0.01 }),
      ],
      FROM,
      TO
    );

    expect(report.totalCostUsd).toBeCloseTo(2.01, 6);
    expect(report.attributedCostUsd).toBeCloseTo(0.01, 6);
    // The headline reflects the turn it can actually see.
    expect(report.costPerTurnUsd).toBeCloseTo(0.01, 6);
    expect(report.turnsCovered).toBeCloseTo(0.3333, 4);
  });

  it('excludes unattributed calls from the call count and token split', () => {
    const report = summarise(
      [
        row({ session_id: null, input_tokens: 999_999, output_tokens: 0 }),
        row({ session_id: 't1', input_tokens: 900, output_tokens: 100 }),
      ],
      FROM,
      TO
    );

    expect(report.calls).toBe(1);
    expect(report.promptTokens).toBe(900);
    expect(report.promptShare).toBeCloseTo(0.9, 4);
  });
});
