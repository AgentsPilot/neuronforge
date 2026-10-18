/**
 * Anthropic pricing page adapter (AI model price review slice 10; SA RR-1,
 * O-1, O-3, O-5, O-6, SC10-1), against a trimmed copy of the official markdown
 * page captured 2026-10-18 (`__fixtures__/anthropic-pricing-2026-10-18.md`).
 * Negative controls are built by replacing exactly one thing in that copy.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { MODEL_PRICING_HEADER, parseAnthropicPricing } from '../anthropicPricingAdapter';

forbidRealNetwork();

// Normalised to LF so the controls below match on a Windows checkout too.
const PAGE = readFileSync(join(__dirname, '..', '__fixtures__', 'anthropic-pricing-2026-10-18.md'), 'utf8').replace(/\r\n/g, '\n');

/** The thirteen Anthropic ids in coverage today (T-0 production read, 2026-10-18). */
const COVERAGE = new Set([
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-opus-4-5-20251101',
  'claude-opus-4-6',
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-6',
]);

const parse = (text: string, coverage: ReadonlySet<string> = COVERAGE) => parseAnthropicPricing(text, { coverage });
const lineFor = (text: string, model: string, coverage?: ReadonlySet<string>) =>
  parse(text, coverage).lines.find((line) => line.model_name === model);

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`expected exactly one ${from}`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** The full row line of the Model pricing table whose model cell starts with `name |` (padded). */
function rowOf(name: string): string {
  const table = PAGE.split('## Cloud platform pricing')[0];
  const row = table.split('\n').find((line) => new RegExp(`^[|] ${name.replace('.', '[.]')} +[|(]`).test(line));
  if (!row) throw new Error(`no row ${name}`);
  return row;
}

function withCells(name: string, edit: (cells: string[]) => string[]): string {
  const row = rowOf(name);
  const cells = row.slice(1, -1).split('|');
  return replaceOnce(PAGE, row, `|${edit(cells).join('|')}|`);
}

describe('the 2026-10-18 page', () => {
  it('reads the Model pricing table into token lines for the covered models, as written', () => {
    const result = parse(PAGE);
    expect(result.outcome).toBe('ok');
    expect(result.lines).toEqual([
      { model_name: 'claude-haiku-4-5-20251001', input_per_1m: '1', output_per_1m: '5' },
      { model_name: 'claude-opus-4-1-20250805', input_per_1m: '15', output_per_1m: '75' },
      { model_name: 'claude-opus-4-20250514', input_per_1m: '15', output_per_1m: '75' },
      { model_name: 'claude-opus-4-5-20251101', input_per_1m: '5', output_per_1m: '25' },
      { model_name: 'claude-opus-4-6', input_per_1m: '5', output_per_1m: '25' },
      { model_name: 'claude-sonnet-4-20250514', input_per_1m: '3', output_per_1m: '15' },
      { model_name: 'claude-sonnet-4-5-20250929', input_per_1m: '3', output_per_1m: '15' },
      { model_name: 'claude-sonnet-4-6', input_per_1m: '3', output_per_1m: '15' },
    ]);
    expect(result.needsManual).toEqual([]);
  });

  it('never proposes a cache price; reports that the page lists one (SA O-3)', () => {
    const result = parse(PAGE);
    for (const line of result.lines) expect(line).not.toHaveProperty('cached_input_per_1m');
    expect(result.cacheListed).toEqual(result.lines.map((line) => line.model_name).sort());
  });

  it('a coverage model the page does not yield is "not found" (retired 3.x; Haiku 3.5 word order)', () => {
    expect(parse(PAGE).notFound).toEqual([
      'claude-3-5-haiku-20241022',
      'claude-3-5-sonnet-20241022',
      'claude-3-haiku-20240307',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
    ]);
  });

  it('snapshot rule: "Claude Opus 4" is the 4 snapshot, never the 4.1 snapshot', () => {
    expect(lineFor(PAGE, 'claude-opus-4-20250514')).toEqual({ model_name: 'claude-opus-4-20250514', input_per_1m: '15', output_per_1m: '75' });
    expect(PAGE).toContain('| Claude Opus 4.1 ([retired, except on Bedrock and Google Cloud]');
  });

  it('a linked note is kept as text only and does not set retiring (SA O-6, SC10-6)', () => {
    const notes = parse(PAGE).nameNotes;
    expect(notes).toEqual([
      { model_name: 'claude-opus-4-1-20250805', note: 'retired, except on Bedrock and Google Cloud' },
      { model_name: 'claude-opus-4-20250514', note: 'retired, except on Google Cloud' },
      { model_name: 'claude-sonnet-4-20250514', note: 'retired, except on Bedrock and Google Cloud' },
    ]);
    for (const note of notes) expect(note.note).not.toMatch(/https?:|[[\]()]/);
    expect(JSON.stringify(parse(PAGE))).not.toContain('retiring');
  });

  it('keeps the digits exactly as written, with no float at any step', () => {
    const coverage = new Set(['claude-haiku-4-5', 'claude-opus-5-5']);
    const page = withCells('Claude Haiku 4.5', (cells) => cells.map((cell, index) => (index === 1 ? ' $0.125 / MTok ' : index === 5 ? ' $5.000 / MTok ' : cell)));
    expect(lineFor(page, 'claude-haiku-4-5', coverage)).toEqual({ model_name: 'claude-haiku-4-5', input_per_1m: '0.125', output_per_1m: '5.000' });
    expect(lineFor(PAGE, 'claude-opus-5-5', coverage)).toEqual({ model_name: 'claude-opus-5-5', input_per_1m: '4', output_per_1m: '20' });
  });

  it('out-of-coverage rows are ignored before any cell is judged', () => {
    const page = withCells('Claude Fable 5', (cells) => cells.map((cell, index) => (index === 1 ? ' Free ' : cell)));
    expect(parse(page)).toEqual(parse(PAGE));
  });
});

