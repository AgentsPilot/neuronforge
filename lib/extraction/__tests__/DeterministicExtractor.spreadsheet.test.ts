/**
 * Spreadsheet path of DeterministicExtractor.handleStructured.
 *
 * Workbooks reach this reader from outside senders (Gmail attachment steps), so
 * it is guarded by a size cap checked before SheetJS is loaded. See
 * docs/workplans/sheetjs-cve-remediation-workplan.md.
 */

import * as XLSX from 'xlsx';
import {
  DeterministicExtractor,
  MAX_SPREADSHEET_BYTES,
  SPREADSHEET_TOO_LARGE_ERROR,
} from '@/lib/extraction/DeterministicExtractor';

/*
 * The extractor loads SheetJS with a dynamic import, which ts-jest compiles to
 * require(). Spy on that module object, not on this file's namespace copy.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sheetjsModule = (): typeof XLSX => require('xlsx');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function workbookBase64(rows: (string | number)[][]): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return (XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
}

describe('DeterministicExtractor — spreadsheets', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads a workbook into raw CSV text', async () => {
    const extractor = new DeterministicExtractor(false);

    const result = await extractor.extract({
      content: workbookBase64([
        ['Name', 'Amount'],
        ['Dana', 120],
        ['Yossi', 80],
      ]),
      mimeType: XLSX_MIME,
      filename: 'roster.xlsx',
    });

    expect(result.success).toBe(true);
    expect(result.rawText).toContain('Name,Amount');
    expect(result.rawText).toContain('Dana,120');
    expect(result.rawText).toContain('Yossi,80');
  });

  it('rejects a spreadsheet over the size cap without parsing it', async () => {
    const readSpy = jest.spyOn(sheetjsModule(), 'read');
    const extractor = new DeterministicExtractor(false);

    const result = await extractor.extract({
      content: Buffer.alloc(MAX_SPREADSHEET_BYTES + 1).toString('base64'),
      mimeType: XLSX_MIME,
      filename: 'huge.xlsx',
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([SPREADSHEET_TOO_LARGE_ERROR]);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('does not reject a spreadsheet of exactly the cap', async () => {
    const readSpy = jest.spyOn(sheetjsModule(), 'read');
    const extractor = new DeterministicExtractor(false);

    // Zero bytes are not a valid workbook, so whatever SheetJS makes of them,
    // the cap must not be what stops it.
    const result = await extractor.extract({
      content: Buffer.alloc(MAX_SPREADSHEET_BYTES).toString('base64'),
      mimeType: XLSX_MIME,
      filename: 'exact.xlsx',
    });

    expect(result.errors ?? []).not.toContain(SPREADSHEET_TOO_LARGE_ERROR);
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * Prototype-safety sanity check, not a reproduction of CVE-2023-30533: this
   * would likely pass on 0.18.5 too. The evidence of the fix is the version pin
   * (sheetjsPin.guard.test.ts).
   */
  it('leaves Object.prototype untouched by hostile header names', async () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const extractor = new DeterministicExtractor(false);

    const result = await extractor.extract({
      content: workbookBase64([
        ['__proto__', 'constructor', 'polluted'],
        ['{"polluted":true}', 'x', 'yes'],
      ]),
      mimeType: XLSX_MIME,
      filename: 'hostile.xlsx',
    });

    expect(result.success).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
  });
});
