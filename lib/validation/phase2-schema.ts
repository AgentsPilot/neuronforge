/**
 * Phase 2 single-question response schema.
 *
 * Validates the LLM's Phase 2 response contract: each Phase 2 LLM call must
 * return ONE of:
 *   - mid-loop:  { "question": "<text>", "phase2_done": false }
 *   - terminal:  { "question": null, "phase2_done": true }
 *
 * `.strict()` rejects any extra keys (including the legacy `questionsSequence[]`
 * batch shape and any server-side injected fields like `success` or `phase` —
 * the route MUST snapshot the parsed payload BEFORE the success/phase mutation
 * before calling `validatePhase2Response()`).
 *
 * `.refine()` enforces the invariant that `phase2_done=true` MUST come with
 * `question=null` (no bundling).
 *
 * Symbol names intentionally carry no version number — version numbers belong
 * to the prompt template file, not to TypeScript symbols.
 */

import { z } from 'zod';

// ===== SCHEMA =====

export const Phase2ResponseSchema = z
  .object({
    /**
     * The single question to ask the user on this turn. `null` only when
     * `phase2_done` is `true`.
     */
    question: z.string().min(1).nullable(),

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
