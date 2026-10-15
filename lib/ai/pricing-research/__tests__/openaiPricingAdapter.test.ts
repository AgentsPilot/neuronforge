/**
 * OpenAI pricing page adapter (AI model price review slice 5; SA RR-1, SC-10),
 * against a trimmed copy of the official markdown page captured 2026-10-14
 * (`__fixtures__/openai-pricing-2026-10-14.md`). Negative controls are built by
 * string replacement on that copy, so each case changes exactly one thing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { matchModelCell, parseOpenAiPricing } from '../openaiPricingAdapter';

forbidRealNetwork();

const PAGE = readFileSync(join(__dirname, '..', '__fixtures__', 'openai-pricing-2026-10-14.md'), 'utf8');

const COVERAGE = new Set([
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
  'o3',
  'gpt-3.5-turbo',
  'gpt-4-turbo',
  'gpt-5.3-codex',
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-ada-002',
]);
const isInputOnly = (model: string) => model.startsWith('text-embedding-');

const parse = (text: string, coverage: ReadonlySet<string> = COVERAGE) => parseOpenAiPricing(text, { coverage, isInputOnly });
const lineFor = (text: string, model: string) => parse(text).lines.find((line) => line.model_name === model);

/** Replace exactly one occurrence, so a broken control fails loudly instead of testing nothing. */
function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`expected exactly one ${from}`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

describe('the 2026-10-14 page', () => {
  const result = parse(PAGE);

  it('reads the Standard table and the Specialized Standard table', () => {
    expect(result.outcome).toBe('ok');
    expect(result.lines.map((line) => line.model_name)).toEqual([
      'gpt-3.5-turbo',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-5.3-codex',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.5',
      'o3',
      'text-embedding-3-large',
      'text-embedding-3-small',
      'text-embedding-ada-002',
    ]);
  });

  it('takes the Standard price, never Batch, Flex or Fast (negative control)', () => {
    expect(lineFor(PAGE, 'gpt-4o-mini')).toEqual({
      model_name: 'gpt-4o-mini',
      input_per_1m: '0.15',
      output_per_1m: '0.60',
      cached_input_per_1m: '0.075',
    });
    expect(PAGE).toContain('| gpt-4o-mini | $0.075 | - | - | $0.30 |');
    expect(PAGE).toContain('| gpt-4o-mini | $0.25 | $0.125 | - | $1.00 |');
  });

  it('keeps the digits exactly as written, with no float at any step', () => {
    for (const line of result.lines) {
      for (const value of [line.input_per_1m, line.output_per_1m, line.cached_input_per_1m]) {
        if (value === undefined || value === '0') continue;
        expect(PAGE).toContain(`$${value}`);
      }
    }
  });

  it('drops a trailing note and records it (gpt-5.4 (<272K context length))', () => {
    expect(lineFor(PAGE, 'gpt-5.4')).toEqual({ model_name: 'gpt-5.4', input_per_1m: '2.50', output_per_1m: '15.00', cached_input_per_1m: '0.25' });
    expect(result.nameNotes).toContainEqual({ model_name: 'gpt-5.4', note: '<272K context length' });
  });

  it('a "-" cached input is omitted; a "-" output is "0" for an input-only model', () => {
    expect(lineFor(PAGE, 'gpt-3.5-turbo')).toEqual({ model_name: 'gpt-3.5-turbo', input_per_1m: '0.50', output_per_1m: '1.50' });
    expect(lineFor(PAGE, 'text-embedding-3-small')).toEqual({ model_name: 'text-embedding-3-small', input_per_1m: '0.02', output_per_1m: '0' });
  });

  it('the Specialized Fast table is not read (gpt-5.3-codex is Standard, not listed twice)', () => {
    expect(lineFor(PAGE, 'gpt-5.3-codex')).toEqual({ model_name: 'gpt-5.3-codex', input_per_1m: '1.75', output_per_1m: '14.00', cached_input_per_1m: '0.175' });
    expect(result.needsManual).toEqual([]);
  });

  it('a coverage model the page does not yield is "not found"', () => {
    expect(result.notFound).toEqual(['gpt-4-turbo']);
  });

  it('out-of-coverage rows are ignored before any cell is judged ("Free" on moderation)', () => {
    expect(result.lines.find((line) => line.model_name === 'omni-moderation-latest')).toBeUndefined();
    const withModeration = parse(PAGE, new Set([...COVERAGE, 'omni-moderation-latest']));
    expect(withModeration.needsManual).toContainEqual({ model_name: 'omni-moderation-latest', reason: 'cell_not_single_price', cell: 'Free' });
  });
});

