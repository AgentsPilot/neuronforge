/**
 * UserProfileRepository.updateTimezoneMirror (settings drawer D-1, C-15).
 *
 * The best-effort `profiles.timezone` copy: a targeted UPDATE of an EXISTING
 * row only. It never creates a profile row.
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

function recordingClient(result: { error: unknown; count?: number | null }) {
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

const USER = '33333333-3333-4333-8333-333333333333';
const STAMP = '2026-10-15T09:00:00.000Z';

beforeEach(() => {
  logged.length = 0;
});

describe('updateTimezoneMirror', () => {
  it("U-1: updates only this user's timezone and updated_at, counted, and nothing else", async () => {
    const { client, calls } = recordingClient({ error: null, count: 1 });
    const result = await new UserProfileRepository(client).updateTimezoneMirror(USER, 'Asia/Jerusalem', STAMP);

    expect(result).toEqual({ data: true, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['profiles'] },
      { method: 'update', args: [{ timezone: 'Asia/Jerusalem', updated_at: STAMP }, { count: 'exact' }] },
      { method: 'eq', args: ['id', USER] },
    ]);
  });

  it('U-2: no profile row is not an error, is logged at info, and creates nothing', async () => {
    const { client, calls } = recordingClient({ error: null, count: 0 });
    const result = await new UserProfileRepository(client).updateTimezoneMirror(USER, 'UTC', STAMP);

    expect(result).toEqual({ data: true, error: null });
    expect(calls.some((c) => ['insert', 'upsert', 'select'].includes(c.method))).toBe(false);
    expect(logged.some((e) => e.level === 'info')).toBe(true);
    expect(logged.some((e) => e.level === 'error')).toBe(false);
  });

  it('U-3: an error is returned and logged as the safe projection (CR-1), never thrown', async () => {
    const dbError = Object.assign(new Error('mirror failed'), {
      code: '42501',
      details: 'Failing row contains (secret-row-value)',
    });
    const { client } = recordingClient({ error: dbError });
    const result = await new UserProfileRepository(client).updateTimezoneMirror(USER, 'UTC', STAMP);

    expect(result.data).toBeNull();
    expect(result.error).not.toBe(dbError);
    expect(result.error?.message).toBe('mirror failed');
    expect((result.error as Error & { code?: string }).code).toBe('42501');
    expect(result.error).not.toHaveProperty('details');
    const entry = logged.find((e) => e.level === 'error');
    expect(entry?.args[0]).toEqual({ dbError: { code: '42501', message: 'mirror failed' }, userId: USER });
    expect(JSON.stringify(logged)).not.toContain('secret-row-value');
  });
});
