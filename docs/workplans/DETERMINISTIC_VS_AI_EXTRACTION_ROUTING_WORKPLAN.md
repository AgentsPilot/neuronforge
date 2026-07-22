# Workplan: Deterministic-vs-AI Extraction Routing — Ordered Coverage-Then-Fallback (WP-57 family)

> **Last Updated**: 2026-07-12

**Author (Dev):** Dev
**Reviewed by (SA):** SA — workplan review + Q1–Q3 design resolution below
**Date:** 2026-07-12
**Status:** In Progress — implementation on `agent-failure-troubleshooting` (Dev, self-test only; SA review + user approval gate follow)
**Branch:** `agent-failure-troubleshooting` (existing branch — per user, NO new feature branch; RM skips branch creation. Eventual commits land here with user approval.)
**Requirement:** [`DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_REQUIREMENT.md`](/docs/requirements/DETERMINISTIC_VS_AI_EXTRACTION_ROUTING_REQUIREMENT.md)
**Source RCA:** [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md)

## Overview

Make the deterministic-vs-AI extraction choice an ordered, reliable-code decision that preserves the AI safety net: (1) file input? (2) does a connected deterministic plugin genuinely cover it (capability + requested fields + file type)? (3) yes → bind deterministic; (4) no → fall back to AI (`convertExtract` AI branch unchanged). This is V6-pipeline work under `lib/agentkit/v6/` + `lib/pilot/`; the V6 Work Protocol applies.

**Locked scope decisions (from user, 2026-07-12):**

