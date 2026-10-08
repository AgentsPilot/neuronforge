/**
 * The sweep: what it measures, what it refuses, and what it must not confuse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three things here would be silent bugs if they went the other way:
 *
 *   - a metric with no series must store `unmeasurable`, not skip the row.
 *     Skipping means retrying forever; treating it as zero means "no data"
 *     becomes "no improvement" and the ranking learns to suppress detectors
 *     that fire on quiet accounts.
 *   - an insight both dismissed AND acted on is an ACTED one. Counting it as
 *     dismissed puts the same card in the control group and the treatment
 *     group at once.
 *   - both readings must come from ONE series. A daily "before" against a
 *     monthly "after" is the population error the module keeps hitting.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { measureDueInsights } from '../MeasurementService';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const USER = '08456106-aa50-4810-b12c-7ca84102da31';

interface Row {
  [k: string]: unknown;
}

/** Every insert the sweep attempted. */
let inserted: Row[];
/** Every (metric_key, period_type) pair the sweep read. */
let seriesRead: string[];

/**
 * A Supabase double that honours the filters the sweep depends on.
 *
 * `period_start` range filtering is real, because the whole point of the two
 * readings is that they cover different windows — a mock returning every row
 * for both would make the before and after identical and prove nothing.
 */
function mockSupabase(opts: {
  insights: Row[];
  metrics?: Row[];
  measured?: Row[];
  insertError?: { code: string };
}) {
  return {
    from(table: string) {
      if (table === 'insights') {
        return chainOf(opts.insights);
      }

      if (table === 'insight_measurements') {
        const chain = chainOf(opts.measured ?? []);
        (chain as Record<string, unknown>).insert = (row: Row) => {
          inserted.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        };
        return chain;
      }

      if (table === 'derived_metrics') {
        return metricsChain(opts.metrics ?? []);
      }

      return chainOf([]);
    },
  };
}

function chainOf(rows: Row[]) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  for (const m of ['select', 'eq', 'in', 'or', 'not', 'gte', 'lte', 'order', 'limit']) {
    chain[m] = () => chain;
  }
  return chain;
}

/** Honours metric_key, period_type and the period_start window. */
function metricsChain(rows: Row[]) {
  const f: Record<string, string> = {};
  let from: string | null = null;
  let to: string | null = null;
  let single = false;

  const chain: Record<string, unknown> = {
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
      let out = rows.filter(r =>
        Object.entries(f).every(([k, v]) => k === 'user_id' || r[k] === v)
      );
      if (from) out = out.filter(r => String(r.period_start) >= from!);
      if (to) out = out.filter(r => String(r.period_start) <= to!);
      if (f.metric_key && f.period_type) seriesRead.push(`${f.metric_key}:${f.period_type}`);
      if (single) {
        out = [...out].sort((a, b) =>
          String(b.period_start).localeCompare(String(a.period_start))
        );
        out = out.slice(0, 1);
      }
      return resolve({ data: out, error: null });
    },
  };
  chain.select = () => chain;
  chain.eq = (col: string, val: string) => {
    f[col] = val;
    return chain;
  };
  chain.gte = (_c: string, v: string) => {
    from = v;
    return chain;
  };
  chain.lte = (_c: string, v: string) => {
    to = v;
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => {
    single = true;
    return chain;
  };
  return chain;
}

/** Daily readings of `key` at `value`, spanning the window around `endDaysAgo`. */
function series(key: string, endDaysAgo: number, value: number, periodType = 'daily'): Row[] {
  return Array.from({ length: 5 }, (_, i) => ({
    metric_key: key,
    period_type: periodType,
    period_start: ago(endDaysAgo + i),
    value,
  }));
}

function insight(over: Partial<Row> = {}): Row {
  return {
    id: 'ins-1',
    user_id: USER,
    detector_id: 'ret_no_show_spike',
    metric_key: 'retention.no_show_rate',
    direction: 'above',
    acted_at: ago(40),
    dismissed_at: null,
    ...over,
  };
}

beforeEach(() => {
  inserted = [];
  seriesRead = [];
});

describe('measuring a card that was acted on', () => {
  it('records an improvement when the metric moved off the breached side', async () => {
    const db = mockSupabase({
      insights: [insight()],
      metrics: [
        // Around the action, 40 days ago: 20%.
        ...series('retention.no_show_rate', 40, 20),
        // Now: 10%.
        ...series('retention.no_show_rate', 0, 10),
      ],
    });

    const summary = await measureDueInsights(db as never, { horizons: [30] });

    expect(summary.horizons[0]).toMatchObject({ due: 1, written: 1, improved: 1 });
    expect(inserted[0]).toMatchObject({
      verdict: 'improved',
      outcome_of: 'acted',
      horizon_days: 30,
      direction: 'above',
      value_before: 20,
      value_after: 10,
      change_percent: -50,
    });
  });

  it('reads both ends from the SAME series', async () => {
    /*
     * A daily "before" against a monthly "after" compares two populations.
     * The period type is resolved once and reused, so every read is identical
     * in shape.
     */
    await measureDueInsights(
      mockSupabase({
        insights: [insight()],
        metrics: [
          ...series('retention.no_show_rate', 40, 20),
          ...series('retention.no_show_rate', 0, 10),
          // A second series under the same key, which must not be mixed in.
          ...series('retention.no_show_rate', 0, 999, 'monthly'),
        ],
      }) as never,
      { horizons: [30] }
    );

    const distinct = [...new Set(seriesRead)];
    expect(distinct).toEqual(['retention.no_show_rate:daily']);
  });
});

