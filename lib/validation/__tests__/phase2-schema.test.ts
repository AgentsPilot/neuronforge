/**
 * Unit tests for the Phase 2 single-question response schema.
 *
 * The contract carries ONE STRUCTURED question object per turn (v15
 * `ClarificationQuestion` shape, restricted to type select/multi_select/text),
 * NOT a plain string. Coverage:
 *   - valid structured shapes (select / multi_select / text) + terminal
 *   - `.refine()` #1: phase2_done=true requires question=null (no bundling)
 *   - `.refine()` #2: select/multi_select require a non-empty options[]
 *   - type restricted to select/multi_select/text (no email/number/etc.)
 *   - `.strict()` on the OUTER object: extra top-level keys rejected (the
 *     route-injected `success`/`phase` and the legacy `questionsSequence[]`)
 *   - inner object strips unknown keys (lenient on extra v15 fields)
 */

import {
  Phase2ResponseSchema,
  validatePhase2Response,
} from '@/lib/validation/phase2-schema';

const selectQuestion = {
  id: 'q1',
  question: 'Where is the expense data stored?',
  type: 'select' as const,
  options: [
    { value: 'google_sheet', label: 'A Google Sheet' },
    { value: 'excel_drive', label: 'An Excel file in Drive' },
  ],
  allowCustom: true,
  theme: 'Inputs',
};

const textQuestion = {
  id: 'q2',
  question: 'Which email address should the summary go to?',
  type: 'text' as const,
};

describe('Phase2ResponseSchema', () => {
  describe('valid structured shapes', () => {
    it('accepts a select question with options', () => {
      const payload = { question: selectQuestion, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a multi_select question with options', () => {
      const payload = {
        question: { ...selectQuestion, type: 'multi_select' },
        phase2_done: false,
      };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a text question with no options', () => {
      const payload = { question: textQuestion, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a terminal payload (question=null, phase2_done=true)', () => {
      const payload = { question: null, phase2_done: true };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });

    it('strips unknown inner-question keys (lenient on extra v15 fields)', () => {
      const payload = {
        question: { ...textQuestion, required: true, placeholder: 'e.g. me@co.com', dimension: 'delivery' },
        phase2_done: false,
      };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success && result.data.question) {
        expect('required' in result.data.question).toBe(false);
        expect('placeholder' in result.data.question).toBe(false);
      }
    });
  });

  describe('refine #1: phase2_done=true requires question=null', () => {
    it('rejects phase2_done=true bundled with a non-null question', () => {
      const payload = { question: selectQuestion, phase2_done: true };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.errors.map((e) => e.message);
        expect(messages.some((m) => m.includes('phase2_done=true'))).toBe(true);
      }
    });

    it('accepts phase2_done=false with question=null (schema-permissive)', () => {
      const payload = { question: null, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });
  });

  describe('refine #2: select/multi_select require non-empty options[]', () => {
    it('rejects a select question with no options', () => {
      const { options, ...noOptions } = selectQuestion;
      const payload = { question: noOptions, phase2_done: false };
      const result = Phase2ResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.errors.map((e) => e.message);
        expect(messages.some((m) => m.includes('options'))).toBe(true);
      }
    });

    it('rejects a multi_select question with an empty options array', () => {
      const payload = {
        question: { ...selectQuestion, type: 'multi_select', options: [] },
        phase2_done: false,
      };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('accepts a text question without options', () => {
      const payload = { question: textQuestion, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(true);
    });
  });

  describe('type restricted to select/multi_select/text', () => {
    it('rejects type=email', () => {
      const payload = {
        question: { ...textQuestion, type: 'email' },
        phase2_done: false,
      };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects type=number', () => {
      const payload = {
        question: { ...textQuestion, type: 'number' },
        phase2_done: false,
      };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe('strict: extra TOP-LEVEL keys are rejected', () => {
    it('rejects the route-injected `success` key (the R3 regression class)', () => {
      const payload = { question: textQuestion, phase2_done: false, success: true };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects the route-injected `phase` key', () => {
      const payload = { question: textQuestion, phase2_done: false, phase: 2 };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects the legacy `questionsSequence[]` batch shape', () => {
      const payload = { question: textQuestion, phase2_done: false, questionsSequence: [] };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe('type-mismatch rejection', () => {
    it('rejects a non-boolean phase2_done', () => {
      const payload = { question: textQuestion, phase2_done: 'false' };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects a plain-string question (the old contract — now invalid)', () => {
      const payload = { question: 'Where is the data stored?', phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects a question object missing id', () => {
      const { id, ...noId } = textQuestion;
      const payload = { question: noId, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects an empty-string question text', () => {
      const payload = { question: { ...textQuestion, question: '' }, phase2_done: false };
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects a missing phase2_done', () => {
      const payload = { question: textQuestion } as unknown;
      expect(Phase2ResponseSchema.safeParse(payload).success).toBe(false);
    });
  });
});

describe('validatePhase2Response', () => {
  it('returns { success: true, data } on valid structured input', () => {
    const result = validatePhase2Response({ question: textQuestion, phase2_done: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question?.id).toBe('q2');
      expect(result.data.question?.type).toBe('text');
      expect(result.data.phase2_done).toBe(false);
    }
  });

  it('returns { success: false, errors[] } on invalid input', () => {
    const result = validatePhase2Response({ question: selectQuestion, phase2_done: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('phase2_done=true'))).toBe(true);
    }
  });

  it('flags the route-mutation pattern (success+phase injected)', () => {
    // This is the exact shape that broke the first attempt — the route passing
    // the post-mutation payload (with success + phase) directly to validation.
    // The fix is to snapshot BEFORE the mutation; this test guards against
    // accidentally relaxing the OUTER schema to .passthrough().
    const postMutationPayload = {
      question: textQuestion,
      phase2_done: false,
      success: true,
      phase: 2,
    };
    expect(validatePhase2Response(postMutationPayload).success).toBe(false);
  });
});
