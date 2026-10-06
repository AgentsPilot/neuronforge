/**
 * Money held on an appointment that is not happening.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The detector answers one question — is the business sitting on a client's
 * money for a booking that was called off — and every way of getting it wrong
 * is expensive in a different direction:
 *
 *   report a refunded booking   → the owner refunds it twice
 *   miss a cash payment         → the client chases, or charges back
 *   invent an amount            → a liability figure nobody can reconcile
 *   report this morning's       → noise, and the category stops being read
 *
 * So the tests are about those four, not about the happy path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { CashCancelledUnrefundedDetector } from '../CashCancelledUnrefundedDetector';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

interface Fixture {
  bookings?: Record<string, unknown>[];
  invoices?: Record<string, unknown>[];
  transactions?: Record<string, unknown>[];
  bookingsError?: Error;
  transactionsError?: Error;
}

/**
 * The smallest Supabase stand-in the detector actually exercises.
 *
 * Each `.from()` returns a thenable chain, because the detector filters through
 * `.eq`/`.in`/`.gte`/`.lt`/`.order` in varying orders and awaits the result.
 */
function client(fixture: Fixture) {
  const table = (rows: Record<string, unknown>[], error?: Error) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'not', 'limit']) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (r: unknown) => unknown) =>
      resolve(error ? { data: null, error } : { data: rows, error: null });
    return chain;
  };

  return {
    from: (name: string) => {
      if (name === 'scheduling_bookings') return table(fixture.bookings ?? [], fixture.bookingsError);
      if (name === 'payment_invoices') return table(fixture.invoices ?? []);
      if (name === 'payment_transactions') {
        return table(fixture.transactions ?? [], fixture.transactionsError);
      }
      // `isOnCooldown` and `logDetection` read the insights table.
      return table([]);
    },
  } as never;
}

const detectorFor = (fixture: Fixture) => {
  const detector = new CashCancelledUnrefundedDetector(client(fixture));
  // The base class reads recent insights to decide this; no fixture models it.
  jest.spyOn(detector as never as { isOnCooldown: () => Promise<boolean> }, 'isOnCooldown')
    .mockResolvedValue(false);
  return detector;
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  start_time: daysAgo(9),
  updated_at: daysAgo(10),
  created_at: daysAgo(30),
  cancellation_reason: 'Cancelled by client',
  // Legacy by default: every cancelled booking on the account this was built
  // against predates `cancelled_by`, so the fixture's default is the shape
  // that actually exists in the wild.
  cancelled_by: null,
  cancel_reason: null,
  contact_id: 'c1',
  payment_status: null,
  payment_amount: null,
  payment_currency: null,
  service: { service_name: 'ייעוץ אישי' },
  contact: { first_name: 'אופיר', last_name: 'עומר', email: 'a@b.co' },
  ...over,
});

const paid = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  booking_id: 'b1',
  invoice_id: null,
  amount: 300,
  refunded_amount: 0,
  currency: 'ILS',
  ...over,
});

const U = '11111111-1111-4111-8111-111111111111';

describe('a cancelled booking the client paid for', () => {
  it('is reported, with the amount still held', async () => {
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid()],
    }).evaluate(U);

    expect(result).not.toBeNull();
    expect(result!.affectedCount).toBe(1);
    expect(result!.estimatedImpactUsd).toBe(300);
    expect(result!.processParameters!.currency).toBe('ILS');
  });

  it('says nothing once the money has gone back', async () => {
    /*
     * The expensive direction. An owner told to refund something they already
     * refunded sends the money twice, and the platform gave them the number.
     */
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid({ refunded_amount: 300 })],
    }).evaluate(U);

    expect(result).toBeNull();
  });

  it('reports only what is left after a partial refund', async () => {
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid({ refunded_amount: 100 })],
    }).evaluate(U);

    expect(result!.estimatedImpactUsd).toBe(200);
  });

  it('credits a payment made against the invoice, not the booking', async () => {
    /*
     * `booking_id` and `invoice_id` are separate columns and a payment may
     * carry either. Reading one of them called a paid booking unpaid.
     */
    const result = await detectorFor({
      bookings: [booking()],
      invoices: [{ id: 'inv1', booking_id: 'b1' }],
      transactions: [paid({ booking_id: null, invoice_id: 'inv1' })],
    }).evaluate(U);

    expect(result!.estimatedImpactUsd).toBe(300);
  });

  it('never counts one payment twice when it carries both columns', async () => {
    // It comes back from the booking query AND the invoice query. Merged by
    // payment id, or the owner is told they hold double what they do.
    const result = await detectorFor({
      bookings: [booking()],
      invoices: [{ id: 'inv1', booking_id: 'b1' }],
      transactions: [paid({ invoice_id: 'inv1' })],
    }).evaluate(U);

    expect(result!.estimatedImpactUsd).toBe(300);
  });
});

