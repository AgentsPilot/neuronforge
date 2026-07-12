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
   - **The question MUST be a STRUCTURED question object in the same shape v15 uses for each `questionsSequence[]` item** (see FR4) — NOT a plain text string. This preserves v15's `select` / `multi_select` / `text` question types and their `options` so the UI renders selectable option buttons, not options crammed into prose. (The first implementation collapsed this to a plain string, which made the LLM emit "pick a number" text questions — a regression from v15. See Change History.)
   - When the question count is sufficient to produce a deterministic enhanced prompt, emit `phase2_done: true` with `question: null`.
8. This block replaces v15's **batch** framing (a `questionsSequence[]` ARRAY) with **one** question object per turn. The per-question shape and ALL question-selection rules in v15 (priority, what to ask, what NOT to ask, phrasing, `select`/`multi_select`/`text` typing rules, `options`, `allowCustom`, "what" vs "when", etc.) are preserved verbatim — only the array → single-object framing changes.

### FR4 — Response contract validated server-side
9. Each Phase 2 LLM response MUST conform to:
    ```jsonc
    {
      "question": {                       // null only when phase2_done is true
        "id": "string",                   // globally unique across the run/thread
        "question": "string",             // the human-readable question text
        "type": "select" | "multi_select" | "text",   // ONLY these three types
        "options": [                      // required for select/multi_select; omitted for text
          { "value": "string", "label": "string", "description": "string (optional)" }
        ],
        "allowCustom": true,              // select/multi_select: offer a "none fit / my answer" escape
        "theme": "string (optional)"
      } | null,
      "phase2_done": boolean,
      "ai_reasoning": "string (optional)" // E6: server-side telemetry, never returned to the client
    }
    ```
   - **Question types are restricted to exactly `select`, `multi_select`, `text`** — nothing else (no `email`/`number`/etc.). This matches what the V2 page's option-button UI renders.
   - **(Amended by E6, 2026-05-30:)** `ai_reasoning` is a per-turn telemetry field — REQUIRED in the v16 prompt, OPTIONAL in the Zod schema (a rare omission falls into the degraded-passthrough path; FR4.11 unchanged). The route extracts it for a Pino breadcrumb (FR8) and **STRIPS it from the client response** — the page contract stays `{ question, phase2_done, disclosure_banner?, termination_reason? }`.
10. `phase2_done: true` MUST come with `question: null` (no bundling).
11. Zod-validated server-side with `.strict()` (rejects extra keys, including the legacy batch `questionsSequence[]` array). The only top-level keys the schema accepts are `question`, `phase2_done`, and `ai_reasoning` (E6). Validation failures are logged as a Pino warn breadcrumb; the loop does NOT retry the LLM call. On Zod failure, the route returns the parsed payload as-is in degraded form (the controller still increments `iteration_count`); the cap will eventually fire if the LLM never recovers. The route MUST NOT fabricate a synthetic question server-side.

### FR5 — Defensive iteration cap (server-side only)
12. Iteration cap = **up to 20 questions (≤ 20 LLM round-trips) per Phase 2 session, inclusive**. This is a **pure runaway backstop, not a functional question limit** — the prompt's QUESTION SELECTION rule (Part 5) tells the LLM to collect only *material* inputs and never pad, so it self-limits well below this; the cap only guards against a pathological loop (an LLM that never emits `phase2_done`). The cap is **per session** — a mini-cycle (Phase 3 → `user_inputs_required` → Phase 2) starts a fresh session with its own budget; the counter is not thread-global. **(Updated 2026-07-07, Part 5: raised 10 → 20 when the "reduce questions" bias was retired in favor of "ask for what's material." Was "10 inclusive" 2026-05-29; "< 10" originally.)**
13. On cap reach, the server terminates the loop with `termination_reason: cap_hit` and surfaces a soft disclosure banner ("Proceeding with what we have — you can refine after the agent is created.") to the user before advancing to Phase 3.
14. The cap is **never** mentioned in the prompt, never exposed in user-facing copy, and never logged for the user to see.

