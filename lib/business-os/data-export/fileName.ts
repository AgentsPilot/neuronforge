// lib/business-os/data-export/fileName.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §11; requirement §0.2 DX-10,
// §0.4.1 E as amended by SA C-16): the zip's file name. PURE: no I/O, `now`
// and the zone are inputs.
//
//   <slug>-data-export-YYYY-MM-DD-HHmm.zip       the business name, Unicode kept
//   agentpilot-data-export-YYYY-MM-DD-HHmm.zip   no usable name
//
// - Stamp: the owner's clock (`user_preferences.timezone`; NULL or invalid ->
//   UTC via safeTimezone), date AND time (DE4-U1, extended to the zip by SA
//   C-16). The caller passes the job's `created_at` (SA C-8: the day the
//   export started), so the start route and "download again" give one name.
// - Slug: NFC; only letters, marks and digits survive; every other run (bidi
//   controls, / \ : * ? " < > |, spaces, punctuation, emoji) becomes one `-`;
//   trimmed of `-` and `.`; lower case; at most 60 code points, cut on a
//   grapheme boundary (SA optimisation: a Hebrew letter never loses its
//   niqqud), never inside a surrogate pair.
// - Empty, or a Windows reserved name (con, prn, aux, nul, com1-9, lpt1-9):
//   no slug.
// - asciiFileName: NFKD, marks stripped (Café -> cafe, SA optimisation), then
//   only [a-z0-9] runs kept; empty -> the agentpilot name.
//
// SA C-13: `fileName` always matches FILE_NAME_PATTERN and `asciiFileName`
// ASCII_FILE_NAME_PATTERN, so nothing a business types can put a quote, `;`,
// CR or LF into the Content-Disposition that Storage builds from it.
//
// The name is never logged or audited (§0.4.1 E "Never"; SA C-3).

import { safeTimezone, toBusinessLocalInput } from '@/lib/scheduling/businessTime';

export const SLUG_MAX_CODE_POINTS = 60;
export const FALLBACK_SLUG = 'agentpilot';

export const FILE_NAME_PATTERN = /^[\p{L}\p{M}\p{N}-]+-data-export-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/u;
export const ASCII_FILE_NAME_PATTERN = /^[a-z0-9-]+-data-export-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ExportZipFileNames {
  fileName: string;
  asciiFileName: string;
}

/** `YYYY-MM-DD-HHmm` on the owner's clock; midnight is 00 (never 24). */
export function exportStamp(now: Date, timezone: string | null): string {
  const local = toBusinessLocalInput(now, safeTimezone(timezone));
  const [date, time] = local.split('T');
  return `${date}-${time.replace(':', '')}`;
}

function trimDashes(text: string): string {
  return text.replace(/^[-.]+|[-.]+$/g, '');
}

/** At most `max` code points, on a grapheme boundary where Intl.Segmenter exists. */
function cutCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    let out = '';
    let used = 0;
    for (const { segment } of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      const size = Array.from(segment).length;
      if (used + size > max) break;
      out += segment;
      used += size;
    }
    return out;
  }
  return points.slice(0, max).join('');
}

/** The Unicode slug of a business name, or '' when nothing usable is left. */
export function businessSlug(businessName: string | null | undefined): string {
  if (typeof businessName !== 'string') return '';
  const lowered = businessName.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').toLowerCase();
  // A combining mark with no base letter (at the start) is noise: drop it.
  const based = trimDashes(trimDashes(lowered).replace(/^\p{M}+/u, ''));
  const slug = trimDashes(cutCodePoints(based, SLUG_MAX_CODE_POINTS));
  if (!slug || RESERVED.test(slug)) return '';
  return slug;
}

/** The ASCII slug: Café -> cafe; a Hebrew-only name -> ''. */
export function asciiSlug(slug: string): string {
  const ascii = trimDashes(
    slug
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
  ).slice(0, SLUG_MAX_CODE_POINTS);
  const trimmed = trimDashes(ascii);
  if (!trimmed || RESERVED.test(trimmed)) return '';
  return trimmed;
}

export function exportZipFileNames(now: Date, timezone: string | null, businessName: string | null): ExportZipFileNames {
  const stamp = exportStamp(now, timezone);
  const slug = businessSlug(businessName);
  const ascii = asciiSlug(slug);
  return {
    fileName: `${slug || FALLBACK_SLUG}-data-export-${stamp}.zip`,
    asciiFileName: `${ascii || FALLBACK_SLUG}-data-export-${stamp}.zip`,
  };
}

/**
 * RFC 5987 `ext-value` percent-encoding: encodeURIComponent plus `' ( ) *`,
 * which it leaves alone but `attr-char` does not allow (SA C-13).
 */
export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The Content-Disposition a correct server sends for this pair: the reference
 * the Preview check (T-14) compares Storage's header against.
 */
export function contentDisposition(fileName: string, asciiFileName: string): string {
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
