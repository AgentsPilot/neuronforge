/**
 * BusinessProfileRepository.updateLanguage / updateDefaultCurrency.
 *
 * The two writes behind PATCH /api/business-os/preferences. Each must touch
 * one column (plus updated_at) of the given user's row only, must not require
 * a row to exist (no `.single()`), and must hand a database refusal back with
 * its SQLSTATE so the route can tell the currency lock from a failure.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessProfileRepository } from '../BusinessProfileRepository';

type Call = { method: string; args: unknown[] };

function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'single', 'update']) {
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

describe.each([
  ['updateLanguage', 'language', 'he'],
  ['updateDefaultCurrency', 'currency', 'ILS'],
] as const)('%s', (method, column, value) => {
  it(`updates only ${column} and updated_at, for this user, without requiring a row`, async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    const result = await new BusinessProfileRepository(client)[method](USER, value);

    expect(result).toEqual({ data: true, error: null });
    expect(calls.map((c) => c.method)).toEqual(['from', 'update', 'eq']);
    expect(calls[0].args).toEqual(['business_profiles']);
    const payload = calls[1].args[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([column, 'updated_at'].sort());
    expect(payload[column]).toBe(value);
    expect(calls[2].args).toEqual(['user_id', USER]);
  });

  it('returns the database error with its code', async () => {
    const dbError = { code: '23514', message: 'Cannot change the business currency' };
    const { client } = recordingClient({ data: null, error: dbError });
    const result = await new BusinessProfileRepository(client)[method](USER, value);

    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('23514');
  });
});

describe('findDefaultCurrency', () => {
  it("reads only this user's currency, at most one row", async () => {
    const { client, calls } = recordingClient({ data: { currency: 'ILS' }, error: null });
    const result = await new BusinessProfileRepository(client).findDefaultCurrency(USER);

    expect(result).toEqual({ data: 'ILS', error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_profiles'] },
      { method: 'select', args: ['currency'] },
      { method: 'eq', args: ['user_id', USER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it.each([
    ['no business row', null],
    ['no currency chosen', { currency: null }],
  ])('is null (not a default) for %s', async (_label, data) => {
    const { client } = recordingClient({ data, error: null });
    const result = await new BusinessProfileRepository(client).findDefaultCurrency(USER);
    expect(result).toEqual({ data: null, error: null });
  });

  it('returns the database error', async () => {
    const { client } = recordingClient({ data: null, error: { code: '42703', message: 'nope' } });
    const result = await new BusinessProfileRepository(client).findDefaultCurrency(USER);
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('42703');
  });
});

describe('findLanguage (N-1, N7: the inviter notification reads the recipient language)', () => {
  it("reads only this user's language, at most one row", async () => {
    const { client, calls } = recordingClient({ data: { language: 'he' }, error: null });
    const result = await new BusinessProfileRepository(client).findLanguage(USER);

    expect(result).toEqual({ data: 'he', error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_profiles'] },
      { method: 'select', args: ['language'] },
      { method: 'eq', args: ['user_id', USER] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it.each([
    ['no business row', null],
    ['no language stored', { language: null }],
  ])('is null (not a default) for %s', async (_label, data) => {
    const { client } = recordingClient({ data, error: null });
    expect(await new BusinessProfileRepository(client).findLanguage(USER)).toEqual({ data: null, error: null });
  });

  it('returns the database error', async () => {
    const { client } = recordingClient({ data: null, error: { code: '42703', message: 'nope' } });
    const result = await new BusinessProfileRepository(client).findLanguage(USER);
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('42703');
  });

  it('a rejected query rejects: the Stripe webhook must still fail and let Stripe retry (CF-5 PR 2, SA CR-P2-1)', async () => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) builder[method] = () => builder;
    builder.maybeSingle = () => Promise.reject(new Error('socket hang up'));
    const client = { from: () => builder } as unknown as SupabaseClient;

    await expect(new BusinessProfileRepository(client).findLanguage(USER)).rejects.toThrow('socket hang up');
  });
});
