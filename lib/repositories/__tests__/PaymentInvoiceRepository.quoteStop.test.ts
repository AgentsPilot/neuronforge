/**
 * `findSettlementStateById`, `findOpenForBooking`, and the constant that tells
 * them apart from the invoices a client has merely been GIVEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE OF THESE ASSERTIONS USED TO LIVE IN `cancelQuoteStages.test.ts`, as
 * regex matches against that file's own source text. They had to: the loose
 * invoice sweep was unreachable in that suite, because its fake had no `in`
 * method and the chain for the sweep's query could not resolve. Reading the
 * source was the only way to assert anything about it at all.
 *
 * Routing the query into this repository is what makes them executable
 * assertions on a real call instead. They are re-homed here, not deleted, and
 * each one still guards exactly what it guarded:
 *
 *   `.in('status', LIVE_INVOICE_STATUSES)`      -> the `in` filter, by value
 *   `.eq('user_id', userId)`                    -> owner scope (CLAUDE.md rule 4)
 *   `.eq('booking_id', proposal.booking_id)`    -> this quote's own booking
 *   `const LIVE_INVOICE_STATUSES = [...]`       -> the constant's own test below
 *
 * Its sibling `SETTLED_INVOICE_STATUSES` stayed in `cancelQuoteStages.ts`, and
 * so did its source-text assertion. That one is a predicate applied to a row
 * already returned — a call-site decision about what counts as collected — not
 * a filter the database applies. One constant moved; one did not.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PaymentInvoiceRepository,
  LIVE_INVOICE_STATUSES,
  ISSUED_INVOICE_STATUSES,
} from '@/lib/repositories/PaymentRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown]>;
  maybeSingle: boolean;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], ins: [], maybeSingle: false };
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
    in: jest.fn((col: string, val: unknown) => {
      calls.ins.push([col, val]);
      return builder;
    }),
    maybeSingle: jest.fn(async () => {
      calls.maybeSingle = true;
      return resolved;
    }),
    /* `findOpenForBooking` awaits the chain itself — no terminal method. */
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

const INVOICE = 'inv-1';
const BOOKING = 'booking-1';
const USER = 'owner-1';

describe('LIVE_INVOICE_STATUSES', () => {
  it('is draft, sent and overdue', () => {
    expect([...LIVE_INVOICE_STATUSES]).toEqual(['draft', 'sent', 'overdue']);
  });

  it('differs from ISSUED_INVOICE_STATUSES by exactly draft-versus-pending', () => {
    /*
     * The whole reason both constants are declared beside each other with the
     * difference spelled out. Reusing the wrong one on this path would stop
     * voiding drafts and start voiding pendings, which is not a near miss: it is
     * the difference between calling off an invoice the client never saw and
     * calling off one they are being chased for.
     */
    const live = new Set<string>(LIVE_INVOICE_STATUSES);
    const issued = new Set<string>(ISSUED_INVOICE_STATUSES);

    expect([...live].filter((s) => !issued.has(s))).toEqual(['draft']);
    expect([...issued].filter((s) => !live.has(s))).toEqual(['pending']);
  });

  it('holds neither paid nor cancelled', () => {
    /* One is settled money, the other already done. Voiding either rewrites a record. */
    expect([...LIVE_INVOICE_STATUSES]).not.toContain('paid');
    expect([...LIVE_INVOICE_STATUSES]).not.toContain('cancelled');
  });
});

describe('PaymentInvoiceRepository.findSettlementStateById', () => {
  it('reads one invoice, scoped to its owner', async () => {
    const { client, calls } = mockSupabase({ data: null });

    await new PaymentInvoiceRepository(client).findSettlementStateById(INVOICE, USER);

    expect(calls.table).toBe('payment_invoices');
    expect(calls.eqs).toContainEqual(['id', INVOICE]);
    expect(calls.eqs).toContainEqual(['user_id', USER]);
    expect(calls.maybeSingle).toBe(true);
  });

  it('asks for the five columns the decision needs, and no more', async () => {
    const { client, calls } = mockSupabase({ data: null });

    await new PaymentInvoiceRepository(client).findSettlementStateById(INVOICE, USER);

    /*
     * Not `select('*')`. This runs once per billed stage inside the void loop,
     * and `payment_invoices` rows carry the client's address and the whole
     * line-item payload.
     */
    expect(calls.select).toBe('id, status, amount, refunded_amount, currency');
  });

  it('returns currency as a typed column rather than a cast', async () => {
    const row = {
      id: INVOICE,
      status: 'paid',
      amount: 500,
      refunded_amount: 100,
      currency: 'ILS',
    };
    const { client } = mockSupabase({ data: row });

    const { data } = await new PaymentInvoiceRepository(client).findSettlementStateById(
      INVOICE,
      USER
    );

    /*
     * The call site reached this through `(invoice as { currency?: string | null })`
     * only because an inline read has no type. The cast is what the method
     * removes, and this is the assertion that keeps it removed.
     */
    expect(data?.currency).toBe('ILS');
  });

  it("answers null for an invoice that is not this owner's, without an error", async () => {
    const { client } = mockSupabase({ data: null });

    const { data, error } = await new PaymentInvoiceRepository(client).findSettlementStateById(
      INVOICE,
      USER
    );

    /* The caller skips a missing invoice; it must not read as a read failure. */
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('reports a read failure as an error', async () => {
    const { client } = mockSupabase({ error: new Error('boom') });

    const { data, error } = await new PaymentInvoiceRepository(client).findSettlementStateById(
      INVOICE,
      USER
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PaymentInvoiceRepository.findOpenForBooking', () => {
  it('filters on exactly the live statuses — re-homed from cancelQuoteStages.test.ts', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentInvoiceRepository(client).findOpenForBooking(BOOKING, USER);

    expect(calls.ins).toContainEqual(['status', ['draft', 'sent', 'overdue']]);
  });

  it('stays inside this owner and this booking — re-homed from cancelQuoteStages.test.ts', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new PaymentInvoiceRepository(client).findOpenForBooking(BOOKING, USER);

    expect(calls.table).toBe('payment_invoices');
    expect(calls.select).toBe('id, status');
    expect(calls.eqs).toContainEqual(['user_id', USER]);
    expect(calls.eqs).toContainEqual(['booking_id', BOOKING]);
  });

  it('takes no caller-supplied status list', () => {
    /*
     * A `statuses` parameter is a generic filter wearing a specific name, and it
     * is how the wrong constant eventually gets passed in by a reader who saw
     * two lists. One argument for the booking, one for the owner, nothing else.
     */
    expect(PaymentInvoiceRepository.prototype.findOpenForBooking).toHaveLength(2);
  });

  it('answers with an empty list, never null', async () => {
    const { client } = mockSupabase({ data: null });

    const { data, error } = await new PaymentInvoiceRepository(client).findOpenForBooking(
      BOOKING,
      USER
    );

    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('reports a read failure as an error rather than a booking with no invoices', async () => {
    const { client } = mockSupabase({ error: new Error('boom') });

    const { data, error } = await new PaymentInvoiceRepository(client).findOpenForBooking(
      BOOKING,
      USER
    );

    /*
     * The caller logs and carries on from this, which is deliberate — but it
     * must be able to tell a failed read from a booking that genuinely has
     * nothing left open.
     */
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
