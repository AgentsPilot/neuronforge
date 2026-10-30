/**
 * The two narrow reads the booking-cancellation path needs, and their scopes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Both were lifted out of `BookingLifecycleService`, where they had been inline
 * `supabaseServer` queries. QA mutation-tested the result and could drop
 * `.eq('user_id', userId)` from each of them — and narrow
 * `findCancellationState` to `status` alone — with 852 tests across 38 suites
 * still green. Nothing named either method anywhere.
 *
 * `findSaleMode`'s scope is the sharper of the two, because it is this change's
 * OWN Rule 4 tightening: the query it replaced read `scheduling_services` by
 * `id` with no owner filter at all. A mutation undoing that would put the
 * codebase back where it started, silently.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SchedulingServiceRepository,
  SchedulingBookingRepository,
} from '@/lib/repositories/SchedulingRepository';

interface Chain {
  table: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  maybeSingle: boolean;
  single: boolean;
}

function mockSupabase(row: unknown, error: unknown = null) {
  const chains: Chain[] = [];

  const client = {
    from: jest.fn((table: string) => {
      const chain: Chain = { table, eqs: [], maybeSingle: false, single: false };
      chains.push(chain);

      const builder: any = {
        select: jest.fn((cols?: string) => {
          chain.select = cols;
          return builder;
        }),
        eq: jest.fn((col: string, val: unknown) => {
          chain.eqs.push([col, val]);
          return builder;
        }),
        maybeSingle: jest.fn(() => {
          chain.maybeSingle = true;
          return Promise.resolve({ data: row, error });
        }),
        single: jest.fn(() => {
          chain.single = true;
          return Promise.resolve({ data: row, error });
        }),
      };
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, chains };
}

describe('SchedulingServiceRepository.findSaleMode', () => {
  it('reads sale_mode for this service AND this owner', async () => {
    const { client, chains } = mockSupabase({ sale_mode: 'proposal' });

    await new SchedulingServiceRepository(client).findSaleMode('svc-1', 'u1');

    const [chain] = chains;
    expect(chain.table).toBe('scheduling_services');
    expect(chain.eqs).toContainEqual(['id', 'svc-1']);
    /*
     * THE WHOLE POINT OF THIS METHOD EXISTING. The inline query it replaced
     * filtered on `id` alone (CLAUDE.md Rule 4). Losing this filter undoes the
     * tightening without changing any answer the tests look at.
     */
    expect(chain.eqs).toContainEqual(['user_id', 'u1']);
  });

  it('asks for sale_mode only, not the whole row', async () => {
    // Narrow on purpose: `findById` is `select('*')` and this runs on every
    // cancellation.
    const { client, chains } = mockSupabase({ sale_mode: 'direct' });

    await new SchedulingServiceRepository(client).findSaleMode('svc-1', 'u1');

    expect(chains[0].select).toBe('sale_mode');
  });

  it('treats a missing service as a quiet answer, not an error', async () => {
    /*
     * `maybeSingle`, not `single`. "No such service" is legitimate — the caller
     * is only deciding whether a cancellation must also reach a quote — and
     * `findById`'s `.single()` would make every such miss a thrown error and a
     * logged one.
     */
    const { client, chains } = mockSupabase(null);

    const { data, error } = await new SchedulingServiceRepository(client).findSaleMode('x', 'u1');

    expect(chains[0].maybeSingle).toBe(true);
    expect(chains[0].single).toBe(false);
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('reports a real failure as an error', async () => {
    const { client } = mockSupabase(null, new Error('db down'));

    const { data, error } = await new SchedulingServiceRepository(client).findSaleMode('x', 'u1');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('SchedulingBookingRepository.findCancellationState', () => {
  it('reads BOTH status and meeting_status', async () => {
    const { client, chains } = mockSupabase({ status: 'confirmed', meeting_status: 'cancelled' });

    await new SchedulingBookingRepository(client).findCancellationState('b1', 'u1');

    /*
     * `status` ALONE CAN MISS, and this is the assertion that pins it.
     *
     * `cancel()` writes the two together EXCEPT on a booking whose outcome was
     * already recorded, where it writes neither. So a package whose sessions
     * were all held keeps `status: 'confirmed'` after being called off — and a
     * guard reading only `status` runs the whole cancellation cascade again on
     * the next press, rewriting `outcome_at` and re-firing its side effects.
     */
    expect(chains[0].select).toContain('status');
    expect(chains[0].select).toContain('meeting_status');
  });

  it('scopes to the booking AND its owner', async () => {
    const { client, chains } = mockSupabase(null);

    await new SchedulingBookingRepository(client).findCancellationState('b1', 'u1');

    expect(chains[0].table).toBe('scheduling_bookings');
    expect(chains[0].eqs).toContainEqual(['id', 'b1']);
    // Rule 4. Dropping it is a cross-tenant read.
    expect(chains[0].eqs).toContainEqual(['user_id', 'u1']);
  });

  it('returns both columns to the caller, which owns the decision', async () => {
    const row = { status: 'confirmed', meeting_status: 'cancelled' };
    const { client } = mockSupabase(row);

    const { data } = await new SchedulingBookingRepository(client).findCancellationState('b1', 'u1');

    expect(data).toEqual(row);
  });

  it('treats a missing booking as null rather than an error', async () => {
    const { client, chains } = mockSupabase(null);

    const { data, error } = await new SchedulingBookingRepository(client).findCancellationState(
      'gone',
      'u1'
    );

    expect(chains[0].maybeSingle).toBe(true);
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('reports a real failure as an error', async () => {
    const { client } = mockSupabase(null, new Error('db down'));

    const { data, error } = await new SchedulingBookingRepository(client).findCancellationState(
      'b1',
      'u1'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
