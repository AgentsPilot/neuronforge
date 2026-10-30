/**
 * Unit tests for `AgentRepository.existsWithTag`, added with the method
 * (CLAUDE.md requires a unit test for each new repository method).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FILTERS ARE ASSERTED ONE BY ONE RATHER THAN "IT RETURNS TRUE".
 *
 * This method replaced a query that `ChannelPerformanceService` ran directly
 * against `supabaseServer`, wrapped in `catch { return false }`. Every one of
 * its three filters fails silently if dropped:
 *
 *   - no `user_id`  → one business's card reports another's mailbox channel
 *   - no `tags`     → every business with any agent gets a mailbox row
 *   - no `deleted_at` → a deleted channel goes on being reported as connected
 *
 * None of those changes the SHAPE of the answer, so a test that only checks the
 * boolean passes on all three. A mutation that dropped `.eq('booking_id')` from
 * a read elsewhere in this codebase passed its whole suite for exactly this
 * reason, which is the precedent these assertions exist to avoid repeating.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentRepository } from '@/lib/repositories/AgentRepository';

/** Mocks the chained shape `.from(t).select(c, o).eq().contains().is()`. */
function mockSupabase(count: number | null, error: any = null) {
  const calls: {
    table?: string;
    select?: [string, unknown];
    eqs: Array<[string, unknown]>;
    contains: Array<[string, unknown]>;
    is: Array<[string, unknown]>;
  } = { eqs: [], contains: [], is: [] };

  const builder: any = {
    select: jest.fn((cols: string, opts: unknown) => {
      calls.select = [cols, opts];
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return builder;
    }),
    contains: jest.fn((col: string, val: unknown) => {
      calls.contains.push([col, val]);
      return builder;
    }),
    /* The terminal link: `.is()` is the last filter, so this is what resolves. */
    is: jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      return Promise.resolve({ count, error });
    }),
  };

  const client = {
    from: jest.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('AgentRepository.existsWithTag', () => {
  it('asks the agents table for a head count, fetching no rows', async () => {
    const { client, calls } = mockSupabase(1);
    const repo = new AgentRepository(client);

    await repo.existsWithTag('u1', 'inbox-enquiries');

    expect(calls.table).toBe('agents');
    /* `head: true` with an exact count: the caller wants "any?", and pulling
       rows back to answer it would be a needless transfer on every card. */
    expect(calls.select).toEqual(['id', { count: 'exact', head: true }]);
  });

  it('scopes to the owner, the tag, and the undeleted', async () => {
    const { client, calls } = mockSupabase(1);
    const repo = new AgentRepository(client);

    await repo.existsWithTag('u1', 'inbox-enquiries');

    // Mandatory owner scoping (CLAUDE.md Rule 4).
    expect(calls.eqs).toEqual([['user_id', 'u1']]);
    // Containment, not equality: an agent carries several tags.
    expect(calls.contains).toEqual([['tags', ['inbox-enquiries']]]);
    /*
     * `deleted_at IS NULL`, NOT `status != 'deleted'`. Both columns exist on
     * this table and the two are not equivalent — this is the filter the
     * original query used and the one a soft delete actually writes.
     */
    expect(calls.is).toEqual([['deleted_at', null]]);
  });

  it('is true when at least one agent carries the tag', async () => {
    const { client } = mockSupabase(1);
    const { data, error } = await new AgentRepository(client).existsWithTag('u1', 't');

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('is false when none does, and for a null count', async () => {
    const zero = await new AgentRepository(mockSupabase(0).client).existsWithTag('u1', 't');
    expect(zero).toEqual({ data: false, error: null });

    /* PostgREST can answer with no count at all; that is "none", not a crash. */
    const nullish = await new AgentRepository(mockSupabase(null).client).existsWithTag('u1', 't');
    expect(nullish).toEqual({ data: false, error: null });
  });

  it('reports a failure as an error with NO data, never as false', async () => {
    /*
     * The whole reason this returns `{ data, error }` instead of a bare
     * boolean. `false` would tell the caller "no mailbox channel" when the
     * truth is "the question could not be asked" — and the caller that most
     * needs this is the one that treats not-knowing as not-having. It is
     * entitled to make that choice; it is not entitled to be unable to tell.
     */
    const { client } = mockSupabase(null, new Error('agents unreadable'));

    const { data, error } = await new AgentRepository(client).existsWithTag('u1', 't');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(data).not.toBe(false);
  });
});
