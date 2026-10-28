/**
 * A package bought UPFRONT can be refunded from one of its sessions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * An upfront package is ONE payment on the container with N sessions beneath
 * it. The sessions carry no invoice and no transaction — correctly, because
 * nobody was billed per session — so every link `resolveRefundTargets` knew
 * about resolved to nothing when handed a session id.
 *
 * The owner got "no settled payment is recorded against this", ₪0.00, a
 * maximum of ₪0.00 and a dead refund button, over a payment sitting there
 * succeeded for the full amount.
 *
 * Reported from a live account: package `3af61374-…`, ₪1,000 paid through
 * `INV-00044`, refundable from the invoice and from the container and from
 * none of its four sessions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OTHER PACKAGE TYPE MUST NOT MOVE
 *
 * A package billed PER SESSION gives each session its own invoice, and the
 * refund should go against THAT session — not the block. The fallback is
 * therefore gated on having found nothing at all, which is asserted here by
 * checking that `scheduling_meetings` is never even consulted in that case.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/repositories/CRMActivityRepository', () => ({ crmActivityRepository: {} }));
jest.mock('@/lib/repositories/PaymentRepository', () => ({ stripeConnectRepository: {} }));
jest.mock('@/lib/repositories/PaymentRefundRepository', () => ({ paymentRefundRepository: {} }));

const USER = 'user-1';

/** The two shapes, side by side, as the live rows actually look. */
const DB: Record<string, Record<string, unknown>[]> = {
  /* UPFRONT: one invoice on the container, nothing on the sessions. */
  scheduling_meetings: [
    { id: 'session-1', user_id: USER, booking_id: 'package-1' },
    { id: 'session-2', user_id: USER, booking_id: 'package-1' },
  ],
  scheduling_bookings: [
    { id: 'package-1', user_id: USER, payment_id: null },
    /* PER SESSION: an old-shape child booking with money of its own. */
    { id: 'child-1', user_id: USER, payment_id: null },
  ],
  payment_invoices: [
    { id: 'invoice-pkg', user_id: USER, booking_id: 'package-1' },
    { id: 'invoice-child', user_id: USER, booking_id: 'child-1' },
  ],
  /*
   * A quote is raised against an APPOINTMENT. Accepting it creates the invoice
   * and, for a package, the container — and the money lands on those, never on
   * the quote's own booking.
   */
  proposals: [
    {
      id: 'quote-package',
      user_id: USER,
      booking_id: 'quote-booking-1',
      created_invoice_id: 'invoice-pkg',
      package_booking_id: 'package-1',
    },
    {
      /* A quote for a single appointment: an invoice, and no package. */
      id: 'quote-single',
      user_id: USER,
      booking_id: 'quote-booking-2',
      created_invoice_id: 'invoice-child',
      package_booking_id: null,
    },
  ],
  payment_transactions: [
    {
      id: 'tx-pkg',
      user_id: USER,
      invoice_id: 'invoice-pkg',
      booking_id: null,
      status: 'succeeded',
      created_at: '2026-10-28T06:03:48Z',
    },
    {
      id: 'tx-child',
      user_id: USER,
      invoice_id: 'invoice-child',
      booking_id: null,
      status: 'succeeded',
      created_at: '2026-10-13T01:31:15Z',
    },
  ],
};

const touched: string[] = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      touched.push(table);

      const eqs: [string, unknown][] = [];
      const ins: [string, unknown[]][] = [];

      const rows = () =>
        (DB[table] ?? []).filter(
          row =>
            eqs.every(([column, value]) => row[column] === value) &&
            ins.every(([column, values]) => values.includes(row[column] as never))
        );

      const builder: Record<string, unknown> = {};

      builder.select = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.eq = (column: string, value: unknown) => {
        eqs.push([column, value]);
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        ins.push([column, values]);
        return builder;
      };
      builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      /* Thenable, because the resolver awaits the builder itself rather than a
         terminal method — `Promise.all(queries)` is the whole point. */
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject);

      return builder;
    },
  },
}));

import { resolveRefundTargets } from '../RefundService';

