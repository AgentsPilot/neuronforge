/**
 * Anthropic official pricing page (markdown form) → pending token lines
 * (AI model price review slice 10; SA RR-1, SC-10, O-1, O-3, O-5, O-6,
 * SC10-1, SC10-6). Pure and deterministic: page text in, lines and problems
 * out. NO LLM reads the page.
 *
 * ── Anchors (any one missing → `layout_changed`, ZERO lines) ──────────────
 *   B1  the whole line `## Model pricing`, exactly once;
 *   B2  the first line starting with `|` after B1 is the header row, exactly
 *       the six cells of `MODEL_PRICING_HEADER`, then a separator row; only
 *       prose may stand between B1 and it (a heading in between fails B2).
 *       The table ends at the first line that does not start with `|`, so it
 *       never runs into Cloud platform, Fast mode or Batch;
 *   B3  the unit: Anthropic writes it in every cell, not the header, so every
 *       cell of `Base input tokens`, `Cache hits and refreshes` and `Output
 *       tokens` that starts with `$` must read `$<digits> / MTok`, optionally
 *       with one footnote. Checked on EVERY row (a layout check on the
 *       column's unit, never a price judgement: SA O-5).
 *
 * ── Cells ─────────────────────────────────────────────────────────────────
 * A read price is exactly `$<digits>[.<digits>] / MTok`; the digits are kept
 * AS WRITTEN ("$0.125 / MTok" → "0.125"), no float at any step. A footnoted
 * read cell, any other text → manual entry with the cell text (≤ 80
 * characters): a footnote can change what a price means, so the admin reads
 * it. `-` or an empty read cell → manual entry (`missing_price`); Anthropic
 * has no input-only model.
 *
 * Cache prices are NEVER proposed (SA O-3): nothing charges an Anthropic cache
 * rate. The two cache-write columns are never read; `Cache hits and refreshes`
 * is read only to report `cacheListed` (the provider lists a cache price).
 *
 * ── Model matching ────────────────────────────────────────────────────────
 * The shared matcher with both Anthropic options on: markdown links become
 * their text, and the dated-snapshot suffix (`-` + 8 digits) is a match in
 * union with the exact one (SC10-1). Coverage first; more than one match, or
 * one model on two rows, → manual entry. A name note ("retired, except on …")
 * is shown, never interpreted: it does not set `retiring` (SA O-6).
 */

import { MAX_CELL_TEXT, type NameNote, type NeedsManualEntry } from './fetchOutcomes';
import { indicesOf, tableRows } from './markdownTable';
import { matchModelCellWith, type ModelCellMatchOptions } from './modelCellMatcher';

export const MODEL_PRICING_HEADING = '## Model pricing';
export const MODEL_PRICING_HEADER = [
  'Model',
  'Base input tokens',
  '5m cache writes',
  '1h cache writes',
  'Cache hits and refreshes',
  'Output tokens',
] as const;

const COLUMN = {
  model: 'Model',
  input: 'Base input tokens',
  cacheHit: 'Cache hits and refreshes',
  output: 'Output tokens',
} as const;

/** B3: the unit form of any `$` cell in a column we read. */
const UNIT_CELL = /^[$][0-9]{1,6}([.][0-9]{1,9})? \/ MTok(<sup>[0-9]{1,2}<\/sup>)?$/;
/** A price we may store: no footnote. */
const PRICE_CELL = /^[$]([0-9]{1,6}(?:[.][0-9]{1,9})?) \/ MTok$/;
const ABSENT_CELLS: readonly string[] = ['-', ''];

const ANTHROPIC_MATCH_OPTIONS: ModelCellMatchOptions = { linksToText: true, snapshotSuffix: true };

export type AnthropicAnchorId = 'B1' | 'B2' | 'B3';

export interface AnthropicTokenPrice {
  model_name: string;
  input_per_1m: string;
  output_per_1m: string;
}

export interface AnthropicParseResult {
  outcome: 'ok' | 'layout_changed';
  /** The first anchor that failed, for the log line (never page text). */
  failedAnchor?: AnthropicAnchorId;
  lines: AnthropicTokenPrice[];
  needsManual: NeedsManualEntry[];
  notFound: string[];
  nameNotes: NameNote[];
  /** Models (with a line) whose row lists a cache-hit price; the price itself is never kept. */
  cacheListed: string[];
}

export interface AnthropicParseOptions {
  /** Anthropic model ids in the computed coverage set (MP-FR-2). */
  coverage: ReadonlySet<string>;
}

function locateTable(lines: readonly string[]): string[][] | { failed: AnthropicAnchorId } {
  const headings = indicesOf(lines, MODEL_PRICING_HEADING);
  if (headings.length !== 1) return { failed: 'B1' };

  let headerIndex = -1;
  for (let index = headings[0] + 1; index < lines.length; index += 1) {
    const text = lines[index].trim();
    if (text.startsWith('#')) return { failed: 'B2' };
    if (text.startsWith('|')) {
      headerIndex = index;
      break;
    }
  }
  const rows = tableRows(lines, headerIndex, MODEL_PRICING_HEADER);
  if (!rows) return { failed: 'B2' };

  const unitColumns = [COLUMN.input, COLUMN.cacheHit, COLUMN.output].map((name) =>
    (MODEL_PRICING_HEADER as readonly string[]).indexOf(name)
  );
  for (const cells of rows) {
    for (const column of unitColumns) {
      const cell = cells[column];
      if (cell !== undefined && cell.startsWith('$') && !UNIT_CELL.test(cell)) return { failed: 'B3' };
    }
  }
  return rows;
}

