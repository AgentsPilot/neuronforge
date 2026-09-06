/**
 * The ledger, in the shape somebody else's accountant can use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN ACCOUNTANT ACTUALLY ASKS FOR
 *
 * Not a screenshot of the payments list. Four things, and the export is built
 * around them:
 *
 *   1. EVERY MOVEMENT ON ITS OWN DATE. A refund is money leaving on the day it
 *      left, not a column on the sale it reverses. Folded into the sale's row —
 *      which is what a "refunded" column does — an April refund silently
 *      restates March, and the file stops agreeing with the bank statement.
 *
 *   2. THE SPLIT. Gross, the tax inside it, and the net. A business that states
 *      its prices include tax owes that split per row; one that does not gets
 *      no tax columns at all rather than a column of zeros.
 *
 *   3. WHAT THE PROCESSOR KEPT. The fee is a deductible expense and the
 *      difference between what the client paid and what arrived. Without it the
 *      export cannot be reconciled against a payout, which is the single most
 *      common reason one gets sent back.
 *
 *   4. A REFERENCE TO MATCH ON. The processor's id for the bank line, and the
 *      invoice number for the document that was issued.
 *
 * CASH BASIS vs ACCRUAL BASIS
 *
 * Payments answer "what money moved" — cash basis. Invoices answer "what was
 * billed" — accrual basis. They are different questions with different totals
 * and different dates, and which one is wanted depends on the jurisdiction and
 * the business's basis. So both are offered and neither is assumed.
 *
 * WHY THE FORMATTING RULES ARE NOT COSMETIC
 *
 * This runs for businesses anywhere, so the file has to survive crossing a
 * border:
 *
 *   - Dates are ISO 8601. "03/09/2026" is two different days depending on who
 *     opens it, and an accountant will not know which one was meant.
 *   - Amounts are bare numbers: no symbols, no thousands separators, a "."
 *     decimal. Currency lives in its own ISO 4217 column. A cell reading
 *     "₪1,234.50" is text, and text does not add up.
 *   - Refunds are NEGATIVE, so the amount column sums to what was actually
 *     kept. A positive refund in a money column is how a total ends up double.
 *   - Totals are PER CURRENCY, never summed across. Adding a ¥ refund to a £
 *     payment is worse than reporting nothing.
 *   - One header row, one row per fact, no merged cells — the file is read by
 *     software at least as often as by a person.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/ledgerExport
 */

import { taxLineFor, type TaxLineSettings } from './taxLine';
import { refundReasonInEnglish } from './refundReasons';

/** What the caller asked to be in the file. */
export interface LedgerExportOptions {
  /** Money received. */
  includePayments: boolean;
  /** Money returned, as its own dated rows. */
  includeRefunds: boolean;
  /** Documents issued — the accrual-basis view, on its own sheet. */
  includeInvoices: boolean;
  /** What the processor kept, and what actually settled. */
  includeFees: boolean;
  /** Gross / tax / net columns, when the business has configured tax. */
  includeTax: boolean;
  /** Processor and document references, for reconciliation. */
  includeReferences: boolean;
}

export const DEFAULT_LEDGER_OPTIONS: LedgerExportOptions = {
  includePayments: true,
  includeRefunds: true,
  includeInvoices: false,
  includeFees: true,
  includeTax: true,
  includeReferences: true,
};

/** A payment, as the database holds it. */
export interface LedgerPaymentInput {
  amount: number;
  currency: string;
  status: string;
  payment_method?: string | null;
  description?: string | null;
  paid_at?: string | null;
  created_at: string;
  processor_fee?: number | null;
  net_amount?: number | null;
  fee_currency?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_charge_id?: string | null;
  invoice_number?: string | null;
  client_name?: string | null;
  client_email?: string | null;
}

/** A refund, from the append-only ledger. */
export interface LedgerRefundInput {
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  processor_refund_id?: string | null;
  succeeded_at?: string | null;
  created_at: string;
  description?: string | null;
  payment_method?: string | null;
  invoice_number?: string | null;
  client_name?: string | null;
  client_email?: string | null;
}

