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
//
// MX-2a (BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md §2.3, XC-10): the module CSV of
// the export redesign reuses THIS encoder, not a second writer. `csvLine`
// encodes one row, `csvHeaderLine` one header (labels are free text from
// MX-2b, so they get BC-1 too; a no-op on the ZIP's snake_case keys, pinned by
// csv.test.ts), `csvPartText` frames a part (BOM + lines + CRLF). `toCsvText`
// is built from the same three, so the ZIP's bytes do not change.

const BOM = '﻿';
const CRLF = '\r\n';
// Exported for MX-3, which cuts parts at row boundaries. The BOM stays the
// literal character above, never a backslash escape: lib/ is scanned by
// Tailwind, and a backslash + hex in a scanned file breaks the build (PR #180).
export const CSV_BOM = BOM;
export const CSV_EOL = CRLF;
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

/** One encoded row (no line end): every value through `cellText` (BC-1), then RFC 4180 quoting. */
export function csvLine(cells: readonly unknown[]): string {
  return cells.map((cell) => quoteCell(cellText(cell))).join(',');
}

/** One encoded header row (no BOM, no line end). Labels are text, so they get BC-1 too. */
export function csvHeaderLine(labels: readonly string[]): string {
  return labels.map((label) => quoteCell(neutralise(label))).join(',');
}

/** A whole CSV part: BOM + header + one line per row, CRLF after every line (the last too). */
export function csvPartText(header: string, lines: readonly string[]): string {
  return lines.length === 0 ? BOM + header + CRLF : BOM + header + CRLF + lines.join(CRLF) + CRLF;
}

/** The CSV text (with BOM), for tests and for `toCsv`. */
export function toCsvText(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  return csvPartText(
    csvHeaderLine(columns),
    rows.map((row) => csvLine(columns.map((column) => row[column])))
  );
}

const encoder = new TextEncoder();

/** The CSV bytes: UTF-8 with BOM, CRLF. */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): Uint8Array {
  return encoder.encode(toCsvText(columns, rows));
}
