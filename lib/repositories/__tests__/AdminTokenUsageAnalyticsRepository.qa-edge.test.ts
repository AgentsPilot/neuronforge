/**
 * QA edge probes for the Health spend read (admin reorganisation slice 4, SA
 * C-4): the deadline firing while page 1 is in flight, exactly-full pages, and
 * a total exactly at the ceiling.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { AdminTokenUsageAnalyticsRepository } from '../AdminTokenUsageAnalyticsRepository';

const CTX = { correlationId: 'corr-qa', adminId: '11111111-1111-4111-8111-111111111111' };
const WINDOW = { start: '2026-09-12T10:30:00.000Z', end: '2026-09-26T10:30:00.000Z' };

function pagingClient(pageFor: (from: number, to: number) => { data: unknown; error: unknown }, onQuery?: () => void) {
  const ranges: Array<[number, number]> = [];
  const client = {
    from: () => {
      const calls: Array<{ method: string; args: unknown[] }> = [];
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'gte', 'lte', 'eq', 'is', 'not', 'or', 'order', 'range', 'abortSignal']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => {
        const range = calls.find((c) => c.method === 'range')!.args as [number, number];
        ranges.push(range);
        onQuery?.();
        resolve(pageFor(range[0], range[1]));
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, ranges };
}

const rows = (from: number, to: number, total: number) =>
  Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({
    id: `id-${from + i}`,
    created_at: '2026-09-20T00:00:00.000Z',
    cost_usd: 0.01,
  }));

describe('QA: deadline hit while page 1 is in flight', () => {
  it('page 1 returns full, the signal is aborted meanwhile → no page 2, { data: null, error }', async () => {
    const controller = new AbortController();
    const { client, ranges } = pagingClient((from, to) => ({ data: rows(from, to, 5000), error: null }), () =>
      controller.abort()
    );
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX,
      WINDOW,
      {},
      { pageSize: 1000, ceiling: 10000, signal: controller.signal }
    );
    expect(ranges).toEqual([[0, 999]]);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('an already-aborted signal issues no request at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, ranges } = pagingClient(() => ({ data: [], error: null }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 1000, ceiling: 10000, signal: controller.signal }
    );
    expect(ranges).toHaveLength(0);
    expect(result.data).toBeNull();
  });
});

describe('QA: page and ceiling boundaries', () => {
  it('exactly 2,000 rows (two full pages) → a third, empty page proves completion', async () => {
    const { client, ranges } = pagingClient((from, to) => ({ data: rows(from, to, 2000), error: null }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 1000, ceiling: 10000 }
    );
    expect(ranges).toHaveLength(3);
    expect(result.data).toMatchObject({ completed: true, reachedCeiling: false });
    expect(result.data!.rows).toHaveLength(2000);
  });

  it('exactly 10,000 rows (= the ceiling) → reported as NOT completed (conservative lower bound)', async () => {
    const { client, ranges } = pagingClient((from, to) => ({ data: rows(from, to, 10000), error: null }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 1000, ceiling: 10000 }
    );
    expect(ranges).toHaveLength(10);
    expect(result.data).toMatchObject({ completed: false, reachedCeiling: true });
  });

  it('a page error on page 3 → { data: null, error }, no partial figures', async () => {
    const { client } = pagingClient((from, to) =>
      from >= 2000 ? { data: null, error: { message: 'boom' } } : { data: rows(from, to, 5000), error: null }
    );
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 1000, ceiling: 10000 }
    );
    expect(result.data).toBeNull();
  });
});
