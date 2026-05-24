# Requirement: V2 Agent Creation — R1 Phase 4 Cleanup

> **Last Updated**: 2026-05-24

**Created by:** BA
**Date:** 2026-05-24
**Status:** Draft
**Sequence:** R1 of 3 (R1 ships first; [R2](/docs/requirements/V2_AGENT_CREATION_R2_PROMPT_TONE_DOWN_REQUIREMENT.md) layers on R1; [R3](/docs/requirements/V2_AGENT_CREATION_R3_SINGLE_QUESTION_MODE_REQUIREMENT.md) is experimental and follows R2)

---

## Overview

Remove Phase 4 ("Technical Validation / Schema Services") from the V2 Thread-Based Agent Creation flow entirely. Phase 4 was never wired into the frontend and adds dead-code surface across the prompt template, API route, type system, validation schema, helper utility, and architectural docs. This requirement defines a full, single-PR hard cutover that collapses the visible flow to 3 phases (Describe → Review Plan → Save) and ships as **prompt v15**.

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

- As a **non-technical user creating an agent**, I want to see a clean 3-step flow (Describe → Review Plan → Save) so that I am not exposed to dead/internal phases.
- As a **Dev maintaining the agent-creation pipeline**, I want Phase 4 fully removed from prompt, route, types, validation, helpers, and docs so that I never have to reason about an unwired phase again.
- As a **user with a legacy thread stuck at `current_phase = 4`**, I want the system to gracefully recognise that thread as completed so that I am not blocked.
- As an **SA reviewing the agent-creation surface**, I want `ThreadPhase` narrowed to `1 | 2 | 3` so that the type system enforces the new contract.

---

## Functional Requirements

### Layer A — Prompt template
1. From `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt`, remove all Phase 4 content (~270 lines at 622-895) and every reference to Phase 4 in the overview / principles / constraints sections.
2. Save the resulting prompt as a new file using the **v15** naming convention (Phase 4 removed; all other v14 content preserved verbatim).

### Layer B — API route
3. In `app/api/agent-creation/process-message/route.ts`:
   - Remove the Phase 4 branch (lines 358-417).
   - Remove Phase 4 validation block (lines 628-660).
   - Remove Phase 4 logging block (lines 693-704).
   - Remove the Phase 4 status logic (lines 747-755).
   - Ensure the route only routes to Phase 1, 2, or 3 branches.

### Layer C — Types
4. In `components/agent-creation/types/agent-prompt-threads.ts`:
   - Narrow `ThreadPhase` from `1 | 2 | 3 | 4` to `1 | 2 | 3`.
   - Delete the following types entirely: `SchemaService`, `SchemaServiceAction`, `TechnicalWorkflowStep`, `OperationStep`, `TransformStep`, `ControlStep`, `TechnicalInputRequired`, `Feasibility`, `BlockingIssue`, `FeasibilityWarning`, `Phase4Metadata`, `Phase4MetadataExtension`.
   - Remove the following fields from request/response types: `schema_services`, `technical_inputs_collected`, `technical_workflow`, `technical_inputs_required`, `feasibility`.

### Layer D — Validation schema
5. Delete `lib/validation/phase4-schema.ts` entirely.

### Layer E — Helper utility
6. Delete `lib/utils/schema-services-generator.ts` entirely.

### Layer G — Docs
7. In `docs/V2_Thread-Based-Agent-Creation-Flow.md`:
   - Remove the "Phase 4 NOT WIRED IN FRONTEND" section.
   - Remove the Phase 4 entry from the state table.
   - Update flow diagrams to show only Phase 1, 2, 3.

