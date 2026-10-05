/**
 * BusinessOsCreditOwnerReadRepository — the optional abort signal on the two
 * totals reads (credit deduction slice 8b, SA SQ-44). A time-boxed caller (the
 * low-line check) cancels its request; every existing caller passes nothing
 * and gets the query it always got.
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessOsCreditOwnerReadRepository } from '../BusinessOsCreditOwnerReadRepository';

type Call = { method: string; args: unknown[] };

function recordingClient(respond: () => { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'order', 'range', 'abortSignal']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.maybeSingle = () => {
        calls.push({ method: 'maybeSingle', args: [] });
        return Promise.resolve(respond());
      };
      builder.then = (resolve: (v: unknown) => void) => resolve(respond());
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const A = '11111111-1111-4111-8111-111111111111';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const signalsOf = (calls: Call[]) => calls.filter((c) => c.method === 'abortSignal').map((c) => c.args[0]);

describe('findTotalsForPeriod', () => {
  it('passes the signal to the query, before maybeSingle', async () => {
    const { client, calls } = recordingClient(() => ({ data: { credits_total: '1' }, error: null }));
    const signal = new AbortController().signal;
    const result = await new BusinessOsCreditOwnerReadRepository(client).findTotalsForPeriod(A, PERIOD, { signal });
    expect(result.error).toBeNull();
    expect(signalsOf(calls)).toEqual([signal]);
    const methods = calls.map((c) => c.method);
    expect(methods.indexOf('abortSignal')).toBeLessThan(methods.indexOf('maybeSingle'));
    // Still scoped to the one account (CLAUDE.md rule 4).
    expect(calls).toContainEqual({ method: 'eq', args: ['user_id', A] });
  });

  it('without a signal, sets none (existing callers unchanged)', async () => {
    const { client, calls } = recordingClient(() => ({ data: null, error: null }));
    await new BusinessOsCreditOwnerReadRepository(client).findTotalsForPeriod(A, PERIOD);
    expect(signalsOf(calls)).toEqual([]);
  });
});

describe('listTotalsFrom', () => {
  it('passes the signal to the query', async () => {
    const { client, calls } = recordingClient(() => ({ data: [], error: null }));
    const signal = new AbortController().signal;
    const result = await new BusinessOsCreditOwnerReadRepository(client).listTotalsFrom(A, PERIOD, { signal });
    expect(result.data).toEqual({ rows: [], reachedCeiling: false });
    expect(signalsOf(calls)).toEqual([signal]);
    expect(calls).toContainEqual({ method: 'eq', args: ['user_id', A] });
  });

  it('without a signal, sets none', async () => {
    const { client, calls } = recordingClient(() => ({ data: [], error: null }));
    await new BusinessOsCreditOwnerReadRepository(client).listTotalsFrom(A, PERIOD);
    expect(signalsOf(calls)).toEqual([]);
  });

  it('an aborted request comes back as an error result, never a throw', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError', code: '' });
    const { client } = recordingClient(() => ({ data: null, error: abortError }));
    const result = await new BusinessOsCreditOwnerReadRepository(client).listTotalsFrom(A, PERIOD, {
      signal: AbortSignal.abort(),
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});
