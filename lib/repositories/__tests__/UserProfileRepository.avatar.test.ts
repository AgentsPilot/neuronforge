/**
 * UserProfileRepository: the profile-picture URL (settings drawer D-3, C-19).
 *
 * `setAvatarUrl` is a service-role upsert on `id`, so it works for an account
 * with no `profiles` row (SA-D2-8 / RK-2 / F-25 D-3 note: the old browser
 * UPDATE silently saved nothing there). `clearAvatarUrl` is a targeted UPDATE
 * that never creates a row. A URL is never logged, and a database error is
 * reduced to `{ code, message }` (CR-1).
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

import { UserProfileRepository } from '../UserProfileRepository';

type Call = { method: string; args: unknown[] };

function recordingClient(result: { data?: unknown; error: unknown; count?: number | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'single', 'insert', 'update', 'upsert']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve({ data: null, count: null, ...result });
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/**
 * A tiny `profiles` table with PostgREST's write semantics: `update().eq()`
 * changes only an existing row (count 0 otherwise); `upsert(onConflict: 'id')`
 * inserts or updates. Enough to prove a no-row account gets its URL stored.
 */
function tableClient(rows: Map<string, Record<string, unknown>>) {
  const client = {
    from: () => {
      let op: { kind: 'update' | 'upsert'; payload: Record<string, unknown> } | null = null;
      let id: unknown;
      const builder: Record<string, unknown> = {
        update: (payload: Record<string, unknown>) => {
          op = { kind: 'update', payload };
          return builder;
        },
        upsert: (payload: Record<string, unknown>) => {
          op = { kind: 'upsert', payload };
          return builder;
        },
        eq: (_column: string, value: unknown) => {
          id = value;
          return builder;
        },
        then: (resolve: (value: unknown) => void) => {
          if (!op) return resolve({ data: null, error: null });
          if (op.kind === 'upsert') {
            const key = String(op.payload.id);
            rows.set(key, { ...(rows.get(key) ?? {}), ...op.payload });
            return resolve({ data: null, error: null, count: null });
          }
          const existing = rows.get(String(id));
          if (!existing) return resolve({ data: null, error: null, count: 0 });
          rows.set(String(id), { ...existing, ...op.payload });
          return resolve({ data: null, error: null, count: 1 });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return client;
}

const USER = '44444444-4444-4444-8444-444444444444';
const URL_MARKER = 'https://proj.supabase.co/storage/v1/object/public/avatars/MARKER-URL.png';
const SECRET = 'Failing row contains (secret-row-value)';

function dbErrorWithDetails() {
  return Object.assign(new Error('new row violates something'), { code: '23514', details: SECRET, hint: 'h' });
}

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

describe('findAvatarUrl', () => {
  it('R-1: selects exactly avatar_url for this user, maybeSingle, and returns the string', async () => {
    const { client, calls } = recordingClient({ data: { avatar_url: URL_MARKER }, error: null });
    const result = await new UserProfileRepository(client).findAvatarUrl(USER);

    expect(result).toEqual({ data: URL_MARKER, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['profiles'] },
      { method: 'select', args: ['avatar_url'] },
      { method: 'eq', args: ['id', USER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it.each([
    ['no row', null],
    ['NULL column', { avatar_url: null }],
  ])('R-1: %s is { data: null, error: null }', async (_name, row) => {
    const { client } = recordingClient({ data: row, error: null });
    expect(await new UserProfileRepository(client).findAvatarUrl(USER)).toEqual({ data: null, error: null });
    expect(logged.some((e) => e.level === 'error')).toBe(false);
  });

  it('R-6: a database error is the safe projection, never thrown', async () => {
    const dbError = dbErrorWithDetails();
    const { client } = recordingClient({ error: dbError });
    expectSafeError(await new UserProfileRepository(client).findAvatarUrl(USER), dbError);
  });
});

describe('setAvatarUrl', () => {
  it('R-2: one upsert on id, keys avatar_url, updated_at, id (last), no select, no update', async () => {
    const { client, calls } = recordingClient({ error: null });
    const result = await new UserProfileRepository(client).setAvatarUrl(USER, URL_MARKER);

    expect(result).toEqual({ data: true, error: null });
    expect(calls.map((c) => c.method)).toEqual(['from', 'upsert']);
    expect(calls[0].args).toEqual(['profiles']);
    const [payload, options] = calls[1].args as [Record<string, unknown>, unknown];
    expect(options).toEqual({ onConflict: 'id' });
    expect(Object.keys(payload)).toEqual(['avatar_url', 'updated_at', 'id']);
    expect(payload.id).toBe(USER);
    expect(payload.avatar_url).toBe(URL_MARKER);
    expect(Number.isNaN(Date.parse(payload.updated_at as string))).toBe(false);
  });

  it('R-3: an account with NO profiles row gets its URL stored (SA-D2-8)', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const result = await new UserProfileRepository(tableClient(rows)).setAvatarUrl(USER, URL_MARKER);

    expect(result).toEqual({ data: true, error: null });
    expect(rows.get(USER)?.avatar_url).toBe(URL_MARKER);
    expect(rows.get(USER)?.id).toBe(USER);
  });

  it('R-3: an existing row is updated, its other columns left alone', async () => {
    const rows = new Map<string, Record<string, unknown>>([
      [USER, { id: USER, full_name: 'Dana', role: 'user', avatar_url: 'old' }],
    ]);
    await new UserProfileRepository(tableClient(rows)).setAvatarUrl(USER, URL_MARKER);

    expect(rows.get(USER)).toMatchObject({ id: USER, full_name: 'Dana', role: 'user', avatar_url: URL_MARKER });
  });

  it('R-4: an empty URL is EMPTY_VALUE with no query', async () => {
    const { client, calls } = recordingClient({ error: null });
    const result = await new UserProfileRepository(client).setAvatarUrl(USER, '');

    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('EMPTY_VALUE');
    expect(calls).toEqual([]);
  });

  it('R-6: a database error is the safe projection, never thrown', async () => {
    const dbError = dbErrorWithDetails();
    const { client } = recordingClient({ error: dbError });
    expectSafeError(await new UserProfileRepository(client).setAvatarUrl(USER, URL_MARKER), dbError);
  });
});

describe('clearAvatarUrl', () => {
  it('R-5: a targeted update with count, scoped to this user, no select, never upsert', async () => {
    const { client, calls } = recordingClient({ error: null, count: 1 });
    const result = await new UserProfileRepository(client).clearAvatarUrl(USER);

    expect(result).toEqual({ data: true, error: null });
    expect(calls.map((c) => c.method)).toEqual(['from', 'update', 'eq']);
    const [payload, options] = calls[1].args as [Record<string, unknown>, unknown];
    expect(Object.keys(payload)).toEqual(['avatar_url', 'updated_at']);
    expect(payload.avatar_url).toBeNull();
    expect(options).toEqual({ count: 'exact' });
    expect(calls[2].args).toEqual(['id', USER]);
  });

  it('R-5: no row is { data: true } with an info log, and no row is created', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const result = await new UserProfileRepository(tableClient(rows)).clearAvatarUrl(USER);

    expect(result).toEqual({ data: true, error: null });
    expect(rows.size).toBe(0);
    expect(logged).toEqual([{ level: 'info', args: [{ userId: USER }, 'No profile row to clear the avatar on'] }]);
  });

  it('R-5: an existing row has its URL cleared', async () => {
    const rows = new Map<string, Record<string, unknown>>([[USER, { id: USER, avatar_url: URL_MARKER }]]);
    await new UserProfileRepository(tableClient(rows)).clearAvatarUrl(USER);
    expect(rows.get(USER)?.avatar_url).toBeNull();
  });

  it('R-6: a database error is the safe projection, never thrown', async () => {
    const dbError = dbErrorWithDetails();
    const { client } = recordingClient({ error: dbError });
    expectSafeError(await new UserProfileRepository(client).clearAvatarUrl(USER), dbError);
  });
});

describe('R-7: no URL value in any log call', () => {
  it('on every path', async () => {
    const repo = (r: { data?: unknown; error: unknown; count?: number }) =>
      new UserProfileRepository(recordingClient(r).client);
    await repo({ data: { avatar_url: URL_MARKER }, error: null }).findAvatarUrl(USER);
    await repo({ error: dbErrorWithDetails() }).findAvatarUrl(USER);
    await repo({ error: null }).setAvatarUrl(USER, URL_MARKER);
    await repo({ error: dbErrorWithDetails() }).setAvatarUrl(USER, URL_MARKER);
    await repo({ error: null, count: 0 }).clearAvatarUrl(USER);
    await repo({ error: dbErrorWithDetails() }).clearAvatarUrl(USER);

    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain('MARKER-URL');
  });
});
