/**
 * A metric nobody can compute must store NOTHING, never a zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS.
 *
 * `computeSnapshotMetric` implemented exactly one key and ended
 * `return { value: 0, unit, sampleSize: 0 }`. Any other snapshot metric
 * therefore wrote a real `derived_metrics` row claiming the business's figure
 * was EXACTLY ZERO, and nothing downstream can tell that from a measurement:
 *
 *   - `BaselineCalculator` averages it into the mean and the std dev;
 *   - `percent_change` is then computed against that fabricated mean;
 *   - the measurement sweep (20261006g) reads two of them and reports
 *     "the metric did not move" for advice nobody could evaluate.
 *
 * Same family as the `₪0` impact line and the 275% refund rate: an absent
 * number rendered as a measurement. A computed zero is still written — no page
 * views yesterday really is zero page views — and only "no code exists to
 * answer this" is withheld.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { MetricsComputeService } from '../MetricsComputeService';
import { METRIC_DEFINITIONS } from '../types';
import { snapshotKeys } from '../snapshots';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/** Every row the service tried to upsert. */
let upserted: Array<Record<string, unknown>>;

function mockSupabase() {
  return {
    from() {
      const chain: Record<string, unknown> = {
        then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: [], error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'order', 'limit']) {
        chain[m] = () => chain;
      }
      chain.upsert = (row: Record<string, unknown>) => {
        upserted.push(row);
        return {
          select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
        };
      };
      chain.single = () => Promise.resolve({ data: null, error: null });
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return chain;
    },
  };
}

const USER = '08456106-aa50-4810-b12c-7ca84102da31';
const START = new Date('2026-10-01T00:00:00Z');
const END = new Date('2026-10-01T23:59:59Z');

beforeEach(() => {
  upserted = [];
});

describe('a snapshot metric with no reader', () => {
  /*
   * THE BUG IS LATENT TODAY, AND THAT IS WHY THIS TEST EXISTS.
   *
   * `cashflow.ar_overdue_usd` is currently the ONLY definition declaring
   * `aggregation: 'snapshot'`, and it has a reader — so nothing in the live
   * catalogue trips the fallback right now. It would fire the moment anybody
   * adds the second snapshot definition, which is precisely the change
   * somebody will make while wiring a detector's missing series, and the only
   * symptom would have been a column of plausible zeroes.
   *
   * So the guarantee is pinned at the method, not through the catalogue.
   */
  it('returns null rather than a zero', async () => {
    const service = new MetricsComputeService(mockSupabase() as never);

    const compute = (
      service as unknown as {
        computeSnapshotMetric: (
          u: string,
          k: string,
          c: string,
          unit: string
        ) => Promise<unknown>;
      }
    ).computeSnapshotMetric.bind(service);

    await expect(
      compute(USER, 'retention.clients_at_risk', 'retention', 'count')
    ).resolves.toBeNull();
  });

  it('every snapshot DEFINITION has a reader', () => {
    /*
     * The pairing this guard exists for, and it has already caught itself
     * once: when `cashflow.ar_total` and `acquisition.broken_link_destinations`
     * were added on 2026-10-07 this test failed, which is exactly what should
     * happen — a definition without a reader writes nothing and only warns.
     *
     * `cashflow.ar_overdue_usd` keeps its reader inline in
     * `MetricsComputeService`; the rest live in `snapshots.ts`.
     */
    const defined = METRIC_DEFINITIONS.filter(m => m.aggregation === 'snapshot').map(m => m.key);
    const readable = new Set([...snapshotKeys(), 'cashflow.ar_overdue_usd']);

    const orphans = defined.filter(k => !readable.has(k));
    expect(orphans).toEqual([]);
  });
});

describe('a metric that genuinely measures zero', () => {
  it('still writes the row', async () => {
    /*
     * The other half of the rule, and the reason the fix is not "skip zeroes".
     * No page views yesterday IS zero page views, and the series needs it or
     * every quiet day becomes a gap.
     */
    const service = new MetricsComputeService(mockSupabase() as never);
    const result = await service.computeAndStoreMetric(
      USER,
      'acquisition.page_views',
      'daily',
      START,
      END
    );

    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ metric_key: 'acquisition.page_views', value: 0 });
    expect(result.data).not.toBeNull();
  });
});

describe('the refund rate has a series at last', () => {
  it('is declared, so the detector that showed a 275% rate has history to compare against', () => {
    /*
     * `cash_refund_pattern` had no series: nothing recorded what the rate
     * actually was over time, which is part of how a configured threshold got
     * pressed into service as a baseline and printed as 275%.
     */
    const definition = METRIC_DEFINITIONS.find(m => m.key === 'cashflow.refund_rate');

    expect(definition).toBeDefined();
    expect(definition!.aggregation).toBe('rate');
    expect(definition!.unit).toBe('percentage');
    // Counts of events, so no money from two currencies is ever added.
    expect(definition!.eventTypes).toEqual(['refund.completed', 'payment.completed']);
  });
});
