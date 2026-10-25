/**
 * The CRM contacts export, as a file a spreadsheet opens as data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT HAND-BUILT ANY MORE
 *
 * The CRM page quoted every cell and stopped there, which is correct CSV and no
 * defence (see `lib/payments/csv`). The names in it come from the public
 * contact and booking forms, which take no authentication, so a "first name" of
 * `=HYPERLINK(...)` arrived in the owner's spreadsheet as a working formula.
 * Every text cell now goes through `toCsv`, i.e. the same `csvCell` rule as the
 * money exports (BC-1), and the file carries the same BOM `toCsvFile` adds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE EXCEPTION: THE PHONE COLUMN (XC-18)
 *
 * CSV quoting is syntax, not type: Excel reads `"0543254785"` as the NUMBER
 * 543254785 and the leading zero is gone, and `+972541234567` loses its `+`.
 * `csvCell` deliberately leaves numeric-looking cells alone (so money columns
 * still sum), so it cannot fix that. `="…"` is the one form Excel, Sheets and
 * Numbers all read back as text, so the phone keeps it.
 *
 * It is a formula, so it is narrowed until it cannot carry anything else:
 *
 *   - Only a PHONE-SHAPED value gets it — digits, an optional leading `+`,
 *     plain spaces, `( ) - .`. No quote, comma, `&`, letter, tab, CR or LF can
 *     be inside the string literal, so there is nothing to break out of it
 *     with and nothing that can end the CSV field early. Anything else (a
 *     stranger typed a formula into the phone box) falls back to the normal
 *     neutralised cell, and reads as the text they typed.
 *   - That whitelist is what closes the old hole. The field is still written
 *     UNQUOTED (`="0541234567"` — the form already in use, which Excel, Sheets
 *     and Numbers read back as text), but the old code applied it to ANY
 *     value, so a comma in a stored phone split the field and the second half
 *     could begin with `=`. The exception was itself an injection path.
 *
 * The value is otherwise exported as stored: there is no country to apply that
 * would not be a guess, and a wrong country code looks dialable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/crm/contactsCsv
 */

import { CSV_BOM, toCsv } from '@/lib/payments/csv';

/**
 * Digits with the punctuation people write phones with — and nothing else.
 * A literal space, not `\s`: `\s` admits CR/LF, which would end the field.
 */
const PHONE_SHAPE = /^\+?[\d ().-]+$/;

/** One CSV field, encoded by the shared serialiser so the BC-1 rule applies. */
function field(value: string): string {
  return toCsv([[value]]);
}

/**
 * A phone as a CSV field that a spreadsheet keeps as text.
 *
 * `="0541234567"` for a phone-shaped value; the ordinary neutralised, quoted
 * field for anything else.
 */
export function phoneCsvField(phone: string | null | undefined): string {
  const text = (phone ?? '').trim();
  if (!text) return field('');
  if (!PHONE_SHAPE.test(text) || !/\d/.test(text)) return field(text);
  return `="${text}"`;
}

/**
 * The contacts export file.
 *
 * `rows` are already the words the owner reads (stage label, source label,
 * formatted date); `phoneColumn` is the index of the phone cell in each row.
 * Every other cell is neutralised by `csvCell`. Lines are `\r\n`, as `toCsv`
 * writes them.
 */
export function buildContactsCsvFile(
  headers: string[],
  rows: string[][],
  phoneColumn: number
): string {
  const lines = [
    toCsv([headers]),
    ...rows.map(row =>
      row.map((cell, index) => (index === phoneColumn ? phoneCsvField(cell) : field(cell))).join(',')
    ),
  ];
  return `${CSV_BOM}${lines.join('\r\n')}`;
}
