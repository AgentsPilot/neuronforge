import {
  buildLedgerRows,
  summariseLedger,
  ledgerColumns,
  buildInvoiceRows,
  DEFAULT_LEDGER_OPTIONS,
  type LedgerExportOptions,
} from '../ledgerExport';

const labels = { payment: 'Payment', refund: 'Refund' };
const opts = (over: Partial<LedgerExportOptions> = {}): LedgerExportOptions => ({
  ...DEFAULT_LEDGER_OPTIONS,
  ...over,
});

const payment = (over: Partial<Parameters<typeof buildLedgerRows>[0]['payments'][0]> = {}) => ({
  amount: 100,
  currency: 'ILS',
  status: 'succeeded',
  created_at: '2026-03-10T09:00:00Z',
  ...over,
});

const refund = (over: Partial<Parameters<typeof buildLedgerRows>[0]['refunds'][0]> = {}) => ({
  amount: 40,
  currency: 'ILS',
  status: 'succeeded',
  created_at: '2026-03-11T09:00:00Z',
  ...over,
});

describe('buildLedgerRows', () => {
  it('gives a refund its own row rather than a column on the sale', () => {
    const rows = buildLedgerRows({
      payments: [payment()],
      refunds: [refund()],
      options: opts(),
      labels,
    });

    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.type)).toEqual(['Payment', 'Refund']);
  });

  /*
   * The property the whole export exists for. A refund issued in April against
   * a March payment must be dated April, or the file silently restates a period
   * that was already reported.
   */
  it('dates a refund by when it settled, not by the sale it reverses', () => {
    const rows = buildLedgerRows({
      payments: [payment({ paid_at: '2026-03-02T10:00:00Z' })],
      refunds: [
        refund({ created_at: '2026-04-01T10:00:00Z', succeeded_at: '2026-04-05T10:00:00Z' }),
      ],
      options: opts(),
      labels,
    });

    expect(rows[0].date).toBe('2026-03-02');
    expect(rows[1].date).toBe('2026-04-05');
  });

  // `succeeded_at` is null on a refund recorded before that column was stamped;
  // falling back to created_at keeps the row in the file rather than dropping it.
  it('falls back to the created date when a refund never recorded a settle time', () => {
    const rows = buildLedgerRows({
      payments: [],
      refunds: [refund({ succeeded_at: null, created_at: '2026-04-09T23:30:00Z' })],
      options: opts(),
      labels,
    });

    expect(rows[0].date).toBe('2026-04-09');
  });

  it('signs refunds negative so the column sums to what was kept', () => {
    const rows = buildLedgerRows({
      payments: [payment({ amount: 100 })],
      refunds: [refund({ amount: 40 })],
      options: opts(),
      labels,
    });

    const total = rows.reduce((sum, r) => sum + Number(r.gross), 0);
    expect(total).toBe(60);
  });

  it('carves the tax out of each row when the business configured one', () => {
    const rows = buildLedgerRows({
      payments: [payment({ amount: 117 })],
      refunds: [],
      options: opts(),
      taxSettings: { invoice_prices_include_tax: true, invoice_tax_rate: 17 },
      labels,
    });

    expect(rows[0].gross).toBe(117);
    expect(rows[0].tax).toBe(17);
    expect(rows[0].net_of_tax).toBe(100);
  });

  /*
   * A partial refund reverses only its own share of the tax. Reversing the
   * original invoice's full tax on a partial refund is how a return ends up
   * claiming back more than was ever charged.
   */
  it('reverses only the refunded share of the tax', () => {
    const rows = buildLedgerRows({
      payments: [],
      refunds: [refund({ amount: 58.5 })],
      options: opts(),
      taxSettings: { invoice_prices_include_tax: true, invoice_tax_rate: 17 },
      labels,
    });

    expect(rows[0].gross).toBe(-58.5);
    expect(rows[0].tax).toBe(-8.5);
    expect(rows[0].net_of_tax).toBe(-50);
  });

  it('leaves tax empty for a business that never configured one', () => {
    const rows = buildLedgerRows({
      payments: [payment()],
      refunds: [],
      options: opts(),
      taxSettings: null,
      labels,
    });

    expect(rows[0].tax).toBeNull();
    expect(rows[0].net_of_tax).toBeNull();
  });

  /*
   * Stripe keeps the original fee on a refund, so nothing is returned. Zero
   * would state that this movement cost nothing, which reads as "refunds are
   * free" — the cost sits on the payment's row where it was incurred.
   */
  it('leaves a refund fee empty rather than zero', () => {
    const rows = buildLedgerRows({
      payments: [],
      refunds: [refund()],
      options: opts(),
      labels,
    });

    expect(rows[0].fee).toBeNull();
    expect(rows[0].settled).toBeNull();
  });

  it('keeps an unknown fee empty, distinct from a fee of zero', () => {
    const rows = buildLedgerRows({
      payments: [payment({ processor_fee: null, net_amount: null })],
      refunds: [],
      options: opts(),
      labels,
    });

    expect(rows[0].fee).toBeNull();
  });

  it('honours what the caller asked to leave out', () => {
    const rows = buildLedgerRows({
      payments: [payment()],
      refunds: [refund()],
      options: opts({ includeRefunds: false }),
      labels,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('Payment');
  });
});

