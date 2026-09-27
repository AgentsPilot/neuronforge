/**
 * ArchiveRepository, Slice 3: the two per-user methods behind GDPR erasure and
 * export (workplan §5.1, S3-R1 to S3-R5).
 *
 * The property that matters is scope: erasure runs as the service role, so the
 * `user_id` argument is the only thing standing between one account and every
 * other. S3-R2 measures that against real rows rather than inferring it from
 * the recorded filters.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArchiveRepository } from '../ArchiveRepository';

type Call = [string, ...unknown[]];

const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const WRITES = ['insert', 'update', 'delete', 'upsert', 'rpc'];

/** Records every call; awaiting the chain resolves to the canned response. */
function fakeClient(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'range', 'insert', 'update', 'delete', 'upsert']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve, reject);
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
    rpc: (...args: unknown[]) => {
      calls.push(['rpc', ...args]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

/**
 * A tiny stateful archived_records: `delete` applies the recorded `eq` filters
 * to real rows, so "another account is untouched" is measured.
 */
function statefulArchive(rows: Array<{ id: string; user_id: string; source: string }>) {
  const table = [...rows];
  const filters: Array<[string, unknown]> = [];
  let isDelete = false;
  const builder: Record<string, unknown> = {};
  builder.delete = () => {
    isDelete = true;
    return builder;
  };
  builder.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return builder;
  };
  builder.then = (resolve: (value: unknown) => unknown) => {
    let count = 0;
    if (isDelete) {
      const keep = table.filter(
        (row) => !filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value)
      );
      count = table.length - keep.length;
      table.splice(0, table.length, ...keep);
    }
    return Promise.resolve({ data: null, error: null, count }).then(resolve);
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, table };
}

describe('deleteArchivedForUser (C-8, AC-13)', () => {
  it('S3-R1: one delete on archived_records, exact count, exactly one filter (user_id), no select', async () => {
    const { client, calls } = fakeClient({ count: 3 });

    const result = await new ArchiveRepository(client).deleteArchivedForUser(USER_A);

    expect(result).toEqual({ data: 3, error: null });
    expect(calls).toEqual([
      ['from', 'archived_records'],
      ['delete', { count: 'exact' }],
      ['eq', 'user_id', USER_A],
    ]);
  });

  it("S3-R2: removes only that account's rows, of every source; another account is untouched", async () => {
    const { client, table } = statefulArchive([
      { id: '1', user_id: USER_A, source: 'audit_trail' },
      { id: '2', user_id: USER_A, source: 'some_future_source' },
      { id: '3', user_id: USER_B, source: 'audit_trail' },
      { id: '4', user_id: USER_B, source: 'audit_trail' },
    ]);

    const result = await new ArchiveRepository(client).deleteArchivedForUser(USER_A);

    expect(result).toEqual({ data: 2, error: null });
    expect(table.map((row) => row.id)).toEqual(['3', '4']);
  });

  it.each(['', 'not-a-uuid', 'null'])('S3-R3: refuses %p before any query', async (bad) => {
    const { client, calls } = fakeClient({ count: 9 });

    const result = await new ArchiveRepository(client).deleteArchivedForUser(bad);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('S3-R3: a missing count is an error, never 0; a database error is returned, not thrown', async () => {
    const missing = await new ArchiveRepository(fakeClient({ count: null }).client).deleteArchivedForUser(USER_A);
    expect(missing.data).toBeNull();
    expect(missing.error).toBeInstanceOf(Error);

    const failed = await new ArchiveRepository(
      fakeClient({ error: { message: 'boom' } }).client
    ).deleteArchivedForUser(USER_A);
    expect(failed.data).toBeNull();
    expect(failed.error?.message).toBe('boom');
  });
});

describe('listArchivedForUser (FR-14c)', () => {
  it('S3-R4: filters user_id and source, selects source_id, payload, archived_at, newest first, first page', async () => {
    const { client, calls } = fakeClient({ data: [{ source_id: 'x', payload: {}, archived_at: 't' }] });

    const result = await new ArchiveRepository(client).listArchivedForUser(USER_A, 'audit_trail');

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(calls).toEqual([
      ['from', 'archived_records'],
      ['select', 'source_id, payload, archived_at'],
      ['eq', 'user_id', USER_A],
      ['eq', 'source', 'audit_trail'],
      ['order', 'original_created_at', { ascending: false }],
      ['order', 'id', { ascending: true }],
      ['range', 0, 999],
    ]);
    expect(calls.some(([method]) => WRITES.includes(method))).toBe(false);
  });

  it('S3-R4: reads the next page while a page comes back full, and stops at a short one', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ source_id: `a${i}`, payload: {}, archived_at: 't' }));
    const pages = [full, [{ source_id: 'last', payload: {}, archived_at: 't' }]];
    const ranges: unknown[][] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order']) builder[method] = () => builder;
    builder.range = (...args: unknown[]) => {
      ranges.push(args);
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: pages.shift() ?? [], error: null }).then(resolve);
    const client = { from: () => builder } as unknown as SupabaseClient;

    const result = await new ArchiveRepository(client).listArchivedForUser(USER_A, 'audit_trail');

    expect(result.data).toHaveLength(1001);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('S3-R4: refuses a non-UUID before any query; a database error is returned, not thrown', async () => {
    const refused = fakeClient({ data: [] });
    const bad = await new ArchiveRepository(refused.client).listArchivedForUser('nope', 'audit_trail');
    expect(bad.error).toBeInstanceOf(Error);
    expect(refused.calls).toEqual([]);

    const failed = await new ArchiveRepository(
      fakeClient({ error: { message: 'down' } }).client
    ).listArchivedForUser(USER_A, 'audit_trail');
    expect(failed.data).toBeNull();
    expect(failed.error?.message).toBe('down');
  });
});

describe('S3-R5: payload is read in one place only (AC-14)', () => {
  it('listArchivedForUser holds the only select in the file that names payload', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ArchiveRepository.ts'), 'utf8');
    const selects = [...source.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
    expect(selects.filter((arg) => /payload/.test(arg))).toEqual(["'source_id, payload, archived_at'"]);
  });
});
