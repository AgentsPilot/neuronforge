/**
 * `findStopTarget` — the ownership read that runs before a quote is stopped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS IS A DISTINCTION, not a permission. The update that follows
 * is scoped by `user_id` too, so naming a stranger's quote id writes nothing
 * either way. Without this read it reports SUCCESS — "there was nothing left to
 * stop" — where the truth is "that is not yours". One is a quote already
 * handled; the other is someone probing ids.
 *
 * And it is not `findById`. That is `select('*')` on a table whose rows carry
 * `accepted_snapshot` and every frozen tax field, pulled on a path that reads
 * one column.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProposalRepository } from '@/lib/repositories/ProposalRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  maybeSingle: boolean;
  single: boolean;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], maybeSingle: false, single: false };
  const resolved = { data: result.data ?? null, error: result.error ?? null };

  const builder: any = {
    select: jest.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return builder;
    }),
    maybeSingle: jest.fn(async () => {
      calls.maybeSingle = true;
      return resolved;
    }),
    /* Recorded so that swapping the terminal is a visible change, not a silent one. */
    single: jest.fn(async () => {
      calls.single = true;
      return resolved;
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

const PROPOSAL = 'prop-1';
const USER = 'owner-1';

const QUOTE = {
  id: PROPOSAL,
  user_id: USER,
  booking_id: 'booking-1',
  status: 'accepted',
  title: 'Renovation',
};

describe('ProposalRepository.findStopTarget', () => {
  it('reads the quote scoped to its owner', async () => {
    const { client, calls } = mockSupabase({ data: QUOTE });

    await new ProposalRepository(client).findStopTarget(PROPOSAL, USER);

    expect(calls.table).toBe('proposals');
    expect(calls.eqs).toContainEqual(['id', PROPOSAL]);
    expect(calls.eqs).toContainEqual(['user_id', USER]);
  });

  it('asks for five named columns, never the whole row', async () => {
    const { client, calls } = mockSupabase({ data: QUOTE });

    await new ProposalRepository(client).findStopTarget(PROPOSAL, USER);

    expect(calls.select).toBe('id, user_id, booking_id, status, title');
    expect(calls.select).not.toBe('*');
  });

  it('uses maybeSingle, so a quote that is not there is not an exception', async () => {
    const { client, calls } = mockSupabase({ data: null });

    await new ProposalRepository(client).findStopTarget(PROPOSAL, USER);

    /*
     * `.single()` throws on no rows, which on this path would turn "not yours"
     * into a 500 instead of the NOT_FOUND the caller returns.
     */
    expect(calls.maybeSingle).toBe(true);
    expect(calls.single).toBe(false);
  });

  it('returns null for a quote this owner does not have', async () => {
    const { client } = mockSupabase({ data: null });

    const { data, error } = await new ProposalRepository(client).findStopTarget(PROPOSAL, USER);

    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('keeps a failed read distinguishable from a missing quote', async () => {
    const { client } = mockSupabase({ error: new Error('boom') });

    const { data, error } = await new ProposalRepository(client).findStopTarget(PROPOSAL, USER);

    /*
     * Both end in NOT_FOUND for the caller, but only one of them should ever
     * appear in the log — and the caller logs on `error`, not on `!data`.
     */
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });

  it('carries booking_id, which is the one column the caller actually uses', async () => {
    const { client } = mockSupabase({ data: QUOTE });

    const { data } = await new ProposalRepository(client).findStopTarget(PROPOSAL, USER);

    /*
     * The loose-invoice sweep is gated on it: a quote with no booking has no
     * invoice raised outside its stages, so there is nothing for that sweep to
     * find. Dropping this column would switch the sweep off for every quote.
     */
    expect(data?.booking_id).toBe('booking-1');
  });
});
