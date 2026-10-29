/**
 * The part cutter (module export MX-3a, workplan D-4, D-5, §13.2 T-P1…T-P9).
 * Every size is checked against the real bytes of the real part text, built
 * by csv.ts's own framing.
 */

import { CSV_BOM, csvPartText } from '../csv';
import { csvPartTextOf, cutCsvParts, lineBytes, partOverheadBytes, type CsvPartRange } from '../csvParts';
import { MAX_PARTS_PER_MODULE, PART_BYTES_MAX } from '../moduleExportSending';

const HEADER = 'Record type,Name,Email';
const bytesOf = (text: string) => Buffer.byteLength(text, 'utf8');

function expectWellFormed(header: string, lines: string[], parts: CsvPartRange[], budget: number) {
  // Every line in exactly one part, in order, cut only between lines.
  expect(parts[0].start).toBe(0);
  expect(parts[parts.length - 1].end).toBe(lines.length);
  for (let i = 1; i < parts.length; i += 1) expect(parts[i].start).toBe(parts[i - 1].end);
  for (const part of parts) {
    const text = csvPartTextOf(header, lines, part);
    expect(text.startsWith(CSV_BOM + header + '\r\n')).toBe(true);
    expect(bytesOf(text)).toBe(part.bytes);
    expect(part.bytes).toBeLessThanOrEqual(budget);
  }
}

describe('cutCsvParts', () => {
  it('T-P1 a small module is one part whose bytes are exactly csvPartText (BOM + header + CRLF + lines with CRLF)', () => {
    const lines = ['Client,Dana,d@example.com', 'Client,Noa,n@example.com'];
    const cut = cutCsvParts(HEADER, lines);
    expect(cut).toEqual({ tooLarge: false, parts: [{ start: 0, end: 2, bytes: bytesOf(csvPartText(HEADER, lines)) }] });
    expect(partOverheadBytes(HEADER)).toBe(3 + bytesOf(HEADER) + 2);
  });

  it('T-P2 lines are measured in UTF-8 bytes + 2, not characters (Hebrew 2 bytes a letter, emoji 4)', () => {
    expect(lineBytes('שלום')).toBe(8 + 2);
    expect(lineBytes(String.fromCodePoint(0x1f600))).toBe(4 + 2);
    expect(lineBytes('abc')).toBe(5);
    // A budget that fits 3 Hebrew lines by characters but only 1 by bytes.
    const lines = ['שלוםשלום', 'שלוםשלום', 'שלוםשלום'];
    const budget = partOverheadBytes(HEADER) + lineBytes(lines[0]);
    const cut = cutCsvParts(HEADER, lines, budget);
    expect(cut.tooLarge).toBe(false);
    if (!cut.tooLarge) {
      expect(cut.parts).toHaveLength(3);
      expectWellFormed(HEADER, lines, cut.parts, budget);
    }
  });

  it('T-P3 just over the budget: two parts, each within the budget INCLUDING BOM and header, order kept', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Client,Name ${i},c${i}@example.com`);
    const whole = bytesOf(csvPartText(HEADER, lines));
    const budget = whole - 1;
    const cut = cutCsvParts(HEADER, lines, budget);
    expect(cut.tooLarge).toBe(false);
    if (!cut.tooLarge) {
      expect(cut.parts).toHaveLength(2);
      expectWellFormed(HEADER, lines, cut.parts, budget);
    }
  });

  it('T-P4 exactly at the budget: one part (the budget is inclusive)', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Client,Name ${i},c${i}@example.com`);
    const budget = bytesOf(csvPartText(HEADER, lines));
    const cut = cutCsvParts(HEADER, lines, budget);
    expect(cut).toEqual({ tooLarge: false, parts: [{ start: 0, end: 10, bytes: budget }] });
  });

  it('T-P5 a 25 MB module (synthetic, built here) is 4 parts at the real 7,000,000-byte budget', () => {
    const line = `Client,${'x'.repeat(990)},someone@example.com`;
    const lines = new Array<string>(25_000).fill(line);
    expect(lines.length * lineBytes(line)).toBeGreaterThan(25_000_000);
    const cut = cutCsvParts(HEADER, lines);
    expect(cut.tooLarge).toBe(false);
    if (!cut.tooLarge) {
      expect(cut.parts).toHaveLength(4);
      for (const part of cut.parts) expect(part.bytes).toBeLessThanOrEqual(PART_BYTES_MAX);
      // Sizes are checked by arithmetic here; building 25 MB of text four times is not needed.
      expect(cut.parts.reduce((sum, part) => sum + part.bytes, 0)).toBe(4 * partOverheadBytes(HEADER) + lines.length * lineBytes(line));
    }
  });

  it('T-P6 needing 11 parts is tooLarge (BQ-28); exactly 10 is not', () => {
    const line = 'x'.repeat(98);
    const budget = partOverheadBytes(HEADER) + lineBytes(line); // one line per part
    expect(cutCsvParts(HEADER, new Array<string>(MAX_PARTS_PER_MODULE).fill(line), budget).tooLarge).toBe(false);
    expect(cutCsvParts(HEADER, new Array<string>(MAX_PARTS_PER_MODULE + 1).fill(line), budget)).toEqual({ tooLarge: true, reason: 'part_count' });
  });

  it('T-P7 one line bigger than the budget minus the header is tooLarge', () => {
    const budget = 200;
    const big = 'y'.repeat(budget - partOverheadBytes(HEADER) - 1); // + CRLF = 1 byte over
    expect(cutCsvParts(HEADER, ['ok', big], budget)).toEqual({ tooLarge: true, reason: 'line_too_large' });
    expect(cutCsvParts(HEADER, ['ok', big.slice(1)], budget).tooLarge).toBe(false);
  });

  it('a header that alone does not fit is tooLarge', () => {
    expect(cutCsvParts('h'.repeat(100), [], 50)).toEqual({ tooLarge: true, reason: 'header_too_large' });
  });

  it('T-P8 zero rows: one part with the header only', () => {
    const cut = cutCsvParts(HEADER, []);
    expect(cut).toEqual({ tooLarge: false, parts: [{ start: 0, end: 0, bytes: partOverheadBytes(HEADER) }] });
    if (!cut.tooLarge) expect(csvPartTextOf(HEADER, [], cut.parts[0])).toBe(CSV_BOM + HEADER + '\r\n');
  });

  it('T-P9 ranges only: the result holds numbers, never a copy of a line', () => {
    const lines = ['Client,UNIQUE_MARKER_1,a@example.com', 'Client,UNIQUE_MARKER_2,b@example.com'];
    const cut = cutCsvParts(HEADER, lines, partOverheadBytes(HEADER) + lineBytes(lines[0]));
    expect(JSON.stringify(cut)).not.toContain('UNIQUE_MARKER');
    if (!cut.tooLarge) for (const part of cut.parts) expect(Object.keys(part).sort()).toEqual(['bytes', 'end', 'start']);
  });
});
