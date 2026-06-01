/**
 * Tests for the Phase 3 normalizer's resolved_user_inputs handling (F3, 2026-05-30).
 *
 * The normalizer runs INSIDE validatePhase3Response BEFORE Zod sees the payload.
 * Pre-F3 it only handled `value: Array` (joined to comma-separated); other LLM
 * quirks (null / boolean / non-array object) fell through to a Zod union failure
 * that triggered the misaimed Phase-2-entrenchment retry. These tests lock the
 * post-F3 normalization so a future regression here is caught.
 *
 * NOTE: we build only the minimal-valid Phase 3 wrapper around the
 * `resolved_user_inputs` array under test — the rest of the payload is filler
 * just to satisfy the outer schema.
 */

import { validatePhase3Response } from '@/lib/validation/phase3-schema';

const validAnalysisDim = { status: 'clear' as const, confidence: 1, detected: 'x' };

function makePhase3WithResolved(resolved: unknown[]) {
  return {
    analysis: {
      data: validAnalysisDim,
      output: validAnalysisDim,
      actions: validAnalysisDim,
      delivery: validAnalysisDim,
    },
    requiredServices: ['google-mail'],
    missingPlugins: [],
    pluginWarning: {},
    clarityScore: 100,
    enhanced_prompt: {
      plan_title: 'A title',
      plan_description: 'A description',
      sections: {
        data: ['d1'],
        actions: ['a1'],
        output: ['o1'],
        delivery: ['de1'],
      },
      specifics: {
        services_involved: ['google-mail'],
        user_inputs_required: [],
        resolved_user_inputs: resolved,
      },
    },
    metadata: {
      all_clarifications_applied: true,
      ready_for_generation: true,
      confirmation_needed: false,
      implicit_services_detected: [],
      provenance_checked: true,
    },
    conversationalSummary: 'OK',
  };
}

describe('Phase 3 normalizer — resolved_user_inputs (F3)', () => {
  it('keeps string and number values as-is (numbers coerced to strings by Zod)', () => {
    const payload = makePhase3WithResolved([
      { key: 'user_email', value: 'me@example.com' },
      { key: 'count', value: 42 },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      expect(inputs[0]).toEqual({ key: 'user_email', value: 'me@example.com' });
      expect(inputs[1]).toEqual({ key: 'count', value: '42' });
    }
  });

  it('joins array values with comma-space (existing pre-F3 behavior preserved)', () => {
    const payload = makePhase3WithResolved([
      { key: 'tags', value: ['urgent', 'finance'] },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      expect(inputs[0]).toEqual({ key: 'tags', value: 'urgent, finance' });
    }
  });

  it('drops rows where value is null (F3 layer 1)', () => {
    const payload = makePhase3WithResolved([
      { key: 'kept', value: 'good' },
      { key: 'dropped', value: null },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toEqual({ key: 'kept', value: 'good' });
    }
  });

  it('drops rows where value is undefined (F3 layer 1)', () => {
    const payload = makePhase3WithResolved([
      { key: 'kept', value: 'good' },
      { key: 'dropped' }, // no value at all
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toEqual({ key: 'kept', value: 'good' });
    }
  });

  it('coerces boolean value to the literal string (F3 layer 1)', () => {
    const payload = makePhase3WithResolved([
      { key: 'include_images', value: true },
      { key: 'include_attachments', value: false },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      expect(inputs[0]).toEqual({ key: 'include_images', value: 'true' });
      expect(inputs[1]).toEqual({ key: 'include_attachments', value: 'false' });
    }
  });

  it('JSON-stringifies a non-array, non-null object value (F3 layer 1)', () => {
    const payload = makePhase3WithResolved([
      { key: 'date_range', value: { from: '2026-01-01', to: '2026-01-31' } },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      expect(inputs[0]).toEqual({
        key: 'date_range',
        value: '{"from":"2026-01-01","to":"2026-01-31"}',
      });
    }
  });

  it('handles a mixed-quirk array in a single call (string + array + null + boolean + object)', () => {
    const payload = makePhase3WithResolved([
      { key: 'email', value: 'me@x.com' },
      { key: 'tags', value: ['a', 'b'] },
      { key: 'maybe', value: null },
      { key: 'flag', value: true },
      { key: 'range', value: { from: 'x', to: 'y' } },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const inputs = result.data.enhanced_prompt.specifics.resolved_user_inputs!;
      // `maybe` dropped → 4 rows
      expect(inputs).toHaveLength(4);
      expect(inputs.map((i: any) => i.key)).toEqual(['email', 'tags', 'flag', 'range']);
      expect(inputs.find((i: any) => i.key === 'tags')!.value).toBe('a, b');
      expect(inputs.find((i: any) => i.key === 'flag')!.value).toBe('true');
      expect(inputs.find((i: any) => i.key === 'range')!.value).toBe('{"from":"x","to":"y"}');
    }
  });

  it('still fails Zod for genuinely invalid rows (e.g. empty key)', () => {
    const payload = makePhase3WithResolved([
      { key: '', value: 'something' },
    ]);
    const result = validatePhase3Response(payload);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes('key'))).toBe(true);
  });
});
