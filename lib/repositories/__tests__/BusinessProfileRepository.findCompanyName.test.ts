/**
 * BusinessProfileRepository.findCompanyName (data export DE-8b, SA C-8): one
 * explicit column, scoped to the caller's id, never `*`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessProfileRepository } from '../BusinessProfileRepository';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function client(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return method === 'maybeSingle' ? Promise.resolve(result) : builder;
    };
  }
  const c = { from: (table: string) => (calls.push(['from', [table]]), builder) } as unknown as SupabaseClient;
  return { c, calls };
}

it('reads company_name only, for the given user', async () => {
  const { c, calls } = client({ data: { company_name: 'סטודיו נוגה' }, error: null });
  expect(await new BusinessProfileRepository(c).findCompanyName(USER)).toEqual({ data: 'סטודיו נוגה', error: null });
  expect(calls).toEqual([
    ['from', ['business_profiles']],
    ['select', ['company_name']],
    ['eq', ['user_id', USER]],
    ['maybeSingle', []],
  ]);
});

it('no row, NULL or blank is null', async () => {
  for (const data of [null, { company_name: null }, { company_name: '   ' }]) {
    expect((await new BusinessProfileRepository(client({ data, error: null }).c).findCompanyName(USER)).data).toBeNull();
  }
});

it('an error is returned, never thrown', async () => {
  const { data, error } = await new BusinessProfileRepository(client({ data: null, error: { message: 'down' } }).c).findCompanyName(USER);
  expect(data).toBeNull();
  expect(error).toBeTruthy();
});
