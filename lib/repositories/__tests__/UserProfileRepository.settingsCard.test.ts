/**
 * UserProfileRepository: the settings profile card (settings drawer D-2) and
 * the CR-1 safe error projection on `findById`.
 *
 * `saveSettingsCard` is a service-role upsert, so the payload is the tenant
 * boundary: built from an allow-list, `id` (the session user) set last, no
 * `role`, `avatar_url` or timezone ever. A database error is reduced to
 * `{ code, message }` before it is logged or returned, because its `details`
 * can carry row values.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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

import { UserProfileRepository, SETTINGS_CARD_COLUMNS, type ProfileSettingsCardPatch } from '../UserProfileRepository';

type Call = { method: string; args: unknown[] };

function recordingClient(result: { data?: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'single', 'insert', 'update', 'upsert']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve({ data: null, ...result });
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const USER = '44444444-4444-4444-8444-444444444444';
const SECRET = 'Failing row contains (secret-row-value)';

function dbErrorWithDetails() {
  return Object.assign(new Error('new row violates something'), { code: '23514', details: SECRET, hint: 'h' });
}

/** The CR-1 contract on a failed call. */
function expectSafeError(result: { data: unknown; error: Error | null }, dbError: Error & { code?: string }) {
  expect(result.data).toBeNull();
  expect(result.error).not.toBe(dbError);
  expect(result.error?.message).toBe(dbError.message);
  expect((result.error as Error & { code?: string }).code).toBe(dbError.code);
  expect(result.error).not.toHaveProperty('details');
  expect(result.error).not.toHaveProperty('hint');
  const entry = logged.find((e) => e.level === 'error');
  expect(entry?.args[0]).toEqual({ dbError: { code: dbError.code, message: dbError.message }, userId: USER });
  expect(JSON.stringify(logged)).not.toContain('secret-row-value');
}

beforeEach(() => {
  logged.length = 0;
});

describe('findSettingsCard', () => {
  it("S-1: reads exactly the card's three columns for this user, maybeSingle", async () => {
    const row = { full_name: 'Dana Cohen', avatar_url: 'https://x/a.png', job_title: 'founder' };
    const { client, calls } = recordingClient({ data: row, error: null });
    const result = await new UserProfileRepository(client).findSettingsCard(USER);

    expect(result).toEqual({ data: row, error: null });
    expect(SETTINGS_CARD_COLUMNS).toBe('full_name, avatar_url, job_title');
    expect(calls).toEqual([
      { method: 'from', args: ['profiles'] },
      { method: 'select', args: ['full_name, avatar_url, job_title'] },
      { method: 'eq', args: ['id', USER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it('S-2: no row is { data: null, error: null }, not an error', async () => {
    const { client } = recordingClient({ data: null, error: null });
    const result = await new UserProfileRepository(client).findSettingsCard(USER);

    expect(result).toEqual({ data: null, error: null });
    expect(logged.some((e) => e.level === 'error')).toBe(false);
  });

  it('S-3: a database error is returned and logged as the safe projection, never thrown', async () => {
    const dbError = dbErrorWithDetails();
    const { client } = recordingClient({ error: dbError });
    const result = await new UserProfileRepository(client).findSettingsCard(USER);

    expectSafeError(result, dbError);
  });
});

describe('saveSettingsCard', () => {
  it('W-1: one upsert on id, keys full_name, job_title, updated_at, id (last), no select', async () => {
    const { client, calls } = recordingClient({ error: null });
    const result = await new UserProfileRepository(client).saveSettingsCard(USER, {
      full_name: 'Dana',
      job_title: 'founder',
    });

    expect(result).toEqual({ data: true, error: null });
    expect(calls.map((c) => c.method)).toEqual(['from', 'upsert']);
    expect(calls[0].args).toEqual(['profiles']);
    const [payload, options] = calls[1].args as [Record<string, unknown>, unknown];
    expect(options).toEqual({ onConflict: 'id' });
    expect(Object.keys(payload)).toEqual(['full_name', 'job_title', 'updated_at', 'id']);
    expect(payload.id).toBe(USER);
    expect(payload.full_name).toBe('Dana');
    expect(payload.job_title).toBe('founder');
    expect(typeof payload.updated_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.updated_at as string))).toBe(false);
  });

  it('W-2: a job title alone writes no full_name key', async () => {
    const { client, calls } = recordingClient({ error: null });
    await new UserProfileRepository(client).saveSettingsCard(USER, { job_title: 'founder' });

    const payload = calls[1].args[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['job_title', 'updated_at', 'id']);
  });

  it('W-2b: an empty name is a write (the card may clear it)', async () => {
    const { client, calls } = recordingClient({ error: null });
    const result = await new UserProfileRepository(client).saveSettingsCard(USER, { full_name: '' });

    expect(result).toEqual({ data: true, error: null });
    expect((calls[1].args[0] as Record<string, unknown>).full_name).toBe('');
  });

  it('W-3: injected keys never reach the table, and the id is always the session user', async () => {
    const { client, calls } = recordingClient({ error: null });
    const injected = {
      full_name: 'x',
      id: 'ATTACKER',
      user_id: 'ATTACKER',
      role: 'admin',
      avatar_url: 'u',
      timezone: 'UTC',
      timezone_confirmed_at: 't',
    } as unknown as ProfileSettingsCardPatch;
    await new UserProfileRepository(client).saveSettingsCard(USER, injected);

    const payload = calls[1].args[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['full_name', 'updated_at', 'id']);
    expect(payload.id).toBe(USER);
  });

  it('W-4: nothing to write is EMPTY_PATCH with no query', async () => {
    const { client, calls } = recordingClient({ error: null });
    const result = await new UserProfileRepository(client).saveSettingsCard(USER, {});

    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('EMPTY_PATCH');
    expect(calls).toEqual([]);
  });

  it('W-5: a database error is returned and logged as the safe projection, never thrown', async () => {
    const dbError = dbErrorWithDetails();
    const { client } = recordingClient({ error: dbError });
    const result = await new UserProfileRepository(client).saveSettingsCard(USER, { full_name: 'Dana Cohen' });

    expectSafeError(result, dbError);
    expect(JSON.stringify(logged)).not.toContain('Dana');
  });
});

describe('findById (CR-1)', () => {
  it('a database error is returned and logged as the safe projection', async () => {
    const dbError = dbErrorWithDetails();
    const { client } = recordingClient({ error: dbError });
    const result = await new UserProfileRepository(client).findById(USER);

    expectSafeError(result, dbError);
  });
});
