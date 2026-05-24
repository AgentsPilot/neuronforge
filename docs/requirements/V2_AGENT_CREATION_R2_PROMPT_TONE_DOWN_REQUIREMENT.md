# Requirement: V2 Agent Creation — R2 Prompt Tone-Down (Phase 2 Question Cap & Carve-Outs)

> **Last Updated**: 2026-05-24

**Created by:** BA
**Date:** 2026-05-24
**Status:** Draft
**Sequence:** R2 of 3 — layers on top of [R1](/docs/requirements/V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md) (prompt v15). R2 ships as **prompt v16**. [R3](/docs/requirements/V2_AGENT_CREATION_R3_SINGLE_QUESTION_MODE_REQUIREMENT.md) is the experimental successor.

---

## Overview

Tone down the V2 Agent Creation Phase 2 enhanced-prompt system prompt so the LLM stops over-asking and over-enumerating. Replace the open-ended "ask everything you might need" pattern with a soft priority list, a numeric cap (< 10 questions), an allowlist of "key data points" that can push the cap, and a narrower enumeration rule. Audience emphasis (non-technical users) is reinforced via a top-of-prompt banner and inline reminders. Ships as **prompt v16** on top of R1's v15. Adds minimal Pino-only telemetry to validate cap behaviour post-rollout.

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

- As a **non-technical user** describing an agent, I want Phase 2 to ask only what truly matters (how it should work, what to do on failure, and where the data lives) so that I am not interrogated.
- As a **non-technical user**, I want the system to assume sensible defaults instead of asking me about field-level mappings, formatting preferences, and edge cases.
- As a **TL / SA observing rollout**, I want minimal telemetry on carve-out firing and per-session question count so that I can verify the tone-down is actually working without building dashboards.
- As a **Dev maintaining the prompt**, I want a clean version line (v15 → v16) so attribution between R1 and R2 stays clean and bisecting is trivial.

---

## Functional Requirements

### FR1 — Question cap shape (soft priority list + numeric guidance)
The prompt MUST instruct the LLM to:

1. Always ask the two **must-ask** items if they are not already explicit in the user's prompt:
   - **(a)** How the user expects the agent to work (the operational shape / trigger / flow).
   - **(b)** What to do on failure (the failure-path / fallback).
2. Stay under **10 questions total** across initial enhancement + any refinement round, unless a "key data point" (see FR4) is still missing.

### FR2 — Cap scope (cumulative + max one refinement round)
3. The < 10 cap is **cumulative** across the initial Phase 2 message AND any refinement round.
4. **Maximum one refinement round** is permitted in Phase 2.

### FR3 — Phase 3 scoring untouched
5. The Phase 3 `clarityScore` / `confidence` rubric MUST remain unchanged. R2 relies on FR2's hard cap to neutralise chasing behaviour. Scoring stays as an observability/telemetry signal.

### FR4 — "Key data points" allowlist (strict)
6. The only categories that may push the question count past the soft target are:
   1. **Trigger source / schedule** — when does it run?
   2. **Primary resource identifier** — which sheet / folder / inbox / DB?
   3. **Failure-action target** — where do errors go (Slack channel, email, log sheet)?
7. Anything **outside** the allowlist (field-level mappings, formatting preferences, edge-case behaviour, secondary filters) MUST default or be inferred in Phase 3 — NOT asked.

