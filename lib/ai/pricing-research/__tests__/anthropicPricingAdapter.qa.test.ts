/**
 * QA edge cases for the Anthropic pricing adapter (AI model price review
 * slice 10, QA 2026-10-18). Pins what the Dev suite leaves implicit: the
 * 80-character cut of page notes and cell text (an uncut one would fail the
 * strict outcomes schema and lose the whole round), the exact decimal text of
 * prices, odd whitespace in the model cell, and rows for models we do not cover.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { parseAnthropicPricing } from '../anthropicPricingAdapter';
import { AdapterOutcomeSchema, MAX_CELL_TEXT } from '../fetchOutcomes';

forbidRealNetwork();

const PAGE = readFileSync(join(__dirname, '..', '__fixtures__', 'anthropic-pricing-2026-10-18.md'), 'utf8').replace(/\r\n/g, '\n');

function rowOf(name: string): string {
  const table = PAGE.split('## Cloud platform pricing')[0];
  const row = table.split('\n').find((line) => new RegExp(`^[|] ${name.replace('.', '[.]')} +[|(]`).test(line));
  if (!row) throw new Error(`no row ${name}`);
  return row;
}

function withCells(name: string, edit: (cells: string[]) => string[]): string {
  const row = rowOf(name);
  const cells = row.slice(1, -1).split('|');
  return PAGE.replace(row, `|${edit(cells).join('|')}|`);
}

/** The adapter's lists as the round stores them: must pass the strict outcome schema. */
function storable(result: ReturnType<typeof parseAnthropicPricing>) {
  return AdapterOutcomeSchema.safeParse({
    outcome: result.outcome,
    fetched_at: '2026-10-18T12:00:00.000Z',
    duration_ms: 1,
    bytes: 1,
    lines_stored: result.lines.length,
    needs_manual: result.needsManual,
    not_found: result.notFound,
    refused: [],
    name_notes: result.nameNotes,
  }).success;
}

describe('QA: text cut to the stored limit', () => {
  it('a long linked page note is cut to 80 characters, text only, and still storable', () => {
    const long = `retired, except on ${'Some Very Long Cloud Platform Name '.repeat(5)}`.trim();
    const page = withCells('Claude Sonnet 4.6', (cells) => [` Claude Sonnet 4.6 ([${long}](https://example.invalid/a)) `, ...cells.slice(1)]);
    const result = parseAnthropicPricing(page, { coverage: new Set(['claude-sonnet-4-6']) });
    expect(result.lines.map((line) => line.model_name)).toEqual(['claude-sonnet-4-6']);
    expect(result.nameNotes).toEqual([{ model_name: 'claude-sonnet-4-6', note: long.slice(0, MAX_CELL_TEXT) }]);
    expect(result.nameNotes[0].note).not.toMatch(/https?:|example\.invalid/);
    expect(storable(result)).toBe(true);
  });

  it('a long non-price read cell (not starting with $, so B3 does not apply) is cut to 80 characters and still storable', () => {
    const text = `Priced by prompt length: up to 200K tokens, then ${'a longer explanation '.repeat(6)}`.trim();
    const page = withCells('Claude Sonnet 4.6', (cells) => cells.map((cell, index) => (index === 5 ? ` ${text} ` : cell)));
    const result = parseAnthropicPricing(page, { coverage: new Set(['claude-sonnet-4-6']) });
    expect(result.outcome).toBe('ok');
    expect(result.needsManual).toEqual([{ model_name: 'claude-sonnet-4-6', reason: 'cell_not_single_price', cell: text.slice(0, MAX_CELL_TEXT) }]);
    expect(storable(result)).toBe(true);
  });
});

describe('QA: decimal text exactly as written', () => {
  it.each([
    ['$0.80 / MTok', '0.80'],
    ['$15 / MTok', '15'],
    ['$1.25 / MTok', '1.25'],
  ])('%s → "%s"', (cell, digits) => {
    const page = withCells('Claude Haiku 4.5', (cells) => cells.map((value, index) => (index === 1 || index === 5 ? ` ${cell} ` : value)));
    const result = parseAnthropicPricing(page, { coverage: new Set(['claude-haiku-4-5-20251001']) });
    expect(result.lines).toEqual([{ model_name: 'claude-haiku-4-5-20251001', input_per_1m: digits, output_per_1m: digits }]);
  });

  it('the fixture Haiku 3.5 "$0.80" row reads as "0.80" when covered under its page name', () => {
    const result = parseAnthropicPricing(PAGE, { coverage: new Set(['claude-haiku-3-5']) });
    expect(result.lines).toEqual([{ model_name: 'claude-haiku-3-5', input_per_1m: '0.80', output_per_1m: '4' }]);
  });
});

describe('QA: whitespace and unicode in the model cell', () => {
  it('extra ASCII spaces between words still match', () => {
    const page = withCells('Claude Sonnet 4.6', (cells) => ['  Claude   Sonnet  4.6  ', ...cells.slice(1)]);
    expect(parseAnthropicPricing(page, { coverage: new Set(['claude-sonnet-4-6']) }).lines).toHaveLength(1);
  });

  it('a non-breaking space inside the name does not match: the model reads "not found", never a wrong price', () => {
    const page = withCells('Claude Sonnet 4.6', (cells) => [` Claude${String.fromCharCode(0xa0)}Sonnet 4.6 `, ...cells.slice(1)]);
    const result = parseAnthropicPricing(page, { coverage: new Set(['claude-sonnet-4-6']) });
    expect(result.outcome).toBe('ok');
    expect(result.lines).toEqual([]);
    expect(result.notFound).toEqual(['claude-sonnet-4-6']);
  });

  it('a link whose URL holds parentheses is not reduced: the model reads "not found", never a wrong price', () => {
    const page = withCells('Claude Opus 4.1', (cells) => [' Claude Opus 4.1 ([retired](https://example.invalid/a_(b))) ', ...cells.slice(1)]);
    const result = parseAnthropicPricing(page, { coverage: new Set(['claude-opus-4-1-20250805']) });
    expect(result.lines).toEqual([]);
    expect(result.notFound).toEqual(['claude-opus-4-1-20250805']);
  });
});

describe('QA: rows for models we do not cover', () => {
  it('an empty coverage set gives no line, no manual entry, no note', () => {
    expect(parseAnthropicPricing(PAGE, { coverage: new Set() })).toEqual({
      outcome: 'ok',
      lines: [],
      needsManual: [],
      notFound: [],
      nameNotes: [],
      cacheListed: [],
    });
  });

  it('an out-of-coverage row with a garbage model cell and a non-price read cell is ignored', () => {
    const page = withCells('Claude Fable 5.1', (cells) => [' ??? [x](y) ', ' Contact sales ', ...cells.slice(2)]);
    const coverage = new Set(['claude-sonnet-4-6']);
    expect(parseAnthropicPricing(page, { coverage })).toEqual(parseAnthropicPricing(PAGE, { coverage }));
  });
});
