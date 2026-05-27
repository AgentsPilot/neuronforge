# Requirement: V2 Agent Creation — Phase 2 Single-Question Mode for Non-Technical Users

> **Last Updated**: 2026-05-27

**Created by:** BA
**Date:** 2026-05-27
**Status:** Draft
**Builds on:** R1 (Phase 4 removal, prompt v15) — already on `main`.

---

## Overview

Phase 2 of the V2 agent creation flow asks **one question per turn** instead of a batch. The LLM is briefed that the user is **non-technical**. The question-selection logic (what to ask, what not to ask, phrasing, prioritization) carries over from the v15 prompt unchanged — the only prompt change is the interaction process plus an audience banner.

---

## Scope statement (read this first)

**This requirement does NOT change Phase 2 question-selection logic.** v15 already prescribes what to ask, what not to ask, phrasing rules, types of questions, and priority. All of that is preserved verbatim.

**This requirement ONLY changes:**
1. How the LLM emits the questions — one per turn instead of a batch.
2. A new top-of-prompt note that the user is non-technical.
3. The server-side infrastructure to run the iteration loop (schema, controller, UI per-turn round-trip).

If a proposed change touches Phase 2 question-selection rules, carve-outs, allowlists, enumeration rules, or failure-handling decision logic — **it is out of scope**.

---

## Table of Contents

