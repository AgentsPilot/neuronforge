/**
 * `findByUserAndPlugins`: this owner's connections, narrowed to a named set.
 *
 * The read it replaced ran inline in `inboxChannel.ts`, and the narrowing is
 * deliberate rather than an optimisation: a surface that filters afterwards can
 * offer the owner a provider the agent behind it cannot actually run, which
 * files the enquiry nowhere and looks like success.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown]>;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], ins: [] };
  const resolved = { data: result.data ?? null, error: result.error ?? null };

  const builder: any = {
    select: jest.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return builder;
    }),
    in: jest.fn((col: string, val: unknown) => {
      calls.ins.push([col, val]);
      return builder;
    }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(res, rej),
  };

  const client = {
    from: jest.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('PluginConnectionRepository.findByUserAndPlugins', () => {
  it('scopes to the owner and narrows to the named plugins in the query', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PluginConnectionRepository(client).findByUserAndPlugins('u1', [
      'google-mail',
      'outlook',
    ]);

    expect(calls.table).toBe('plugin_connections');
    // Rule 4. Dropping it offers this owner another business's mailbox.
    expect(calls.eqs).toContainEqual(['user_id', 'u1']);
    expect(calls.ins).toContainEqual(['plugin_name', ['google-mail', 'outlook']]);
  });

  it('reads the name and the status, not the whole connection row', async () => {
    /* A connection row carries tokens and profile data; a caller deciding
       whether a provider is available needs neither. */
    const { client, calls } = mockSupabase({ data: [] });

    await new PluginConnectionRepository(client).findByUserAndPlugins('u1', ['google-mail']);

    expect(calls.select).toBe('plugin_name, status');
  });

  it('issues no query at all for an empty set', async () => {
    /* `in.()` is rejected by PostgREST, and the answer is knowable without
       asking: no named providers, no matching connections. */
    const { client, calls } = mockSupabase({ data: [] });

    const { data, error } = await new PluginConnectionRepository(client).findByUserAndPlugins(
      'u1',
      []
    );

    expect(calls.table).toBeUndefined();
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('passes the statuses through for the caller to judge', async () => {
    /* Which statuses count as connected is the caller's rule, not this
       method's — it returns what is there. */
    const rows = [
      { plugin_name: 'google-mail', status: 'active' },
      { plugin_name: 'outlook', status: 'expired' },
    ];
    const { client } = mockSupabase({ data: rows });

    const { data } = await new PluginConnectionRepository(client).findByUserAndPlugins('u1', [
      'google-mail',
      'outlook',
    ]);

    expect(data).toEqual(rows);
  });

  it('reports a failed read as an error rather than as nothing connected', async () => {
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await new PluginConnectionRepository(client).findByUserAndPlugins(
      'u1',
      ['google-mail']
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