describe('what it refuses to guess', () => {
  it('stores unmeasurable rather than skipping a metric with no series', async () => {
    /*
     * Most detectors compute straight from module tables, so this is the
     * common answer at first. Storing it stops the job retrying forever and
     * keeps "no data" from later reading as "no improvement".
     */
    const summary = await measureDueInsights(
      mockSupabase({ insights: [insight()], metrics: [] }) as never,
      { horizons: [30] }
    );

    expect(summary.horizons[0]).toMatchObject({ written: 1, unmeasurable: 1 });
    expect(inserted[0]).toMatchObject({
      verdict: 'unmeasurable',
      value_before: null,
      value_after: null,
      change_percent: null,
    });
  });

  it('stores unmeasurable when only one end has readings', async () => {
    const summary = await measureDueInsights(
      mockSupabase({
        insights: [insight()],
        // Readings now, nothing around the action.
        metrics: series('retention.no_show_rate', 0, 10),
      }) as never,
      { horizons: [30] }
    );

    expect(summary.horizons[0].unmeasurable).toBe(1);
  });

  it('skips an insight with no breach direction instead of assuming one', async () => {
    // Guessing `above` would report every utilisation recovery as a decline.
    const summary = await measureDueInsights(
      mockSupabase({ insights: [insight({ direction: null })] }) as never,
      { horizons: [30] }
    );

    expect(summary.horizons[0].due).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe('acted beats dismissed', () => {
  it('treats a card dismissed and then acted on as ACTED', async () => {
    /*
     * Otherwise the same insight lands in the control group and the treatment
     * group at once, and the comparison the control group exists for is
     * meaningless.
     */
    await measureDueInsights(
      mockSupabase({
        insights: [insight({ dismissed_at: ago(50), acted_at: ago(40) })],
        metrics: [
          ...series('retention.no_show_rate', 40, 20),
          ...series('retention.no_show_rate', 0, 10),
        ],
      }) as never,
      { horizons: [30] }
    );

    expect(inserted[0]).toMatchObject({ outcome_of: 'acted', action_at: expect.any(String) });
  });

  it('measures a dismissed card too, as the control group', async () => {
    await measureDueInsights(
      mockSupabase({
        insights: [insight({ acted_at: null, dismissed_at: ago(40) })],
      }) as never,
      { horizons: [30] }
    );

    expect(inserted[0]).toMatchObject({ outcome_of: 'dismissed' });
  });
});

describe('the sweep is idempotent and survives itself', () => {
  it('does not re-measure an insight already measured at that horizon', async () => {
    const summary = await measureDueInsights(
      mockSupabase({
        insights: [insight()],
        measured: [{ insight_id: 'ins-1' }],
      }) as never,
      { horizons: [30] }
    );

    expect(summary.horizons[0]).toMatchObject({ due: 0 });
    expect(inserted).toHaveLength(0);
  });

  it('swallows a unique violation from a concurrent run', async () => {
    // The unique index is the idempotency guarantee; a race is not an error.
    const summary = await measureDueInsights(
      mockSupabase({ insights: [insight()], insertError: { code: '23505' } }) as never,
      { horizons: [30] }
    );

    expect(summary.horizons[0]).toMatchObject({ already: 1, written: 0 });
    expect(summary.failed).toBe(0);
  });

  it('counts a failure and carries on to the next horizon', async () => {
    const exploding = {
      from(table: string) {
        if (table === 'insights') return chainOf([insight()]);
        if (table === 'insight_measurements') {
          const chain = chainOf([]);
          (chain as Record<string, unknown>).insert = () =>
            Promise.resolve({ error: { code: '42P01', message: 'relation does not exist' } });
          return chain;
        }
        return chainOf([]);
      },
    };

    const summary = await measureDueInsights(exploding as never, { horizons: [30, 90] });

    expect(summary.failed).toBe(2);
    expect(summary.horizons).toHaveLength(2);
  });

  it('writes a separate row per horizon, never an overwrite', async () => {
    /*
     * Thirty days and ninety days are different questions: plenty of advice
     * produces a fortnight of effort and no lasting change.
     */
    await measureDueInsights(
      mockSupabase({
        insights: [insight({ acted_at: ago(100) })],
        metrics: [
          ...series('retention.no_show_rate', 100, 20),
          ...series('retention.no_show_rate', 0, 10),
        ],
      }) as never,
      { horizons: [30, 90] }
    );

    expect(inserted.map(r => r.horizon_days)).toEqual([30, 90]);
  });
});