describe('cells that are not exactly one price go to manual entry', () => {
  it('a cell with two dated prices', () => {
    const page = replaceOnce(PAGE, '| gpt-4o | $2.50 |', '| gpt-4o | $0.75 through December 31, 2026. $1.50 starting January 1, 2027 |');
    const result = parse(page);
    expect(result.outcome).toBe('ok');
    expect(result.lines.find((line) => line.model_name === 'gpt-4o')).toBeUndefined();
    expect(result.needsManual).toEqual([
      { model_name: 'gpt-4o', reason: 'cell_not_single_price', cell: '$0.75 through December 31, 2026. $1.50 starting January 1, 2027' },
    ]);
  });

  it('a "-" output on a chat model', () => {
    const page = replaceOnce(PAGE, '| o3 | $2.00 | $0.50 | - | $8.00 |', '| o3 | $2.00 | $0.50 | - | - |');
    expect(parse(page).needsManual).toEqual([{ model_name: 'o3', reason: 'missing_price' }]);
  });

  it('a row with the wrong number of cells', () => {
    const page = replaceOnce(PAGE, '| gpt-4.1 | $2.00 | $0.50 | - | $8.00 | - | - | - | - |', '| gpt-4.1 | $2.00 | $0.50 | $8.00 |');
    expect(parse(page).needsManual).toEqual([{ model_name: 'gpt-4.1', reason: 'wrong_cell_count' }]);
  });

  it('a model listed twice in the Standard table', () => {
    const page = replaceOnce(PAGE, '| o3 | $2.00 |', '| gpt-4o | $9.00 | - | - | $9.00 | - | - | - | - |\n| o3 | $2.00 |');
    const result = parse(page);
    expect(result.needsManual).toEqual([{ model_name: 'gpt-4o', reason: 'listed_twice' }]);
    expect(result.lines.find((line) => line.model_name === 'gpt-4o')).toBeUndefined();
  });

  it('a cell holding a comma or a unit suffix', () => {
    const page = replaceOnce(PAGE, '| gpt-4.1 | $2.00 |', '| gpt-4.1 | $2.00 / 1M characters |');
    expect(parse(page).needsManual).toEqual([{ model_name: 'gpt-4.1', reason: 'cell_not_single_price', cell: '$2.00 / 1M characters' }]);
  });
});

describe('a missing anchor fails OpenAI with zero lines (layout_changed)', () => {
  it.each([
    ['A1 heading renamed', () => replaceOnce(PAGE, '### Standard pricing data', '### Standard prices'), 'A1'],
    ['A1 heading twice', () => replaceOnce(PAGE, '### Flex pricing data', '### Standard pricing data'), 'A1'],
    ['A2 column renamed', () => replaceOnce(PAGE.split('### Batch')[0], 'Short context output |', 'Short output |') + '### Batch' + PAGE.split('### Batch').slice(1).join('### Batch'), 'A2'],
    ['A2 separator missing', () => replaceOnce(PAGE, '### Standard pricing data\n\n| Model | Short context input', '### Standard pricing data\n\nPreface\n| Model | Short context input'), 'A2'],
    ['A3 "unless noted" decoy is the nearest unit line', () => replaceOnce(PAGE, 'Standard\n\n### Standard pricing data', 'Prices per 1M tokens unless noted.\n\nStandard\n\n### Standard pricing data'), 'A3'],
    ['A3 unit line missing', () => replaceOnce(PAGE, 'Our latest models\n\nPrices per 1M tokens.', 'Our latest models'), 'A3'],
    ['A4 label renamed', () => replaceOnce(PAGE, 'Specialized models', 'Special models'), 'A4'],
    ['A4 unit line changed', () => replaceOnce(PAGE, 'Specialized models\n\nPrices per 1M tokens.', 'Specialized models\n\nPrices per 1M tokens unless noted.'), 'A4'],
    ['A4 header changed', () => replaceOnce(PAGE, '| Category | Model | Input | Cached input | Output |\n| --- | --- | --- | --- | --- |\n| ChatGPT', '| Category | Model | Input | Output |\n| --- | --- | --- | --- |\n| ChatGPT'), 'A4'],
  ])('%s', (_label, build, anchor) => {
    const result = parse(build());
    expect(result).toEqual({ outcome: 'layout_changed', failedAnchor: anchor, lines: [], needsManual: [], notFound: [], nameNotes: [] });
  });

  it('whitespace-only blank lines and indented anchor labels, as on the live page (SA F-5)', () => {
    const padded = PAGE.split('\n')
      .map((line) => (line === '' ? '    ' : line))
      .map((line) => (line === '### Standard pricing data' || line === 'Specialized models' ? `      ${line}` : line))
      .join('\n');
    expect(padded).toContain('      ### Standard pricing data');
    expect(padded).toContain('      Specialized models');
    expect(padded).not.toMatch(/^$/m);
    expect(parse(padded).lines).toEqual(parse(PAGE).lines);
    expect(parse(padded).lines).toHaveLength(12);
  });

  it('a Windows line-ending copy still parses', () => {
    expect(parse(PAGE.split('\n').join('\r\n')).lines).toHaveLength(12);
  });
});

describe('model matching (O-2, SC-10)', () => {
  it('keeps dots, and also tries dots as hyphens, deduped', () => {
    expect(matchModelCell('gpt-4.1', new Set(['gpt-4.1']))).toEqual({ matches: ['gpt-4.1'], note: null });
    expect(matchModelCell('Claude Sonnet 4.6', new Set(['claude-sonnet-4-6']))).toEqual({ matches: ['claude-sonnet-4-6'], note: null });
    expect(matchModelCell('gpt-4o', new Set(['gpt-4o']))).toEqual({ matches: ['gpt-4o'], note: null });
  });

  it('two coverage matches are ambiguous; a candidate must pass the model id pattern', () => {
    expect(matchModelCell('a.b', new Set(['a.b', 'a-b'])).matches).toEqual(['a.b', 'a-b']);
    expect(matchModelCell('`gpt-4o`', new Set(['`gpt-4o`', 'gpt-4o'])).matches).toEqual([]);
  });

  it('an ambiguous row goes to manual entry', () => {
    const result = parseOpenAiPricing(PAGE, { coverage: new Set(['gpt-4.1', 'gpt-4-1']), isInputOnly });
    expect(result.needsManual).toEqual([{ model_name: 'gpt-4-1', reason: 'ambiguous_match' }, { model_name: 'gpt-4.1', reason: 'ambiguous_match' }]);
  });
});
