/**
 * The ledger as data, for anything that needs it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The ledger was already built, shaped and tested — `lib/payments/ledgerExport`
 * knows the rules about dates, signs, tax and per-currency totals. But the
 * GATHERING lived inside `GET /api/payments/ledger/export`: the four queries,
 * the tolerant tax lookup, and the row mapping were all in the HTTP handler.
 *
 * That made the ledger reachable exactly one way — an authenticated browser
 * download. Nothing on the server could ask for it. So "send my accountant last
 * month's ledger" had no seam to hang off: an automation would have had to call
 * the platform's own HTTP endpoint and forge a session to do it.
 *
 * This module is that seam. It takes a user id and a period and returns the
 * report as data — rows, columns, and the per-currency summary. The route
 * becomes a formatter, and everything else (a scheduled send, a chat action, a
 * digest email) composes the same function with the same numbers.
 *
 * SERVER ONLY, and user-scoped: every query filters on `user_id`. The caller is
 * responsible for having established WHOSE ledger it is asking for.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/ledgerService
 */

import 'server-only';

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  buildLedgerRows,
  buildInvoiceRows,
  ledgerColumns,
  invoiceColumns,
  summariseLedger,
  DEFAULT_LEDGER_OPTIONS,
  type CurrencyTotals,
  type LedgerColumn,
  type LedgerExportOptions,
  type LedgerRow,
} from '@/lib/payments/ledgerExport';
import type { TaxLineSettings } from '@/lib/payments/taxLine';

const logger = createLogger({ module: 'LedgerService' });

export interface LedgerReportRequest {
  /** Whose ledger. Every query is filtered on this. */
  userId: string;
  /** `YYYY-MM-DD`, inclusive. Omitted means "from the beginning". */
  from?: string;
  /** `YYYY-MM-DD`, inclusive of the closing day. Omitted means "until now". */
  to?: string;
  /** Partial: anything omitted falls back to `DEFAULT_LEDGER_OPTIONS`. */
  options?: Partial<LedgerExportOptions>;
}

export interface LedgerReport {
  period: { from: string | null; to: string | null };
  /** The options actually applied, after defaults. */
  options: LedgerExportOptions;
  rows: LedgerRow[];
  columns: LedgerColumn[];
  /** Empty unless `includeInvoices`. Invoices are a different table shape. */
  invoiceRows: LedgerRow[];
  invoiceColumns: LedgerColumn[];
  /**
   * Per-currency gross / refunded / net, plus tax and fees where known.
   *
   * This is what a human summary is written from — a business trading in two
   * currencies gets two entries, because summing them would invent a number.
   */
  summary: CurrencyTotals[];
}

/** Raised when the ledger cannot be read. Callers decide how loudly to fail. */
export class LedgerReadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LedgerReadError';
  }
}

const contactName = (contact: unknown): string => {
  const row = Array.isArray(contact) ? contact[0] : contact;
  if (!row) return '';
  const { first_name, last_name } = row as { first_name?: string; last_name?: string };
  return [first_name, last_name].filter(Boolean).join(' ');
};

const contactEmail = (contact: unknown): string => {
  const row = Array.isArray(contact) ? contact[0] : contact;
  return (row as { email?: string })?.email || '';
};

const invoiceNumber = (invoice: unknown): string => {
  const row = Array.isArray(invoice) ? invoice[0] : invoice;
  return (row as { invoice_number?: string })?.invoice_number || '';
};

/**
 * The ledger for one business over one period.
 *
 * Throws `LedgerReadError` when the data cannot be read — never returns a
 * half-populated report, because a ledger missing its refunds does not announce
 * itself as wrong; it just fails to balance.
 */
