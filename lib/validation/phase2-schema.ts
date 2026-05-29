/**
 * Phase 2 single-question response schema.
 *
 * Validates the LLM's Phase 2 response contract. Each Phase 2 LLM call must
 * return ONE of:
 *   - mid-loop:  { "question": <structured question object>, "phase2_done": false }
 *   - terminal:  { "question": null,                          "phase2_done": true  }
 *
 * `question` is a STRUCTURED question object — the same shape v15 uses for each
 * `questionsSequence[]` item, but ONE per turn — so the UI can render `select` /
 * `multi_select` as clickable option buttons and `text` as a free-text answer.
 * (An earlier version of this contract used a plain `string`, which made the LLM
 * emit "pick a number 1/2/3" prose questions — a regression from v15. Fixed
 * 2026-05-28.) Question `type` is restricted to exactly `select`, `multi_select`,
 * `text` — the three the V2 page's option-button UI supports.
 *
 * The OUTER object is `.strict()` — it rejects extra top-level keys (the legacy
 * `questionsSequence[]` batch array, and the server-injected `success`/`phase`
 * fields — the route MUST snapshot the parsed payload BEFORE the success/phase
 * mutation before calling `validatePhase2Response()`). The INNER question object
 * is non-strict on purpose: it strips any extra v15 fields the LLM might include
 * (e.g. `required`, `placeholder`, `dimension`) rather than failing.
 *
 * `.refine()` enforces:
 *   1. `phase2_done=true` MUST come with `question=null` (no bundling).
 *   2. `select` / `multi_select` questions MUST carry a non-empty `options[]`.
 *
 * Symbol names intentionally carry no version number — version numbers belong
 * to the prompt template file, not to TypeScript symbols.
 */

import { z } from 'zod';

// ===== STRUCTURED QUESTION =====

export const Phase2QuestionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

/**
 * One structured question (v15 `ClarificationQuestion` shape, restricted to the
 * three UI-supported types). Non-strict: unknown keys are stripped, not rejected.
 */
export const Phase2QuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  type: z.enum(['select', 'multi_select', 'text']),
  options: z.array(Phase2QuestionOptionSchema).optional(),
  allowCustom: z.boolean().optional(),
  theme: z.string().optional(),
});

export type Phase2QuestionOption = z.infer<typeof Phase2QuestionOptionSchema>;
export type Phase2Question = z.infer<typeof Phase2QuestionSchema>;

// ===== RESPONSE =====

export const Phase2ResponseSchema = z
  .object({
    /**
     * The single structured question to ask on this turn. `null` ONLY when
     * `phase2_done` is `true`.
     */
    question: Phase2QuestionSchema.nullable(),

    /**
     * `true` when no further clarification is needed and the flow should
     * advance to Phase 3.
     */
    phase2_done: z.boolean(),
  })
  .strict()
  .refine(
    (d) => !(d.phase2_done === true && d.question !== null),
    {
      message: 'phase2_done=true must come with question=null',
      path: ['question'],
    }
  )
  .refine(
    (d) => {
      if (
        d.question &&
        (d.question.type === 'select' || d.question.type === 'multi_select')
      ) {
        return Array.isArray(d.question.options) && d.question.options.length > 0;
      }
      return true;
    },
    {
      message:
        'select/multi_select questions must include a non-empty options array',
      path: ['question', 'options'],
    }
  );

export type Phase2Response = z.infer<typeof Phase2ResponseSchema>;

// ===== VALIDATION HELPER =====

export type Phase2ValidationResult =
  | { success: true; data: Phase2Response }
  | { success: false; errors: string[] };

/**
 * Validate an LLM Phase 2 response.
 *
 * IMPORTANT: pass the RAW parsed LLM JSON. The Phase 2 route in
 * `app/api/agent-creation/process-message/route.ts` mutates the parsed payload
 * with `aiResponse.success = true; aiResponse.phase = phase;` shortly after
 * parsing. The route MUST snapshot the parsed payload BEFORE that mutation and
 * pass the snapshot here — otherwise `.strict()` will reject the injected keys
 * and the validation will fail on every call.
 */
export function validatePhase2Response(data: unknown): Phase2ValidationResult {
  const result = Phase2ResponseSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map((err) => {
    const path = err.path.length > 0 ? err.path.join('.') : '<root>';
    return `${path}: ${err.message}`;
  });

  return { success: false, errors };
}
