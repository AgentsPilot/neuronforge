/**
 * A business that only ever takes cards can still run the refund agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE THAT ASKED THE WRONG QUESTION
 *
 * `assess_refund_requests` was gated on `bills_for_anything`, borrowed from
 * `chase_overdue_invoices`. That predicate counts rows in `payment_invoices`,
 * which is exactly right for an agent that chases invoices: a business that has
 * never raised one has nothing for it to chase.
 *
 * It is wrong for a refund. A service set to collect ONLINE charges the card
 * directly and writes a `payment_transactions` row with no invoice behind it.
 * Such a business takes money every day, reads as billing for nothing, and had
 * its refund agent refused outright.
 *
 * Measured on eomer3@gmail.com: zero invoices, one succeeded $50 card payment,
 * and a client's refund request for that very payment sitting unassessed in the
 * queue while the UI said "Cannot run · You are not billing for anything yet".
 *
 * So the refund agent now asks `takes_money`: has money ever arrived, by
 * invoice OR by card. The chasers keep `bills_for_anything`, because widening
 * that would offer an invoice chaser to a business with no invoices to chase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The counts are mocked per table so the OR is exercised in all four
 * combinations, rather than asserted by reading the source.
 */

const counts: Record<string, number> = {};
let failTable: string | null = null;

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const result =
        failTable === table
          ? { count: null, error: { message: 'unreadable' } }
          : { count: counts[table] ?? 0, error: null };

      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        /* Thenable, so `await supabaseServer.from(...).select(...).eq(...)`
           resolves wherever the chain is awaited. */
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      });
      return chain;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { automationApplies } from '../automationApplies';

/*
 * `automationApplies` is the entry point; the per-requirement resolver is
 * private on purpose, so the gate is exercised the way the registry calls it:
 * with an automation that declares the requirement.
 */
const asks = (requires: string) =>
  automationApplies(USER, { id: 'probe', requires } as never);

const USER = 'owner-1';

beforeEach(() => {
  counts.payment_invoices = 0;
  counts.payment_transactions = 0;
  failTable = null;
});

describe('takes_money: has money ever arrived, by any route', () => {
  it('an invoice alone is enough', async () => {
    counts.payment_invoices = 1;

    expect(await asks('takes_money')).toBe(true);
  });

  it('a card payment alone is enough, which is the case that was refused', async () => {
    counts.payment_transactions = 1;

    expect(await asks('takes_money')).toBe(true);
  });

  it('both is obviously enough', async () => {
    counts.payment_invoices = 3;
    counts.payment_transactions = 7;

    expect(await asks('takes_money')).toBe(true);
  });

  it('neither is not', async () => {
    expect(await asks('takes_money')).toBe(false);
  });

  it('fails closed when the payments table cannot be read', async () => {
    failTable = 'payment_transactions';

    /* The same direction every gate in this file fails in: hide the offer
       rather than promise an agent that may have nothing to work on. */
    expect(await asks('takes_money')).toBe(false);
  });
});

describe('bills_for_anything is left alone, because the chasers need it', () => {
  it('still answers no to a business that takes cards and raises no invoices', async () => {
    counts.payment_transactions = 5;

    /* Widening this one would offer an INVOICE chaser to a business with no
       invoices to chase, which is why the refund agent got its own gate
       instead. */
    expect(await asks('bills_for_anything')).toBe(false);
  });

  it('answers yes once an invoice exists', async () => {
    counts.payment_invoices = 1;

    expect(await asks('bills_for_anything')).toBe(true);
  });
});
