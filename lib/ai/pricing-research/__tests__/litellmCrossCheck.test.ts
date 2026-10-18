/**
 * LiteLLM cross-check (AI model price review slice 5; MP-FR-6a, SA SC-11),
 * against a trimmed copy of the list captured 2026-10-14
 * (`__fixtures__/litellm-prices-2026-10-14.json`, 112 keys, values as spelled
 * in the original file).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { decimalFromNumberLiteral, formatDecimal } from '../decimal';
import { LITELLM_MIN_KEYS, crossCheckLine, parseLiteLlmList, type LiteLlmList } from '../litellmCrossCheck';

forbidRealNetwork();

const TEXT = readFileSync(join(__dirname, '..', '__fixtures__', 'litellm-prices-2026-10-14.json'), 'utf8');
const LIST = parseLiteLlmList(TEXT) as LiteLlmList;

const official = (model_name: string, input: string, output: string, cached?: string) => ({
  model_name,
  input_per_1m: input,
  output_per_1m: output,
  ...(cached === undefined ? {} : { cached_input_per_1m: cached }),
});

describe('parseLiteLlmList', () => {
  it('reads the fixture', () => {
    expect(LIST).not.toBeNull();
    expect(Object.keys(LIST.entries).length).toBeGreaterThanOrEqual(LITELLM_MIN_KEYS);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['too few keys', JSON.stringify({ a: {}, b: {} })],
    ['null', 'null'],
  ])('%s is not the list', (_label, text) => {
    expect(parseLiteLlmList(text)).toBeNull();
  });
});

describe('crossCheckLine', () => {
  it('agrees: the official Standard price equals the list exactly (7.5e-8 is 0.075 per 1M)', () => {
    expect(crossCheckLine(LIST, 'openai', official('gpt-4o-mini', '0.15', '0.60', '0.075'))).toEqual({
      verdict: 'agrees',
      flags: [],
      value: 'input 0.15, cached input 0.075, output 0.6 per 1M',
      diffPct: '0.00',
    });
  });

  it('differs by 3%: verdict differs, no flag', () => {
    const result = crossCheckLine(LIST, 'openai', official('gpt-4o', '2.575', '10.00', '1.25'));
    expect(result.verdict).toBe('differs');
    expect(result.flags).toEqual([]);
    expect(result.diffPct).toBe('2.91');
  });

  it('differs by more than 5%: the cross_check_differs flag', () => {
    const result = crossCheckLine(LIST, 'openai', official('gpt-4o', '2.50', '10.70', '1.25'));
    expect(result.verdict).toBe('differs');
    expect(result.flags).toEqual(['cross_check_differs']);
  });

  it('exactly 5% is not flagged; just over is (exact, never the rounded gap)', () => {
    const listOf = (inputPerToken: number): LiteLlmList => ({
      entries: { 'test-model': { litellm_provider: 'openai', input_cost_per_token: inputPerToken } },
    });
    // The base is the official price: 2.1 against 2 is exactly 5%.
    expect(crossCheckLine(listOf(0.0000021), 'openai', official('test-model', '2', '1'))).toEqual({
      verdict: 'differs',
      flags: [],
      value: 'input 2.1 per 1M',
      diffPct: '5.00',
    });
    // 2.10001 against 2 rounds to 5.00% for display, yet is beyond 5% and flagged.
    const over = crossCheckLine(listOf(0.00000210001), 'openai', official('test-model', '2', '1'));
    expect(over.flags).toEqual(['cross_check_differs']);
    expect(over.diffPct).toBe('5.00');
  });

  it('exactly 1 basis point agrees; 1.2 basis points (rounds to 1) differs, decided exactly (QA bug 3, M06c, M06e)', () => {
    const listOf = (inputPerToken: number): LiteLlmList => ({
      entries: { 'test-model': { litellm_provider: 'openai', input_cost_per_token: inputPerToken } },
    });
    // 2.0002 against 2 is exactly 1 bp: not "more than" 1 bp.
    expect(crossCheckLine(listOf(2.0002e-6), 'openai', official('test-model', '2', '1'))).toEqual({
      verdict: 'agrees',
      flags: [],
      value: 'input 2.0002 per 1M',
      diffPct: '0.01',
    });
    // 2.00024 against 2 is 1.2 bp: the rounded gap reads 1 bp, the exact gap is beyond it.
    expect(crossCheckLine(listOf(2.00024e-6), 'openai', official('test-model', '2', '1'))).toEqual({
      verdict: 'differs',
      flags: [],
      value: 'input 2.00024 per 1M',
      diffPct: '0.01',
    });
  });

  it('a 1 basis point difference still agrees; 2 do not', () => {
    expect(crossCheckLine(LIST, 'openai', official('gpt-4o', '2.50025', '10', '1.25')).verdict).toBe('agrees');
    expect(crossCheckLine(LIST, 'openai', official('gpt-4o', '2.5006', '10', '1.25')).verdict).toBe('differs');
  });

  it('an official 0 against a non-zero list value differs and is flagged; 0 against 0 agrees', () => {
    expect(crossCheckLine(LIST, 'openai', official('text-embedding-3-small', '0.02', '0'))).toEqual({
      verdict: 'agrees',
      flags: [],
      value: 'input 0.02, output 0 per 1M',
      diffPct: '0.00',
    });
    const zeroInput = crossCheckLine(LIST, 'openai', official('text-embedding-3-small', '0', '0'));
    expect(zeroInput.verdict).toBe('differs');
    expect(zeroInput.flags).toEqual(['cross_check_differs']);
    expect(zeroInput.diffPct).toBeNull();
  });

  it('only units both sides have are compared', () => {
    expect(crossCheckLine(LIST, 'openai', official('gpt-4o-mini', '0.15', '0.60')).verdict).toBe('agrees');
  });

  it.each([
    ['absent', 'no-such-model', 'openai'],
    ['a prefixed key only (azure)', 'azure-only', 'openai'],
    ['another provider', 'gpt-4o-mini', 'anthropic'],
  ])('not listed: %s', (_label, model, provider) => {
    expect(crossCheckLine(LIST, provider, official(model, '1', '1'))).toEqual({
      verdict: 'not_listed',
      flags: ['cross_check_not_listed'],
      value: null,
      diffPct: null,
    });
    expect(Object.keys(LIST.entries)).toContain('azure/gpt-4o-mini');
  });

  it('unavailable: no list, or an entry that fails the check', () => {
    expect(crossCheckLine(null, 'openai', official('gpt-4o-mini', '0.15', '0.60'))).toEqual({
      verdict: 'unavailable',
      flags: ['cross_check_unavailable'],
      value: null,
      diffPct: null,
    });
    const broken: LiteLlmList = { entries: { 'gpt-4o-mini': { litellm_provider: 'openai', input_cost_per_token: 'cheap' } } };
    expect(crossCheckLine(broken, 'openai', official('gpt-4o-mini', '0.15', '0.60')).verdict).toBe('unavailable');
  });

  it('a deprecation date adds retiring, with the date in the words (any date, no clock)', () => {
    const result = crossCheckLine(LIST, 'openai', official('gpt-4.1-nano', '0.10', '0.40', '0.025'));
    expect(result.verdict).toBe('agrees');
    expect(result.flags).toEqual(['retiring']);
    expect(result.value).toBe('input 0.1, cached input 0.025, output 0.4 per 1M; retirement date 2026-10-23');
  });

  it('value text never holds a float form', () => {
    for (const model of Object.keys(LIST.entries)) {
      const result = crossCheckLine(LIST, 'openai', official(model, '1', '1', '1'));
      expect(result.value ?? '').not.toMatch(/e-|e[+]/);
    }
  });
});

describe('every cost literal in the fixture converts to exactly the decimal its JSON text spells (SC-11)', () => {
  /** Spell a JSON number literal as a plain decimal by moving the point, as text. */
  function spelled(literal: string): string {
    const match = /^([0-9]+)(?:[.]([0-9]+))?(?:e([+-]?[0-9]+))?$/i.exec(literal);
    if (!match) throw new Error(`unexpected literal ${literal}`);
    const [, whole, fraction = '', exponent = '0'] = match;
    const digits = `${whole}${fraction}`;
    const point = whole.length + Number(exponent);
    const padded = point <= 0 ? `${'0'.repeat(1 - point)}${digits}` : digits.padEnd(point, '0');
    const at = point <= 0 ? 1 : point;
    const integer = padded.slice(0, at).replace(/^0+(?=[0-9])/, '');
    const decimals = padded.slice(at).replace(/0+$/, '');
    return decimals === '' ? integer : `${integer}.${decimals}`;
  }

  it('checks every *_cost* literal', () => {
    const literals = [...TEXT.matchAll(/"[a-z_]*cost[a-z_]*": ([0-9.e+-]+)/gi)].map((match) => match[1]);
    expect(literals.length).toBeGreaterThan(200);
    for (const literal of literals) {
      expect({ literal, value: formatDecimal(decimalFromNumberLiteral(Number(literal))) }).toEqual({ literal, value: spelled(literal) });
    }
  });
});