describe('negative controls: only the Model pricing table and its read columns', () => {
  it('Batch is never read (Sonnet 4.6 is never 1.50)', () => {
    expect(PAGE).toContain('| Claude Sonnet 4.6                                                                                                                    | $1.50 / MTok | $7.50 / MTok  |');
    expect(lineFor(PAGE, 'claude-sonnet-4-6')?.input_per_1m).toBe('3');
  });

  it('Fast mode is never read', () => {
    const coverage = new Set(['claude-opus-5-5']);
    expect(lineFor(PAGE, 'claude-opus-5-5', coverage)?.input_per_1m).toBe('4');
    expect(JSON.stringify(parse(PAGE, coverage))).not.toContain('"8"');
  });

  it('the cache-write columns are never read (garbage in them changes nothing)', () => {
    let page = PAGE;
    for (const name of ['Claude Sonnet 4.6', 'Claude Opus 4.6', 'Claude Haiku 4.5']) {
      const row = rowOf(name);
      const cells = row.slice(1, -1).split('|');
      cells[2] = ' garbage ';
      cells[3] = ' $9 per million or so ';
      page = replaceOnce(page, row, `|${cells.join('|')}|`);
    }
    expect(parse(page)).toEqual(parse(PAGE));
  });
});

describe('cells that are not exactly one price go to manual entry', () => {
  it('a footnoted read cell (a coverage double for Claude Sonnet 5)', () => {
    const result = parse(PAGE, new Set(['claude-sonnet-5']));
    expect(result.lines).toEqual([]);
    expect(result.needsManual).toEqual([{ model_name: 'claude-sonnet-5', reason: 'cell_not_single_price', cell: '$2 / MTok<sup>3</sup>' }]);
  });

  it('a "-" output and an empty input are missing prices', () => {
    const dash = withCells('Claude Sonnet 4.6', (cells) => cells.map((cell, index) => (index === 5 ? ' - ' : cell)));
    expect(parse(dash).needsManual).toEqual([{ model_name: 'claude-sonnet-4-6', reason: 'missing_price' }]);
    const empty = withCells('Claude Sonnet 4.6', (cells) => cells.map((cell, index) => (index === 1 ? ' ' : cell)));
    expect(parse(empty).needsManual).toEqual([{ model_name: 'claude-sonnet-4-6', reason: 'missing_price' }]);
  });

  it('a row with the wrong number of cells', () => {
    const page = withCells('Claude Opus 4.6', (cells) => cells.slice(0, 5));
    const result = parse(page);
    expect(result.outcome).toBe('ok');
    expect(result.needsManual).toEqual([{ model_name: 'claude-opus-4-6', reason: 'wrong_cell_count' }]);
  });

  it('one model on two rows (Haiku 5.5 priced by prompt length) is listed twice', () => {
    const result = parse(PAGE, new Set(['claude-haiku-5-5']));
    expect(result.lines).toEqual([]);
    expect(result.needsManual).toEqual([{ model_name: 'claude-haiku-5-5', reason: 'listed_twice' }]);
  });

  it('two dated ids for one row are ambiguous (SC10-1)', () => {
    const result = parse(PAGE, new Set(['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20251201']));
    expect(result.lines).toEqual([]);
    expect(result.needsManual).toEqual([
      { model_name: 'claude-sonnet-4-5-20250929', reason: 'ambiguous_match' },
      { model_name: 'claude-sonnet-4-5-20251201', reason: 'ambiguous_match' },
    ]);
  });

  it('the dateless id and a dated id both in coverage are ambiguous (SC10-1: a union, not a fallback)', () => {
    const result = parse(PAGE, new Set(['claude-sonnet-4-6', 'claude-sonnet-4-6-20260101']));
    expect(result.lines).toEqual([]);
    expect(result.needsManual.map((entry) => [entry.model_name, entry.reason])).toEqual([
      ['claude-sonnet-4-6', 'ambiguous_match'],
      ['claude-sonnet-4-6-20260101', 'ambiguous_match'],
    ]);
  });
});

