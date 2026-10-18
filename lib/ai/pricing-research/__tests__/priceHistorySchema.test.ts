/**
 * The price history query and response schemas (AI model price review slice 9).
 *
 * T-0 (SA SC9-9): every (provider, model_name) pair stored in production on
 * 2026-10-18 (read-only query run by TL) must pass the query schema, so every
 * stored row can be asked for. A pair failing here is a stop rule: report to
 * SA, never loosen the schema.
 */

import {
  PriceHistoryDataSchema,
  PriceHistoryQuerySchema,
  PriceHistoryResponseSchema,
  isHistoryQueryable,
} from '../priceHistorySchema';

/** Production pairs, 2026-10-18 (43 active and 12 retired rows; 46 distinct pairs). */
const PROD_PAIRS = [
  'anthropic/claude-3-5-haiku-20241022',
  'anthropic/claude-3-5-sonnet-20241022',
  'anthropic/claude-3-haiku',
  'anthropic/claude-3-haiku-20240307',
  'anthropic/claude-3-opus',
  'anthropic/claude-3-opus-20240229',
  'anthropic/claude-3-sonnet',
  'anthropic/claude-3-sonnet-20240229',
  'anthropic/claude-haiku-4-5-20251001',
  'anthropic/claude-opus-4-1-20250805',
  'anthropic/claude-opus-4-20250514',
  'anthropic/claude-opus-4-5-20251101',
  'anthropic/claude-opus-4-6',
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-sonnet-4-5-20250929',
  'anthropic/claude-sonnet-4-6',
  'google/gemini-1.0-pro',
  'google/gemini-1.5-flash',
  'google/gemini-1.5-pro',
  'kimi/kimi-k2-0711-preview',
  'kimi/kimi-k2-0905-preview',
  'kimi/kimi-k2-thinking',
  'kimi/kimi-k2-thinking-turbo',
  'kimi/kimi-k2-turbo-preview',
  'kimi/kimi-k2.5',
  'openai/gpt-3.5-turbo',
  'openai/gpt-4',
  'openai/gpt-4-turbo',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'openai/gpt-5.1',
  'openai/gpt-5.2',
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano',
  'openai/gpt-5.4-pro',
  'openai/o3',
  'openai/o3-pro',
  'openai/o4-mini',
  'openai/text-embedding-3-small',
];

describe('T-0 (SC9-9): every stored production pair passes the query schema', () => {
  it('the list is the 46 pairs TL read', () => {
    expect(new Set(PROD_PAIRS).size).toBe(46);
  });

  it.each(PROD_PAIRS)('%s', (pair) => {
    const [provider, model] = pair.split('/');
    expect(PriceHistoryQuerySchema.safeParse({ kind: 'token', provider, model }).success).toBe(true);
    expect(isHistoryQueryable('token', provider, model)).toBe(true);
  });
});

describe('PriceHistoryQuerySchema', () => {
  it.each([
    ['a missing kind', { provider: 'openai', model: 'gpt-4o' }],
    ['an unknown kind', { kind: 'video', provider: 'openai', model: 'gpt-4o' }],
    ['a provider outside the list', { kind: 'token', provider: 'groq', model: 'llama' }],
    ['a model failing the id rule', { kind: 'token', provider: 'openai', model: 'GPT 4o' }],
    ['a model with a percent sign', { kind: 'token', provider: 'openai', model: 'gpt%' }],
    ['an over-long model', { kind: 'token', provider: 'openai', model: 'a'.repeat(101) }],
    ['an unknown key', { kind: 'token', provider: 'openai', model: 'gpt-4o', admin: 'x' }],
  ])('refuses %s', (_label, query) => {
    expect(PriceHistoryQuerySchema.safeParse(query).success).toBe(false);
  });

  it('the client gate refuses a row with no provider or a name the route would refuse (SC9-8)', () => {
    expect(isHistoryQueryable('image', null, 'gpt-image-1')).toBe(false);
    expect(isHistoryQueryable('token', 'openai', 'Bad Name')).toBe(false);
    expect(isHistoryQueryable('token', 'groq', 'llama')).toBe(false);
    expect(isHistoryQueryable('image', 'openai', 'gpt-image-1')).toBe(true);
  });
});

describe('PriceHistoryResponseSchema', () => {
  const row = {
    rowId: 'row-1',
    status: 'current',
    prices: { kind: 'token', inputPer1m: '0.15', outputPer1m: '0.6', cachedInputPer1m: null, cachedNote: 'half_of_input', storedAsZero: false },
    effectiveDate: '2026-10-11',
    replacedOn: null,
    neverCharged: false,
    retiredOn: null,
    createdAt: '2026-10-11T10:00:00Z',
    provenance: { kind: 'none' },
    retirement: null,
    preReviewNote: true,
    syncRuns: [],
    moreSyncRuns: 0,
  };
  const data = {
    generatedAt: '2026-10-18T10:00:00.000Z',
    kind: 'token',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    truncated: false,
    auditTruncated: false,
    syncTruncated: false,
    units: [{ size: null, quality: null, rows: [row] }],
  };

  it('round-trips a valid body', () => {
    expect(PriceHistoryResponseSchema.parse({ success: true, data })).toEqual({ success: true, data });
  });

  it('refuses a price sent as a number', () => {
    const bad = { ...data, units: [{ size: null, quality: null, rows: [{ ...row, prices: { ...row.prices, inputPer1m: 0.15 } }] }] };
    expect(PriceHistoryDataSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses an actor carrying an id (strict objects)', () => {
    const provenance = {
      kind: 'audit',
      events: [
        {
          action: 'created',
          by: { kind: 'admin', email: 'a@example.com', userId: '11111111-1111-4111-8111-111111111111' },
          at: '2026-09-01T00:00:00Z',
          inputPer1m: null,
          outputPer1m: null,
          beforeInputPer1m: null,
          beforeOutputPer1m: null,
        },
      ],
    };
    const bad = { ...data, units: [{ size: null, quality: null, rows: [{ ...row, provenance }] }] };
    expect(PriceHistoryDataSchema.safeParse(bad).success).toBe(false);
  });
});
