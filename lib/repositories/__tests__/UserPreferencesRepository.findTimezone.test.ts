/**
 * UserPreferencesRepository.findTimezone — against the REAL class (F-13).
 *
 * The method was lost in the 2026-10-05 merge f66cae67 while
 * `packageAcceptance.test.ts` kept passing, because it mocks the whole
 * repository with its own `findTimezone`. These tests exercise the real method
 * through a fake Supabase client, so a second loss fails here.
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

function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'single', 'insert', 'update', 'upsert']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const USER = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  logged.length = 0;
});

describe('findTimezone', () => {
  it('reads exactly timezone of this user, one row at most, and never writes', async () => {
    const { client, calls } = recordingClient({ data: { timezone: 'Asia/Jerusalem' }, error: null });
    const result = await new UserPreferencesRepository(client).findTimezone(USER);

    expect(result).toEqual({ data: 'Asia/Jerusalem', error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['user_preferences'] },
      { method: 'select', args: ['timezone'] },
      { method: 'eq', args: ['user_id', USER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it('returns a stored UTC as UTC — a choice, not a default', async () => {
    const { client } = recordingClient({ data: { timezone: 'UTC' }, error: null });
    expect(await new UserPreferencesRepository(client).findTimezone(USER)).toEqual({ data: 'UTC', error: null });
  });

  it('trims surrounding whitespace from a stored zone', async () => {
    const { client } = recordingClient({ data: { timezone: '  Europe/London ' }, error: null });
    expect(await new UserPreferencesRepository(client).findTimezone(USER)).toEqual({
      data: 'Europe/London',
      error: null,
    });
  });

  it.each([
    ['no row', null],
    ['a null zone', { timezone: null }],
    ['a blank zone', { timezone: '   ' }],
    ['a non-string zone', { timezone: 42 }],
  ])('returns null, never UTC, for %s', async (_label, row) => {
    const { client } = recordingClient({ data: row, error: null });
    const result = await new UserPreferencesRepository(client).findTimezone(USER);

    expect(result).toEqual({ data: null, error: null });
    expect(logged).toEqual([]);
  });

  it('returns a database error as { data: null, error } instead of throwing, reduced to code and message', async () => {
    const dbError = new PostgrestError({
      message: 'permission denied for table user_preferences',
      details: 'secret detail',
      hint: 'secret hint',
      code: '42501',
    });
    const { client } = recordingClient({ data: null, error: dbError });

    const result = await new UserPreferencesRepository(client).findTimezone(USER);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('permission denied for table user_preferences');
    expect((result.error as Error & { code?: string }).code).toBe('42501');
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('error');
    expect(JSON.stringify(logged[0].args)).not.toMatch(/secret/);
  });
});