/** An invoice, for the accrual view. */
export interface LedgerInvoiceInput {
  invoice_number: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
  due_date?: string | null;
  paid_at?: string | null;
  sent_at?: string | null;
  client_name?: string | null;
  client_email?: string | null;
  refunded_amount?: number | null;
}

/** One row, keyed by column id. Values stay typed — numbers are numbers. */
export type LedgerRow = Record<string, string | number | null>;

export interface LedgerColumn {
  id: string;
  /** Header text. Translated by the caller; this module never guesses a locale. */
  header: string;
  type: 'text' | 'number' | 'date';
}

/**
 * ISO 8601, always.
 *
 * Takes the calendar day in UTC rather than the viewer's zone: a payment must
 * not move between December and January because the file was opened in Sydney.
 */
const isoDate = (value: string | null | undefined, fallback: string): string =>
  (value || fallback).slice(0, 10);

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The columns this export will have, given what was asked for.
 *
 * Built once and shared by the header row and every data row, so a column can
 * never appear in one and not the other.
 */
export function ledgerColumns(
  options: LedgerExportOptions,
  headers: Record<string, string>
): LedgerColumn[] {
  const columns: LedgerColumn[] = [
    { id: 'date', header: headers.date ?? 'Date', type: 'date' },
    { id: 'type', header: headers.type ?? 'Type', type: 'text' },
    { id: 'client', header: headers.client ?? 'Client', type: 'text' },
    { id: 'description', header: headers.description ?? 'Description', type: 'text' },
    { id: 'gross', header: headers.gross ?? 'Gross', type: 'number' },
  ];

  if (options.includeTax) {
    columns.push(
      { id: 'tax', header: headers.tax ?? 'Tax', type: 'number' },
      { id: 'net_of_tax', header: headers.net_of_tax ?? 'Net of tax', type: 'number' }
    );
  }

  columns.push({ id: 'currency', header: headers.currency ?? 'Currency', type: 'text' });

  if (options.includeFees) {
    columns.push(
      { id: 'fee', header: headers.fee ?? 'Processor fee', type: 'number' },
      // Named "settled", not "net": with tax columns present there are two
      // different nets on the row and calling both of them net is how the wrong
      // one gets summed.
      { id: 'settled', header: headers.settled ?? 'Settled', type: 'number' },
      { id: 'fee_currency', header: headers.fee_currency ?? 'Fee currency', type: 'text' }
    );
  }

  columns.push(
    { id: 'method', header: headers.method ?? 'Method', type: 'text' },
    { id: 'status', header: headers.status ?? 'Status', type: 'text' }
  );

  if (options.includeReferences) {
    columns.push(
      { id: 'document', header: headers.document ?? 'Document', type: 'text' },
      { id: 'reference', header: headers.reference ?? 'Reference', type: 'text' },
      { id: 'email', header: headers.email ?? 'Client email', type: 'text' }
    );
  }

  columns.push({ id: 'reason', header: headers.reason ?? 'Reason', type: 'text' });

  return columns;
}

interface BuildInput {
  payments: LedgerPaymentInput[];
  refunds: LedgerRefundInput[];
  options: LedgerExportOptions;
  /** The business's tax settings, or null when it has not configured any. */
  taxSettings?: TaxLineSettings | null;
  /** Word for a payment row and a refund row, in the reader's language. */
  labels: { payment: string; refund: string };
}

/**
 * The ledger rows, chronological.
 *
 * Sorted by date only — not by date then type — because within a day the file
 * has no better claim about ordering than the dates it was given, and inventing
 * one would imply a sequence that may not have happened.
 */
