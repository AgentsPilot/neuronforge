/**
 * Unit test for OnboardingConversationRepository.getFirstMessageAt.
 *
 * Added for the Business OS entitlements repair path: when an admin creates the
 * plan row an account never got, the row must carry the TRUE start of setup,
 * because the trial clock is derived from it. Reading the newest message
 * instead of the oldest would silently move a trial.
 *
 * The repository binds `supabaseServer` at construction, so the module is
 * mocked rather than injected.
 */

const from = jest.fn();

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (...args: unknown[]) => from(...args) },
}));

import { OnboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';

interface Calls {
  table?: string;
  select?: string;
  eq?: [string, unknown];
  order?: [string, { ascending: boolean }];
  limit?: number;
}

function mockQuery(result: { data: unknown; error: unknown }) {
  const calls: Calls = {};
  // `any` is unavoidable here (CLAUDE.md rule 6): this stub models PostgREST's
  // chainable builder, whose methods return the builder itself. Reproducing
  // supabase-js's generic filter-builder types would add nothing to the three
  // assertions below.
  const builder: any = {
    select: jest.fn((cols: string) => { calls.select = cols; return builder; }),
    eq: jest.fn((c: string, v: unknown) => { calls.eq = [c, v]; return builder; }),
    order: jest.fn((c: string, o: { ascending: boolean }) => { calls.order = [c, o]; return builder; }),
    limit: jest.fn((n: number) => { calls.limit = n; return Promise.resolve(result); }),
  };
  from.mockImplementation((t: string) => { calls.table = t; return builder; });
  return calls;
}

beforeEach(() => from.mockReset());

describe('getFirstMessageAt', () => {
  it('returns the OLDEST message timestamp for the account', async () => {
    const calls = mockQuery({ data: [{ created_at: '2026-08-01T10:00:00Z' }], error: null });

    const { data, error } = await new OnboardingConversationRepository().getFirstMessageAt('acct-1');

    expect(error).toBeNull();
    expect(data).toBe('2026-08-01T10:00:00Z');
    expect(calls.table).toBe('onboarding_conversations');
    expect(calls.eq).toEqual(['user_id', 'acct-1']);
    // Ascending is the whole point: descending would be getLatestMessageAt.
    expect(calls.order).toEqual(['created_at', { ascending: true }]);
    expect(calls.limit).toBe(1);
  });

  it('returns null when the account has no transcript', async () => {
    mockQuery({ data: [], error: null });

    const { data, error } = await new OnboardingConversationRepository().getFirstMessageAt('acct-2');

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('returns the error rather than throwing', async () => {
    mockQuery({ data: null, error: new Error('boom') });

    const { data, error } = await new OnboardingConversationRepository().getFirstMessageAt('acct-3');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
