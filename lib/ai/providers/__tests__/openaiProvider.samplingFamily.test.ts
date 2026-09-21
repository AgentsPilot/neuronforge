/**
 * T1-7 (Layer 2 Step 1, provider half) — the two model-family tests.
 *
 * `usesMaxCompletionTokens` moved from a private method to a module function
 * so the Business OS Layer 2 guardrail can ask the same question the request
 * builder asks. This proves the move is behaviour-free (the private method
 * delegates), and pins the second family — the models that reject sampling
 * parameters — which is a different, overlapping list.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §5.1 (RC-W5)
 */

import { OpenAIProvider, rejectsSamplingParameters, usesMaxCompletionTokens } from '../openaiProvider';

/** Every family the two tests are claimed to cover, plus the ordinary models. */
const MODELS = [
  'gpt-5',
  'gpt-5.4-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'o1',
  'o1-preview',
  'o3',
  'o3-pro',
  'o4-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-image-1',
  'text-embedding-3-small',
];

describe('usesMaxCompletionTokens (module scope)', () => {
  it('answers exactly what the private method answers, for every family', () => {
    const provider = new OpenAIProvider('sk-test-not-used');
    // The private method is the one the request builder calls; reaching it
    // directly is the only way to prove the delegation changed nothing.
    const privateMethod = (provider as unknown as { usesMaxCompletionTokens(model: string): boolean })
      .usesMaxCompletionTokens.bind(provider);

    for (const model of MODELS) {
      expect({ model, value: privateMethod(model) }).toEqual({ model, value: usesMaxCompletionTokens(model) });
    }
  });

  it('keeps the list it had before the move', () => {
    expect(MODELS.filter(usesMaxCompletionTokens)).toEqual([
      'gpt-5',
      'gpt-5.4-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'o3',
      'o3-pro',
      'o4-mini',
    ]);
  });
});

describe('rejectsSamplingParameters', () => {
  it('names the reasoning families, and not gpt-4.1 (Q-4)', () => {
    expect(MODELS.filter(rejectsSamplingParameters)).toEqual([
      'gpt-5',
      'gpt-5.4-mini',
      'gpt-5-nano',
      'o1',
      'o1-preview',
      'o3',
      'o3-pro',
      'o4-mini',
    ]);
  });

  it('leaves every model Business OS uses today alone', () => {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-image-1']) {
      expect(rejectsSamplingParameters(model)).toBe(false);
    }
  });

  it('marks o1 as a reasoning model that is NOT on the max_completion_tokens list (RC-W5)', () => {
    // This is the gap the Layer 2 token guardrail closes: such a model would be
    // sent `max_tokens` and fail with a 400 that the FR-11 retry never sees.
    expect(rejectsSamplingParameters('o1')).toBe(true);
    expect(usesMaxCompletionTokens('o1')).toBe(false);
  });
});