type CellRead = { kind: 'price'; value: string } | { kind: 'absent' } | { kind: 'other'; text: string };

function readCell(cell: string | undefined): CellRead {
  const text = (cell ?? '').trim();
  if (ABSENT_CELLS.includes(text)) return { kind: 'absent' };
  const price = PRICE_CELL.exec(text);
  if (price) return { kind: 'price', value: price[1] };
  return { kind: 'other', text: text.slice(0, MAX_CELL_TEXT) };
}

interface RowRead {
  model: string;
  price?: AnthropicTokenPrice;
  manual?: NeedsManualEntry;
  note: string | null;
  cacheListed: boolean;
}

function readRows(rows: string[][], coverage: ReadonlySet<string>): RowRead[] {
  const at = (name: string) => (MODEL_PRICING_HEADER as readonly string[]).indexOf(name);
  const reads: RowRead[] = [];
  for (const cells of rows) {
    const modelCell = cells[at(COLUMN.model)];
    if (modelCell === undefined) continue;
    const { matches, note } = matchModelCellWith(modelCell, coverage, ANTHROPIC_MATCH_OPTIONS);
    if (matches.length === 0) continue; // coverage first: never judge a cell we do not need
    if (matches.length > 1) {
      for (const model of matches) {
        reads.push({ model, manual: { model_name: model, reason: 'ambiguous_match' }, note, cacheListed: false });
      }
      continue;
    }
    const model = matches[0];
    if (cells.length !== MODEL_PRICING_HEADER.length) {
      reads.push({ model, manual: { model_name: model, reason: 'wrong_cell_count' }, note, cacheListed: false });
      continue;
    }
    const input = readCell(cells[at(COLUMN.input)]);
    const output = readCell(cells[at(COLUMN.output)]);
    const other = [input, output].find((read): read is { kind: 'other'; text: string } => read.kind === 'other');
    if (other) {
      reads.push({ model, manual: { model_name: model, reason: 'cell_not_single_price', cell: other.text }, note, cacheListed: false });
      continue;
    }
    if (input.kind !== 'price' || output.kind !== 'price') {
      reads.push({ model, manual: { model_name: model, reason: 'missing_price' }, note, cacheListed: false });
      continue;
    }
    reads.push({
      model,
      note,
      // B3 already proved any `$` cell in this column is a price in the page's unit.
      cacheListed: (cells[at(COLUMN.cacheHit)] ?? '').startsWith('$'),
      price: { model_name: model, input_per_1m: input.value, output_per_1m: output.value },
    });
  }
  return reads;
}

export function parseAnthropicPricing(text: string, options: AnthropicParseOptions): AnthropicParseResult {
  const lines = text.split(/\r?\n/);
  const located = locateTable(lines);
  if ('failed' in located) {
    return {
      outcome: 'layout_changed',
      failedAnchor: located.failed,
      lines: [],
      needsManual: [],
      notFound: [],
      nameNotes: [],
      cacheListed: [],
    };
  }

  const byModel = new Map<string, RowRead[]>();
  for (const read of readRows(located, options.coverage)) byModel.set(read.model, [...(byModel.get(read.model) ?? []), read]);

  const priced: AnthropicTokenPrice[] = [];
  const needsManual: NeedsManualEntry[] = [];
  const nameNotes: NameNote[] = [];
  const cacheListed: string[] = [];
  for (const [model, modelReads] of byModel) {
    if (modelReads.length > 1) {
      needsManual.push({
        model_name: model,
        reason: modelReads.some((read) => read.manual?.reason === 'ambiguous_match') ? 'ambiguous_match' : 'listed_twice',
      });
      continue;
    }
    const [read] = modelReads;
    if (read.manual) needsManual.push(read.manual);
    else if (read.price) {
      priced.push(read.price);
      if (read.cacheListed) cacheListed.push(model);
    }
    // SC10-6: the note is text only (links were reduced by the matcher), cut to the stored limit.
    if (read.note) nameNotes.push({ model_name: model, note: read.note.slice(0, MAX_CELL_TEXT) });
  }

  const notFound = [...options.coverage].filter((model) => !byModel.has(model)).sort();
  priced.sort((a, b) => a.model_name.localeCompare(b.model_name));
  needsManual.sort((a, b) => a.model_name.localeCompare(b.model_name));
  nameNotes.sort((a, b) => a.model_name.localeCompare(b.model_name));
  cacheListed.sort();

  return { outcome: 'ok', lines: priced, needsManual, notFound, nameNotes, cacheListed };
}
