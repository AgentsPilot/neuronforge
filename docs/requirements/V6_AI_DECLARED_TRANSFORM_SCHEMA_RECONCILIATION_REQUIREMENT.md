# Requirement: V6 Field-Fidelity & Calibration Hardening (Gmail Expense Attachment RCA)

**Created by:** BA
**Date:** 2026-07-09
**Last Updated:** 2026-07-13
**Status:** Draft (pending SA review)

## Overview

This is the **single consolidated requirement** covering every failure mode uncovered in the Gmail-expense-attachment root-cause investigation. It spans three concern areas: (1) the V6 pipeline's failure to enforce plugin-real field names / shapes / wiring through generated steps (the true root cause of the real bug — `mimeType` vs `mime_type`, plus new instances found in the live re-runs); (2) a latent out-of-range generated parameter value; and (3) several calibration detection/verdict/coverage weaknesses that let real defects stay dormant while a cosmetic nag flipped the verdict. The RCA is the source of truth; this document converts it into clearly-numbered, independently-workplannable scoped items — it does **not** re-diagnose.

> **Source of truth (do not re-diagnose):** [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md). Key sections mapped to items below: "Role of the Workflow Data Schema object" (Item 1), "Regression analysis" (Item 2), "Should the compiler have caught this?" (Item 3), "The hardcoded 500" (Item 4), "Why calibration cannot catch this" + §7-8 (Items 5-6), "Origin of the empty attachment list" (Item 6b), **"Live Re-run RCA (2026-07-11) — post Phase 0/1"** (Items 8-10 + the Item 6 coverage-floor extension), **"Live Re-run #2 RCA (2026-07-11) — blank columns + coverage-floor strictness"** (Item 11 + the Item 6 both-direction coverage-floor redesign), **"Addendum — 2026-07-13"** (backlog D9-D10).

## North-Star Success Criterion

> **The user's overarching goal — this requirement is only "done" when this is true.** A live end-to-end calibration run of agent `0ee53785` produces **BOTH**:
> 1. **A POPULATED expense report** — real `amount` / `vendor` / `date` / `from` / `subject` / `filename` values, **not blank rows or blank columns**; and
> 2. **An honest passing verdict** — a genuine `passed`, earned because the real path actually ran and carried real data, **never a false green**.
>
> **Progress (as of Re-run #2, 2026-07-11):** the Phase 0/1 field-name fix cleared the filter (13 PDFs kept), the object-handoff/resolver fix cleared extraction (13 rows now carry **real vendor/amount/date** — e.g. Wolt ILS 99.90, Expedia USD 232.96), and Finding 3's flatten carry-forward is **confirmed working at runtime**. Two things still block the clean pass:
> - **Blank From / Subject / Filename columns** — a step7 AI-row-builder input-wiring gap (**Item 11**, Phase 3 generation, fix LATER). The data is present on the item; the AI step just isn't handed it.
> - **A coverage floor that wrongly caps send-terminating agents to `inconclusive`** — folded into **Item 6** (calibration, fix NOW).
>
> `0ee53785` reaches a clean pass only once **BOTH Item 11 (Phase 3) and the Item 6 coverage-floor redesign (now)** land.

## Consolidated Implementation Backlog (2026-07-12)

> **This is the single authoritative, prioritized to-do list going forward.** Every remaining piece of work has a stable backlog ID here. Rows either **map to** a detailed scoped Item (1-11) below — read that Item for full evidence/AC — or are **NEW** items introduced here (marked NEW) with a short testable acceptance line. Groups are ordered by value.
>
> **Recommended delivery sequence:** **Group A → Group C → Group B → Group D** (D6 may be pulled forward if existing-agent self-heal is wanted sooner; the D9/D10 hotfixes are pullable-forward too). This supersedes the earlier phase tags where they conflict; the phase tags on Items 1-11 remain valid as per-item context.
>
> **Process per group (unchanged):** Dev → SA code review → **USER reviews the code (after SA approves, before QA)** → QA → user approval → RM. Each group is delivered as one coherent workplan through this gate chain.

### Group A — Unblock calibration finish (HIGHEST value; helps all agents, old + new). One coherent workplan.

| ID | What / fix plan | Owner | Risk | Maps to |
|---|---|---|---|---|
| **A1** (NEW) | **Wizard dead-end.** Re-enable the commented-out `setFlowState('success')` transitions (sandbox `page.tsx` ~L605 / ~L936) so the finish screen renders; add an explicit "keep as-is & finish" action so a run with only cosmetic issues can complete; gate on verdict so blocking issues cannot finish. | calibration UI | Low-Med | new (UI) |
| **A2** (NEW) | **Coverage floor still caps send-terminating agents.** FIRST verify whether Phase 1.6's `deriveCoverageSignal` actually receives real pre-delivery data from `execution_summary` (suspected wiring gap — unit tests passed but it still caps live on `0ee53785`). If so, feed the real last-pre-delivery payload in so a genuinely-populated report reaches `exercisedRealPath=true`. Preserve the false-green guard. | calibration verdict/coverage | Med | Item 6 (both-direction floor) |
| **A3** (NEW) | **Cosmetic-only run → "passed (with suggestions)".** When 0 blocking/critical + only provably-cosmetic user-confirm-only issues remain AND A2 holds, present as `passed` with suggestions surfaced (not `needs_review`). A tight allow-list is the safety requirement. Depends on A2. | calibration verdict | Med | Item 6a / G1b |

**Acceptance criteria (Group A):**
- **A1:** a run with 0 blocking + only cosmetic issues can reach a completed/finished state via the UI (and a run with any blocking issue cannot finish).
- **A2:** a populated send-terminating report reaches `passed`; an all-blank one still cannot — **verified on REAL execution data, not just fixtures.**
- **A3:** a successful run whose only remaining issue is the cosmetic hardcode reads as `passed`; a run with any blocking/actionable issue never does.

### Group B — Generation correctness-at-source (robustness; the runtime/calibration safety nets already cover these).

| ID | What / fix plan | Owner | Risk | Maps to |
|---|---|---|---|---|
| **B1** | Durable field-name reconciliation at generation: Phase-2 `DataSchemaBuilder` post-pass snapping `ai_declared` transform field names to the producer's real names (dotted-path resolver), reusing the shared `lib/schema-reconciliation/` core; ambiguous → leave untouched. | v6-pipeline | Med-High | **Item 1 (Gap A)** |
| **B2** | Compiler O10a dotted-path fix + extend to bare `condition.field` literals; consolidate `normalizeForFuzzy` onto the shared core. | v6-pipeline | Med | **Item 2 (Gap B)** |
| **B3** | Generation-side extraction binding `.data → file_content` / `.mimeType` / `.filename` via plugin `x-semantic-type` annotations (never plugin-name/fuzzy); un-annotated plugins deferred. | v6-pipeline | Med | **Item 8 (generation slice)** |
| **B4** | Generation-side flatten parent-field carry: reference the carried `from`/`subject`/`date` names at generation. | v6-pipeline | Low-Med | **Item 9 (generation slice)** |

### Group C — The 500 / param-value correctness at generation.

| ID | What / fix plan | Owner | Risk | Maps to |
|---|---|---|---|---|
| **C1** | At generation, validate every generated plugin-param literal against the plugin's declared `min`/`max`/`enum` (`500>100` → clamp or flag), reusing batch-2's constraint reader; **PLUS** fix the schema/vocabulary summary shown to the generation LLM to INCLUDE the declared `maximum` (currently omitted — a root contributor per the RCA "Origin of the 500" section). | v6-pipeline | Low | **Item 4 (compile-time advisory)** + new Guard A |
| **C2** (NEW) | **Auto-parameterize invented literals.** Detect a param value NOT derivable from the user's creation inputs and deterministically promote it to a config parameter with a sensible default (sidesteps WP-40 because the agent doesn't exist yet). | v6-pipeline | Med | new (Guard B) |

**Acceptance criteria (Group C):**
- **C1:** a generated out-of-range literal is caught at generation, AND the model's schema summary shows `min` AND `max`.
- **C2:** a generated literal the user never specified becomes a declared config parameter, not a bare literal.

### Group D — Hardening / debt / follow-ups (LOW urgency, except the D9/D10 hotfixes).

