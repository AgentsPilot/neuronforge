/**
 * Unit tests for the Phase 2 single-question response schema.
 *
 * Coverage:
 *   - valid mid-loop and terminal shapes
 *   - `.refine()`: phase2_done=true requires question=null (no bundling)
 *   - `.strict()`: extra keys rejected (including the route-injected
 *     `success` / `phase` keys and the legacy `questionsSequence[]` shape)
 *   - basic type-mismatch rejection
 */

import {
  Phase2ResponseSchema,
  validatePhase2Response,
} from '@/lib/validation/phase2-schema';

describe('Phase2ResponseSchema', () => {
  describe('valid shapes', () => {
    it('accepts a mid-loop question payload', () => {
      const payload = { question: 'Where is the data stored?', phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a terminal payload (question=null, phase2_done=true)', () => {
      const payload = { question: null, phase2_done: true };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });
  });

  describe('refine: phase2_done=true requires question=null', () => {
    it('rejects phase2_done=true bundled with a non-null question', () => {
      const payload = { question: 'Are we done?', phase2_done: true };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.errors.map((e) => e.message);
        expect(messages.some((m) => m.includes('phase2_done=true'))).toBe(true);
      }
    });

    it('accepts phase2_done=false with a non-null question (mid-loop)', () => {
      const payload = { question: 'Anything else?', phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });

    // Edge case: phase2_done=false with question=null is technically allowed
    // by the schema (the refine guard only catches the inverse) — the loop
    // controller / route owns the policy of what to do in that case. We just
    // verify the schema does not over-reject here.
    it('accepts phase2_done=false with question=null (schema-permissive)', () => {
      const payload = { question: null, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });
  });

  describe('strict: extra keys are rejected', () => {
    it('rejects the route-injected `success` key (the R3 regression class)', () => {
      const payload = {
        question: 'Hi?',
        phase2_done: false,
        success: true,
      };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects the route-injected `phase` key', () => {
      const payload = {
        question: 'Hi?',
        phase2_done: false,
        phase: 2,
      };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects the legacy `questionsSequence[]` batch shape', () => {
      const payload = {
        question: 'Hi?',
        phase2_done: false,
        questionsSequence: [],
      };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects an arbitrary additional key', () => {
      const payload = {
        question: 'Hi?',
        phase2_done: false,
        clarityScore: 87,
      };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('type-mismatch rejection', () => {
    it('rejects a non-boolean phase2_done', () => {
      const payload = { question: 'Hi?', phase2_done: 'false' };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects a non-string non-null question', () => {
      const payload = { question: 42, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects an empty-string question (schema requires min(1) or null)', () => {
      const payload = { question: '', phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects a missing phase2_done', () => {
      const payload = { question: 'Hi?' } as unknown;
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });
  });
});

describe('validatePhase2Response', () => {
  it('returns { success: true, data } on valid input', () => {
    const result = validatePhase2Response({ question: 'Hi?', phase2_done: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBe('Hi?');
      expect(result.data.phase2_done).toBe(false);
    }
  });

  it('returns { success: false, errors[] } on invalid input', () => {
    const result = validatePhase2Response({ question: 'q', phase2_done: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('phase2_done=true'))).toBe(true);
    }
  });

  it('flags the route-mutation pattern (success+phase injected)', () => {
    // This is the exact shape that broke R3 — the route was passing the
    // post-mutation payload (with success + phase) directly to validation.
    // The fix is to snapshot BEFORE the mutation; this test guards against
    // accidentally relaxing the schema to .passthrough() to "fix" the failure.
    const postMutationPayload = {
      question: 'Hi?',
      phase2_done: false,
      success: true,
      phase: 2,
    };
    const result = validatePhase2Response(postMutationPayload);
    expect(result.success).toBe(false);
  });
});
