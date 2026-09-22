/**
 * BusinessProfileRepository.searchForAdmin — Layer 1.1 FR-2 / AC-15.
 *
 * An intentional cross-account read for the admin business picker: only
 * `user_id, company_name`, at most 50, name search with `\ % _` taken
 * literally, and never an `.or()` built from input.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BUSINESS_SEARCH_MAX_LIMIT,
  BusinessProfileRepository,
  escapeIlikePattern,
} from '../BusinessProfileRepository';
import { createFakeSupabase, type Row } from '@/tests/helpers/fakePostgrest';

const PROFILES: Row[] = [
  { user_id: 'u-1', company_name: 'Acme Coaching', email: 'owner1@example.com', phone: '1' },
  { user_id: 'u-2', company_name: '50% Off Studio', email: 'owner2@example.com' },
  { user_id: 'u-3', company_name: '500 Off Studio', email: 'owner3@example.com' },
  { user_id: 'u-4', company_name: 'snake_case Ltd', email: 'owner4@example.com' },
  { user_id: 'u-5', company_name: 'snakeXcase Ltd', email: 'owner5@example.com' },
  { user_id: 'u-6', company_name: 'Back\\slash Co', email: 'owner6@example.com' },
  { user_id: 'u-7', company_name: null, email: 'owner7@example.com' },
  { user_id: 'u-8', company_name: 'Beta, (Parens) Inc', email: 'owner8@example.com' },
];

function setup(rows: Row[] = PROFILES) {
  const fake = createFakeSupabase({ tables: { business_profiles: rows } });
  const repo = new BusinessProfileRepository(fake.client as unknown as SupabaseClient);
  return { fake, repo };
}

describe('escapeIlikePattern', () => {
  it('escapes backslash, percent and underscore, in that order', () => {
    expect(escapeIlikePattern('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeIlikePattern('plain')).toBe('plain');
  });
});

describe('searchForAdmin', () => {
  it('selects only user_id and company_name, sorted by name, no email', async () => {
    const { fake, repo } = setup();
    const result = await repo.searchForAdmin(undefined, 50);

    expect(result.error).toBeNull();
    expect(fake.queries[0].select).toBe('user_id, company_name');
    for (const entry of result.data ?? []) expect(Object.keys(entry).sort()).toEqual(['company_name', 'user_id']);
    expect(JSON.stringify(result.data)).not.toMatch(/@example\.com/);
    expect(fake.queries[0].order).toEqual([{ column: 'company_name', ascending: true }]);
    expect(fake.queries[0].filters).toEqual([]);
  });

  it('honours a name search case-insensitively', async () => {
    const { repo } = setup();
    const result = await repo.searchForAdmin('acme', 50);
    expect(result.data).toEqual([{ user_id: 'u-1', company_name: 'Acme Coaching' }]);
  });

  it('treats % as a literal character', async () => {
    const { fake, repo } = setup();
    const result = await repo.searchForAdmin('50%', 50);
    expect(result.data?.map((r) => r.user_id)).toEqual(['u-2']);
    expect(fake.queries[0].filters).toEqual([{ op: 'ilike', column: 'company_name', value: '%50\\%%' }]);
  });

  it('treats _ as a literal character', async () => {
    const { repo } = setup();
    const result = await repo.searchForAdmin('snake_case', 50);
    expect(result.data?.map((r) => r.user_id)).toEqual(['u-4']);
  });

  it('treats \\ as a literal character', async () => {
    const { repo } = setup();
    const result = await repo.searchForAdmin('k\\s', 50);
    expect(result.data?.map((r) => r.user_id)).toEqual(['u-6']);
  });

  it('never builds an or() filter, even for commas and parentheses', async () => {
    const { fake, repo } = setup();
    const result = await repo.searchForAdmin('Beta, (Parens)', 50);
    expect(result.data?.map((r) => r.user_id)).toEqual(['u-8']);
    expect(fake.queries[0].filters.some((f) => f.op === 'or')).toBe(false);
  });

  it('caps the result at 50', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ user_id: `u-${i}`, company_name: `Biz ${String(i).padStart(2, '0')}` }));
    const { fake, repo } = setup(many);
    const result = await repo.searchForAdmin(undefined, 500);
    expect(result.data).toHaveLength(BUSINESS_SEARCH_MAX_LIMIT);
    expect(fake.queries[0].limit).toBe(50);
  });

  it('returns an error without throwing', async () => {
    const fake = createFakeSupabase({ throwWhen: () => true });
    const repo = new BusinessProfileRepository(fake.client as unknown as SupabaseClient);
    const result = await repo.searchForAdmin('x', 50);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});