### FR5 — Enumeration rule (lines 249-258, soften to conditional)
8. Rewrite the existing "MANDATORY ENUMERATION RULE" so enumeration is only triggered when the item category IS the **primary resource identifier** (allowlist #2).
9. Include contrasting examples in the prompt:
   - "save to Notion" → ask which DB (allowed; primary resource).
   - "Summarize 10 emails" → do NOT enumerate which emails (not primary resource; inferred from trigger).

### FR6 — Failure-handling question (deterministic gate)
10. Skip the failure-handling question **only** if the user's prompt contains an explicit failure-path phrase: `if none`, `on error`, `otherwise`, `if it fails`, `if empty` (case-insensitive).
11. Otherwise ask the failure-handling question. This is a deterministic gate, not a judgement call.

### FR7 — Phase 2 example output replacement
12. Replace the current 7-question receipt-validation example output with **two contrasting examples**:
    - **Example A** — Prompt missing trigger + failure path → 2-3 questions emitted.
    - **Example B** — Prompt with "every morning" and "if none, skip" → 0-1 questions emitted (carve-outs fire and suppress).
13. Examples MUST visibly demonstrate the allowlist + the skip carve-outs in action.

### FR8 — Versioning
14. R2 ships as **prompt v16**. v15 (R1 only) ships first; v16 (R1 + R2) ships after. v16 layers on top of v15, preserving R1's Phase 4 removal.

### FR9 — Theme grouping (line 266 — Inputs/Processing/Outputs/Delivery)
15. Convert themes from drivers of questioning into a **final coverage checklist**: after priority-driven question selection, the LLM checks each theme; if a theme is completely unaddressed AND non-obvious from context, it MAY add one targeted question — and that question counts toward the cap.

### FR10 — ENUMERATION CHECK gate (lines 289-295)
16. Rewrite this gate to match FR5's narrower trigger. Keep the gate's strong forcing-function structure but trigger ONLY when the unenumerated category IS the primary resource identifier.
17. Add contrasting examples in the gate:
    - "my 5 clients" → enumerate.
    - "important emails" → do NOT enumerate ("important" is a filter, not an identifier).

### FR11 — Non-technical user emphasis
18. Add a top-of-prompt **AUDIENCE banner** that explicitly states the user is non-technical.
19. Add inline audience reminders at each carve-out gate: TRIGGER, RESOURCE, FAILURE, ENUMERATION.
20. Budget: ~50 tokens total. The reminders MUST appear exactly where the LLM is most likely to drift technical.

### FR12 — Minimal Pino telemetry
21. Emit a single structured Pino log line per Phase 2 session containing at minimum:
    - `carveOutFired` (object/array of which carve-outs fired in this session)
    - `questionCount` (final emitted question count)
    - `correlationId`
22. No DB schema changes. No UI. No dashboards. Target: ~10 LoC.

### FR13 — Branching & Merge Workflow
23. All R2 development MUST happen on a dedicated feature branch (e.g. `feature/v2-agent-creation-r2-prompt-tone-down`). Direct commits to `main` are NOT permitted under any circumstances.
24. Merge to `main` is gated on ALL of the following, in order: (a) SA code review approved, (b) QA test report passes (all acceptance criteria below verified), (c) user explicitly approves the merge in the same session.
25. Merge strategy: `--no-ff` so the merge commit is preserved as a clear rollback boundary.
26. R2 MUST NOT be merged to `main` before R1 (v15) has been merged. R2's v16 prompt layers on top of R1's v15 file.

---

## Non-Functional Requirements

| Concern | Requirement |
|---|---|
| Performance | Prompt size growth from FR11 banner/reminders must stay within ~50 tokens. No new LLM calls. |
| Observability | Pino-only; structured log; non-blocking; correlationId-scoped. |
| Backwards compatibility | v15 prompt file remains in repo as R1 baseline. v16 is additive (new file). |
| Determinism | FR6 (failure carve-out) and FR10 (enumeration gate) MUST be deterministic — keyword/phrase-based, not LLM-judgement based, at the prompt-instruction level. |
| Audience safety | FR11 banner + inline reminders MUST be visible enough that the LLM does not drift technical mid-question. |

---

## Acceptance Criteria

- [ ] `Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` exists and is selected by the Phase 2 enhanced-prompt code path.
- [ ] v16 contains: soft priority list (FR1), < 10 cumulative cap + max 1 refinement (FR2), allowlist of 3 categories (FR4), softened enumeration rule with contrasting examples (FR5), deterministic failure-skip gate with explicit phrase list (FR6), two contrasting Phase 2 example outputs (FR7), themes as final coverage checklist (FR9), narrowed ENUMERATION CHECK gate (FR10), top-of-prompt AUDIENCE banner + inline reminders at TRIGGER/RESOURCE/FAILURE/ENUMERATION (FR11).
- [ ] Phase 3 `clarityScore` / `confidence` code path is unchanged.
- [ ] Pino telemetry log line emitted once per Phase 2 session with `carveOutFired`, `questionCount`, `correlationId` (FR12).
- [ ] v15 prompt file remains in repo as R1 baseline.
- [ ] v16 prompt and route changes ship in the same PR.
- [ ] Existing regression scenarios pass.
- [ ] New "tone-down validation" regression scenario passes.
- [ ] Question counts in regression runs visibly decrease vs v15 baseline (captured in PR description).
- [ ] No new feature flag introduced (v16 is the new default for non-experimental flow; R3's experimental mode is gated separately).
- [ ] All commits are on a `feature/...` branch — no commits to `main` outside the final approved merge.
- [ ] Merge to `main` happens only after SA approval + QA pass + explicit user approval, using `--no-ff`.
- [ ] R1 (v15) is already merged to `main` before R2 is merged.

---

## Out of Scope / Future Roadmap

- Full schema-based telemetry (DB tables, dashboards, per-carve-out aggregates) — explicitly deferred; was overscoped.
- Reworking Phase 3 scoring or clarity rubric — out of scope; FR2's hard cap is the safety mechanism.
- Single-question-per-turn mode — that is R3 (experimental, feature-flag gated).
- Plugin-specific question logic — explicitly prohibited under [Platform Design Principles / No Hardcoding in System Prompts](/CLAUDE.md).
- Removing or further narrowing the allowlist of 3 categories — deferred until post-rollout telemetry justifies it.

---

## Open Questions

- [ ] None at requirement-approval time. (All Q1–Q12 resolved during scoping — see Decisions table.)

---

## Notes on Integration Points

| System | Impact |
|---|---|
| `app/api/prompt-templates/` | New file `Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` added. v15 remains as R1 baseline. |
| `app/api/agent-creation/process-message/route.ts` | Phase 2 branch selects v16 prompt. Emits Pino telemetry log line at session exit (FR12). |
| Pino logger | One new structured log statement (`carveOutFired`, `questionCount`, `correlationId`). No new logger module. |
| AI Provider Factory | No changes. Continues to be used as singleton. |
| Phase 3 (`clarityScore` / `confidence`) | Untouched (FR3). |
| Regression test harness (`tests/v6-regression/...` patterns) | New "tone-down validation" scenario added. Existing scenarios re-run as baseline-vs-v16 comparison. |
| R1 (v15) | R2 layers on top of R1. v15 must already be in place before v16 ships. |
| R3 (v17) | R3 is experimental, gated behind a feature flag. v16 remains the stable fallback when the R3 flag is off. |

---

## Decisions

The following decisions were captured during requirement scoping. Each Q corresponds to a clarifying question raised by the BA and answered by the user.

| ID | Question | Decision |
|---|---|---|
| Q1 | Cap shape | Combination — soft priority list (must-ask = (a) how user expects it to work, (b) what to do on failure) + numeric guidance "< 10 questions, unless key data points are still missing". |
| Q2 | Cap scope | Cumulative cap < 10 across initial + all refinement rounds, AND maximum 1 refinement round. |
| Q3 | Phase 3 scoring | Leave `clarityScore` / `confidence` rubric untouched. Q2's hard cap neutralises chasing behaviour; score remains as observability/telemetry signal. |
| Q4 | "Key data points" carve-out | Strict allowlist — only three categories: (1) trigger source / schedule, (2) primary resource identifier, (3) failure-action target. Anything else defaults or is inferred. |
| Q5 | MANDATORY ENUMERATION RULE (lines 249-258) | Soften to conditional. Only enumerate when item category IS the primary resource identifier (allowlist #2). Examples: "save to Notion" → ask which DB (allowed); "Summarize 10 emails" → do NOT enumerate which emails. |
| Q6 | Failure-handling question | Skip only if explicit failure-path phrase present (`if none`, `on error`, `otherwise`, `if it fails`, `if empty`). Otherwise ask. Deterministic gate. |
| Q7 | Phase 2 example output | Replace 7-question receipt-validation example with TWO contrasting examples — A: missing trigger + failure → 2-3 questions; B: "every morning" + "if none, skip" → 0-1 questions. |
| Q8 | Versioning | Sequential. v15 = R1 only (ships first); v16 = R1 + R2 (ships later). R2 layers on top of v15. |
| Q9 | Theme grouping (line 266) | Hybrid — priorities drive ordering/selection; themes become final coverage checklist. If a theme is unaddressed AND non-obvious, add ONE targeted question (counts toward cap). |
| Q10 | ENUMERATION CHECK gate (lines 289-295) | Rewrite gate to match Q5's narrower trigger. Keep gate structure (strong forcing function) but trigger ONLY when unenumerated category IS primary resource identifier. Add contrasting examples ("my 5 clients" → enumerate; "important emails" → do NOT). |
| Q11 | Non-technical user emphasis | Top-of-prompt AUDIENCE banner + inline reminders at each carve-out gate (TRIGGER / RESOURCE / FAILURE / ENUMERATION). ~50 tokens cost. |
| Q12 | Telemetry | Minimal Pino-only telemetry. ~10 LoC, no schema changes, no UI/dashboards. Log per session: carve-out fired/not-fired + question count + correlationId. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-24 | Initial draft | BA captured requirement, user answered Q1–Q12, document drafted. |
| 2026-05-24 | Added Branching & Merge Workflow | Added FR13 (FR23–FR26) + acceptance criteria for feature-branch development, gated merge to `main`, and ordering constraint (R1/v15 merged before R2/v16). |