| ID | What / fix plan | Owner | Risk | Maps to |
|---|---|---|---|---|
| **D1** (NEW) | Regression suite: add a content/data-quality bar to the Phase E success criterion + a real-runtime extraction scenario (closes the content-blind coverage gap). | QA | Low | Out-of-Scope note (regression-suite gap) |
| **D2** (NEW) | `StepExecutor.ts` — 30 pre-existing `console.*` → Pino (dedicated pass, per CLAUDE.md logging standard). | v6-pipeline / owner of file | Low | new (debt) |
| **D3** (NEW) | `AIOperationResolver.ts` — 3 `console.*` (off-path legacy) → Pino. | v6-pipeline | Low | new (debt) |
| **D4** (NEW) | Compiler `additional_inputs` re-validation hardening (SA 3A follow-up). | v6-pipeline | Low-Med | new (SA 3A follow-up) |
| **D5** (NEW) | Coverage-signal un-inspectable-data hardening (SA 1.6 follow-up). | calibration | Low-Med | Item 6 (follow-up) |
| **D6** (NEW) | Generalize Item 11 into the calibration corrector so existing broken agents self-heal on recalibration instead of needing the one-off script. | calibration | Med | Item 11 / Item 7 |
| **D7** (NEW) | Script log wording ("Would inject" shows even in apply mode) — trivial cosmetic. | v6-pipeline | Trivial | new (cosmetic) |
| **D8** (**✅ Implemented 2026-07-13** — commit hash to follow) | **Security sweep — owner-scope all `agents` writes in the calibrate routes.** Multiple owner-UNSCOPED `agents` updates (missing `.eq('user_id', …)`) exist across the calibration API — a recurring violation of the mandatory repository/`user_id`-scoping rule. Over this cycle the pattern surfaced FOUR times: two in the batch route (already fixed — the Item 7 corrector write + the verdict-relaxation write), one in `apply-fixes/route.ts` L1320 (fixed in Group A), and at least one still-open PRE-EXISTING instance at `app/api/v2/calibrate/batch/route.ts` ~L4657 (the zero-issue clean-pass `production_ready` write). Fixing them one-at-a-time as lines are touched isn't working — it needs a dedicated sweep. **Fix plan:** audit EVERY `agents` write (`.from('agents').update/insert/upsert`) under `app/api/v2/calibrate/**` (batch, apply-fixes, and any others) and ensure each is owner-scoped with `.eq('user_id', …)` OR routed through `AgentRepository` (repository pattern); add a regression guard (grep/lint check or code-review checklist note). Relates to the two batch writes + the apply-fixes write already fixed and to the standing repository/`user_id` mandatory rule. | calibration | Low | new (security debt) |
| **D9** (NEW · **HOTFIX** · **✅ Implemented 2026-07-13** — commit hash to follow) | **Calibration emails have no plaintext part (some clients render raw text instead of HTML).** Both calibration senders — `lib/calibration/calibrationResultEmail.ts` (user-facing result email) and `lib/calibration/calibrationAdminAlert.ts` (internal RCA alert) — build full HTML and pass it ONLY as `html`; the shared transport (`lib/.../emailTransport.ts` ~L61-66 Resend / L104-109 nodemailer; `NotificationService.ts` ~L408) sends single-part `text/html` with NO plaintext alternative, so the message renders as raw text in some clients/paths (the user saw one email as text, one as HTML — a delivery artifact, not authored). NOT a "one sender uses text" bug — neither sender sets a `text` part at all. **Fix plan:** send proper `multipart/alternative` — thread a `text` field through the transport and auto-generate a plaintext version from the HTML in ONE place (the transport), so every provider sends `{ html, text }`. Pre-existing; surfaced by the Group A live test. | calibration (notification surface: transport + the two senders) | Low | new (pre-existing hotfix) |
| **D10** (NEW · **HOTFIX** · **✅ Implemented 2026-07-13** — commit hash to follow) | **"Make it a reusable parameter" succeeds server-side but the UI gives no confirmation and the suggestion doesn't clear.** The success-screen button → `handleWizardComplete` (`app/v2/sandbox/[agentId]/page.tsx` ~L1056) → `/api/agents/{id}/repair-hardcode`, which DOES succeed (rewrites the hardcoded value → `{{input.…}}` in `pilot_steps`, adds the param to `input_schema`, upserts `agent_configurations`). But the UI never reflects it: (a) the success-screen suggestion list (`passSuggestions` ← cached verdict `result.issues.warnings` via `getPassSuggestions`) is never recomputed/cleared by `handleWizardComplete`; (b) `loadAgent`'s re-detection (~L302-305) has no else-branch to clear state when no hardcodes remain, so `hasHardcodedValues` stays true; (c) no success toast/transition. The user sees the SAME suggestion with no indication it worked (it did). **Fix plan (UI only — endpoint needs no change):** on repair success, clear the now-resolved suggestion + reset the detection state (add the missing else-branch at ~L302-305) + show a success affordance (toast/transition). Pre-existing flow that Group A's FIX 2 button newly exposed. | calibration sandbox UI (`page.tsx`) | Low | new (pre-existing hotfix) |
| **D11** (NEW) | **Route all calibration-route `agents` writes through `AgentRepository` (repository-pattern refactor).** The calibrate API routes write to the `agents` table via DIRECT `supabase.from('agents').update()` calls at ~10 points (batch route ~8 writes, rollback route 1, apply-fixes 1) — a violation of the mandatory repository-pattern rule (CLAUDE.md: all DB access via `lib/repositories/`; no direct Supabase in routes). D8 added `.eq('user_id', …)` owner-scoping to close the SECURITY gap, but the writes remain DIRECT queries; the pattern debt is unaddressed. **Root cause:** `AgentRepository.update()`'s `UpdateAgentInput` type historically didn't cover the calibration columns (`pilot_steps`, `input_schema`, `is_calibrated`, `production_ready`, `workflow_hash`, `calibration_status`), so the loop used one-off direct writes instead of extending the repo. **Fix plan:** route every `agents` write under `app/api/v2/calibrate/**` through `AgentRepository` — most write the corrected `pilot_steps` → use existing `updatePilotSteps(agentId, userId, steps)`; the clean-pass write → `setProductionReady(...)`; add small purpose methods for shapes not yet covered (e.g. the `workflow_hash`-only write). Verify each write's exact column set maps to a repo method; extend `AgentRepository` following its conventions (RepositoryResult return, structured logging, owner-scoping, soft-delete guard). Remove the direct `.from('agents').update()` calls; add a regression guard (grep/CI or review-checklist) so no new direct `agents` writes appear in the calibrate routes. **Relates to D8** (owner-scoping half); D11 completes the pattern half. **Do on a CLEAN working tree with full test coverage** (not stacked on concurrent-team contamination). | calibration + `AgentRepository` | **Med** | new (repository-pattern debt) |

**Acceptance criteria (Group D):**
- **D1:** a scenario whose extraction path is empty/untested/fabricated is NOT recorded as `phase_e_success: true`; at least one real-runtime extraction scenario exists.
- **D2:** `StepExecutor.ts` uses `createLogger`/Pino for all logging; no `console.*` remains.
- **D3:** `AIOperationResolver.ts` uses Pino; no `console.*` remains.
- **D4:** compiler re-validates `additional_inputs` after injection; a malformed/missing injected input is caught, not silently passed.
- **D5:** when the coverage signal cannot inspect delivered data, the verdict is a conservative non-pass (never a clean `passed`).
- **D6:** re-calibrating an existing agent with the Item 11 wiring gap repairs it in place (no one-off script needed).
- **D7:** the script log reads correctly in both dry-run and apply modes.
- **D8:** no `agents` write under `app/api/v2/calibrate/**` lacks `user_id` scoping (or repository routing); the known open instance at `batch/route.ts` ~L4657 is fixed; a repeatable check (grep/CI) confirms none remain. **(✅ Implemented 2026-07-13.)**
- **D9:** every calibration email (result + admin alert) is delivered as `multipart/alternative` with both an HTML and a plaintext part; renders as HTML in standard clients. **(✅ Implemented 2026-07-13.)**
- **D10:** after a successful parameterization, the user gets a clear success indication and the resolved hardcode suggestion disappears (state reflects the applied change). **(✅ Implemented 2026-07-13.)**
- **D11:** zero direct `supabase.from('agents').update|insert|upsert` remain under `app/api/v2/calibrate/**`; every agent write goes through `AgentRepository`; behavior is byte-for-byte preserved (verified by tests); a repeatable check confirms no direct agent writes remain.

### Backlog → Item ID map (single reference)

