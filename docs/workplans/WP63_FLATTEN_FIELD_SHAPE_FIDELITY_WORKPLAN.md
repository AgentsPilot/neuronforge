# Workplan: WP-63 — `flatten` field-shape fidelity (declared snake_case vs plugin native camelCase)

> **Last Updated**: 2026-07-16

**Developer:** Dev
**Requirement / source RCA:** [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md) (primary conclusion §§ 3–8 + "Role of the schema data object" / "Should the compiler have caught this?" — Gap A/B/C)
**WP entry:** [`V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` § WP-63](/docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md)
**Branch:** `agent-failure-troubleshooting` (existing — NO new branch; RM skips branch creation)
**Status:** ✅ Implemented (uncommitted) 2026-07-16 — SA design APPROVED with M1–M4; all folded in. Self-test only; not committed.
**Date:** 2026-07-16

## Overview

A generated `flatten` transform declares its item `output_schema` with **normalized snake_case** field names (`mime_type`, `message_id`, `attachment_id`, `filename`), but the runtime `transformFlatten` spreads each child **verbatim** (`...child`), preserving the source plugin's **native camelCase** keys (`mimeType`, …). So the flattened items have `mimeType` while the DSL declares/references `mime_type` → downstream `filter` on `condition.field: "mime_type"` matches nothing → `eligible_attachments` empties (`_on_empty:"throw"`) → the scatter iterates nothing → empty/degraded report. The snake_case shape is planted into the canonical `WorkflowDataSchema` via **WP-18 Bug A** and never reconciled against the plugin producer.

