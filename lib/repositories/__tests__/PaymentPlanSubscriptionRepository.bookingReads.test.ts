/**
 * The two booking reads on `PaymentPlanSubscriptionRepository`, and the one
 * difference between them that matters.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `findLiveForBooking` answers "is this client still being CHARGED".
 * `findAnyForBooking` answers "is ANY plan row attached, live or finished".
 *
 * They are two methods rather than one with a `liveOnly` flag because the
 * caller that confuses them does so silently and expensively:
 *
 *   - `cancelBooking` needs the live-only filter. Without it the read could
 *     match an old stopped plan alongside a live one, and `maybeSingle()` would
 *     throw — reporting "no plan" on precisely the booking that has two.
 *
 *   - `deleteBooking` must NOT filter. `booking_id` is ON DELETE RESTRICT and
 *     RESTRICT counts any row. A live-only filter there lets a booking with a
 *     stopped plan through to a delete the database then rejects — and that
 *     refusal arrives after the invoices are voided and deleted, the calendar
 *     event is gone and the client has been emailed that their appointment is
 *     cancelled, for a booking that then survives.
 *
 * So the status filter is asserted directly, in both directions. Nothing about
 * the SHAPE of either answer changes if the filter is wrong, which is why a
 * test on the returned value alone would pass either way.
 *
 * These are also the first unit tests this repository could have: it held
 * `supabaseServer` as a field with no constructor, so there was no seam.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';

interface Recorded {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  nots: Array<[string, string, unknown]>;
  limits: number[];
  maybeSingleCalled: boolean;
}

function mockSupabase(row: unknown, error: unknown = null) {
  const calls: Recorded = { eqs: [], nots: [], limits: [], maybeSingleCalled: false };

  const builder: any = {
    select: jest.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return builder;
    }),
    not: jest.fn((col: string, op: string, val: unknown) => {
      calls.nots.push([col, op, val]);
      return builder;
    }),
    limit: jest.fn((n: number) => {
      calls.limits.push(n);
      return builder;
    }),
    maybeSingle: jest.fn(() => {
      calls.maybeSingleCalled = true;
      return Promise.resolve({ data: row, error });
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

const LIVE_ROW = {
  id: 'plan-1',
  status: 'active',
  installment_count: 11,
  periods_paid: 4,
  next_charge_at: '2026-11-01T00:00:00Z',
};

describe('PaymentPlanSubscriptionRepository.findLiveForBooking', () => {
  it('excludes the finished statuses, so at most one row can match', async () => {
    const { client, calls } = mockSupabase(LIVE_ROW);

    await new PaymentPlanSubscriptionRepository(client).findLiveForBooking('b1', 'u1');

    expect(calls.table).toBe('payment_plan_subscriptions');
    /*
     * Derived from `PLAN_STOPPED_STATUSES`, not retyped, so this cannot drift
     * from what `cancelPlan` considers finished.
     */
    expect(calls.nots).toEqual([['status', 'in', '(completed,cancelled)']]);
    /* Safe only BECAUSE of that filter — the partial unique index
       `idx_plan_subs_one_live_per_booking` allows one row per booking in
       exactly those statuses. */
    expect(calls.maybeSingleCalled).toBe(true);
  });

  it('asks for installment_count and NEVER periods_total', async () => {
    const { client, calls } = mockSupabase(LIVE_ROW);

    await new PaymentPlanSubscriptionRepository(client).findLiveForBooking('b1', 'u1');

    /*
     * `periods_total` does not exist on this table. One unknown name makes
     * PostgREST reject the WHOLE select, so a typo here would report every
     * cancelled booking as having no live plan — the silent-nothing failure
     * this codebase has been bitten by before.
     */
    expect(calls.select).toContain('installment_count');
    expect(calls.select).not.toContain('periods_total');
  });

  it('scopes to the booking and its owner', async () => {
    const { client, calls } = mockSupabase(LIVE_ROW);

    await new PaymentPlanSubscriptionRepository(client).findLiveForBooking('b1', 'u1');

    expect(calls.eqs).toEqual([
      ['user_id', 'u1'],
      ['booking_id', 'b1'],
    ]);
  });

  it('returns the row, and null when there is none', async () => {
    const found = await new PaymentPlanSubscriptionRepository(
      mockSupabase(LIVE_ROW).client
    ).findLiveForBooking('b1', 'u1');
    expect(found).toEqual({ data: LIVE_ROW, error: null });

    const none = await new PaymentPlanSubscriptionRepository(
      mockSupabase(null).client
    ).findLiveForBooking('b1', 'u1');
    expect(none).toEqual({ data: null, error: null });
  });

  it('reports a failed read as an error rather than as "no plan"', async () => {
    const { client } = mockSupabase(null, new Error('db down'));

    const { data, error } = await new PaymentPlanSubscriptionRepository(client).findLiveForBooking(
      'b1',
      'u1'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PaymentPlanSubscriptionRepository.findAnyForBooking', () => {
  it('applies NO status filter at all', async () => {
    /*
     * THE ASSERTION THIS FILE EXISTS FOR.
     *
     * `ON DELETE RESTRICT` counts any row, finished included. A status filter
     * creeping in here would let a booking with a stopped plan through to a
     * delete the database then rejects, after the invoices, the calendar event
     * and the client email are already gone.
     */
    const { client, calls } = mockSupabase({ id: 'plan-1', status: 'cancelled' });

    await new PaymentPlanSubscriptionRepository(client).findAnyForBooking('b1', 'u1');

    expect(calls.nots).toEqual([]);
  });

  it('finds a FINISHED plan, which is the whole point', async () => {
    const { client } = mockSupabase({ id: 'plan-1', status: 'cancelled' });

    const { data } = await new PaymentPlanSubscriptionRepository(client).findAnyForBooking(
      'b1',
      'u1'
    );

    expect(data).toEqual({ id: 'plan-1', status: 'cancelled' });
  });

  it('scopes to the booking and its owner, and takes at most one row', async () => {
    const { client, calls } = mockSupabase(null);

    await new PaymentPlanSubscriptionRepository(client).findAnyForBooking('b1', 'u1');

    expect(calls.eqs).toEqual([
      ['user_id', 'u1'],
      ['booking_id', 'b1'],
    ]);
    /* `limit(1)` is what keeps `maybeSingle` safe without a status filter: more
       than one row is expected here and must not throw. */
    expect(calls.limits).toEqual([1]);
  });

  it('reports a failed read as an error, so the caller can refuse the delete', async () => {
    const { client } = mockSupabase(null, new Error('db down'));

    const { data, error } = await new PaymentPlanSubscriptionRepository(client).findAnyForBooking(
      'b1',
      'u1'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
