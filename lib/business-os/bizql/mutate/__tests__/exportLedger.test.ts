/**
 * `export_ledger` on its own — no contact, no send.
 *
 * The question this answers is whether the kernel can obtain a ledger as a
 * standalone capability, or only as a step inside an email flow. It goes
 * through `executeMutate`, so the catalog gate, the target rule and the handler
 * dispatch are all exercised rather than the handler being called directly.
 */

const from = jest.fn();

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (...args: unknown[]) => from(...args) },
}));

import { executeMutate } from '@/lib/business-os/bizql/mutate/MutateExecutor';

/** A query builder that resolves to `result` however it is filtered. */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};

  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'not', 'or']) {
    chain[method] = jest.fn(() => chain);
  }

  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.single = jest.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);

  return chain;
}

const PAYMENTS = [
  {
    amount: 200,
    currency: 'USD',
    status: 'succeeded',
    payment_method: 'card',
    description: 'Session',
    paid_at: '2026-05-02T10:00:00Z',
    created_at: '2026-05-02T10:00:00Z',
    processor_fee: 6.3,
    net_amount: 193.7,
    fee_currency: 'USD',
    stripe_payment_intent_id: 'pi_1',
    stripe_charge_id: 'ch_1',
    contact: { first_name: 'דויד', last_name: 'המלך', email: 'd@example.com' },
    invoice: { invoice_number: 'INV-1' },
  },
];

beforeEach(() => {
  from.mockReset();
  from.mockImplementation((table: string) => {
    if (table === 'payment_transactions') return builder({ data: PAYMENTS, error: null });
    if (table === 'business_profiles') {
      return builder({
        data: { invoice_prices_include_tax: false, invoice_tax_rate: null, invoice_tax_label: null },
        error: null,
      });
    }
    // Refunds and invoices: nothing in the period.
    return builder({ data: [], error: null });
  });
});

describe('business_profile.export_ledger, standalone', () => {
  it('runs with no target and no contact', async () => {
    /*
     * The whole point of the question. A ledger is about the business over a
     * period, not about a row, so the action is declared `needsTarget: false` —
     * if that were wrong, this call would be refused for want of a target id.
     */
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'business_profile',
        action: 'export_ledger',
        data: { period: 'last_quarter' },
      } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    expect(result.applied).toBe(true);
  });

  it('returns the period it resolved and a per-currency summary', async () => {
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'business_profile',
        action: 'export_ledger',
        data: { period: 'last_quarter' },
      } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    const row = result.row as Record<string, unknown>;

    // The named period became real dates — the caller never has to do calendar
    // arithmetic to ask for "last quarter".
    expect(typeof row.from).toBe('string');
    expect(typeof row.to).toBe('string');
    expect(row.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(row.rows).toBe(1);
    expect(row.summary).toEqual([
      expect.objectContaining({ currency: 'USD', gross: 200, paymentsCount: 1 }),
    ]);
  });

  it('defaults to the current month when no period is named', async () => {
    // "Export the ledger" is a complete request; it must not demand a period.
    const result = await executeMutate(
      { op: 'mutate', entity: 'business_profile', action: 'export_ledger', data: {} } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    const row = result.row as Record<string, unknown>;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    expect(String(row.from)).toStartWith?.(month) ?? expect(String(row.from).slice(0, 7)).toBe(month);
  });

  it('accepts explicit dates instead of a named period', async () => {
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'business_profile',
        action: 'export_ledger',
        data: { from: '2026-01-01', to: '2026-03-31' },
      } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    const row = result.row as Record<string, unknown>;
    expect(row.from).toBe('2026-01-01');
    expect(row.to).toBe('2026-03-31');
  });
  it('hands back the ledger rows when asked', async () => {
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'business_profile',
        action: 'export_ledger',
        data: { period: 'last_quarter', include_rows: true },
      } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    const row = result.row as Record<string, unknown>;
    expect(Array.isArray(row.items)).toBe(true);
    expect((row.items as unknown[]).length).toBe(1);
    expect(row.items_truncated).toBe(false);
  });

  it('renders a CSV the caller can attach directly', async () => {
    /*
     * base64 because that is what an email attachment takes: `performEmail`
     * accepts a base64 string, so this output composes into a send with no
     * conversion step in between.
     */
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'business_profile',
        action: 'export_ledger',
        data: { period: 'last_quarter', include_file: true, format: 'csv' },
      } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    const file = (result.row as Record<string, unknown>).file as Record<string, unknown>;

    expect(file.contentType).toBe('text/csv');
    expect(String(file.filename)).toMatch(/^ledger_.*\.csv$/);
    expect(Number(file.bytes)).toBeGreaterThan(0);

    // It is real content, not a placeholder: the header row survives a round trip.
    const decoded = Buffer.from(String(file.content), 'base64').toString('utf8');
    expect(decoded).toContain('Session');
  });

  it('omits rows and file unless asked', async () => {
    // A caller that wanted a total should not receive a table.
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'business_profile',
        action: 'export_ledger',
        data: { period: 'last_quarter' },
      } as never,
      { userId: 'u1', consumer: 'kernel' } as never
    );

    const row = result.row as Record<string, unknown>;
    expect(row.items).toBeUndefined();
    expect(row.file).toBeUndefined();
  });
});
