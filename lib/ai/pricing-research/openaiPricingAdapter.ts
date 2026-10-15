/**
 * OpenAI official pricing page (markdown form) → pending token lines
 * (AI model price review slice 5; SA RR-1, SC-10). Pure and deterministic:
 * page text in, lines and problems out. NO LLM reads the page.
 *
 * ── Anchors (any one missing → `layout_changed`, ZERO lines) ──────────────
 *   A1  the heading line `### Standard pricing data`, exactly once;
 *   A2  the first non-blank line after A1 is the header row (an exact trimmed
 *       cell list), the next is the separator; the table ends at the first
 *       line that does not start with `|`, so it can never run into Batch;
 *   A3  the nearest "Prices per …" line above A1 is exactly
 *       `Prices per 1M tokens.` ("… unless noted." does not satisfy it);
 *   A4  `Specialized models` exactly once, then the next non-blank lines are
 *       exactly `Prices per 1M tokens.`, `Standard`,
 *       `### Grouped Pricing Table data`, then the embeddings header row.
 * Only these two tables are read: Batch, Flex, Fast, Ultrafast, realtime,
 * image, transcription and fine-tuning tables never are.
 *
 * ── Cells ─────────────────────────────────────────────────────────────────
 * A price cell is exactly `$<digits>[.<digits>]`; the digits are kept AS
 * WRITTEN ("$0.60" → "0.60"), no float at any step. `-` means absent: cached
 * input is then omitted, output becomes "0" for an input-only model, and any
 * other absence sends the model to manual entry. Anything else (two prices,
 * "Free", a unit suffix, a comma) sends the model to manual entry with the
 * cell text (≤ 80 characters). Never the first number found.
 *
 * ── Model matching (generic; no per-model table, CLAUDE.md rule 5) ────────
 * Trim, lowercase, drop ONE trailing parenthetical note, spaces to hyphens.
 * Candidates: that text, and the same with dots turned into hyphens, deduped
 * and each passing `MODEL_ID_REGEX`. Coverage is applied FIRST: a row whose
 * candidates match no coverage id is ignored before any cell is judged. More
 * than one coverage match, or the same model on two rows, → manual entry.
 */

import { MAX_CELL_TEXT, type NameNote, type NeedsManualEntry } from './fetchOutcomes';
import { MODEL_ID_REGEX } from './pendingLineSchema';

export const STANDARD_HEADING = '### Standard pricing data';
export const UNIT_LINE = 'Prices per 1M tokens.';
export const STANDARD_HEADER = [
  'Model',
  'Short context input',
  'Short context cached input',
  'Short context cache writes',
  'Short context output',
  'Long context input',
  'Long context cached input',
  'Long context cache writes',
  'Long context output',
] as const;
export const SPECIALIZED_LABEL = 'Specialized models';
export const TIER_LABEL = 'Standard';
export const GROUPED_HEADING = '### Grouped Pricing Table data';
export const SPECIALIZED_HEADER = ['Category', 'Model', 'Input', 'Cached input', 'Output'] as const;

const PRICE_CELL = /^[$]([0-9]{1,6}(?:[.][0-9]{1,9})?)$/;
const ABSENT_CELL = '-';
const SEPARATOR_CELL = /^:?-{3,}:?$/;
const TRAILING_NOTE = /^(.*?)[ ]*[(]([^()]*)[)]$/;

export type AnchorId = 'A1' | 'A2' | 'A3' | 'A4';

export interface ParsedTokenPrice {
  model_name: string;
  input_per_1m: string;
  output_per_1m: string;
  cached_input_per_1m?: string;
}

export interface OpenAiParseResult {
  outcome: 'ok' | 'layout_changed';
  /** The first anchor that failed, for the log line (never page text). */
  failedAnchor?: AnchorId;
  lines: ParsedTokenPrice[];
  needsManual: NeedsManualEntry[];
  notFound: string[];
  nameNotes: NameNote[];
}

export interface OpenAiParseOptions {
  /** OpenAI model ids in the computed coverage set (MP-FR-2). */
  coverage: ReadonlySet<string>;
  /** True for a model priced on input only (embeddings): `-` output becomes "0". */
  isInputOnly: (model: string) => boolean;
}

interface TableSpec {
  header: readonly string[];
  model: string;
  input: string;
  cached: string;
  output: string;
}

const STANDARD_TABLE: TableSpec = {
  header: STANDARD_HEADER,
  model: 'Model',
  input: 'Short context input',
  cached: 'Short context cached input',
  output: 'Short context output',
};

const SPECIALIZED_TABLE: TableSpec = {
  header: SPECIALIZED_HEADER,
  model: 'Model',
  input: 'Input',
  cached: 'Cached input',
  output: 'Output',
};

function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function sameCells(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((cell, index) => cell === b[index]);
}

function nextNonBlank(lines: readonly string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim() !== '') return index;
  }
  return -1;
}

/** The rows of the table whose header is at `headerIndex`, or null if the header or separator is wrong. */
function tableRows(lines: readonly string[], headerIndex: number, header: readonly string[]): string[][] | null {
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

function indicesOf(lines: readonly string[], text: string): number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === text) found.push(index);
  });
  return found;
}

