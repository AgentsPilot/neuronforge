/**
 * A settled stage says HOW it was paid, not merely that it was.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * A quoted job is billed one invoice per stage, and every payment path — the
 * Stripe webhook, the drawer's manual record, bizql, a retry — converges on
 * `settleInvoicePaid` keyed to that stage's invoice. That convergence is what
 * makes mixed methods work at all: the deposit can clear on a card and the
 * final milestone arrive as cash, each settling its own invoice.
 *
 * But the stage row was written with `status` and `paid_at` and nothing else,
 * so both halves of that job read identically. Nothing on the row could say
 * which money came by card and which came in cash — the exact question the
 * owner opens the dialog to answer — and `transaction_id`, the link a refund
 * follows to find the charge behind a period, was left NULL.
 *
 * These assert the WRITE, against a fake database. A version of this file that
 * passes while the update carries three fields is the bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { settleInvoicePaid, type SettlementDb } from '../invoiceSettlement';

/**
 * Every row handed to `.insert()` / `.update()`, by table — AND the filters the
 * update was narrowed by.
 *
 * The filters matter as much as the payload here. A correct payload on an
 * update that matches no rows writes nothing, which is exactly how the stage
 * attribution came to be silently dropped in production while this file was
 * green.
 */
type Writes = {
  inserted: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  filters: string[];
};

function fakeDb(options: { existingTransactionId?: string } = {}) {
  const writes: Record<string, Writes> = {};
  const touch = (table: string) =>
    (writes[table] ??= { inserted: [], updated: [], filters: [] });

  const db: SettlementDb = {
    from(table: string) {
      touch(table);
      return {
        select: () => ({
          eq: () => ({
            /* The dedupe read: `.in(...).limit(1).maybeSingle()`. */
            in: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: options.existingTransactionId
                    ? { id: options.existingTransactionId }
                    : null,
                }),
              }),
            }),
            /* The receipt read, which this test does not exercise. */
            limit: () => ({ maybeSingle: async () => ({ data: null }) }),
            maybeSingle: async () => ({ data: null }),
            /* The package-confirmation read. Present only so its failure does
               not fill the output: it is non-fatal by design, and this file is
               about the stage write. */
            not: () => ({ is: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          touch(table).inserted.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: 'tx-new' }, error: null }),
            }),
          };
        },
        update: (row: Record<string, unknown>) => {
          touch(table).updated.push(row);
          const settled = Promise.resolve({ error: null });
          /* Awaitable and chainable, like a PostgREST builder, and it records
             what it was narrowed by. */
          const builder = Object.assign(settled, {
            neq: (column: string, value: unknown) => {
              touch(table).filters.push(`neq:${column}=${String(value)}`);
              return Promise.resolve({ error: null });
            },
          });
          return {
            eq: (column: string, value: unknown) => {
              touch(table).filters.push(`eq:${column}=${String(value)}`);
              return builder;
            },
          };
        },
      };
    },
  } as unknown as SettlementDb;

  return { db, writes };
}

/** Cash, recorded by hand in the drawer. */
const CASH = {
  invoiceId: 'inv-stage-2',
  userId: 'user-1',
  contactId: 'contact-1',
  amount: 400,
  currency: 'ILS',
  paymentMethod: 'cash',
  processorType: 'manual' as const,
};

describe('the stage row carries the method', () => {
  it('writes payment_method, processor_type and transaction_id', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Without these three the mixed-method case is unanswerable: "₪400 paid"
     * on both stages, with no way to tell the card from the cash, and no
     * route from the period to the charge that settled it.
     * ─────────────────────────────────────────────────────────────────────
     */
    const { db, writes } = fakeDb();

    await settleInvoicePaid(db, CASH);

    const stage = writes['payment_plan_installments'].updated[0];

    expect(stage).toMatchObject({
      status: 'paid',
      payment_method: 'cash',
      processor_type: 'manual',
      transaction_id: 'tx-new',
    });
    expect(stage.paid_at).toBeTruthy();
    expect(stage.updated_at).toBeTruthy();
  });

  it('keeps card as the default, so the Stripe path is unchanged', async () => {
    // The webhook passes neither field; it has always meant a card at Stripe.
    const { db, writes } = fakeDb();

    await settleInvoicePaid(db, { ...CASH, paymentMethod: undefined, processorType: undefined });

    expect(writes['payment_plan_installments'].updated[0]).toMatchObject({
      payment_method: 'card',
      processor_type: 'stripe',
    });
  });

  it('never writes stripe_invoice_id onto the stage', async () => {
    /*
     * That column is the dedupe key for `recordPlanPeriodPaid`
     * (`.eq('stripe_invoice_id', invoice.id)`). Filling it from here would make
     * that path read a period it never recorded as one it had, and skip real
     * money in silence. The temptation is real — it would make the row look
     * complete — so it is asserted rather than left to a comment.
     */
    const { db, writes } = fakeDb();

    await settleInvoicePaid(db, CASH);

    expect(writes['payment_plan_installments'].updated[0]).not.toHaveProperty('stripe_invoice_id');
  });

  it('does not narrow the update by status, which the trigger has already set', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THIS FILE MISSED THE FIRST TIME.
     *
     * `move_plan_stage_with_invoice` (migration 20260916) fires when the line
     * above flips the INVOICE to paid, and marks every stage on it paid. By
     * the time this update runs, the row is always already `paid`.
     *
     * So a `.neq('status', 'paid')` guard here matches nothing and the whole
     * payload is discarded in silence. The assertions above still passed —
     * they check what was SENT, and it was sent, to zero rows. Live proof: a
     * cash payment whose stage kept NULL in all three columns.
     *
     * A fake database cannot have a trigger, so the filter itself is what gets
     * asserted.
     * ─────────────────────────────────────────────────────────────────────
     */
    const { db, writes } = fakeDb();

    await settleInvoicePaid(db, CASH);

    const filters = writes['payment_plan_installments'].filters;

    expect(filters).toContain('eq:invoice_id=inv-stage-2');
    expect(filters.some(f => f.startsWith('neq:status'))).toBe(false);
  });

  it('records the method on the transaction too', async () => {
    const { db, writes } = fakeDb();

    await settleInvoicePaid(db, CASH);

    expect(writes['payment_transactions'].inserted[0]).toMatchObject({
      payment_method: 'cash',
      processor_type: 'manual',
      status: 'succeeded',
      amount: 400,
    });
  });
});

describe('a payment already recorded is not recorded again', () => {
  it('writes nothing when a transaction exists for the invoice', async () => {
    /*
     * This is what stops the card and the cash path double-counting each
     * other's stage, and it is why paying out of band at Stripe can echo back
     * as `invoice.paid` harmlessly.
     */
    const { db, writes } = fakeDb({ existingTransactionId: 'tx-existing' });

    const result = await settleInvoicePaid(db, CASH);

    expect(result).toEqual({ transactionId: 'tx-existing', alreadySettled: true });
    expect(writes['payment_transactions'].inserted).toHaveLength(0);
    expect(writes['payment_plan_installments']?.updated ?? []).toHaveLength(0);
  });
});