beforeEach(() => {
  touched.length = 0;
});

describe('an upfront package, refunded from one of its sessions', () => {
  it('finds the payment on the package it belongs to', async () => {
    const result = await resolveRefundTargets({ userId: USER, bookingId: 'session-1' });

    expect(result).toEqual({ transactionIds: ['tx-pkg'] });
  });

  it('answers the same from any session, because there is one payment', async () => {
    const first = await resolveRefundTargets({ userId: USER, bookingId: 'session-1' });
    const second = await resolveRefundTargets({ userId: USER, bookingId: 'session-2' });

    expect(second).toEqual(first);
  });

  it('still answers directly when asked about the package itself', async () => {
    const result = await resolveRefundTargets({ userId: USER, bookingId: 'package-1' });

    expect(result).toEqual({ transactionIds: ['tx-pkg'] });
    /* It never needed the fallback: the container owns the invoice. */
    expect(touched).not.toContain('scheduling_meetings');
  });
});

describe('a package billed per session', () => {
  it('refunds against the SESSION, not the block', async () => {
    const result = await resolveRefundTargets({ userId: USER, bookingId: 'child-1' });

    expect(result).toEqual({ transactionIds: ['tx-child'] });
  });

  it('never reaches the fallback, so that shape cannot have moved', async () => {
    /*
     * The safety argument stated as an assertion. The session's own invoice is
     * found first, so the meeting lookup is not even attempted — which is what
     * makes it impossible for this change to redirect a per-session refund at
     * the whole block.
     */
    await resolveRefundTargets({ userId: USER, bookingId: 'child-1' });

    expect(touched).not.toContain('scheduling_meetings');
  });
});

/**
 * THE QUOTE CARD.
 *
 * The card reads "₪1,000 collected, ₪0 outstanding, paid" and its own Manage
 * payment button opened a refund of ₪0.00 — because it passes the quote's
 * booking, which holds none of the money the acceptance created.
 *
 * Three accepted upfront quotes on the reporting account, ₪1,000, ₪950 and
 * ₪700, every one refundable from its package and its invoice and from none of
 * its quote bookings.
 */
describe('a quote accepted and paid upfront', () => {
  it('refunds from the quote card, through what accepting it created', async () => {
    const result = await resolveRefundTargets({ userId: USER, bookingId: 'quote-booking-1' });

    expect(result).toEqual({ transactionIds: ['tx-pkg'] });
  });

  it('works for a quote with an invoice and no package', async () => {
    const result = await resolveRefundTargets({ userId: USER, bookingId: 'quote-booking-2' });

    expect(result).toEqual({ transactionIds: ['tx-child'] });
  });

  it('does not consult quotes when the booking owns its money', async () => {
    /* The gate. A booking with its own invoice is answered before any of this,
       so the ordinary refund cannot be redirected through a quote. */
    await resolveRefundTargets({ userId: USER, bookingId: 'child-1' });

    expect(touched).not.toContain('proposals');
  });

  it('refuses a quote booking belonging to ANOTHER tenant', () => {
    /* CLAUDE.md rule 4 — the quote read is scoped like the rest. */
    return expect(
      resolveRefundTargets({ userId: 'someone-else', bookingId: 'quote-booking-1' })
    ).resolves.toHaveProperty('error', 'NOT_FOUND');
  });
});

describe('when there is genuinely nothing', () => {
  it('still reports nothing to refund rather than inventing a target', async () => {
    const result = await resolveRefundTargets({ userId: USER, bookingId: 'nobody' });

    expect(result).toEqual({
      error: 'NOT_FOUND',
      message: 'No settled payment is recorded against this, so there is nothing to refund.',
    });
  });

  it('refuses a session belonging to ANOTHER tenant', async () => {
    /* CLAUDE.md rule 4. The fallback adds two reads, and both are scoped — a
       session id guessed from another business must not reach its package. */
    const result = await resolveRefundTargets({ userId: 'someone-else', bookingId: 'session-1' });

    expect(result).toHaveProperty('error', 'NOT_FOUND');
  });
});
