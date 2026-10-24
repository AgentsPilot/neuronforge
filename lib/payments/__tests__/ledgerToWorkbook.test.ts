/**
 * ledgerToWorkbook writes the accountant's .xlsx. Read it back with SheetJS to
 * prove the file still opens with the right sheets after a SheetJS upgrade.
 */

import * as XLSX from 'xlsx';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { ledgerToWorkbook, type LedgerReport } from '@/lib/payments/ledgerService';
import { DEFAULT_LEDGER_OPTIONS } from '@/lib/payments/ledgerExport';

const report: LedgerReport = {
  period: { from: '2026-08-01', to: '2026-08-31' },
  options: { ...DEFAULT_LEDGER_OPTIONS, includeInvoices: true },
  columns: [
    { id: 'date', header: 'Date', type: 'date' },
    { id: 'client', header: 'Client', type: 'text' },
    { id: 'amount', header: 'Amount', type: 'number' },
  ],
  rows: [
    { date: '2026-08-03', client: 'דנה כהן', amount: 250 },
    { date: '2026-08-10', client: 'Acme, Ltd', amount: -50 },
  ],
  invoiceColumns: [
    { id: 'number', header: 'Invoice', type: 'text' },
    { id: 'total', header: 'Total', type: 'number' },
  ],
  invoiceRows: [{ number: 'INV-0001', total: 250 }],
  summary: [
    {
      currency: 'ILS',
      paymentsCount: 1,
      refundsCount: 1,
      gross: 250,
      refunded: 50,
      net: 200,
      tax: null,
      fees: 7.5,
      settled: null,
    },
  ],
};

describe('ledgerToWorkbook', () => {
  it('writes a workbook with the ledger, summary and invoice sheets', async () => {
    const buffer = await ledgerToWorkbook(report);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    expect(workbook.SheetNames).toEqual(['Ledger', 'Summary', 'Invoices issued']);

    const ledger = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets.Ledger, { header: 1 });
    expect(ledger[0]).toEqual(['Date', 'Client', 'Amount']);
    expect(ledger[1]).toEqual(['2026-08-03', 'דנה כהן', 250]);

    const summary = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets.Summary, { header: 1 });
    expect(summary[1].slice(0, 6)).toEqual(['ILS', 1, 1, 250, 50, 200]);

    const invoices = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets['Invoices issued'], { header: 1 });
    expect(invoices[1]).toEqual(['INV-0001', 250]);
  });

  it('omits the invoice sheet when invoices are not requested', async () => {
    const buffer = await ledgerToWorkbook({
      ...report,
      options: { ...report.options, includeInvoices: false },
    });

    expect(XLSX.read(buffer, { type: 'buffer' }).SheetNames).toEqual(['Ledger', 'Summary']);
  });
});
