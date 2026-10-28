/**
 * A payment recorded elsewhere still finishes the job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `settleInvoicePaid` opens with a dedupe guard: if a succeeded transaction
 * already exists for the invoice, return. That guard is right about the thing
 * it exists for — a redelivered webhook must not record a second payment — and
 * it was returning before everything that follows it, including
 * `confirmPackageOnPayment`, whose own comment spells out the cost: a package
 * left `pending`, its slots held, its client never told.
 *
 * The guard keys on a TRANSACTION row existing, and the transaction is not
 * always written by this function.
 *
 * Measured on a live package — `INV1611-00034`, $660, three sessions:
 *
 *     17:54:45.916   invoice.paid_at stamped
 *     17:54:46.554   transaction row created  (by another path)
 *     then           settleInvoicePaid ran, found it, and returned
 *
 * leaving three rows that contradicted each other: an invoice reading `sent`
 * while carrying `paid_at`, a booking reading `payment_status: paid`, and the
 * package container still `pending`.
 *
 * A `pending` container is not cosmetic. The public reschedule route refuses
 * anything whose booking is not `confirmed`, so the client who had paid in
 * full was told **"This booking is no longer open for changes"** on every one
 * of their sessions. That was reported as two separate faults — "payment is
 * not initiated" and "reschedule fails" — and is one defect.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { settleInvoicePaid, type SettlementDb } from '../invoiceSettlement';

const confirmPackage = jest.fn();

jest.mock('@/lib/payments/confirmPackageOnPayment', () => ({
  confirmPackageOnPayment: (...args: unknown[]) => confirmPackage(...args),
}));

type Writes = { updated: Record<string, unknown>[]; inserted: Record<string, unknown>[] };

/**
 * @param existingTransactionId a payment already recorded — the branch at issue
 * @param invoice what the invoice row currently says
 */
function fakeDb(options: {
  existingTransactionId?: string;
  invoice?: { id: string; status: string; paid_at: string | null } | null;
}) {
  const writes: Record<string, Writes> = {};
  const touch = (table: string) => (writes[table] ??= { updated: [], inserted: [] });

  const db = {
    from(table: string) {
      touch(table);
      return {
        select: () => ({
          eq: () => ({
            /* The dedupe read: `.in(...).limit(1).maybeSingle()`. */
            in: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: options.existingTransactionId ? { id: options.existingTransactionId } : null,
                }),
              }),
            }),
            /* The invoice read this fix added. */
            maybeSingle: async () => ({ data: options.invoice ?? null }),
            limit: () => ({ maybeSingle: async () => ({ data: null }) }),
            not: () => ({ is: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          touch(table).inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'tx-new' }, error: null }) }) };
        },
        update: (row: Record<string, unknown>) => {
          touch(table).updated.push(row);
          const settled = Promise.resolve({ error: null });
          return {
            eq: () => Object.assign(settled, { neq: () => Promise.resolve({ error: null }) }),
          };
        },
      };
    },
  } as unknown as SettlementDb;

  return { db, writes };
}

const PAYMENT = {
  invoiceId: 'inv-package',
  userId: 'user-1',
  contactId: 'contact-1',
  amount: 660,
  currency: 'USD',
};

beforeEach(() => confirmPackage.mockReset());

describe('when the payment was already recorded elsewhere', () => {
  it('still confirms the package', async () => {
    /*
     * THE ONE THAT MATTERS. Without it a paid package stays `pending` for
     * ever: nothing retries this, and the client cannot move a session.
     */
    const { db } = fakeDb({
      existingTransactionId: 'tx-written-by-another-path',
      invoice: { id: 'inv-package', status: 'sent', paid_at: '2026-10-27T17:54:45.916Z' },
    });

    await settleInvoicePaid(db, PAYMENT);

    expect(confirmPackage).toHaveBeenCalledTimes(1);
  });

  it('brings the invoice status up to the payment it already carries', async () => {
    const { db, writes } = fakeDb({
      existingTransactionId: 'tx-1',
      invoice: { id: 'inv-package', status: 'sent', paid_at: '2026-10-27T17:54:45.916Z' },
    });

    await settleInvoicePaid(db, PAYMENT);

    expect(writes['payment_invoices']?.updated).toContainEqual(
      expect.objectContaining({ status: 'paid' })
    );
  });

  it('keeps the payment date that was already stamped', async () => {
    /* The money arrived when it arrived. Overwriting `paid_at` with "now"
       would move a real payment to whenever the catch-up happened to run. */
    const { db, writes } = fakeDb({
      existingTransactionId: 'tx-1',
      invoice: { id: 'inv-package', status: 'sent', paid_at: '2026-10-27T17:54:45.916Z' },
    });

    await settleInvoicePaid(db, PAYMENT);

    expect(writes['payment_invoices']?.updated).toContainEqual(
      expect.objectContaining({ paid_at: '2026-10-27T17:54:45.916Z' })
    );
  });

  it('still records no second payment', async () => {
    /* The whole reason the guard exists. A redelivered webhook must not
       double the recorded revenue. */
    const { db, writes } = fakeDb({
      existingTransactionId: 'tx-1',
      invoice: { id: 'inv-package', status: 'sent', paid_at: '2026-10-27T17:54:45.916Z' },
    });

    const result = await settleInvoicePaid(db, PAYMENT);

    expect(writes['payment_transactions']?.inserted ?? []).toHaveLength(0);
    expect(result.alreadySettled).toBe(true);
    expect(result.transactionId).toBe('tx-1');
  });

  it('leaves an invoice that is already paid alone', async () => {
    /* Idempotent: a genuine webhook replay must not rewrite a settled row. */
    const { db, writes } = fakeDb({
      existingTransactionId: 'tx-1',
      invoice: { id: 'inv-package', status: 'paid', paid_at: '2026-10-27T17:54:45.916Z' },
    });

    await settleInvoicePaid(db, PAYMENT);

    expect(writes['payment_invoices']?.updated ?? []).toHaveLength(0);
    /* But the package is still checked — confirming one is itself idempotent,
       and this is the path that was skipping it. */
    expect(confirmPackage).toHaveBeenCalledTimes(1);
  });

  it('does not fail the settlement when the package check throws', async () => {
    confirmPackage.mockRejectedValueOnce(new Error('nope'));

    const { db } = fakeDb({
      existingTransactionId: 'tx-1',
      invoice: { id: 'inv-package', status: 'sent', paid_at: '2026-10-27T17:54:45.916Z' },
    });

    await expect(settleInvoicePaid(db, PAYMENT)).resolves.toMatchObject({
      alreadySettled: true,
    });
  });
});

describe('a first-time payment is unchanged', () => {
  it('records the transaction and settles the invoice as it always did', async () => {
    const { db, writes } = fakeDb({ invoice: null });

    const result = await settleInvoicePaid(db, PAYMENT);

    expect(result.alreadySettled).toBe(false);
    expect(writes['payment_transactions']?.inserted ?? []).toHaveLength(1);
    expect(writes['payment_invoices']?.updated).toContainEqual(
      expect.objectContaining({ status: 'paid' })
    );
  });
});
