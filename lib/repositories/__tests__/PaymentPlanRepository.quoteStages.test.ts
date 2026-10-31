/**
 * `findBilledStagesForProposal` and `cancelOpenStagesForProposal` — the read and
 * the close that `cancelQuoteStages` uses for a MILESTONE QUOTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `proposal_id` AND NOT `booking_id`. A quote raised from the CRM rather
 * than from an appointment has `booking_id: null`, and a milestone quote has no
 * subscription — so neither `cancelBooking` (by booking) nor `cancelPlan` (by
 * subscription) can see its stages. `proposal_id` is the one column they always
 * carry. Dropping it from either query here does not narrow the result, it
 * WIDENS it: every stage of every quote this owner has.
 *
 * Both halves of the pair are asserted, because the pair is the mechanism — the
 * read finds the invoices to void, the close writes `cancelled` over what is
 * left. Two assertions are about what must be PRESENT and are the ones with
 * teeth:
 *
 *   · `is('subscription_id', null)` on BOTH. Without it a live plan's projected
 *     periods are cancelled — real money still arriving, and the books would say
 *     it is not. This is the exclusion that lets the quote path and the booking
 *     path be scoped loosely without colliding.
 *   · `not('status', 'in', '(paid,cancelled)')` on the close, NOT
 *     `eq('status', 'pending')`. That narrower filter is what this query used to
 *     carry, and it left stage 2 of a stopped quote reading `billed` beside its
 *     own voided invoice.
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
    is: jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
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

const PROPOSAL = 'prop-1';
const USER = 'owner-1';

describe('PaymentPlanRepository.findBilledStagesForProposal', () => {
  it('scopes to the owner and the quote, and excludes subscription periods', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findBilledStagesForProposal(PROPOSAL, USER);

    expect(calls.table).toBe('payment_plan_installments');
    expect(calls.select).toBe('id, invoice_id');
    expect(calls.eqs).toContainEqual(['user_id', USER]);
    expect(calls.eqs).toContainEqual(['proposal_id', PROPOSAL]);
    /* A live plan's periods are not this path's business. */
    expect(calls.is).toContainEqual(['subscription_id', null]);
  });

  it('asks only for stages that HAVE an invoice', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findBilledStagesForProposal(PROPOSAL, USER);

    expect(calls.nots).toContainEqual(['invoice_id', 'is', null]);
  });

  it('does NOT narrow to live invoices', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).findBilledStagesForProposal(PROPOSAL, USER);

    /*
     * Every stage invoice, paid ones included. The caller pushes all of them
     * into `stageInvoiceIds` before testing liveness, and the refund targets
     * hang off that list — the PAID stages being precisely the ones with money
     * to give back. A `status` filter here would drop them.
     */
    expect(calls.eqs.map(([col]) => col)).not.toContain('status');
    expect(calls.ins.map(([col]) => col)).not.toContain('status');
  });

  it('answers with an empty list, never null, when the quote has no billed stages', async () => {
    const { client } = mockSupabase({ data: null });

    const { data, error } = await new PaymentPlanRepository(client).findBilledStagesForProposal(
      PROPOSAL,
      USER
    );

    /* The caller iterates this directly; `null` would need a guard at every site. */
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('reports a read failure as an error rather than an empty quote', async () => {
    const { client } = mockSupabase({ error: new Error('boom') });

    const { data, error } = await new PaymentPlanRepository(client).findBilledStagesForProposal(
      PROPOSAL,
      USER
    );

    /* An empty list here would silently void nothing and report success. */
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PaymentPlanRepository.cancelOpenStagesForProposal', () => {
  it('scopes the write to the owner and the quote', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).cancelOpenStagesForProposal(PROPOSAL, USER);

    expect(calls.table).toBe('payment_plan_installments');
    expect(calls.update).toMatchObject({ status: 'cancelled' });
    expect(calls.eqs).toContainEqual(['user_id', USER]);
    expect(calls.eqs).toContainEqual(['proposal_id', PROPOSAL]);
  });

  it('closes EVERYTHING not settled, not only the pending ones', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).cancelOpenStagesForProposal(PROPOSAL, USER);

    /*
     * `paid` and `cancelled` are the only settled statuses. A `billed` stage
     * whose invoice this same call just voided must close with it, or it reads
     * `billed` on a job that ended — unpaid in the drawer with nothing left to
     * pay, and still counted as owed.
     */
    expect(calls.nots).toContainEqual(['status', 'in', '(paid,cancelled)']);
    expect(calls.eqs.map(([col]) => col)).not.toContain('status');
  });

  it("leaves a live plan's periods alone", async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).cancelOpenStagesForProposal(PROPOSAL, USER);

    expect(calls.is).toContainEqual(['subscription_id', null]);
  });

  it('clears next_retry_at so the scheduler stops chasing', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentPlanRepository(client).cancelOpenStagesForProposal(PROPOSAL, USER);

    expect(calls.update).toMatchObject({ next_retry_at: null });
  });

  it('returns the rows the plan totals have to be reconciled against', async () => {
    const rows = [{ id: 'st-1', amount: 100, payment_plan_id: 'plan-1' }];
    const { client, calls } = mockSupabase({ data: rows });

    const { data } = await new PaymentPlanRepository(client).cancelOpenStagesForProposal(
      PROPOSAL,
      USER
    );

    /*
     * `amount` and `payment_plan_id` are what `lowerPlansForCancelledStages`
     * needs: a plan's `total_amount` and `installment_count` are STORED, so
     * closing stages without lowering them leaves the plan claiming money
     * nobody can collect. The id alone cannot do that.
     */
    expect(calls.select).toBe('id, amount, payment_plan_id');
    expect(data).toEqual(rows);
  });

  it('reports closing nothing as success, not as failure', async () => {
    const { client } = mockSupabase({ data: [] });

    const { data, error } = await new PaymentPlanRepository(client).cancelOpenStagesForProposal(
      PROPOSAL,
      USER
    );

    /*
     * A quote collected in full, or stopped twice, has no open stages. The
     * caller must read `error` and not `!data.length`, or that correct case
     * reports a failure.
     */
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });
});
