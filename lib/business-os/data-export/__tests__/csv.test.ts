/**
 * DE-8b T-3 (workplan §7; TL default BC-1): the CSV writer.
 */
import { CSV_BOM, CSV_EOL, cellText, csvHeaderLine, csvLine, csvPartText, neutralise, toCsv, toCsvText } from '@/lib/business-os/data-export/csv';
import { PURGE_DESCRIPTORS } from '@/lib/business-os/purge/descriptors';
import { FILE_INDEX_COLUMNS } from '@/lib/business-os/data-export/payload';

const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

describe('format', () => {
  it('starts with the UTF-8 BOM bytes EF BB BF', () => {
    const bytes = toCsv(['id'], []);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('uses CRLF, after the last row too', () => {
    expect(toCsvText(['a', 'b'], [{ a: 1, b: 2 }])).toBe('﻿a,b\r\n1,2\r\n');
  });

  it('an empty (or failed) section is its header row only', () => {
    expect(toCsvText(['id', 'name'], [])).toBe('﻿id,name\r\n');
  });

  it('writes the header order, and never a row key outside the header', () => {
    const text = toCsvText(['b', 'a'], [{ a: 'x', b: 'y', secret: 'never' }]);
    expect(text).toBe('﻿b,a\r\ny,x\r\n');
    expect(text).not.toContain('never');
  });

  it('Hebrew survives the round trip', () => {
    expect(decode(toCsv(['name'], [{ name: 'סטודיו נוגה' }]))).toBe('﻿name\r\nסטודיו נוגה\r\n');
  });
});

describe('quoting (RFC 4180)', () => {
  it.each([
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['cr\rhere', '"cr\rhere"'],
    [' lead', '" lead"'],
    ['trail ', '"trail "'],
    ['plain', 'plain'],
  ])('%j -> %j', (value, cell) => {
    expect(toCsvText(['c'], [{ c: value }])).toBe(`﻿c\r\n${cell}\r\n`);
  });
});

describe('values', () => {
  it('null and undefined are empty; booleans are true/false; numbers as numbers', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(true)).toBe('true');
    expect(cellText(false)).toBe('false');
    expect(cellText(12.5)).toBe('12.5');
    expect(cellText(BigInt(42))).toBe('42');
  });

  it('jsonb (object or array) is JSON text in one cell', () => {
    expect(toCsvText(['j'], [{ j: { a: 1, b: [1, 2] } }])).toBe('﻿j\r\n"{""a"":1,""b"":[1,2]}"\r\n');
    expect(cellText([1, 'x'])).toBe('[1,"x"]');
  });
});

describe('CSV injection (BC-1): formula-looking STRINGS get a leading apostrophe', () => {
  it.each([['=1+1'], ['+972501234567'], ['-2'], ['@SUM(A1)'], ['\tx'], ['\rx']])('%j is prefixed', (value) => {
    expect(cellText(value)).toBe(`'${value}`);
  });

  it('the prefixed CR cell is also quoted', () => {
    expect(toCsvText(['c'], [{ c: '\rx' }])).toBe('﻿c\r\n"\'\rx"\r\n');
  });

  it('negative control: the NUMBER -5 is not prefixed (it stays a number)', () => {
    expect(cellText(-5)).toBe('-5');
  });

  it('negative control: an object whose value looks like a formula is not prefixed (starts with {)', () => {
    expect(cellText({ a: '=x' })).toBe('{"a":"=x"}');
  });

  it('negative control: an ordinary string is untouched', () => {
    expect(cellText('Noga 1=1')).toBe('Noga 1=1');
  });
});

// ── MX-2a (BUSINESS_OS_EXPORT_MX2A_WORKPLAN.md §2.3, T-14, T-17; SA C-6, C-7) ──

describe('MX-2a line helpers (one encoder for the ZIP and the module CSV)', () => {
  it('CSV_BOM is the UTF-8 BOM and CSV_EOL is CRLF', () => {
    expect(Array.from(new TextEncoder().encode(CSV_BOM))).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_EOL).toBe(String.fromCharCode(13, 10));
  });

  it('csvLine: every value through cellText (BC-1), then quoting; numbers untouched', () => {
    expect(csvLine(['=1+1', -5, '-5', null, true, ['a'], 'a,b'])).toBe(`'=1+1,-5,'-5,,true,"[""a""]","a,b"`);
  });

  it('csvHeaderLine: labels get BC-1 and quoting', () => {
    expect(csvHeaderLine(['id', '=x', 'a,b'])).toBe(`id,'=x,"a,b"`);
  });

  it('csvPartText(header, []) is BOM + header + CRLF (an empty part is its header row only)', () => {
    expect(csvPartText('a,b', [])).toBe(`${CSV_BOM}a,b\r\n`);
  });

  it('csvPartText(header, lines) puts CRLF after every line, the last too', () => {
    expect(csvPartText('a', ['1', '2'])).toBe(`${CSV_BOM}a\r\n1\r\n2\r\n`);
  });
});

describe('MX-2a ZIP byte identity (T-17, SA C-6)', () => {
  it('toCsvText equals the pre-refactor bytes for a fixed fixture', () => {
    const text = toCsvText(
      ['id', 'name', 'amount', 'tags', 'note', 'flag'],
      [
        { id: 'r1', name: '=cmd', amount: -5, tags: ['a', 'b'], note: 'line\nbreak', flag: true, secret: 'x' },
        { id: 'r2', name: 'סטודיו', amount: null, tags: {}, note: ' x', flag: false },
      ]
    );
    // Captured from the pre-MX-2a toCsvText on 2026-10-26.
    expect(text).toBe(
      `${CSV_BOM}id,name,amount,tags,note,flag\r\nr1,'=cmd,-5,"[""a"",""b""]","line\nbreak",true\r\nr2,סטודיו,,{}," x",false\r\n`
    );
  });

  it('every header key the ZIP writes is unchanged by neutralise, so csvHeaderLine is a no-op for the ZIP', () => {
    const keys = new Set<string>(['id', 'email', 'created_at', ...FILE_INDEX_COLUMNS]);
    for (const d of PURGE_DESCRIPTORS) if (d.export.kind === 'include') for (const c of d.export.columns) keys.add(c);
    expect(keys.size).toBeGreaterThan(100);
    const changed = [...keys].filter((k) => neutralise(k) !== k);
    expect(changed).toEqual([]);
    expect(csvHeaderLine([...keys])).toBe([...keys].join(','));
  });

  it('negative control: a key starting with - would be changed (so the guard can fail)', () => {
    expect(neutralise('-key')).not.toBe('-key');
  });
});
