/**
 * UserPreferencesRepository.saveConfirmedTimezone (settings drawer D-1, C-15,
 * SA ruling 2, SA-D1-2).
 *
 * UPDATE first, INSERT only when no row exists, one UPDATE retry on a
 * duplicate key, never an upsert. `preferred_language` is sent only on a new
 * row, and only when the caller resolved one. A `null` count is a failure.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PostgrestError } from '@supabase/postgrest-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { UserPreferencesRepository } from '../UserPreferencesRepository';

type Call = { method: string; args: unknown[] };
type Result = { data?: unknown; error: unknown; count?: number | null };

/** Every query chain resolves to the next queued result, in order. */
function queuedClient(results: Result[]) {
  const calls: Call[] = [];
  const queue = [...results];
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'maybeSingle', 'single', 'insert', 'update', 'upsert']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => void) => {
        const next = queue.shift();
        if (!next) throw new Error('No queued result for this query');
        resolve({ data: null, ...next });
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls, writes: () => calls.filter((c) => ['update', 'insert', 'upsert'].includes(c.method)) };
}

const USER = '22222222-2222-4222-8222-222222222222';
const STAMP = '2026-10-15T09:00:00.000Z';
const ZONE = 'Asia/Jerusalem';

function save(client: SupabaseClient, languageForNewRow: 'he' | null = 'he', zone = ZONE) {
  return new UserPreferencesRepository(client).saveConfirmedTimezone(USER, zone, {
    languageForNewRow,
    confirmedAt: STAMP,
  });
}

const duplicateKey = () =>
  new PostgrestError({ code: '23505', message: 'duplicate key value', details: '', hint: '' });

beforeEach(() => {
  logged.length = 0;
});

describe('saveConfirmedTimezone', () => {
  it('P-1: updates an existing row with one stamp, counted, scoped to the user, and nothing else', async () => {
    const { client, calls } = queuedClient([{ error: null, count: 1 }]);
    const result = await save(client);

    expect(result).toEqual({ data: true, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['user_preferences'] },
      {
        method: 'update',
        args: [{ timezone: ZONE, timezone_confirmed_at: STAMP, updated_at: STAMP }, { count: 'exact' }],
      },
      { method: 'eq', args: ['user_id', USER] },
    ]);
    const [changes] = calls[1].args as [Record<string, unknown>];
    expect(changes.timezone_confirmed_at).toBe(changes.updated_at);
    expect(changes).not.toHaveProperty('preferred_language');
  });

  it('P-2: no row, inserts one carrying the business language and the given user id last', async () => {
    const { client, calls, writes } = queuedClient([{ error: null, count: 0 }, { error: null }]);
    const result = await save(client, 'he');

    expect(result).toEqual({ data: true, error: null });
    expect(writes().map((c) => c.method)).toEqual(['update', 'insert']);
    const insert = calls.find((c) => c.method === 'insert')!;
    expect(insert.args).toHaveLength(1);
    const row = insert.args[0] as Record<string, unknown>;
    expect(row).toEqual({
      timezone: ZONE,
      timezone_confirmed_at: STAMP,
      updated_at: STAMP,
      preferred_language: 'he',
      user_id: USER,
    });
    expect(Object.keys(row).at(-1)).toBe('user_id');
    expect(calls.some((c) => c.method === 'select')).toBe(false);
  });

  it('P-3: no row and no language, inserts without a preferred_language key and warns', async () => {
    const { client, calls } = queuedClient([{ error: null, count: 0 }, { error: null }]);
    const result = await save(client, null);

    expect(result).toEqual({ data: true, error: null });
    const row = calls.find((c) => c.method === 'insert')!.args[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('preferred_language');
    expect(logged.some((e) => e.level === 'warn')).toBe(true);
  });

  it('P-3b: a normal update does not warn about a language', async () => {
    const { client } = queuedClient([{ error: null, count: 1 }]);
    await save(client, null);
    expect(logged.some((e) => e.level === 'warn')).toBe(false);
  });

  it('P-4: a duplicate key on insert retries the update once', async () => {
    const { client, writes } = queuedClient([
      { error: null, count: 0 },
      { error: duplicateKey() },
      { error: null, count: 1 },
    ]);
    const result = await save(client);

    expect(result).toEqual({ data: true, error: null });
    expect(writes().map((c) => c.method)).toEqual(['update', 'insert', 'update']);
  });

  it('P-5: a retry that still finds no row fails, with no third write', async () => {
    const { client, writes } = queuedClient([
      { error: null, count: 0 },
      { error: duplicateKey() },
      { error: null, count: 0 },
    ]);
    const result = await save(client);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(writes().map((c) => c.method)).toEqual(['update', 'insert', 'update']);
  });

  it('P-6: an update error is returned with its code only, nothing inserted, safely logged', async () => {
    const dbError = new PostgrestError({
      code: '42501',
      message: 'permission denied',
      details: 'Failing row contains (leak-check@example.com)',
      hint: 'hint',
    });
    const { client, writes } = queuedClient([{ error: dbError }]);
    const result = await save(client);

    expect(result.data).toBeNull();
    expect(result.error).not.toBe(dbError);
    expect((result.error as Error & { code?: string }).code).toBe('42501');
    expect(result.error).not.toHaveProperty('details');
    expect(writes().map((c) => c.method)).toEqual(['update']);
    expect(JSON.stringify(logged)).not.toContain('leak-check@example.com');
    expect(logged.some((e) => e.level === 'error')).toBe(true);
  });

  it('P-7: an insert error other than a duplicate key fails with no retry', async () => {
    const insertError = new PostgrestError({ code: '23502', message: 'null value', details: '', hint: '' });
    const { client, writes } = queuedClient([{ error: null, count: 0 }, { error: insertError }]);
    const result = await save(client);

    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('23502');
    expect(writes().map((c) => c.method)).toEqual(['update', 'insert']);
  });

  it('P-8: a null count fails closed, with no insert (SA Q-3)', async () => {
    const { client, writes } = queuedClient([{ error: null, count: null }]);
    const result = await save(client);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(writes().map((c) => c.method)).toEqual(['update']);
  });

  it('P-9: writes the zone exactly as given', async () => {
    const { client, calls } = queuedClient([{ error: null, count: 0 }, { error: null }]);
    await save(client, 'he', 'Etc/GMT+5');

    const update = calls.find((c) => c.method === 'update')!.args[0] as Record<string, unknown>;
    const row = calls.find((c) => c.method === 'insert')!.args[0] as Record<string, unknown>;
    expect(update.timezone).toBe('Etc/GMT+5');
    expect(row.timezone).toBe('Etc/GMT+5');
  });

  it('P-10: more than one row updated is still success, but warned (duplicate-row signal)', async () => {
    const { client } = queuedClient([{ error: null, count: 2 }]);
    const result = await save(client);

    expect(result).toEqual({ data: true, error: null });
    expect(logged.some((e) => e.level === 'warn')).toBe(true);
  });

  it('never upserts and never selects, on any path', async () => {
    for (const results of [
      [{ error: null, count: 1 }],
      [{ error: null, count: 0 }, { error: null }],
      [{ error: null, count: 0 }, { error: duplicateKey() }, { error: null, count: 1 }],
    ] as Result[][]) {
      const { client, calls } = queuedClient(results);
      await save(client);
      expect(calls.some((c) => c.method === 'upsert' || c.method === 'select')).toBe(false);
      for (const c of calls.filter((x) => x.method === 'update')) {
        expect(c.args[1]).toEqual({ count: 'exact' });
      }
    }
  });
});
