/**
 * `findOpenPeriodsForBooking` and `cancelStagesByIds` — the read and the close
 * that `stopBookingPlan` uses, and the two filters that must never drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH HALVES OF A PAIR ARE ASSERTED HERE, because the pair is the mechanism:
 * the read returns the periods whose invoices the caller then voids one by one,
 * and the close writes `cancelled` over exactly those ids. If either end drifts,
 * the close stops agreeing with the voids and a period is cancelled with its
 * invoice left standing at the client — or voided with its period left owed.
 *
 * Two assertions here are about what the queries must NOT contain, and they are
 * the ones with teeth:
 *
 *   · `findOpenPeriodsForBooking` must apply NO `subscription_id` filter. Its
 *     sibling `cancelOpenStagesForBooking` applies `is('subscription_id', null)`,
 *     so "make them consistent" is the obvious tidy-up — and it would silently
 *     stop closing the periods of a STOPPED subscription, which are exactly the
 *     ones that reach this path.
 *   · `cancelStagesByIds` must scope by `in('id', …)` and NOT by `booking_id`.
 *     Re-deriving the rows from the booking would catch a period written
 *     between the read and the close, cancelling it with no invoice voided.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';

interface Calls {
  table?: string;
  select?: string;
  update?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown]>;
  nots: Array<[string, string, unknown]>;
  is: Array<[string, unknown]>;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], ins: [], nots: [], is: [] };
  const resolved = { data: result.data ?? null, error: result.error ?? null };

  const builder: any = {
    select: jest.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    update: jest.fn((row: Record<string, unknown>) => {
      calls.update = row;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return builder;
    }),
    in: jest.fn((col: string, val: unknown) => {
      calls.ins.push([col, val]);
      return builder;
    }),
    not: jest.fn((col: string, op: string, val: unknown) => {
      calls.nots.push([col, op, val]);
      return builder;
    }),
    /* Recorded although neither method may use it — that is the point. */
    is: jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      return builder;
    }),
    /* Both methods await the chain itself: the read after its filters, the
       update after `.eq('user_id')` with no terminal `.select()`. */
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

const BOOKING = 'booking-1';
const USER = 'owner-1';

describe('PaymentPlanRepository.findOpenPeriodsForBooking', () => {
  it('applies NO subscription_id filter', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findOpenPeriodsForBooking(BOOKING, USER);

    /*
     * The periods of a stopped subscription reach this read and must be closed.
     * `cancelOpenStagesForBooking` filters them out; this must not.
     */
    expect(calls.is).toEqual([]);
  });

  it('scopes to the owner and the booking', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findOpenPeriodsForBooking(BOOKING, USER);

    expect(calls.table).toBe('payment_plan_installments');
    // Rule 4. Without it, one owner's stop closes another's periods.
    expect(calls.eqs).toContainEqual(['user_id', USER]);
    expect(calls.eqs).toContainEqual(['booking_id', BOOKING]);
  });

  it('leaves the settled periods alone, and only those', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findOpenPeriodsForBooking(BOOKING, USER);

    /*
     * `paid` records money that arrived; `cancelled` is already done. A
     * `billed` period — invoice raised, nobody paid — is still owed and must
     * come back, which is why this is `not in (paid,cancelled)` and not
     * `eq('status','pending')`.
     */
    expect(calls.nots).toContainEqual(['status', 'in', '(paid,cancelled)']);
  });

  it('reads the invoice id and the period number, which the caller needs', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findOpenPeriodsForBooking(BOOKING, USER);

    /* `invoice_id` is what gets voided; `installment_number` only ever reaches
       a log line naming which period could not be voided. */
    expect(calls.select).toBe('id, invoice_id, installment_number');
  });

  it('returns the rows for the caller to void one by one', async () => {
    const rows = [
      { id: 'p2', invoice_id: null, installment_number: 2 },
      { id: 'p3', invoice_id: 'inv-3', installment_number: 3 },
    ];
    const { client } = mockSupabase({ data: rows });

    const { data } = await new PaymentPlanRepository(client).findOpenPeriodsForBooking(
      BOOKING,
      USER
    );

    expect(data).toEqual(rows);
  });

  it('reports a failed read as an error, not as nothing owed', async () => {
    /* The distinction that matters: "nothing owed" makes the caller return
       `ok: true` and write nothing, which would report a plan as stopped
       while every period stayed open. */
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await new PaymentPlanRepository(client).findOpenPeriodsForBooking(
      BOOKING,
      USER
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PaymentPlanRepository.cancelStagesByIds', () => {
  it('closes exactly the ids given, and never re-derives them from the booking', async () => {
    const { client, calls } = mockSupabase({ data: null });

    await new PaymentPlanRepository(client).cancelStagesByIds(['p2', 'p3'], USER, {
      reason: 'client_stopped',
    });

    expect(calls.ins).toContainEqual(['id', ['p2', 'p3']]);
    // Rule 4, kept on the write as well as the read.
    expect(calls.eqs).toContainEqual(['user_id', USER]);
    /*
     * A `booking_id` scope here would catch a period written between the read
     * and the close — cancelled, with no invoice voided for it.
     */
    expect(calls.eqs.map(([col]) => col)).not.toContain('booking_id');
  });

  it('writes the cancellation the owner gave, and stamps who did it', async () => {
    const { client, calls } = mockSupabase({ data: null });

    await new PaymentPlanRepository(client).cancelStagesByIds(['p2'], USER, {
      reason: 'client_stopped',
      note: 'they called it off',
    });

    expect(calls.update).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'client_stopped',
      cancel_note: 'they called it off',
      cancelled_by: 'owner',
    });
  });

  it('clears next_retry_at, or the scheduler chases a cancelled period', async () => {
    const { client, calls } = mockSupabase({ data: null });

    await new PaymentPlanRepository(client).cancelStagesByIds(['p2'], USER, {
      reason: 'client_stopped',
    });

    expect(calls.update).toHaveProperty('next_retry_at', null);
  });

  it('issues no query at all for an empty list', async () => {
    /* `in.()` is rejected by PostgREST, and nothing to close is not an error. */
    const { client, calls } = mockSupabase({ data: null });

    const { error } = await new PaymentPlanRepository(client).cancelStagesByIds([], USER, {
      reason: 'client_stopped',
    });

    expect(calls.table).toBeUndefined();
    expect(error).toBeNull();
  });

  it('answers with nothing, because the caller already has the count', async () => {
    const { client, calls } = mockSupabase({ data: null });

    const { data, error } = await new PaymentPlanRepository(client).cancelStagesByIds(
      ['p2'],
      USER,
      { reason: 'client_stopped' }
    );

    expect(data).toBeNull();
    expect(error).toBeNull();
    /* No terminal `.select()`: adding one to get a count would change what the
       write returns for a caller that does not read it. */
    expect(calls.select).toBeUndefined();
  });

  it('reports a failed close as an error', async () => {
    /* The caller must be able to tell "closed" from "voided but still owed" —
       it reports the voided count and a failure, not `ok: true`. */
    const { client } = mockSupabase({ error: new Error('db down') });

    const { error } = await new PaymentPlanRepository(client).cancelStagesByIds(['p2'], USER, {
      reason: 'client_stopped',
    });

    expect(error).toBeInstanceOf(Error);
  });
});
