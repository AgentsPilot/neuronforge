/**
 * The two PluginConnectionRepository methods the Stripe Connect exit uses
 * (self-service exit SX-5 / D5; SA W-5, W-10). Injected recording client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => ({}) }),
}));

import { PluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: Record<string, unknown>) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'delete', 'eq', 'neq', 'or']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    return Promise.resolve(answer).then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('deleteByUserAndPlugin', () => {
  it('deletes by user AND plugin key, counted, and returns the count', async () => {
    const { client, calls } = recordingClient({ error: null, count: 1 });
    const result = await new PluginConnectionRepository(client).deleteByUserAndPlugin('user-1', 'stripe');
    expect(calls).toEqual([
      ['from', 'plugin_connections'],
      ['delete', { count: 'exact' }],
      ['eq', 'user_id', 'user-1'],
      ['eq', 'plugin_key', 'stripe'],
      ['await'],
    ]);
    expect(result).toEqual({ data: 1, error: null });
  });

  it('returns the error, never a count', async () => {
    const error = { code: '42501', message: 'denied' };
    const { client } = recordingClient({ error, count: null });
    expect(await new PluginConnectionRepository(client).deleteByUserAndPlugin('user-1', 'stripe')).toEqual({ data: null, error });
  });
});

describe('countOtherUsersNamingStripeAccount (W-10, cross-user by design)', () => {
  it('a head count of OTHER users’ stripe rows naming the account, under either profile key', async () => {
    const { client, calls } = recordingClient({ error: null, count: 2 });
    const result = await new PluginConnectionRepository(client).countOtherUsersNamingStripeAccount('acct_1Abc', 'user-1');
    expect(calls).toEqual([
      ['from', 'plugin_connections'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'plugin_key', 'stripe'],
      ['neq', 'user_id', 'user-1'],
      ['or', 'profile_data->>stripe_account_id.eq.acct_1Abc,profile_data->>id.eq.acct_1Abc'],
      ['await'],
    ]);
    expect(result).toEqual({ data: 2, error: null });
  });

  it('refuses an id that is not Stripe-shaped before any query (no filter injection)', async () => {
    const { client, calls } = recordingClient({ error: null, count: 0 });
    const result = await new PluginConnectionRepository(client).countOtherUsersNamingStripeAccount('acct_1,user_id.neq.x', 'user-1');
    expect(calls).toEqual([]);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});
