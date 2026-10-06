/**
 * AD-1a (T1) — `BusinessPurgeRepository.introspectSchema()`.
 *
 * The reconciler built on this is a fail-closed oracle, so the properties that
 * matter are: it calls the one read-only RPC with no arguments, it never
 * throws, and a payload it cannot parse is an ERROR — not an empty schema that
 * would reconcile clean.
 *
 * Runs without network: the repository accepts an injected client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { BusinessPurgeRepository } from '../BusinessPurgeRepository';

function clientReturning(result: { data: unknown; error: unknown } | Error) {
  // Arguments are recorded through `rpc.mock.calls`; the double ignores them.
  const rpc = jest.fn<Promise<unknown>, unknown[]>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  // Only `rpc` is exercised; the cast is confined to this test double.
  const client = { rpc } as unknown as SupabaseClient;
  return { client, rpc };
}

const VALID = {
  generated_at: '2026-10-04T18:03:00Z',
  columns: [
    { table_name: 'a', column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO' },
  ],
  user_scoped_tables: ['a'],
  foreign_keys: [
    { constraint_name: 'a_user_id_fkey', table_name: 'a', references: 'users', on_delete: 'c' },
  ],
  triggers: [{ trigger_name: 't', table_name: 'a', definition: 'x' }],
  policies: [],
};

describe('BusinessPurgeRepository.introspectSchema', () => {
  it('calls purge_schema_introspect with no arguments and returns the parsed subset', async () => {
    const { client, rpc } = clientReturning({ data: VALID, error: null });
    const repo = new BusinessPurgeRepository(client);

    const { data, error } = await repo.introspectSchema();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(['purge_schema_introspect']);
    expect(error).toBeNull();
    expect(data?.columns).toEqual([{ table_name: 'a', column_name: 'user_id' }]);
    expect(data?.foreign_keys).toEqual(VALID.foreign_keys);
    // Purge slice 3a: triggers are kept for the delete-graph check.
    expect(data?.triggers).toEqual(VALID.triggers);
    // Everything else outside the read subset is still dropped.
    expect(data).not.toHaveProperty('policies');
  });

  it('still parses a payload without triggers (back-compat); the graph check, not the parser, refuses it', async () => {
    const withoutTriggers: Record<string, unknown> = { ...VALID };
    delete withoutTriggers.triggers;
    const { client } = clientReturning({ data: withoutTriggers, error: null });
    const { data, error } = await new BusinessPurgeRepository(client).introspectSchema();
    expect(error).toBeNull();
    expect(data?.triggers).toBeUndefined();
  });

  it('treats a malformed trigger entry as an error', async () => {
    const { client } = clientReturning({
      data: { ...VALID, triggers: [{ trigger_name: 't', definition: 'x' }] },
      error: null,
    });
    const { data, error } = await new BusinessPurgeRepository(client).introspectSchema();
    expect(data).toBeNull();
    expect(error?.message).toMatch(/unexpected shape/);
  });

  it('returns an error (never throws) when the RPC errors', async () => {
    const { client } = clientReturning({ data: null, error: { message: 'permission denied for function', code: '42501' } });
    const repo = new BusinessPurgeRepository(client);

    const { data, error } = await repo.introspectSchema();

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('permission denied for function');
  });

  it('returns an error when the client rejects', async () => {
    const { client } = clientReturning(new Error('fetch failed'));
    const { data, error } = await new BusinessPurgeRepository(client).introspectSchema();
    expect(data).toBeNull();
    expect(error?.message).toBe('fetch failed');
  });

  it.each([
    ['null payload', null],
    ['columns missing', { foreign_keys: [] }],
    ['foreign_keys missing', { columns: [] }],
    ['column without a table name', { columns: [{ column_name: 'user_id' }], foreign_keys: [] }],
    ['fk without references', { columns: [], foreign_keys: [{ constraint_name: 'x', table_name: 'a', on_delete: 'c' }] }],
  ])('treats a malformed payload (%s) as an error, not an empty schema', async (_label, payload) => {
    const { client } = clientReturning({ data: payload, error: null });
    const { data, error } = await new BusinessPurgeRepository(client).introspectSchema();
    expect(data).toBeNull();
    expect(error?.message).toMatch(/unexpected shape/);
  });
});