| Decision | Resolution |
|---|---|
| Companion scope | **Everything in-cycle** — core coverage-routing fix PLUS B1 (Phase-1 prompt steer, steer-not-decide), B2 (Gmail `get_email_attachment` `x-semantic-type: file_attachment`), B3 (file-vs-text heuristic hardening). |
| "Available" (CC-2) | **Connected-only.** Only plugins connected at generation time count. No connectable-but-unconnected gating this cycle. (Requirement CC-2 already reads "connected".) |
| Branch | **No new branch.** All work on the existing `agent-failure-troubleshooting` branch; RM skips branch creation. |
| Q1–Q3 | **Routed to SA** — resolved in the [SA Workplan Review](#sa-workplan-review--q1q3-design-resolution) section below. |
| Q4 (companion scope) | Closed → all in-cycle (see above). |
| Q5 (uncovered-case test synthetic) | **Accepted** — construct synthetically per the SCRIPTS manual. |
| Q6 (definition of "available") | Answered → connected-only. |

---

## Table of Contents

1. [SA Workplan Review — Q1–Q3 Design Resolution](#sa-workplan-review--q1q3-design-resolution)
2. [Design Summary (post-SA)](#design-summary-post-sa)
3. [Task Breakdown](#task-breakdown)
4. [Test Plan](#test-plan)
5. [V6 Protocol Checklist](#v6-protocol-checklist)
6. [Risks & Open Points](#risks--open-points)
7. [Change History](#change-history)

---

## SA Workplan Review — Q1–Q3 Design Resolution

> **SA verdict on the workplan: APPROVED IN PRINCIPLE, pending user sign-off on the three design calls below.** The task decomposition is sound and consistent with V6 Design Principles 6/7/11 and Anti-pattern F. The three routed questions are resolved as follows; these resolutions shape Tasks 2–4.

### Q1 — Which stage owns the decision? → **Binder authors it; converter honors it (split with clear ownership)**

**Resolution.** The authoritative coverage-then-bind decision lives in **`CapabilityBinderV2` (bind-time)** — the earliest reliable layer (Principle 7, fix at root cause). The binder runs the coverage predicate and, when covered, produces/keeps a **live `document-extractor` binding**; when not covered, it leaves the extract unbound so the AI branch fires. **`IntentToIRConverter.convertExtract` is made to HONOR (not re-decide) the binder's verdict:**

- The deliver/plugin branch (L633-681) fires when the binder produced a live binding.
- The AI branch (L682-704) fires **only** when the binder genuinely produced no binding — and remains behaviorally unchanged.
- The converter's own file-vs-text heuristic reroute (the O-WP12 path at ~L555-574 → `inputLooksLikeFileAttachment`) MUST NOT strip a live binding the binder authored. This is exactly what B3 (heuristic hardening) fixes: the converter stops overriding the binder.

**Why not "converter owns it":** the RCA shows the AI branch is reached only when `effectivePluginKey` isn't a live binding — i.e., the binding decision is upstream of the converter. Putting the authoritative judgment in the converter would leave the binder free to not-bind for a covered case (gate 3 in RCA § 5), which is one of the proven failure gates. Deciding in the binder closes gate 3; honoring-in-converter + B3 closes gates 1–2.

**Anti-double-decision guard:** exactly one component (the binder) produces the covered/uncovered verdict; the converter consumes a boolean/binding, it does not recompute coverage. No two components may independently answer CC-*.

### Q2 — Judge a requested field "not producible" WITHOUT hardcoding field names → **classify by declared field SOURCE, not by name**

**Resolution.** Producibility is judged from each requested field's **declared value-source in the IntentContract**, never from field-name allow/deny lists (which would violate CLAUDE.md "No Hardcoding / plugin schema is source of truth" and Principle 6 / Anti-pattern F).

A requested field is **deterministically-producible** iff its declared source is a **direct surface read of the extract step's own document/file input**. A field is **not** deterministically-producible when its declared source is:
- **meta/provenance** — about the extraction *process* or the *file container* rather than the document content (e.g. the failing agent's `notes` = "notes about extraction issues", `source_filename` = a property of the file object, not the document), or
- **computed/derived/normalized/cross-record** — requiring reasoning or aggregation the deterministic OCR capability does not perform.

Mechanics (schema-driven, no name lists):
1. `document-extractor.extract_structured_data` accepts a **free-form `fields` list**, so any *surface-source* field is nominally acceptable — coverage for surface fields is therefore gated by CC-1 (document input) + CC-4 (file type) + CC-2 (capability connected), not by a per-name schema entry.
2. The discriminator is the intent field's **declared source**: does it reference the document/file input, or does it reference process-meta / other steps / a derivation? The predicate reads that source from the extract step's field declarations in the IntentContract grammar.
3. Partition requested fields into `{surface-source}` (producible) vs `{meta-or-computed-source}` (not producible by deterministic extraction). Feed the partition to CC-3a (Q3).

**No hardcoding confirmed:** the inputs are (a) the plugin capability schema (what the deterministic capability is declared to do) and (b) the intent field's declared source — both schema/intent-declared. Zero field-name constants, zero plugin-identity branches. If the intent grammar does not currently carry a usable per-field source signal, that is a **grammar dependency** (flagged in Risks R1) — the fallback is CC-3a's conservative behavior, never a name list.

### Q3 — Auto-synthesize the normalization split vs honor-only → **Auto-synthesize (Option B), conservatively scoped**

**Resolution.** **Auto-synthesize the split.** When the predicate finds **≥1 deterministically-coverable surface field AND ≥1 meta/computed field folded into the same extract**, the reliable stage binds the deterministic extractor for the **surface-field subset** and emits a downstream **`generate` (ai_processing)** step for the residual meta/normalization fields, wiring the extractor output as that step's input (the working agent `0ee53785` shape: deterministic extract for surface fields + separate generate).

**Why not honor-only:** honor-only would leave a *folded* plan (the exact `95f791ed` failing shape) landing on AI, so AC-1 (covered → deterministic, **deterministically across generations**) could only be met by relying on the non-authoritative Phase-1 steer (B1) to un-fold the plan — which contradicts the requirement's core premise that reliable code decides. So honor-only is insufficient to fix the proven bug.

**Guardrails:**
- **G1** If splitting would leave **zero** coverable surface fields, do NOT split — fall back to AI whole (CC-3 genuinely fails; the deterministic plugin does not cover this extraction).
- **G2** The synthesized `generate` step must preserve AI-net semantics for the meta fields and MUST NOT fabricate surface data (Principle 2 / Principle 11 — no "Unknown <Field>"; failure stays visible).
- **G3** Already-split plans are honored as-is (no double-split; idempotent).
- **G4** The split is schema-driven and plugin-agnostic (Principle 6) — it keys on the field-source partition from Q2, never on plugin/action identity.

This is the larger change the requirement flagged in Q3 and is why it gets its own workplan phase (Task 4) with dedicated tests.

---

## Design Summary (post-SA)

The end-to-end reliable-code flow, per the SA resolutions:

```
extract step (over a scatter attachment or any file input)
  └─ CapabilityBinderV2:  pluginCoversExtraction(extract, connectedPlugins, inputSchema)
        CC-1 file input?          (bytes-bearing / file_attachment slot — B2 annotation + B3 hardening feed this)
        CC-2 connected deterministic document-extraction capability?
        CC-3 partition requested fields by declared SOURCE (Q2): surface vs meta/computed
        CC-4 file type supported?
        ├─ covered (surface subset non-empty, CC-1∧CC-2∧CC-4):
        │     bind document-extractor for surface fields
        │     if meta/computed residual → synthesize downstream generate step (Q3 / CC-3a, G1–G4)
        └─ not covered:
              leave unbound → convertExtract AI branch (UNCHANGED, net preserved)
  └─ IntentToIRConverter.convertExtract:  HONORS the binder verdict (does not re-decide);
        B3 hardening ensures the file-vs-text heuristic can no longer strip a live binding
  └─ intent-system-prompt-v2.ts §6.4 (B1):  STEERS toward document-domain extract at the bytes field
        with normalization split — steer only; binder is authoritative
```

---

## Task Breakdown

| # | Task | Files (indicative) | Depends on | Est |
|---|------|--------------------|------------|-----|
| **T0** | Write new WP entry (WP-NN) in WEAK_POINTS using the RCA's proposed text; add one-line pointer in OPEN_ITEMS. Do not double-track. | `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`, `docs/v6/V6_OPEN_ITEMS.md` | — | S |
| **T1** | Implement `pluginCoversExtraction` coverage predicate (CC-1..CC-4, schema-driven, connected-only, no name lists) with the Q2 source-based field partition. | new helper in `lib/agentkit/v6/` (SA to confirm module) | T0 | M |
| **T2** | Wire the authoritative decision into **CapabilityBinderV2** (Q1): covered → live binding; uncovered → leave unbound. | `CapabilityBinderV2` | T1 | M |
| **T3** | Make **convertExtract** honor (not re-decide) the binder verdict; AI branch reachable + unchanged for uncovered. | `IntentToIRConverter.ts` (L633-704) | T2 | M |
| **T4** | Auto-synthesize normalization split (Q3): surface subset → deterministic; residual meta/computed → downstream `generate`; guardrails G1–G4. | `IntentToIRConverter.ts` / binder | T2,T3 | L |
| **B1** | Phase-1 prompt steer (steer-not-decide) toward document-domain extract at bytes field with normalization split. | `intent-system-prompt-v2.ts` §6.4 (L903-935) | — | S |
| **B2** | Add `x-semantic-type: file_attachment` to `get_email_attachment.output_schema`. | `lib/plugins/definitions/google-mail-plugin-v2.json` (L708-814) | — | S |
| **B3** | Harden `inputLooksLikeFileAttachment`: resolve loop-internal producer schemas; stop whole-graph text short-circuit (L2271) from overriding the extract input's own producer; ensure it cannot strip a binder-authored binding. | `IntentToIRConverter.ts` (L2205-2278) | T2 | M |
| **T5** | New scatter-attachment regression scenario (`search_emails → flatten → filter → scatter[get_email_attachment → extract]`) per SCRIPTS manual; run **multiple times** (determinism); assert BOTH AC-1 (covered→deterministic) and AC-2 (uncovered→AI, synthetic per Q5). | `tests/v6-regression/scenarios/…` | T1–T4,B1–B3 | L |
| **T6** | Unit tests for `pluginCoversExtraction` (each CC pass/fail), the split synthesis (G1–G4), and the convertExtract honor path; observability logs (AC-7). | co-located `*.test.ts` | T1–T4 | M |
| **T7** | Post-fix docs: mark WP-NN ✅ Fixed w/ commit ref + Change-History; remove from OPEN_ITEMS; extend V6_DESIGN_PRINCIPLES if a new pattern emerged. | V6 docs | all | S |

---

## Test Plan

- **AC-1 (covered→deterministic, deterministic across runs):** the proven scatter-attachment shape with connected `document-extractor` binds `extract_structured_data` for surface fields; repeated generations do not reproduce the AI-branch outcome. Covers the folded-plan case via Q3 auto-split.
- **AC-2 (uncovered→AI):** synthetic case where CC-2 (no connected deterministic doc-extraction), CC-4 (unsupported file type), or CC-3 (only meta/computed fields → G1 zero-surface) fails → AI branch fires.
- **AC-3 (reliable-code invariance):** phrasing variants (whole-object vs bytes-field input ref, folded vs split fields) of the same intent yield the same verdict.
- **AC-6:** AI branch present + behavior unchanged for uncovered.
- **AC-7:** structured log names chosen branch + deciding criterion.
- **AC-9:** image (JPG/PNG) attachment in covered case → deterministic OCR path (no base64-as-text to LLM).
- Per Principle 8/12: Phase D mocks exercise real semantics; scenario snapshot committed with updated `scenario.json` fields.

---

## V6 Protocol Checklist

- [ ] V6_DESIGN_PRINCIPLES read (6 no-hardcoding, 7 root-cause, 11 no-hidden-failures; Anti-pattern F) — design conforms (SA confirmed).
- [ ] New WP-NN in WEAK_POINTS + one-line OPEN_ITEMS pointer (T0), Fixed-status + Change History on completion (T7).
- [ ] New scatter-attachment regression scenario, run repeatedly, asserts both boundaries (T5).
- [ ] No plugin/action-identity branches in generic infra (AC-5) — verified in SA code review.
- [ ] Structured Pino logging on new/changed server code; flag any touched `console.*` file for conversion.

---

## Risks & Open Points

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Q2 grammar dependency** — the intent grammar may not carry a usable per-field declared-source signal to partition surface vs meta/computed. | If absent, SA to decide during implementation: extend the grammar's extract-field declaration (preferred, schema-driven) vs. a conservative CC-3a default (treat ambiguous fields as meta → split), never a field-name list. Surface to user if it materially expands scope. |
| R2 | **Q3 auto-split blast radius** — synthesizing a downstream `generate` touches DSL shape; risk of double-processing or mis-wired input. | Guardrails G1–G4; dedicated unit tests (T6); scenario run repeatedly (T5). |
| R3 | **B3 vs Q1 interaction** — hardening the heuristic must not reintroduce a second decision-maker in the converter. | Converter honors binder verdict only (Q1 anti-double-decision guard); B3 only prevents *stripping* a live binding, it does not *create* bindings. |
| R4 | Uncovered-case realism (Q5 synthetic) — synthetic test may not match a real uncovered agent. | Accepted by user; construct per SCRIPTS manual; real uncovered agent is a bonus. |

---

## Implementation Progress (Dev, 2026-07-13)

**Branch:** `agent-failure-troubleshooting` (confirmed via `git branch --show-current`). No new branch; no commit — self-test only.

**R1 materialized (grammar dependency).** The IntentContract `ExtractStep.extract.fields[]` type (`intent-schema-types.ts`) carried NO per-field declared-source signal — only `{name, type, required, description, items, properties}`. Per the R1 mitigation (preferred = schema-driven grammar extension, never a field-name list), I added an **optional `source` discriminator** (`"document" | "meta" | "computed"`) to the extract-field grammar. The coverage predicate classifies a field as deterministically-producible **iff `source === "document"`**; `meta`/`computed`/absent → residual (conservative-safe: routes ambiguous fields to AI, never fabricates coverage). B1 steers the Phase-1 LLM to declare `source` per field. Zero field-name constants; no plugin-identity branches. Scope impact: +1 optional grammar field, +1 prompt block — no breaking change (legacy ICs without `source` degrade to the safe AI direction).

| Task | Status | Notes |
|---|---|---|
| T0 | ✅ | WP-62 in WEAK_POINTS + summary-table row + OPEN_ITEMS pointer. |
| T1 | ✅ | `ExtractionCoverage.ts` — `evaluateExtractionCoverage` (CC-1..CC-4, Q2 source partition), schema-driven, connected-only, no name lists. |
| T2 | ✅ | CapabilityBinderV2 Phase 2c `routeExtractionCoverage` authors the verdict (covered → live document-extractor binding; uncovered → unbound). |
| T3 | ✅ | `convertExtract` HONORS the verdict (anti-double-decision guard skips O-WP12/Phase-2b rerouters when a verdict exists). AI branch unchanged for uncovered. |
| T4 | ✅ | Auto-split synthesis: surface subset → deterministic deliver; residual meta/computed → downstream synthesized `generate`; guardrails G1–G4. |
| B1 | ✅ | `intent-system-prompt-v2.ts` §6.4 steer + per-field `source` declaration guidance (steer-not-decide). |
| B2 | ✅ | `x-semantic-type: file_attachment` on `get_email_attachment.output_schema`. |
| B3 | ✅ | `inputLooksLikeFileAttachment` hardened: loop-internal producer resolution + honor-verdict guard so the text short-circuit cannot strip a binder-authored binding. |
| T5 | ✅ | New `gmail-scatter-attachment-extract` regression scenario; coverage-verdict determinism asserted over repeated runs (AC-1 + AC-2). |
| T6 | ✅ | Unit tests: `ExtractionCoverage.test.ts`, `CapabilityBinderV2.coverage.test.ts`, `IntentToIRConverter.coverage.test.ts`. |
| T7 | ✅ | WP-62 marked ✅ Fixed + Change History; OPEN_ITEMS pointer added; Principle 11 evidence extended. |

### SA Code Review Round 1 (2026-07-13) — CHANGES-REQUIRED, all addressed

| Finding | Sev | Resolution | Status |
|---|---|---|---|
| **#1** authoritative CC-1 (`extractInputIsFile`) didn't normalize the input ref → the well-phrased dotted-bytes shape (`{{attachment_content.data}}`, the B1 steer) resolved to "not a file" → AI inversion for the *well-phrased* plan; B3 bypassed/dead. | HIGH | **Unified the resolver.** New SHARED `baseVarOfRef` (strip `{{}}` + drop dotted tail) and `classifySchemaFileness` (semantic→bytes→markers, positive-file-wins) in `ExtractionCoverage.ts`. Binder CC-1 now normalizes to base var and resolves the producer (loop-scoped) via the shared classifier; the converter's `inputLooksLikeFileAttachment` was refactored to call the SAME two functions (B3 is no longer dead code; the two can't diverge). `outputSchemaIsFileAttachment` delegates to the shared classifier. +2 regression tests (dotted `{{x.data}}` and bare `x.data` → CC-1 true → deterministic bind). | ✅ Fixed |
| **#2** AC-3 under-proven (same IC 5×). | MED | Added a phrasing-invariance suite: 4 variants (whole-object vs dotted-bytes × folded vs already-split), each covered → all bind deterministic, and a convergence test asserting a single verdict. Proves invariance to Phase-1 PHRASING. | ✅ Fixed |
| **#3** absent-`source` degradation unproven (R1 backward-compat). | MED | Added tests: fields omitting `source` → unbound → AI net (never force-bind/fabricate); partial `source` → only annotated surface fields bind (no over-reach). | ✅ Fixed |
| **#5** synthesized `generate` passes `input` raw. | Nit | Added a clarifying comment — `surfaceInputVar` is a converter-minted resolved IR variable, not a RefName. | ✅ Done |
| **#6** `as any` scatter traversal. | Nit | Left as-is (consistent with `findUnboundSteps`/`validateInputTypeCompatibility` file style); added a one-line note. | ✅ Done |

**Post-fix tests:** 42 WP-62 tests pass (was 28; +14). Full v6 suite: 5 failed / 43 failed tests = unchanged pre-existing baseline (passed 184→198); WP-57 passes → zero new regressions. Design (Q1/Q2/Q3) unchanged; AI safety-net branch behaviorally unchanged.

### Hotfix Round (2026-07-16) — live-validation gap: `file_content` received the whole object

**Trigger.** Live validation on agent `2ffcd7bf-3afc-45f5-8315-5ff00eb0d8a2` proved the WP-62 routing fix works end-to-end (all 5 phases green, `document-extractor` bound, IC persisted, Phase-1 emitted per-field `source`, CC-3a split correct — TS regression-tested all six WP-62 components, **none defective**). But calibration's dry-run correctly blocked it: `step6` failed all 3 scatter items with **`Parameter file_content should be string, got object`**. RCA: [`AGENT_RCA_CONCLUSION_wp62-live-validation-file-content-object.md`](/docs/investigations/AGENT_RCA_CONCLUSION_wp62-live-validation-file-content-object.md).

**Diagnosis.** WP-62 was **incomplete, not wrong**: it removed Phase-1 dependence from the *routing* decision but not from the *input-ref granularity*. Phase 1 legitimately emitted a whole-object `extract.input: "attachment_content"`; `convertExtract`'s `x-input-mapping` loop copied it verbatim into `file_content` (a `type: "string"` param). Pre-WP-62 this shape rerouted to AI, so the latent gap never executed — WP-62's correct routing is the first thing to route traffic through it.

| # | Task | Status | Notes |
|---|------|--------|-------|
| **H1** | **CORE** — bytes-field navigation in `convertExtract`'s file-param mapping. | ✅ | When the target param's `x-input-mapping.accepts` includes `file_object` and the input slot resolves to a bytes-bearing **object**, emit `{{<baseVar>.<bytesField>}}` (→ `attachment_content.data`). **Idempotent by construction** (ref always rebuilt from `baseVarOfRef` + schema bytes key → `.data` stays `.data`, never `.data.data`). **Schema-driven** — bytes key from the producer slot schema via shared `bytesFieldOf`, zero plugin/field-name branches. Slot resolution shares CC-1's normalization (`resolveSlotSchema`), so mapping and verdict cannot disagree. **Safe direction:** object with no bytes field → no broken ref emitted; reroute to the AI net + structured warn (Principle 11). Unknown/string slots keep the legacy verbatim copy (no WP-57 behaviour change). |
| **H2** | **DE-DUPLICATE `BYTES_FIELDS`** (same divergence class as SA Round-1 HIGH). | ✅ | Was defined **3×** identically (`ExtractionCoverage.ts`, `IntentToIRConverter.slotHasBytes`, `IntentToIRConverter.findDownloadAction`). Now **ONE** definition — `BYTES_FIELDS_PRIORITY` + `BYTES_FIELDS` in `ExtractionCoverage.ts`, exported via `bytesFieldOf()` / `schemaHasBytes()`; both converter call sites refactored onto it. Verified: no duplicate sets remain. Priority order (`file_content > data > base64 > content`) makes the pick deterministic and prefers unambiguous keys over `content` (which is also a text marker). |
| **H3** | **PLUGIN-DEF** — `document-extractor.file_content.x-input-mapping`. | ✅ | **Correction to the RCA's premise:** `from_file_object` is **NOT dead code** — `ExecutionGraphCompiler` L6273/L6281 reads it, and its no-schema fallback is **load-bearing for the WP-57 Drive path** (Drive `download_file`'s bytes key genuinely *is* `content`). **Removing it would regress WP-57.** Instead: kept `from_file_object: "content"` and **added `from_base64_content: "data"`** (a hint the compiler already supported but no def declared), so the compiler's schema-aware pass matches each hint against the producing slot's real fields — Drive→`content`, Gmail→`data`. Also declared `from_base64_content?: string` on the `InputMapping` type (compiler read it; type never had it). This is compiler-side defense-in-depth; the converter (H1) is the root-cause fix (Principle 4/7). |
| **H4** | **TESTS** — the ones that would have caught it. | ✅ | +7 converter tests: whole-object `attachment_content` → `file_content: attachment_content.data`; braced variant; **idempotency** (`.data` and `{{.data}}` stay `.data`); schema-driven Drive-like producer → `.content`; **safe direction** (no bytes → AI net + warning); unknown slot → verbatim. +1 regression-scenario assertion (end-to-end binder→converter emits the string bytes ref). |

**Why the existing 42 tests missed this (honest).** The fixtures **encoded the same assumption as the code under test** — every fixture pointed `extract.input` at the already-navigated `.data` shape, so the verbatim copy was never exercised with the whole-object ref that live Phase 1 actually produced. Green fixtures proved the routing, not the param granularity. This is now captured as a V6 anti-pattern (see V6_DESIGN_PRINCIPLES § Section 2).

**Post-hotfix tests:** **50 WP-62 tests pass** (was 42; +8). Full v6 suite: **5 failed / 43 failed = unchanged pre-existing baseline** (passed 198→205) → zero new failures. Pilot + plugin suites: **547 passed / 0 failed** (plugin-def + `plugin-types` changes safe). Zero type errors in touched files.

**Live re-validation (2026-07-16) — PASSED.** Calibration `passed`, `items_processed: 1`; at runtime `file_content` received the real base64 PDF string (`{{attachment_content.data}}` resolved to bytes). **WP-62 is compile + runtime proven.**

### Post-hotfix SA nits (N1–N4), 2026-07-16

| Nit | Sev | Status | Notes |
|---|---|---|---|
| **N2** | MED→LOW | ✅ Fixed | The H3 compiler-side hint layer (`from_base64_content`, consumed by `ExecutionGraphCompiler.normalizeActionConfigWithSchema` ~L6276) was proven only by reasoning. New `ExecutionGraphCompiler.wp62.test.ts` exercises that method directly: whole-object `{{attachment_content}}` → `{{attachment_content.data}}` for the Gmail slot (via `from_base64_content`), `{{…​.content}}` for the Drive slot (via `from_file_object`), and whole-object passthrough when no bytes field exists. **Layer covered:** the compiler hint-resolution unit; the end-to-end invocation is covered by the live Phase E run, and the normal (pre-navigated) path by `IntentToIRConverter.coverage.test.ts` — stated honestly in the test header. |
| **N4** | cosmetic | ✅ Fixed | The coverage-honoring log emitted `branch:"deterministic-bind"` *before* the H1 safe-direction reroute could flip a covered verdict to AI. Relocated the log to **after** the H1 file-param resolution so `branch` reflects the FINAL branch (`effectivePluginKey ? 'deterministic-bind' : 'ai-fallback'`), plus a `rerouted` flag when a covered verdict fell back. |
| **N1** | low | ⏳ Follow-up (no behavior change) | SA-identified low-priority nit; **specifics live in the SA post-hotfix review record (not relayed to Dev in detail).** Carried forward per coordinator instruction — behavior intentionally unchanged this pass. To be actioned in a future pass or closed by SA. |
| **N3** | low | ⏳ Follow-up (no behavior change) | As N1 — SA-identified low-priority nit, carried as a documented follow-up, no behavior change made now. |

**Post-N2/N4 tests:** **53 WP-62 tests pass** (was 50; +3 N2 compiler tests). Full v6 suite: **5 failed / 43 failed = unchanged pre-existing baseline** (passed 205→208, +1 new suite) → zero new failures. Zero type errors in touched files.

### Documented low-priority follow-ups (do not block commit)
- **N1, N3** (SA post-hotfix nits) — carried, no behavior change; detail in the SA review record.
- **QA:** commit the phase2/phase4 scenario snapshots for `gmail-scatter-attachment-extract` and set `phase_e_success: true` now that the live re-validation passed (I left it `false` pending the snapshot capture — see scenario.json caveat).
- Earlier SA Round-1 nit **#6** (typed nested-step visitor) — deferred as a readability nit, not a correctness risk.

## SA Code Review — WP-62 (2026-07-13)

**Reviewed by SA — 2026-07-13**
**Status:** 🔄 Fix Required (one High-severity robustness gap in the authoritative CC-1 resolver; everything else passes)
**Scope:** WP-62 diff only. Out-of-scope concurrent changes on this shared branch (`lib/pilot/WorkflowPilot.ts`, `lib/pilot/types.ts`, `app/api/v2/calibrate/batch/route.ts`, `app/v2/sandbox/[agentId]/page.tsx`, calibration files) were NOT reviewed per Dev's flag.

### Dimension verdicts

| Dimension | Verdict | Notes |
|---|---|---|
| **Q1 — single-decision integrity** | ✅ Pass | Binder Phase 2c (`routeExtractionCoverage`) is the sole author; `convertExtract` honors via a mutually-exclusive `if (coverage) {…} else {…}` — the verdict path and the legacy O-WP12/O-Dir3 rerouters can never both fire. Phase 2c authors a verdict on *every* extract step, so the legacy branch is only reached for pre-WP-62 cached contracts / steps the walk misses. No path silently ignores the verdict. |
| **Q2 — NO HARDCODING** | ✅ Pass | Extractor discovered by declared `domain==='document' && capability==='extract_structured_data'` (schema-taxonomy match, mirrors `findCandidates`), CC-4 derived from the plugin's own `must_support` flags, CC-1 from generic `x-semantic-type`/bytes-field vocabulary. Verified against `document-extractor-plugin-v2.json` (declares those fields, `isSystem:true`). ZERO field-name allow/deny lists; ZERO plugin-key/action-name branches. Producibility judged purely by declared `source`. |
| **Safety net (AC-2/AC-6)** | ✅ Pass | AI branch (now `IntentToIRConverter.ts` ~L716-738) is byte-identical in behavior (same `llm_extract` template, full `step.extract.fields`), only relocated into the `else`. Reached for every uncovered verdict (`effectivePluginKey=undefined`). No previously-AI case hard-fails. |
| **Q3 — synthesis correctness** | ✅ Pass (1 unverified-at-runtime caveat) | `synthesizeResidualGenerateNode` wires deliver(`outputVar__extracted`) → `node.next` → generate(`outputVar`); surface passthrough + residual in the output schema; G2 (copy UNCHANGED, null-not-placeholder) enforced in the instruction; G3 idempotent (empty residual → single deliver, `isCoveredSplit=false`); G4 keys only on the source partition. Caveat: the split node lives inside a scatter/loop body and is wired via `node.next`; end-to-end DSL execution of that shape is NOT live-verified (Phase A/D/E deferred — no creds). QA must confirm at Phase E. |
| **B3 — heuristic hardening** | ⚠️ Pass-but-mooted | `inputLooksLikeFileAttachment` correctly adds bytes-field + loop-internal base-var/`{{}}` normalization. BUT it is only invoked in the legacy `else` branch, so with Phase 2c authoring a verdict for every extract step, B3 is effectively dead in the normal pipeline. The *authoritative* CC-1 resolver is now `CapabilityBinderV2.extractInputIsFile`, which does NOT have B3's normalization — see High finding #1. |
| **R1 — grammar extension** | ✅ Pass | `ExtractFieldSource` is optional and backward-compatible. Absent `source` → `partitionFieldsBySource` puts the field in `residualFields`; all-absent → zero surface → G1 → CC-3 fail → AI (the SAFE direction, never an unsafe force-bind). Nothing strips `source`: the binder reads `extract.fields` before any cleanup, and Phase 2c captures the surface/residual partition into the verdict object (which `cleanupInternalFields` does not touch — it only deletes `_ranked_candidates`). |
| **Standards & fit** | ✅ Pass | Structured Pino logging on both new decision points (AC-7 satisfied), no `console.*` introduced in any changed file, no secrets. Architecturally consistent (Phase 2c slots in after Phase 2b; predicate is a pure module). Heavy `as any` casts, but consistent with the existing converter/binder style — Low nit only. |
| **Test adequacy** | ⚠️ Partial | Unit + scenario tests prove AC-1 (covered→deterministic split) and AC-2 (uncovered→AI) for the **bare-input, fully source-annotated** shape, and guard against hidden nondeterminism (5× same-IC). Gaps below. |

### Code Review Comments (ranked by severity)

1. **[HIGH] `CapabilityBinderV2.extractInputIsFile` (L~1040-1065) — the authoritative CC-1 resolver is weaker than the B3 heuristic it supersedes; can reintroduce the exact WP-62 bug under B1's own steer.**
   `extractInputIsFile` resolves the input ref via `producerByOutput.get(inputRef)` and `dataSchema.slots[inputRef]` using the **raw** ref only. It does not strip `{{}}` and does not split a dotted ref to its base var. B1 (`intent-system-prompt-v2.ts` §6.4) explicitly steers Phase-1 to *"point the extract's `input` at the file's bytes field (the base64 content), not the whole wrapper object"* — i.e. toward `attachment_content.data`. For that input: `producerByOutput.get('attachment_content.data')` misses (producer output is `attachment_content`), `slots['attachment_content.data']` misses → CC-1 returns **false** → verdict `covered:false` → AI fallback — the precise inversion this WP exists to kill, now for the *well-phrased* plan. Because Phase 2c always authors a verdict, `convertExtract` HONORS "not covered" and never runs B3, so B3's dotted/base-var normalization (which *would* have caught this) is bypassed exactly when needed. **Must-fix:** port B3's normalization into `extractInputIsFile` (strip `{{}}`, `split('.')[0]` base-var, try `[raw, resolved, baseVar]` like B3 does) — or share one resolver — and add a regression case with `input: "attachment_content.data"`. Static caveat: I cannot prove Phase-1 emits dotted input (both reference ICs are null — WP-55 clobber), but B1's steer points squarely at the unhandled shape, so this must be closed or proven-moot with a test before QA.

2. **[MEDIUM] Determinism/AC-3 coverage is thinner than the claim — the tests do not prove phrasing-variant invariance, only same-IC repeatability.** `coverage-routing.test.ts` and `CapabilityBinderV2.coverage.test.ts` run the *same* IC 5× and assert one fingerprint. For pure functions that is near-tautological (it guards Map/Date/random nondeterminism, which is worth something, but not AC-3). The load-bearing AC-3 claim is that *equivalent-but-differently-phrased* plans converge (input-ref granularity, folded vs pre-split, field order). Add at least: (a) `input:"attachment_content"` vs `input:"attachment_content.data"` → same verdict (ties to finding #1); (b) folded vs already-split (`residualFields:[]`) → both bind deterministic. Otherwise AC-3 is asserted but not demonstrated.

3. **[MEDIUM] No test for the R1 degradation direction (source absent) — the covered-direction now hinges entirely on B1 prompt compliance.** With `source` absent on all fields, a *genuinely file-covered* extraction silently downgrades to AI (surface=∅ → G1 → CC-3). That is "safe" per the requirement's conservative rule, but it is a behavioral regression from a previously-(sometimes)-deterministic bind, and it re-exposes the image-attachment fabrication risk the RCA called out whenever the Phase-1 model omits `source`. There is no schema-based inference fallback (e.g. infer surface-ness from field type or the extractor's declared output) — determinism of the *covered* direction is only as good as `source`-label consistency. Acceptable within the SA-approved Q2 design, but (a) add a test documenting the absent-source→AI degradation as intended, and (b) recommend a follow-up: observability/calibration signal when a file-input extract with a connected extractor lands on AI due to missing `source`, so the downgrade is diagnosable rather than silent (Principle 11).

4. **[LOW] Phase 2c CC-2 effectively never fails in production** because `document-extractor` is a system plugin (`isSystem:true`) always merged into `connectedPlugins`. That is by design (connected-only, system counts), and the AC-2 CC-2 path is exercised synthetically. Just note it: the real uncovered triggers in production are CC-1 (not a file), CC-3/G1 (zero surface fields), CC-4 (unsupported type) — not CC-2.

5. **[LOW] `synthesizeResidualGenerateNode` passes `input: surfaceInputVar` raw** (not via `resolveRefName`) whereas the AI `llm_extract` branch resolves its input. Fine because it is a synthesized intermediate var, but worth a one-line comment so a future reader does not "fix" it into double-wrapping.

6. **[LOW] Pervasive `(step as any)` / `(s as any)` casts** in `routeExtractionCoverage`/`applyExtractionCoverageVerdict` and `CoverageField[key:string]:unknown`. Consistent with the existing file, no *new* implicit `any`, so not blocking — but the loop/decide/parallel traversal casts would be safer with a small typed helper (also used by `cleanupInternalFields`, so there is a reuse case).

### Optimisation Suggestions (non-blocking)
- The scatter-body traversal is now duplicated three times (`collectProducers`, `walk`, `cleanupInternalFields`) with the same loop/decide/parallel shape. A single `forEachNestedStep` visitor would reduce drift risk.
- Consider having `convertExtract`'s legacy branch and Phase 2c share the CC-1 file-signal resolver, which would also close finding #1 structurally (one resolver, one behavior).

### Must-fix before QA
- **Finding #1 (HIGH):** make the authoritative CC-1 resolver dotted/`{{}}`-ref robust (or prove via a dotted-input test that Phase-1 never emits it). This is the one item that can reintroduce the bug.

### Should-fix before QA (or explicitly accept as follow-ups)
- Findings #2 and #3 (phrasing-variant + absent-source tests). These are what make AC-1/AC-3 *provable* rather than asserted.

### Code Approved for QA: **No** — resolve finding #1, then this is clear to proceed. Findings #2–#3 strongly recommended in the same pass; #4–#6 are nits.

---

## SA Code Review — WP-62 ROUND 2 (2026-07-13)

**Reviewed by SA — 2026-07-13**
**Status:** ✅ Code Approved — ready to advance to QA + the user-review gate.

Re-reviewed the delta against the three Round-1 findings. Verified the fix is real (not just green tests) by reading the resolver code and running the suites. **42/42 WP-62 tests pass; 24/24 broader `IntentToIRConverter` tests pass** (confirms the `inputLooksLikeFileAttachment` refactor did not regress the WP-12/WP-57 behavior).

### Finding resolution

- **#1 (HIGH) — GENUINELY RESOLVED.** Two shared functions now live in `ExtractionCoverage.ts`: `baseVarOfRef` (L95-97 — strips `{{ }}`, trims, drops the dotted tail) and `classifySchemaFileness` (L113-134 — the single file/text/unknown source of truth, positive-file-wins). The **authoritative** binder CC-1 (`CapabilityBinderV2.extractInputIsFile`) now tries `[rawRef, baseVar]` at both the producer-output map and the data_schema slot, so `{{attachment_content.data}}` resolves to the `attachment_content` producer (whose `get_email_attachment` output carries the B2 `x-semantic-type: file_attachment`) → CC-1 true → **binds deterministically**. Proven end-to-end by two new `.bind()` tests (dotted `{{…​.data}}` and bare `…​.data`) — and visible in the run logs (`decidingCriterion:"covered"`, `plugin:"document-extractor"`). The heuristic bypass concern from Round 1 is now moot *because the fix is in the authoritative path*: even though `inputLooksLikeFileAttachment` remains reachable only on the legacy no-verdict branch, it and the binder now call the **same** `baseVarOfRef` + `classifySchemaFileness`, so they cannot diverge, and the well-phrased case is caught at bind time regardless.
- **#2 (MEDIUM/AC-3) — RESOLVED.** New phrasing-invariance suite exercises four *genuinely different* ICs (whole-object vs dotted-bytes × folded vs already-split) through the real binder and asserts a single converged verdict (`verdicts.size === 1`) binding `document-extractor` for the same surface subset. This is real phrasing-invariance, not a relabelled same-IC.
- **#3 (MEDIUM/R1) — RESOLVED.** New tests prove absent-`source` → zero surface → CC-3/G1 → unbound → AI net (the SAFE direction, `surfaceFields` empty, never a force-bind), and partial-`source` → binds only the annotated field with the unannotated one held as residual (no over-reach). Confirmed in run logs.

### Invariant re-checks after the refactor
- **No new false positives (spot-checked as requested):** `classifySchemaFileness` precedence is semantic_type → bytes-field → field-name markers, with the both-file-and-text field-name case correctly resolving **text-primary** (L132) — so an email object with a nested `attachments` field still reads as text. Producer-shape signals (semantic_type/bytes) are returned before the whole-graph text short-circuit, preserving the intended B3 ordering. The 24/24 converter suite (incl. text-input WP-12 cases) passing corroborates no text-routed-to-plugin regression.
- **Q1 / Q2 / Q3 / safety-net intact:** the AI branch and the no-hardcoding discovery (`domain`+`capability`, `must_support`-derived file types) were untouched by the refactor; the split synthesis and honor-verdict logic are unchanged.

### Residual note (LOW — non-blocking, future consideration)
`BYTES_FIELDS` includes `content`, which also appears in `TEXT_MARKERS`; since the bytes check precedes the field-name check, a schema exposing a property literally named `content` (or `data`) classifies as file. This vocabulary is **pre-existing** (it was already in the binder's bytes set and the converter's markers) and is now merely unified. Blast radius is limited by the triple gate (declared `source:"document"` ∧ connected extractor ∧ file-type support), so it is not a practical false-positive on the proven domains. Worth revisiting only if a genuinely-text producer ever names a field `content`/`data` — out of scope for WP-62.

### Nits #5 / #6
`#5` addressed (comment added). `#6` (typed nested-step visitor) intentionally deferred — acceptable; the three-way traversal duplication is a readability nit, not a correctness risk.

### Code Approved for QA: **Yes.** Ready to advance to QA and the user-review gate. QA should still complete the deferred Phase A/D/E live capture (per `scenario.json` `phase_e_caveat`) — end-to-end execution of the synthesized split *inside a scatter* is asserted at the node-graph level but not yet run against live Gmail/Textract.

---

## SA Code Review — WP-62 HOTFIX ROUND 3 (2026-07-19)

**Reviewed by SA — 2026-07-19**
**Status:** ✅ APPROVE-WITH-NITS — ready for the user's live re-validation + QA. No must-fix blockers. Four LOW/MED follow-ups noted below (none block commit).
**Scope:** the H1–H4 hotfix diff only (`IntentToIRConverter.ts`, `ExtractionCoverage.ts`, `document-extractor-plugin-v2.json`, `plugin-types.ts`, the new/extended tests). Out-of-scope concurrent branch changes not re-reviewed. Round 1–2 verdicts stand.

### Verification method
Read the actual diff (not just the Dev summary), read the two consuming compiler blocks by line, and **ran the suites**: WP-62 units `IntentToIRConverter.coverage` + `ExtractionCoverage` + `CapabilityBinderV2.coverage` = **46 pass**; regression scenario `gmail-scatter-attachment-extract/coverage-routing` = **4 pass** (total **50** — matches Dev's claim); WP-57 non-regression `CapabilityBinderV2.wp57` + broader `IntentToIRConverter` = **33 pass**.

### Priority findings

| # | Priority checkpoint | Verdict |
|---|---|---|
| 1 | **H1 correctness & structural idempotency** | ✅ Pass. The file-object ref is **rebuilt** from `baseVarOfRef(input)` + `bytesFieldOf(slotSchema)` (`IntentToIRConverter.ts` ~L695-712), never string-appended, so `.data` can never become `.data.data`. Proven by tests for whole-object (`attachment_content`→`.data`), braced (`{{attachment_content}}`→`.data`), and both idempotent `.data` variants. The **scatter/loop-scoped** producer slot is exercised end-to-end: the scenario fixture's `extract` lives inside `loop.do` with a whole-object `extract.input`, driven through the real `CapabilityBinderV2`→`IntentToIRConverter`, and asserts `file_content === 'attachment_content.data'` (`coverage-routing.test.ts:98`). `resolveSlotSchema` tries `[raw, resolved, baseVar(raw), baseVar(resolved)]` against `dataSchema.slots`, so the producer-output and data_schema-slot paths both resolve. Nested dotted `a.b.c` flattens to `a.<bytesField>` (baseVar takes `split('.')[0]`) — acceptable since navigation only fires when base `a` resolves to a bytes-bearing object; not a live-emitted shape. |
| 2 | **Safe direction / WP-57 non-regression** | ✅ Pass. Bytes-less object → no broken ref; reroutes to the AI net with a Pino warn + `ctx.warnings` entry (tested, `IntentToIRConverter.coverage.test.ts:228`). Unknown/string slot → legacy verbatim copy, byte-for-byte unchanged (tested L240). WP-57 Drive path **provably untouched**: `CapabilityBinderV2.wp57` + `IntentToIRConverter` = 33/33 green after the refactor; H1 does not navigate no-schema slots (the WP-57 auto-inserted download output), so the compiler's no-schema `from_file_object` fallback still governs Drive. |
| 3 | **H3 two-hint decision** | ✅ **APPROVE the judgement call.** Dev's override of the RCA "dead code" diagnosis is **correct and evidenced.** `from_file_object` IS read by the compiler — schema-aware at `ExecutionGraphCompiler.ts:6273`, no-schema fallback at **L6281/L6283**; deleting it would regress the WP-57 Drive `download_file` path (no data_schema slot → hits the no-schema branch → relies on `from_file_object: "content"`). `from_base64_content` IS genuinely already consumed at **L6276-6279** — `ExecutionGraphCompiler.ts` is **not in the diff**, so Dev added only the plugin-def declaration + the `InputMapping` type field, **not** consuming code; the claim checks out. The hint layer is legitimate defense-in-depth (Principle 4/7): H1 is the root fix (known-schema Gmail slot → navigates up-front → compiler passes the already-dotted ref through untouched, since `variables.has('attachment_content.data')` is false and the mapping block is skipped), and H3 only governs **un-navigated** refs (legacy/cached IR, or the no-schema Drive download output). On known producers the two layers are complementary, never simultaneous. See N1 for the one theoretical divergence. |
| 4 | **H2 single BYTES definition** | ✅ Pass. Exactly **one** vocabulary source — `BYTES_FIELDS_PRIORITY` → `BYTES_FIELDS` in `ExtractionCoverage.ts:87-88`. The three former converter duplicates are gone: `slotHasBytes` and `findDownloadAction` now call `schemaHasBytes`, and `inputLooksLikeFileAttachment` calls `classifySchemaFileness`; `grep` for inline `new Set(['file_content'…])` in the converter returns **empty**. `bytesFieldOf` (single-field pick) and `classifySchemaFileness` (boolean file signal) derive from the **same** `BYTES_FIELDS_PRIORITY`, and because the classifier is boolean-over-any-key it cannot disagree with the priority pick on "is this a file"; when a schema has both `content` and `data`, `bytesFieldOf` picks `data` (higher priority) and the classifier still says `file` — consistent. |
| 5 | **No new hardcoding** | ✅ Pass. Bytes key is derived from the producer schema's own properties against generic vocabulary; `paramAcceptsFileObject` reads the param's own `x-input-mapping.accepts`. Zero plugin-name/field-name branches (Principle 6 / Anti-pattern F). |
| 6 | **Test adequacy** | ✅ Pass, with N2/N3 gaps. The admitted whole-object blind spot is now closed (unit + end-to-end-through-binder-in-a-loop). Idempotency, safe-direction, schema-driven Drive-content, and unknown-slot verbatim are all covered. |

### Explicit answers to the charter questions
- **Verdict:** **APPROVE-WITH-NITS.**
- **H3 two-hint decision:** **APPROVE.** `from_file_object` is live (L6273/6281/6283) and load-bearing for WP-57; `from_base64_content` was already consumed (L6276-6279) and Dev added only the declaration + type — no risk of drift into un-consumed metadata. Genuine defense-in-depth, not redundant surface.
- **WP-57 provably unregressed?** **Yes** — `CapabilityBinderV2.wp57` + `IntentToIRConverter` 33/33 green on this working tree.
- **H1 idempotency:** **Confirmed structural** — ref rebuilt from base-var + schema bytes key; `.data`/`{{.data}}` stay `.data` (tests L208-216).
- **H2 single definition:** **Confirmed** — one `BYTES_FIELDS_PRIORITY`; no inline literals remain.
- **Ready for live re-validation + QA?** **Yes.** The nits below are non-blocking follow-ups.

### Nits / follow-ups (LOW/MED — none block commit or QA)
- **N1 (LOW) — theoretical priority divergence between H1 and the compiler fallback.** For a *hypothetical* producer exposing **both** `content` and `data`, H1's `bytesFieldOf` picks `data` (priority `file_content > data > base64 > content`) while the compiler's un-navigated fallback tries `from_file_object` (`content`) **first** (`ExecutionGraphCompiler.ts:6273`). They'd pick different keys. **Not triggerable on any known producer** (Gmail exposes `data` only, Drive `content` only) and the two paths never fire on the same ref, so it's latent-only. Recommend a one-line comment tying the plugin-def hint order to `BYTES_FIELDS_PRIORITY`, or aligning them, to prevent future drift.
- **N2 (MED-leaning-LOW) — the H3 defense-in-depth path is asserted by reasoning, not by a test.** No test feeds an **un-navigated** `{{attachment_content}}` (whole object) with a real Gmail slot schema through `ExecutionGraphCompiler` and asserts it resolves to `.data` via `from_base64_content`. Since H1 normally navigates up-front, the very layer H3 adds is unexercised. Add one compiler-level test so H3 can't silently rot.
- **N3 (LOW/MED) — safe-direction reroute doesn't reset `isCoveredSplit`.** If a slot is classified `file` by semantic-type/file-markers but has **no** bytes field, AND residual fields exist, H1 reroutes to AI (`effectivePluginKey=undefined`) yet `isCoveredSplit` stays `true` → an `llm_extract` (all fields) → synthesized `generate` (re-derives residual) chain is emitted. Final output var is correct and the AI net is preserved, but it's a redundant-AI edge (Principle 1 flavour). Consider forcing `isCoveredSplit=false` on the safe-direction reroute and add a test; not a hard failure.
- **N4 (LOW cosmetic) — momentary log inconsistency.** The coverage-honoring log emits `branch:"deterministic-bind"` before a possible H1 safe-direction reroute to AI, so the two log lines can read inconsistently for that edge. Cosmetic only.

### Static-only caveats (honest)
- Full `tsc` was not run (build ignores type errors); the touched files compile and execute under `ts-jest` (all suites green), which is strong but not a substitute for strict `tsc`.
- The compiler consumption of `from_base64_content` (L6276) and the no-schema `from_file_object` fallback (L6281) are verified by reading the code, not by executing the compiler on the un-navigated shape (see N2).
- Live Phase E (re-create agent `2ffcd7bf`, confirm compiled `file_content: {{attachment_content.data}}` + green calibration) remains the user's call — not runnable in the Dev/SA env.

### Code Approved for QA: **Yes.** Proceed to the user's live re-validation and QA. N1–N4 are recommended follow-ups (N2 ideally folded into this cycle since it's a one-test add for the layer Dev deliberately introduced).

---

## QA Testing Report

**QA — 2026-07-19**
**Test mode:** full (all acceptance criteria + hotfix edge cases + error paths)
**Strategy used:** B (Jest unit + integration) for the routing/coverage/converter/compiler logic + C-adjacent (regression scenario driven through the real binder→converter) + E (dev.log analysis to corroborate the live run, which QA cannot re-run — no live Gmail/Textract creds)
**Focus:** pipeline / schema / api (V6 extraction routing) + security-adjacent (no-hardcoding)
**Skipped:** live Phase E execution (no creds — corroborated via dev.log instead, not re-run); e2e/UI (not applicable to this pipeline change)
**Input source:** coordinator prompt + workplan QA Test Scope (SA Rounds 1–3 + hotfix follow-ups)

### Test run results (actual, this working tree)

| Suite set | Command | Result |
|---|---|---|
| WP-62 units + regression | `npx jest ExtractionCoverage.test IntentToIRConverter.coverage.test CapabilityBinderV2.coverage.test ExecutionGraphCompiler.wp62.test tests/v6-regression/scenarios/gmail-scatter-attachment-extract/` | **5 suites / 53 tests — all PASS** (matches the expected ~53) |
| WP-57 non-regression | `npx jest CapabilityBinderV2.wp57` | **1 suite / 2 tests — PASS** (green, no regression) |
| Broader v6 suite | `npx jest lib/agentkit/v6` | **13 passed / 5 failed suites; 208 passed / 43 failed tests** |

**Baseline verification (zero NEW failures):** the 5 failing suites are `IRToNaturalLanguageTranslator`, `logical-ir/schemas/validation`, `v6-end-to-end` (integration), `LogicalIRCompiler`, `EnhancedPromptToIRGenerator` — **none are WP-62-touched files**. Sampled failure reasons are cosmetic/copy mismatches (emoji icon expectations `🔗` vs `🔔`, label strings `"Aggregate"` vs `"Calculate summary"`) with no relationship to extraction routing. Count (5 suites / 43 tests) exactly matches the Dev/SA pre-existing baseline → **WP-62 added zero new failures.**

### Test Coverage — Acceptance Criteria

| Acceptance Criterion | Tested? | Result | Notes / proving test(s) |
|---|---|---|---|
| **AC-1** covered → deterministic, deterministic across generations | ✅ | Pass | `CapabilityBinderV2.coverage`: "AC-1 covered … binds document-extractor (surface subset) + records residual split", "AC-1 determinism: repeated binds … same verdict (never the AI outcome)"; `ExtractionCoverage`: "AC-1 covered"; scenario `coverage-routing`: "AC-1 … deliver (surface) + synthesized generate (residual)" + "5 repeated pipeline runs yield identical verdict" |
| **AC-2** uncovered → AI, net preserved | ✅ | Pass | `CapabilityBinderV2.coverage` AC-2 CC-4 (xlsx), CC-3/G1 (meta-only), CC-2 (no extractor); `ExtractionCoverage` AC-2 CC-1/CC-2/CC-3/CC-4; scenario AC-2 (xlsx → llm_extract); `IntentToIRConverter` "AC-6 not covered → AI branch (unchanged), ALL fields, no binding" |
| **AC-3** decision in reliable code, invariant to Phase-1 phrasing | ✅ | Pass | `CapabilityBinderV2.coverage`: "all four phrasings converge to the SAME verdict (phrasing-invariance)" (whole-object vs dotted × folded vs split), DOTTED + bare-dotted input tests; `ExtractionCoverage` AC-3 determinism. Genuine phrasing-variance, not same-IC repeat (SA Round-2 confirmed) |
| **AC-4** predicate implements CC-1..CC-4 / CC-3a | ✅ | Pass | `ExtractionCoverage` has a dedicated pass/fail test per CC (CC-1 file signal, CC-2 capability discovery, CC-3/G1 zero-surface, CC-4 type support incl. defer-when-none-declared) |
| **AC-5** plugin-agnostic (no plugin/action-identity branch) | ✅ | Pass | `ExtractionCoverage`: "discovers … by domain+capability (no plugin key)". QA grep of `ExtractionCoverage.ts`/`CapabilityBinderV2.ts` found **zero** plugin-key/action-name branches and no hardcoded model names. `BYTES_FIELDS_PRIORITY`/`FILE_MARKERS` are generic bytes/file vocabulary, not plugin identity (SA-noted, double-gated) |
| **AC-6** AI branch intact + unchanged for uncovered | ✅ | Pass | `IntentToIRConverter.coverage` "AC-6 … AI branch (unchanged), ALL fields, no plugin binding"; SA verified byte-identical `llm_extract` relocated into the `else` |
| **AC-7** observability (structured log of branch + criterion) | ✅ | Pass | Corroborated in the actual test-run logs: `[WP-62/Phase2c] Extract covered … decidingCriterion:"covered"` and `… not covered — routing to AI (net preserved) decidingCriterion:"CC-3"` with reason text. Pino structured, no `console.*` |
| **AC-8** regression scenario committed, passes Phase E, run repeatedly | ⚠️ | **Partial** | Scenario committed (`scenario.json`, `intent-contract.json`, `coverage-routing.test.ts`); determinism proven 5× at compile/bind level; `phase_e_success:true` set from the live run. **BUT** `phase_a_success`/`phase_d_success` are `null` and the **phase2/phase4 live snapshot files are NOT committed** (no live creds to regenerate — carried as a QA follow-up per scenario.json caveat). Compile-side proof is present; committed live-artifact proof is not. |
| **AC-9** image (JPG/PNG) attachment → deterministic OCR path | ⚠️ | **Partial** | File-type support for jpg/png **is** asserted (`ExtractionCoverage`: "supports pdf/jpg/png … via must_support"), so an image covered-case would route deterministic by the predicate. But there is **no dedicated end-to-end image-attachment covered scenario** — the covered scenarios use PDF; the uncovered use xlsx. The anti-fabrication guarantee for images is proven by construction (CC-4 + deterministic bind), not by a JPG/PNG fixture. |
| **AC-10** V6 docs updated | ✅ | Pass | WP-62 present in WEAK_POINTS (9 refs), OPEN_ITEMS pointer (1), DESIGN_PRINCIPLES extended (4 refs) |

### Hotfix-specific coverage (file_content whole-object → bytes-field)

| Behavior | Tested? | Proving test |
|---|---|---|
| Whole-object → `{{….data}}` navigation | ✅ | `IntentToIRConverter.coverage`: "WHOLE-OBJECT input", "braced whole-object input" |
| Idempotency (`.data` / `{{.data}}` stay `.data`, never `.data.data`) | ✅ | "IDEMPOTENT: already-…", "IDEMPOTENT: braced already-…" (ref rebuilt from base-var + schema bytes key — structural, SA-confirmed) |
| Schema-driven bytes key (Drive → `.content`, not name-hardcoded) | ✅ | "schema-driven (not hardcoded): a producer whose bytes key is content" |
| Safe direction (bytes-less object → AI net + warning, no broken ref) | ✅ | "SAFE DIRECTION: object with NO bytes field → no broken ref emitted; falls back to the AI net" |
| Unknown/string slot → legacy verbatim copy (WP-57 behaviour preserved) | ✅ | "unknown slot … keeps the legacy verbatim copy — no behaviour change" |
| N2 compiler-hint layer (`from_base64_content` / `from_file_object`) | ✅ | `ExecutionGraphCompiler.wp62`: Gmail slot → `.data`, Drive slot → `.content`, no-bytes object → whole-object passthrough |
| End-to-end binder→converter emits string bytes ref in a scatter/loop | ✅ | `coverage-routing`: "compiled file_content resolves to the STRING bytes ref, not the whole object (live agent 2ffcd7bf)" |

### Happy path + failure path (project QA bar — both present)

- **Happy path (tested):** covered folded scatter-attachment intent (connected `document-extractor`, PDF, surface fields) → binder authors `covered` verdict → deterministic `extract_structured_data` bind for the surface subset + synthesized downstream `generate` for the residual → `convertExtract` navigates the whole-object input to `file_content: {{attachment_content.data}}`. Proven at unit + bind + compile levels and corroborated live (below).
- **Failure path (tested, multiple):** (a) unsupported file type `xlsx` (CC-4) → unbound → AI `llm_extract`; (b) meta/computed-only fields (CC-3/G1 zero surface) → AI net; (c) no connected deterministic extractor (CC-2) → AI net; (d) file-classified object with no bytes field → safe-direction reroute to AI net + structured warning. The AI safety net firing when it should is explicitly proven.

### Live-run corroboration (dev.log, root — analysed, NOT re-run)

| Claim | Corroborated? | Evidence in `dev.log` |
|---|---|---|
| Calibration passed / isPassing | ✅ | `isPassing: true` present |
| `items_processed: 1` | ✅ | multiple `items_processed: 1` matches |
| `failed_steps: 0` | ✅ | `failed_steps": 0` present |
| `file_content` received a real base64 PDF string | ✅ | `file_content": "JVBERi0xLjQ…"` — `JVBERi0x` decodes to `%PDF-1`, i.e. a genuine base64-encoded PDF (20 occurrences) |
| bytes-field navigation `attachment_content.data` at runtime | ✅ | `attachment_content.data` refs present |
| pre-hotfix `file_content should be string, got object` no longer occurs | ✅ | **0** occurrences in the current log (the log window reflects the post-hotfix passing state) |

**Honest caveat on log analysis:** the current `dev.log` window contains only the post-hotfix *passing* state — I could corroborate the latest green run but not directly re-observe the earlier failing run (`step6 … got object`) from this log. The earlier-failure narrative rests on the RCA + scenario.json caveat, which are internally consistent.

### Issues Found

#### Bugs (must fix before commit)
None. No High/Medium correctness defect surfaced in WP-62 scope. All 53 WP-62 tests and the WP-57 non-regression suite pass; zero new failures in the broader v6 suite.

#### Performance Issues (should fix)
None in WP-62 scope. (SA nit **N3** — safe-direction reroute leaves `isCoveredSplit=true`, producing a redundant `llm_extract`→`generate` chain on a latent, non-triggerable edge — is a documented low-priority follow-up, not a live regression.)

#### Edge Cases / Residual Risk / Gaps (nice to fix — do NOT block commit)
1. **AC-8 live snapshots not captured (gap).** The `gmail-scatter-attachment-extract` scenario has no committed phase2/phase4 live artifacts and `phase_a/phase_d_success` are `null`. Compile+bind determinism is proven in-repo; the live green run is only recorded in scenario.json prose + dev.log, not as committed fixtures. Carry as the stated QA follow-up (needs live creds).
2. **AC-9 no image fixture (gap).** No JPG/PNG covered-case scenario; image OCR routing is proven by construction (CC-4 supports jpg/png + deterministic bind) but not by an end-to-end image fixture. The anti-fabrication guarantee for images is therefore inferred, not fixture-demonstrated.
3. **N2 compiler-hint layer** is covered by a direct `ExecutionGraphCompiler.wp62` unit but its *end-to-end* invocation on an un-navigated ref is only exercised by the live run (H1 normally navigates up-front), as the test header honestly states.
4. **SA follow-ups N1 (hint-priority divergence on a hypothetical dual-key producer), N3 (isCoveredSplit on safe reroute), N4 (cosmetic log ordering)** — all documented, no behaviour change, non-blocking.
5. **Out-of-WP-62 (explicitly not this cycle):** the separate pre-existing flatten-field bug and the calibration hardcode-parameterization nags observed during live validation are NOT part of WP-62 and are not assessed here.

### Coding standards spot-check (touched files)
- **Logging:** `0` `console.*` calls in `CapabilityBinderV2.ts`, `IntentToIRConverter.ts`, `ExtractionCoverage.ts`, `intent-system-prompt-v2.ts` — Pino throughout; structured branch/criterion logs confirmed in run output. ✅
- **No hardcoded model names:** none in the touched binding/coverage files. ✅
- **Schema-driven / no plugin-identity branches:** grep found no `document-extractor`/`get_email_attachment`/`google-mail` string branches in `ExtractionCoverage.ts`; discovery is by `domain`+`capability`, bytes key by generic vocabulary. ✅

### Final Status
- [x] All **load-bearing** acceptance criteria pass (AC-1..AC-7, AC-10 fully; the hotfix navigation/idempotency/safe-direction/N2 all covered). Happy path + multiple failure paths proven. Zero new test failures. Live run corroborated in dev.log.
- [x] **AC-8 and AC-9 are PARTIAL** (documented gaps: uncommitted live snapshots; no image fixture) — neither is a correctness defect; both are pre-agreed follow-ups.
- [ ] No High/Medium bugs open.

**QA VERDICT: PASS-WITH-NOTES — WP-62 is ready to commit.** The routing fix and the `file_content` bytes-field hotfix are correct, well-tested (53 WP-62 tests green, WP-57 non-regression green, zero new v6 failures), standards-compliant, and live-corroborated. The two notes (AC-8 live snapshot capture, AC-9 image fixture) are non-blocking follow-ups requiring live creds — they do not gate this commit.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-19 | QA testing report | QA ran WP-62 units+regression (5 suites/53 pass), WP-57 non-regression (2 pass), broader v6 (208 pass / 43 fail = unchanged pre-existing baseline, 5 non-WP-62 cosmetic suites). AC→test map complete; AC-1..AC-7/AC-10 pass, AC-8/AC-9 partial (uncommitted live snapshots; no image fixture). Hotfix navigation/idempotency/safe-direction/N2 all covered. Live run corroborated in dev.log (isPassing:true, items_processed:1, failed_steps:0, file_content=base64 PDF `JVBERi0x…`, zero got-object errors). Standards spot-check clean (0 console.*, no hardcoded models, no plugin-identity branches). Verdict: PASS-WITH-NOTES — ready to commit. |
| 2026-07-12 | Initial workplan + SA review | Dev drafted task breakdown for ordered coverage-then-fallback routing (T0–T7 + B1–B3), all companions in-cycle, connected-only CC-2. SA reviewed and resolved Q1 (binder authors / converter honors), Q2 (classify by declared field SOURCE, no name lists), Q3 (auto-synthesize split, guardrails G1–G4). Status: awaiting user approval of design direction before implementation. |
| 2026-07-12 | Branch correction | Per user: NO new feature branch. All work on existing `agent-failure-troubleshooting`; RM skips branch creation. Updated Branch field + locked-decisions table. |
| 2026-07-13 | SA code review (Round 1) | 🔄 Fix Required. Q1/Q2/safety-net/Q3/R1 pass; B3 correct but mooted by Q1 (verdict always authored). One HIGH finding: the authoritative CC-1 resolver (`extractInputIsFile`) lacks B3's dotted/`{{}}`-ref normalization and can re-invert a bytes-field-pointed extract to AI under B1's own steer. Plus MEDIUM test gaps (phrasing-variant invariance, absent-source degradation). Not approved for QA until finding #1 is closed. |
| 2026-07-13 | SA code review (Round 2) | ✅ Code Approved. Dev unified the CC-1 resolver into shared `baseVarOfRef` + `classifySchemaFileness` (`ExtractionCoverage.ts`); binder and converter now share one file/text classifier — dotted `{{attachment_content.data}}` binds deterministically (verified via new `.bind()` tests + run logs). Findings #2 (phrasing-invariance, 4 real variants) and #3 (absent/partial-source degradation) resolved. 42/42 WP-62 tests + 24/24 broader IntentToIRConverter tests pass. One LOW residual note (`content`/`data` generic bytes vocabulary, pre-existing, double-gated). Ready for QA + user-review gate; QA to complete deferred Phase A/D/E live capture. |
| 2026-07-19 | SA code review (Round 3 — hotfix) | ✅ APPROVE-WITH-NITS. Reviewed H1–H4 (`file_content` whole-object→bytes-field navigation). H1 idempotency confirmed structural (ref rebuilt from base-var + schema bytes key); whole-object shape now covered by unit + end-to-end-in-a-loop scenario tests. H2 confirmed single `BYTES_FIELDS` definition (no inline literals remain). **H3 two-hint decision APPROVED** — `from_file_object` verified live at `ExecutionGraphCompiler.ts:6273/6281/6283` (load-bearing for WP-57 Drive), `from_base64_content` already consumed at L6276-6279 (Dev added only the declaration + type); genuine defense-in-depth. WP-57 provably unregressed (33/33). Suites run: 50 WP-62 pass, 33 WP-57/converter pass. Four LOW/MED non-blocking follow-ups (N1 hint-priority divergence on a hypothetical dual-key producer; N2 add a compiler-level test for the H3 fallback layer; N3 safe-direction reroute leaves `isCoveredSplit` true → redundant AI; N4 cosmetic log). Ready for the user's live re-validation + QA. |
