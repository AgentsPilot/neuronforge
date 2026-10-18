/**
 * The shared model-name matcher (AI model price review slice 10; SA O-10,
 * SC10-1). Options default OFF, so OpenAI's slice 5 behaviour is unchanged
 * (its own suite, `openaiPricingAdapter.test.ts`, runs unedited as the proof).
 */

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { matchModelCellWith, SNAPSHOT_SUFFIX } from '../modelCellMatcher';
import { matchModelCell } from '../openaiPricingAdapter';

forbidRealNetwork();

const ANTHROPIC = { linksToText: true, snapshotSuffix: true } as const;
const LINKED = 'Claude Opus 4.1 ([retired, except on Bedrock and Google Cloud](https://platform.claude.com/docs/en/about-claude/model-deprecations))';

describe('the OpenAI option set (every option off) is the slice 5 rule', () => {
  it.each([
    ['gpt-4.1', ['gpt-4.1'], ['gpt-4.1'], null],
    ['Claude Sonnet 4.6', ['claude-sonnet-4-6'], ['claude-sonnet-4-6'], null],
    ['gpt-4o', ['gpt-4o'], ['gpt-4o'], null],
    ['a.b', ['a.b', 'a-b'], ['a.b', 'a-b'], null],
    ['`gpt-4o`', ['`gpt-4o`', 'gpt-4o'], [], null],
    ['gpt-5.4 (<272K context length)', ['gpt-5.4'], ['gpt-5.4'], '<272K context length'],
  ] as const)('%s', (cell, coverage, matches, note) => {
    const expected = { matches: [...matches], note };
    expect(matchModelCellWith(cell, new Set(coverage))).toEqual(expected);
    expect(matchModelCellWith(cell, new Set(coverage), { linksToText: false, snapshotSuffix: false })).toEqual(expected);
    expect(matchModelCell(cell, new Set(coverage))).toEqual(expected);
  });

  it('a note holding a markdown link is NOT dropped without the link option, so nothing matches', () => {
    expect(matchModelCell(LINKED, new Set(['claude-opus-4-1', 'claude-opus-4-1-20250805'])).matches).toEqual([]);
  });

  it('no dated snapshot without the snapshot option', () => {
    expect(matchModelCell('Claude Sonnet 4.5', new Set(['claude-sonnet-4-5-20250929'])).matches).toEqual([]);
  });
});

describe('links to text (Anthropic option)', () => {
  it('reduces the link to its text, then drops the one trailing note and keeps it as text only', () => {
    expect(matchModelCellWith(LINKED, new Set(['claude-opus-4-1']), ANTHROPIC)).toEqual({
      matches: ['claude-opus-4-1'],
      note: 'retired, except on Bedrock and Google Cloud',
    });
  });

  it('a link in the name itself becomes its text', () => {
    expect(matchModelCellWith('[Claude Haiku 4.5](https://example.invalid/x)', new Set(['claude-haiku-4-5']), ANTHROPIC).matches).toEqual([
      'claude-haiku-4-5',
    ]);
  });
});

describe('dated snapshot suffix (Anthropic option, SC10-1)', () => {
  it('the suffix is a hyphen and exactly eight digits', () => {
    expect(SNAPSHOT_SUFFIX.test('-20250929')).toBe(true);
    for (const bad of ['-2025092', '-202509290', '20250929', '-1-20250805', '-v20250929', '-2025-09-29']) {
      expect({ bad, ok: SNAPSHOT_SUFFIX.test(bad) }).toEqual({ bad, ok: false });
    }
  });

  it('matches the dated id of a named model', () => {
    expect(matchModelCellWith('Claude Sonnet 4.5', new Set(['claude-sonnet-4-5-20250929']), ANTHROPIC).matches).toEqual([
      'claude-sonnet-4-5-20250929',
    ]);
  });

  it('"Claude Opus 4" matches the 4 snapshot, never the 4.1 snapshot', () => {
    const coverage = new Set(['claude-opus-4-20250514', 'claude-opus-4-1-20250805']);
    expect(matchModelCellWith('Claude Opus 4', coverage, ANTHROPIC).matches).toEqual(['claude-opus-4-20250514']);
    expect(matchModelCellWith('Claude Opus 4.1', coverage, ANTHROPIC).matches).toEqual(['claude-opus-4-1-20250805']);
  });

  it('a union, not a fallback: dateless and dated both in coverage are two matches', () => {
    expect(matchModelCellWith('Claude Sonnet 4.6', new Set(['claude-sonnet-4-6', 'claude-sonnet-4-6-20260101']), ANTHROPIC).matches).toEqual([
      'claude-sonnet-4-6',
      'claude-sonnet-4-6-20260101',
    ]);
  });

  it('two dated ids for one name are two matches', () => {
    expect(
      matchModelCellWith('Claude Sonnet 4.5', new Set(['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20251201']), ANTHROPIC).matches
    ).toEqual(['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20251201']);
  });

  it('word order is not guessed, and a candidate must pass the model id pattern', () => {
    expect(matchModelCellWith('Claude Haiku 3.5', new Set(['claude-3-5-haiku-20241022']), ANTHROPIC).matches).toEqual([]);
    expect(matchModelCellWith('Claude_Haiku 4.5', new Set(['claude_haiku-4-5-20251001']), ANTHROPIC).matches).toEqual([]);
  });
});