This is the **generation-side, transform-declared-schema re-casing** mechanism. It is a **DISTINCT** member of the field-fidelity family — do **not** merge or double-fix with:
- **WP-56** — iteration-variable *wrong-name* (LLM reuses a container's `folder_id` for items that expose `id`). Different mechanism.
- **[`V6_FIELD_FIDELITY_CALIBRATION_PHASE0_PHASE1_WORKPLAN.md`](/docs/workplans/V6_FIELD_FIDELITY_CALIBRATION_PHASE0_PHASE1_WORKPLAN.md)** — the **calibration-side** detector/corrector for the family. WP-63 is generation-side.

## Design guardrails (V6 Design Principles)

- **Principle 6 / Anti-pattern F — no hardcoding.** The reconciliation MUST be driven by the producing plugin action's real `output_schema`. **No field-name lists, no snake↔camel translation table, no plugin/action-identity branches.** The producer schema is the single source of truth.
- **Principle 7 — fix at root cause.** The lie originates in Phase 2 authoring (`DataSchemaBuilder`); that is Gap A and the primary fix.
- **Principle 4 — wide grammar, wide tolerance.** WP-18 Bug A intentionally lets an LLM-declared `output_schema` win (for genuinely shape-changing ops). The fix must preserve that where the producer shape is *not* knowable, and only reconcile where it *is*.
- **Principle 2 / 11 — no silent fabrication / defense-in-depth must not hide failures.** A genuinely-absent field must be surfaced, never silently dropped or fabricated.

## Root-cause code paths (verified 2026-07-16)

| Gap | Location | What's there today |
|---|---|---|
| **A (planting)** | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` `inferSchemaForTransformStep` **L282–287** (WP-18 Bug A) | `if (step.transform.output_schema) return convertJsonObjectToSchemaField(..., 'ai_declared')` — returns the declared snake_case shape verbatim, **before** the flatten-unwrap path (L289–295) that would inherit the producer's real item fields. No reconciliation. |
| **A (fixup miss)** | Same file, `fixupDerivedTransformSchemas` **L711–739** | Gated to `SHAPE_PRESERVING_OPS` (`filter/sort/dedupe`) only (L719) and only fills `items.type==='any'` — never revisits a concrete-but-wrong `ai_declared` `flatten` slot. |
| **B (compiler net exists but misses)** | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` `reconcileTransformSchemaWithUpstream` **L3316–3348** + gating in `buildSchemaMap` **L3276–3283** | O10a **already implements** the schema-driven normalized-key reconciliation (`normalizeForFuzzy = toLowerCase().replace(/[_\-]/g,'')`, matches declared→upstream by normalized name). **But it misses this case:** (i) `buildSchemaMap` looks up `fullSchemaMap.get(inputVar)` where `inputVar = config.input`; step2's `config.input` is the **dotted path** `expense_emails.emails`, but `fullSchemaMap` is keyed by bare `output_variable` (`expense_emails`) → lookup returns `undefined` → reconciliation skipped. (ii) It reconciles the transform's own `output_schema` props, but the filter's **bare `condition.field` literal** `"mime_type"` is a string, not a `{{var.field}}` ref, so `checkSingleRef` never rewrites it. |
| **C (no plugin-truth gate)** | `ExecutionGraphCompiler` `getActionOutputSchema` **L480** / `schemaContainsField` | Plugin-truth field validation exists **only** inside `x-variable-mapping` param normalization, scoped to `fetch`/`deliver` steps — no general gate that a transform/scatter reference exists in the producing plugin action's real output. |
| Runtime truth (do NOT change) | `lib/pilot/StepExecutor.ts` `transformFlatten` **~L5019–5097** | Spreads `...child` verbatim + `_parentId`/`_parentData`. Correct behavior — the DSL must match it, not vice-versa. |
| Plugin truth | `lib/plugins/definitions/google-mail-plugin-v2.json` `search_emails` `attachments[]` = `filename`, `mimeType`, `size`, `attachment_id`, `message_id` (NO `mime_type`) | Source of truth for the reconciliation. |

## Gap tasks (files + approach)

### Gap A — PRIMARY: reconcile the `ai_declared` transform item schema at Phase 2 authoring
**File:** `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` (+ possibly the reference rewrite in `CapabilityBinderV2.reconcileFieldReferences`).

- **A1.** In `inferSchemaForTransformStep`, when a transform declares an `output_schema` AND its input resolves (through the flatten `field` / dotted input) to a **plugin-produced** slot whose real item field names are knowable, reconcile the declared item field names to the producer's real names via a **shared normalized-key match** (see Q1) BEFORE returning the `ai_declared` schema. This is the surgical WP-18-Bug-A refinement: declaration still wins for *structure*, but field *names* are corrected to the producer's real names where the producer shape is knowable.
  - Must resolve the **per-item-nested** flatten path: `flatten` with `field: "attachments"` over input `expense_emails.emails` → the flattened item shape is `expense_emails.emails[].attachments[]` items (navigate input array → `field` sub-array → items), not merely `input.items`. Locate/confirm the flatten `field` param on the `TransformStep` config.
- **A2.** Rewrite the **downstream references** that were authored against the wrong declared names so the persisted DSL is self-consistent: `filter.condition.field`, scatter `itemVariable.<field>` refs. Decide the exact layer (DataSchemaBuilder vs `CapabilityBinderV2.reconcileFieldReferences`, which already walks refs) — see Q3. This closes the reference side that Gap C would otherwise only *flag*.
- **A3.** Preserve WP-18 Bug A for genuinely shape-changing ops with no knowable producer item shape (map/group/select emitting new fields) — reconcile only names that have a producer match; leave genuinely-new fields untouched (see Q2).

### Gap B — belt-and-suspenders: extend the existing compiler O10a
**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`.

- **B1.** In `buildSchemaMap` (L3276–3283), resolve a **dotted-path** `config.input` (`expense_emails.emails`) to its base variable (`expense_emails`) and navigate, so `fullSchemaMap.get(...)` finds the upstream schema and O10a runs. (Reuse `baseVarOfRef` from `ExtractionCoverage.ts` — already the shared ref-normalizer.)
- **B2.** Extend reconciliation to the filter's **bare `condition.field` literal** (not just `{{var.field}}` refs): when a transform/filter references a field by bare name against a reconciled producer slot, rewrite the literal to the producer's real name via the same normalizer.
- **B3.** This is the safety net for legacy/cached IR generated before Gap A and for any reference Gap A's rewrite doesn't reach. Scope: **extend the existing O10a**, not new machinery. (Q3: confirm still-needed.)

### Gap C — plugin-truth validation gate
**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (new lightweight pass) or a Phase-2 validator.

- **C1.** A pass that walks each step's declared `output_schema` (and transform/scatter field references) whose lineage traces to a plugin action and asserts each field name exists (by normalized match) in that action's real `output_schema` (via the existing `getActionOutputSchema`). On divergence with **no** normalized match → surface (warning or hard-fail per Q3). This is the "fail-fast at generation instead of silently emptying at runtime" gate the RCA calls Gap C.
- **C2.** Must not false-positive on legitimate transform-computed/derived fields (Q2/Q3).

## Design questions for SA (Q1–Q4) — recommendations only; SA/user decide

### Q1 — How to match declared→producer field WITHOUT hardcoding?
**Recommend:** reuse the **normalized-key match already implemented in O10a** — `normalizeForFuzzy(s) = s.toLowerCase().replace(/[_\-]/g,'')` (`ExecutionGraphCompiler.ts` L3322) — matching each declared item field's normalized form against the producer slot's declared item field names (extracted from the producer's real schema tree, e.g. `extractAllFieldNames`). Purely producer-schema-driven; no snake↔camel table, no field-name list (Principle 6 / Anti-pattern F). **Load-bearing recommendation:** extract this normalizer + upstream-field extraction into ONE shared helper used by BOTH Gap A (DataSchemaBuilder) and Gap B (compiler O10a), so the two cannot diverge — this is the exact "one shared definition" lesson from the WP-62 SA Round-1 HIGH and the WP-62 hotfix `BYTES_FIELDS` de-dup. SA to rule on the normalizer's exact form and where the shared helper lives.

### Q2 — Declared field with NO normalized producer match (genuinely absent, not re-cased)?
**Recommend:** **keep-and-flag, NEVER reconcile-drop.** Dropping risks silently removing a field a downstream step needs (Principle 2/11 — failures stay visible; no silent data loss). Two sub-cases the pass cannot always distinguish deterministically: (a) a **legitimate transform-computed** field (new derived field — keep, no flag); (b) a **mis-named/hallucinated** reference to a producer field (genuine defect — flag). Safe default: **keep the declared field, and let Gap C decide whether to warn or gate.** For **re-cased** fields (normalized match found) → reconcile silently to the producer's name. SA to rule: is keep-and-flag correct, and should (a) vs (b) be distinguished (e.g. only flag fields the transform declares as *sourced-from-input* vs *computed*)?

### Q3 — Layering: is Gap B needed if Gap A is done? Gap C hard-fail or warning?
**Recommend:**
- **Gap A does both schema + downstream-reference rewrite** so the persisted DSL is self-consistent (root-cause, Principle 7).
- **Gap B is still worth doing as belt-and-suspenders** — it's cheap (extend the *existing* O10a lookup), and it's the only net for **legacy/cached IR** already on disk and for any reference path Gap A's rewrite scope doesn't reach. Recommend **keep both**, scoped as "extend existing O10a," not new machinery.
- **Gap C: warning-by-default, not hard-fail — initially.** A hard gate risks false-positives on legitimate transform-computed fields (Q2 case a) and could block valid workflows (Principle 3 — don't be stricter than runtime). Start as a loud, calibration-surfaced warning; consider escalation to hard-fail once the false-positive rate is understood. SA/user to decide severity + the A2 reference-rewrite layer (DataSchemaBuilder vs `CapabilityBinderV2.reconcileFieldReferences`).

### Q4 — Is the calibration-detector fix (`StructuralRepairEngine.findBrokenVariableReferences` scatter-itemVariable builtins gap, ~L1759) in-scope for WP-63?
**Recommend: OUT of scope for WP-63 — route to the field-fidelity calibration workplan.** Reasons: (1) it's **calibration-side** (a shadow validator), while WP-63's owner is `v6-pipeline` **generation**; (2) [`V6_FIELD_FIDELITY_CALIBRATION_PHASE0_PHASE1_WORKPLAN.md`](/docs/workplans/V6_FIELD_FIDELITY_CALIBRATION_PHASE0_PHASE1_WORKPLAN.md) already owns calibration-detector work for this family — putting the scatter-itemVariable-builtins fix there avoids cross-workplan double-fix; (3) fixing Gap A/B removes the ROOT cause (the schema won't carry the wrong names), shrinking the detector's false-positive surface anyway. **Recommend logging it as a tracked follow-up pointer to that calibration workplan, not implementing it in WP-63.** SA/user to confirm.

## Acceptance Criteria

- [ ] **AC-1 (the proven shape reconciles).** For the `0ee53785` / `2ffcd7bf` Gmail scatter-attachment shape (`search_emails → flatten attachments → filter → scatter[...]`), the flatten's data_schema item slot uses the producer's real camelCase names (`mimeType`, `filename`, `attachment_id`, `message_id`), the filter's `condition.field` and scatter `itemVariable.*` refs resolve to real fields, and the filter populates on real data (no empty-pipeline).
- [ ] **AC-2 (re-cased case).** Declared `mime_type` with producer `mimeType` → reconciled to `mimeType` silently (schema + downstream refs).
- [ ] **AC-3 (genuinely-absent case, safe).** Declared field with NO normalized producer match → kept + surfaced (warning/gate per Q2/Q3), NEVER silently dropped, NEVER fabricated.
- [ ] **AC-4 (no hardcoding).** No field-name list, no snake↔camel table, no plugin/action-identity branch anywhere; reconciliation is producer-schema-driven via ONE shared normalizer (SA-verified vs Principle 6 / Anti-pattern F).
- [ ] **AC-5 (WP-18 Bug A preserved).** A genuinely shape-changing transform (map/group emitting new fields) still uses its declared schema; reconciliation only touches field names with a producer match.
- [ ] **AC-6 (Gap B legacy net).** Extended O10a reconciles a dotted-path `config.input` and a bare `condition.field` literal for cached/legacy IR.
- [ ] **AC-7 (determinism).** Same IntentContract → same reconciled schema + refs across repeated builds.
- [ ] **AC-8 (regression scenario).** Committed scenario asserts both AC-2 (re-cased) and AC-3 (absent) boundaries through the pipeline.

## Regression-test plan

- **Unit — Gap A (`DataSchemaBuilder`):** re-cased flatten item field → reconciled to producer name; per-item-nested flatten (`field:"attachments"` over `expense_emails.emails`) resolves the real `attachments[]` item shape; genuinely-absent field → kept + flagged (not dropped); legitimate computed field on a map/group → untouched (WP-18 Bug A preserved); downstream `filter.condition.field` + scatter ref rewrite.
- **Unit — Gap B (`ExecutionGraphCompiler` O10a):** dotted-path `config.input` now resolves upstream schema; bare `condition.field` literal reconciled; existing O10a `{{var.field}}` cases still pass (no regression).
- **Unit — Gap C:** gate flags a transform field absent from the producing plugin action's real output; does NOT flag a re-cased field (reconciled) or a legitimate computed field.
- **Shared-normalizer test:** one helper, used by Gap A + Gap B, proven identical (guard against the divergence class).
- **Regression scenario:** extend the existing `tests/v6-regression/scenarios/gmail-scatter-attachment-extract/` (same shape as the WP-63 incident) — assert the compiled flatten `output_schema` + step3 `condition.field` use camelCase and the filter populates; add an absent-field variant. Follow `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md`; run repeatedly for determinism.
- **Full v6 suite** unchanged vs the pre-existing failing baseline (currently 5 suites / 43 tests fail pre-existing) — zero new failures.

## V6 Protocol checklist

- [ ] SA design review of Q1–Q4 BEFORE implementation (no-hardcoding-sensitive; new decision surface — Mandatory Rule #7).
- [ ] On fix: update WP-63 in WEAK_POINTS to ✅ Fixed (commit + date) + Change History; remove/adjust the OPEN_ITEMS pointer; extend V6_DESIGN_PRINCIPLES if a new pattern emerges (candidate: "reconcile an `ai_declared` transform schema to its producer before admitting to the canonical data-schema").
- [ ] Regression scenario committed with updated `scenario.json` fields.
- [ ] Structured Pino logging on new decision points; flag any touched `console.*` file.
- [ ] Cross-references kept accurate (WP-56, field-fidelity calibration workplan) — no double-fix.

## Risks & open points

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Distinguishing a **re-cased** field from a **genuinely-absent** one is the crux; over-eager reconciliation could rename a legitimate computed field to a coincidental producer match. | Normalized-key match is exact-after-normalization (not fuzzy Levenshtein), so coincidental matches are unlikely; keep-and-flag for no-match (Q2); Gap C surfaces rather than silently rewrites. SA to rule. |
| R2 | The A2 downstream-reference rewrite touches DSL shape (filter/scatter) — mis-rewrite risk. | Dedicated unit tests; Gap B as compiler-side net; determinism test. SA to confirm the rewrite layer. |
| R3 | Shared-normalizer divergence (Gap A vs Gap B copies) — the exact class SA flagged HIGH in WP-62. | One shared helper, proven by a co-located test (Q1). |
| R4 | Per-item-nested flatten `field` navigation may have edge cases (multi-level, missing `field`). | Reuse/extend the existing flatten-unwrap logic (DataSchemaBuilder L289–295); test the `field:"attachments"` path explicitly. |

## Implementation Summary (Dev, 2026-07-16)

SA APPROVED the design and added M1–M4 + AC-9/10/11; all folded in. **Not committed** (self-test only).

**Files changed (grouped):**
- **Shared helper:** `lib/agentkit/v6/capability-binding/field-name-reconciliation.ts` (new) — `normalizeForFuzzy` (the ONE normalizer), `collectRawFieldNames`, `buildNormalizedMap` (M1 collision→ambiguous), `reconcileFieldNames`, `isFieldPreservingOp`/`isFieldSynthesizingOp` (Q2), `FLATTEN_BUILTINS` (M2).
- **Gap A:** `DataSchemaBuilder.ts` — Pass 2d `reconcileAiDeclaredTransformSchemas` + `reconcileSlotAgainstProducer` + `resolveInputSlotSchema` (M3 dotted) + `renameItemSchemaFields` + `recordFieldRename`; `build()` now returns `fieldRenames`.
- **A2:** `CapabilityBinderV2.ts` — `applyTransformFieldRenames` (M4: `{kind:"ref"}` + `{{var.field}}` templates + bare `key_field` literals, scoped by the reconciled schema, no second fuzzy match) + `resolveVarSchema`; called right after `build()`.
- **Gap B/C:** `ExecutionGraphCompiler.ts` — `reconcileTransformSchemaWithUpstream` refactored onto the shared helper (M1-safe) + `rewriteConditionFieldLiterals` (B2 bare `condition.field`); `buildSchemaMap` dotted-input base-var fallback (B1); op-scoped Gap C warning; `resolveFieldMismatch` folded onto the shared normalizer; removed the duplicate local `extractAllFieldNames`.
- **Tests:** `field-name-reconciliation.test.ts` (11), `DataSchemaBuilder.wp63.test.ts` (6), `DataSchemaBuilder.wp63.e2e.test.ts` (2), `CapabilityBinderV2.wp63.test.ts` (4), `ExecutionGraphCompiler.wp63.test.ts` (4) = **27 tests**.

**M1–M4:** M1 collision guard (ambiguous → never rewrite); M2 flatten universe child∪parent∪builtins, builtins never flagged; M3 dotted producer resolution; M4 all ref shapes from one rename map, scoped, no second fuzzy match. **AC-1..AC-11 all covered** (see tests). Full v6 suite unchanged at the 43-failure pre-existing baseline (passed +27); zero `console.*` in touched files; zero new type errors. Live Phase E not runnable in the Dev env; Q4 out of scope → field-fidelity calibration workplan.

## SA Review Notes

**Reviewed by SA — 2026-07-19**
**Verdict: 🔄 CHANGES-REQUIRED-TO-PLAN.** The Gap A/B/C decomposition is architecturally correct, roots the fix in the right phase (Principle 7), and the no-hardcoding posture is sound. But four concrete must-adds are needed before implementation — three of them close false-flag / divergence traps that would otherwise reproduce the exact class of bug this WP fixes (or a WP-62-style resolver divergence). These are refinements, not a rejection: proceed to implement once the plan absorbs M1–M4.

Code paths independently verified against HEAD: `DataSchemaBuilder.inferSchemaForTransformStep` L269-324 (plant site L285-287 returns `ai_declared` verbatim **before** the flatten-unwrap L290-295); `ExecutionGraphCompiler.reconcileTransformSchemaWithUpstream` L3316-3350 (`normalizeForFuzzy` L3322, `extractAllFieldNames` L3328 — schema-driven, zero lists) + `hasCasingFixes` guard L3337 (exact-name → no-op, so a correct schema is untouched **unless** a normalized collision exists — see M1); `CapabilityBinderV2.reconcileFieldReferences` L705 (called Phase 2 at L204, the correct A2 home); runtime `StepExecutor` flatten L5126-5140 (`...child` child-precedence + `_parentId`/`_parentData`) and the item resolver L4588-4590 (resolves `item.field` against child **then** `_parentData` parent fields); `TransformOp` enum (`intent-schema-types.ts` L395-405) + `with_fields.fields[]` L436.

### Ruling — Q1 (no-hardcoding match + shared helper): APPROVE, with M1
- **Confirmed schema-driven.** `normalizeForFuzzy(s)=s.toLowerCase().replace(/[_\-]/g,'')` matched against `upstreamByNormalized` built from the producer's real schema tree (`extractAllFieldNames`). No field-name list, no snake↔camel table, no plugin/action-identity branch. Satisfies Principle 6 / Anti-pattern F / AC-4.
- **Shared-helper requirement CONFIRMED and mandatory** (this is the WP-62 Round-1 HIGH / `BYTES_FIELDS` de-dup lesson): extract `normalizeForFuzzy` **and** `extractAllFieldNames` **and** the dotted-input slot resolver (see M3) into ONE pure module consumed by both Gap A (`DataSchemaBuilder`, Phase 2) and Gap B (`ExecutionGraphCompiler`, Phase 5). Recommended location: a dedicated `lib/agentkit/v6/capability-binding/field-name-reconciliation.ts` — **not** `ExtractionCoverage.ts` (that module is bytes/extraction-semantic; reuse `baseVarOfRef` from it, but do not overload it with field-fidelity logic). Co-locate the "one helper, identical output" test (workplan already lists it).
- **M1 (MUST-ADD) — collision guard.** `extractAllFieldNames` builds a `Map<normalized, canonical>` that is **last-wins**. If a producer element exposes two fields with the same normalized form (e.g. `message_id` **and** `messageId`, or `mime_type` **and** `mimetype`), the map is ambiguous and the reconciler could (a) rewrite a *correct* declared field to a colliding sibling, or (b) pick the wrong canonical. The shared helper MUST detect a normalized key that maps to >1 distinct canonical upstream name and **refuse to reconcile that key** (keep declared + flag ambiguous), never guess. This is the direct answer to "two producer fields normalize to the same key" and is the only way a *correct* schema could be corrupted (R1). Add an AC (see AC gaps).

### Ruling — Q2 (computed vs mis-named discriminator): APPROVE keep-never-drop, but SHARPEN — the crux is decidable deterministically
Dev's recommendation defaults to "keep-and-flag, cannot always distinguish (a) computed from (b) mis-named deterministically." **It can be distinguished deterministically — by the transform OP's runtime field semantics, not by a per-field grammar marker and not by a fuzzy guess.** This is the ruling that makes Gap C false-positive-safe:

- **Field-PRESERVING ops** — the runtime passes the producer's element fields through verbatim: `flatten` (`...child`), `filter`, `sort`, `dedupe`, `project_column`, `set_difference`. For these, **every** declared output field (minus runtime builtins `_parentId`/`_parentData`) MUST trace to the producer element shape. Normalized match → silent re-case (Gap A). **No match → genuine defect → keep + flag (Gap C may flag/gate safely).** For the proven `flatten` case this is unambiguous: flatten cannot synthesize a field, so a no-match field is always a defect.
- **Field-SYNTHESIZING ops** — the op legitimately emits new field names: `with_fields`, `map`, `group`, `reduce`, `merge`, `select`, `custom`. For these, a declared field with no producer match is **legitimately computed** → reconcile only the fields that DO match (silent re-case), and **NEVER flag** an absence. For `with_fields`, the explicit `fields[]: {name, expression}` list (`intent-schema-types.ts` L436) enumerates the computed names *precisely* — exempt exactly those, still trace the rest. This preserves WP-18 Bug A (AC-5) by construction and eliminates the Gap C false-positive on computed fields (R1).
- **Discriminator source:** the op is already in `step.transform.op`; the preserving/synthesizing split is a small explicit set (extend the existing `SHAPE_PRESERVING_OPS`/`SHAPE_CHANGING_OPS` with a `FIELD_PRESERVING_OPS` set — note `flatten` is shape-*changing* in cardinality but field-*preserving*, so it needs its own axis; do not reuse the cardinality sets verbatim). No per-field grammar addition needed.
- **M2 (MUST-ADD) — flatten producer shape is child ∪ parent ∪ builtins.** The runtime resolves a flattened `item.field` against the child first, then `_parentData` parent fields (`StepExecutor.ts` L4588-4590), and always adds `_parentId`/`_parentData`. So the reconciliation/validation "producer element shape" for a `flatten` is NOT merely `input.<field>.items` (the child) — it is **child(`input.<field>[]` items) ∪ parent(`input[]` items, minus the flattened `field`) ∪ {`_parentId`,`_parentData`}**. If Gap A/Gap C reconcile only against the child sub-array, a declared field legitimately sourced from the parent email (e.g. `message_id` surfaced via `_parentData`) with no child match would be false-flagged/mis-handled. A1 as written ("navigate input array → field sub-array → items") is **incomplete** — add the parent union and the builtins exemption.

### Ruling — Q3 (layering + A2 rewrite layer + Gap C severity): APPROVE all three, with M3/M4
- **Gap A = primary/root (Phase 2).** Correct per Principle 7.
- **Gap B = keep (belt-and-suspenders).** Genuinely still needed: it is the only net for **legacy/cached IR already on disk**, and it covers the two shapes the existing corrector structurally misses — the dotted-path `config.input` schema-map key and the **bare `condition.field` literal** (RCA "Regression analysis" §, `ExecutionGraphCompiler.ts` L3507-3572 scope). Scope it as "extend the existing O10a," consuming the M1 shared helper (no second normalizer copy).
- **Gap C = warning-by-default (not hard-fail) — CONFIRMED,** and now **safe** because M-of-Q2 scopes its flagging to the field-preserving op class only. With that scoping the false-positive surface is essentially closed, so a later escalation to hard-fail for the field-preserving class alone is defensible — but start as a loud, calibration-surfaced warning (Principle 3: don't be stricter than runtime while the false-positive rate is unproven).
- **A2 rewrite-layer ruling: `CapabilityBinderV2.reconcileFieldReferences` (Phase 2, L705, already walks refs, runs immediately after `DataSchemaBuilder.build` at L204) — DRIVEN BY the SAME declared→producer rename-map that Gap A produces. Do NOT re-derive the fuzzy match in a second layer.** This is the load-bearing WP-62 lesson (Round-1 HIGH: two components independently recomputing a decision diverge). Gap A must **emit** the rename map (attach it to the reconciled `DataSlot`, e.g. a `_reconciled_renames` field); A2 **consumes** it. One match, two consumers (schema + refs). Rationale for this layer over the compiler: it is the same phase as the schema authoring (so schema and refs are rewritten from one source, atomically), and `reconcileFieldReferences` already owns ref-walking — the compiler (Gap B) then only needs to catch what predates or escapes Phase 2.
- **M3 (MUST-ADD) — dotted-input resolution is a shared PREREQUISITE for Gap A too, not just Gap B.** `DataSchemaBuilder.inferSchemaForTransformStep` L280 does `slots[inputRef]`; for step2 `inputRef = "expense_emails.emails"` (dotted), `slots` is keyed by the bare var `expense_emails`, so `inputSlot` is **null** and Gap A can't even locate the producer to reconcile against (and the existing flatten-unwrap L290-295 already silently no-ops for the same reason). Gap A MUST resolve `inputSlot` via `baseVarOfRef(inputRef)` + navigate the dotted tail (`.emails`) into the slot schema — the identical resolution B1 gives Gap B. Put this resolver in the M1 shared helper so both phases resolve identically.
- **M4 (MUST-ADD) — A2 must enumerate ALL downstream ref shapes, or the divergence trap reappears.** If Gap A rewrites the schema slot to `mimeType` but A2 leaves the **bare `filter.condition.field`/`where.field` literal** as `mime_type`, the filter STILL empties — the exact failure, now with a "reconciled" schema masking it. A2 must cover: (i) bare `filter.condition.field` / `transform.where.field` string literals; (ii) scatter `itemVariable.<field>` refs inside loop-body sub-steps; (iii) `{{flattenVar.field}}` templates. Any ref shape A2 does not reach is the divergence trap — and is exactly why Gap B (bare-literal + dotted-input net) must ship alongside, not instead.

### Ruling — Q4 (calibration detector, `StructuralRepairEngine.findBrokenVariableReferences` ~L1759): CONFIRM out-of-scope — but correct the rationale
- **OUT of scope for WP-63 is correct** (calibration-side; different owner; belongs in `V6_FIELD_FIDELITY_CALIBRATION_PHASE0_PHASE1_WORKPLAN.md`). Route it there as a tracked pointer.
- **Correct the stated reason.** The plan says fixing Gap A/B "shrinks the detector's false-positive surface anyway." That understates it as a mere confluence. The scatter-`itemVariable`-not-in-scope flag is a **genuinely separate defect**: the builtins allow-list (L1759) omits scatter item variables entirely, so `{{attachment_item.*}}` is flagged **even when every field name is correct**. Gap A/B removes the field-fidelity *confluence*, but the itemVariable-in-scope noise persists for **every** scatter regardless. Track it as its own item with its own fix (teach the detector to resolve `{{itemVariable.field}}` against the iterated element schema, as `ScatterItemFieldValidator` already does) — do not imply the generation fix mostly handles it.

### Does Gap A actually fix the root cause? / divergence-trap check
Yes — Gap A (reconcile the `ai_declared` flatten slot to the producer element shape) + A2 (rewrite the downstream refs from the same rename-map) makes the persisted DSL self-consistent in camelCase, so the filter populates. **Provided M2 (parent∪child∪builtins producer shape), M3 (dotted-input resolution), and M4 (complete ref-shape coverage) land** — without any one of them there is a path where Gap A rewrites the schema but a ref (bare condition.field, or a parent-sourced field) is left inconsistent: the divergence trap. Gap B is the standing net for that residue and for legacy IR.

### Acceptance-criteria adequacy — one boundary under-proven
AC-2 (re-cased→reconciled) and AC-3 (genuinely-absent→kept+surfaced) cover the two headline boundaries. **Add three ACs** so the false-positive-safety of the design is actually proven (these are what make Gap C shippable):
- **AC-9 (computed-field NOT flagged / synthesizing op):** a `with_fields` (and a `map`) declaring a genuinely-new field with no producer match → reconciled-matches only, computed field **kept and NOT flagged** (the Q2 (a) case; the direct Gap C false-positive guard). AC-5 as written asserts "declared schema still used" but does not assert "no flag on the computed field."
- **AC-10 (normalized collision → no ambiguous rewrite):** producer exposes two fields with the same normalized form → the declared field is **not** silently rewritten to a colliding sibling (M1).
- **AC-11 (flatten parent-sourced field):** a declared flatten field that resolves to a **parent** field via `_parentData` (not the child sub-array) is reconciled/accepted, not false-flagged (M2); and `_parentId`/`_parentData` builtins are never flagged.
AC-8's regression scenario should exercise AC-9 and AC-11, not only the re-cased/absent pair.

### Must-change before implementation
- **M1** collision guard in the shared helper (+ AC-10).
- **M2** flatten producer shape = child ∪ parent ∪ {`_parentId`,`_parentData`}; builtins exempt from Gap C (+ AC-11).
- **M3** dotted-input `inputSlot` resolution in Gap A (shared helper), else Gap A can't locate the producer.
- **M4** A2 rewrites ALL ref shapes (bare `condition.field`/`where.field`, scatter `itemVariable.field`, `{{var.field}}`) from Gap A's single rename-map, in `CapabilityBinderV2.reconcileFieldReferences` — no second fuzzy match (WP-62 no-divergence).
- **Q2 sharpening** adopted: op-semantics discriminator (field-preserving vs field-synthesizing), `with_fields.fields[]` exemption; Gap C flags only the field-preserving class.

Nits (non-blocking): give the shared module a co-located identical-output test (already listed as "Shared-normalizer test" — keep it); log every reconcile/flag via structured Pino with the declared→producer pair (AC-7 observability parallel).

### Approval
[ ] Plan approved as-is — **NO.**
[x] Plan approved to implement **after M1–M4 + the Q2 op-semantics sharpening + AC-9/10/11 are folded into the task breakdown.** No second SA design pass required for those edits; SA code review will verify them against this ruling. If Dev disagrees with the M2 parent-union or the A2-layer ruling, escalate to a short SA/Dev sync rather than diverging silently.

## QA Testing Report
_(QA to populate.)_

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-16 | Initial workplan | Dev drafted Gap A/B/C task breakdown for the flatten field-shape fidelity fix, sourced from `AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md`. Verified current code paths (DataSchemaBuilder WP-18 Bug A L282–287; existing compiler O10a `reconcileTransformSchemaWithUpstream` L3316 + its dotted-input/bare-condition-field miss; Gap C absence). Surfaced Q1–Q4 for SA with recommended answers (Q1 reuse O10a normalizer via ONE shared helper; Q2 keep-and-flag never drop; Q3 Gap A primary + Gap B belt-and-suspenders + Gap C warning-first; Q4 detector fix OUT of scope → route to field-fidelity calibration workplan). Implementation NOT started. |
| 2026-07-19 | SA design review (Q1–Q4) | 🔄 CHANGES-REQUIRED-TO-PLAN. Decomposition approved; four must-adds before implementation: **M1** normalized-collision guard in the shared helper (prevents corrupting a correct schema); **M2** flatten producer shape = child ∪ parent(`_parentData`) ∪ {`_parentId`,`_parentData`} builtins (A1 as written only navigates the child sub-array → would false-flag parent-sourced fields); **M3** dotted-input `inputSlot` resolution is a Gap-A prerequisite too (else `slots["expense_emails.emails"]` is null and Gap A can't locate the producer); **M4** A2 rewrites ALL ref shapes (bare `condition.field`/`where.field`, scatter `itemVariable.field`, `{{var.field}}`) from Gap A's single rename-map in `CapabilityBinderV2.reconcileFieldReferences` — no second fuzzy match (WP-62 no-divergence). Q2 sharpened: computed-vs-misnamed IS deterministic via op field-semantics (field-preserving ops flag no-match; field-synthesizing ops never flag; `with_fields.fields[]` exempt) → makes Gap C false-positive-safe. Q4 out-of-scope confirmed but rationale corrected (separate detector defect, not "shrunk away"). Added AC-9/10/11 (computed-not-flagged, collision, flatten parent-field). A2 layer ruled: CapabilityBinderV2.reconcileFieldReferences (Phase 2), rename-map-driven. |