| Backlog ID | Existing Item |
|---|---|
| A1 | NEW (calibration UI) |
| A2 | Item 6 (coverage floor — verify/wire real pre-delivery data) |
| A3 | Item 6a / G1b (cosmetic-only pass) |
| B1 | Item 1 (Gap A) |
| B2 | Item 2 (Gap B) |
| B3 | Item 8 (generation slice) |
| B4 | Item 9 (generation slice) |
| C1 | Item 4 (compile-time advisory) + new Guard A |
| C2 | NEW (Guard B) |
| D1 | Out-of-Scope regression-suite gap |
| D2, D3 | NEW (logging debt) |
| D4 | NEW (SA 3A follow-up) |
| D5 | Item 6 follow-up (SA 1.6) |
| D6 | Item 11 / Item 7 (generalize corrector) |
| D7 | NEW (cosmetic) |
| D8 | **✅ Implemented 2026-07-13** · NEW (security debt — `user_id`-scope calibrate-route `agents` writes) |
| D9 | **✅ Implemented 2026-07-13** · NEW (hotfix — calibration email plaintext/multipart part) |
| D10 | **✅ Implemented 2026-07-13** · NEW (hotfix — parameterize success has no UI confirmation / suggestion doesn't clear) |
| D11 | NEW (repository-pattern debt — route calibrate-route `agents` writes through `AgentRepository`; completes D8) |

## Process / Review Gates

Dev implements this requirement **phase by phase** (see [Implementation Order](#implementation-order-dev-delivery-phases)). After Dev completes a phase, it passes through these gates **before** the next phase starts:

**Dev → SA code-review/approve → USER reviews the code → QA → user approval → RM.**

The key point: after SA approves a phase's code, the **user reviews that code BEFORE QA runs**. Do not hand a phase to QA until the user has reviewed and okayed it. Each phase is a self-contained delivery through the full gate chain.

## Table of Contents

- [North-Star Success Criterion](#north-star-success-criterion)
- [Consolidated Implementation Backlog (2026-07-12)](#consolidated-implementation-backlog-2026-07-12)
- [Process / Review Gates](#process--review-gates)
- [Problem Statement](#problem-statement)
- [Concrete Failing Example](#concrete-failing-example)
- [Priority Ordering (SA value/dependency rationale)](#priority-ordering-sa-valuedependency-rationale)
- [Implementation Order (Dev delivery phases)](#implementation-order-dev-delivery-phases)
- [Cross-Cutting Constraints](#cross-cutting-constraints)
- [G1 — Anti-False-Success Guarantee (top-level)](#g1--anti-false-success-guarantee-top-level)
- [Scoped Items](#scoped-items)
  - [Item 1 — Gap A: Phase-2 field reconciliation (PRIMARY)](#item-1--gap-a-phase-2-field-reconciliation-primary)
  - [Item 2 — Gap B: Phase-5 compiler reconciler dotted-path miss](#item-2--gap-b-phase-5-compiler-reconciler-dotted-path-miss)
  - [Item 3 — Gap C: no plugin-schema oracle anywhere](#item-3--gap-c-no-plugin-schema-oracle-anywhere)
  - [Item 4 — Out-of-range generated param value: runtime clamp-and-warn guard](#item-4--out-of-range-generated-param-value-runtime-clamp-and-warn-guard)
  - [Item 5 — Calibration detector gaps (two)](#item-5--calibration-detector-gaps-two)
  - [Item 6 — Calibration verdict + coverage floor (both-direction, meaningful-data signal)](#item-6--calibration-verdict--coverage-floor-both-direction-meaningful-data-signal)
  - [Item 7 — Calibration-side field-fidelity corrector (in-place fix for existing agents)](#item-7--calibration-side-field-fidelity-corrector-in-place-fix-for-existing-agents)
  - [Item 8 — Plugin→plugin object handoff: bind fields, not whole object (extract input)](#item-8--pluginplugin-object-handoff-bind-fields-not-whole-object-extract-input)
  - [Item 9 — Flatten parent-field carry-forward (From / Subject / Date)](#item-9--flatten-parent-field-carry-forward-from--subject--date)
  - [Item 10 — Surface an all-failed / all-empty step as a visible issue](#item-10--surface-an-all-failed--all-empty-step-as-a-visible-issue)
  - [Item 11 — AI/processing step inside a scatter must receive the loop variable it references](#item-11--aiprocessing-step-inside-a-scatter-must-receive-the-loop-variable-it-references)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Open Questions / Risks](#open-questions--risks)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review — Round 2](#sa-review--round-2-runtime-clamp--calibration-correction)

## Problem Statement

`WorkflowDataSchema.slots` (`lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts`, `WorkflowDataSchema` / `DataSlot`) is designed to be the single shared source of truth so that every generated DSL step references its producer's real object shape. That guarantee is currently only *intended*, not *enforced*: transforms and cross-plugin handoffs can publish or consume field names/shapes that contradict the real producer, and AI steps inside a scatter can reference a loop variable they were never handed — silently breaking downstream steps, with no plugin-schema oracle to catch it. The 2026-07-11 live re-runs confirmed the original flatten→filter recasing bug is fixed and extraction now works, but revealed the SAME class recurring (object-into-scalar wiring; an AI row-builder not given its loop variable) plus calibration blind spots on **both** sides of the coverage floor (too lenient in Re-run #1, too strict in Re-run #2). The RCA also earlier surfaced an out-of-range generated parameter and calibration verdict weaknesses.

The prior mitigation for the field-fidelity class (WP-56, `4724e67`, 2026-06-08) was a **non-deterministic Phase-1 prompt nudge** with the deterministic safety net deferred. This requirement calls for **deterministic** fixes, not further prompt nudges.

## Concrete Failing Example

Agent `0ee53785-44d0-4b46-85dd-367551a657ba` ("Gmail Expense Attachment Table + Total Summary"), created 2026-07-07. Compiled data path and current status:

| Step | Type / op | Relevant detail | Status |
|---|---|---|---|
| step1 | action `google-mail.search_emails` | producer item field is camelCase **`mimeType`**. `max_results: 500` baked in (plugin `maximum:100`) | `500` guard = Item 4 |
| step2 | transform `flatten` | declared item schema used snake_case **`mime_type`** | **fixed** (Phase 0/1) → now `mimeType` |
| step3 | transform `filter` | condition `field: "mime_type"` | **fixed** — now keeps 13 PDFs |
| step5 | action `get_email_attachment` | emits correct PDF object `{filename, mimeType:"application/pdf", size, data}` | ok |
| step6 | action `extract_structured_data` | was wired `file_content:"{{attachment_content}}"` (whole object → octet-stream) | **fixed** (Item 8 resolver slice) → 13 rows carry real vendor/amount/date |
| step7 | `ai_processing` (generate) row-builder | `input: "{{extracted_fields}}"` ONLY; instruction *prose* says "source_email_subject from `attachment_item.subject`" but `attachment_item` is NOT in the step input context | **BLANK From/Subject/Filename columns = Item 11** |
| step14 | action `send_email` | terminal send actually executes (real message sent) but returns a scalar confirmation → `items_delivered` stays 0 → verdict wrongly capped to `inconclusive` | **coverage-floor = Item 6** |

Re-run #2 (2026-07-11): extraction works and rows carry real vendor/amount/date, but the From/Subject/Filename columns are blank (Item 11) and the run is capped to `inconclusive` for a metrics-artifact reason (Item 6). Finding 3's flatten carry-forward is confirmed working at runtime — the attachment item now carries parent `from`/`subject`/`date` and child `filename`; the blanks are a step7 wiring gap, not a data-availability gap.

## Priority Ordering (SA value/dependency rationale)

> **This section captures SA's value-and-dependency reasoning (which fix matters most and why).** It is NOT the Dev delivery sequence. The authoritative delivery sequence is the user-directed [Implementation Order](#implementation-order-dev-delivery-phases) below and the [Consolidated Implementation Backlog](#consolidated-implementation-backlog-2026-07-12) at the top; where they differ, the backlog/Implementation Order governs. The Phase 0 shared-core prerequisite makes the user's order safe (no forward dependency is broken).

- **PRIMARY — the field-fidelity / wiring chain (Items 1-3, extended by Items 8-9, 11).** These are what make the agent actually work. Item 1 (Gap A) is the root cause and durable fix; Item 2 (Gap B) widens the compiler safety net; Item 3 (Gap C) adds the plugin-schema oracle. Items 8-9 and 11 are the SAME family recurring downstream (object-into-scalar handoff; parent-field carry-forward; an AI step not handed its loop variable) — they must be closed for a fully populated report.
- **SECONDARY — hardening + detection quality (Items 4-6, extended by Item 10).** Item 4 is a self-healing runtime guard for out-of-range param values. Items 5-6 + Item 10 are calibration detector/verdict/coverage improvements — they make the verdict honest and surface real defects, but they are not the cure.
- **BACKWARDS-COMPAT / SUCCESSFUL-RUN CLOSER — Item 7, the Item 6 coverage-floor redesign, + the runtime slices of Items 8-9.** Item 7 repairs already-saved broken agents in place. The **Item 6 coverage-floor redesign** gives `0ee53785` and every send/notify-terminating agent a fair verdict on recalibration. The **runtime** slices of Items 8-9 repair the existing agent's data path in place. But **Item 11 (blank columns) needs an in-place DSL/generation fix — it does NOT self-heal on recalibration** — so `0ee53785`'s clean pass depends on Item 11 (Phase 3) landing too.

## Implementation Order (Dev delivery phases)

> **This is the AUTHORITATIVE Dev delivery sequence, set by the user:** **first the calibration items, then the plugin guard, lastly the agent-creation items.** SA's value-first ordering puts the generation-time root cause first; the user leads with the calibration side. This is safe because the one shared dependency — the reconciliation core (constraint #5) — is pulled out as a **Phase 0 prerequisite** built before anything that consumes it. Each phase is delivered end-to-end through the [review gates](#process--review-gates) before the next begins. **See also the top-level [Consolidated Implementation Backlog](#consolidated-implementation-backlog-2026-07-12), which groups the remaining work (A→C→B→D) and is the master to-do list.**

> **Runtime-vs-generation placement (pending SA Round 3).** Several new findings have both a runtime slice (helps agent `0ee53785` immediately, in place) and a generation slice (fixes new agents). SA Round 3 will rule where each lands; the phase tags below reflect the current best split and are marked where the placement is still open.

### Phase 0 — Shared reconciliation core (PREREQUISITE, build first)

Build the single deterministic **comparator / normaliser / reconciler** as a standalone module with **no call sites wired yet**: compare a step's declared field names against the producing plugin's real output schema; rename clearly-same-field spellings (case/separator-insensitive); leave ambiguous or genuinely-derived fields untouched.

- **Why first:** Items 5b and 7 (Phase 1) consume it, and so do Items 1-3, 8-9 (Phase 3).
- **Deliverable:** the core module + its own unit tests. No behaviour change to any pipeline yet.

### Phase 1 — Calibration items (FIRST, per user)

- **Item 5** — loop-variable detector fix + field-mismatch detector (5b) using the Phase 0 core.
- **Item 6** — verdict model + **both-direction coverage-floor redesign** (one unified meaningful-pre-delivery-data signal that fixes BOTH the too-lenient Re-run #1 case and the too-strict Re-run #2 send-terminating case) + inverted-verdict-logic fix. **This is the "fix now" home of user routing decision Q2 (backlog A2/A3).**
- **Item 7** — calibration-side in-place corrector, Phase 0 core, three G1 safety conditions.
- **Item 10 (NEW)** — surface an all-failed / all-empty step (100% of scatter items error or return empty/fallback) as a blocking/visible issue.
- **Calibration side of Item 3** — plugin-truth detection raising a mismatch as a blocking issue.
- **Validation opportunity:** re-run `0ee53785` — with Items 6+10 live, the blank columns surface as `needs_review` (not a metrics-artifact inconclusive) and a genuinely-populated send-terminating report can reach a fair verdict.

### Phase 2 — Plugin guard (THEN)

- **Item 4** — the generic, non-blocking runtime clamp-and-warn guard in the shared plugin-execution layer.

### Phase 3 — Agent-creation / field-fidelity + wiring items (LAST, per user)

- **Item 1** — Gap A generation-time reconciliation (Phase 0 core; dotted-path resolver).
- **Item 2** — Gap B compiler corrector + dotted-path fix.
- **Compiler side of Item 3** — compile-time plugin-truth gate.
- **Item 8 (NEW)** — plugin→plugin object-handoff binding. Generation slice here; runtime resolver-hardening slice may land earlier (pending SA Round 3).
- **Item 9 (NEW)** — parent-field carry-forward. Generation reference-shape slice here; runtime `transformFlatten` slice already validated at runtime in Re-run #2 (pending SA Round 3 for final placement).
- **Item 11 (NEW — user routing decision Q1, fix LATER)** — AI/processing step inside a scatter must be handed the loop variable it references. Generation-wiring fix for new agents **plus an in-place DSL edit for `0ee53785`** (does NOT self-heal on recalibration).

**Cross-reference:** per-item detail, evidence, owners, and acceptance criteria are in [Scoped Items](#scoped-items); this section only sets the sequence. Item numbers are stable identifiers, not an order.

## Cross-Cutting Constraints

These apply to every item and must be restated in each workplan:

1. **Schema-driven and generic only.** No plugin-specific hardcoding — no plugin names, no hardcoded field-name maps, no operation-specific rules. All reconciliation/validation/binding/wiring is keyed on the producer's / plugin action's declared schema (Platform Design Principles, CLAUDE.md § "No Hardcoding in System Prompts", § "Fix Issues at the Root Cause").
2. **Deterministic fixes, NOT prompt nudges.** The WP-56 prompt-nudge is precisely what regressed. Prompt guidance may remain as defense-in-depth but does not satisfy any acceptance criterion here.
3. **Derived-field survival.** Only fields that fuzzy-overlap a producer field get reconciled. Legitimate LLM-introduced derived fields with no producer counterpart must survive unchanged.
4. **Correct, don't merely warn.** For the field-fidelity/wiring chain (Items 1-3, 8-9, 11), the corrector layers must *rewrite to the producer's real spelling/shape / bind the referenced variable* so the agent actually works end-to-end. A layer that only warns does not satisfy that layer's acceptance criteria (flagging is only acceptable as the last-resort tripwire in Item 3 / Item 10 / G1, and even then it must be blocking).
5. **One reconciliation core, four+ call sites (SA Round-2 ruling).** The plugin-truth comparator + name-normaliser + reconciler is ONE shared piece of deterministic logic, reused — never re-implemented — at generation (Item 1), the compiler (Item 2), calibration detection (Items 3/5b), calibration correction (Item 7), and — where applicable — the plugin→plugin binding check (Item 8). Built once as **Phase 0** (the shared `lib/schema-reconciliation/` core). A separate copy in any call site is rejected.

## G1 — Anti-False-Success Guarantee (top-level)

> **This guarantee exists because of the user's core concern (Q6):** *"I do NOT want a future where an agent gets a SUCCESSFUL calibration while it will actually fail at runtime for some other reason."* This is a **false-green / false-success** risk. It is a first-class requirement, and the live re-runs found real holes on **both** sides of the coverage floor — closed by the Item 6 redesign below. It constrains Items 3, 5, 6, 7, and 10 together.

**Guarantee.** An agent that carries a real runtime-breaking defect (a field/shape the producing plugin does not emit; a step that fails or returns empty for 100% of items; a delivered report with no meaningful data) MUST NEVER receive a passing / production-ready calibration verdict. Conversely, a genuinely-populated report must NOT be denied a pass purely because a scalar delivery went uncounted (the flip side, Re-run #2).

This decomposes into three testable sub-guarantees:

- **G1a — Blocking severity for plugin-truth violations.** A detected field-name/shape-vs-plugin mismatch (Items 3, 8, 9) that survives the correctors MUST be classified as a **blocking-class** issue — it cannot be recorded as cosmetic/`medium`/user-confirm-only. (An out-of-range *param value* is NOT blocking — it is self-healed by the Item 4 runtime clamp.)
- **G1b — Verdict relaxation must not leak blocking issues.** The Item 6a relaxation (cosmetic user-confirm-only suggestions no longer force `failed`) MUST NOT allow any blocking-class issue to pass. Relaxation applies *only* to issues that are both non-blocking AND user-confirm-only. (This is the safety boundary backlog A3 must respect via a tight allow-list.)
- **G1c — Real path must have RUN and carried MEANINGFUL DATA (both directions).** The coverage floor judges "real path exercised" on the **last pre-delivery step's payload carrying meaningful (non-empty / non-fallback) field VALUES**, not on a raw row count and not on a terminal delivery count. This closes both holes with one signal: (i) an all-blank / all-fallback delivered set still FAILS (Re-run #1 — too lenient); (ii) a genuinely-populated report whose terminal send returned only a scalar confirmation is NOT denied a pass (Re-run #2 — too strict). A partially-populated report resolves to `needs_review` with the blank columns named. This coverage floor also caps Item 7's post-correction verdict.

**Acceptance criteria (G1).**
- [ ] There is a documented, enumerable set of **blocking-class** issue types that includes: plugin-field/shape mismatch (Items 3, 8, 9), a 100%-failed/empty step (Item 10), and broken variable reference to a genuinely non-existent producer field. Any of these prevents a passing verdict. (Out-of-range param values are NOT blocking-class.)
- [ ] Test: an agent with a live field/shape-vs-plugin mismatch cannot receive a passing verdict under any combination of other-issue states.
- [ ] Test: an agent whose ONLY remaining issue is a user-confirm-only parameterization suggestion is not forced to `failed` (Item 6a) AND is not reported as "success" if a blocking issue is present.
- [ ] Test: a run that processes zero eligible items resolves to "inconclusive", never "passed".
- [ ] **Test (both directions): an all-blank / all-fallback delivered set can NEVER be `passed`; a genuinely-populated report whose terminal send is uncounted CAN reach `passed`.**
- [ ] The verdict states (passed / failed / inconclusive / needs_review / corrected-not-yet-verified) are surfaced to the user in plain language, so "not tested" and "delivered blanks" are never displayed as "working".

## Scoped Items

---

### Item 1 — Gap A: Phase-2 field reconciliation (PRIMARY)

**Backlog ID.** B1.

**What it is.** In Phase 2, `DataSchemaBuilder` admits an `ai_declared` transform slot's field names verbatim without reconciling them against the `produced_by` producer slot. `inferSchemaForTransformStep()` applies a "LLM-declared `output_schema` wins for ANY transform op" rule and returns the declared shape as `ai_declared` **before** the flatten-inherit path that would have inherited the producer's real item shape. No later pass repairs it: `fixupDerivedTransformSchemas` is gated to shape-**preserving** ops (so shape-changing `flatten` is skipped) and only fills *empty* (`items.type === 'any'`) shapes. The wrong-cased `mime_type` enters the canonical slots map unchallenged. **This is the true root cause of the original bug — fixed by Phase 0/1.**

**Delivery phase.** Phase 3 (per user order) / backlog Group B. Reuses the Phase 0 shared core.

**Evidence / location.**
- `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` L282-287 (the "ai_declared wins for ANY transform op" rule), L289-295 (the bypassed flatten-inherit path), L711-739 (`fixupDerivedTransformSchemas` gated to shape-preserving ops; L719 gate; L729-732 only fills `type:'any'`).
- Canonical construct: `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` L56-88 (`DataSlot.produced_by`, `WorkflowDataSchema.slots`).
- Design intent: `docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` L116, L163-165.

**Owner.** `v6-pipeline` (Phase 2 `CapabilityBinderV2` / `DataSchemaBuilder`). Consumes the **shared reconciliation core** (constraint #5; built in Phase 0).

**Severity.** Critical — root cause.

**Acceptance criteria.**
- [ ] **This is a CORRECTION, not a warning.** For every `ai_declared` transform slot, item field names that fuzzy-overlap (case/separator-insensitive, e.g. `mime_type` ↔ `mimeType`) the `produced_by` input slot's fields are *rewritten to the producer's exact spelling* **before** the slot enters `WorkflowDataSchema.slots`.
- [ ] **Regeneration end-to-end.** With the fix live, regenerating this class of agent produces a workflow whose compiled `filter`/`scatter` reference the producer's real field name, and which yields a **populated** result on non-empty representative input.
- [ ] The reconciliation is performed by the **shared core** (constraint #5 / Phase 0), not a Phase-2-local copy.
- [ ] Overlap detection normalizes by lowercasing and stripping `_`/`-`.
- [ ] Reconciliation is driven solely by the producer slot's schema; no plugin identifiers or hardcoded field lists.
- [ ] Invariant test: no `ai_declared` transform slot may carry an item field name that fuzzy-overlaps a producer field but spells it differently.
- [ ] Negative test: an LLM-introduced derived field with no producer counterpart survives unchanged.
- [ ] Reconciliation decisions logged via structured Pino (debug) with slot name, original field, corrected field.

---

### Item 2 — Gap B: Phase-5 compiler reconciler dotted-path miss

**Backlog ID.** B2.

**What it is.** The compile-time reconciler `reconcileTransformSchemaWithUpstream` (O10a) is meant to rescue the `mime_type`→`mimeType` mismatch, but it no-ops because the upstream lookup keys `fullSchemaMap` by the bare `output_variable` only, while the transform's `config.input` is a **dotted path** (`expense_emails.emails`). Separately, step3's break is a bare `config.condition.field` literal, outside the corrector's `{{var.field}}` scanner scope.

**Delivery phase.** Phase 3 (per user order) / backlog Group B. Reuses the Phase 0 shared core.

**Evidence / location.**
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` L3233-3240 (dotted-path miss), `reconcileTransformSchemaWithUpstream` L3273 (comment L3266). Scanner-scope limits: L3507, L3532/L3603.

**Owner.** `v6-pipeline` (Phase 5 `ExecutionGraphCompiler`, O10a). Reuses the shared core.

**Severity.** High (backstop).

**Acceptance criteria.**
- [ ] **CORRECTION, not a warning.** O10a *rewrites* the transform's field name and the downstream `condition.field` literal to the producer's real spelling.
- [ ] A dotted-path `config.input` resolves its producer schema by drilling into the nested path, so O10a runs instead of no-op'ing.
- [ ] The corrector inspects bare `config.condition.field` literals (not only `{{var.field}}` templates).
- [ ] **Recompile end-to-end.** Recompiling `0ee53785` with the fix live yields a DSL whose filter references `mimeType` and a populated `eligible_attachments`.
- [ ] Reconciliation uses the shared core, not a compiler-local copy.
- [ ] Unit test on the schema-map build covering the dotted-path input case.

---

### Item 3 — Gap C: no plugin-schema oracle anywhere

**What it is.** NEW. Neither the compiler nor calibration validates a step's declared field names against the producing **plugin's** real `output_schema`; both trust declared schemas as ground truth. This is a *distinct, stronger* class of check than Gap B: Gap C is "no plugin-truth validation gate exists to begin with." The same blindness enabled the live re-run's false reassurance ("these fields exist on `attachment_item`", `dev.log` L1484).

**Delivery phase.** Split: **calibration-side** detection in Phase 1; **compiler-side** gate in Phase 3. Both reuse the Phase 0 core.

**Role clarification.** Gap C is the **safety-net / tripwire behind the correctors**. Items 1/2/8/9 *correct*; Item 3 *catches* what they miss. Per G1a a caught mismatch is a **blocking-class** issue. (Item 3 catches-and-blocks; Item 7 catches-and-repairs — same core.)

**Evidence / location.**
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` L3220-3225; `getActionOutputSchema` L6366, `schemaContainsField` L6390, used only at L6173-6197.
- Calibration-side twin blindness: `lib/pilot/shadow/StructuralRepairEngine.ts` L1737-1768; `lib/pilot/shadow/ScatterItemFieldValidator.ts` L164-205 (L189).

**Owner.** `v6-pipeline` (compiler gate) + `calibration` twin. See Open Questions on placement.

**Severity.** High — the missing "catch" layer.

**Acceptance criteria.**
- [ ] A validator walks every step whose declared `output_schema` lineage traces to a plugin action and asserts its item field names exist in that action's real `output_schema`.
- [ ] **Defined consequence.** A caught mismatch is a **blocking-class** issue (G1a) that prevents a passing verdict and routes to review/regeneration (or the Item 7 in-place corrector). NOT `warn`-only, NOT downgradeable to cosmetic.
- [ ] Generic — reads plugin definitions structurally; field comparison uses the shared core.
- [ ] Test: a transform declaring a field absent from its plugin producer is flagged AND the agent cannot receive a passing verdict.

---

### Item 4 — Out-of-range generated param value: runtime clamp-and-warn guard

**Backlog ID.** Runtime guard = this item (Phase 2). The generation-time validation + schema-summary fix = backlog C1.

**What it is.** NEW. The LLM invented `500` for `step1.params.max_results`, exceeding the Gmail plugin's `maximum: 100`. Per **SA Round 2**, an out-of-range value the connector tolerates is not execution-breaking, so this is a **generic, self-healing runtime guard**, not a build-time gate.

**Delivery phase.** Phase 2 (per user order). The complementary generation-side check is backlog Group C (C1).

**Mechanics (SA Round-2 ruling).**
- **Authoritative guard = the shared plugin-execution layer, at RUNTIME.** Right before any plugin call, read that plugin's own declared `minimum`/`maximum`/`enum` and validate. **Never stops the flow, never throws.**
- Numeric over/under → clamp to the plugin's declared bound, warn, continue. Invalid enum → use the plugin's declared default if present, else warn-and-pass-through (never drop the param, never invent a value).
- Compile/creation-time = non-blocking advisory (see backlog C1 for the generation-time validation + the LLM schema-summary fix that includes `maximum`).
- Schema-driven / generic, zero plugin-name branches. Structured Pino **warn** with param name, offending value, corrected value, plugin/action context.

**Evidence / location.**
- `lib/plugins/definitions/google-mail-plugin-v2.json` L305-310, L344-354; `intent-system-prompt-v2.ts` L139-140, L2156.

**Owner.** Runtime guard = **shared plugin-execution layer**; compile-time advisory = `v6-pipeline`.

**Severity.** Medium — self-healing guard + visible warning, NOT a hard failure.

**Acceptance criteria.**
- [ ] Generic runtime guard validates each outgoing param against the target plugin's declared `minimum`/`maximum`/`enum`, zero plugin-specific branches.
- [ ] **Numeric out-of-range CLAMPED, run continues:** `max_results:500` → `100`; in-range untouched.
- [ ] **Invalid enum falls back without throwing:** declared default if present, else pass-through; never drops, never invents, never throws.
- [ ] Structured Pino **warn** on every clamp/fallback with the required fields.
- [ ] Compile/creation-time check is a **non-blocking advisory**, not a gate.
- [ ] Guarantee test: no out-of-range numeric reaches the external API unclamped; no invalid enum makes our code throw.

---

### Item 5 — Calibration detector gaps (two)

**What it is.** NEW. (a) The `broken_variable_reference` detector doesn't understand a scatter `itemVariable` → valid loop-variable refs flagged as broken and permanently `autoFixable:false`. (b) No flatten-declared-vs-plugin-actual field validator (the calibration twin of Item 3).

**Delivery phase.** Phase 1 (per user order). Item 5b consumes the Phase 0 core.

**Evidence / location.**
- (a) `lib/pilot/shadow/StructuralRepairEngine.ts` L1737-1768, L829-888.
- (b) `lib/pilot/shadow/ScatterItemFieldValidator.ts` L164-205, L189.

**Owner.** `calibration`. Item 5b reuses the shared core.

**Severity.** Medium.

**Acceptance criteria.**
- [ ] The `broken_variable_reference` detector treats a scatter/loop `itemVariable` as in-scope (resolves `{{itemVariable.field}}` against the iterated element schema), so it stops emitting a permanent unfixable warning.
- [ ] A validator compares a `flatten`'s declared item fields against the source plugin action's real fields (via the shared core) and surfaces divergence.
- [ ] **Observable improvement on re-calibration.** Before/after issue-set comparison on the same agent shows the false-positive `attachment_item.*` warning gone and a real mismatch now surfaced.
- [ ] Test: `{{attachment_item.filename}}` on a valid scatter is no longer flagged; a snake_case flatten over a camelCase producer raises a divergence issue.

---

### Item 6 — Calibration verdict + coverage floor (both-direction, meaningful-data signal)

**Backlog IDs.** A2 (verify/wire real pre-delivery data into `deriveCoverageSignal`), A3 (cosmetic-only → passed-with-suggestions), D5 (un-inspectable-data hardening).

**What it is.** NEW — verdict/coverage requirements in service of G1, now covering **both directions** of the coverage floor with ONE unified signal (user routing decision **Q2**, fix NOW). (a) A session is marked `failed` whenever ANY unresolved issue remains, so a cosmetic user-confirm-only suggestion flips the verdict. (b) The dry-run ran on a live inbox with no eligible attachments, so the real path was never exercised. **(c) The coverage floor is COUNT-based, and count is wrong in BOTH directions:**
- **Too LENIENT (Re-run #1):** it was row-count only (`delivered===0`), so 13 all-blank rows would count as "exercised" and could verdict `passed`. It escaped only by luck (the blank send zeroed `items_delivered`).
- **Too STRICT (Re-run #2):** it is delivery-count based, so a **send/notify-terminating** agent whose report email actually sent (13 rows of real vendor/amount/date) shows `data_written:[]` / `items_delivered=0` — because a scalar `send_email` confirmation isn't a counted item array — and is wrongly capped to `inconclusive`. Send-terminating agents can essentially never reach `passed`.

**Unified design (owner `calibration`).** Replace the count-based delivered/row signals with a **meaningful-pre-delivery-data** signal: base `exercisedRealPath` on the **last pre-delivery producing step's payload carrying ≥1 row with meaningful (non-empty / non-fallback) field VALUES**; treat a terminal send/notify that **executed** (returned a confirmation / `message_id`) as delivery-exercised rather than requiring a positive `items_delivered` count; and add a per-column / fill-rate check so a partially-blank report resolves to `needs_review` (with the blank columns named), not `passed`.

**Delivery phase.** Phase 1 (per user order) — **the "fix now" home of Q2 / backlog Group A.** Establishes the verdict model + both-direction coverage floor Item 7 depends on. Helps `0ee53785` and ALL send/notify-terminating agents on recalibration. **NB (backlog A2):** first verify whether Phase 1.6's `deriveCoverageSignal` actually receives real pre-delivery data from `execution_summary` — a suspected wiring gap that passed unit tests but still caps live.

**Evidence / location.**
- (a) `app/api/v2/calibrate/batch/route.ts` L4444-4445; `IssueCollector.ts` L314-327, L896-906.
- (b) `lib/pilot/shadow/DryRunValidator.ts` L55-92, L107-121; throw-guard `lib/pilot/StepExecutor.ts` L2761-2768.
- (c, too-lenient / Re-run #1) `app/api/v2/calibrate/batch/route.ts` L4316/L4636; `CalibrationVerdict.ts` L155-204; `ExecutionSummaryCollector.ts` L217.
- (c, too-strict / Re-run #2) send executed but uncounted: `CalibrationVerdict.ts` L168-176 (`exercisedRealPath=false` → `inconclusive`); `ExecutionSummaryCollector.ts` L78-103 (`itemsDelivered += count`), L217 (surfaced only when `>0`); `WorkflowPilot.ts` L1220-1234 (`recordDataWrite`, count from `extractCountFromSchema`); `send_email` output is a scalar confirmation (no counted array) in `google-mail-plugin-v2.json`; run evidence `dev.log` L2750 (`suppressSend:false`), L2789 (real send), L67947-67963 (`data_written:[]`, no `items_delivered`, `verdict:"inconclusive"`).

**Owner.** `calibration`.

**Severity.** Medium — verdict-quality and coverage; **the false-green hole (too lenient) is the higher risk, but the too-strict direction blocks every send-terminating agent from a fair verdict.** Bounded by G1.

**Acceptance criteria (must encode all three — they guard against reopening the false-green hole while fixing the over-strictness):**
- [ ] **(1) All-blank / all-fallback delivered set still FAILS (Re-run #1 case).** A report whose delivered rows carry all-empty or all-"Unknown"-fallback values can NEVER be `passed` — it resolves to inconclusive / needs_review. The check is on meaningful field *values*, via a **generic** data-quality signal (no plugin-specific field names).
- [ ] **(2) Genuinely-populated report with an uncounted scalar send CAN reach `passed` (Re-run #2 case).** A report whose pre-delivery collection carries real values and whose terminal send/notify actually executed (returned a confirmation / `message_id`) is NOT denied a pass merely because `items_delivered` stayed 0.
- [ ] **(3) Partially-populated report resolves to `needs_review` with the blank columns named (this run's case).** A report with real `amount`/`vendor`/`date` but blank `source_email_from`/`subject`/`filename` resolves to `needs_review`, and the reason names the blank columns — not a metrics-artifact `inconclusive` and not a `passed`.
- [ ] `exercisedRealPath` is based on the last pre-delivery step's meaningful-data payload, not on a raw row count or a terminal delivery count.
- [ ] **Distinct verdict states** (passed / failed / inconclusive / needs_review / corrected-not-yet-verified) are plainly labelled and surfaced.
- [ ] Regression: a "happy path not exercised / zero eligible items" run still resolves to **inconclusive**, never a clean pass.

---

### Item 7 — Calibration-side field-fidelity corrector (in-place fix for existing agents)

**What it is.** NEW (SA Round-2). Give calibration the ability to **CORRECT** the declared-vs-plugin field-name mismatch in place by deterministically rewriting the stored workflow during calibration — fixing already-saved broken agents on re-calibration without full regeneration. The RCA's agent `0ee53785` is the canonical backfill target. (Note: the Phase 0/1 corrector already ran successfully on `0ee53785`, `dev.log` L1575-1580 — this item is the durable, generalised form.)

**Delivery phase.** Phase 1 (per user order) — depends on the Item 6 verdict model + coverage floor, and consumes the Phase 0 core.

**Why auto-apply is safe here.** It only **renames an internal field reference to the plugin's real output** — no change to inputs, intent, or user-facing behaviour. Safe to auto-apply provided it is audited, surfaced, and reversible.

**Evidence / area.** Same class as Items 1-3. Calibration already rewrites stored workflows for other issue types (`lib/pilot/shadow/` repair path). Reuses the Phase 0 core.

**Owner.** `calibration` (reusing the shared core — NOT a second implementation).

**Severity.** Medium — backwards-compat closer. **Risk: medium** (mutates saved workflows).

**Acceptance criteria.**
- [ ] **Reuses the shared core (Phase 0).** A separate calibration copy is rejected.
- [ ] **Deterministic, provably-correct rename.** Only clearly-same-field spellings rewritten; ambiguous left untouched.
- [ ] **G1 safety — no false green.** If the re-run after correction still doesn't exercise the real path (or delivers all-blank data), the coverage floor (Item 6) caps the verdict at **"corrected, real path not yet verified"**, NOT a pass. A corrected-then-re-verified pass IS legitimate (defect actually removed).
- [ ] **Audited, surfaced, reversible.** Every correction recorded in the audit trail, surfaced ("calibration rewrote field X → Y"), reversible. **(NB: the write itself must be owner-scoped — see backlog D8 — and, per backlog D11, routed through `AgentRepository`.)**
- [ ] **Backfill outcome.** Re-calibrating `0ee53785` repairs its field references in place; a subsequent run on representative input produces a populated result (in concert with Items 8-9). **Note:** Item 11 (blank columns) does NOT self-heal here — a clean pass for `0ee53785` also requires the Item 11 DSL/generation fix (see backlog D6 to generalise Item 11 into this corrector).
- [ ] **Sequencing.** After the Phase 0 core and alongside/after Item 6.

---

### Item 8 — Plugin→plugin object handoff: bind fields, not whole object (extract input)

**Backlog ID.** B3 (generation slice).

**What it is.** NEW (Finding 2, 2026-07-11 re-run). A NEW instance of the field-fidelity class, one hop downstream of the original. step6 (`document-extractor.extract_structured_data`) is wired **`file_content: "{{attachment_content}}"`** — the whole step5 attachment OBJECT dropped into one scalar string param. The real runtime resolver JSON-stringifies the whole-object placeholder, so the extractor loses `mimeType:"application/pdf"`, magic-byte detection on the JSON text returns `application/octet-stream`, and extraction throws on **every** one of the 13 items → all-blank rows. (The regression suite's identical scenario is green only because the simulator's resolver preserves object type — `variable-store.ts` L119-130 — masking the live break.) Same CLASS as the original, distinct INSTANCE.

**Delivery phase.** Field-fidelity phase (Phase 3) / backlog Group B (B3). **Fix placement (generation binding vs runtime resolver hardening) pending SA Round 3 confirmation** — the RCA's regression comparison supports the runtime-resolver slice (preserve object type for whole-placeholder templates, matching the simulator), which repairs `0ee53785` in place; the generation slice fixes new agents.

**Evidence / location.**
- DSL step6 `file_content:"{{attachment_content}}"` (`dev.log` L2007). step5 emits `application/pdf` (`dev.log` L6705/6740). step6 received a 68642-char JSON string; magic-byte detect → `application/octet-stream` (`dev.log` L7231-7257). `DeterministicExtractor.ts` L288 throw. Executor object-branch (`document-extractor-plugin-executor.ts` L61-79) skipped because the value arrived as a **string**. Simulator preserves object type (`variable-store.ts` L119-130) — the divergence. Plugin already declares `mime_type`/`filename` params (L48).

**Owner.** `v6-pipeline` (generation field-binding), with `lib/pilot` template-resolver hardening. Placement pending SA Round 3.

**Severity.** Was Critical; extraction now works via the resolver slice in Re-run #2 — retain the durable generation-binding rule so new agents are correct at creation.

**Acceptance criteria.**
- [ ] **Bind specific fields, not the whole object.** Generation binds the consumer's params to the producer's fields — `file_content ← {{attachment_content.data}}`, `mime_type ← {{attachment_content.mimeType}}`, `filename ← {{attachment_content.filename}}` — never a whole object into one scalar string param. Per backlog B3, driven by plugin `x-semantic-type` annotations (never plugin-name/fuzzy); un-annotated plugins deferred.
- [ ] A **generic** field-fidelity rule covers plugin→plugin object handoffs. Schema-driven, no plugin-specific branches.
- [ ] (Runtime slice, SA-supported) the template resolver returns the raw object when a param value is exactly one whole-object placeholder, matching the simulator — the slice that repairs `0ee53785` in place.
- [ ] **End-to-end:** on a re-run of `0ee53785`, `extract_structured_data` succeeds and rows carry real `amount` / `vendor` / `date` (confirmed in Re-run #2).

---

### Item 9 — Flatten parent-field carry-forward (From / Subject / Date)

**Backlog ID.** B4 (generation slice).

**What it is.** NEW (Finding 3, 2026-07-11 re-run), independent of Item 8. `transformFlatten` originally nested parent `from`/`subject` under `_parentData` and dropped `date`, so downstream references to flat `attachment_item.from/.subject/.date` were blank. **Confirmed FIXED at runtime in Re-run #2** — the flattened item now carries parent `from`/`subject`/`date` flat at the item root (and under `_parentData`) plus the child `filename` (`dev.log` L64307-64344). The residual blank columns are NOT this item — they are the step7 AI-input-wiring gap (**Item 11**).

**Delivery phase.** Field-fidelity phase (Phase 3) / backlog Group B (B4). The **runtime `transformFlatten` slice** is validated in Re-run #2; the **generation reference-shape slice** (reference the actually-carried names for new agents) remains. **Final placement pending SA Round 3.**

**Evidence / location.**
- Runtime now carries parent fields flat + child filename: `dev.log` L64307-64344 (item), L64315-64320 (`_parentData`), L64325-64328 (flat `subject/from/date`). Original defect: `transformFlatten` `StepExecutor.ts` L5071-5080.

**Owner.** `v6-pipeline` (reference the carried shape) + `lib/pilot` StepExecutor (`transformFlatten` — runtime slice validated). Placement pending SA Round 3.

**Severity.** High → **runtime slice confirmed working**; keep the generation slice so new agents reference the carried shape.

**Acceptance criteria.**
- [ ] Parent email `from`, `subject`, **and `date`** survive the flatten and are available on the item (confirmed in Re-run #2).
- [ ] `transformFlatten` carries `date` (runtime slice — validated).
- [ ] Generation references the actually-carried names so new agents don't reintroduce the mismatch (consistent end to end; approach pending SA Round 3).
- [ ] **End-to-end:** the parent fields are present on the scatter item — the remaining step of getting them into the report row is Item 11.

---

### Item 10 — Surface an all-failed / all-empty step as a visible issue

**What it is.** NEW calibration item (Finding 5, 2026-07-11 re-run). All 13 extraction failures were swallowed into valid-looking empty results — the extractor catches its own `Unsupported MIME type` throw and the executor applies fallback values, so the scatter recorded per-item **success** with empty data. The run showed 14/0/0 with `totalIssues:1` (only the cosmetic hardcode). A step that failed on 100% of items produced **zero** calibration signal.

**Delivery phase.** Calibration phase (Phase 1, per user order).

**Evidence / location.**
- Extractor catches throw → `createFailureResult` (`DeterministicExtractor.ts` L247-250). Executor applies fallback (`document-extractor-plugin-executor.ts` L145-151). Per-item `success:false` empty (`dev.log` L8063/L8130/L8197). No failed step; `totalIssues:1`.

**Owner.** `calibration`.

**Severity.** Medium-High — a blind spot that lets a 100%-failing step pass unseen; combined with the coverage-floor hole it directly enables false-green.

**Acceptance criteria.**
- [ ] A step or scatter where **every** item errors OR returns empty/fallback data is surfaced as a **blocking / visible** issue (G1a), not silently passed.
- [ ] Detection is **generic** — an all-items-degraded / all-empty signal, and/or extractor `success:false` (or fallback-applied) on 100% of items — with no plugin-specific logic.
- [ ] Test: a scatter whose items all extract to empty/fallback raises a blocking-class issue and cannot receive a passing verdict.

---

### Item 11 — AI/processing step inside a scatter must receive the loop variable it references

**Backlog IDs.** Generation-wiring fix (Phase 3) is this item; generalising it into the calibration corrector for existing-agent self-heal is backlog D6.

**What it is.** NEW (Re-run #2 Q1, user routing decision: fix LATER, Phase 3 generation). The AI row-builder step (step7, `ai_processing`/`generate`) inside the scatter has its instruction reference the scatter loop variable — "put `attachment_item.subject` into source_email_subject", `.from`, `.filename` — but that `attachment_item` is **NOT placed in the step's input context** (`step7.input` is `{{extracted_fields}}` only). An AI step only sees its declared `input` payload as data; the instruction's prose mention of `attachment_item` is just text to the LLM, so the model has no value to copy and writes `""`. Result: the extraction columns (amount/vendor/date, which ARE in the input) populate, while the From/Subject/Filename columns come out blank. The `attachment_filename` blank is the clincher — it is the child attachment's OWN field, present on the item, yet blank — proving `attachment_item` never reaches step7 at all. This is **distinct from Finding 3 / Item 9** (flatten carry-forward, now confirmed working) and is the same **family as WP-58** (multi-input AI wiring).

**Delivery phase.** Phase 3 (generation), per user routing decision Q1 (fix LATER). **Needs an in-place DSL/generation fix — it does NOT self-heal on recalibration.** `0ee53785` reaches a full clean pass only once BOTH Item 11 (Phase 3) and the Item 6 coverage-floor redesign (now) land.

**Evidence / location.**
- Dumped DSL step7: `input:"{{extracted_fields}}"` (step6 output only); instruction prose references `attachment_item.subject/.from/.filename`; scatter `itemVariable:"attachment_item"`.
- Populated extraction cols, blank source cols: `dev.log` L57087 (`vendor:"Wolt", amount:"ILS 99.90", source_email_subject:"", source_email_from:"", attachment_filename:""`).
- Item carries the fields (so it's a wiring gap, not missing data): `dev.log` L64307-64344.
- V6 ambiguity detector flagged this at generation (`dev.log` L1490-1491) and pre-flight warned (`dev.log` L1798) — but it shipped anyway.

**Owner.** `v6-pipeline` (generation wiring). Same family as WP-58 (multi-input AI wiring).

**Severity.** High for the North-Star run — without it the report's From/Subject/Filename columns stay blank.

**Acceptance criteria.**
- [ ] An `ai_processing` / AI step inside a scatter whose instruction references the loop `itemVariable` **receives that variable in its input/data context** — e.g. a multi-input `input` carrying both `{{extracted_fields}}` and `{{attachment_item}}` (or `{{attachment_item.*}}` template bindings resolved into the prompt), driven generically from the referenced-but-unbound variable, no plugin-specific logic.
- [ ] **End-to-end:** on a re-run of `0ee53785`, the report's `source_email_from` / `source_email_subject` / `attachment_filename` columns carry real values.
- [ ] In-place DSL edit repairs `0ee53785` (does not self-heal on recalibration); the generation-wiring fix prevents the class for new agents.
- [ ] Ties to Item 6 AC (3): until Item 11 lands, the blank columns must surface as `needs_review` (named), never `passed`.

---

## Out of Scope / Future Roadmap

- Broader Phase-1 schema-context injection (Direction #1 in `V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md`) — complements, does not replace, this work.
- The WP-55 `intent_contract`/`data_schema` persistence clobber — already fixed 2026-07-08 (owner `agent-creation-flow`).
- The **regression-suite coverage gap** (content-blind Phase E success bar; stub-simulator/runtime divergence that masked Findings 2-3) — owner QA/regression-suite; flagged by the RCA's regression-vs-novel comparison, tracked as **backlog D1**.
- Any prompt-nudge-only mitigation as the primary mechanism for the field-fidelity class (constraint #2).

## Open Questions / Risks

> **Note:** The 2026-07-10/11 acceptance-criteria additions capture the *guarantees* the requirement must hold. Some **mechanics** are **pending SA confirmation**, including **SA Round 3** on runtime-vs-generation placement for Items 8-9. Resolved-by-SA questions are checked below.

- [ ] **Items 8-9 runtime-vs-generation placement (raised by: BA · status: pending SA Round 3).** Which slice is a runtime fix (helps `0ee53785` in place — Item 8 resolver + Item 9 flatten both now validated at runtime) and which is a generation fix (new agents)? **Suggested resolution:** keep the validated runtime slices; ship the generation slices (bind specific fields; reference the carried shape) so new agents are correct at creation. SA Round 3 to confirm.
- [ ] **Item 11 in-place DSL edit vs generation-only (raised by: BA · status: pending SA).** Item 11 needs both a durable generation-wiring fix and an in-place DSL edit for `0ee53785` (it won't self-heal on recalibration). Is the in-place edit a manual Dev DSL correction, or should the Item 7 in-place corrector be extended to inject a missing scatter loop-variable into an AI step's input (backlog D6)? **Suggested resolution:** manual DSL edit for `0ee53785` now, plus the generation fix for new agents; generalise into the calibration corrector later (D6). SA to confirm.
- [ ] **Backlog A2 wiring gap (raised by: BA · status: open — NEW).** Does Phase 1.6's `deriveCoverageSignal` actually receive real pre-delivery data from `execution_summary`, or is it fed a stub (why it passed unit tests but still caps live)? **Suggested resolution:** trace the real execution-summary payload into the signal before adjusting the verdict logic; add a REAL-data test, not just fixtures. SA/calibration to confirm.
- [ ] **Generic data-quality / meaningful-value signal (raised by: BA · status: pending SA).** One shared definition of "meaningful data" powers the Item 6 both-direction coverage floor, the Item 6 per-column fill-rate `needs_review`, and the Item 10 all-empty detector. **Suggested resolution:** a shared generic emptiness/degraded check on delivered/pre-delivery field values (no plugin-specific field names). SA to confirm one definition.
- [ ] **"Send/notify executed = delivery-exercised" signal (raised by: BA · status: pending SA).** How is "the terminal send actually ran" detected generically (a returned confirmation / `message_id` from a delivery-classified action) without special-casing `send_email`? **Suggested resolution:** treat any delivery-`usage_context` action that returned a non-empty confirmation object as delivery-exercised. SA to confirm.
- [ ] **Item 7 audit / reversibility mechanism (raised by: BA · status: open).** Audit-trail entry + pre-rewrite snapshot for revert, surfaced in the calibration result. SA to confirm.
- [ ] **Gap C placement (raised by: BA · status: pending SA).** Compiler, calibration, or both? User order lands the calibration side in Phase 1 and the compiler side in Phase 3.
- [ ] **Blocking-class representation (raised by: BA · status: pending SA).** New severity tier, dedicated flag, or reserved issue-type set? SA to define.
- [ ] **A3 cosmetic allow-list (raised by: BA · status: open — NEW).** What is the tight allow-list of "provably cosmetic, user-confirm-only" issue types that may pass as `passed (with suggestions)` without reopening the false-green hole? **Suggested resolution:** start with only the `hardcode_detected` parameterization suggestion; anything else stays `needs_review`. SA to ratify the allow-list.
- [ ] **Verdict-state plumbing (raised by: BA · status: pending SA).** How are "inconclusive", "needs_review", "passed (with suggestions)", and "corrected, real path not yet verified" represented in the calibration status contract + UI without breaking passed/failed consumers? SA + a UI note.
- [ ] **Derived-field preservation (raised by: BA · status: proposed).** Reconcile only producer-overlapping fields; leave no-match fields untouched. Confirm with SA.
- [ ] **Ambiguous multi-match (raised by: BA · status: open).** Prefer a single post-normalization exact match; if ambiguous, leave unchanged. SA to confirm.
- [ ] **Nested/array depth (raised by: BA · status: open).** Reuse the flatten-inherit unwrap logic (`DataSchemaBuilder.ts` L289-295). SA to confirm.
- [x] **Item 4 flag-vs-clamp (RESOLVED — SA Round 2).** Non-blocking runtime clamp-and-warn guard; compile-time demoted to advisory. Out-of-range values no longer blocking-class.
- [x] **Should calibration also correct in place? (RESOLVED — SA Round 2).** Yes — Item 7, after the shared core, reusing it, with the three G1 safety conditions.
- [ ] **Fix placement within Phase 2 for Item 1 (raised by: BA · status: pending SA).** Inline in `inferSchemaForTransformStep` vs a dedicated post-pass? Architectural — flagged for SA.

## Notes on Integration Points

| System | File / area | Items |
|---|---|---|
| **Shared reconciliation core (one core, four+ call sites — Phase 0)** | `lib/schema-reconciliation/` shared module — comparator + name-normaliser + reconciler, built first, reused by generation / compiler / calibration-detect / calibration-correct / object-handoff | 1, 2, 3, 5, 7, 8 |
| Phase 2 schema builder (PRIMARY) | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` (L282-295, L711-739) | 1 |
| Canonical schema construct | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` (L56-88) | 1 |
| Phase 5 compiler | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (L3220-3240, L3273, L3507, L6173-6197, L6366-6390) | 2, 3 |
| Phase 1 intent prompt / generation | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (L139-140, L2156) | 4 (advisory), C1 |
| **Shared plugin-execution layer (runtime param guard)** | the shared executor call site where any plugin is invoked (SA to identify precise home) | 4 |
| **Extract input wiring / object handoff** | DSL binding of `extract_structured_data` params; `document-extractor-plugin-executor.ts` (L48, L61-94); template resolver (`variable-store.ts` L119-130 object-preservation slice) | 8 |
| **Flatten parent-field carry-forward** | `lib/pilot/StepExecutor.ts` `transformFlatten` (L5071-5080 — runtime slice validated) + generation reference shape | 9 |
| **AI-step scatter loop-variable wiring** | DSL generation of `ai_processing` step `input`/context inside a scatter (inject the referenced `itemVariable`); same family as WP-58 | 11 |
| **Calibration wizard UI (finish flow)** | sandbox `page.tsx` (~L605 / ~L936 commented-out `setFlowState('success')`) | A1 |
| **Calibrate-route `agents` writes (owner-scoping sweep + repository routing)** | `app/api/v2/calibrate/**` — `batch/route.ts` (~8 writes incl. ~L4657 open instance), `rollback/route.ts` (1), `apply-fixes/route.ts` (L1320); ensure `.eq('user_id', …)` (D8) AND route through `AgentRepository` (D11: `updatePilotSteps`, `setProductionReady`, + new purpose methods) | D8, D11 |
| **Calibration email transport (multipart/alternative)** | `lib/calibration/calibrationResultEmail.ts`, `lib/calibration/calibrationAdminAlert.ts`, `lib/.../emailTransport.ts` (~L61-66 Resend / L104-109 nodemailer), `NotificationService.ts` (~L408) | D9 |
| **Parameterize success — sandbox UI feedback** | `app/v2/sandbox/[agentId]/page.tsx` (`handleWizardComplete` ~L1056; re-detection ~L302-305; `passSuggestions`/`getPassSuggestions`) + `/api/agents/{id}/repair-hardcode` (server side already correct — no change) | D10 |
| **AgentRepository (calibration write methods)** | `lib/repositories/AgentRepository.ts` — `updatePilotSteps`, `setProductionReady`, `UpdateAgentInput` (extend for `workflow_hash`/`calibration_status` etc.) | D11 |
| Plugin definitions (producer truth) | e.g. `lib/plugins/definitions/google-mail-plugin-v2.json` (L305-310, L408-435; `send_email` scalar output) | 3, 4, 6, 8, C1 |
| Calibration static validators | `lib/pilot/shadow/StructuralRepairEngine.ts` (L1737-1768, L829-888), `lib/pilot/shadow/ScatterItemFieldValidator.ts` (L164-205) | 3, 5 |
| Calibration correction / backfill | calibration repair path in `lib/pilot/shadow/` (reuses shared core) + audit trail | 7, D6 |
| **Calibration verdict + coverage (both-direction meaningful-data floor)** | `app/api/v2/calibrate/batch/route.ts` (L4316/L4636, L4444-4445), `CalibrationVerdict.ts` (L155-204, L168-176), `ExecutionSummaryCollector.ts` (L78-103, L217), `WorkflowPilot.ts` (L1220-1234), `DryRunValidator.ts` (L55-121), `IssueCollector.ts` (L314-327, L896-906) | 6, 7, 10, A2, A3, G1 |
| **All-failed / all-empty step detector** | extractor swallow path `DeterministicExtractor.ts` (L247-250), `document-extractor-plugin-executor.ts` (L145-151); scatter degraded-output signal (calibration) | 10 |
| **Logging debt (`console.*` → Pino)** | `StepExecutor.ts` (30 calls), `AIOperationResolver.ts` (3 calls) | D2, D3 |
| Design intent | `docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` (L116, L163-165) | 1, 3 |

**Fix-owners:** `v6-pipeline` (Items 1-3, Item 4 compile-time advisory + C1, Item 8 generation slice/B3, Item 9 reference-shape slice/B4, **Item 11 generation wiring**, D2-D4, D7), **shared plugin-execution layer** (Item 4 runtime guard), **`lib/pilot` StepExecutor** (Item 9 `transformFlatten` runtime slice; Item 8 resolver-hardening slice — placement pending SA Round 3), `calibration` (Items 5-6, 7, 10, G1 verdict plumbing, A1-A3, D5, D6, **D8**, **D9**, **D10**, **D11**), `AgentRepository` (D11 write methods), `QA` (D1). The Phase 0 shared core's home is SA's call.

**Suggested WP linkage for the Dev (do not edit these tracking files as part of this requirement):** Items 1-3, 7, 8, 9 belong to the WP-18 / WP-56 field-fidelity family; **Item 11 is the WP-58 multi-input AI-wiring family**; the RCA proposes new WP entries for the object-handoff (Item 8), flatten carry-forward (Item 9), and coverage-floor (Item 6) cases. Items 6/10 are the calibration false-green family. The Dev should reference (and, when a fix lands, update per the V6 Work Protocol) WEAK_POINTS.md and `V6_OPEN_ITEMS.md` — the BA does not modify those files.

## SA Review — Round 2 (runtime clamp + calibration correction)

**Reviewed by SA — 2026-07-10** · Rulings on two user design refinements. Plain-language, advisory only.

### Refinement 1 — Item 4 becomes a NON-BLOCKING runtime clamp (supersedes the earlier "block enum at build")

**Ruling: agreed, and this changes my earlier D3 recommendation.** The user is right — an out-of-range value the connector tolerates is not execution-breaking, so hard-failing the build for it is disproportionate. My earlier "compile-time clamp numeric / hard-fail enum" stands corrected: **the build must not block on this at all.** Reconcile the two layers as defense-in-depth with the authoritative guard at runtime:

- **Authoritative guard = the shared plugin-execution layer (runtime).** Put one generic guard at the point where any plugin is about to be called. Right before each call, it reads that plugin's *own* declared limits for each parameter and checks the value against them. This is the correct home because it is the last line before the external API, so it protects a live run no matter how the bad value arrived — AI generation, a manual edit, a cached workflow, or some future authoring path. It never breaks the run.
- **Compile/creation time = advisory only, non-blocking.** Keep surfacing "this value is out of range, consider fixing the source" in the review/calibration output so the user eventually corrects the origin — but demote it from a build stop to a visible note. (This preserves the visibility requirement without gating the build.)

**Precise, generic behaviour of the runtime guard:**
- **Number above max / below min → clamp to the plugin's own declared bound, log a warning, and continue.** (e.g. `500` → the plugin's stated `100`.) Runtime never sees the out-of-range number.
- **Invalid choice-from-a-fixed-list (enum) → non-blocking fallback, never a stop:** prefer the plugin's *own declared default* for that parameter if it has one (schema-driven, not a guess); if the plugin declares no default, **warn and pass the value through unchanged** — let the plugin's own validation decide. Do **not** silently drop the parameter (dropping a required input is worse than passing it), and do **not** invent a substitute option (that would be fabrication, against our fail-loud principle). Either way the guard itself never throws, so the flow is not stopped by our code.

**Schema-driven / generic — confirmed compliant.** This must be **one shared guard that reads each plugin definition's declared constraints**, with zero plugin-name branches. That automatically covers Gmail, every Google plugin, and every other plugin — which is exactly why it satisfies the no-plugin-hardcoding principle. Reject any version that special-cases "Gmail" or "Google": the generic reader is both simpler and correct. (The user's "for Gmail or all Google plugins" framing is honoured by generalising it to *all* plugins.)

**Logging standard.** The clamp/fallback must be **loud, not silent** — structured runtime logging (the project's standard logger, warn level) carrying the parameter name, the offending value, the value it was corrected to, and the plugin/action context, and surfaced where a user/admin can see "this parameter was auto-corrected at runtime and should be fixed at the source." A silent clamp would hide the underlying generation defect forever; the whole point is that it stays visible so the origin gets fixed.

**Net for the workplan:** revise Item 4 so its authoritative deliverable is the runtime guard in the shared plugin-execution layer (clamp-numeric / default-or-pass-through-enum / warn / continue), with compile-time surfacing demoted to a non-blocking advisory. Owner stays `v6-pipeline` for the surfacing; the runtime guard lives in the shared plugin-execution layer.

### Refinement 2 — should calibration also CORRECT the field-name mismatch (new Item 7)?

**Ruling: architecturally sound and desirable — ACCEPT as a new scoped item (Item 7), implement AFTER Items 1-3 land, reusing their shared reconciliation core.** Not rejected, not indefinitely deferred — sequenced.

- **Is it sound to let calibration fix existing agents in place?** Yes. Today Gaps A/B only help agents created/compiled *after* the fix; every already-saved broken agent (this one included) would otherwise need full regeneration. Calibration already deterministically rewrites stored workflows for other issue types, so adding a field-name reconciliation repair fits the existing pattern and directly closes the backwards-compatibility gap. On re-calibration, the stored workflow's wrong field name is deterministically rewritten to the plugin's real one, and the agent is fixed **in place** without regeneration.
- **Does it stay safe against the false-green guarantee (G1)?** Yes, and this is the important part. A corrected-then-re-verified pass is a **legitimate** pass, not a false green, *because the real defect is actually removed* — this is categorically different from relaxing a verdict over an unfixed defect. Three conditions make it safe, and the workplan must state them: (1) the rewrite is the *same* deterministic, plugin-grounded reconciliation as Gap A (snap only clearly-same-field spellings; leave anything ambiguous untouched) — a provably-correct rename, not a guess; (2) re-verification must actually exercise the corrected path — if the re-run *still* doesn't reach the real data (e.g. zero eligible items again), the coverage floor (G1) applies and the verdict is capped at "corrected, real path not yet verified," **not** an unqualified pass; (3) the correction is surfaced and audited so the user sees "calibration rewrote field X → Y." Under those three, corrected-then-reverified is a real fix followed by a real check — exactly what a legitimate pass should be.
- **Shared logic, not a second implementation.** Confirmed required. The plugin-truth comparator + name-normaliser + reconciler is **one** piece of logic with multiple call sites: agent generation (Gap A), the compiler (Gap B), calibration detection (Gap C twin / Item 5b), and now calibration correction (Item 7). Building a separate calibration copy would let the two drift — reject that. Item 7 is "a fourth call site into the shared core plus persistence + re-verify wiring," not new reconciliation logic.
- **One extra caution.** Item 7 mutates a *saved* workflow, which is heavier than flagging. Because it only renames an internal field reference to match the plugin's real output — it does **not** change the agent's inputs, intent, or user-facing behaviour — it is safe to auto-apply (unlike the parameterization nag, which changes the input schema and needs user confirm). But it must be audited, surfaced in the calibration result, and ideally reversible.

**Recommendation:** add **Item 7 — calibration-side field-fidelity corrector / in-place backfill for existing agents.** Effort: low-to-medium *once the shared reconciler from Items 1/3 exists* (it is a new call site + save + re-verify, not new core logic) — which is exactly why it must come *after* the shared core, not before (building it first would duplicate the core). Risk: medium — it writes to stored workflows, so it needs audit, visibility, reversibility, and correct coverage-floor interaction to avoid a false green. Sequence it after the shared core (Phase 0) and alongside/after Item 6 (so it honours the verdict model and coverage floor). *(Delivery note: under the user's Implementation Order this lands in Phase 1, after the Phase 0 core.)*

> **SA Round 3 — PENDING.** SA is ruling in parallel on the runtime-vs-generation placement of the field-fidelity findings (Item 8 object-handoff; Item 9 parent-field carry-forward — both now validated at runtime in Re-run #2) and the placement of Item 11's in-place DSL edit vs generation-wiring fix. Placement decisions in Items 8-9, 11 and the Implementation Order are marked "pending SA Round 3 confirmation" until that ruling lands.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-09 | Created | Field-name reconciler requirement (Gap A primary, Gap B backstop). |
| 2026-07-10 | Consolidated | Expanded into the single requirement for all RCA failure modes: added Item 3 (Gap C plugin-schema oracle), Item 4 (out-of-range `max_results:500`), Item 5 (two calibration detector gaps), Item 6 (verdict + coverage weaknesses). Renumbered Gap A/B as Items 1-2; added priority ordering, cross-cutting constraints, per-item severity/owner/AC. |
| 2026-07-10 | User-review follow-ups | Added G1 top-level Anti-False-Success Guarantee (a/b/c) and cross-cutting constraint #4; CORRECTION-not-warning + regenerate/recompile-end-to-end criteria (Items 1-2); Gap C blocking + tripwire role (Item 3); Item 4 clamp/block split; Item 5 re-calibration criterion; Item 6 bounded by G1 + inconclusive state. |
| 2026-07-10 | SA Round-2 rulings | Reworked Item 4 into a NON-BLOCKING runtime clamp-and-warn guard; removed out-of-range param from G1a blocking-class. Added Item 7 (in-place corrector) with three G1 safety conditions + "corrected, not yet verified" verdict state. Added constraint #5 (one reconciliation core). |
| 2026-07-10 | User-directed delivery order | Added "Process / Review Gates" and the authoritative "Implementation Order (Dev delivery phases)": Phase 0 shared core → Phase 1 calibration → Phase 2 plugin guard → Phase 3 agent-creation. Retitled Priority Ordering as SA value/dependency rationale; tagged each item with its delivery phase. |
| 2026-07-11 | Live re-run RCA fold-in | Added Item 8 (plugin→plugin object handoff), Item 9 (flatten parent-field carry-forward), Item 10 (surface an all-failed/all-empty step); extended Item 6 + tightened G1c with the Finding-4 data-quality coverage floor. Added the North-Star Success Criterion. |
| 2026-07-11 | Live re-run #2 fold-in | Folded the two Re-run #2 findings. Q1 → NEW Item 11 (an `ai_processing` step inside a scatter must be handed the loop variable it references; WP-58 family) — Phase 3 generation, needs an in-place DSL edit, does NOT self-heal. Q2 → folded into Item 6, reframed as a both-direction coverage floor with ONE meaningful-pre-delivery-data signal (three ACs). Updated North-Star, Concrete Failing Example, Implementation Order, G1c, Integration Points, Fix-owners, Open Questions. |
| 2026-07-12 | Consolidated backlog | Added the top-level **"Consolidated Implementation Backlog (2026-07-12)"** — the single authoritative prioritized to-do list. Group A (unblock calibration finish: A1 wizard dead-end, A2 coverage-floor real-data wiring, A3 cosmetic-only → passed-with-suggestions), Group B (generation correctness: B1=Item 1, B2=Item 2, B3=Item 8 gen, B4=Item 9 gen), Group C (C1=Item 4 compile-time + schema-summary fix, C2 auto-parameterize invented literals), Group D (D1-D7 hardening/debt). Added AC lines for all NEW items, a backlog→Item map, recommended sequence (A→C→B→D), and the per-group review-gate process. Tagged existing Items with their backlog IDs. |
| 2026-07-13 | Backlog D8 added | Appended **D8** to Group D — security sweep to owner-scope (`user_id`) every `agents` write under `app/api/v2/calibrate/**` (or route via `AgentRepository`), with a regression guard. Recurring mandatory-rule violation that surfaced four times this cycle (two batch writes + apply-fixes L1320 fixed; batch ~L4657 still open). Added its AC, backlog→Item map row, an Integration-Points row, Fix-owner (calibration), and a cross-note on Item 7's write. |
| 2026-07-13 | Backlog D9 + D10 added (hotfixes) | Appended two calibration-owned, HOTFIX-scoped, PRE-EXISTING bugs surfaced by the Group A live test (RCA "Addendum — 2026-07-13"). **D9:** calibration emails have no plaintext part — both senders pass HTML only and the transport sends single-part `text/html`, so some clients render raw text; fix = send `multipart/alternative` by threading a `text` field through the transport and auto-generating plaintext from HTML in one place. **D10:** "make it a reusable parameter" succeeds server-side but the UI gives no confirmation and the suggestion doesn't clear (missing suggestion recompute + missing `loadAgent` else-branch at ~L302-305 + no success toast); UI-only fix, endpoint unchanged. Added both to the Group D table + AC + backlog→Item map, two Integration-Points rows, and calibration fix-owner. |
| 2026-07-13 | Backlog D11 added | Appended **D11** to Group D — repository-pattern refactor routing every calibration-route `agents` write (~10 points: batch ~8, rollback 1, apply-fixes 1) through `AgentRepository` (`updatePilotSteps`, `setProductionReady`, + new purpose methods), removing the direct `supabase.from('agents').update()` calls and adding a regression guard. Root cause: `UpdateAgentInput` didn't cover the calibration columns, so the loop used one-off direct writes. Completes what D8 started (D8 = security/owner-scoping half; D11 = pattern half); Med risk, do on a clean tree with full test coverage, behavior byte-for-byte preserved. Added its AC, backlog→Item map row, updated the D8 Integration-Points row + added an `AgentRepository` row, Fix-owners, and a cross-note on Item 7's write. |
| 2026-07-13 | D8/D9/D10 marked ✅ Implemented | Marked backlog **D8, D9, D10** as ✅ Implemented 2026-07-13 (SA-approved, QA-passed, about to be committed; commit hash to follow) in their Group D table rows, the Group D acceptance-criteria lines, and the Backlog→Item ID map. D11 remains open (not done). No other content changed. |