describe('Anthropic lines (slice 10; SA O-3, O-9)', () => {
  const FRAGMENT = JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', 'litellm-anthropic-entries-2026-10-18.json'), 'utf8')) as Record<string, unknown>;
  const MERGED = parseLiteLlmList(JSON.stringify({ ...JSON.parse(TEXT), ...FRAGMENT })) as LiteLlmList;

  it('agrees on input and output; the cache-read price is shown, never compared, and cache writes are never read', () => {
    const result = crossCheckLine(MERGED, 'anthropic', official('claude-sonnet-4-6', '3', '15'));
    expect(result).toEqual({ verdict: 'agrees', flags: [], value: 'input 3, cached input 0.3, output 15 per 1M', diffPct: '0.00' });
    expect(result.value).not.toContain('3.75');
  });

  it('a deprecation date gives `retiring`', () => {
    const result = crossCheckLine(MERGED, 'anthropic', official('claude-sonnet-4-5-20250929', '3', '15'));
    expect(result.flags).toEqual(['retiring']);
    expect(result.value).toContain('retirement date 2026-11-30');
  });

  it('a retired id LiteLLM dropped is `not_listed`', () => {
    expect(crossCheckLine(MERGED, 'anthropic', official('claude-opus-4-1-20250805', '15', '75')).verdict).toBe('not_listed');
  });

  it('a key under another provider is `not_listed`', () => {
    const list = parseLiteLlmList(
      JSON.stringify({ ...JSON.parse(TEXT), 'claude-haiku-4-5-20251001': { ...(FRAGMENT['claude-haiku-4-5-20251001'] as object), litellm_provider: 'bedrock' } })
    ) as LiteLlmList;
    expect(crossCheckLine(list, 'anthropic', official('claude-haiku-4-5-20251001', '1', '5')).verdict).toBe('not_listed');
  });

  it('the alias key never answers for a dated id', () => {
    const list = parseLiteLlmList(JSON.stringify({ ...JSON.parse(TEXT), 'claude-sonnet-4-5': FRAGMENT['claude-sonnet-4-5'] })) as LiteLlmList;
    expect(crossCheckLine(list, 'anthropic', official('claude-sonnet-4-5-20250929', '3', '15')).verdict).toBe('not_listed');
  });
});
