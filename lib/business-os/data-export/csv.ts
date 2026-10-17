// lib/business-os/data-export/csv.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §7): one CSV per section of
// the zip. PURE: no I/O.
//
// - UTF-8 with a BOM, so Excel opens Hebrew correctly.
// - CRLF line ends (RFC 4180), after the last row too.
// - A cell is quoted when it holds `,` `"` CR or LF, or begins or ends with a
//   space; `"` is doubled.
// - Values: null/undefined -> empty; string as is (after neutralising);
//   number and bigint -> String(n), never neutralised (so -5 stays a number);
//   boolean -> true/false; object/array -> JSON text in one cell (DE-4: jsonb).
// - CSV injection (OWASP; TL default BC-1): a STRING cell whose first
//   character is = + - @ TAB or CR gets a leading apostrophe, so a
//   spreadsheet cannot run it as a formula. Checked after objects are turned
//   into JSON text (they start with { or [, so they are safe) and before
//   quoting. data.json keeps the exact value; the README says so.
// - Column order is the header's; a row key outside the header is never written.

const BOM = '﻿';
const CRLF = '\r\n';
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^ | $/;

/** The text of one cell, before quoting. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return neutralise(value);
  // jsonb (object or array): one cell of JSON text. Starts with { or [.
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  return json === undefined ? '' : neutralise(json);
}

/** BC-1: a formula-looking string is prefixed with an apostrophe. */
export function neutralise(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** RFC 4180 quoting of one cell's text. */
export function quoteCell(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The CSV text (with BOM), for tests and for `toCsv`. */
export function toCsvText(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines: string[] = [columns.map((column) => quoteCell(column)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => quoteCell(cellText(row[column]))).join(','));
  }
  return BOM + lines.join(CRLF) + CRLF;
}

const encoder = new TextEncoder();

/** The CSV bytes: UTF-8 with BOM, CRLF. */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): Uint8Array {
  return encoder.encode(toCsvText(columns, rows));
}
