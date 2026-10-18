/**
 * Markdown table reading shared by the price adapters (AI model price review
 * slice 10; moved unchanged out of `openaiPricingAdapter.ts` so the Anthropic
 * adapter reads tables with the same code). Pure.
 */

const SEPARATOR_CELL = /^:?-{3,}:?$/;

/** The trimmed cells of a `| a | b |` row, or null when the line is not a row. */
export function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

export function sameCells(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((cell, index) => cell === b[index]);
}

export function nextNonBlank(lines: readonly string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim() !== '') return index;
  }
  return -1;
}

/** The rows of the table whose header is at `headerIndex`, or null if the header or separator is wrong. */
export function tableRows(lines: readonly string[], headerIndex: number, header: readonly string[]): string[][] | null {
  if (headerIndex < 0 || !sameCells(cellsOf(lines[headerIndex]), header)) return null;
  const separator = cellsOf(lines[headerIndex + 1] ?? '');
  if (!separator || separator.length !== header.length || !separator.every((cell) => SEPARATOR_CELL.test(cell))) {
    return null;
  }
  const rows: string[][] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) break;
    rows.push(cellsOf(lines[index]) ?? []);
  }
  return rows;
}

/** Every line index whose trimmed text is exactly `text`. */
export function indicesOf(lines: readonly string[], text: string): number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === text) found.push(index);
  });
  return found;
}
