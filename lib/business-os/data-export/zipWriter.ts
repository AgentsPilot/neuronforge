// lib/business-os/data-export/zipWriter.ts
//
// C-10 (BUSINESS_OS_DATA_EXPORT_C10_SPEED_WORKPLAN.md, SA Review 2026-10-22,
// SA-C10-1 … SA-C10-5): the one place the data export deflates and assembles a
// zip. Text entries are deflated with Node's own zlib (about 3x faster than
// fflate's pure-JS deflate at the 100,000-row ceiling: 39 s -> 11-13 s
// locally), then handed to fflate's streaming `Zip` as pre-deflated entries.
// Stored entries (the owner's files) go through fflate's `ZipPassThrough`.
// fflate stays the only zip library; no new dependency. The workbook writer
// of the spreadsheet slices reuses this helper for its worksheet XML.
//
// New pattern under CLAUDE.md rule 7, approved by SA in the review above:
// the first direct `node:zlib` use in app code, confined to this module.
// Both export routes run on the Node runtime.
//
// The CRC is a table CRC-32 (SA-C10-3), never `zlib.crc32`: that needs Node
// >= 20.15 / 22.2 and the project still declares and partly tests Node 18.
//
// Synchronous: returns the zip or throws (SA-C10-5). A thrown error, ours or
// fflate's, goes to the caller's existing failure path; nothing is swallowed
// and a truncated zip is never returned.
//
// Server-only.

import 'server-only';
import { deflateRawSync } from 'node:zlib';
import { Zip, ZipPassThrough, type ZipInputFile } from 'fflate';

/**
 * Deflate level for text entries (SA-C10-4). Do NOT lower it: at level 1 the
 * records alone deflate to 46-51 MB at the 100,000-row ceiling, over the
 * 45 MiB ZIP_BYTES_CEILING, so the export would be refused instead of slow.
 */
export const TEXT_DEFLATE_LEVEL = 6;

export interface ZipWriterEntry {
  name: string;
  data: Uint8Array;
  /** `deflate` for text (README, data.json, CSV); `store` for the owner's files (already compressed). */
  method: 'deflate' | 'store';
}

export interface ZipWriterOptions {
  mtime: Date;
  /** Called before each entry, in order. Throw from it to stop the build (the caller's time budget). */
  beforeEntry?: (entry: ZipWriterEntry) => void;
}

/**
 * Slicing-by-8 tables: T[0] is the classic byte table; T[k][n] is the CRC of
 * byte n followed by k zero bytes. Eight bytes per step: 1.6 s -> 1.25 s
 * over the ~150 MB of text at the ceiling (local, SA-C10-3 asks under 1.5 s).
 */
const CRC_TABLES: Uint32Array[] = (() => {
  const tables = Array.from({ length: 8 }, () => new Uint32Array(256));
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tables[0][n] = c >>> 0;
  }
  for (let n = 0; n < 256; n += 1) {
    for (let k = 1; k < 8; k += 1) tables[k][n] = (tables[k - 1][n] >>> 8) ^ tables[0][tables[k - 1][n] & 0xff];
  }
  return tables;
})();

/** CRC-32 (IEEE 802.3, the zip CRC) of `data`. */
export function crc32(data: Uint8Array): number {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = CRC_TABLES;
  let c = 0xffffffff;
  let i = 0;
  const end8 = data.length - (data.length % 8);
  for (; i < end8; i += 8) {
    const a = c ^ (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24));
    c =
      t7[a & 0xff] ^
      t6[(a >>> 8) & 0xff] ^
      t5[(a >>> 16) & 0xff] ^
      t4[a >>> 24] ^
      t3[data[i + 4]] ^
      t2[data[i + 5]] ^
      t1[data[i + 6]] ^
      t0[data[i + 7]];
  }
  for (; i < data.length; i += 1) c = t0[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build the zip, entries in the given order. Returns the zip or throws. */
export function buildZip(entries: readonly ZipWriterEntry[], opts: ZipWriterOptions): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let failure: Error | null = null;
  let done = false;

  // fflate calls this synchronously while entries are pushed (every entry
  // here completes in the same tick), so `chunks` is whole once `end()` returns.
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failure = failure ?? err;
      return;
    }
    chunks.push(chunk);
    total += chunk.length;
    if (final) done = true;
  });

  for (const entry of entries) {
    // A zip error wins over a spent budget: it is reported as `error`, not `timeout`.
    if (failure) break;
    opts.beforeEntry?.(entry);
    if (entry.method === 'store') {
      const file = new ZipPassThrough(entry.name);
      file.mtime = opts.mtime;
      zip.add(file);
      file.push(entry.data, true);
    } else {
      // A plain Uint8Array copy of the Buffer: fflate types its chunks as Uint8Array<ArrayBuffer> and a
      // view over the Buffer's memory has the same type problem. Tens of ms at the ceiling (SA code review).
      const deflated = new Uint8Array(deflateRawSync(entry.data, { level: TEXT_DEFLATE_LEVEL }));
      const file: ZipInputFile = {
        filename: entry.name,
        size: entry.data.length,
        crc: crc32(entry.data),
        compression: 8,
        mtime: opts.mtime,
      };
      zip.add(file);
      // `add` defines ondata; one final chunk carries the whole deflate stream.
      (file.ondata as NonNullable<ZipInputFile['ondata']>)(null, deflated, true);
    }
  }
  if (!failure) zip.end();

  if (failure) throw new Error(`data export: the zip could not be built (${(failure as Error).message})`, { cause: failure });
  if (!done) throw new Error('data export: the zip did not finish');

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
