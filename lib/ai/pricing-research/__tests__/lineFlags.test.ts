/**
 * Server-computed refusals and flags (SA R-4 extended by RR-1).
 */

import { duplicateUnitKeys, evaluatePendingLine, FLAG_LABELS, NEW_MODEL_LABEL, type LineFlagContext } from '../lineFlags';
import type { PendingLineInput } from '../pendingLineSchema';

const token = (overrides: Partial<Extract<PendingLineInput, { kind: 'token' }>> = {}): PendingLineInput => ({
  kind: 'token',
  provider: 'openai',
  model_name: 'example-model',
  input_per_1m: '0.15',
  output_per_1m: '0.6',
  source_url: 'https://developers.openai.com/api/docs/pricing',
  checked_on: '2026-10-14',
  ...overrides,
});

const image = (price: string): PendingLineInput => ({
  kind: 'image',
  provider: 'openai',
  model_name: 'example-image-model',
  image_size: '1024x1024',
  image_quality: 'high',
  price_per_image: price,
  source_url: 'https://developers.openai.com/api/docs/pricing',
  checked_on: '2026-10-14',
});

const context = (overrides: Partial<LineFlagContext> = {}): LineFlagContext => ({
  current: { input: '0.00000015', output: '0.0000006', cachedInput: '0.000000075' },
  fallback: { input: '0.00000015', output: '0.0000006' },
  conservative: { input: '0.00003', output: '0.00018' },
  inCoverage: true,
  inputOnly: false,
  ...overrides,
});

describe('hard refusals (nothing stored)', () => {
  it('a zero input, cached input or image price is refused', () => {
    expect(evaluatePendingLine(token({ input_per_1m: '0' }), context()).refusals).toEqual(['The input price must be above 0']);
    expect(evaluatePendingLine(token({ cached_input_per_1m: '0.000' }), context()).refusals).toHaveLength(1);
    expect(evaluatePendingLine(image('0'), context()).refusals).toEqual(['The image price must be above 0']);
  });

  it('a zero output is refused unless the model is input-only (embeddings)', () => {
    expect(evaluatePendingLine(token({ output_per_1m: '0' }), context()).refusals).toEqual(['The output price must be above 0']);
    expect(evaluatePendingLine(token({ output_per_1m: '0' }), context({ inputOnly: true })).refusals).toEqual([]);
  });

  it('a price above the sanity ceiling is refused; at the ceiling it is not', () => {
    expect(evaluatePendingLine(token({ output_per_1m: '1000.000000001' }), context()).refusals).toHaveLength(1);
    expect(evaluatePendingLine(token({ output_per_1m: '1000' }), context({ current: {} })).refusals).toEqual([]);
    expect(evaluatePendingLine(image('5.01'), context()).refusals).toHaveLength(1);
    expect(evaluatePendingLine(image('5'), context()).refusals).toEqual([]);
  });

  it('a refused line carries no flags', () => {
    expect(evaluatePendingLine(token({ input_per_1m: '0' }), context({ inCoverage: false })).flags).toEqual([]);
  });
});

describe('flags', () => {
  it('no flag on an unchanged price for a covered model', () => {
    expect(evaluatePendingLine(token(), context())).toEqual({ refusals: [], flags: [] });
  });

  it('new_model when the model is outside the coverage set (user decision: allowed, "not used yet")', () => {
    expect(evaluatePendingLine(token(), context({ inCoverage: false })).flags).toEqual(['new_model']);
  });

  it('the new_model flag is labelled with the wording the user chose', () => {
    expect(NEW_MODEL_LABEL).toBe('not used yet');
    expect(FLAG_LABELS.new_model).toBe(NEW_MODEL_LABEL);
  });

  it('large_move above 50% either way, exactly at the boundary', () => {
    expect(evaluatePendingLine(token({ input_per_1m: '0.225' }), context()).flags).toEqual(['fallback_differs']);
    expect(evaluatePendingLine(token({ input_per_1m: '0.225000001' }), context()).flags).toContain('large_move');
    expect(evaluatePendingLine(token({ output_per_1m: '0.299999999' }), context()).flags).toContain('large_move');
  });

  it('no large_move when nothing is charged today', () => {
    expect(evaluatePendingLine(token({ input_per_1m: '9' }), context({ current: {} })).flags).not.toContain('large_move');
  });

  it('above_conservative_rate when a price exceeds the FR-12 rate', () => {
    expect(evaluatePendingLine(token({ output_per_1m: '181' }), context({ current: {} })).flags).toContain('above_conservative_rate');
    expect(evaluatePendingLine(token({ output_per_1m: '180' }), context({ current: {} })).flags).not.toContain('above_conservative_rate');
  });

  it('fallback_differs only when an in-code price exists and differs', () => {
    expect(evaluatePendingLine(token({ input_per_1m: '0.2' }), context()).flags).toContain('fallback_differs');
    expect(evaluatePendingLine(token({ input_per_1m: '0.2' }), context({ fallback: {} })).flags).not.toContain('fallback_differs');
  });

  it('cached_input_listed when a cached-input price is given', () => {
    expect(evaluatePendingLine(token({ cached_input_per_1m: '0.075' }), context()).flags).toEqual(['cached_input_listed']);
  });

  it('image lines compare per image', () => {
    const imageContext = context({ current: { perImage: '0.167' }, fallback: { perImage: '0.167' }, conservative: { perImage: '0.25' } });
    expect(evaluatePendingLine(image('0.167'), imageContext).flags).toEqual([]);
    expect(evaluatePendingLine(image('0.3'), imageContext).flags).toEqual(['large_move', 'above_conservative_rate', 'fallback_differs']);
  });
});

describe('duplicateUnitKeys', () => {
  it('names every repeated key once', () => {
    expect(duplicateUnitKeys(['a', 'b', 'a', 'a', 'c', 'b'])).toEqual(['a', 'b']);
    expect(duplicateUnitKeys(['a', 'b'])).toEqual([]);
  });
});
