// lib/business-os/data-export/zipEntries.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §9.3; SA Q-13, C-4, C-14):
// the names of the owner's files inside the zip. PURE: no I/O.
//
// A SECURITY CONTROL, not cosmetics (SA C-4): a document's name inside the zip
// comes from `contact_documents.file_name`, and the public intake upload
// stores `file.name` exactly as the uploader's browser sent it. So a name can
// be `../../x.pdf`, `C:x`, `/etc/passwd`, `invoice‮fdp.exe`, carry NUL or
// lone surrogates, or be 500 characters long. `cleanSegment` makes any of them
// one safe path segment, and `joinEntry` puts cleaned segments under a fixed
// ASCII prefix, so an entry can never start with `/`, hold a `..` or `.`
// segment, a backslash or a drive letter: no zip slip on any unzip tool.
//
// cleanSegment:
// 1. lone surrogates dropped; NFC;
// 2. C0 / C1 control characters and bidi controls (U+061C, U+200E/F,
//    U+202A-E, U+2066-9) and U+FEFF stripped;
// 3. / \ : * ? " < > | replaced with `-`;
// 4. spaces and dots trimmed at both ends;
// 5. at most 120 UTF-16 units, cut on a code-point boundary, keeping the
//    extension;
// 6. empty, or a Windows reserved stem (con, prn, aux, nul, com1-9, lpt1-9,
//    any case, before the first dot) -> `file` + extension.
//
// EntryNamer: duplicates inside one folder get ` (2)`, ` (3)` before the
// extension, compared case-insensitively (Windows and macOS default
// filesystems). Deterministic when the caller claims names in a fixed order
// (SA C-14: files by record id, then path).

export const SEGMENT_MAX_UNITS = 120;
const EXTENSION_MAX_UNITS = 16;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const BIDI_AND_BOM = /[؜‎‏‪-‮⁦-⁩﻿]/g;
const FORBIDDEN = /[/\\:*?"<>|]/g;
const EDGE = /^[\s.]+|[\s.]+$/g;
const RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair. */
function cutUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const point of text) {
    if (out.length + point.length > max) break;
    out += point;
  }
  return out;
}

function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  const ext = name.slice(dot);
  if (ext.length < 2 || ext.length > EXTENSION_MAX_UNITS) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext };
}

/** One safe path segment from any input. Never empty. */
export function cleanSegment(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text
    .replace(LONE_SURROGATE, '')
    .normalize('NFC')
    .replace(CONTROL, '')
    .replace(BIDI_AND_BOM, '')
    .replace(FORBIDDEN, '-')
    .replace(EDGE, '');
  const { stem, ext } = splitExtension(cleaned);
  const cutStem = cutUnits(stem, SEGMENT_MAX_UNITS - ext.length).replace(EDGE, '');
  const firstPart = cutStem.split('.')[0];
  if (!cutStem || RESERVED_STEM.test(firstPart)) return `file${ext}`;
  return `${cutStem}${ext}`;
}

/** Cleaned segments joined under a fixed ASCII prefix (e.g. `files/website-images`). */
export function joinEntry(prefix: string, segments: readonly unknown[]): string {
  return [prefix, ...segments.map((segment) => cleanSegment(segment))].join('/');
}

/** Hands out unique entry names per folder, in the order they are claimed. */
export class EntryNamer {
  private readonly taken = new Set<string>();

  /** `folder` is a trusted, already-safe prefix; `name` one cleaned segment. */
  claim(folder: string, name: string): string {
    const { stem, ext } = splitExtension(name);
    let candidate = name;
    for (let n = 2; this.taken.has(`${folder}/${candidate}`.toLowerCase()); n += 1) {
      candidate = `${stem} (${n})${ext}`;
    }
    this.taken.add(`${folder}/${candidate}`.toLowerCase());
    return `${folder}/${candidate}`;
  }
}

const SAFE_ENTRY_SEGMENT = /^[^/\\\u0000-\u001F\u007F-\u009F]+$/;

/**
 * The zip-wide allow-list (SA C-4), used by the tests and as a last check
 * before an entry is written: fixed top-level names, `records/<group>/<id>.csv`,
 * or `files/<folder>/...` with no `.` / `..` segment, no leading `/`, no `\`,
 * no drive letter and no control character.
 */
export function isAllowedEntryName(name: string): boolean {
  if (['README.txt', 'README-he.txt', 'data.json', 'files-index.csv'].includes(name)) return true;
  if (/^records\/(account|client_records|content)\/[a-z_]+\.csv$/.test(name)) return true;
  if (!name.startsWith('files/')) return false;
  const segments = name.split('/');
  if (segments.length < 3) return false;
  return segments.every(
    (segment) => segment !== '.' && segment !== '..' && SAFE_ENTRY_SEGMENT.test(segment) && !/^[A-Za-z]:/.test(segment)
  );
}
