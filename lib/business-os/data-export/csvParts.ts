// lib/business-os/data-export/csvParts.ts
//
// Module export MX-3a (BUSINESS_OS_EXPORT_MX3_WORKPLAN.md D-4, D-5, §5
// "Memory"; requirement §4.3 Split, XC-8, XC-9): cut a module's joined CSV
// into email parts.
//
// - At row boundaries only. Every part repeats the BOM and the header row, so
//   each file opens on its own.
// - Sized in UTF-8 BYTES of the whole part: BOM + header + CRLF + each line +
//   CRLF, each line counted as `Buffer.byteLength(line, 'utf8') + 2` (MX-2a /
//   MX-2b carry-over; a Hebrew letter is 2 bytes, an emoji 4). A part may be
//   exactly the budget.
// - The cut is done IN FULL before anything is sent, so `parts_total` is known
//   before the first send and "email n of X" is always true (XC-9). More parts
//   than the maximum, or one line that cannot fit in a part beside its header,
//   is `tooLarge` and nothing is sent (D-5).
// - It returns index ranges and byte totals, never copies of the lines (XC-8):
//   the worker builds one part's text at a time, for its own send, and drops it.
//
// PURE: no I/O, no logger. The framing is csv.ts's, the only CSV writer.

import { CSV_BOM, CSV_EOL, csvPartText } from '@/lib/business-os/data-export/csv';
import { MAX_PARTS_PER_MODULE, PART_BYTES_MAX } from '@/lib/business-os/data-export/moduleExportSending';

/** One part: lines[start, end), and its exact size in bytes with BOM and header. */
export interface CsvPartRange {
  start: number;
  end: number;
  bytes: number;
}

export type CsvPartCut =
  | { tooLarge: false; parts: CsvPartRange[] }
  | { tooLarge: true; reason: 'part_count' | 'line_too_large' | 'header_too_large' };

const EOL_BYTES = Buffer.byteLength(CSV_EOL, 'utf8');

/** The bytes every part carries before its first line: BOM + header + CRLF. */
export function partOverheadBytes(header: string): number {
  return Buffer.byteLength(CSV_BOM, 'utf8') + Buffer.byteLength(header, 'utf8') + EOL_BYTES;
}

/** One line's bytes in a part: the line and its CRLF. */
export function lineBytes(line: string): number {
  return Buffer.byteLength(line, 'utf8') + EOL_BYTES;
}

export function cutCsvParts(
  header: string,
  lines: readonly string[],
  budget: number = PART_BYTES_MAX,
  maxParts: number = MAX_PARTS_PER_MODULE
): CsvPartCut {
  const overhead = partOverheadBytes(header);
  if (overhead > budget) return { tooLarge: true, reason: 'header_too_large' };

  // Zero rows: one part with the header only (T-P8), so the owner still gets a file.
  if (lines.length === 0) return { tooLarge: false, parts: [{ start: 0, end: 0, bytes: overhead }] };

  const parts: CsvPartRange[] = [];
  let start = 0;
  let bytes = overhead;
  for (let i = 0; i < lines.length; i += 1) {
    const size = lineBytes(lines[i]);
    if (overhead + size > budget) return { tooLarge: true, reason: 'line_too_large' };
    if (bytes + size > budget) {
      parts.push({ start, end: i, bytes });
      // Stop as soon as the count is over: the rest cannot change the answer.
      if (parts.length >= maxParts) return { tooLarge: true, reason: 'part_count' };
      start = i;
      bytes = overhead;
    }
    bytes += size;
  }
  parts.push({ start, end: lines.length, bytes });
  return { tooLarge: false, parts };
}

/** The text of one part, built on demand for its own send (BOM + header + its lines, CRLF each). */
export function csvPartTextOf(header: string, lines: readonly string[], part: CsvPartRange): string {
  return csvPartText(header, lines.slice(part.start, part.end));
}
