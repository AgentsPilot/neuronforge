# Requirement: V6 Field-Fidelity & Calibration Hardening (Gmail Expense Attachment RCA)

**Created by:** BA
**Date:** 2026-07-09
**Last Updated:** 2026-07-11
**Status:** Draft (pending SA review)

## Overview

This is the **single consolidated requirement** covering every failure mode uncovered in the Gmail-expense-attachment root-cause investigation. It spans three concern areas: (1) the V6 pipeline's failure to enforce plugin-real field names / shapes / wiring through generated steps (the true root cause of the real bug — `mimeType` vs `mime_type`, plus new instances found in the live re-runs); (2) a latent out-of-range generated parameter value; and (3) several calibration detection/verdict/coverage weaknesses that let real defects stay dormant while a cosmetic nag flipped the verdict. The RCA is the source of truth; this document converts it into clearly-numbered, independently-workplannable scoped items — it does **not** re-diagnose.

> **Source of truth (do not re-diagnose):** [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md). Key sections mapped to items below: "Role of the Workflow Data Schema object" (Item 1), "Regression analysis" (Item 2), "Should the compiler have caught this?" (Item 3), "The hardcoded 500" (Item 4), "Why calibration cannot catch this" + §7-8 (Items 5-6), "Origin of the empty attachment list" (Item 6b), **"Live Re-run RCA (2026-07-11) — post Phase 0/1"** (Items 8-10 + the Item 6 coverage-floor extension), **"Live Re-run #2 RCA (2026-07-11) — blank columns + coverage-floor strictness"** (Item 11 + the Item 6 both-direction coverage-floor redesign).

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

## Process / Review Gates