export function buildLedgerRows(input: BuildInput): LedgerRow[] {
  const { payments, refunds, options, taxSettings, labels } = input;
  const rows: LedgerRow[] = [];

  if (options.includePayments) {
    for (const p of payments) {
      const gross = Number(p.amount) || 0;
      const tax = options.includeTax ? taxLineFor(gross, p.currency, taxSettings) : null;
      const fee = p.processor_fee == null ? null : Number(p.processor_fee);

      rows.push({
        date: isoDate(p.paid_at, p.created_at),
        type: labels.payment,
        client: p.client_name || '',
        description: p.description || '',
        gross: round2(gross),
        tax: tax ? tax.amount : null,
        net_of_tax: tax ? tax.net : null,
        currency: p.currency?.toUpperCase() || '',
        fee,
        settled: p.net_amount == null ? null : Number(p.net_amount),
        fee_currency: p.fee_currency?.toUpperCase() || (fee == null ? '' : p.currency?.toUpperCase() || ''),
        method: p.payment_method || '',
        status: p.status,
        document: p.invoice_number || '',
        reference: p.stripe_payment_intent_id || p.stripe_charge_id || '',
        email: p.client_email || '',
        reason: '',
      });
    }
  }

  if (options.includeRefunds) {
    for (const r of refunds) {
      const gross = Number(r.amount) || 0;

      /*
       * Tax comes back with the money.
       *
       * Carved out of the REFUNDED amount, not the original: a partial refund
       * reverses only its own share of the tax, and `taxLineFor` is inclusive
       * arithmetic on whatever it is handed, so the proportion is right by
       * construction.
       */
      const tax = options.includeTax ? taxLineFor(gross, r.currency, taxSettings) : null;

      rows.push({
        // The date the money LEFT. `succeeded_at` and `created_at` differ
        // whenever a refund settled after a retry, and the period it belongs to
        // is the one it settled in.
        date: isoDate(r.succeeded_at, r.created_at),
        type: labels.refund,
        client: r.client_name || '',
        description: r.description || '',
        gross: -round2(gross),
        tax: tax ? -tax.amount : null,
        net_of_tax: tax ? -tax.net : null,
        currency: r.currency?.toUpperCase() || '',
        /*
         * No fee on a refund, and NULL rather than 0.
         *
         * The processor keeps the original fee when a payment is refunded, so
         * nothing is returned here — but writing 0 would state that a fee of
         * zero was charged on this movement, which invites the reader to
         * conclude the refund was free. It was not: the cost sits on the
         * original payment's row, where it was actually incurred.
         */
        fee: null,
        settled: null,
        fee_currency: '',
        method: r.payment_method || '',
        status: r.status,
        document: r.invoice_number || '',
        reference: r.processor_refund_id || '',
        email: r.client_email || '',
        // Spelled out, not the stored key. A Reason column reading `no_show`
        // is an identifier; the file is for someone with no access to what that
        // means. Free text the owner typed passes through untouched.
        reason: refundReasonInEnglish(r.reason),
      });
    }
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return rows;
}

export interface CurrencyTotals {
  currency: string;
  paymentsCount: number;
  refundsCount: number;
  gross: number;
  refunded: number;
  net: number;
  tax: number | null;
  fees: number | null;
  settled: number | null;
}

/**
 * Totals, per currency and never across.
 *
 * Fees are summed only where the fee is denominated in the same currency as the
 * payment. Stripe charges in the SETTLEMENT currency, so a business settling in
 * ILS that takes a USD charge gets an ILS fee — adding it to a USD column would
 * be a silent unit error, and the whole point of a summary is that it can be
 * trusted without checking.
 */
export function summariseLedger(rows: LedgerRow[]): CurrencyTotals[] {
  const byCurrency = new Map<string, CurrencyTotals>();

  for (const row of rows) {
    const currency = String(row.currency || '');
    if (!currency) continue;

    const existing = byCurrency.get(currency) ?? {
      currency,
      paymentsCount: 0,
      refundsCount: 0,
      gross: 0,
      refunded: 0,
      net: 0,
      tax: null,
      fees: null,
      settled: null,
    };

    const amount = Number(row.gross) || 0;

    if (amount >= 0) {
      existing.paymentsCount += 1;
      existing.gross += amount;
    } else {
      existing.refundsCount += 1;
      existing.refunded += amount;
    }

    if (row.tax != null) {
      existing.tax = (existing.tax ?? 0) + Number(row.tax);
    }

    const feeCurrency = String(row.fee_currency || '');
    if (row.fee != null && feeCurrency === currency) {
      existing.fees = (existing.fees ?? 0) + Number(row.fee);
      if (row.settled != null) {
        existing.settled = (existing.settled ?? 0) + Number(row.settled);
      }
    }

    byCurrency.set(currency, existing);
  }

  return [...byCurrency.values()]
    .map(totals => ({
      ...totals,
      gross: round2(totals.gross),
      refunded: round2(totals.refunded),
      // Gross plus a negative refunded — what the business actually kept.
      net: round2(totals.gross + totals.refunded),
      tax: totals.tax == null ? null : round2(totals.tax),
      fees: totals.fees == null ? null : round2(totals.fees),
      settled: totals.settled == null ? null : round2(totals.settled),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * The accrual view: what was billed, regardless of what has been paid.
 *
 * Dated by ISSUE date, not payment date — that is the whole difference from the
 * ledger sheet, and an invoice's own date is what an accrual-basis return is
 * built from.
 */
export function buildInvoiceRows(
  invoices: LedgerInvoiceInput[],
  options: LedgerExportOptions,
  taxSettings?: TaxLineSettings | null
): LedgerRow[] {
  return invoices
    .map(invoice => {
      const gross = Number(invoice.amount) || 0;
      const tax = options.includeTax ? taxLineFor(gross, invoice.currency, taxSettings) : null;

      return {
        date: isoDate(invoice.created_at, invoice.created_at),
        document: invoice.invoice_number,
        client: invoice.client_name || '',
        email: invoice.client_email || '',
        gross: round2(gross),
        tax: tax ? tax.amount : null,
        net_of_tax: tax ? tax.net : null,
        currency: invoice.currency?.toUpperCase() || '',
        status: invoice.status,
        due_date: invoice.due_date ? invoice.due_date.slice(0, 10) : '',
        // Empty, not "unpaid" — an absent date is a fact, a word for it is an
        // interpretation the reader can make themselves.
        paid_date: invoice.paid_at ? invoice.paid_at.slice(0, 10) : '',
        refunded: invoice.refunded_amount ? round2(Number(invoice.refunded_amount)) : null,
      } satisfies LedgerRow;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function invoiceColumns(
  options: LedgerExportOptions,
  headers: Record<string, string>
): LedgerColumn[] {
  const columns: LedgerColumn[] = [
    { id: 'date', header: headers.issue_date ?? 'Issue date', type: 'date' },
    { id: 'document', header: headers.document ?? 'Document', type: 'text' },
    { id: 'client', header: headers.client ?? 'Client', type: 'text' },
    { id: 'gross', header: headers.gross ?? 'Gross', type: 'number' },
  ];

  if (options.includeTax) {
    columns.push(
      { id: 'tax', header: headers.tax ?? 'Tax', type: 'number' },
      { id: 'net_of_tax', header: headers.net_of_tax ?? 'Net of tax', type: 'number' }
    );
  }

  columns.push(
    { id: 'currency', header: headers.currency ?? 'Currency', type: 'text' },
    { id: 'status', header: headers.status ?? 'Status', type: 'text' },
    { id: 'due_date', header: headers.due_date ?? 'Due date', type: 'date' },
    { id: 'paid_date', header: headers.paid_date ?? 'Paid date', type: 'date' },
    { id: 'refunded', header: headers.refunded ?? 'Refunded', type: 'number' }
  );

  if (options.includeReferences) {
    columns.push({ id: 'email', header: headers.email ?? 'Client email', type: 'text' });
  }

  return columns;
}