describe('a missing anchor fails Anthropic with zero lines (layout_changed)', () => {
  const header = `| ${MODEL_PRICING_HEADER.join(' | ')} |`;
  const headerLine = PAGE.split('\n').find((line) => line.startsWith('| Model ') && line.includes('Base input tokens')) ?? '';
  const separatorLine = PAGE.split('\n')[PAGE.split('\n').indexOf(headerLine) + 1];

  it('the fixture header is exactly the pinned six cells', () => {
    expect(headerLine.split('|').slice(1, -1).map((cell) => cell.trim())).toEqual([...MODEL_PRICING_HEADER]);
    expect(header).toContain('Cache hits and refreshes');
  });

  it.each([
    ['B1 heading renamed', () => replaceOnce(PAGE, '## Model pricing\n', '## Model prices\n'), 'B1'],
    ['B1 heading twice', () => replaceOnce(PAGE, '## Cloud platform pricing\n', '## Model pricing\n'), 'B1'],
    ['B2 header cell renamed', () => replaceOnce(PAGE, headerLine, headerLine.replace('Cache hits and refreshes', 'Cache hits & refreshes ')), 'B2'],
    ['B2 a column added', () => replaceOnce(PAGE, headerLine, `${headerLine} Batch |`), 'B2'],
    ['B2 separator missing', () => replaceOnce(PAGE, `${headerLine}\n${separatorLine}\n`, `${headerLine}\n`), 'B2'],
    ['B2 a heading between the heading and the table', () => replaceOnce(PAGE, 'The following table shows pricing for all Claude models:', '### Legacy models'), 'B2'],
    ['B3 a read cell in another unit', () => withCells('Claude Opus 4.7', (cells) => cells.map((cell, index) => (index === 1 ? ' $5 per MTok ' : cell))), 'B3'],
    ['B3 a cache-hit cell in another unit', () => withCells('Claude Fable 5', (cells) => cells.map((cell, index) => (index === 4 ? ' $0.30 USD / MTok ' : cell))), 'B3'],
  ])('%s', (_label, build, anchor) => {
    const result = parse(build());
    expect(result).toEqual({ outcome: 'layout_changed', failedAnchor: anchor, lines: [], needsManual: [], notFound: [], nameNotes: [], cacheListed: [] });
  });

  it('a Windows line-ending copy still parses', () => {
    expect(parse(PAGE.split('\n').join('\r\n')).lines).toHaveLength(8);
  });

  it('the table ends before Cloud platform pricing', () => {
    // A stray row after the table's end is never read.
    const page = replaceOnce(PAGE, '## Cloud platform pricing\n', '## Cloud platform pricing\n\n| Claude Sonnet 4.6 | $99 / MTok | - | - | - | $99 / MTok |\n');
    expect(lineFor(page, 'claude-sonnet-4-6')?.input_per_1m).toBe('3');
  });
});
