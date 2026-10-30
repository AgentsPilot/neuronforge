/**
 * The four booking-scoped quote methods, and the filters that are the whole
 * safety of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, written plainly because the gap it closes was real.
 *
 * These four methods were lifted out of `BookingLifecycleService`, where they
 * had been inline `supabaseServer` queries. QA mutation-tested the result and
 * found that **six** of the moved methods had no unit test at all: it could
 * delete `.eq('user_id', userId)` from four of them, and
 * `.eq('status','accepted')` from `stopAccepted`, and 852 tests across 38
 * suites stayed green. Two of those mutations are cross-tenant WRITES to
 * `proposals`.
 *
 * Nothing about the shape of any answer changes when a filter is dropped, which
 * is exactly why a test on the returned value passes either way. So every
 * filter is asserted by name, one at a time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProposalRepository } from '@/lib/repositories/ProposalRepository';

interface Chain {
  table: string;
  update?: Record<string, unknown>;
  select?: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown]>;
  nots: Array<[string, string, unknown]>;
}

/**
 * One recorder per `.from()`, because `findAcceptedForBooking` issues TWO
 * chains and the difference between them is the point of it.
 *
 * Every builder method returns the builder and the builder is thenable, so the
 * same fake serves a read that ends on its last filter and a write that ends on
 * `.select()`.
 */