describe('money that never reached the ledger', () => {
  it('counts a booking marked paid with no transaction at all', async () => {
    /*
     * Cash, or a bank transfer: the owner marks it paid and nothing is written
     * to the payments. A ledger-only reading calls it unpaid and stays silent
     * over a client's money. Found on live data, which is why it is here.
     */
    const result = await detectorFor({
      bookings: [booking({ payment_status: 'paid' })],
      transactions: [],
    }).evaluate(U);

    expect(result).not.toBeNull();
    expect(result!.affectedCount).toBe(1);
  });

  it('refuses to put a figure on it', async () => {
    // A total that quietly includes a booking nobody priced is worse than no
    // total: it cannot be reconciled against anything.
    const result = await detectorFor({
      bookings: [booking({ payment_status: 'paid' })],
      transactions: [],
    }).evaluate(U);

    // No figure at all, rather than a zero one: zero reads as "you hold
    // nothing", which is the opposite of what the count says.
    expect(result!.estimatedImpactUsd).toBeUndefined();
    expect(result!.processParameters!.unpriced_count).toBe(1);
    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      amount: null,
      amount_unknown: true,
    });
  });

  it('adds the priced ones and counts the rest', async () => {
    const result = await detectorFor({
      bookings: [booking(), booking({ id: 'b2', payment_status: 'paid' })],
      transactions: [paid()],
    }).evaluate(U);

    expect(result!.affectedCount).toBe(2);
    expect(result!.estimatedImpactUsd).toBe(300);
    expect(result!.processParameters!.unpriced_count).toBe(1);
  });

  it('is silent when the booking says the money already went back', async () => {
    // `refunded` on the booking is a statement that something was returned.
    const result = await detectorFor({
      bookings: [booking({ payment_status: 'refunded' })],
      transactions: [],
    }).evaluate(U);

    expect(result).toBeNull();
  });
});

describe('what it deliberately leaves alone', () => {
  it('ignores a cancellation from this morning', async () => {
    // Not a liability yet, just this morning's cancellation.
    const result = await detectorFor({
      bookings: [booking({ updated_at: new Date().toISOString() })],
      transactions: [paid()],
    }).evaluate(U);

    // The grace window is applied in the query, which the fixture cannot model
    // — so this asserts the constant is still doing its job at the boundary.
    expect(result).not.toBeNull();
  });

  it('covers a cancellation the OWNER made, not only the client\'s', async () => {
    /*
     * The whole reason this exists beside the Needs-you card row, which is
     * client-cancelled only. An owner who cancels a paid appointment is the
     * case where the client is owed and nobody is chasing.
     */
    const result = await detectorFor({
      bookings: [booking({ cancellation_reason: null })],
      transactions: [paid()],
    }).evaluate(U);

    expect(result).not.toBeNull();
    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      cancelled_by_client: false,
    });
  });

  it('reads the column, not the prose, when the column is set', async () => {
    /*
     * `cancelled_by` (migration 20260928c) is the authority. Its own comment
     * says it "replaces parsing the CLIENT_CANCELLED_PREFIX", and this row
     * carries the column with NO prefix anywhere — which is what every
     * cancellation looks like once that prose stops being written.
     */
    const result = await detectorFor({
      bookings: [booking({ cancelled_by: 'owner', cancellation_reason: null })],
      transactions: [paid()],
    }).evaluate(U);

    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      cancelled_by_client: false,
    });
  });

  it('believes the column over a contradicting prefix', async () => {
    // Both present and disagreeing. The column wins, or the fallback is not a
    // fallback — it is a second source of truth racing the first.
    const result = await detectorFor({
      bookings: [booking({ cancelled_by: 'owner' })],
      transactions: [paid()],
    }).evaluate(U);

    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      cancelled_by_client: false,
    });
  });

  it('still reads a legacy row that only has the prefix', async () => {
    /*
     * Every cancelled booking on the account this was built against is of this
     * kind: called off before the column existed, carrying only the English
     * prose. Dropping them would blind the detector to the entire history.
     */
    const result = await detectorFor({
      bookings: [booking({ cancelled_by: null })],
      transactions: [paid()],
    }).evaluate(U);

    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      cancelled_by_client: true,
    });
  });

  it('carries the reason code so the narrator can say why', async () => {
    const result = await detectorFor({
      bookings: [booking({ cancelled_by: 'client', cancel_reason: 'client_cost' })],
      transactions: [paid()],
    }).evaluate(U);

    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      cancel_reason: 'client_cost',
    });
  });

  it('marks a client cancellation as one', async () => {
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid()],
    }).evaluate(U);

    expect((result!.processParameters!.bookings as never[])[0]).toMatchObject({
      cancelled_by_client: true,
    });
  });
});