### FR6 — Minimal mid-loop user-input handling
15. Every user message during the Phase 2 loop is checked server-side against a small keyword list to detect ONLY the "I want to stop" intent:
    - If the user's reply matches one of: `build it`, `that's enough`, `that is enough`, `ship it`, `let's build`, `lets build`, `i'm ready`, `im ready`, `proceed`, `go ahead`, `move forward` (case-insensitive substring match) → terminate the loop as `phase2_done` without making an LLM call.
    - Otherwise → forward the user's reply to the LLM as the answer to the current question. The LLM handles all other cases (substantive answers, "skip" or off-topic replies, ambiguous input, etc.) naturally as part of the conversation.
16. The detection is keyword-only (deterministic). No LLM-based classification. The single-word `'done'` is intentionally NOT in the keyword list — substring matching on `'done'` would false-positive on substantive answers like `"let me know once it's done processing each batch"`. The multi-word phrases above cover the user-intent space safely.
17. **Empty / whitespace-only input is prevented at the UI level** — the chat send button is already disabled when the input box is empty or contains only whitespace (existing guard at `components/agent-creation/conversational/components/ChatInput.tsx:54`). The server never sees an empty Phase 2 user message and does not need to handle that case.

### FR7 — UX presentation
18. Each iteration renders ONE question in the V2 page using its **existing structured-question UI** — i.e. `select`/`multi_select` render as clickable option buttons (with the `allowCustom` escape) and `text` renders as a free-text answer, exactly as v15's batch flow rendered each question. Reuse the page's existing `questionsSequence` / `currentQuestionIndex` rendering rather than printing the question as plain prose.
19. Each question from Q2 onward MAY be accompanied by a soft inline hint (e.g., "A few more details to refine your agent") — phrased to avoid exposing the hard cap. **(Updated by E3, 2026-05-29:)** hints are now **client-generated** from the `clarification_hints` category of `thinking-words-dictionary.json` (a shuffled, no-repeat walk of 10 phrases), NOT server-controlled. The server `inline_hint` field and the controller's `INLINE_HINTS` array are removed. **(E3.5:)** the hint renders as a **native AI chat bubble** (`addAIMessage`), placed as a lead-in *before* the question — not as the centered system "comment" pill (`addSystemMessage`).
19a. **(Added by E3 / T2, 2026-05-29:)** Before the **first** Phase 2 question only, the page renders a static opening message — "I need a few quick details before I can build your agent." — as an AI bubble. This is client-side (no prompt/contract change) and resolves the missing-intro gap (T2). Converging hints (FR7.19) therefore begin at Q2.
20. No progress bar shown. **(Amended by E4, 2026-05-29:)** a numerator-only running question number ("Question N") IS allowed — where N is a thread-wide running total across sessions (mini-cycle questions continue the count, they do not restart at 1). A denominator/total ("of M") and any reference to the hard cap remain forbidden. The hard cap is NEVER exposed in user-facing copy; inline hints and the opening message stay qualitative ("a few…"), never "question N of M."
21. The chat send button is `disabled` when the input box is empty or whitespace-only (see FR6.17).

### FR8 — Telemetry
22. **One structured Pino log line at loop exit (REQUIRED):**
    - `iteration_count` (integer)
    - `termination_reason` (enum: `phase2_done` | `cap_hit`)
    - `correlationId`
22a. **(Amended by E6, 2026-05-30:)** in addition to the termination log, the route emits **one per-turn Pino `info` breadcrumb** — `"Phase 2 turn decision"` — carrying:
    - `iteration_count` (integer)
    - `decision` (enum: `'continue'` | `'phase2_done'` | `'cap_hit'`)
    - `ai_reasoning` (string, optional — populated when the LLM provided it; absent when the field was missing from the payload)
    - `correlationId`
    This is the calibration signal for the OI1 pacing rule. No DB / no UI / no dashboard — server-side log breadcrumbs only.
23. No further per-iteration logs beyond the breadcrumb above. No DB schema changes. No UI dashboards.

### FR9 — UI surface — the primary V2 agent-creation page
24. The new Phase 2 flow lives in the **primary V2 agent-creation page**: the route **`/v2/agents/new`**, served by **`app/v2/agents/new/page.tsx`**. This is the page users actually reach when they create an agent in the V2 product (per CLAUDE.md, `/app/v2/` is "V2 Dashboard and Sandbox (primary UI)").
25. The page's Phase 2 orchestration — `processPhase2()`, the question-render `useEffect`, the answer-submission handler, and the auto-advance `useEffect` — is reworked for single-question mode: render ONE question, wait for the user's answer, send it back via a fresh `phase: 2` call with `phase2_user_answer`, render the next question, and only advance to Phase 3 (`processPhase3`) when the response sets `phase2_done: true`.
26. The page currently uses a **batch `questionsSequence` model**: it reads `data.questionsSequence` and, when empty, auto-advances to Phase 3 via `setTimeout(() => processPhase3(tid), 1500)`. Because the new server response carries `{ question, phase2_done }` and NO `questionsSequence`, this batch path reads "0 questions" and skips straight to Phase 3 — this is the exact bug the rework must fix.
27. **Other agent-creation surfaces are out of scope.** `components/agent-creation/conversational/` (`ConversationalAgentBuilderV2` / `useConversationalFlow.ts`, reached via `/agents/new/chat` → `AgentBuilderParent`) and the legacy `useConversationalBuilder.ts` are NOT the primary V2 path and are NOT modified by this requirement. (An earlier draft of this requirement incorrectly named `ConversationalAgentBuilderV2`/`useConversationalFlow.ts` as the target — see the Process Guardrails note on the entry-point audit.)

### FR10 — No feature flags
28. **No new feature flag is introduced.** The single-question behavior is the unconditional Phase 2 behavior of `app/v2/agents/new/page.tsx`. Rollback is `git revert`.
29. `app/v2/agents/new/page.tsx` does NOT consume `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` (that flag only gated the separate `/agents/new/chat` route, which is out of scope here). No flag is added or removed by this requirement.
30. Any pre-existing flag entries in `.env.local` (e.g., `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE`) should be removed; they have no effect after this requirement ships.

### FR11 — Branching & merge workflow
29. All development on the dedicated feature branch. No direct commits to `main`.
30. Merge to `main` gated on: SA code review ✅, QA test report ✅ (including **mandatory live dev-server smoke matrix** — see FR12), explicit user approval.
31. Merge strategy: `--no-ff`.

### FR12 — Mandatory live dev-server smoke matrix before "Code Complete"
32. Before the Dev marks the workplan "Code Complete", **Dev runs the dev server locally and walks through Phase 2 end-to-end in a browser at the real URL `/v2/agents/new`** for these two scenarios:
    1. **Happy path** — sparse prompt, cooperative answers, terminates in `phase2_done` within a small number of turns.
    2. **Explicit "build it"** — user types "build it" at iteration 2, terminates as `phase2_done` (server-side keyword detection — no LLM call on that turn), Phase 3 fires.
33. This is **not optional** and is **not deferred to QA**. Source-inspection review alone is insufficient — Phase 2's failure mode is "rendered nothing on screen", which only a browser walkthrough catches. The smoke matrix outcome (PASS/FAIL with one-line note + the actual rendered questions captured) goes into the workplan before SA review begins.

---

## Non-Functional Requirements

| Concern | Requirement |
|---|---|
| Performance | One LLM call per iteration. Worst case = 20 calls per session (20 questions inclusive — the runaway backstop, should never fire in practice); the 21st turn caps WITHOUT a call (pre-call guard). "Build it" / "done" termination also skips the LLM call on that turn. |
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
- [ ] LLM response Zod-validated server-side with `.strict()`. `question` is the **structured object** (`{ id, question, type, options?, allowCustom?, theme? }`) with `type` constrained to `select` | `multi_select` | `text`; `null` only when `phase2_done=true` (enforced by `.refine()`). Schema, code, and tests use **no version number** in their names.
- [ ] Defensive iteration cap = up to 20 questions inclusive (≤ 20 round-trips), per session, implemented server-side — a pure runaway backstop (Part 5). Cap-hit termination uses `termination_reason: cap_hit` and surfaces a soft disclosure banner. Cap is NOT referenced in v16 or in any user-facing copy.
- [ ] Server-side "done" keyword check implemented. On match: loop terminates as `phase2_done` without making an LLM call for that turn. On no-match: user reply forwarded to LLM as normal. No other enums, no other server-side intent handling.
- [ ] Empty / whitespace-only input is prevented at the UI level (send button is `disabled` when the input is empty). Verified by manual smoke test.
- [ ] Loop controller has exactly 2 termination reasons: `phase2_done` and `cap_hit`. Both reachable per unit tests.
- [ ] `app/v2/agents/new/page.tsx` renders one **structured** question per turn through its existing `questionsSequence`/option-button UI (`select`/`multi_select` → clickable options with `allowCustom`; `text` → free text), collects the answer, sends it back as `phase2_user_answer`, and only advances to `processPhase3` when the response sets `phase2_done: true`. No options crammed into prose. **(Amended by E4:)** a numerator-only running "Question N" indicator is allowed; the grep gate forbids exposing the cap as a number/denominator ("of 20", "20 questions max") in user-facing copy — NOT an incidental running ordinal like "Question 8".
- [ ] Single Pino termination log per session with `iteration_count`, `termination_reason`, `correlationId`.
- [ ] No feature flag added or removed. `app/v2/agents/new/page.tsx` does not gate the new behavior behind any flag. The separate `/agents/new/chat` route and `components/agent-creation/conversational/` are untouched.
- [ ] **Mandatory live dev-server smoke matrix** (FR12) is run by Dev **against the real URL `/v2/agents/new`**, results captured in the workplan, PASS for both scenarios, BEFORE the workplan is marked "Code Complete."
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
- Touching `components/agent-creation/conversational/**`, `AgentBuilderParent.tsx`, the `/agents/new/chat` route, or the legacy `useConversationalBuilder.ts` — none of these is the primary V2 path.
- Any feature-flag changes (`useNewAgentCreationUI` and `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` are left exactly as they are).
- Breaking the Phase 1 or Phase 3 behavior of `app/v2/agents/new/page.tsx` while reworking Phase 2 — the rework is confined to the Phase 2 path.
- The automatic Phase 3 → Phase 2 "mini-cycle" re-trigger on `user_inputs_required` is **retained as a safety net** (v15 behavior), but it fires only for inputs that are GENUINELY still missing. The duplicate-question + phase-confusion crash it previously caused were NOT the mini-cycle's fault — they were caused by Phase 2 answers being keyed `phase2_turn_N` (unrecognizable to Phase 3), so Phase 3 re-listed already-answered inputs. With answers keyed by question id + Phase 3 resolving from the conversation, the mini-cycle stays silent when the loop did its job. User-initiated refinement via "Need changes" is also retained.

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
| **`app/v2/agents/new/page.tsx`** | **THE primary UI surface.** Rework `processPhase2()` + the question-render `useEffect` + the answer handler + the auto-advance `useEffect`: detect the `{ question, phase2_done }` response shape, render ONE question, wait for the answer, send it back via a fresh `phase: 2` fetch with `phase2_user_answer`, render the next question, advance to `processPhase3` only on `phase2_done: true`. Render the `cap_hit` disclosure banner before advancing. Remove/replace the batch `data.questionsSequence` auto-advance. |
| V2 chat input (within the `/v2/agents/new` page's component tree) | Confirm the send button is `disabled` when the input is empty/whitespace. Exact path located in the Step 1 audit. |
| `components/agent-creation/types/agent-prompt-threads.ts` | Add response fields (`question`, `phase2_done`, `disclosure_banner`, `termination_reason`) to `ProcessMessageResponse`; add `phase2_user_answer` to `ProcessMessageRequest`. (`inline_hint` was added then **removed by E3** — hints are now client-generated.) |
| `lib/ui/thinking-words-dictionary.json`, `lib/ui/thinking-words-loader.ts` | **(E3)** Add the `clarification_hints` category (10 phrases) with an `excludeFromGeneric` flag so the sentences stay out of the generic word pool; add `'clarification_hints'` to the `ThinkingCategory` union. |
| `components/agent-creation/conversational/**` and `/agents/new/chat` route | **NOT touched.** This is the separate, non-primary agent-creation surface. The earlier draft incorrectly targeted it. |
| `lib/utils/featureFlags.ts`, `docs/FEATURE_FLAGS.md`, `CLAUDE.md` | **NOT touched.** No flag added or removed. (The earlier draft's `useNewAgentCreationUI` removal was based on the wrong entry point and has been reverted.) |
| `docs/requirements/archive/` | Move prior Phase 2 prompt-related requirement MDs here, with a one-line "Superseded by" header. |
| `tests/v6-regression/scenarios/` | One new phase-2-only scenario `phase2-single-question-v2ui-pipeline-a` covering happy-path + explicit-build-it variants. |

---

## Process Guardrails

These guardrails exist because prior Phase 2 implementation work passed source-inspection review and unit tests but broke the live UI silently. They are first-class requirements, not suggestions.

1. **The entry point MUST be confirmed by the actual URL, not by assumption.** The first attempt failed because the Step 1 audit named `ConversationalAgentBuilderV2`/`useConversationalFlow.ts` (reached via `/agents/new/chat`) as the target, but the URL users actually open is **`/v2/agents/new`**, served by `app/v2/agents/new/page.tsx` — a different implementation. Step 1 of the workplan MUST: open the real URL, trace Next.js routing to the served `page.tsx`, and name the exact file + functions that orchestrate Phase 2, BEFORE any code. Naming a component from memory or a prior investigation does not satisfy this guardrail.
2. **The route mutates `parsedJson` before validation.** The Phase 2 response handler in `process-message/route.ts` injects `success: true, phase: 2` into the parsed payload BEFORE downstream validators see it. The new `.strict()` Zod schema will reject those injected keys and fail. The fix is to snapshot the raw `parsedJson` before the mutation and validate the snapshot — NOT to relax the schema.
3. **Source-inspection review by SA/QA is insufficient on its own.** The mandatory live dev-server smoke matrix (FR12) is a hard gate before SA review. Dev runs two scenarios in a real browser, captures the rendered output, and pastes it into the workplan.
4. **No feature flag for this behavior change.** Avoids the dual-path dead code that hides which branch is actually wired. Rollback is `git revert`, not a flag flip.
5. **Question-selection logic stays as v15.** Anyone proposing a change to carve-outs, allowlists, enumeration rules, failure-handling decision logic, or any other Phase 2 question-selection rule must justify why it's part of THIS requirement (it almost certainly isn't — file a separate requirement).
6. **Smoke matrix evidence must be timestamped and correlation-ID-annotated.** Each row of the Step 10 smoke matrix capture must include a timestamp and a `correlationId` (or `correlationId` prefix) so SA can trace each result back to a specific Pino log entry in `dev.log`. Free-text "passed" notes without traceable IDs do not satisfy this guardrail.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-27 | Initial draft | BA scoped the single-question + audience-note Phase 2 behavior as one cohesive requirement. Question-selection logic from v15 carries over verbatim; only the interaction process and a top-of-prompt audience note are added. No feature flags. Server-side intent handling minimized to a single "done" keyword check; empty input prevented at the UI level. Live dev-server smoke matrix is mandatory before Code Complete. |
| 2026-05-28 | **Entry-point correction (gap fix)** | First implementation wired the UI into `ConversationalAgentBuilderV2`/`useConversationalFlow.ts` (reached via `/agents/new/chat`). Live testing at the real URL **`/v2/agents/new`** showed Phase 2 jumped straight to the plugin gate — because that page (`app/v2/agents/new/page.tsx`) is a separate implementation using the batch `questionsSequence` model and auto-advances when no `questionsSequence` is returned. The backend (v16 prompt, route, schema, done-detector, loop-controller) was proven correct by dev.log and kept. The mis-targeted UI changes were reverted. FR9/FR10, integration points, ACs, and Process Guardrail #1 rewritten to target `app/v2/agents/new/page.tsx` and to require URL-verified entry-point auditing. No flags changed. |
| 2026-05-28 | **Structured-question contract correction (FR3/FR4)** | After the UI was retargeted, live testing showed Phase 2 emitting plain-text "pick a number 1/2/3" questions instead of v15's `select`/`multi_select` option buttons. Root cause: the single-question contract had collapsed `question` to a plain `string`, and v16's Insert B explicitly forbade `type`/`options` — contradicting v15's still-present question-type rules. FR3/FR4 (+ FR7 and ACs) corrected so `question` carries ONE **structured** `ClarificationQuestion` object per turn (`type` ∈ `select`/`multi_select`/`text` only), and the page reuses its existing structured-question/option-button rendering. This realigns the contract with the requirement's own "question types preserved verbatim" scope statement. |
| 2026-05-28 | ~~Removed the Phase 3 → mini-cycle auto-re-trigger~~ (superseded same day — see next row) | Initial reaction to the duplicate-question + crash was to delete the mini-cycle. Further diagnosis showed the mini-cycle was a symptom, not the cause — see the next row. The mini-cycle has been RESTORED. |
| 2026-05-29 | **Phase-confusion crash fix (E2): re-add RESPONSE-SHAPE reinforcement + corrective retry** | Live test: a `phase: 3` request came back as a Phase 2 single-question payload (`{ question: { id: "q9", … }, phase2_done: false }`) and the one-shot retry produced the same → Phase 3 validation 500. Cause: after ~9 single-question Phase 2 turns the model is entrenched in the `{question, phase2_done}` pattern and keeps emitting questions when the cap-triggered `phase: 3` request arrives; v16's Phase 3 had no instruction to switch shape (the RESPONSE-SHAPE reinforcement was over-eagerly reverted on 2026-05-28), and the retry re-sent the identical entrenched context. **Fix:** (1) re-add a tightened RESPONSE-SHAPE reinforcement to v16 Phase 3 — a justified single-question-specific divergence from v15 (v15 batch never entrenched the pattern), recorded alongside the `processing_steps` divergence; (2) make the route's Phase 3 retry corrective (append a one-line "this is phase 3, return enhanced_prompt not a question" nudge before the single retry). The separate "resolve from conversation" addition stays reverted (genuinely redundant with the qId keying fix). Open item OI1 logged: the loop asked 9 questions (over-asking + entrenchment amplifier) — pacing/wrap-up cue deferred. |
| 2026-05-28 | **Root-cause fix: recognize answered inputs (keying); mini-cycle restored as safety net; Phase 3 crash hardened — NO Phase 3 prompt changes** | Diagnosis: the user provided a value (e.g. the AliExpress sender email) during the single-question loop, yet Phase 3 still listed it in `user_inputs_required` (resolved_user_inputs had the recipient + time window but NOT the sender email) — so the mini-cycle re-asked it, and the resulting Phase 2 churn left the LLM in Phase 2 mode, so a later `phase: 3` call returned a Phase 2 payload → Phase 3 validation crash. Real cause: a regression in the **page** — Phase 2 answers were keyed `phase2_turn_N` as plain strings with NO link to the input, so v15's (intact) Phase 3 resolution, which reads `clarification_answers[qId]`, couldn't see them as answered. Confirmed by diff that **v16's Phase 3 section is byte-identical to v15** (no core Phase 3 element changed). **Fixes:** (1) the page now keys answers by the question's `id`, restoring the exact v15 `clarification_answers` contract that v15's intact Phase 3 logic already resolves; (2) the Phase 3 → mini-cycle re-trigger is **restored** as a genuine safety net (fires only for truly-missing inputs, at most once per session); (3) the route retries the Phase 3 completion once if it comes back wrong-shaped, instead of 500-ing the flow. Two interim Phase 3 *prompt* additions (a "response shape" reminder and a "resolve from conversation" reminder) were **reverted** — they were compensating for the keying regression, not for any Phase 3 change, so v16 Phase 3 == v15 Phase 3 exactly. |
