/**
 * UserPreferencesRepository — one test per method (new-repository skill).
 * Slice 2a (C-8 as amended, D-8): the invite form's language pre-select.
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

const USER = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  logged.length = 0;
});

describe('findPreferredLanguage', () => {
  it('reads exactly preferred_language of this user, one row at most, and never writes', async () => {
    const { client, calls } = recordingClient({ data: { preferred_language: 'he' }, error: null });
    const result = await new UserPreferencesRepository(client).findPreferredLanguage(USER);

    expect(result).toEqual({ data: 'he', error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['user_preferences'] },
      { method: 'select', args: ['preferred_language'] },
      { method: 'eq', args: ['user_id', USER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it.each([
    ['EN ', 'en'],
    ['es', 'es'],
    ['He', 'he'],
  ])('normalises %j to %j', async (stored, expected) => {
    const { client } = recordingClient({ data: { preferred_language: stored }, error: null });
    const result = await new UserPreferencesRepository(client).findPreferredLanguage(USER);
    expect(result).toEqual({ data: expected, error: null });
  });

  it.each([
    ['an unsupported language', { preferred_language: 'fr' }],
    ['a blank value', { preferred_language: '' }],
    ['a null value', { preferred_language: null }],
    ['a non-string value', { preferred_language: 7 }],
    ['no row', null],
  ])('is null data (not English) for %s', async (_label, data) => {
    const { client } = recordingClient({ data, error: null });
    const result = await new UserPreferencesRepository(client).findPreferredLanguage(USER);
    expect(result).toEqual({ data: null, error: null });
  });

  it('on a database error returns { data: null, error } with only code and message (M-1)', async () => {
    const dbError = new PostgrestError({
      code: '42703',
      message: 'column user_preferences.preferred_language does not exist',
      details: 'Failing row contains (leak-check@example.com)',
      hint: 'hint',
    });
    const { client } = recordingClient({ data: null, error: dbError });
    const result = await new UserPreferencesRepository(client).findPreferredLanguage(USER);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).not.toBe(dbError);
    expect(result.error?.message).toBe(dbError.message);
    expect((result.error as Error & { code?: string }).code).toBe('42703');
    expect(result.error).not.toHaveProperty('details');
    expect(JSON.stringify(logged)).not.toContain('leak-check@example.com');
    expect(logged.some((entry) => entry.level === 'error')).toBe(true);
  });
});
