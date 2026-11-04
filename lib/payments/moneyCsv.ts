/**
 * The money export's columns, rows and file, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT A FUNCTION INSIDE THE LIST
 *
 * Two surfaces now export the same money: the orders list and the money page
 * that replaces it. An export is a document somebody reconciles a bank
 * statement against, so two implementations of "what are the columns" is two
 * answers to a question that must have one — and the second one drifts
 * silently, because a CSV that opens and has the right headings looks correct
 * whatever is in it.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Choosing the rows. That is the caller's question and the two callers answer
 * it differently: a hand-picked selection, or every row the filter matches
 * re-asked of the route without the page window. This module is handed rows
 * and writes them.
 *
 * `formatDate` is injected for the same reason it is a callback in the list:
 * the cell must read as the row on screen does, in the business's own
 * timezone, and this module has no reader.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/moneyCsv
 */

import { toCsvFile } from '@/lib/payments/csv';
import type { MoneyItem } from '@/lib/payments/moneyItems';

/** The columns and their cells, headings first. */
export function buildMoneyCsvRows(
  items: MoneyItem[],
  t: (key: string) => string,
  formatDate: (date: string) => string
): (string | number | null)[][] {
  return [
    [
      /* The client leads, as the row on screen does. The old file opened with
         the service name and never named the person at all, which is the
         column an owner reconciling a bank statement actually needs. */
      t('payments.export.client') || 'Client',
      t('payments.export.item') || 'Item',
      t('payments.export.method') || 'How',
      t('payments.export.status') || 'Status',
      t('payments.export.amount') || 'Amount',
      t('payments.export.refunded_amount') || 'Refunded',
      t('payments.export.currency') || 'Currency',
      t('payments.export.date') || 'Date',
    ],
    ...items.map(item => [
      item.contactName ?? '',
      item.title,
      item.method,
      item.status,
      item.amount.toFixed(2),
      item.refunded ? item.refunded.toFixed(2) : '',
      item.currency,
      /* The date the ROW shows, not the raw instant. This exported
         `item.date` whole, so a cell read `2026-10-14T09:00:00.000Z` — a
         timestamp in UTC, for a row whose date on screen is the business's
         own and may be the day before or after. */
      item.date ? formatDate(item.date) : '',
    ]),
  ];
}

/**
 * Write the rows to a file the reader's browser saves.
 *
 * Here rather than at each call site so the file name and the Blob handling
 * cannot differ between the two exports either.
 */
export function downloadMoneyCsv(
  items: MoneyItem[],
  t: (key: string) => string,
  formatDate: (date: string) => string
): void {
  const url = URL.createObjectURL(
    /* `toCsvFile` quotes, keeps the BOM Excel needs for Hebrew, and
       neutralises a cell a spreadsheet would EVALUATE — every name in here
       was typed into a public form. See `lib/payments/csv`. */
    new Blob([toCsvFile(buildMoneyCsvRows(items, t, formatDate))], {
      type: 'text/csv;charset=utf-8;',
    })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `money-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