export async function buildLedgerReport(request: LedgerReportRequest): Promise<LedgerReport> {
  const { userId, from, to } = request;
  const options: LedgerExportOptions = { ...DEFAULT_LEDGER_OPTIONS, ...(request.options ?? {}) };

  /*
   * The tax settings, fetched TOLERANTLY.
   *
   * Its own query rather than a join, because PostgREST fails the whole
   * statement when a column is missing — and on a database where the tax
   * migration has not run, folding these into another select would take the
   * entire export down instead of costing three optional columns.
   */
  let taxSettings: TaxLineSettings | null = null;
  if (options.includeTax) {
    const { data } = await supabaseServer
      .from('business_profiles')
      .select('invoice_prices_include_tax, invoice_tax_rate, invoice_tax_label')
      .eq('user_id', userId)
      .maybeSingle();
    taxSettings = (data as TaxLineSettings) ?? null;
  }

  // Inclusive of the closing day: `to=2026-03-31` must contain the 31st.
  const upperBound = to ? `${to}T23:59:59.999Z` : null;

  /*
   * Money in. `succeeded` AND `refunded`, because a fully refunded payment
   * still happened — dropping it would leave its refund row unexplained and the
   * file would not balance.
   */
  const paymentsPromise = (async () => {
    if (!options.includePayments) return { data: [], error: null };
    let q = supabaseServer
      .from('payment_transactions')
      .select(
        'amount, currency, status, payment_method, description, paid_at, created_at, ' +
          'processor_fee, net_amount, fee_currency, stripe_payment_intent_id, stripe_charge_id, ' +
          'contact:crm_contacts(first_name, last_name, email), ' +
          'invoice:payment_invoices(invoice_number)'
      )
      .eq('user_id', userId)
      .in('status', ['succeeded', 'refunded'])
      .order('created_at', { ascending: true });
    if (from) q = q.gte('created_at', from);
    if (upperBound) q = q.lte('created_at', upperBound);
    return q;
  })();

  /*
   * Money out, filtered on when it SETTLED rather than when the row was
   * written — those differ whenever a refund succeeded after a retry, and the
   * period a refund belongs to is the one the money actually left in.
   */
  const refundsPromise = (async () => {
    if (!options.includeRefunds) return { data: [], error: null };
    let q = supabaseServer
      .from('payment_refunds')
      .select(
        'amount, currency, status, reason, processor_refund_id, succeeded_at, created_at, ' +
          'invoice:payment_invoices(invoice_number), ' +
          'transaction:payment_transactions(description, payment_method, contact:crm_contacts(first_name, last_name, email))'
      )
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .order('succeeded_at', { ascending: true });
    if (from) q = q.gte('succeeded_at', from);
    if (upperBound) q = q.lte('succeeded_at', upperBound);
    return q;
  })();

  const invoicesPromise = (async () => {
    if (!options.includeInvoices) return { data: [], error: null };
    let q = supabaseServer
      .from('payment_invoices')
      .select(
        'invoice_number, status, amount, currency, created_at, due_date, paid_at, sent_at, ' +
          'client_name, client_email, refunded_amount'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (from) q = q.gte('created_at', from);
    if (upperBound) q = q.lte('created_at', upperBound);
    return q;
  })();

  const [payments, refunds, invoices] = await Promise.all([
    paymentsPromise,
    refundsPromise,
    invoicesPromise,
  ]);

  const failure = payments.error || refunds.error || invoices.error;
  if (failure) {
    logger.error({ err: failure, userId }, 'Ledger read failed');
    throw new LedgerReadError('Could not read the ledger', failure);
  }

  const rows = buildLedgerRows({
    payments: ((payments.data ?? []) as unknown[]).map(p => {
      const row = p as Record<string, unknown>;
      return {
        amount: Number(row.amount),
        currency: String(row.currency ?? ''),
        status: String(row.status ?? ''),
        payment_method: row.payment_method as string | null,
        description: row.description as string | null,
        paid_at: row.paid_at as string | null,
        created_at: String(row.created_at),
        processor_fee: row.processor_fee as number | null,
        net_amount: row.net_amount as number | null,
        fee_currency: row.fee_currency as string | null,
        stripe_payment_intent_id: row.stripe_payment_intent_id as string | null,
        stripe_charge_id: row.stripe_charge_id as string | null,
        invoice_number: invoiceNumber(row.invoice),
        client_name: contactName(row.contact),
        client_email: contactEmail(row.contact),
      };
    }),
    refunds: ((refunds.data ?? []) as unknown[]).map(r => {
      const row = r as Record<string, unknown>;
      const tx = (Array.isArray(row.transaction) ? row.transaction[0] : row.transaction) as
        | Record<string, unknown>
        | null;
      return {
        amount: Number(row.amount),
        currency: String(row.currency ?? ''),
        status: String(row.status ?? ''),
        reason: row.reason as string | null,
        processor_refund_id: row.processor_refund_id as string | null,
        succeeded_at: row.succeeded_at as string | null,
        created_at: String(row.created_at),
        description: (tx?.description as string) ?? '',
        payment_method: (tx?.payment_method as string) ?? '',
        invoice_number: invoiceNumber(row.invoice),
        client_name: contactName(tx?.contact),
        client_email: contactEmail(tx?.contact),
      };
    }),
    options,
    taxSettings,
    labels: { payment: 'payment', refund: 'refund' },
  });

  const invoiceRowsBuilt = buildInvoiceRows(
    ((invoices.data ?? []) as unknown[]).map(i => i as never),
    options,
    taxSettings
  );

  return {
    period: { from: from ?? null, to: to ?? null },
    options,
    rows,
    columns: ledgerColumns(options, {}),
    invoiceRows: invoiceRowsBuilt,
    invoiceColumns: invoiceColumns(options, {}),
    summary: summariseLedger(rows),
  };
}

/** Cells in the order the columns declare, so header and body cannot diverge. */
export function toMatrix(
  columns: LedgerColumn[],
  rows: LedgerRow[]
): (string | number | null)[][] {
  return [columns.map(c => c.header), ...rows.map(row => columns.map(c => row[c.id] ?? ''))];
}

/** RFC 4180: everything quoted, quotes doubled, so a comma in a name survives. */
export function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

/**
 * The ledger as a CSV string, ready to attach or download.
 *
 * The BOM is what makes Excel read UTF-8. Without it Hebrew names arrive as
 * mojibake — and that is the client-name column.
 */
export function ledgerToCsv(report: LedgerReport, options?: { bom?: boolean }): string {
  const csv = toCsv(toMatrix(report.columns, report.rows));
  return options?.bom === false ? csv : `﻿${csv}`;
}

/**
 * The ledger as a real workbook.
 *
 * Lives here rather than in the route so an automation can attach the same file
 * a human downloads. A worksheet also sidesteps the separator problem: Excel in
 * many European locales splits CSV on ";" rather than ",", so a comma file opens
 * as one column per row. A worksheet has no separator to disagree about.
 */
export async function ledgerToWorkbook(report: LedgerReport): Promise<Buffer> {
  // Imported lazily: `xlsx` is a large dependency and the CSV path, which is
  // what most automations want, should not pay for it.
  const XLSX = await import('xlsx');

  const workbook = XLSX.utils.book_new();

  const ledgerSheet = XLSX.utils.aoa_to_sheet(toMatrix(report.columns, report.rows));
  ledgerSheet['!cols'] = report.columns.map(c => ({ wch: c.type === 'number' ? 12 : 18 }));
  XLSX.utils.book_append_sheet(workbook, ledgerSheet, 'Ledger');

  if (report.summary.length > 0) {
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['Currency', 'Payments', 'Refunds', 'Gross', 'Refunded', 'Net', 'Tax', 'Processor fees', 'Settled'],
      ...report.summary.map(s => [
        s.currency,
        s.paymentsCount,
        s.refundsCount,
        s.gross,
        s.refunded,
        s.net,
        s.tax ?? '',
        s.fees ?? '',
        s.settled ?? '',
      ]),
    ]);
    summarySheet['!cols'] = Array.from({ length: 9 }, () => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  }

  if (report.options.includeInvoices) {
    const invoiceSheet = XLSX.utils.aoa_to_sheet(toMatrix(report.invoiceColumns, report.invoiceRows));
    invoiceSheet['!cols'] = report.invoiceColumns.map(c => ({ wch: c.type === 'number' ? 12 : 18 }));
    // Named for the basis it serves, not just "Invoices" — the sheet exists to
    // answer the accrual question, and the name is the only place that says so.
    XLSX.utils.book_append_sheet(workbook, invoiceSheet, 'Invoices issued');
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** `ledger_2026-08-01_2026-08-31.csv` — the filename both paths agree on. */
export function ledgerFilename(report: LedgerReport, extension: 'csv' | 'xlsx'): string {
  const stamp = `${report.period.from || 'all'}_${report.period.to || 'now'}`;
  return `ledger_${stamp}.${extension}`;
}