### User-facing copy / UI
8. The frontend stepper MUST show exactly 3 visible phases labelled (final naming at Dev's discretion but conceptually): Describe, Review Plan, Save.
9. No "Validation" label is to appear in the stepper. Any server-side validation runs inline within Phase 2/3 and surfaces as inline errors — never as a phase.

### Legacy data handling (no migration)
10. On thread read, if `current_phase === 4` in the persisted row, coerce it to `3` and mark the thread as `completed` in the response payload.
11. The user-facing rendering for a coerced thread MUST show a "this thread is already done" state (read-only, no actions to advance the phase).
12. No DB migration is performed. The read path is solely responsible for defensive coercion.

### Rollout
13. Hard cutover. Single PR. No feature flag.
14. Rollback procedure = revert the PR.

### Branching & Merge Workflow
15. All R1 development MUST happen on a dedicated feature branch (e.g. `feature/v2-agent-creation-r1-phase4-cleanup`). Direct commits to `main` are NOT permitted under any circumstances.
16. Merge to `main` is gated on ALL of the following, in order: (a) SA code review approved, (b) QA test report passes (all acceptance criteria below verified), (c) user explicitly approves the merge in the same session.
17. Merge strategy: `--no-ff` so the merge commit is preserved as a clear rollback boundary.

---

## Non-Functional Requirements

| Concern | Requirement |
|---|---|
| Performance | No measurable regression in Phase 1/2/3 latency. Removing Phase 4 should marginally reduce prompt size and route branching cost. |
| Security | No change to auth or RLS. Legacy thread coercion does not bypass `user_id` filtering. |
| Accessibility | Stepper must communicate progress to screen readers across the 3 visible phases. |
| Type safety | TypeScript strict mode passes after narrowing `ThreadPhase`. No new `any` introduced. |
| Backwards compatibility | Legacy rows with `current_phase = 4` must continue to load without error. |
| Logging | Phase 4 references removed from Pino logs; no orphan log statements. |

---

## Acceptance Criteria

- [ ] Phase 4 content entirely absent from `Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` (new file).
- [ ] `process-message/route.ts` has zero references to Phase 4 (branch, validation, logging, status).
- [ ] `ThreadPhase` is narrowed to `1 | 2 | 3` in `agent-prompt-threads.ts` and all listed Phase 4 types are deleted.
- [ ] `lib/validation/phase4-schema.ts` does not exist.
- [ ] `lib/utils/schema-services-generator.ts` does not exist.
- [ ] `docs/V2_Thread-Based-Agent-Creation-Flow.md` no longer references Phase 4.
- [ ] Frontend stepper renders exactly 3 visible phases; no "Validation" label appears.
- [ ] Legacy `current_phase = 4` thread is coerced to `3` and marked `completed` on read; the UI displays a "this thread is already done" state.
- [ ] No DB migration is included in the PR.
- [ ] Existing test suite passes.
- [ ] New test added: a thread fixture with `current_phase = 4` is coerced/completed on read and renders the done-state in UI tests.
- [ ] PR description documents rollback procedure (single revert).
- [ ] All commits are on a `feature/...` branch — no commits to `main` outside the final approved merge.
- [ ] Merge to `main` happens only after SA approval + QA pass + explicit user approval, using `--no-ff`.

---

## Out of Scope / Future Roadmap

- DB migration to rewrite legacy `current_phase = 4` rows is NOT in scope; defensive read coercion is sufficient.
- Re-introducing technical validation as a distinct phase is explicitly out of scope. If validation logic is needed in the future it must live inline within Phase 2/3, not as a separate phase.
- Reworking the visible stepper labels beyond removing "Validation" is out of scope (label polish is a separate UX task).
- R2 and R3 work is tracked in their own MDs and is sequential to this one.

---

## Open Questions

- [ ] None at requirement-approval time. (Layer F — DB — was explicitly removed from scope by the user; legacy rows handled in read path per FR10-12.)

---

## Notes on Integration Points

| System | Impact |
|---|---|
| `app/api/prompt-templates/` | New file `Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` added (v14 retained for reference / R2 baseline). |
| `app/api/agent-creation/process-message/route.ts` | Phase 4 code paths removed. |
| `components/agent-creation/types/agent-prompt-threads.ts` | `ThreadPhase` narrowed; Phase 4 types and fields deleted. |
| `lib/validation/phase4-schema.ts` | File deleted. |
| `lib/utils/schema-services-generator.ts` | File deleted. |
| `docs/V2_Thread-Based-Agent-Creation-Flow.md` | Phase 4 sections removed. |
| `agent_prompt_threads` table | Not modified. Read path coerces legacy `current_phase = 4` defensively. |
| Frontend stepper component(s) consuming `ThreadPhase` | Must compile cleanly against the narrowed `1 | 2 | 3` union. |

---

## Decisions

The following decisions were captured during requirement scoping. Each Q corresponds to a clarifying question raised by the BA and answered by the user.

| ID | Question | Decision |
|---|---|---|
| Q1 | Depth of cleanup | Full nuke across layers A–E and G (no DB migration — layer F handled in Q3). |
| Q2 | User-facing copy | Option A — silent collapse. Stepper shows 3 visible phases (Describe → Review Plan → Save). No "Validation" label. Server-side validation runs inline within Phase 2/3 and surfaces as inline errors. |
| Q3 | Legacy `current_phase = 4` rows | On read, coerce `4 → 3` and mark thread as `completed`. User sees "this thread is already done" state. No DB migration; read path handles it defensively. |
| Q4 | Rollout strategy | Hard cutover, single PR, no feature flag. Rollback = revert PR. |
| Versioning | Prompt version designation | R1 ships as prompt v15 (Phase 4 removed; everything else preserved from v14). Decision aligned with R2 Q8. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-24 | Initial draft | BA captured requirement, user answered Q1–Q4 + versioning, document drafted. |
| 2026-05-24 | Added Branching & Merge Workflow | Added FR15–FR17 + acceptance criteria for feature-branch development and gated merge to `main`. |
