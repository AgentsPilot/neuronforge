# Requirement: V2 Agent Creation — R3 Phase 2 Single-Question Mode (Experimental)

> **Status:** Superseded by [V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md](/docs/requirements/V2_AGENT_CREATION_PHASE2_SINGLE_QUESTION_REQUIREMENT.md). Kept for historical reference.

> **Last Updated**: 2026-05-24

**Created by:** BA
**Date:** 2026-05-24
**Status:** Draft — Experimental
**Sequence:** R3 of 3 — experimental successor to [R2](/docs/requirements/V2_AGENT_CREATION_R2_PROMPT_TONE_DOWN_REQUIREMENT.md). Ships AFTER [R1](/docs/requirements/V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md) (v15) and R2 (v16). R3 ships as **prompt v17**, gated behind a feature flag, default OFF.

---

## Overview

Introduce an experimental Phase 2 "single-question mode" where the LLM emits **one question per turn** instead of a batch. The mode is gated behind a new env feature flag (default OFF); when off, the v16 batch mode (R2) is unchanged. When on, a new **prompt v17** runs an iterative loop: ask one question → user answers → ask next (most important) question → ... → emit `phase2_done: true`. R1's Phase 4 removal and R2's carve-outs/cap remain applicable; the cap becomes "max iterations" instead of "max batched questions". Includes a catch-all safety net at the cap, soft UX phrasing, mid-loop error classification, and a single Pino termination log per session.

---

## Table of Contents

