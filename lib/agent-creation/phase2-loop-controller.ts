/**
 * Phase 2 loop controller — pure state machine.
 *
 * The controller has NO side effects: no `Date.now()`, no logging, no DB
 * writes, no thread-metadata I/O. The caller (the Phase 2 branch of
 * `app/api/agent-creation/process-message/route.ts`) is responsible for:
 *
 *   - persisting `next_state` into thread metadata (one write per turn,
 *     piggy-backed on the existing single `updateThreadPhase()` call)
 *   - emitting the Pino termination log when `decision.terminate === true`
 *
 * Termination reasons (string-literal union, NOT `string`):
 *   - `'phase2_done'` — LLM emitted `phase2_done: true`, OR the user typed
 *     a "done" keyword (server-side short-circuit handled by the route).
 *   - `'cap_hit'`    — defensive iteration cap fired. Soft disclosure banner
 *     surfaced to the user. The cap is NEVER mentioned in the prompt or in
 *     user-facing copy except via this banner.
 *
 * The defensive cap is `MAX_ITERATIONS = 10`. The cap is purely server-side
 * — the LLM is never told about it. The FR5.12 bound is "up to 10 questions
 * (≤ 10 LLM round-trips) per session". That bound is enforced PRE-CALL by the
 * route: once `MAX_ITERATIONS` questions have been asked it terminates as
 * `cap_hit` BEFORE making another completion (worst case = 10 questions / 10
 * round-trips, then the 11th turn caps without a call). `step()`'s own cap below
 * — terminate when `iteration_count >= MAX_ITERATIONS` — uses the SAME condition
 * and is the BACKSTOP: it only fires if some path reaches `step()` without the
 * route's pre-call guard, and is what the controller unit tests exercise in
 * isolation.
 *
 * Decision shapes (returned by `step()`):
 *   - `{ decision: 'continue', next_state, response }` — emit the LLM's
 *     question to the UI; await the next user turn.
 *   - `{ decision: 'terminate', next_state, response, termination_reason }` —
 *     emit terminal payload, transition to Phase 3.
 *   - `{ decision: 'pass_through_degraded', next_state, response }` — Zod
 *     validation failed on the LLM payload. The route passes through the
 *     parsed-but-invalid payload as-is (no fabricated server-side question)
 *     and lets the next turn retry. `iteration_count` still advances so the
 *     cap eventually fires if the LLM never recovers. (SA Comment 2.)
 */

/**
 * Maximum number of questions asked per Phase 2 session (inclusive) — i.e. up to
 * 10 LLM round-trips, then the next turn caps without a call. Defensive only.
 */
export const MAX_ITERATIONS = 10;

/**
 * The soft disclosure banner shown when the defensive cap fires.
 * SA Comment 3: locked as an exported constant so tests, route, and UI
 * all reference the same string — and so the FR8 grep-gate ("the string
 * '10' never appears in user-facing copy") can verify against a known
 * fixture.
 */

import type { Phase2Question } from '@/lib/validation/phase2-schema';

export const DISCLOSURE_BANNER =
  'Proceeding with what we have — you can refine after the agent is created.';

// NOTE (E3, 2026-05-29): the per-turn inline hint was moved OUT of this
// controller. Hints are now generated client-side from the
// `clarification_hints` category of `thinking-words-dictionary.json`
// (see app/v2/agents/new/page.tsx). The controller no longer carries an
// `INLINE_HINTS` array or an `inline_hint` response field. `DISCLOSURE_BANNER`
// (cap-hit only) stays server-driven.

export type TerminationReason = 'phase2_done' | 'cap_hit';

/**
 * Loop state persisted in `agent_prompt_threads.metadata.phase2_loop_state`.
 * Kept minimal — anything else can be reconstructed from the thread message
 * history.
 */
export interface Phase2LoopState {
  /** Number of LLM round-trips completed so far in this Phase 2 session. */
  iteration_count: number;
}

export const INITIAL_LOOP_STATE: Phase2LoopState = {
  iteration_count: 0,
};

/**
 * Input to `step()` on each turn.
 *
 * The route builds this from the parsed (and Zod-validated) LLM payload.
 * For the done-keyword short-circuit path, the route bypasses `step()` and
 * returns directly with `termination_reason: 'phase2_done'`.
 */
export interface Phase2StepInput {
  /** Loop state at the start of this turn (read from thread metadata). */
  state: Phase2LoopState;

