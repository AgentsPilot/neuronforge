/**
 * Unit tests for BusinessOsEntitlementShadowRepository (entitlements component 1).
 *
 * The properties that matter here: recording goes through the atomic RPC (never
 * a read-modify-write, which would lose counts under concurrency), a failure is
 * returned rather than thrown (shadow recording must never affect the request it
 * is observing), and an unbounded payload is refused.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BusinessOsEntitlementShadowRepository,
  BOS_SHADOW_EVENT_BATCH_LIMIT,
} from '@/lib/repositories/BusinessOsEntitlementShadowRepository';

function mockSupabase(result: { data: unknown; error: unknown }) {
  const calls: {
    rpc?: [string, Record<string, unknown>];
    table?: string;
    select?: string;
    gte?: [string, unknown];
    lte?: [string, unknown];
    order?: [string, unknown];
    limit?: number;
  } = {};

  // `any` is unavoidable here (CLAUDE.md rule 6): this stub models PostgREST's
  // chainable builder — every method returns the builder, and the chain is also
  // a thenable. Typing it faithfully would mean reproducing supabase-js's
  // generic filter-builder types for no gain to these assertions.
  const builder: any = {
    select: jest.fn((cols: string) => { calls.select = cols; return builder; }),
    gte: jest.fn((c: string, v: unknown) => { calls.gte = [c, v]; return builder; }),
    lte: jest.fn((c: string, v: unknown) => { calls.lte = [c, v]; return builder; }),
    order: jest.fn((c: string, o: unknown) => { calls.order = [c, o]; return builder; }),
    limit: jest.fn((n: number) => { calls.limit = n; return builder; }),
    then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
  };

  const client = {
    from: jest.fn((t: string) => { calls.table = t; return builder; }),
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      calls.rpc = [fn, args];
      return Promise.resolve(result);
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const EVENT = {
  user_id: 'acct-1',
  capability: 'chat.search',
  surface: 'chat:find:invoices',
  outcome: 'allowed',
  rule: 'domain_group',
  hits: 2,
  items_total: 0,
  items_max: 0,
  sample_correlation_id: 'corr-1',
};

describe('recordEvents', () => {
  it('folds the batch in through the atomic RPC', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });

    const { data, error } = await new BusinessOsEntitlementShadowRepository(client).recordEvents([EVENT]);

    expect(error).toBeNull();
    expect(data).toBe(1);
    expect(calls.rpc).toEqual(['business_os_record_shadow_events', { p_rows: [EVENT] }]);
  });

  it('does nothing at all for an empty batch', async () => {
    const { client } = mockSupabase({ data: null, error: null });

    const { data } = await new BusinessOsEntitlementShadowRepository(client).recordEvents([]);

    expect(data).toBe(0);
    expect(client.rpc as jest.Mock).not.toHaveBeenCalled();
  });

  it('refuses an unbounded payload', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const many = Array.from({ length: BOS_SHADOW_EVENT_BATCH_LIMIT + 1 }, () => EVENT);

    const { data, error } = await new BusinessOsEntitlementShadowRepository(client).recordEvents(many);

    expect(data).toBeNull();
    expect(error?.message).toContain('at most 500');
    expect(client.rpc as jest.Mock).not.toHaveBeenCalled();
  });

  it('returns the failure instead of throwing into the caller', async () => {
    const { client } = mockSupabase({ data: null, error: { message: 'permission denied' } });

    const { data, error } = await new BusinessOsEntitlementShadowRepository(client).recordEvents([EVENT]);

    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});

describe('findWindow', () => {
  it('reads a bounded, ordered window', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });

    await new BusinessOsEntitlementShadowRepository(client).findWindow({
      from: '2026-09-01',
      to: '2026-09-21',
      limit: 10,
    });

    expect(calls.table).toBe('business_os_entitlement_shadow_events');
    expect(calls.gte).toEqual(['day', '2026-09-01']);
    expect(calls.lte).toEqual(['day', '2026-09-21']);
    expect(calls.order).toEqual(['day', { ascending: false }]);
    expect(calls.limit).toBe(10);
  });

  it('clamps an absurd limit', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });

    await new BusinessOsEntitlementShadowRepository(client).findWindow({
      from: '2026-09-01',
      to: '2026-09-21',
      limit: 10_000_000,
    });

    expect(calls.limit).toBe(20000);
  });
});
