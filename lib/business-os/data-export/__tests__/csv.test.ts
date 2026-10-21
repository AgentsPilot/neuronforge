/**
 * DE-8b T-3 (workplan §7; TL default BC-1): the CSV writer.
 */
import { cellText, toCsv, toCsvText } from '../csv';

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