describe('summariseLedger', () => {
  it('totals per currency and never across them', () => {
    const rows = buildLedgerRows({
      payments: [
        payment({ amount: 100, currency: 'ILS' }),
        payment({ amount: 50, currency: 'USD' }),
      ],
      refunds: [refund({ amount: 30, currency: 'ILS' })],
      options: opts(),
      labels,
    });

    const summary = summariseLedger(rows);
    expect(summary).toHaveLength(2);

    const ils = summary.find(s => s.currency === 'ILS')!;
    expect(ils.gross).toBe(100);
    expect(ils.refunded).toBe(-30);
    expect(ils.net).toBe(70);
    expect(ils.paymentsCount).toBe(1);
    expect(ils.refundsCount).toBe(1);

    const usd = summary.find(s => s.currency === 'USD')!;
    expect(usd.net).toBe(50);
  });

  /*
   * Stripe charges the fee in the SETTLEMENT currency, so a business settling in
   * ILS that takes a USD charge gets an ILS fee. Adding it to the USD column
   * would be a silent unit error in the one figure a summary exists to make
   * trustworthy.
   */
  it('refuses to sum a fee denominated in another currency', () => {
    const rows = buildLedgerRows({
      payments: [
        payment({ amount: 50, currency: 'USD', processor_fee: 2, net_amount: 48, fee_currency: 'ILS' }),
      ],
      refunds: [],
      options: opts(),
      labels,
    });

    const usd = summariseLedger(rows).find(s => s.currency === 'USD')!;
    expect(usd.fees).toBeNull();
  });

  it('sums the fee when it is in the payment currency', () => {
    const rows = buildLedgerRows({
      payments: [
        payment({ amount: 100, currency: 'ILS', processor_fee: 3.2, net_amount: 96.8, fee_currency: 'ILS' }),
      ],
      refunds: [],
      options: opts(),
      labels,
    });

    const ils = summariseLedger(rows).find(s => s.currency === 'ILS')!;
    expect(ils.fees).toBe(3.2);
    expect(ils.settled).toBe(96.8);
  });
});

describe('ledgerColumns', () => {
  it('drops the tax and fee columns when they were not asked for', () => {
    const ids = ledgerColumns(opts({ includeTax: false, includeFees: false }), {}).map(c => c.id);
    expect(ids).not.toContain('tax');
    expect(ids).not.toContain('fee');
    expect(ids).toContain('gross');
  });

  // The header row and every data row are built from this one list, so a column
  // present in one and absent from the other is not expressible.
  it('always leads with the date, which is what the file is sorted by', () => {
    expect(ledgerColumns(opts(), {})[0].id).toBe('date');
  });
});

describe('buildInvoiceRows', () => {
  /*
   * The accrual view's whole difference from the ledger: an invoice is dated
   * when it was ISSUED, not when it was paid. An invoice raised in March and
   * paid in April belongs to March on an accrual basis and to April on a cash
   * basis, and the two sheets exist so nobody has to guess which the file means.
   */
  it('dates an invoice by issue, not by payment', () => {
    const rows = buildInvoiceRows(
      [
        {
          invoice_number: 'INV-1',
          status: 'paid',
          amount: 200,
          currency: 'ILS',
          created_at: '2026-03-28T12:00:00Z',
          paid_at: '2026-04-03T12:00:00Z',
        },
      ],
      opts()
    );

    expect(rows[0].date).toBe('2026-03-28');
    expect(rows[0].paid_date).toBe('2026-04-03');
  });

  it('leaves an unpaid date empty rather than labelling it', () => {
    const rows = buildInvoiceRows(
      [
        {
          invoice_number: 'INV-2',
          status: 'sent',
          amount: 200,
          currency: 'ILS',
          created_at: '2026-03-28T12:00:00Z',
        },
      ],
      opts()
    );

    expect(rows[0].paid_date).toBe('');
  });
});