/** Locate both tables; null names the anchor that failed. */
function locateTables(lines: readonly string[]): { standard: string[][]; specialized: string[][] } | { failed: AnchorId } {
  const headings = indicesOf(lines, STANDARD_HEADING);
  if (headings.length !== 1) return { failed: 'A1' };
  const heading = headings[0];

  let unitLine: string | null = null;
  for (let index = heading - 1; index >= 0; index -= 1) {
    const text = lines[index].trim();
    if (text.startsWith('Prices per')) {
      unitLine = text;
      break;
    }
  }
  if (unitLine !== UNIT_LINE) return { failed: 'A3' };

  const standard = tableRows(lines, nextNonBlank(lines, heading + 1), STANDARD_HEADER);
  if (!standard) return { failed: 'A2' };

  const labels = indicesOf(lines, SPECIALIZED_LABEL);
  if (labels.length !== 1) return { failed: 'A4' };
  let cursor = labels[0];
  for (const expected of [UNIT_LINE, TIER_LABEL, GROUPED_HEADING]) {
    cursor = nextNonBlank(lines, cursor + 1);
    if (cursor < 0 || lines[cursor].trim() !== expected) return { failed: 'A4' };
  }
  const specialized = tableRows(lines, nextNonBlank(lines, cursor + 1), SPECIALIZED_HEADER);
  if (!specialized) return { failed: 'A4' };

  return { standard, specialized };
}

/** Coverage ids a model cell names, and the dropped note (if any). */
export function matchModelCell(cell: string, coverage: ReadonlySet<string>): { matches: string[]; note: string | null } {
  let name = cell.trim();
  let note: string | null = null;
  const noted = TRAILING_NOTE.exec(name);
  if (noted) {
    name = noted[1].trim();
    note = noted[2].trim();
  }
  name = name.toLowerCase().split(' ').filter(Boolean).join('-');
  const candidates = Array.from(new Set([name, name.split('.').join('-')])).filter((candidate) =>
    MODEL_ID_REGEX.test(candidate)
  );
  return { matches: candidates.filter((candidate) => coverage.has(candidate)), note };
}

type CellRead = { kind: 'price'; value: string } | { kind: 'absent' } | { kind: 'other'; text: string };

function readCell(cell: string | undefined): CellRead {
  const text = (cell ?? '').trim();
  if (text === ABSENT_CELL) return { kind: 'absent' };
  const price = PRICE_CELL.exec(text);
  if (price) return { kind: 'price', value: price[1] };
  return { kind: 'other', text: text.slice(0, MAX_CELL_TEXT) };
}

type RowRead = { model: string; price?: ParsedTokenPrice; manual?: NeedsManualEntry; note: string | null };

function readRows(rows: string[][], spec: TableSpec, options: OpenAiParseOptions): RowRead[] {
  const at = (name: string) => spec.header.indexOf(name);
  const reads: RowRead[] = [];
  for (const cells of rows) {
    const modelCell = cells[at(spec.model)];
    if (modelCell === undefined) continue;
    const { matches, note } = matchModelCell(modelCell, options.coverage);
    if (matches.length === 0) continue; // coverage first: never judge a cell we do not need
    if (matches.length > 1) {
      for (const model of matches) reads.push({ model, manual: { model_name: model, reason: 'ambiguous_match' }, note });
      continue;
    }
    const model = matches[0];
    if (cells.length !== spec.header.length) {
      reads.push({ model, manual: { model_name: model, reason: 'wrong_cell_count' }, note });
      continue;
    }
    const input = readCell(cells[at(spec.input)]);
    const cached = readCell(cells[at(spec.cached)]);
    const output = readCell(cells[at(spec.output)]);

    const other = [input, cached, output].find((read): read is { kind: 'other'; text: string } => read.kind === 'other');
    if (other) {
      reads.push({ model, manual: { model_name: model, reason: 'cell_not_single_price', cell: other.text }, note });
      continue;
    }
    if (input.kind !== 'price') {
      reads.push({ model, manual: { model_name: model, reason: 'missing_price' }, note });
      continue;
    }
    let outputValue: string;
    if (output.kind === 'price') outputValue = output.value;
    else if (options.isInputOnly(model)) outputValue = '0';
    else {
      reads.push({ model, manual: { model_name: model, reason: 'missing_price' }, note });
      continue;
    }
    reads.push({
      model,
      note,
      price: {
        model_name: model,
        input_per_1m: input.value,
        output_per_1m: outputValue,
        ...(cached.kind === 'price' ? { cached_input_per_1m: cached.value } : {}),
      },
    });
  }
  return reads;
}

export function parseOpenAiPricing(text: string, options: OpenAiParseOptions): OpenAiParseResult {
  const lines = text.split(/\r?\n/);
  const located = locateTables(lines);
  if ('failed' in located) {
    return { outcome: 'layout_changed', failedAnchor: located.failed, lines: [], needsManual: [], notFound: [], nameNotes: [] };
  }

  const reads = [...readRows(located.standard, STANDARD_TABLE, options), ...readRows(located.specialized, SPECIALIZED_TABLE, options)];

  const byModel = new Map<string, RowRead[]>();
  for (const read of reads) byModel.set(read.model, [...(byModel.get(read.model) ?? []), read]);

  const priced: ParsedTokenPrice[] = [];
  const needsManual: NeedsManualEntry[] = [];
  const nameNotes: NameNote[] = [];
  for (const [model, modelReads] of byModel) {
    if (modelReads.length > 1) {
      needsManual.push({ model_name: model, reason: modelReads.some((read) => read.manual?.reason === 'ambiguous_match') ? 'ambiguous_match' : 'listed_twice' });
      continue;
    }
    const [read] = modelReads;
    if (read.manual) needsManual.push(read.manual);
    else if (read.price) priced.push(read.price);
    if (read.note) nameNotes.push({ model_name: model, note: read.note.slice(0, MAX_CELL_TEXT) });
  }

  const notFound = [...options.coverage].filter((model) => !byModel.has(model)).sort();
  priced.sort((a, b) => a.model_name.localeCompare(b.model_name));
  needsManual.sort((a, b) => a.model_name.localeCompare(b.model_name));

  return { outcome: 'ok', lines: priced, needsManual, notFound, nameNotes };
}