1. [User Stories](#user-stories)
2. [Functional Requirements](#functional-requirements)
3. [Non-Functional Requirements](#non-functional-requirements)
4. [Acceptance Criteria](#acceptance-criteria)
5. [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
6. [Open Questions](#open-questions)
7. [Notes on Integration Points](#notes-on-integration-points)
8. [Decisions](#decisions)
9. [Change History](#change-history)

---

## User Stories

- As a **non-technical user**, I want Phase 2 to feel like a natural conversation (one question at a time) rather than a form interrogation, so it feels approachable.
- As a **TL / SA running an A/B comparison**, I want single-question mode behind a feature flag so I can compare its UX and outcomes against batched v16 without affecting the default flow.
- As a **user mid-loop who accidentally hits send**, I want the system to re-ask rather than skip my question.
- As a **user who decides they're done early**, I want to say "build it" / "that's enough" and have the system move to Phase 3.
- As an **operator analysing experimental rollout**, I want a single structured Pino log per session capturing iteration count and termination reason, so I can validate behaviour without instrumenting a full telemetry stack.

---

## Functional Requirements

### FR1 — Activation (feature flag, opt-in)
1. Introduce a new env feature flag: `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE`, default `false`.
2. When `false`: v16 batch mode unchanged (R2 behaviour).
3. When `true`: Phase 2 uses new prompt **v17** and emits one question per LLM call.
4. R1's Phase 4 removal and R2's carve-out/cap rules still apply (cap becomes "max iterations"; see FR3).

### FR2 — Termination signal
5. Each Phase 2 LLM response in v17 MUST conform to the contract:

   ```json
   {
     "question": "string | null",
     "phase2_done": "boolean",
     "reasoning": "string (optional)"
   }
   ```

6. `phase2_done: true` MUST be emitted **on its own** with `question: null` in the same response — i.e. the loop never bundles a final question with the done signal. If the LLM still has one more question, it asks it, gets the answer, then a final round-trip emits `phase2_done: true` with `question: null`.
7. Response shape MUST be Zod-validated server-side; failures fall through to mid-loop error handling (FR8).

### FR3 — Iteration cap
8. Iteration cap = **< 10 total questions across the loop** (identical numeric cap to R2 for consistency and A/B comparability).

### FR4 — "Most important question" selection
9. The v17 prompt MUST instruct the LLM to select the next question in this priority:
   1. Exhaust R2's carve-outs in priority order: **allowlist** → **enumeration** → **failure** → **theme coverage**.
   2. Once all R2 carve-outs are satisfied, switch to **information-gain mode** for any remaining ambiguity.
10. This preserves R2's safety net while enabling organic exploration after the carve-outs are met.

### FR5 — Cap-hit behaviour (catch-all at N=9)
11. At iteration N=9 (the last allowed iteration), if `phase2_done` is still not set, the system MUST switch to a **"summarise remaining ambiguities into one final catch-all question"** mode.
12. If the user answers the catch-all → proceed to Phase 3 (termination reason: `cap_hit_catchall_answered`).
13. If the user skips/dismisses the catch-all → auto-proceed to Phase 3 with an explicit disclosure banner: "Moving forward with defaults for [list]. Refine after creation." (termination reason: `cap_hit_catchall_skipped`).

### FR6 — UX presentation
14. Each iteration is rendered in the existing chat UI (chat parity).
15. Each assistant message MUST include a soft inline hint like "A few more questions to refine your agent" — phrased to avoid exposing the hard cap of 10. The cap is a safety net, not a target.
16. No progress bar / numeric counter shown to the user.

### FR7 — Carve-out rule transfer (v16 → v17)
17. v17 iterations MUST emit one self-contained question per turn.
18. **The means of achieving this from R2's rule set is a Dev/SA call after reading v16's rule code.** Verbatim transfer of R2 rules is the suggested default. Tracked as Open Question OQ1 below.

### FR8 — Mid-loop error handling (input classification)
19. The system MUST classify each user response and act per the following table:

   | User input type | Action | Termination reason if loop exits |
   |---|---|---|
   | Empty / whitespace only | Re-ask once (likely accidental send) | n/a (continue) |
   | Explicit dismiss (close button, "skip", "no thanks") | Skip current question and ask next | `user_dismissed` if it terminates the loop |
   | Unparseable / off-topic / gibberish | Re-ask once with clarification; skip on second failure | `mid_loop_error_skip` (single skip) or `mid_loop_error_giveup` (repeated failures) |
   | Explicit "done" / "build it" / "that's enough" | Treat as `phase2_done: true` | `phase2_done` |

20. Intent classification MUST use a keyword heuristic first (cheap); only if the heuristic is ambiguous may a small LLM classification call be used as fallback.

### FR9 — Telemetry (minimal Pino + termination signal)
21. Emit exactly **one structured Pino log line at loop exit** containing:
    - `iteration_count` (integer)
    - `termination_reason` (enum: one of `phase2_done`, `cap_hit_catchall_answered`, `cap_hit_catchall_skipped`, `user_dismissed`, `mid_loop_error_skip`, `mid_loop_error_giveup`)
    - `correlationId`
22. No additional logs per iteration. No DB schema changes. No UI dashboards. Aligned with R2's minimalist philosophy.

### FR10 — Sequencing & status
23. R3 is **experimental**. Ships AFTER R1 + R2.
24. v17 is the third deliverable. v16 remains the default when the flag is off.
25. Documented and tagged as experimental in any user-facing settings (if exposed) and in the prompt-template directory.

### FR11 — Branching & Merge Workflow
26. All R3 development MUST happen on a dedicated feature branch (e.g. `feature/v2-agent-creation-r3-single-question-mode`). Direct commits to `main` are NOT permitted under any circumstances.
27. Merge to `main` is gated on ALL of the following, in order: (a) SA code review approved, (b) QA test report passes (all acceptance criteria below verified, including the manual smoke matrix), (c) user explicitly approves the merge in the same session.
28. Merge strategy: `--no-ff` so the merge commit is preserved as a clear rollback boundary.
29. R3 MUST NOT be merged to `main` before R1 (v15) AND R2 (v16) have been merged. v17 builds on v16's prompt + carve-out rules.

---

## Non-Functional Requirements

| Concern | Requirement |
|---|---|
| Performance | One LLM call per iteration. Worst case = 10 calls per session (vs 1-2 for v16). Latency must be acceptable to users; offset by perceived conversational pacing. |
| Reliability | Loop MUST always terminate. Either `phase2_done`, catch-all answered/skipped, mid-loop give-up, or user dismiss. No infinite-loop paths allowed. |
| Backwards compatibility | When flag OFF, the v16 code path is bit-identical to its pre-R3 state. R3 must not alter v16 behaviour. |
| Observability | One Pino line per session at loop exit — enough to compute iteration distribution and termination breakdown from logs. |
| Validation | All LLM responses Zod-validated (FR2). Schema violation = mid-loop error (FR8). |
| Determinism (mid-loop) | Keyword heuristic first (deterministic); LLM classifier only as ambiguity fallback. |
| UX | Soft phrasing only (FR6). The hard cap MUST NOT be exposed to the user. |
| Audience | Non-technical user emphasis (R2 FR11) carries over to v17. |

---

## Acceptance Criteria

- [ ] `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE` feature flag wired; defaults to `false`; documented in `docs/feature_flags.md`.
- [ ] When flag is `false`, v16 batch mode is unchanged (regression run matches pre-R3 baseline byte-for-byte for sample scenarios).
- [ ] When flag is `true`, Phase 2 uses prompt **v17**, emits one question per LLM call.
- [ ] `Workflow-Agent-Creation-Prompt-v17-chatgpt.txt` exists and selects in code only when the flag is `true`.
- [ ] LLM response contract `{ question: string | null, phase2_done: boolean, reasoning?: string }` is Zod-validated server-side.
- [ ] `phase2_done: true` is only ever emitted with `question: null` (FR2 sub-clause).
- [ ] Iteration cap < 10 enforced (FR3).
- [ ] At N=9, catch-all mode triggers; user-answer path proceeds to Phase 3; user-skip path auto-proceeds with disclosure banner (FR5).
- [ ] Chat UI shows soft inline hint per iteration; no numeric counter; hard cap not exposed (FR6).
- [ ] Mid-loop input classifier implemented with keyword-heuristic-first + LLM-fallback policy (FR8).
- [ ] Single Pino termination log emitted at loop exit with `iteration_count`, `termination_reason` (enum), `correlationId` (FR9).
- [ ] Loop always terminates via one of the six enum termination reasons.
- [ ] Manual smoke test passes covering: full loop to `phase2_done`, cap-hit catch-all answered, cap-hit catch-all skipped, user dismiss mid-loop, empty input re-ask, gibberish re-ask + skip, explicit "build it" early termination.
- [ ] Feature is documented as **experimental** in the relevant prompt-template / feature-flag docs.
- [ ] All commits are on a `feature/...` branch — no commits to `main` outside the final approved merge.
- [ ] Merge to `main` happens only after SA approval + QA pass + explicit user approval, using `--no-ff`.
- [ ] R1 (v15) AND R2 (v16) are already merged to `main` before R3 is merged.

---

## Out of Scope / Future Roadmap

- Replacing v16 as default — out of scope. R3 is experimental; flag stays off by default until A/B telemetry justifies promotion.
- Per-iteration telemetry / dashboards / DB-backed analytics — out of scope; one Pino line per session is sufficient for the experimental phase.
- Voice/audio chat parity — out of scope.
- Multi-turn back-tracking (user revising earlier answers mid-loop) — out of scope for v17.0; consider for a future revision.
- Adaptive cap (cap shrinks/grows based on signal) — out of scope.
- Persisting partial loop state across page reloads — out of scope; current Phase 2 thread state persistence applies.

---

## Open Questions

- [ ] **OQ1** — Carve-out rule transfer mechanism (raised by: BA | status: pending Dev/SA decision after reading v16 rule code).
  - **Requirement statement:** v17 iterations MUST emit one self-contained question per turn.
  - **Suggested resolution:** verbatim transfer of R2's rule set as the default; only deviate if v16's rule code clearly assumes batch emission and cannot be reused as-is.
  - **Escalation path:** Dev to flag in the workplan; SA to confirm during workplan review.

---

## Notes on Integration Points

| System | Impact |
|---|---|
| `app/api/prompt-templates/` | New file `Workflow-Agent-Creation-Prompt-v17-chatgpt.txt` added. Tagged experimental. |
| `app/api/agent-creation/process-message/route.ts` | Phase 2 branch checks `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE`. When true, runs the v17 iterative loop with the new response contract + Zod validation + iteration counter + catch-all gate + mid-loop classifier + Pino termination log. |
| `lib/utils/featureFlags.ts` | New flag helper for `usePhase2SingleQuestionMode()`. |
| `docs/feature_flags.md` | New flag documented. |
| Pino logger | One new structured log statement at loop exit (single line per session). |
| Zod validation layer | New schema for v17 LLM response contract. |
| Chat UI (Phase 2 conversation component) | Renders one question per turn; shows soft inline hint; renders disclosure banner on cap-hit-skip path. No new component pattern. |
| AI Provider Factory | Used per iteration. No factory changes. |
| R1 (v15) | Pre-requisite. Must already be shipped. |
| R2 (v16) | Pre-requisite. Must already be shipped. v16 is the fallback when the R3 flag is off. |
| Catch-all classifier (keyword-first) | New small utility (likely under `lib/utils/`) — Dev/SA to decide exact location. |

---

## Decisions

The following decisions were captured during requirement scoping. Each Q corresponds to a clarifying question raised by the BA and answered by the user.

| ID | Question | Decision |
|---|---|---|
| Q1 | Activation | Feature flag opt-in. New env flag `NEXT_PUBLIC_USE_PHASE2_SINGLE_QUESTION_MODE` (default false). When false → v16 batch mode unchanged. When true → prompt v17 emits one question per LLM call. v16 remains stable fallback. R1+R2 rules still apply; cap becomes "max iterations". |
| Q2 | Termination signal | Explicit `phase2_done: true` field. Response shape: `{ question: string \| null, phase2_done: boolean, reasoning?: string }`. Sub-option (ii): `phase2_done: true` MUST come on its own with `question: null`. |
| Q3 | Iteration cap | Same as v16 — < 10 total questions across the loop. Keeps consistency and cleaner A/B comparison. |
| Q4 | "Most important question" selection | Hybrid — exhaust R2 carve-outs in priority order (allowlist → enumeration → failure → theme coverage), then switch to information-gain mode for remaining ambiguity. |
| Q5 | Cap-hit behaviour | Hybrid — at N=9, if `phase2_done` still not set, force "summarise remaining ambiguities into one final catch-all question" mode. Answered → proceed. Skipped → auto-proceed with explicit disclosure banner. |
| Q6 | UX presentation | Chat parity + softer phrasing — each assistant message includes a soft inline hint ("A few more questions to refine your agent") rather than exposing the hard cap of 10. Cap is a safety net, not a target. |
| Q7 | Carve-out rule transfer (v16 → v17) | Defer to SA. Tracked as Open Question OQ1. Verbatim transfer is the suggested default. Requirement: v17 iterations must emit one self-contained question per turn. |
| Q8 | Mid-loop error handling | Differentiate by input type — Empty → re-ask once; Explicit dismiss → skip and ask next; Unparseable/off-topic → re-ask once, skip on second failure; Explicit "done"/"build it" → treat as `phase2_done`. Intent classification: keyword heuristic first, LLM fallback only if heuristic ambiguous. |
| Q9 | Telemetry | Minimal Pino + R3 termination signal only. Single log line per session at loop exit with `iteration_count` + `termination_reason` enum (`phase2_done` / `cap_hit_catchall_answered` / `cap_hit_catchall_skipped` / `user_dismissed` / `mid_loop_error_skip` / `mid_loop_error_giveup`) + `correlationId`. |
| Sequencing | Order vs R1/R2 | R3 is EXPERIMENTAL. Ships AFTER R1+R2. Single-question mode is the third deliverable. Marked "experimental — gated behind feature flag; not the default". |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-24 | Initial draft | BA captured requirement, user answered Q1–Q9 + sequencing, document drafted. OQ1 (carve-out rule transfer mechanism) left open pending Dev/SA review of v16 rule code. |
| 2026-05-24 | Added Branching & Merge Workflow | Added FR11 (FR26–FR29) + acceptance criteria for feature-branch development, gated merge to `main`, and ordering constraint (R1/v15 + R2/v16 merged before R3/v17). |