1. [User Stories](#user-stories)
2. [Functional Requirements](#functional-requirements)
3. [Non-Functional Requirements](#non-functional-requirements)
4. [Acceptance Criteria](#acceptance-criteria)
5. [Out of Scope](#out-of-scope)
6. [Notes on Integration Points](#notes-on-integration-points)
7. [Process Guardrails](#process-guardrails)
8. [Change History](#change-history)

---

## User Stories

- As a **non-technical user**, I want Phase 2 to feel like a natural conversation — one question at a time, no jargon — rather than a form interrogation.
- As a **user who decides they're done early**, I want to say "build it" / "that's enough" and have the system move on.
- As an **operator**, I want one Pino log line per Phase 2 session capturing iteration count and termination reason — enough to verify behavior without building a dashboard.

---

## Functional Requirements

### FR1 — New Phase 2 prompt (minimal diff from v15)
1. Add `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`. The file starts as a **byte-for-byte copy of v15** and adds exactly two inserts (FR2 and the interaction-process block in FR3 below). No other content changes.
2. `init-thread` switches the hardcoded template name from v15 to v16 for the V2 agent creation flow.
3. v15 stays in the repo as the prior baseline (other callers may still reference it).
4. No feature flag gates which prompt is selected.

### FR2 — Non-technical audience note (audience banner)
5. Insert a top-of-prompt banner stating: the end-user is non-technical; prefer inference and sensible defaults; avoid jargon (API, OCR, parse, schema, etc.); ask about outcomes, not implementation.
6. **No** additional inline reminders inside v15's existing question-logic sections. The single banner at the top is the entire audience emphasis.

### FR3 — Single-question interaction process (interaction block)
7. Insert a single block in v16's Phase 2 section that instructs the LLM:
   - Emit at most ONE question per LLM call.
   - Pick the highest-priority next question per v15's existing rules.
   - When the question count is sufficient to produce a deterministic enhanced prompt, emit `phase2_done: true` with `question: null`.
   - Output strictly conforms to the response contract: `{ "question": string | null, "phase2_done": boolean }`.
8. This block replaces v15's batch-emission framing (e.g. `questionsSequence[]` output shape) in the Phase 2 section. The question-selection rules elsewhere in v15 (priority, what to ask, what NOT to ask, phrasing, "what" vs "when", etc.) are preserved verbatim.

### FR4 — Response contract validated server-side
9. Each Phase 2 LLM response MUST conform to:
    ```json
    { "question": "string | null", "phase2_done": boolean }
    ```
10. `phase2_done: true` MUST come with `question: null` (no bundling).
11. Zod-validated server-side with `.strict()` (rejects extra keys, including batch-shape leaks). Validation failures are logged as a Pino warn breadcrumb; the loop does NOT retry the LLM call. On Zod failure, the route returns the parsed payload as-is in degraded form (the controller still increments `iteration_count`); the cap will eventually fire if the LLM never recovers. The route MUST NOT fabricate a synthetic question server-side.

### FR5 — Defensive iteration cap (server-side only)
12. Iteration cap = **< 10 LLM round-trips** per Phase 2 session. Purely defensive (in case the LLM never emits `phase2_done`).
13. On cap reach, the server terminates the loop with `termination_reason: cap_hit` and surfaces a soft disclosure banner ("Proceeding with what we have — you can refine after the agent is created.") to the user before advancing to Phase 3.
14. The cap is **never** mentioned in the prompt, never exposed in user-facing copy, and never logged for the user to see.

### FR6 — Minimal mid-loop user-input handling
15. Every user message during the Phase 2 loop is checked server-side against a small keyword list to detect ONLY the "I want to stop" intent:
    - If the user's reply matches one of: `build it`, `that's enough`, `that is enough`, `ship it`, `let's build`, `lets build`, `i'm ready`, `im ready`, `proceed`, `go ahead`, `move forward` (case-insensitive substring match) → terminate the loop as `phase2_done` without making an LLM call.
    - Otherwise → forward the user's reply to the LLM as the answer to the current question. The LLM handles all other cases (substantive answers, "skip" or off-topic replies, ambiguous input, etc.) naturally as part of the conversation.
16. The detection is keyword-only (deterministic). No LLM-based classification. The single-word `'done'` is intentionally NOT in the keyword list — substring matching on `'done'` would false-positive on substantive answers like `"let me know once it's done processing each batch"`. The multi-word phrases above cover the user-intent space safely.
17. **Empty / whitespace-only input is prevented at the UI level** — the chat send button is already disabled when the input box is empty or contains only whitespace (existing guard at `components/agent-creation/conversational/components/ChatInput.tsx:54`). The server never sees an empty Phase 2 user message and does not need to handle that case.

### FR7 — UX presentation
18. Each iteration renders as a single chat bubble in the V2 conversational UI.
19. Each assistant message MAY include a soft inline hint (e.g., "A few more details to refine your agent") — phrased to avoid exposing the hard cap. Hints are server-controlled (controller-cycled from a fixed list).
20. No progress bar / numeric counter shown to the user. The hard cap is NEVER exposed in user-facing copy.
21. The chat send button is `disabled` when the input box is empty or whitespace-only (see FR6.17).

### FR8 — Telemetry
22. Exactly **one structured Pino log line at loop exit**:
    - `iteration_count` (integer)
    - `termination_reason` (enum: `phase2_done` | `cap_hit`)
    - `correlationId`
23. No per-iteration logs. No DB schema changes. No UI dashboards.

### FR9 — UI hook — V2 conversational builder is the only Phase 2 path
24. The new Phase 2 flow lives in the **V2 conversational builder** (`ConversationalAgentBuilderV2` → `useConversationalFlow.ts`).
25. `AgentBuilderParent.tsx` is changed to **hardcode** the V2 conversational builder for the chat-creation path. The `useNewAgentCreationUI()` flag helper is removed.
26. The legacy `useConversationalBuilder.ts` / `ConversationalAgentBuilder.tsx` remain in the codebase for any other callers but are not reachable from the chat-creation entrypoint. Their formal deprecation/removal is a follow-up cleanup.

### FR10 — No feature flags
27. **No new feature flag is introduced.** The existing `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` flag is **removed** from the codebase (`lib/utils/featureFlags.ts`, `docs/FEATURE_FLAGS.md`, `CLAUDE.md`).
28. Any pre-existing flag entries in `.env.local` (e.g., `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE`, `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI`) should be removed; they have no effect after this requirement ships.

### FR11 — Branching & merge workflow
29. All development on the dedicated feature branch. No direct commits to `main`.
30. Merge to `main` gated on: SA code review ✅, QA test report ✅ (including **mandatory live dev-server smoke matrix** — see FR12), explicit user approval.
31. Merge strategy: `--no-ff`.

### FR12 — Mandatory live dev-server smoke matrix before "Code Complete"
32. Before the Dev marks the workplan "Code Complete", **Dev runs the dev server locally and walks through Phase 2 end-to-end** in a browser for these two scenarios:
    1. **Happy path** — sparse prompt, cooperative answers, terminates in `phase2_done` within a small number of turns.
    2. **Explicit "build it"** — user types "build it" at iteration 2, terminates as `phase2_done` (server-side keyword detection — no LLM call on that turn), Phase 3 fires.
33. This is **not optional** and is **not deferred to QA**. Source-inspection review alone is insufficient — Phase 2's failure mode is "rendered nothing on screen", which only a browser walkthrough catches. The smoke matrix outcome (PASS/FAIL with one-line note + the actual rendered questions captured) goes into the workplan before SA review begins.

---

## Non-Functional Requirements

| Concern | Requirement |
|---|---|
| Performance | One LLM call per iteration. Worst case ≈ 10 calls per session before the defensive cap fires. "Build it" / "done" termination skips the LLM call on the last turn. |
| Reliability | The loop MUST always terminate via one of the two enum termination reasons (`phase2_done` or `cap_hit`). |
| Observability | One Pino line per session at loop exit. |
| Determinism | The "I want to stop" keyword check (FR6) MUST be keyword-based, not LLM-judgment based. |
| UX | The defensive cap MUST NOT be exposed to the user. Inline hints only. Empty submits prevented at the UI level. |
| TypeScript | Strict, no implicit `any`. `TerminationReason` is a string-literal union, not `string`. |
| Code naming | Code symbols (types, schemas, files, message types) MUST NOT carry the prompt version number. Version numbers are for prompt files only. |
| Minimal prompt diff | v16 is a byte-for-byte copy of v15 plus two inserts. No question-logic rule changes. |

---

## Acceptance Criteria

- [ ] `Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` exists. Diff vs v15 = audience banner insert + Phase 2 interaction-process block insert. Nothing else changes.
- [ ] `init-thread` selects v16 unconditionally for the V2 flow. No flag gate.
- [ ] v16 includes the audience banner (FR2) and the single-question response contract block (FR3 sub-clause 7).
- [ ] LLM response Zod-validated server-side with `.strict()`. `phase2_done=true` only with `question=null` — enforced by `.refine()`. Schema, code, and tests use **no version number** in their names.
- [ ] Defensive iteration cap < 10 implemented server-side. Cap-hit termination uses `termination_reason: cap_hit` and surfaces a soft disclosure banner. Cap is NOT referenced in v16 or in any user-facing copy.
- [ ] Server-side "done" keyword check implemented. On match: loop terminates as `phase2_done` without making an LLM call for that turn. On no-match: user reply forwarded to LLM as normal. No other enums, no other server-side intent handling.
- [ ] Empty / whitespace-only input is prevented at the UI level (send button is `disabled` when the input is empty). Verified by manual smoke test.
- [ ] Loop controller has exactly 2 termination reasons: `phase2_done` and `cap_hit`. Both reachable per unit tests.
- [ ] Chat UI shows the question as a single bubble, optional soft inline hint, no numeric counter. The string "10" never appears in any user-facing Phase 2 copy (grep gate).
- [ ] Single Pino termination log per session with `iteration_count`, `termination_reason`, `correlationId`.
- [ ] `useNewAgentCreationUI()` helper deleted from `lib/utils/featureFlags.ts`; `AgentBuilderParent.tsx` hardcoded to V2 conversational builder; flag docs cleaned up in `FEATURE_FLAGS.md` and `CLAUDE.md`.
- [ ] **Mandatory live dev-server smoke matrix** (FR12) is run by Dev, results captured in the workplan, PASS for all two scenarios, BEFORE the workplan is marked "Code Complete."
- [ ] Prior Phase 2 prompt-related requirement MDs (the two currently in `docs/requirements/` referring to the prior consolidation effort) moved to `docs/requirements/archive/` with a one-line "Superseded by" header.
- [ ] All commits on the feature branch. No commits to `main` outside the final approved merge.
- [ ] Merge to `main` happens only after SA + QA + explicit user approval, using `--no-ff`.

---

## Out of Scope

- Any change to v15's Phase 2 question-selection logic (priority rules, allowlists, enumeration rules, failure-handling decision logic, "what" vs "when" framing, phrasing).
- Server-side handling of "skip" / "dismiss" / off-topic / gibberish user replies — those are forwarded to the LLM and handled in the conversation naturally.
- LLM-based classification of user input.
- Voice/audio chat parity.
- Multi-turn back-tracking (user revising earlier answers mid-loop).
- Adaptive cap that grows/shrinks based on signal.
- Persisting partial loop state across page reloads beyond current Phase 2 thread metadata.
- Updating the legacy `useConversationalBuilder.ts` to understand the new response shape.
- Per-iteration telemetry / dashboards / DB-backed analytics.
- Plugin-specific question logic — explicitly prohibited under [Platform Design Principles / No Hardcoding in System Prompts](/CLAUDE.md).
- Deleting `useConversationalBuilder.ts` / `ConversationalAgentBuilder.tsx` (left in place; deprecation is a follow-up).
- Altering the `processMessageInThread` signature in a way that breaks Phase 1 or Phase 3 callers. (The signature refactor in scope — collapsing trailing positional args to an options object — preserves Phase 1/3 caller behavior.)

---

## Notes on Integration Points

| System | Impact |
|---|---|
| `app/api/prompt-templates/` | New `Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`. Byte-for-byte copy of v15 + 2 inserts. v15 untouched. |
| `app/api/agent-creation/init-thread/route.ts` | Hardcoded prompt-template name updated from v15 to v16. Single string edit. |
| `app/api/agent-creation/process-message/route.ts` | Phase 2 branch reworked to: check for "done"-keyword match in `phase2_user_answer` BEFORE calling the LLM (short-circuit to terminate), snapshot the raw LLM JSON BEFORE the existing `aiResponse.success = true / phase = phase` mutation, Zod-validate the snapshot, advance the controller, emit one Pino termination log. |
| `lib/validation/phase2-schema.ts` | New Zod schema (named in parallel to existing `phase3-schema.ts`, no version in the symbol name). |
| `lib/agent-creation/phase2-done-detector.ts` | New ~15-line helper exporting `isDoneIntent(text: string): boolean` and the `DONE_KEYWORDS` array. Replaces the prior 5-enum classifier idea. |
| `lib/agent-creation/phase2-loop-controller.ts` | New pure state machine. 2 termination reasons (`phase2_done`, `cap_hit`). |
| `components/agent-creation/conversational/hooks/useConversationalFlow.ts` | Phase 2 path rewritten for per-turn round-trips. Each user reply fires a fresh `processMessageInThread(2, ...)` call with the new `phase2_user_answer` field, renders the next single question. |
| `components/agent-creation/conversational/hooks/useThreadManagement.ts` | Add `phase2UserAnswer?: string` parameter to `processMessageInThread()`; forward to API as a top-level body field. |
| `components/agent-creation/conversational/components/messages/Phase2DisclosureBanner.tsx` | New small component for the single terminal path that surfaces a soft banner (`cap_hit`). |
| `components/agent-creation/conversational/components/messages/AIMessage.tsx` | Two new `messageType` branches: `phase2_question`, `phase2_disclosure_banner`. |
| `components/agent-creation/conversational/types.ts` | Extend `messageType` union with the two new values above. |
| `components/agent-creation/types/agent-prompt-threads.ts` | Add response fields (`question`, `phase2_done`, `inline_hint`, `disclosure_banner`, `termination_reason`) to `ProcessMessageResponse`; add `phase2_user_answer` to `ProcessMessageRequest`. |
| Chat input component (in V2 UI) | Verify (or add) `disabled` on the send button when the input is empty or whitespace-only. Specific component path located during Step 1 of the workplan. |
| `components/agent-creation/AgentBuilderParent.tsx` | Hardcode the V2 conversational builder for the chat-creation path. Remove the `useNewAgentCreationUI()` call. |
| `lib/utils/featureFlags.ts` | Delete `useNewAgentCreationUI()`; remove its entry from `getFeatureFlags()`. |
| `docs/FEATURE_FLAGS.md` | Remove the `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` section + table row. |
| `CLAUDE.md` | Remove the row referencing `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` from the Feature Flags table. |
| `docs/requirements/archive/` | Move any prior Phase 2 prompt-related requirement MDs here, with a one-line "Superseded by" header. |
| `tests/v6-regression/scenarios/` | One new phase-2-only scenario `phase2-single-question-v2ui-pipeline-a` covering happy-path + explicit-build-it variants. |

---

## Process Guardrails

These guardrails exist because prior Phase 2 implementation work passed source-inspection review and unit tests but broke the live UI silently. They are first-class requirements, not suggestions.

1. **The active UI hook is determined by `AgentBuilderParent.tsx`.** Step 1 of the workplan is a live audit to confirm which builder the chat-creation path renders. No code-writing begins until this audit is documented in the workplan.
2. **The route mutates `parsedJson` before validation.** The Phase 2 response handler in `process-message/route.ts` injects `success: true, phase: 2` into the parsed payload BEFORE downstream validators see it. The new `.strict()` Zod schema will reject those injected keys and fail. The fix is to snapshot the raw `parsedJson` before the mutation and validate the snapshot — NOT to relax the schema.
3. **Source-inspection review by SA/QA is insufficient on its own.** The mandatory live dev-server smoke matrix (FR12) is a hard gate before SA review. Dev runs two scenarios in a real browser, captures the rendered output, and pastes it into the workplan.
4. **No feature flag for this behavior change.** Avoids the dual-path dead code that hides which branch is actually wired. Rollback is `git revert`, not a flag flip.
5. **Question-selection logic stays as v15.** Anyone proposing a change to carve-outs, allowlists, enumeration rules, failure-handling decision logic, or any other Phase 2 question-selection rule must justify why it's part of THIS requirement (it almost certainly isn't — file a separate requirement).
6. **Smoke matrix evidence must be timestamped and correlation-ID-annotated.** Each row of the Step 10 smoke matrix capture must include a timestamp and a `correlationId` (or `correlationId` prefix) so SA can trace each result back to a specific Pino log entry in `dev.log`. Free-text "passed" notes without traceable IDs do not satisfy this guardrail.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-27 | Initial draft | BA scoped the single-question + audience-note Phase 2 behavior as one cohesive requirement. Question-selection logic from v15 carries over verbatim; only the interaction process and a top-of-prompt audience note are added. No feature flags. V2 conversational builder is the only Phase 2 path. Server-side intent handling minimized to a single "done" keyword check; empty input prevented at the UI level. Live dev-server smoke matrix is mandatory before Code Complete. |
