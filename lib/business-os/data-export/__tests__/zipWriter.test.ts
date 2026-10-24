/**
 * C-10 SA-C10-9 (BUSINESS_OS_DATA_EXPORT_C10_SPEED_WORKPLAN.md): the zip
 * helper. Small fixtures only (C-9: no 100,000-row test in Jest).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { unzipSync } from 'fflate';
import { buildZip, crc32, TEXT_DEFLATE_LEVEL, type ZipWriterEntry } from '../zipWriter';

const enc = new TextEncoder();
const MTIME = new Date('2026-10-22T08:00:00.000Z');

/** Local file headers in order: name, method, flags. */
function localHeaders(zip: Uint8Array): Array<{ name: string; method: number; flags: number }> {
  const out: Array<{ name: string; method: number; flags: number }> = [];
  for (let i = 0; i + 30 < zip.length; i += 1) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x03 && zip[i + 3] === 0x04) {
      const nameLen = zip[i + 26] | (zip[i + 27] << 8);
      out.push({
        name: new TextDecoder().decode(zip.slice(i + 30, i + 30 + nameLen)),
        method: zip[i + 8] | (zip[i + 9] << 8),
        flags: zip[i + 6] | (zip[i + 7] << 8),
      });
    }
  }
  return out;
}

/** Byte-at-a-time CRC-32: the reference, independent of the module's tables (never zlib.crc32). */
function referenceCrc(d: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of d) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Central directory records in order: what Explorer and 7-Zip trust for name, method, CRC and size. */
function centralDirectory(zip: Uint8Array): Array<{ name: string; method: number; crc: number; size: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out: Array<{ name: string; method: number; crc: number; size: number }> = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory record');
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    out.push({
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      name: new TextDecoder().decode(zip.slice(at + 46, at + 46 + nameLen)),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('the 8-byte path agrees with a byte-at-a-time CRC at every length around the step', () => {
    for (const n of [1, 7, 8, 9, 15, 16, 17, 64, 1001]) {
      const data = new Uint8Array(n).map((_, i) => (i * 131 + n) & 0xff);
      expect(crc32(data)).toBe(referenceCrc(data));
    }
  });
});

describe('buildZip', () => {
  // Over 64 KiB, Hebrew, and repetitive enough that deflate visibly shrinks it.
  const big = enc.encode('שלום, לקוח; invoice 2026-10-22T08:00:00Z\r\n'.repeat(3000));
  const entries: ZipWriterEntry[] = [
    { name: 'README.txt', data: enc.encode('﻿hello'), method: 'deflate' },
    { name: 'empty.csv', data: new Uint8Array(0), method: 'deflate' },
    { name: 'records/client_records/clients.csv', data: big, method: 'deflate' },
    { name: 'files/client-documents/c1/חוזה.pdf', data: new Uint8Array([37, 80, 68, 70, 0, 255]), method: 'store' },
    { name: 'files/website-images/x.png', data: new Uint8Array(70_000).map((_, i) => (i * 7919) & 0xff), method: 'store' },
  ];

  it('round-trips every entry byte for byte, in order (unzipSync does NOT check CRCs: see the next test)', () => {
    const out = unzipSync(buildZip(entries, { mtime: MTIME }));
    expect(Object.keys(out)).toEqual(entries.map((e) => e.name));
    for (const entry of entries) expect(Buffer.from(out[entry.name]).equals(Buffer.from(entry.data))).toBe(true);
  });

  it('CR-1: the central directory records, per entry in order, the method and the CRC and size of the RAW data', () => {
    const records = centralDirectory(buildZip(entries, { mtime: MTIME }));
    expect(records.map((r) => r.name)).toEqual(entries.map((e) => e.name));
    records.forEach((r, i) => {
      expect(r.method).toBe(entries[i].method === 'deflate' ? 8 : 0);
      expect(r.crc).toBe(referenceCrc(entries[i].data));
      expect(r.size).toBe(entries[i].data.length);
    });
    // Stored, deflated and empty entries are all covered by the fixture.
    expect(entries.some((e) => e.method === 'store')).toBe(true);
    expect(entries.some((e) => e.method === 'deflate' && e.data.length === 0)).toBe(true);
  });

  it('deflates text (method 8), stores files (method 0), sets the UTF-8 name flag on a Hebrew name', () => {
    const zip = buildZip(entries, { mtime: MTIME });
    const headers = localHeaders(zip);
    expect(headers.map((h) => h.name)).toEqual(entries.map((e) => e.name));
    headers.forEach((h, i) => expect(h.method).toBe(entries[i].method === 'deflate' ? 8 : 0));
    expect(headers[3].flags & 0x0800).toBe(0x0800);
    // The big text entry is compressed, not stored under method 8.
    expect(zip.length).toBeLessThan(big.length);
  });

  it('is deterministic for the same input and mtime', () => {
    expect(Buffer.from(buildZip(entries, { mtime: MTIME })).equals(Buffer.from(buildZip(entries, { mtime: MTIME })))).toBe(true);
  });

  it('calls beforeEntry once per entry, in order, and an error thrown there propagates (no zip returned)', () => {
    const seen: string[] = [];
    expect(() =>
      buildZip(entries, {
        mtime: MTIME,
        beforeEntry: (e) => {
          seen.push(e.name);
          if (e.name === 'empty.csv') throw new Error('budget');
        },
      })
    ).toThrow('budget');
    expect(seen).toEqual(['README.txt', 'empty.csv']);
  });

  it('a zip error throws, never a truncated zip (a name over 65,535 bytes)', () => {
    expect(() => buildZip([{ name: 'a'.repeat(70_000), data: enc.encode('x'), method: 'deflate' }], { mtime: MTIME })).toThrow(
      /zip could not be built/
    );
  });

  it('SA-C10-3/4: table CRC only (no zlib.crc32) and level 6', () => {
    const source = readFileSync(join(process.cwd(), 'lib/business-os/data-export/zipWriter.ts'), 'utf8');
    // The only node:zlib import is the deflate; no `zlib.` namespace call.
    expect(source.match(/from 'node:zlib'/g)).toHaveLength(1);
    expect(source).toContain("import { deflateRawSync } from 'node:zlib';");
    expect(source).not.toMatch(/\bzlib\.\w+\(/);
    expect(TEXT_DEFLATE_LEVEL).toBe(6);
  });
});
