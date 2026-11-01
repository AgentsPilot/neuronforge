/**
 * `AgentRepository.findStateByTag` — the narrow sibling of `findByTag`
 * (CLAUDE.md requires a unit test for each new repository method).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WORTH ASSERTING HERE, AND WHY IT IS THE SELECT
 *
 * `findByTag` selects `*`. The whole point of this method is that it does not —
 * a mailbox channel agent carries its ~11 KB plan in BOTH `workflow_steps` and
 * `pilot_steps`, so `*` fetched ~22 KB per mailbox to read four small fields on
 * every dashboard load. A future edit "tidying" the select back to `*`, or
 * adding a column to it, costs that again and changes nothing observable: the
 * caller reads the four fields either way and every behavioural test still
 * passes. So the column list is pinned exactly, not by `toContain`.
 *
 * The three filters are pinned for the opposite reason — each fails SILENTLY if
 * dropped, in a way no shape assertion catches:
 *
 *   · no `user_id`     → one business's card reports another's channels
 *   · no `tags`        → every agent this owner has becomes a channel
 *   · no `deleted_at`  → a deleted channel goes on being reported as connected
 *
 * `agents` DOES have `deleted_at` — unlike `crm_contacts`, which is what made
 * the same filter a phantom-column bug one layer away in
 * `ChannelAttributionRepository.findLeadsByVia`. Both facts have to stay true
 * at once, so both are pinned, in their own suites.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentRepository } from '@/lib/repositories/AgentRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  contains: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  orders: Array<[string, unknown]>;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], contains: [], is: [], orders: [] };
  const resolved = { data: result.data ?? null, error: result.error ?? null };

  /*
   * `any` (CLAUDE.md rule 6): the object is self-referential — every method
   * returns `builder` — so there is no type to annotate it with that exists
   * before it does. Same shape as the sibling `existsWithTag` suite.
   */
  const builder: any = {
    select: jest.fn((cols: string) => {
      calls.select = cols;
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
    is: jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      return builder;
    }),
    order: jest.fn((col: string, opts: unknown) => {
      calls.orders.push([col, opts]);
      return builder;
    }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(res, rej),
  };

  const client = {
    from: jest.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const USER = 'owner-1';
const TAG = 'inbox-enquiries';

describe('AgentRepository.findStateByTag', () => {
  it('fetches exactly the four columns a status surface reads, and no more', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new AgentRepository(client).findStateByTag(USER, TAG);

    expect(calls.table).toBe('agents');
    /*
     * THE POINT OF THE METHOD, as one assertion. `*` here is ~22 KB per
     * mailbox; these four are under a hundred bytes. `tags` is absent on
     * purpose — the read this replaced selected it and nothing looked at it.
     */
    expect(calls.select).toBe('id, status, agent_config, last_run');
  });

  it('scopes to this owner and this tag', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new AgentRepository(client).findStateByTag(USER, TAG);

    expect(calls.eqs).toContainEqual(['user_id', USER]);
    /* `contains`, not `eq`: `tags` is an array column and an agent carries the
       family tag beside its own provider tag. */
    expect(calls.contains).toContainEqual(['tags', [TAG]]);
  });

  it('leaves out the deleted ones', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new AgentRepository(client).findStateByTag(USER, TAG);

    /* `agents` really does have this column — the deletes here are soft. A
       surface that skipped it would keep reporting a channel its owner
       removed. */
    expect(calls.is).toContainEqual(['deleted_at', null]);
  });

  it('answers oldest first, like findByTag', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new AgentRepository(client).findStateByTag(USER, TAG);

    /*
     * Not cosmetic. A caller that keeps the FIRST row of a duplicated provider
     * is keeping the one the runner and the owner have been living with;
     * reversed, "what is it watching" would change under them for no reason
     * they did.
     */
    expect(calls.orders).toEqual([['created_at', { ascending: true }]]);
  });

  it('returns every tagged agent, not just the newest', async () => {
    const rows = [
      { id: 'a1', status: 'active', agent_config: {}, last_run: null },
      { id: 'a2', status: 'inactive', agent_config: {}, last_run: '2026-10-30T00:00:00.000Z' },
    ];
    const { client } = mockSupabase({ data: rows });

    const { data } = await new AgentRepository(client).findStateByTag(USER, TAG);

    /* A business taking enquiries at two addresses has two. Reporting one would
       leave the other running and unmonitored. */
    expect(data).toEqual(rows);
  });

  it('answers with an empty list, never null, when there are none', async () => {
    const { client } = mockSupabase({ data: null });

    const { data, error } = await new AgentRepository(client).findStateByTag(USER, TAG);

    /* The caller iterates this directly; `null` would need a guard at the
       site. */
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('reports a failed read as an error rather than as an account with no channels', async () => {
    const { client } = mockSupabase({ error: new Error('boom') });

    const { data, error } = await new AgentRepository(client).findStateByTag(USER, TAG);

    /*
     * An empty list here would be indistinguishable from an owner who has not
     * set anything up — which is precisely the shape of the bug that made every
     * inbox channel report zero leads. The caller logs this.
     */
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