Dev implements this requirement **phase by phase** (see [Implementation Order](#implementation-order-dev-delivery-phases)). After Dev completes a phase, it passes through these gates **before** the next phase starts:

**Dev → SA code-review/approve → USER reviews the code → QA → user approval → RM.**

The key point: after SA approves a phase's code, the **user reviews that code BEFORE QA runs**. Do not hand a phase to QA until the user has reviewed and okayed it. Each phase is a self-contained delivery through the full gate chain.

## Table of Contents

- [North-Star Success Criterion](#north-star-success-criterion)
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

> **This section captures SA's value-and-dependency reasoning (which fix matters most and why).** It is NOT the Dev delivery sequence. The authoritative delivery sequence is the user-directed [Implementation Order](#implementation-order-dev-delivery-phases) below; where the two differ, the Implementation Order governs. The Phase 0 shared-core prerequisite makes the user's order safe (no forward dependency is broken).

- **PRIMARY — the field-fidelity / wiring chain (Items 1-3, extended by Items 8-9, 11).** These are what make the agent actually work. Item 1 (Gap A) is the root cause and durable fix; Item 2 (Gap B) widens the compiler safety net; Item 3 (Gap C) adds the plugin-schema oracle. Items 8-9 and 11 are the SAME family recurring downstream (object-into-scalar handoff; parent-field carry-forward; an AI step not handed its loop variable) — they must be closed for a fully populated report.
- **SECONDARY — hardening + detection quality (Items 4-6, extended by Item 10).** Item 4 is a self-healing runtime guard for out-of-range param values. Items 5-6 + Item 10 are calibration detector/verdict/coverage improvements — they make the verdict honest and surface real defects, but they are not the cure.
- **BACKWARDS-COMPAT / SUCCESSFUL-RUN CLOSER — Item 7, the Item 6 coverage-floor redesign, + the runtime slices of Items 8-9.** Item 7 repairs already-saved broken agents in place. The **Item 6 coverage-floor redesign** gives `0ee53785` and every send/notify-terminating agent a fair verdict on recalibration. The **runtime** slices of Items 8-9 repair the existing agent's data path in place. But **Item 11 (blank columns) needs an in-place DSL/generation fix — it does NOT self-heal on recalibration** — so `0ee53785`'s clean pass depends on Item 11 (Phase 3) landing too.

## Implementation Order (Dev delivery phases)

> **This is the AUTHORITATIVE Dev delivery sequence, set by the user:** **first the calibration items, then the plugin guard, lastly the agent-creation items.** SA's value-first ordering puts the generation-time root cause first; the user leads with the calibration side. This is safe because the one shared dependency — the reconciliation core (constraint #5) — is pulled out as a **Phase 0 prerequisite** built before anything that consumes it. Each phase is delivered end-to-end through the [review gates](#process--review-gates) before the next begins.

> **Runtime-vs-generation placement (pending SA Round 3).** Several new findings have both a runtime slice (helps agent `0ee53785` immediately, in place) and a generation slice (fixes new agents). SA Round 3 will rule where each lands; the phase tags below reflect the current best split and are marked where the placement is still open.

### Phase 0 — Shared reconciliation core (PREREQUISITE, build first)

Build the single deterministic **comparator / normaliser / reconciler** as a standalone module with **no call sites wired yet**: compare a step's declared field names against the producing plugin's real output schema; rename clearly-same-field spellings (case/separator-insensitive); leave ambiguous or genuinely-derived fields untouched.

- **Why first:** Items 5b and 7 (Phase 1) consume it, and so do Items 1-3, 8-9 (Phase 3).
- **Deliverable:** the core module + its own unit tests. No behaviour change to any pipeline yet.

### Phase 1 — Calibration items (FIRST, per user)

- **Item 5** — loop-variable detector fix + field-mismatch detector (5b) using the Phase 0 core.
- **Item 6** — verdict model + **both-direction coverage-floor redesign** (one unified meaningful-pre-delivery-data signal that fixes BOTH the too-lenient Re-run #1 case and the too-strict Re-run #2 send-terminating case) + inverted-verdict-logic fix. **This is the "fix now" home of user routing decision Q2.**
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
5. **One reconciliation core, four+ call sites (SA Round-2 ruling).** The plugin-truth comparator + name-normaliser + reconciler is ONE shared piece of deterministic logic, reused — never re-implemented — at generation (Item 1), the compiler (Item 2), calibration detection (Items 3/5b), calibration correction (Item 7), and — where applicable — the plugin→plugin binding check (Item 8). Built once as **Phase 0**. A separate copy in any call site is rejected.

## G1 — Anti-False-Success Guarantee (top-level)

> **This guarantee exists because of the user's core concern (Q6):** *"I do NOT want a future where an agent gets a SUCCESSFUL calibration while it will actually fail at runtime for some other reason."* This is a **false-green / false-success** risk. It is a first-class requirement, and the live re-runs found real holes on **both** sides of the coverage floor — closed by the Item 6 redesign below. It constrains Items 3, 5, 6, 7, and 10 together.

**Guarantee.** An agent that carries a real runtime-breaking defect (a field/shape the producing plugin does not emit; a step that fails or returns empty for 100% of items; a delivered report with no meaningful data) MUST NEVER receive a passing / production-ready calibration verdict. Conversely, a genuinely-populated report must NOT be denied a pass purely because a scalar delivery went uncounted (the flip side, Re-run #2).

This decomposes into three testable sub-guarantees:

- **G1a — Blocking severity for plugin-truth violations.** A detected field-name/shape-vs-plugin mismatch (Items 3, 8, 9) that survives the correctors MUST be classified as a **blocking-class** issue — it cannot be recorded as cosmetic/`medium`/user-confirm-only. (An out-of-range *param value* is NOT blocking — it is self-healed by the Item 4 runtime clamp.)
- **G1b — Verdict relaxation must not leak blocking issues.** The Item 6a relaxation (cosmetic user-confirm-only suggestions no longer force `failed`) MUST NOT allow any blocking-class issue to pass. Relaxation applies *only* to issues that are both non-blocking AND user-confirm-only.
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

**What it is.** In Phase 2, `DataSchemaBuilder` admits an `ai_declared` transform slot's field names verbatim without reconciling them against the `produced_by` producer slot. `inferSchemaForTransformStep()` applies a "LLM-declared `output_schema` wins for ANY transform op" rule and returns the declared shape as `ai_declared` **before** the flatten-inherit path that would have inherited the producer's real item shape. No later pass repairs it: `fixupDerivedTransformSchemas` is gated to shape-**preserving** ops (so shape-changing `flatten` is skipped) and only fills *empty* (`items.type === 'any'`) shapes. The wrong-cased `mime_type` enters the canonical slots map unchallenged. **This is the true root cause of the original bug — fixed by Phase 0/1.**

**Delivery phase.** Phase 3 (per user order). Reuses the Phase 0 shared core.

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

**What it is.** The compile-time reconciler `reconcileTransformSchemaWithUpstream` (O10a) is meant to rescue the `mime_type`→`mimeType` mismatch, but it no-ops because the upstream lookup keys `fullSchemaMap` by the bare `output_variable` only, while the transform's `config.input` is a **dotted path** (`expense_emails.emails`). Separately, step3's break is a bare `config.condition.field` literal, outside the corrector's `{{var.field}}` scanner scope.

**Delivery phase.** Phase 3 (per user order). Reuses the Phase 0 shared core.

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

**What it is.** NEW. The LLM invented `500` for `step1.params.max_results`, exceeding the Gmail plugin's `maximum: 100`. Per **SA Round 2**, an out-of-range value the connector tolerates is not execution-breaking, so this is a **generic, self-healing runtime guard**, not a build-time gate.

**Delivery phase.** Phase 2 (per user order).

**Mechanics (SA Round-2 ruling).**
- **Authoritative guard = the shared plugin-execution layer, at RUNTIME.** Right before any plugin call, read that plugin's own declared `minimum`/`maximum`/`enum` and validate. **Never stops the flow, never throws.**
- Numeric over/under → clamp to the plugin's declared bound, warn, continue. Invalid enum → use the plugin's declared default if present, else warn-and-pass-through (never drop the param, never invent a value).
- Compile/creation-time = non-blocking advisory.
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

**What it is.** NEW — verdict/coverage requirements in service of G1, now covering **both directions** of the coverage floor with ONE unified signal (user routing decision **Q2**, fix NOW). (a) A session is marked `failed` whenever ANY unresolved issue remains, so a cosmetic user-confirm-only suggestion flips the verdict. (b) The dry-run ran on a live inbox with no eligible attachments, so the real path was never exercised. **(c) The coverage floor is COUNT-based, and count is wrong in BOTH directions:**
- **Too LENIENT (Re-run #1):** it was row-count only (`delivered===0`), so 13 all-blank rows would count as "exercised" and could verdict `passed`. It escaped only by luck (the blank send zeroed `items_delivered`).
- **Too STRICT (Re-run #2):** it is delivery-count based, so a **send/notify-terminating** agent whose report email actually sent (13 rows of real vendor/amount/date) shows `data_written:[]` / `items_delivered=0` — because a scalar `send_email` confirmation isn't a counted item array — and is wrongly capped to `inconclusive`. Send-terminating agents can essentially never reach `passed`.

**Unified design (owner `calibration`).** Replace the count-based delivered/row signals with a **meaningful-pre-delivery-data** signal: base `exercisedRealPath` on the **last pre-delivery producing step's payload carrying ≥1 row with meaningful (non-empty / non-fallback) field VALUES**; treat a terminal send/notify that **executed** (returned a confirmation / `message_id`) as delivery-exercised rather than requiring a positive `items_delivered` count; and add a per-column / fill-rate check so a partially-blank report resolves to `needs_review` (with the blank columns named), not `passed`.

**Delivery phase.** Phase 1 (per user order) — **the "fix now" home of Q2.** Establishes the verdict model + both-direction coverage floor Item 7 depends on. Helps `0ee53785` and ALL send/notify-terminating agents on recalibration.

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
- [ ] **Audited, surfaced, reversible.** Every correction recorded in the audit trail, surfaced ("calibration rewrote field X → Y"), reversible.
- [ ] **Backfill outcome.** Re-calibrating `0ee53785` repairs its field references in place; a subsequent run on representative input produces a populated result (in concert with Items 8-9). **Note:** Item 11 (blank columns) does NOT self-heal here — a clean pass for `0ee53785` also requires the Item 11 DSL/generation fix.
- [ ] **Sequencing.** After the Phase 0 core and alongside/after Item 6.

---

### Item 8 — Plugin→plugin object handoff: bind fields, not whole object (extract input)

**What it is.** NEW (Finding 2, 2026-07-11 re-run). A NEW instance of the field-fidelity class, one hop downstream of the original. step6 (`document-extractor.extract_structured_data`) is wired **`file_content: "{{attachment_content}}"`** — the whole step5 attachment OBJECT dropped into one scalar string param. The real runtime resolver JSON-stringifies the whole-object placeholder, so the extractor loses `mimeType:"application/pdf"`, magic-byte detection on the JSON text returns `application/octet-stream`, and extraction throws on **every** one of the 13 items → all-blank rows. (The regression suite's identical scenario is green only because the simulator's resolver preserves object type — `variable-store.ts` L119-130 — masking the live break.) Same CLASS as the original, distinct INSTANCE.

**Delivery phase.** Field-fidelity phase (Phase 3) as a NEW case. **Fix placement (generation binding vs runtime resolver hardening) pending SA Round 3 confirmation** — the RCA's regression comparison supports the runtime-resolver slice (preserve object type for whole-placeholder templates, matching the simulator), which repairs `0ee53785` in place; the generation slice fixes new agents.

**Evidence / location.**
- DSL step6 `file_content:"{{attachment_content}}"` (`dev.log` L2007). step5 emits `application/pdf` (`dev.log` L6705/6740). step6 received a 68642-char JSON string; magic-byte detect → `application/octet-stream` (`dev.log` L7231-7257). `DeterministicExtractor.ts` L288 throw. Executor object-branch (`document-extractor-plugin-executor.ts` L61-79) skipped because the value arrived as a **string**. Simulator preserves object type (`variable-store.ts` L119-130) — the divergence. Plugin already declares `mime_type`/`filename` params (L48).

**Owner.** `v6-pipeline` (generation field-binding), with `lib/pilot` template-resolver hardening. Placement pending SA Round 3.

**Severity.** Was Critical; extraction now works via the resolver slice in Re-run #2 — retain the durable generation-binding rule so new agents are correct at creation.

**Acceptance criteria.**
- [ ] **Bind specific fields, not the whole object.** Generation binds the consumer's params to the producer's fields — `file_content ← {{attachment_content.data}}`, `mime_type ← {{attachment_content.mimeType}}`, `filename ← {{attachment_content.filename}}` — never a whole object into one scalar string param.
- [ ] A **generic** field-fidelity rule covers plugin→plugin object handoffs. Schema-driven, no plugin-specific branches.
- [ ] (Runtime slice, SA-supported) the template resolver returns the raw object when a param value is exactly one whole-object placeholder, matching the simulator — the slice that repairs `0ee53785` in place.
- [ ] **End-to-end:** on a re-run of `0ee53785`, `extract_structured_data` succeeds and rows carry real `amount` / `vendor` / `date` (confirmed in Re-run #2).

---

### Item 9 — Flatten parent-field carry-forward (From / Subject / Date)

**What it is.** NEW (Finding 3, 2026-07-11 re-run), independent of Item 8. `transformFlatten` originally nested parent `from`/`subject` under `_parentData` and dropped `date`, so downstream references to flat `attachment_item.from/.subject/.date` were blank. **Confirmed FIXED at runtime in Re-run #2** — the flattened item now carries parent `from`/`subject`/`date` flat at the item root (and under `_parentData`) plus the child `filename` (`dev.log` L64307-64344). The residual blank columns are NOT this item — they are the step7 AI-input-wiring gap (**Item 11**).

**Delivery phase.** Field-fidelity phase (Phase 3). The **runtime `transformFlatten` slice** is validated in Re-run #2; the **generation reference-shape slice** (reference the actually-carried names for new agents) remains. **Final placement pending SA Round 3.**

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
- The **regression-suite coverage gap** (content-blind Phase E success bar; stub-simulator/runtime divergence that masked Findings 2-3) — owner QA/regression-suite; flagged by the RCA's regression-vs-novel comparison, tracked separately from this requirement.
- Any prompt-nudge-only mitigation as the primary mechanism for the field-fidelity class (constraint #2).

## Open Questions / Risks

> **Note:** The 2026-07-10/11 acceptance-criteria additions capture the *guarantees* the requirement must hold. Some **mechanics** are **pending SA confirmation**, including **SA Round 3** on runtime-vs-generation placement for Items 8-9. Resolved-by-SA questions are checked below.

- [ ] **Items 8-9 runtime-vs-generation placement (raised by: BA · status: pending SA Round 3).** Which slice is a runtime fix (helps `0ee53785` in place — Item 8 resolver + Item 9 flatten both now validated at runtime) and which is a generation fix (new agents)? **Suggested resolution:** keep the validated runtime slices; ship the generation slices (bind specific fields; reference the carried shape) so new agents are correct at creation. SA Round 3 to confirm.
- [ ] **Item 11 in-place DSL edit vs generation-only (raised by: BA · status: pending SA — NEW).** Item 11 needs both a durable generation-wiring fix and an in-place DSL edit for `0ee53785` (it won't self-heal on recalibration). Is the in-place edit a manual Dev DSL correction, or should the Item 7 in-place corrector be extended to inject a missing scatter loop-variable into an AI step's input? **Suggested resolution:** manual DSL edit for `0ee53785` now (per the RCA's "Dev after SA"), plus the generation fix for new agents; consider generalising into the calibration corrector later. SA to confirm.
- [ ] **Generic data-quality / meaningful-value signal (raised by: BA · status: pending SA, Finding 4 + Re-run #2).** One shared definition of "meaningful data" powers the Item 6 both-direction coverage floor, the Item 6 per-column fill-rate `needs_review`, and the Item 10 all-empty detector. What is it — all-fields-empty per row, an all-fallback / "Unknown" marker, a fill-rate threshold per column? **Suggested resolution:** a shared generic emptiness/degraded check on delivered/pre-delivery field values (no plugin-specific field names), reused by Items 6 and 10. SA to confirm one definition.
- [ ] **"Send/notify executed = delivery-exercised" signal (raised by: BA · status: pending SA — NEW, Re-run #2).** How is "the terminal send actually ran" detected generically (a returned confirmation / `message_id` from a delivery-classified action) without special-casing `send_email`? **Suggested resolution:** treat any delivery-`usage_context` action that returned a non-empty confirmation object as delivery-exercised. SA to confirm the generic rule.
- [ ] **Item 7 audit / reversibility mechanism (raised by: BA · status: open).** Audit-trail entry + pre-rewrite snapshot for revert, surfaced in the calibration result. SA to confirm.
- [ ] **Gap C placement (raised by: BA · status: pending SA).** Compiler, calibration, or both? User order lands the calibration side in Phase 1 and the compiler side in Phase 3.
- [ ] **Blocking-class representation (raised by: BA · status: pending SA).** New severity tier, dedicated flag, or reserved issue-type set? SA to define.
- [ ] **Verdict-state plumbing (raised by: BA · status: pending SA).** How are "inconclusive", "needs_review", and "corrected, real path not yet verified" represented in the calibration status contract + UI without breaking passed/failed consumers? SA + a UI note.
- [ ] **Derived-field preservation (raised by: BA · status: proposed).** Reconcile only producer-overlapping fields; leave no-match fields untouched. Confirm with SA.
- [ ] **Ambiguous multi-match (raised by: BA · status: open).** Prefer a single post-normalization exact match; if ambiguous, leave unchanged. SA to confirm.
- [ ] **Nested/array depth (raised by: BA · status: open).** Reuse the flatten-inherit unwrap logic (`DataSchemaBuilder.ts` L289-295). SA to confirm.
- [x] **Item 4 flag-vs-clamp (RESOLVED — SA Round 2).** Non-blocking runtime clamp-and-warn guard; compile-time demoted to advisory. Out-of-range values no longer blocking-class.
- [x] **Should calibration also correct in place? (RESOLVED — SA Round 2).** Yes — Item 7, after the shared core, reusing it, with the three G1 safety conditions.
- [ ] **Fix placement within Phase 2 for Item 1 (raised by: BA · status: pending SA).** Inline in `inferSchemaForTransformStep` vs a dedicated post-pass? Architectural — flagged for SA.

## Notes on Integration Points

| System | File / area | Items |
|---|---|---|
| **Shared reconciliation core (one core, four+ call sites — Phase 0)** | new/shared module (SA to place) — comparator + name-normaliser + reconciler, built first, reused by generation / compiler / calibration-detect / calibration-correct / object-handoff | 1, 2, 3, 5, 7, 8 |
| Phase 2 schema builder (PRIMARY) | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` (L282-295, L711-739) | 1 |
| Canonical schema construct | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` (L56-88) | 1 |
| Phase 5 compiler | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (L3220-3240, L3273, L3507, L6173-6197, L6366-6390) | 2, 3 |
| Phase 1 intent prompt / generation | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (L139-140, L2156) | 4 (advisory) |
| **Shared plugin-execution layer (runtime param guard)** | the shared executor call site where any plugin is invoked (SA to identify precise home) | 4 |
| **Extract input wiring / object handoff** | DSL binding of `extract_structured_data` params; `document-extractor-plugin-executor.ts` (L48, L61-94); template resolver (`variable-store.ts` L119-130 object-preservation slice) | 8 |
| **Flatten parent-field carry-forward** | `lib/pilot/StepExecutor.ts` `transformFlatten` (L5071-5080 — runtime slice validated) + generation reference shape | 9 |
| **AI-step scatter loop-variable wiring** | DSL generation of `ai_processing` step `input`/context inside a scatter (inject the referenced `itemVariable`); same family as WP-58 | 11 |
| Plugin definitions (producer truth) | e.g. `lib/plugins/definitions/google-mail-plugin-v2.json` (L305-310, L408-435; `send_email` scalar output) | 3, 4, 6, 8 |
| Calibration static validators | `lib/pilot/shadow/StructuralRepairEngine.ts` (L1737-1768, L829-888), `lib/pilot/shadow/ScatterItemFieldValidator.ts` (L164-205) | 3, 5 |
| Calibration correction / backfill | calibration repair path in `lib/pilot/shadow/` (reuses shared core) + audit trail | 7 |
| **Calibration verdict + coverage (both-direction meaningful-data floor)** | `app/api/v2/calibrate/batch/route.ts` (L4316/L4636, L4444-4445), `CalibrationVerdict.ts` (L155-204, L168-176), `ExecutionSummaryCollector.ts` (L78-103, L217), `WorkflowPilot.ts` (L1220-1234), `DryRunValidator.ts` (L55-121), `IssueCollector.ts` (L314-327, L896-906) | 6, 7, 10, G1 |
| **All-failed / all-empty step detector** | extractor swallow path `DeterministicExtractor.ts` (L247-250), `document-extractor-plugin-executor.ts` (L145-151); scatter degraded-output signal (calibration) | 10 |
| Design intent | `docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` (L116, L163-165) | 1, 3 |

**Fix-owners:** `v6-pipeline` (Items 1-3, Item 4 compile-time advisory, Item 8 generation slice, Item 9 reference-shape slice, **Item 11 generation wiring**), **shared plugin-execution layer** (Item 4 runtime guard), **`lib/pilot` StepExecutor** (Item 9 `transformFlatten` runtime slice; Item 8 resolver-hardening slice — placement pending SA Round 3), `calibration` (Items 5-6, 7, 10, G1 verdict plumbing). The Phase 0 shared core's home is SA's call.

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

## SA Batch 3 Design — generation-side fixes

**Reviewed by SA — 2026-07-12** · Design + sequencing pass for the final batch (V6 generation/compiler side). Consulted per V6 Work Protocol: `V6_DESIGN_PRINCIPLES.md` (P1 runtime tolerance, P6 no plugin-hardcoding, P7 fix-at-root-cause, P8 exercise semantics, P11 don't-hide-failure, Anti-pattern D over-correction), `WEAK_POINTS.md` (WP-56 field-fidelity family; **WP-58** multi-input AI wiring — documented + deferred P3, the exact machinery Item 11 needs), and the two live re-run RCAs. Verified the shipped shared core (`lib/schema-reconciliation/` — `normalizeFieldName`, `isSameFieldDifferentSpelling`, `indexProducerFields`, `reconcileAgainstIndex`, `ReconciliationResult`; **no call sites wired yet** — exactly as the "one core, four+ call sites" constraint intends). Advisory/design only.

### 1. Resolved SA Round 3 placement questions (Items 8 / 9 / 11)

- **Item 8 (object handoff):** confirmed split. The **runtime resolver slice already shipped (batch 1)** is the existing-agent fix; the **generation binding slice ships in batch 3** (owner `v6-pipeline`) for new agents. Ruling detail below in 3C — the generation binding must be **annotation/semantic-driven, not a fuzzy name match**, because `file_content ← .data` is a *semantic role* mapping, not a spelling variant.
- **Item 9 (parent-field carry-forward):** confirmed split. The **runtime `transformFlatten` slice is validated/shipped**; the **generation reference-shape slice ships in batch 3** (reference the actually-carried names so new agents don't reintroduce the mismatch). Low risk, additive.
- **Item 11 (AI step missing its loop variable):** confirmed **needs both** a durable generation-wiring fix (new agents) **and** a one-shot in-place fix for `0ee53785` (it does **not** self-heal on recalibration). **Ruling on the in-place question (the doc's open Q):** for `0ee53785` now, apply a **targeted, scripted in-place DSL edit that is *derived from the same generation-wiring logic*** (add the referenced scatter loop variable to step7's input context + inject it as a labelled block) — reproducible and testable, **not** a hand-hacked JSON. **Do NOT** generalise this into the always-on calibration corrector in this batch: auto-injecting AI-step inputs into stored agents on every recalibration is a broader, riskier capability that needs its own design — **defer that generalisation to a later cycle.** So: durable generation fix (batch 3) + scripted in-place edit for `0ee53785` (batch 3) + calibration-corrector generalisation (later cycle).

### 2. Recommended implementation sequence (sub-phased; Item 11 first)

**Sub-phase 3A — Item 11 (PRIORITY: the last blocker on `0ee53785`'s green).**
- **Phase/area:** IR converter (`IntentToIRConverter`) + AI resolver (`compiler/resolvers/AIOperationResolver`) + IR types (`declarative-ir-types-v4` — add `additional_inputs` to the AI config, mirroring the transform config that already has it). This is the **root-cause phase** (P7): the node-level `inputs` already carry the graph deps, but the AI config takes only the *first* as its prompt payload — the loop variable and other referenced vars survive as prose the model can't read as data.
- **Approach (2-3 sentences):** When building an AI/processing step, determine its input context from the *union* of (a) the primary input and (b) every variable the instruction references — including the enclosing scatter's loop variable and any config/aggregate vars. Populate those into `additional_inputs`; have the resolver inject each as a **labelled `{{var}}` data block** in the prompt (the WP-58 fix shape). This is deterministic wiring, not a prompt nudge (constraint #2).
- **Risk:** **MEDIUM** — it changes the AI prompt payload, so it changes AI output; the regression suite is content-blind (see §3).
- **Reuses machinery:** **yes — the deferred WP-58 fix is exactly this mechanism.** Implement it generically and close WP-58 as part of Item 11.
- **`0ee53785`:** after landing the generation fix, apply the scripted in-place edit (per §1) and recalibrate. Combined with the batch-1 coverage-floor redesign, this yields a fully-populated report + honest pass.

**Sub-phase 3B — Items 1 (Gap A) + 2 (Gap B): the durable field-name reconciliation (the two remaining shared-core call sites).**
- **Item 1 — phase/area:** Phase-2 `DataSchemaBuilder` (within `CapabilityBinderV2`). **Approach:** add a dedicated post-pass (alongside/after the existing derived-schema fixup, **not** inline in the per-step inference, and **not** overloading the shape-preserving fixup — SA Round-1 D1) that, for each `ai_declared` transform slot, **resolves the producer slot including dotted-path input resolution**, indexes the producer fields via the shared core (`indexProducerFields`), and reconciles the declared names via `reconcileAgainstIndex` — renaming same-field-different-spelling, leaving ambiguous/derived untouched. **The dotted-path resolver is mandatory** (`step.transform.input` is `expense_emails.emails`; a bare slot lookup no-ops exactly like O10a did). **Wire to `lib/schema-reconciliation` — no new copy.** **Risk: MEDIUM-HIGH** (most delicate code; touches the canonical schema; over-correction risk — Anti-pattern D).
- **Item 2 — phase/area:** Phase-5 `ExecutionGraphCompiler` O10a `buildSchemaMap`/reconciler. **Approach:** fix the dotted-path key miss (resolve a dotted `config.input` to the producer schema so O10a actually runs) and extend the corrector to inspect **bare `condition.field` literals** (not only `{{var.field}}` templates). **Replace O10a's local `normalizeForFuzzy` copies with the shared core's normaliser** (consolidation, P5). **Risk: MEDIUM** (generic compiler-correctness; still a rewrite path — guard against rewriting an intentionally-different field).
- **Reuses machinery:** both are the **generation + compiler call sites of the Phase-0 core** — confirm both import from `lib/schema-reconciliation` and add zero reconciliation logic of their own.

**Sub-phase 3C — Items 8 & 9 durable generation bindings.**
- **Item 8 — phase/area:** the field-binding step (IR converter / compiler param wiring). **Approach:** when a plugin-action object feeds another plugin action, bind the consumer's params to the producer's **specific fields** (`.data`/`.mimeType`/`.filename`) instead of the whole object into one scalar. **Critical principle call-out:** the `mime_type ← .mimeType` / `filename ← .filename` legs are fuzzy-matchable (reuse the shared core), but `file_content ← .data` is a **semantic-role mapping**, so drive it from the **plugin's semantic annotations** (the `x-semantic-type: file_attachment` mechanism WP-57 already established) — **never** a `if plugin === gmail` branch (P6 / Anti-pattern F). **Risk: MEDIUM.** **Scope flag:** this is clean only where the file-attachment output is annotated (Gmail/Drive are, per WP-57); generalising object-handoff binding to *un-annotated* plugins needs annotation work first — see §4.
- **Item 9 — phase/area:** IR converter / `DataSchemaBuilder` reference-shape. **Approach:** generation references the parent-field names the flatten actually carries, so new agents don't reintroduce the blank-column mismatch. **Risk: LOW-MEDIUM** (additive).

**Sub-phase 3D — Item 4 compile-time advisory.**
- **Phase/area:** generation/compile surface (the runtime clamp already shipped in batch 2). **Approach:** a small **non-blocking** advisory — "value out of range, fix the source" — reading the same plugin-declared constraints the batch-2 guard reads. Deterministic, never gates the build (SA Round-2). **Risk: LOW.** **Reuses:** the batch-2 constraint reader.

### 3. Regression risk on existing passing scenarios (the suite is content-blind)

The RCA is explicit that Phase E "success" means "ran end-to-end," not "produced correct content" (P8/P9). Every content-affecting item below can turn a currently-passing scenario into a **green-but-wrong** regression that the suite won't catch. Required added coverage:

- **Item 11 (highest exposure):** the prompt payload change alters AI output. **Dev must add a content-asserting test** — a scatter + AI-row-builder scenario asserting the referenced loop-var columns are **populated (non-empty)**, not merely that the step ran. (This is the P8/WP-43 lesson: assert semantics, not shape.)
- **Item 1 (Gap A):** the reconciler could **over-rename a legitimate derived field** (Anti-pattern D / WP-32) and silently corrupt a passing scenario. **Dev must add:** (a) the invariant test (no `ai_declared` transform slot keeps a fuzzy-overlapping-but-differently-spelled field), (b) the negative test (a genuine derived field with no producer counterpart survives untouched), (c) **run every existing regression scenario's phase4 snapshot through the new pass and diff — any field-name change on a currently-passing scenario must be explicitly justified.**
- **Item 2 (Gap B):** dotted-path + bare-`condition.field` rewriting could rewrite a field that was intentionally different. **Dev must add:** a dotted-path schema-map unit test **and** a "correct condition.field left untouched" test.
- **Item 8:** the binding change could misroute a param on a plugin whose handoff previously worked (accidentally) via the runtime resolver. **Dev must add** a plugin→plugin object-handoff scenario asserting each bound param receives the correct sub-field.
- **Item 9:** additive; assert the new-agent DSL references the carried names.

### 4. In-batch vs later cycle

- **In this batch:** Items 11, 1, 2, 8 (annotated-plugin scope), 9, 4-advisory; the scripted in-place edit for `0ee53785`.
- **Defer to a later cycle:** (a) **generalising Item 11 into the always-on calibration corrector** (auto-injecting AI-step inputs during recalibration — broader/riskier, not needed for `0ee53785`); (b) **Item 8 object-handoff binding for *un-annotated* plugins** — gated on completing `x-semantic-type` file-attachment annotations across the plugin set (doing it without annotations would force a plugin-name branch, which P6 forbids); (c) any residual WP-58 polish beyond the referenced-var wiring (e.g. dead aggregate-step cleanup) if it isn't cheap to fold in.

### 5. Path to a green run on `0ee53785`

The data path is already repaired **in place** by the batch-1 runtime slices (Item 8 resolver, Item 9 flatten) and given a fair verdict by the batch-1 coverage-floor redesign. The **only remaining blocker is Item 11** (blank From/Subject/Filename columns), which does not self-heal. So the path to green is: **land Item 11's generation-wiring fix (3A) → apply the scripted in-place DSL edit derived from it to `0ee53785` → recalibrate.** That produces a fully-populated expense report and an honest passing verdict **without regeneration.** Items 1/2/8/9 generation slices make a *regenerated* `0ee53785` (and all new agents) correct at creation, but they are **not** on this specific agent's critical path to green — Item 11 is.

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
| 2026-07-11 | Live re-run #2 fold-in | Folded the two Re-run #2 findings. **Q1 → NEW Item 11** (an `ai_processing` step inside a scatter must be handed the loop variable it references; blank From/Subject/Filename columns; distinct from the now-fixed Item 9; WP-58 family) — Phase 3 generation, needs an in-place DSL edit, does NOT self-heal. **Q2 → folded into Item 6**, reframed as a **both-direction** coverage floor with ONE meaningful-pre-delivery-data signal (fixes both the too-lenient Re-run #1 all-blank case and the too-strict Re-run #2 send-terminating case; three ACs: all-blank still fails, uncounted scalar send can pass, partial → needs_review with columns named) — Phase 1, fix now. Updated North-Star (clean pass needs Item 11 + Item 6), Concrete Failing Example, Implementation Order, G1c (both directions), Integration Points, Fix-owners, and Open Questions (meaningful-value signal; send-executed signal; Item 11 in-place vs generation). Noted Item 9's runtime slice is confirmed working in Re-run #2. |
