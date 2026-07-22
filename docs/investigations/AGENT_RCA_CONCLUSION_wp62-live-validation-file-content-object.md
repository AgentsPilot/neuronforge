# Agent RCA Conclusion — WP-62 live validation: `file_content` receives an object, scatter fails

> **Last Updated**: 2026-07-16
> **Agent**: `2ffcd7bf-3afc-45f5-8315-5ff00eb0d8a2` ("Gmail Expense & Receipt Table Agent (Email Summary)") · **Owner**: meiribarak@gmail.com
> **Session**: `af6c59c7-4f87-40c2-8bf8-400f7978d140` · **Calibration session**: `f5982d10-fc7d-4387-81a4-fc90e529633c` · **History**: `0033401c-6216-46fd-b5e2-3460cf6cd5b7` · **workflow_hash**: `abab6e3d0460`
> **Context**: live validation of the **uncommitted WP-62** change set (deterministic-vs-AI extraction routing) in the dev working tree.
> **Skill**: `v6-pipeline` (RCA). DIAGNOSTIC ONLY — no product code, prompts, DSL, schemas, or backlog files changed.
> **Predecessor RCA**: [`AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-ai-extract.md) (the RCA WP-62 implements).

## Overview

**Verdict: WP-62 is the proximate cause — but every new WP-62 component worked exactly as designed.** The routing fix succeeded end-to-end: Phase 1 emitted per-field `source`, Phase 2c authored a coverage verdict, `document-extractor` was bound, and the CC-3a residual `generate` was synthesized with correct wiring. **The failure is a pre-existing, WP-62-untouched line** in `convertExtract`'s param mapping (`IntentToIRConverter.ts:684`) that copies the extract input ref **verbatim** into `file_content` without navigating to the producer's base64 **bytes field** — so `file_content` got the whole `attachment_content` object and the runtime rejected it: *"Parameter file_content should be string, got object."* Pre-WP-62 this shape silently rerouted to AI (the very bug WP-62 fixes), so the latent param-binding gap never surfaced. **WP-62 is therefore an *incomplete* fix, not a wrong one** — it made the *routing* deterministic but left *input-ref granularity* dependent on how Phase 1 phrased the ref, which is precisely what it set out to remove. Root-cause layer: **V6 generation**. Fix-owner: **the WP-62 change set itself** (`v6-pipeline`). **Agent creation/generation did NOT fail** — all 5 phases were green; what failed was the subsequent **calibration dry-run**, leaving the agent `draft` / `needs_review`.

---

## 1. Reported symptom

A fresh agent creation, run as a live validation of the uncommitted WP-62 fix, was reported as **"creation FAILED."**

**Correction from evidence:** generation did **not** fail. The agent row exists with a complete 11-step DSL and green phase metrics. What failed is the **calibration dry-run** that runs after creation: `calibration_history.status = needs_review`, `first_execution_success = false`, `marked_production_ready = false` after 3 iterations / 5 auto-fixes, leaving the agent at `status = draft`. The user-visible "creation failed" is that terminal state.

## 2. Evidence gathered

| Source | Salient output |
|---|---|
| `git status` / `git diff --stat` | WP-62 confirmed **uncommitted and live**: `ExtractionCoverage.ts` (new), `CapabilityBinderV2.ts` (+195), `IntentToIRConverter.ts` (+261/−78), `intent-system-prompt-v2.ts` (+41), `intent-schema-types.ts` (+27), `google-mail-plugin-v2.json` (+1). |
| `npx tsx scripts/dump-agent.ts 2ffcd7bf-…` | **11 steps compiled.** `step4` scatter over `{{pdf_attachments}}` (itemVariable `pdf_item`) wraps `step5 google-mail.get_email_attachment` → **`step6` `action`/`plugin: document-extractor`/`extract_structured_data`** → **`step7` `ai_processing` (WP-62 residual split)** → `step8` enrich. |
| Read-only query of `agents.agent_config` | **`intent_contract` + `data_schema` PERSISTED** (WP-55 clobber fix works). `creation_metadata.v6_metadata`: `steps_generated: 11`, `phase_times_ms { vocabulary 5731, intent_generation 61861, capability_binding 1407, ir_conversion 60, compilation 129 }`, `total_time_ms 69193` — **no error; all 5 phases green.** `status: draft`. |
| Persisted IC — `extract_receipt_fields` | `uses: [{domain: "document", capability: "extract_structured_data"}]`; `plugin_key: "document-extractor"`; `binding_method: "exact_match"`; `binding_confidence: 1`. **`extract.input: "attachment_content"` ← whole object, no field.** |
| Persisted IC — per-field `source` (**the unproven link**) | `date_time: "document"`, `vendor: "document"`, `amount: "document"`, `expense_type: "computed"` — **Phase 1 DID emit the B1 `source` signal.** |
| Persisted IC — `extract_coverage` (Phase 2c verdict) | `covered: true`, `decidingCriterion: "covered"`, `deterministicPlugin: {document-extractor, extract_structured_data}`, `surfaceFields: [date_time, vendor, amount]`, `residualFields: [expense_type]`, reason: *"3 document-surface field(s) bound deterministically; 1 meta/computed field(s) split to a downstream AI generate step (CC-3a)"*. |
| `npx tsx scripts/dump-calibration.ts 2ffcd7bf-…` | Session `awaiting_fixes`, `issue_summary {critical:2, warnings:4, autoRepairs:1}`, steps 4/11 completed. **`[high/execution_error] step4: Scatter-gather step step4: all 3 items failed. First error: Scatter item 0 failed at step step6: Parameter file_content should be string, got object`.** History `needs_review`, 3 iterations, 5 auto-fixes, 6 issues remaining. `agent_executions`: 2× `failed` with the same `file_content` error. |
| `IntentToIRConverter.ts` L678-688 | The param-mapping loop — **unchanged by WP-62** (`git diff` shows only a `FILE_MARKERS` line removed from the refactored resolver). |
| `app/v2/agents/new/buildV6AiContext.ts` L5-7 | `ai_context = {intent_contract, data_schema}` **by design** — narrative fields "duplicated top-level columns and are dropped." **Not** a regression. |

### The compiled scatter body (trimmed — the live-validation answer)

```jsonc
// step5 — bytes producer
{ "id":"step5", "type":"action", "plugin":"google-mail", "action":"get_email_attachment",
  "output_variable":"attachment_content" }        // schema: { data(base64), mimeType, filename, size, is_image, extracted_text }

// step6 — DETERMINISTIC bind ✅ (WP-62 routing worked) … but the param is wrong ❌
{ "id":"step6", "type":"action", "plugin":"document-extractor", "action":"extract_structured_data",
  "params": {
    "fields": [ {"name":"date_time","type":"date"}, {"name":"vendor","type":"string"}, {"name":"amount","type":"currency"} ],
    "file_content": "{{attachment_content}}"      // ⬅ WHOLE OBJECT → runtime: "should be string, got object"
  },
  "output_variable": "extracted_fields__extracted" }

// step7 — CC-3a residual generate, auto-synthesized ✅ (valid node, correct wiring)
{ "id":"step7", "type":"ai_processing", "input":"{{extracted_fields__extracted}}",
  "config": { "type":"generate", "instruction":"You are given fields already extracted from a document … Copy those fields through UNCHANGED … Then add the following field(s): expense_type … [trimmed]" },
  "output_variable": "extracted_fields" }         // → consumed by step8
```

## 3. Earliest failing step + cascade

**Earliest real failure: `step6` inside the `step4` scatter — `Parameter file_content should be string, got object`.** All 3 scatter items failed identically.

Cascade / non-causes:
1. **`[critical] execution_failed` "Workflow execution failed"** — cascade of step4's all-items-failed (WP-10 behavior), not an independent defect.
2. **`[high] step2 flatten missing required 'field'`** — the **pre-existing** flatten class documented in [`…-flatten.md`](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md); auto-repaired mid-cycle (absent from `issues_remaining`). **Unrelated to WP-62.**
3. **`[medium] hardcode_detected` ×4** (step1 "inbox"/"100", step10 "OK", step11 "Needs review") — cosmetic parameterization warnings. **Unrelated.**

The dump's RCA HINT names `step1` as earliest only because it sorts step ids lexicographically (`step1, step10, step11, step2, step4`); step1's issues are cosmetic hardcodes. The blocking defect is **step6**.

## 4. Classified root-cause layer

**V6 generation.** The compiled DSL binds the right plugin but passes a structurally wrong param value (an object where the schema declares `type: "string"`). Not input/data (the user's PDFs are fine — `get_email_attachment` succeeded), not runtime/external (no API rejected anything; this is a local param-type validation), not creation chat flow, and **not calibration-detection** (see § 9).

## 5. Defensible root cause (the "why," with exact references)

**Chain:**
1. Phase 1 emitted `extract.input: "attachment_content"` — a **whole-object** ref (persisted IC). Legitimate per the grammar; `extract.input` is a `RefName`.
2. Phase 2c (`routeExtractionCoverage`, `CapabilityBinderV2.ts:934`) correctly judged coverage → `covered: true`, bound `document-extractor.extract_structured_data`, split `expense_type` as residual. **Correct.**
3. `convertExtract` took the deliver branch and ran the schema-aware param mapping — **`IntentToIRConverter.ts:678-688`**:
   ```ts
   const inputMapping = (paramDef as ActionParameterProperty)['x-input-mapping']
   if (inputMapping && genericConfig.input) {
     finalConfig = { ...genericConfig }
     delete finalConfig.input
     finalConfig[paramName] = genericConfig.input   // ⬅ L684: VERBATIM copy — no bytes-field navigation
     break
   }
   ```
   It assigns the ref **as-is** to the first `x-input-mapping` param (`file_content`), producing `file_content: "{{attachment_content}}"`.
4. `document-extractor-plugin-v2.json` L61-71 declares `file_content` as **`type: "string"`** with `x-input-mapping: { accepts: ["file_object"], from_file_object: "content" }`. **The `from_file_object` navigation hint is never applied** by L684. (Note it names `"content"`, while the Gmail producer's bytes field is **`data`** — so even a naive application of the hint would emit a non-existent `{{attachment_content.content}}`; the hint and the producer disagree.)
5. Runtime param validation rejects the object: **"Parameter file_content should be string, got object"** → all 3 scatter items fail → step4 throws (WP-10) → calibration `needs_review`.

**Why it never surfaced before:** pre-WP-62, this exact shape (whole-object ref + upstream email-text collection) hit the WP-12 reroute and fell to `ai_processing` — the bug the predecessor RCA diagnosed. The one prior *working* agent (`0ee53785`) only worked because Phase 1 **happened** to emit `attachment_content.data`. So the verbatim-copy gap at L684 has always been there; WP-62 is simply the first thing to route real traffic through it.

**Existing building blocks the fix can reuse:** `slotHasBytes` (`IntentToIRConverter.ts:2161-2170`) already defines `BYTES_FIELDS = {file_content, content, data, base64}`, and WP-62's own `classifySchemaFileness` / `baseVarOfRef` (`ExtractionCoverage.ts`) already resolve slot file-ness. The resolver exists; the mapping just doesn't call it.

## 6. Did WP-62 cause this? — YES (proximate), with an important nuance

**Tested each hypothesized regression shape against evidence:**

| WP-62 component | Hypothesis | Verdict |
|---|---|---|
| B1 prompt steer (§ 6.4 per-field `source`) | Broke Phase-1 IC generation (malformed/invalid/token issue)? | **NO.** IC generated, Zod-valid, persisted. `source` emitted correctly on all 4 fields (3 `document`, 1 `computed`). `intent_generation` 61.9s, no error. **This was the one unproven link — it is now PROVEN to work.** |
| Grammar `ExtractFieldSource` (optional) | Broke validation? | **NO.** IC validated and persisted with `source` present. |
| Phase 2c `routeExtractionCoverage` | Threw / produced unbound or invalid graph? | **NO.** Authored a correct verdict (`covered:true`, CC-3a), `binding_method: exact_match`, `binding_confidence: 1`, `capability_binding` 1407ms clean. |
| `synthesizeResidualGenerateNode` | Emitted invalid node / bad variable wiring? | **NO.** step7 is well-formed; wiring `step6 → extracted_fields__extracted → step7 → extracted_fields → step8` is correct and consistent. |
| B2 plugin-def edit (`x-semantic-type` on `get_email_attachment`) | Broke google-mail load/parse? | **NO.** Plugin loaded; step1/step5 executed against real Gmail (4 steps completed, 3 attachments downloaded). The annotation is in fact **why** file-ness classified correctly and the deterministic bind happened. |
| `inputLooksLikeFileAttachment` refactor | Broke routing? | **NO** — it routed *correctly* (that's the fix working). |

**So: no WP-62 component is defective.** But WP-62 **is** the proximate cause of the failure surfacing: it changed the routing outcome for whole-object-ref extractions from "silently fall to AI" to "bind the deterministic plugin," and the pre-existing L684 verbatim-copy gap then breaks at runtime. **This is a genuine regression in user-visible outcome** (previous behavior: silently wrong data; new behavior: hard failure) and it is **WP-62's to close** — the change set is incomplete, not incorrect. Shipping it as-is would hard-fail every scatter-attachment extraction whose Phase-1 ref is a whole object.

**It is NOT** an unrelated pre-existing failure, NOT a plugin/external-API fault, NOT bad user input, and NOT a calibration defect.

## 7. Named fix-owner

**`v6-pipeline` — the WP-62 change set itself**, specifically `IntentToIRConverter.convertExtract`'s param-mapping block (L678-688). WP-62's own thesis ("make the deterministic-vs-AI determination in reliable code, not left to how the Phase-1 planner phrased the step") must extend one step further: **the input *ref granularity* must also be resolved in reliable code, not inherited from Phase-1 phrasing.**

Secondary (data-quality, pre-existing): `document-extractor-plugin-v2.json`'s `from_file_object: "content"` disagrees with the Gmail producer's `data` field — the annotation is unusable as written.

## 8. Suggested solution(s)

1. **Primary — bytes-field resolution in the param mapping (reliable code).** When mapping the extract input into a param whose `x-input-mapping.accepts` includes `file_object`, and the input slot resolves to a bytes-bearing **object** (not already a string), emit `{{<input>.<bytesField>}}` where `<bytesField>` is the producer slot's actual bytes key, discovered from its schema via the existing `BYTES_FIELDS` set (`IntentToIRConverter.ts:2168`) / WP-62's `classifySchemaFileness`. Here that yields `file_content: "{{attachment_content.data}}"` — matching the known-good agent `0ee53785`. Plugin-agnostic and schema-driven (satisfies CLAUDE.md "No Hardcoding" — the producer schema is the source of truth).
2. **Companion — make `from_file_object` real or remove it.** Either apply the hint *and* correct it to the producer's actual field, or delete it and rely on (1). Today it is dead, misleading metadata.
3. **Defense-in-depth — fail at compile, not at runtime.** If the mapping cannot resolve a `type: "string"` file param to a string-typed ref, raise a clear compile-time error (per WP-40's "explicit error over silent corruption") rather than emitting a DSL that dies per-item at runtime.
4. **Rejected — relaxing the executor/param validator to accept an object.** WP-57 notes the executor tolerates a file object exposing `.content`/`.data`, so loosening validation would "work." But it hides the schema violation, keeps the DSL lying about its own param types, and leaves the ref granularity Phase-1-dependent. Fix at the root (1).

**Regression coverage to add:** the committed scenario `tests/v6-regression/scenarios/gmail-scatter-attachment-extract/` should assert the compiled `file_content` **resolves to a string-typed bytes ref**, and should include a case where Phase 1 emits a **whole-object** `extract.input` (the shape that broke here) — the current fixtures evidently only exercise the `.data` shape.

## 9. Did calibration behave correctly? (honest-failure distinction)

**Yes — say so.** Calibration ran the real engine against real Gmail, caught a genuine blocking defect on the first execution, reported the precise causal error (*"step6: Parameter file_content should be string, got object"*), correctly refused `marked_production_ready`, and ended `needs_review` (critical > 0) rather than claiming success. That is **honest failure detection**, and it is exactly what a live validation gate should do — it stopped a broken workflow from shipping. Two minor detector notes (not defects in this verdict): the RCA HINT's lexicographic sort surfaced `step1` as "earliest" when the real blocker is `step6`; and 5 auto-fixes were applied without touching the blocker (it is a generation-layer param defect the repair engine has no action for), which is correct restraint, not failure.

## 10. Recommended remediation path

**Hotfix, folded into the uncommitted WP-62 change set before it is committed** — not a separate cycle. The fix is a focused, schema-driven change to one mapping block in `IntentToIRConverter.convertExtract` plus reuse of an existing resolver, with unit coverage alongside WP-62's existing `IntentToIRConverter.coverage.test.ts` and a regression-scenario assertion. It is squarely within WP-62's stated scope and the change set should **not** be committed until it lands, since as-is WP-62 converts a silent-wrong-data bug into a hard per-item failure for whole-object extract refs.

TS recommends TL route to **SA** for a quick fix-shape review (bytes-field resolution + the `from_file_object` annotation decision + compile-time-error option), then **Dev** to implement inside WP-62, then re-run this exact live validation (re-create the agent and confirm `file_content: {{attachment_content.data}}` and a green calibration).

> **Handoff:** TS recommends; TL routes. Diagnostic only — no product code, prompts, DSL, schemas, or backlog files were modified by this investigation.

---

## Live-validation scorecard (what the user actually wanted to know)

| Question | Answer |
|---|---|
| Did the extraction step bind `document-extractor`? | **YES** — `step6 action/document-extractor.extract_structured_data`. The predecessor RCA's defect (falling to `ai_processing`) is **fixed**. |
| Did the IntentContract persist this time? | **YES** — `agent_config.ai_context.intent_contract` + `data_schema` present. The WP-55 clobber is fixed. (`ai_context` holding only these two keys is **by design**, per `buildV6AiContext.ts` L5-7.) |
| Did Phase 1 emit the per-field `source` signal (the unproven link)? | **YES** — `date_time/vendor/amount: "document"`, `expense_type: "computed"`. The B1 steer works. |
| Did the CC-3a residual split work? | **YES** — verdict split 3 surface / 1 residual; `synthesizeResidualGenerateNode` emitted a well-formed step7 with correct wiring. |
| Did agent creation/generation fail? | **NO** — all 5 phases green, 11 steps, 69.2s. **Calibration** failed (`needs_review`), leaving the agent `draft`. |
| Did WP-62 cause the failure? | **YES (proximate)** — but no WP-62 component is defective; it exposed a pre-existing verbatim-copy gap at `IntentToIRConverter.ts:684`. WP-62 is **incomplete**, not wrong. |
| Is WP-62 safe to commit as-is? | **NO** — close the bytes-field resolution gap first. |

---

## Proposed V6 backlog entry (text only — do NOT write to WEAK_POINTS / OPEN_ITEMS)

Per CLAUDE.md V6 Work Protocol, TS proposes the entry text; TL/Dev own the actual write. This is a **WP-62 completion item**, not a new independent WP.

> **Problem:** A `document`-domain `extract` bound to `document-extractor.extract_structured_data` receives the **whole producer object** in `file_content` instead of the base64 **bytes field**, when Phase 1 emits a whole-object `extract.input` (e.g. `attachment_content` rather than `attachment_content.data`). `convertExtract`'s schema-aware mapping ([`IntentToIRConverter.ts:684`](../../lib/agentkit/v6/compiler/IntentToIRConverter.ts#L684)) copies the ref **verbatim** into the first `x-input-mapping` param and never navigates to the bytes field; the plugin's `x-input-mapping.from_file_object: "content"` hint is unused **and** disagrees with the Gmail producer's actual `data` field. Runtime rejects it: *"Parameter file_content should be string, got object"* → every scatter item fails → WP-10 throw → calibration `needs_review`. **Latent since before WP-62** (pre-WP-62 the shape rerouted to AI — the WP-62 bug — so it never ran); WP-62's correct routing is the first thing to route traffic through it. WP-62 removed Phase-1 dependence from the *routing* decision but not from the *input-ref granularity*.
> **Evidence:** agent `2ffcd7bf-3afc-45f5-8315-5ff00eb0d8a2` (live WP-62 validation, 2026-07-16). Persisted IC: `extract.input: "attachment_content"`, `uses: [{domain:document, capability:extract_structured_data}]`, per-field `source` present, `extract_coverage.covered: true` (3 surface / 1 residual, CC-3a). Compiled `step6.params.file_content: "{{attachment_content}}"`. Calibration `f5982d10-…`: *"Scatter item 0 failed at step step6: Parameter file_content should be string, got object"* (all 3 items). Contrast known-good agent `0ee53785` → `file_content: "{{attachment_content.data}}"` (worked only because Phase 1 happened to emit `.data`). All 5 phases green; generation did not fail.
> **Fix shape:** In `convertExtract`'s param mapping, when the target param's `x-input-mapping.accepts` includes `file_object` and the input slot resolves to a bytes-bearing object, emit `{{<input>.<bytesField>}}` — resolve `<bytesField>` from the producer slot schema via the existing `BYTES_FIELDS` set ([`IntentToIRConverter.ts:2168`](../../lib/agentkit/v6/compiler/IntentToIRConverter.ts#L2168)) / WP-62's `classifySchemaFileness`. Plugin-agnostic, schema-driven. Also: make `from_file_object` correct-and-applied or remove it; and prefer a clear compile-time error over emitting a param that violates its own declared type (WP-40 lesson). Add a regression case with a **whole-object** `extract.input` to `tests/v6-regression/scenarios/gmail-scatter-attachment-extract/`.
> **Why not caught earlier:** WP-62's unit/regression fixtures exercise the `.data` (already-navigated) ref shape; no fixture emits a whole-object `extract.input`, which is exactly what live Phase 1 produced. Phase-1 ref granularity is non-deterministic, so a passing capture doesn't prove robustness.

**Proposed one-line `V6_OPEN_ITEMS.md` pointer:**

> - WP-62 completion — `file_content` gets the whole object (not the `.data` bytes field) when Phase 1 emits a whole-object `extract.input`; hard-fails every scatter item. Blocks WP-62 commit. See WEAK_POINTS WP-62. (RCA: `docs/investigations/AGENT_RCA_CONCLUSION_wp62-live-validation-file-content-object.md`)

---

---

## Resolution (Dev, 2026-07-16) — implemented inside the WP-62 change set, uncommitted

> Appended by Dev. **The diagnosis above is unchanged and was accurate**; this section records what was implemented, plus **one correction** to a secondary premise (§ 8 item 2 / § 7 secondary — see "Correction" below).

**Implemented on `agent-failure-troubleshooting` (not committed):**

1. **Primary — bytes-field resolution in reliable code** (§ 8 item 1, as recommended). `IntentToIRConverter.convertExtract` now resolves the file-object param ref before building the deliver operation: when the target param's `x-input-mapping.accepts` includes `file_object` and the extract input resolves to a bytes-bearing **object**, it emits `{{<baseVar>.<bytesField>}}` → `file_content: {{attachment_content.data}}`, matching the known-good `0ee53785`. **Idempotent by construction** — the ref is always rebuilt from `baseVarOfRef(input)` + the schema's bytes key, so an already-`.data` ref resolves to the same `.data` (never `.data.data`). **Schema-driven** — the bytes key comes from the producing slot's schema via a shared `bytesFieldOf()`, so Drive→`content` and Gmail→`data` both work with zero plugin/field-name branches. Slot resolution reuses the same normalization as WP-62's authoritative CC-1 (`resolveSlotSchema`), so the mapping and the coverage verdict cannot disagree. This extends WP-62's thesis exactly as § 7 framed it: **ref granularity, like routing, is now decided by reliable code rather than inherited from Phase-1 phrasing.**

2. **Safe direction instead of a compile-time hard error** (§ 8 item 3, adapted). When the input resolves to an object with **no** bytes field, the converter does not emit a type-violating param: it reroutes that extract to the **AI net** with a structured Pino warning + `ctx.warnings` entry (visible, not silent — Principle 11). This keeps WP-62's "AI is the fallback of last resort" contract rather than hard-failing the whole compile, while still never emitting a DSL that lies about its param types. (§ 8 item 4 remains **rejected**, as recommended — the executor/validator was not loosened.)

3. **`BYTES_FIELDS` de-duplicated 3 → 1.** § 5 correctly noted the vocabulary already existed in `slotHasBytes`; it was in fact defined **three** times identically (`ExtractionCoverage.ts`, `slotHasBytes`, `findDownloadAction`). All now consume one exported definition (`BYTES_FIELDS_PRIORITY` + `bytesFieldOf()`/`schemaHasBytes()` in `ExtractionCoverage.ts`), with a deterministic preference order (`file_content > data > base64 > content`; `content` last because it is also a text marker). This closes the same divergence class SA flagged as the Round-1 HIGH.

4. **Regression coverage added** (§ 8 "Regression coverage to add", as recommended). The committed scenario `tests/v6-regression/scenarios/gmail-scatter-attachment-extract/` now asserts the compiled `file_content` resolves to a **string bytes ref**, and its fixture uses a **whole-object** `extract.input` — the exact shape that broke here. Plus 7 converter unit tests: whole-object → `.data`, braced variant, idempotency (`.data` and `{{.data}}` unchanged), a Drive-like producer → `.content` (proves schema-driven, not hardcoded), safe-direction (no bytes → AI net), and unknown-slot → verbatim (WP-57 path unchanged). **50 WP-62 tests pass**; the v6 suite is unchanged at its pre-existing 43-failure baseline; pilot + plugin suites 547 pass.

### Correction to § 5 / § 7 / § 8-item-2 — `from_file_object` is NOT dead code

The RCA states the `from_file_object` hint "is never applied" and is "dead, misleading metadata," recommending it be fixed **or removed**. **Removing it would have regressed WP-57.** It *is* consumed — by `ExecutionGraphCompiler.normalizeActionConfigWithSchema` ([L6273](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L6273) schema-aware, [L6281](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L6281) no-schema fallback) — just not by `IntentToIRConverter:684`, which is where the RCA was looking. Two consequences:

- Its value `"content"` is **correct for Drive**: `google-drive.download_file`'s bytes key genuinely *is* `content`, and WP-57's auto-inserted download output has **no data_schema slot**, so it lands on the L6281 no-schema fallback and relies on this hint. That is why WP-57's Phase E passed live. Deleting the hint would have broken it.
- It failed for **Gmail** only because the compiler's schema-aware branch matches the hint against the producing slot's real fields, and `attachment_content` has no `content` property (its bytes key is `data`) → no accessor → "pass the whole object" ([L6292-6294](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L6292)). The hint isn't dead — it's **producer-specific, and one hint can't serve two producers.**

**Resolution:** kept `from_file_object: "content"` and **added `from_base64_content: "data"`** to `document-extractor.file_content.x-input-mapping` — a hint the compiler *already supported* ([L6276](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L6276)) but which no plugin definition declared (and which the `InputMapping` type never declared either — now added). The compiler tries `from_file_object` then `from_base64_content` against the producing slot's actual fields, so Drive→`content` and Gmail→`data` both resolve. This is **compiler-side defense-in-depth**; the converter fix (1) is the root cause and normally means the compiler never has to navigate at all (Principle 4/7 — converter normalization + downstream tolerance for legacy/cached IR).

### Still open — live re-validation (the user's call)

Per § 10, the exact live validation must be re-run: **re-create the agent and confirm compiled `file_content: {{attachment_content.data}}` and a green calibration.** Not runnable in the Dev self-test environment (no live Gmail/Textract credentials). Until that passes, WP-62 + hotfix remain **uncommitted**. § 9's verdict stands and is worth restating: calibration behaved correctly — it caught a genuine blocking defect on first execution and refused to mark the agent production-ready. The gate did its job.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-16 | Initial RCA | Live WP-62 validation on agent `2ffcd7bf`. Generation green (11 steps); calibration `needs_review` on `step6` *"file_content should be string, got object"*. Attribution tested per WP-62 component: all new components work (incl. the previously-unproven Phase-1 `source` emission); failure traced to the pre-existing verbatim-copy at `IntentToIRConverter.ts:684` newly exercised by WP-62's correct routing. Recommend fixing inside WP-62 before commit. |
| 2026-07-16 | Resolution appended (Dev) | Hotfix implemented inside the uncommitted WP-62 change set: bytes-field navigation in `convertExtract` (idempotent, schema-driven, safe-direction reroute to the AI net when no bytes field resolves); `BYTES_FIELDS` de-duplicated 3→1 behind a shared `bytesFieldOf()`; +8 tests incl. the whole-object shape and an end-to-end scenario assertion (50 WP-62 tests pass, v6 baseline unchanged). **Correction filed:** `from_file_object` is NOT dead code — it is read by `ExecutionGraphCompiler` L6273/L6281 and is load-bearing for the WP-57 Drive path, so it was **kept**; `from_base64_content: "data"` was **added** alongside it (compiler already supported the hint; no def declared it) so Drive→`content` and Gmail→`data` both resolve. Live Phase E re-validation still required before commit. |
