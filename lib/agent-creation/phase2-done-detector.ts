/**
 * Phase 2 "I want to stop" keyword detector.
 *
 * Deterministic keyword-based check (no LLM). The Phase 2 loop in
 * `app/api/agent-creation/process-message/route.ts` calls `isDoneIntent()` on
 * every incoming `phase2_user_answer` BEFORE making the LLM call. A match
 * short-circuits the loop with `termination_reason: 'phase2_done'` and skips
 * the LLM call for that turn.
 *
 * Design choices (see SA Comment 7 in the workplan):
 *
 *   - We use multi-word phrases ("build it", "that's enough", etc.) so that
 *     substring matching is safe. The single word `'done'` was deliberately
 *     excluded — substring matching on `'done'` would false-positive on
 *     substantive answers like "let me know once it's done processing each
 *     batch".
 *   - A false NEGATIVE (user types just "done", gets the next question) is a
 *     minor UX inconvenience — the user can also type "build it" or
 *     "that's enough".
 *   - A false POSITIVE (substantive mid-sentence "done" prematurely terminates
 *     Phase 2) is much more harmful — it could skip mandatory clarification
 *     and damage the resulting agent.
 *
 * The detector is intentionally simple: case-insensitive substring match
 * against a fixed phrase list. Empty / whitespace-only input returns `false`
 * (the UI already prevents submitting an empty message via the disabled send
 * button in `ChatInput.tsx`).
 */

/**
 * The fixed list of "I want to stop" phrases. Keep this list small and
 * conservative — every entry needs to be a phrase a user would not naturally
 * include inside a substantive answer.
 */
export const DONE_KEYWORDS: readonly string[] = [
  'build it',
  'lets build',
  "let's build",
  'ship it',
  'proceed',
  'go ahead',
  'move forward',
  "that's enough",
  'that is enough',
  "i'm ready",
  'im ready',
];

/**
 * Returns `true` when `text` matches the "I want to stop" intent via
 * case-insensitive substring match against `DONE_KEYWORDS`.
 *
 * Returns `false` for empty / whitespace-only / null / undefined input.
 */
export function isDoneIntent(text: string | null | undefined): boolean {
  const normalized = (text ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return DONE_KEYWORDS.some((kw) => normalized.includes(kw));
}
