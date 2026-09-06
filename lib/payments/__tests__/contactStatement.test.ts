/**
 * The statement returns money a client is told they owe, so the arithmetic and
 * the "what counts as open" rule are worth pinning down.
 */

const from = jest.fn();

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (...args: unknown[]) => from(...args) },
}));

import { buildContactStatement, ContactStatementError } from '@/lib/payments/contactStatement';
import { CATALOG } from '@/lib/business-os/catalog';

/**
 * A Supabase query builder that records nothing and resolves to `result`.
 *
 * Every filter method returns the chain, and the chain itself is awaitable —
 * which is what the three parallel queries do. `maybeSingle` resolves directly,
 * as the contact lookup awaits it.
 */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};

  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }

  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);

  return chain;
}

const CONTACT = {
  data: { id: 'c1', first_name: 'דויד', last_name: 'המלך', email: 'david@example.co.il' },
  error: null,
};

function wire(options: { contact?: unknown; invoices?: unknown[]; payments?: unknown[] }) {
  from.mockReset();
  from.mockImplementation((table: string) => {
    if (table === 'crm_contacts') {
      return builder(
        options.contact === undefined ? CONTACT : { data: options.contact, error: null }
      );
    }
    if (table === 'payment_invoices') return builder({ data: options.invoices ?? [], error: null });
    return builder({ data: options.payments ?? [], error: null });
  });
}

describe('buildContactStatement', () => {
  it('reads "open" from the catalog rather than restating it', async () => {
    wire({});
    const statement = await buildContactStatement({ userId: 'u1', contactId: 'c1' });

    // The single definition of the business rule, not a local copy.
    expect(statement.openStatuses).toEqual(
      CATALOG.entities.invoices.fields.status.semanticTerms?.unpaid
    );
    expect(statement.openStatuses).toEqual(['sent', 'overdue']);
  });

  it('totals open invoices and payments separately', async () => {
    wire({
      invoices: [
        { id: 'i1', invoice_number: 'INV-1', amount: 200, currency: 'USD', status: 'sent', due_date: '2026-09-01', created_at: '2026-08-01', description: 'Session' },
        { id: 'i2', invoice_number: 'INV-2', amount: 99, currency: 'USD', status: 'overdue', due_date: '2026-08-01', created_at: '2026-07-01', description: null },
      ],
      payments: [
        { id: 'p1', amount: 333.33, currency: 'USD', status: 'succeeded', paid_at: '2026-09-02', created_at: '2026-09-02', description: 'Payment 1 of 3', invoice: null },
      ],
    });

    const statement = await buildContactStatement({ userId: 'u1', contactId: 'c1' });

    expect(statement.openInvoices).toHaveLength(2);
    expect(statement.openTotals).toEqual([{ currency: 'USD', amount: 299, count: 2 }]);
    expect(statement.paidTotals).toEqual([{ currency: 'USD', amount: 333.33, count: 1 }]);
  });

  it('never adds two currencies together', async () => {
    /*
     * The failure this prevents is silent: summing ₪ and $ produces a single
     * plausible number, and it would be quoted at a client as what they owe.
     */
    wire({
      invoices: [
        { id: 'i1', invoice_number: 'INV-1', amount: 100, currency: 'USD', status: 'sent', due_date: null, created_at: '2026-08-01', description: null },
        { id: 'i2', invoice_number: 'INV-2', amount: 400, currency: 'ILS', status: 'sent', due_date: null, created_at: '2026-08-02', description: null },
      ],
    });

    const statement = await buildContactStatement({ userId: 'u1', contactId: 'c1' });

    expect(statement.openTotals).toEqual([
      { currency: 'USD', amount: 100, count: 1 },
      { currency: 'ILS', amount: 400, count: 1 },
    ]);
  });

  it('rounds float drift to real money', async () => {
    // 0.1 + 0.2 is 0.30000000000000004, and the ledger aggregate already
    // returns 632.3299999999999 for exactly this reason.
    wire({
      payments: [
        { id: 'p1', amount: 0.1, currency: 'USD', status: 'succeeded', paid_at: null, created_at: '2026-09-01', description: null, invoice: null },
        { id: 'p2', amount: 0.2, currency: 'USD', status: 'succeeded', paid_at: null, created_at: '2026-09-02', description: null, invoice: null },
      ],
    });

    const statement = await buildContactStatement({ userId: 'u1', contactId: 'c1' });
    expect(statement.paidTotals[0].amount).toBe(0.3);
  });

  it('carries the line items, not just the totals', async () => {
    wire({
      payments: [
        { id: 'p1', amount: 99, currency: 'USD', status: 'succeeded', paid_at: '2026-09-03', created_at: '2026-09-03', description: 'Payment for invoice INV-00002', invoice: { invoice_number: 'INV-00002' } },
      ],
    });

    const statement = await buildContactStatement({ userId: 'u1', contactId: 'c1' });

    expect(statement.payments[0]).toMatchObject({
      amount: 99,
      description: 'Payment for invoice INV-00002',
      invoice_number: 'INV-00002',
    });
  });

  it('reports an empty statement rather than inventing one', async () => {
    wire({});
    const statement = await buildContactStatement({ userId: 'u1', contactId: 'c1' });

    expect(statement.openInvoices).toEqual([]);
    expect(statement.openTotals).toEqual([]);
    expect(statement.truncated).toBe(false);
    expect(statement.contact.name).toBe('דויד המלך');
  });

  it('refuses a contact that is not the caller’s', async () => {
    // The query filters on user_id, so another tenant's contact returns nothing.
    wire({ contact: null });

    await expect(buildContactStatement({ userId: 'u1', contactId: 'someone-elses' })).rejects.toThrow(
      ContactStatementError
    );
  });
});
