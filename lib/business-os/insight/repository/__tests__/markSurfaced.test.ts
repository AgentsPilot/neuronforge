/**
 * Counting how many times an insight has been shown.
 *
 * The number was 0 on every row in the database and `last_surfaced_at` was null
 * on every row, for two independent reasons:
 *
 *   nothing called it   the `view` action existed on the server and was absent
 *                       from the client hook's action union, so no code path
 *                       could reach it
 *
 *   it could not work   `surface_count` was assigned a query builder —
 *                       `this.supabase.rpc('increment_surface_count', …)` — and
 *                       that RPC does not exist in the database, so the update
 *                       failed on every call
 *
 * The visible symptom was the advisor card telling every owner "first time I've
 * seen this" about an insight that had been on their dashboard for a week.
 */

import { InsightRepository } from '../InsightRepository';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

interface Captured {
  updates: Record<string, unknown>[];
  rpcCalls: string[];
}

function mockSupabase(currentCount: number | null, captured: Captured) {
  const client = {
    rpc: (name: string) => {
      captured.rpcCalls.push(name);
      return { then: (r: (v: unknown) => unknown) => r({ data: null, error: null }) };
    },
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        update: (values: Record<string, unknown>) => {
          captured.updates.push(values);
          return chain;
        },
        single: async () => ({
          data: captured.updates.length > 0
            ? { id: 'i1', surface_count: captured.updates[0].surface_count }
            : { surface_count: currentCount },
          error: null,
        }),
      };
      return chain;
    },
  };
  return client;
}

function repo(currentCount: number | null) {
  const captured: Captured = { updates: [], rpcCalls: [] };
  const repository = new InsightRepository(mockSupabase(currentCount, captured) as never);
  return { repository, captured };
}

describe('markSurfaced', () => {
  it('writes one more than the count it read', async () => {
    const { repository, captured } = repo(4);

    await repository.markSurfaced('i1', 'user-1');

    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0].surface_count).toBe(5);
  });

  it('starts a never-shown insight at one', async () => {
    const { repository, captured } = repo(0);

    await repository.markSurfaced('i1', 'user-1');

    expect(captured.updates[0].surface_count).toBe(1);
  });

  it('treats a null count as never shown rather than writing NaN', async () => {
    const { repository, captured } = repo(null);

    await repository.markSurfaced('i1', 'user-1');

    expect(captured.updates[0].surface_count).toBe(1);
  });

  it('stamps when it was last shown', async () => {
    const { repository, captured } = repo(1);

    await repository.markSurfaced('i1', 'user-1');

    const stamped = captured.updates[0].last_surfaced_at as string;
    expect(Number.isNaN(Date.parse(stamped))).toBe(false);
  });

  it('never calls an RPC to do the increment', async () => {
    /*
     * The original bug, guarded directly. `increment_surface_count` is not a
     * function that exists; assigning its builder to a column is not an
     * increment in any case. The same shape was removed from
     * `SmartLinkRepository.markConversion` the day before.
     */
    const { repository, captured } = repo(2);

    await repository.markSurfaced('i1', 'user-1');

    expect(captured.rpcCalls).toEqual([]);
    expect(typeof captured.updates[0].surface_count).toBe('number');
  });
});