  /**
   * `true` when the LLM payload passed Zod validation; `false` for
   * degraded passthrough.
   */
  payload_valid: boolean;

  /**
   * The LLM-emitted structured question object (v15 `ClarificationQuestion`
   * shape — see `Phase2Question`). May be `null` (terminal payload) or
   * `undefined` (degraded passthrough where the field was missing). On a
   * degraded turn it may also be a malformed value; the controller passes
   * whatever it received straight through and the UI handles it gracefully.
   */
  llm_question: Phase2Question | null | undefined;

  /**
   * The LLM-emitted `phase2_done` flag. May be `undefined` for degraded
   * passthrough where the field was missing.
   */
  llm_phase2_done: boolean | undefined;
}

/**
 * Response payload the route ships back to the UI for this turn.
 */
export interface Phase2StepResponse {
  question: Phase2Question | null;
  phase2_done: boolean;
  disclosure_banner?: string;
  termination_reason?: TerminationReason;
}

export type Phase2StepDecision =
  | { decision: 'continue'; next_state: Phase2LoopState; response: Phase2StepResponse }
  | {
      decision: 'terminate';
      next_state: Phase2LoopState;
      response: Phase2StepResponse;
      termination_reason: TerminationReason;
    }
  | {
      decision: 'pass_through_degraded';
      next_state: Phase2LoopState;
      response: Phase2StepResponse;
    };

/**
 * Pure state-machine transition. Returns `{ next_state, decision, response }`.
 *
 * Cap precedence: the cap check runs FIRST. If `iteration_count >=
 * MAX_ITERATIONS` (i.e. MAX_ITERATIONS questions already asked), the controller
 * terminates with `cap_hit` regardless of what the LLM said this turn. This is
 * the defensive guard — even if the LLM is misbehaving, the loop always
 * terminates.
 *
 * After cap, the controller branches on `payload_valid`:
 *   - valid + `llm_phase2_done === true`  → terminate as `phase2_done`
 *     (response has `question: null`, `phase2_done: true`).
 *   - valid + `llm_phase2_done === false` → continue (response has the
 *     LLM's question; the inter-question hint is added client-side, not here).
 *   - invalid                              → pass_through_degraded
 *     (response carries whatever the LLM emitted, even if missing /
 *     malformed — the UI handles missing fields gracefully and the next
 *     turn retries).
 */
export function step(input: Phase2StepInput): Phase2StepDecision {
  const nextIteration = input.state.iteration_count + 1;
  const next_state: Phase2LoopState = { iteration_count: nextIteration };

  // CAP CHECK — fires regardless of what the LLM said on this turn. We cap once
  // MAX_ITERATIONS questions have ALREADY been asked (`iteration_count` counts
  // questions asked so far), so the loop asks up to MAX_ITERATIONS (=10)
  // questions inclusive, then terminates on the next turn. Same condition the
  // route's pre-call guard uses, so the two stay consistent.
  if (input.state.iteration_count >= MAX_ITERATIONS) {
    return {
      decision: 'terminate',
      next_state,
      response: {
        question: null,
        phase2_done: true,
        disclosure_banner: DISCLOSURE_BANNER,
        termination_reason: 'cap_hit',
      },
      termination_reason: 'cap_hit',
    };
  }

  // DEGRADED PASSTHROUGH — Zod failed. Don't fabricate, just pass through
  // and let the next turn retry. iteration_count still advanced above, so
  // the cap will fire if the LLM never recovers.
  if (!input.payload_valid) {
    return {
      decision: 'pass_through_degraded',
      next_state,
      response: {
        // Degraded: pass through whatever structured question the LLM emitted
        // (or null). The UI's degraded handling renders a "please rephrase"
        // prompt when this isn't a usable structured question.
        question: input.llm_question ?? null,
        phase2_done:
          typeof input.llm_phase2_done === 'boolean'
            ? input.llm_phase2_done
            : false,
      },
    };
  }

  // VALID PAYLOAD — branch on phase2_done.
  if (input.llm_phase2_done === true) {
    return {
      decision: 'terminate',
      next_state,
      response: {
        question: null,
        phase2_done: true,
        termination_reason: 'phase2_done',
      },
      termination_reason: 'phase2_done',
    };
  }

  // Continue — emit the LLM's question. The inter-question hint is generated
  // client-side (E3), not here.
  return {
    decision: 'continue',
    next_state,
    response: {
      question: input.llm_question ?? null,
      phase2_done: false,
    },
  };
}
