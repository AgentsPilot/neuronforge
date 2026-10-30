/**
 * The two booking-scoped instalment writes, and the filters that are the whole
 * safety of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS.
 *
 * Both writes used to be raw `supabaseServer` updates inside
 * `BookingLifecycleService`, and their scoping was asserted by capturing the
 * query builder's filters in the service's own suite. Now that they are
 * repository methods, the scope is the method signature — so the assertion that
 * those filters actually reach the query belongs here, where the query is.
 * Without this file the move would have quietly deleted a test that guards a
 * real production bug.
 *
 * `stampFirstPeriodInvoice` is the sharper of the two. The plan row is the
 * SERVICE's and is shared by every booking of it, so scoped on
 * `payment_plan_id` + `installment_number` alone this stamp would mark period 1
 * of every OTHER client's booking with this client's invoice — and `billStage`
 * would then never bill any of them, because its claim requires
 * `invoice_id IS NULL`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';

interface Recorded {
  table?: string;
  payload?: Record<string, unknown>;
  select?: string;
  eqs: Array<[string, unknown]>;
  nots: Array<[string, string, unknown]>;
  is: Array<[string, unknown]>;
}

/**
 * The update chain ends either at the last filter (`stampFirstPeriodInvoice`,
 * which does not `.select()`) or at `.select()` (`cancelOpenStagesForBooking`,
 * which needs the rows back). So the builder is awaitable AND has `.select()`.
 */
function mockSupabase(rows: unknown = [], error: unknown = null) {
  const calls: Recorded = { eqs: [], nots: [], is: [] };
  const result = { data: rows, error };

  const builder: any = {
    update: jest.fn((payload: Record<string, unknown>) => {
      calls.payload = payload;
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
    is: jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      return builder;
    }),
    select: jest.fn((cols?: string) => {
      calls.select = cols;
      return Promise.resolve(result);
    }),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };

  const client = {
    from: jest.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('PaymentPlanRepository.stampFirstPeriodInvoice', () => {
  it('stamps period 1 of THIS booking, for THIS owner', async () => {
    const { client, calls } = mockSupabase();

    await new PaymentPlanRepository(client).stampFirstPeriodInvoice(
      'plan-1',
      'booking-1',
      'owner-1',
      'inv-1'
    );

    expect(calls.table).toBe('payment_plan_installments');
    expect(calls.payload).toMatchObject({ invoice_id: 'inv-1' });
    /*
     * All four. `booking_id` is the one that stops the stamp reaching other
     * clients' bookings on the same shared plan row; `user_id` is Rule 4.
     */
    expect(calls.eqs).toContainEqual(['payment_plan_id', 'plan-1']);
    expect(calls.eqs).toContainEqual(['booking_id', 'booking-1']);
    expect(calls.eqs).toContainEqual(['installment_number', 1]);
    expect(calls.eqs).toContainEqual(['user_id', 'owner-1']);
  });

  it('stamps the FIRST period only, never a later one', async () => {
    const { client, calls } = mockSupabase();

    await new PaymentPlanRepository(client).stampFirstPeriodInvoice('p', 'b', 'u', 'i');

    const numbers = calls.eqs.filter(([col]) => col === 'installment_number');
    expect(numbers).toEqual([['installment_number', 1]]);
  });

  it('touches updated_at and nothing else', async () => {
    const { client, calls } = mockSupabase();

    await new PaymentPlanRepository(client).stampFirstPeriodInvoice('p', 'b', 'u', 'inv-9');

    expect(Object.keys(calls.payload!).sort()).toEqual(['invoice_id', 'updated_at']);
  });

  it('reports a failure instead of throwing, so the invoice still stands', async () => {
    // The money has been asked for correctly; a bookkeeping write must not
    // undo that. The caller logs this at error level because it needs a human.
    const { client } = mockSupabase([], new Error('db down'));

    const { error } = await new PaymentPlanRepository(client).stampFirstPeriodInvoice(
      'p',
      'b',
      'u',
      'i'
    );

    expect(error).toBeInstanceOf(Error);
  });
});

describe('PaymentPlanRepository.cancelOpenStagesForBooking', () => {
  it('closes only this booking owner-scoped, unsettled, non-subscription stages', async () => {
    const { client, calls } = mockSupabase([{ id: 's1', amount: 400, payment_plan_id: 'plan-1' }]);

    await new PaymentPlanRepository(client).cancelOpenStagesForBooking('booking-1', 'owner-1', {
      reason: 'client_not_paying',
      note: 'they stopped replying',
      by: 'owner',
    });

    expect(calls.eqs).toContainEqual(['user_id', 'owner-1']);
    expect(calls.eqs).toContainEqual(['booking_id', 'booking-1']);
    /*
     * EVERYTHING NOT SETTLED, including the billed ones. A stage that had been
     * billed — an invoice raised, nobody paid — stayed open on a cancelled
     * booking while this matched only `pending`, leaving the stage disagreeing
     * with its own voided invoice. `paid` is never rewritten.
     */
    expect(calls.nots).toEqual([['status', 'in', '(paid,cancelled)']]);
    /*
     * THE WHOLE SAFETY OF THE SCOPE. A subscription's projected periods are
     * real money still arriving on a live plan and are not this call's
     * business.
     */
    expect(calls.is).toEqual([['subscription_id', null]]);
  });

  it('records why, so one report can union every cancellation surface', async () => {
    const { client, calls } = mockSupabase([]);

    await new PaymentPlanRepository(client).cancelOpenStagesForBooking('b', 'u', {
      reason: 'client_not_paying',
      note: 'gone quiet',
      by: 'owner',
    });

    expect(calls.payload).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'client_not_paying',
      cancel_note: 'gone quiet',
      cancelled_by: 'owner',
      // The retry scheduler reads this; a cancelled period must not be retried.
      next_retry_at: null,
    });
  });

  it('defaults the owner and leaves an absent reason null rather than inventing one', async () => {
    const { client, calls } = mockSupabase([]);

    await new PaymentPlanRepository(client).cancelOpenStagesForBooking('b', 'u');

    expect(calls.payload).toMatchObject({
      cancel_reason: null,
      cancel_note: null,
      cancelled_by: 'owner',
    });
  });

  it('returns the rows, because the caller must bring the plan into line', async () => {
    /*
     * `payment_plans.total_amount` and `installment_count` are stored, not
     * derived. The caller lowers them from these rows, so a count would not do
     * — which is why this is not `cancelInstallments`.
     */
    const rows = [
      { id: 's1', amount: 400, payment_plan_id: 'plan-1' },
      { id: 's2', amount: 400, payment_plan_id: 'plan-1' },
    ];
    const { client, calls } = mockSupabase(rows);

    const { data } = await new PaymentPlanRepository(client).cancelOpenStagesForBooking(
      'b',
      'u'
    );

    expect(data).toEqual(rows);
    expect(calls.select).toContain('amount');
    expect(calls.select).toContain('payment_plan_id');
  });

  it('reports a failure as an error with no rows', async () => {
    const { client } = mockSupabase([], new Error('db down'));

    const { data, error } = await new PaymentPlanRepository(client).cancelOpenStagesForBooking(
      'b',
      'u'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
