/**
 * `correlate()` runs, and reports who the findings are about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Written because the suite had no test that called `correlate()` with actual
 * results. Wiring the subject grouping in put a reference to `sharedSubjects`
 * in the log line ABOVE its own declaration -- a temporal-dead-zone throw on
 * every correlated run -- and 520 tests stayed green.
 *
 * So the first assertion here is simply that the method survives being called.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { InsightCorrelationEngine } from '../InsightCorrelationEngine';
import type { DetectionResult } from '../../detectors/types';

const DAVID = 'c-david';

const result = (detectorId: string, ids: string[], impact?: number): DetectionResult =>
  ({
    detectorId,
    category: 'cash_flow',
    severity: 'medium',
    affectedEntityType: 'contact',
    affectedEntityIds: ids,
    estimatedImpactUsd: impact,
    affectedCount: ids.length,
  }) as unknown as DetectionResult;

const engine = new InsightCorrelationEngine();

describe('correlate()', () => {
  it('runs at all', () => {
    // The regression. This threw before the declaration was moved.
    expect(() => engine.correlate([result('cash_ar_overdue', [DAVID])])).not.toThrow();
  });

  it('names a client that several findings concern', () => {
    const summary = engine.correlate([
      result('cash_ar_overdue', [DAVID, 'c-sarah'], 300),
      result('ret_cancel_pattern', [DAVID], 150),
    ]);

    expect(summary.sharedSubjects).toHaveLength(1);
    expect(summary.sharedSubjects[0].entityId).toBe(DAVID);
    expect(summary.sharedSubjects[0].findings).toHaveLength(2);
  });

  it('adds to the output without removing anything from it', () => {
    /*
     * Grouping is a second READING of the same findings, not a filter. A
     * caller that ignores `sharedSubjects` must see exactly what it saw
     * before, or this change could make an insight vanish.
     */
    const results = [result('a', [DAVID]), result('b', [DAVID])];

    const summary = engine.correlate(results);

    expect(summary.standaloneInsights).toHaveLength(2);
  });

  it('returns an empty grouping rather than undefined when nothing is shared', () => {
    const summary = engine.correlate([result('a', ['c-1']), result('b', ['c-2'])]);

    expect(summary.sharedSubjects).toEqual([]);
  });

  it('handles the empty case', () => {
    expect(engine.correlate([]).sharedSubjects).toEqual([]);
  });
});