function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const chains: Chain[] = [];
  const resolved = { data: result.data ?? [], error: result.error ?? null };

  const client = {
    from: jest.fn((table: string) => {
      const chain: Chain = { table, eqs: [], ins: [], nots: [] };
      chains.push(chain);

      const builder: any = {
        select: jest.fn((cols?: string) => {
          chain.select = cols;
          return builder;
        }),
        update: jest.fn((payload: Record<string, unknown>) => {
          chain.update = payload;
          return builder;
        }),
        eq: jest.fn((col: string, val: unknown) => {
          chain.eqs.push([col, val]);
          return builder;
        }),
        in: jest.fn((col: string, val: unknown) => {
          chain.ins.push([col, val]);
          return builder;
        }),
        not: jest.fn((col: string, op: string, val: unknown) => {
          chain.nots.push([col, op, val]);
          return builder;
        }),
        then: (resolve: (v: unknown) => unknown) => resolve(resolved),
      };
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, chains };
}

const repo = (client: SupabaseClient) => new ProposalRepository(client);

describe('ProposalRepository.findAcceptedForBooking', () => {
  it('asks on BOTH booking columns, each scoped to the owner and to accepted', async () => {
    const { client, chains } = mockSupabase({ data: [] });

    await repo(client).findAcceptedForBooking('b1', 'u1');

    /*
     * Two equality reads rather than one `.or()`, because the caller must stop
     * them by id: PostgREST rejects an `or` filter on an UPDATE.
     */
    expect(chains).toHaveLength(2);
    expect(chains.map(c => c.table)).toEqual(['proposals', 'proposals']);

    const columns = chains.map(c => c.eqs.map(([col]) => col));
    // `booking_id` is the job the quote was written for; `package_booking_id`
    // is the package its acceptance created. Either should find it.
    expect(columns[0]).toContain('booking_id');
    expect(columns[1]).toContain('package_booking_id');

    for (const chain of chains) {
      // Rule 4, on both halves. Dropping it here is a cross-tenant READ whose
      // ids are then fed straight into an `.in('id', …)` UPDATE.
      expect(chain.eqs).toContainEqual(['user_id', 'u1']);
      expect(chain.eqs).toContainEqual(['status', 'accepted']);
    }
  });

  it('de-duplicates a quote that matches on both columns', async () => {
    // Both reads return the same row; `id` is what collapses it.
    const { client } = mockSupabase({ data: [{ id: 'q1', package_booking_id: 'pkg-1' }] });

    const { data } = await repo(client).findAcceptedForBooking('b1', 'u1');

    expect(data).toEqual([{ id: 'q1', package_booking_id: 'pkg-1' }]);
  });

  it('fails closed when either read errors, rather than stopping half the quotes', async () => {
    /*
     * A behaviour change from the inline version, and deliberate: that one
     * carried on with whatever the surviving read returned, so a failure on the
     * `package_booking_id` half silently stopped a package's quote and left the
     * job's. One error now means no ids, so nothing is stopped on a partial
     * picture.
     */
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await repo(client).findAcceptedForBooking('b1', 'u1');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ProposalRepository.stopAccepted', () => {
  it('stops by id, for the owner, and ONLY an accepted quote', async () => {
    const { client, chains } = mockSupabase({ data: [{ id: 'q1', package_booking_id: null }] });

    await repo(client).stopAccepted(['q1', 'q2'], 'u1', { reason: 'client_not_paying' });

    const [chain] = chains;
    expect(chain.ins).toEqual([['id', ['q1', 'q2']]]);
    expect(chain.eqs).toContainEqual(['user_id', 'u1']);
    /*
     * THE CONDITION THAT DOES THREE THINGS: makes a second press a no-op
     * instead of rewriting `stopped_at`; refuses a quote that was never agreed
     * (`withdraw` owns those); and cannot clobber `declined`, `expired`,
     * `withdrawn` or `superseded`.
     */
    expect(chain.eqs).toContainEqual(['status', 'accepted']);
  });

  it('records the reason, and trims a whitespace-only note to null', async () => {
    const { client, chains } = mockSupabase({ data: [] });

    await repo(client).stopAccepted(['q1'], 'u1', { reason: 'client_not_paying', note: '   ' });

    expect(chains[0].update).toMatchObject({
      status: 'stopped',
      stop_reason: 'client_not_paying',
      // An empty textarea must not store '' and read as a note that exists but
      // says nothing.
      stop_note: null,
    });
    expect(typeof chains[0].update!.stopped_at).toBe('string');
  });

  it('returns package_booking_id, so the work the quote SOLD can be stopped with it', async () => {
    const rows = [{ id: 'q1', package_booking_id: 'pkg-1' }];
    const { client, chains } = mockSupabase({ data: rows });

    const { data } = await repo(client).stopAccepted(['q1'], 'u1', {});

    expect(data).toEqual(rows);
    expect(chains[0].select).toContain('package_booking_id');
  });

  it('writes nothing at all for an empty id list', async () => {
    // Not a no-op by accident: an unfiltered `.in('id', [])` is a statement
    // nobody wants to reason about on the proposals table.
    const { client, chains } = mockSupabase({ data: [] });

    const { data, error } = await repo(client).stopAccepted([], 'u1', {});

    expect(chains).toHaveLength(0);
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('reports a failed write as an error', async () => {
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await repo(client).stopAccepted(['q1'], 'u1', {});

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ProposalRepository.findPackageQuotesForBooking', () => {
  it('looks up by booking_id ALONE, for the owner, where a package was sold', async () => {
    const { client, chains } = mockSupabase({ data: [] });

    await repo(client).findPackageQuotesForBooking('b1', 'u1');

    const [chain] = chains;
    // Rule 4. Dropping it is a cross-tenant read driving the package cascade.
    expect(chain.eqs).toContainEqual(['user_id', 'u1']);
    expect(chain.eqs).toContainEqual(['booking_id', 'b1']);
    /*
     * `booking_id` ONLY, and never `package_booking_id`: that is the direction
     * the cascade runs. Cancelling the package itself must find no quote by
     * this column, which is what keeps the cascade from recursing.
     */
    expect(chain.eqs.map(([col]) => col)).not.toContain('package_booking_id');
    expect(chain.nots).toEqual([['package_booking_id', 'is', null]]);
  });

  it('reports a failed read as an error rather than as "no packages"', async () => {
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await repo(client).findPackageQuotesForBooking('b1', 'u1');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ProposalRepository.withdrawOpenForBooking', () => {
  it('withdraws only the OPEN quotes of this booking, for the owner', async () => {
    const { client, chains } = mockSupabase({ data: [{ id: 'q1' }, { id: 'q2' }] });

    await repo(client).withdrawOpenForBooking('b1', 'u1');

    const [chain] = chains;
    expect(chain.update).toMatchObject({ status: 'withdrawn' });
    // Rule 4. Dropping it is a cross-tenant WRITE.
    expect(chain.eqs).toContainEqual(['user_id', 'u1']);
    expect(chain.eqs).toContainEqual(['booking_id', 'b1']);
    /*
     * THE STATUS FILTER IS WHAT PROTECTS AN ACCEPTED QUOTE. Money was created
     * against an accepted one, so it is deliberately not withdrawable —
     * `stopAccepted` is its path. Without this filter, cancelling a booking
     * would withdraw a quote the client had already agreed and paid against.
     */
    expect(chain.ins).toEqual([['status', ['draft', 'sent', 'viewed']]]);
  });

  it('answers with the ids it withdrew, which is what the caller counts', async () => {
    const { client } = mockSupabase({ data: [{ id: 'q1' }, { id: 'q2' }] });

    const { data } = await repo(client).withdrawOpenForBooking('b1', 'u1');

    expect(data).toEqual(['q1', 'q2']);
  });

  it('reports a failed write as an error', async () => {
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await repo(client).withdrawOpenForBooking('b1', 'u1');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