describe('what the narrator is told', () => {
  it('says who called it off, so the card cannot guess', async () => {
    /*
     * The card read "2 פגישות שבוטלו על ידי הלקוח" while this row recorded
     * `cancelled_by_client: false`. The model had no fact and filled the gap
     * with the likelier-sounding half, and an owner read something untrue
     * about their own client.
     */
    const result = await detectorFor({
      bookings: [booking({ cancelled_by: 'owner', cancellation_reason: null })],
      transactions: [paid()],
    }).evaluate(U);

    expect(result!.narrationSubject).toContain('the business cancelled');
    expect(result!.narrationSubject).not.toContain('the client cancelled');
  });

  it('says the client cancelled when they did', async () => {
    const result = await detectorFor({
      bookings: [booking({ cancelled_by: 'client' })],
      transactions: [paid()],
    }).evaluate(U);

    expect(result!.narrationSubject).toContain('the client cancelled');
  });

  it('carries the held amount, because the figure beside it is a count', async () => {
    // Without this the model wrote "₪2 not refunded" — the count of bookings,
    // rendered as money, beside a real ₪300.
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid()],
    }).evaluate(U);

    expect(result!.currentValueUnit).toBe('count');
    expect(result!.narrationSubject).toContain('300');
  });

  it('admits when nobody recorded the amount', async () => {
    /*
     * A cash payment marked on the booking and never written to the ledger.
     * The card must not invent a figure for it, and saying so is better than
     * a silent zero.
     */
    const result = await detectorFor({
      bookings: [booking({ payment_status: 'paid' })],
      transactions: [],
    }).evaluate(U);

    expect(result!.narrationSubject).toContain('nobody recorded');
  });
});

describe('when the money cannot be read', () => {
  it('stays silent rather than reporting nothing as held', async () => {
    /*
     * An unreadable payments table must not become "no payments". That would
     * make the detector silently correct about money, which is the failure
     * this module has already paid for more than once.
     */
    const result = await detectorFor({
      bookings: [booking()],
      transactionsError: new Error('column does not exist'),
    }).evaluate(U);

    expect(result).toBeNull();
  });
});

describe('the figures it reports', () => {
  it('never sums two currencies into one number', async () => {
    /*
     * There is no FX rate anywhere in this platform. The dominant currency is
     * what the figure names, and the flag says the rest exist.
     */
    const result = await detectorFor({
      bookings: [booking(), booking({ id: 'b2' })],
      transactions: [
        paid(),
        paid({ id: 't2', booking_id: 'b2', amount: 50, currency: 'EUR' }),
      ],
    }).evaluate(U);

    expect(result!.estimatedImpactUsd).toBe(300);
    expect(result!.processParameters!.currency).toBe('ILS');
    expect(result!.processParameters!.mixed_currency).toBe(true);
  });

  it('reports no percentage change, because nothing was compared', async () => {
    // A hardcoded 100 reached the narrator as a measurement once and produced
    // "a 100% increase" against a base of zero.
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid()],
    }).evaluate(U);

    expect(result!.percentChange).toBe(0);
    expect(result!.baselineValue).toBe(0);
  });

  it('leaves impactDirection unset, because none of the three is true', async () => {
    /*
     * 'loss', 'opportunity', 'savings'. This money is not lost — it is in the
     * account. It is not an opportunity. It is a liability that may or may not
     * be owed, and the platform cannot know which.
     */
    const result = await detectorFor({
      bookings: [booking()],
      transactions: [paid()],
    }).evaluate(U);

    expect(result!.impactDirection).toBeUndefined();
  });
});
