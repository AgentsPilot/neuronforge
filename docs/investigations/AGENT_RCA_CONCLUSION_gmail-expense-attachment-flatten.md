# Agent RCA Conclusion — Gmail Expense Attachment calibration failure (`attachment_item.*` + flatten field-shape)

> **Last Updated**: 2026-07-08 (addendum: WP-55 IntentContract persistence clobber — see § "Addendum")
> **Agent**: `0ee53785-44d0-4b46-85dd-367551a657ba` ("Gmail Expense Attachment Table + Total Summary") · **Owner**: meiribarak@gmail.com (`868fda6a-59fa-4e99-8930-9951484078bf`)
> **Session**: `e5dd96fd-9f5d-4c00-93a7-b62186d7832f` · **History**: `583a5c00-e138-4f3a-aa64-fdd86ee579ff` · **Execution**: `36d0514c-dc08-4366-814e-e1c7c4f1ff43` · **Workflow hash**: `e892994eff35…`
> **Scope**: Why calibration ended `failed` after 3 iterations / 3 auto-fixes with 2 issues remaining, and where the real defect originated.
> **Skill chain**: `calibration-rca` (this doc) → `v6-pipeline` (named fix-owner). DIAGNOSTIC ONLY — no product code changed.

## Overview

Calibration honestly failed a workflow that **cannot run to completion**. The two "remaining issues" reported in the alert email are *symptoms*, not the root cause — and they are **not the only defects**. The true earliest root cause is a **V6-generation field-shape defect in the `flatten` step (step2)**: it declares its output items with **snake_case** field names (`mime_type`, `message_id`, `attachment_id`, `filename`) while the runtime `flatten` executor emits the Gmail plugin's **native camelCase** keys verbatim (`mimeType`, `message_id`, `attachment_id`, `filename`). That single schema-vs-reality mismatch (a) empties the downstream filter, (b) makes the scatter iterate nothing, and (c) confuses calibration's structural validators into raising an **unfixable** `broken_variable_reference` on `attachment_item.filename`. Calibration behaved correctly in *failing*; it just could not auto-repair a generation-layer schema defect, and its detectors under-reported the true blast radius.

---

## 1. Reported symptom

An internal **"Calibration failed"** alert email for agent `0ee53785-…` (Gmail Expense Attachment Table + Total Summary). Status `failed` after **3 iterations**, **3 auto-fixes applied**, steps 14 done / 0 failed / 0 skipped. Two issues remained after calibration gave up:

1. `broken_variable_reference` (medium): **"Step params reference non-existent variable: `attachment_item.filename`"**
2. `hardcode_detected` (medium): hardcoded `"500"` at `step1.params.max_results`, suggested param `step1_max_results`.

Teammate challenge (offir.omer): *"How do we know this is the only issue? Why doesn't calibration fix it? It looks like a simple issue."* — answered explicitly in §3 and §7.

## 2. Evidence gathered

| Script | Salient output |
|---|---|
| `npx tsx scripts/dump-calibration.ts 0ee53785-…` | Session `awaiting_fixes`, `issue_summary {critical:0, warnings:2, autoRepairs:1}`. **3 live session issues**: `broken_variable_reference` (`attachment_item.filename`), a **`high`/`configuration_missing` on step2** ("Flatten operation is missing required 'field' parameter … Available fields: labels, attachments"), and `hardcode_detected` on step1. History `failed`, `iterations=3`, `auto_fixes_applied=3`, `first_execution_success=false`, **`issues_remaining` = 2** (the step2 flatten issue no longer listed → it was auto-repaired mid-cycle). RCA HINT: earliest failing = step1/step2. No `metadata.auto_rca` present → full manual method. |
| `npx tsx scripts/dump-agent.ts 0ee53785-…` | `pilot_steps` (11 top-level, scatter step4 wraps step5–7). `agent_config.ai_context.intent_contract`/`data_schema` **not persisted** (pre-WP-55 / null) — generation diagnosed from the compiled DSL + plugin definition, per the non-determinism rule. |
| `lib/plugins/definitions/google-mail-plugin-v2.json` L408–435 | **Source of truth.** `search_emails` returns per-email `attachments[]` whose item fields are `filename`, **`mimeType`** (camelCase), `size`, `attachment_id`, `message_id`. There is **no** `mime_type` field. |
| `lib/pilot/StepExecutor.ts` L5019–5097 (`transformFlatten`) | Per-item extraction spreads each child **verbatim** (`...child`) and adds only `_parentId`/`_parentData`. **No field renaming.** Flattened items therefore keep the plugin's native keys (`mimeType`, `filename`, `attachment_id`, `message_id`). |
| `lib/pilot/shadow/StructuralRepairEngine.ts` L388–401, L1737–1798, L859–888 | The `broken_variable_reference` detector + its auto-fix handler (see §3). |
| `lib/pilot/shadow/ScatterItemFieldValidator.ts` L164–205 | Resolves scatter element fields from the source step's **stored** `output_schema` when the source is a transform (no plugin/action) — the schema-mutation trap that hid the mismatch. |

### The compiled data path (from `pilot_steps`)

| Step | Type / op | Key params | Emits |
|---|---|---|---|
| step1 | action `google-mail.search_emails` | `query`, `max_results: 500`, `include_attachments: true` | `expense_emails` (`emails[].attachments[]` with **camelCase** `mimeType`) |
| step2 | transform `flatten` | `input: {{expense_emails.emails}}`, `field: "attachments"`; declared item schema uses **`mime_type`, `message_id`, `attachment_id`, `filename`** | `all_attachments` |
| step3 | transform `filter` | condition `field: "mime_type" operator:"in"`; `_on_empty: "throw"` | `eligible_attachments` |
| step4 | `scatter_gather` over `{{eligible_attachments}}`, `itemVariable: "attachment_item"` | sub-steps reference `{{attachment_item.filename/.message_id/.attachment_id/.subject/.from/.date}}` | `expense_rows` |
| step5–14 | download → extract → normalize → sort/count/sum → compose → send | — | email report |

## 3. Earliest failing step + cascade

**Earliest real defect: step2 (`flatten`) — a field-name-shape mismatch between its declared `output_schema` and what the runtime flatten actually produces.** Everything else cascades from it:

1. **step2 declares `mime_type` (snake_case); the runtime item has `mimeType` (camelCase).** `transformFlatten` (`StepExecutor.ts` L5071 `...child`) copies the Gmail plugin's native keys unchanged — it never renames `mimeType`→`mime_type`. So `all_attachments[i].mime_type` is `undefined`.
2. **Cascade → step3 filter empties the set.** step3's condition is `field:"mime_type" operator:"in" [pdf/jpeg/jpg/png]`. With `mime_type` undefined on every item, nothing matches → `eligible_attachments = []`. With `_on_empty: "throw"`, this step throws "no eligible attachments" on any real run that reaches it. **This defect is NOT in either reported issue** — it is the hidden one the teammate suspected.
3. **Cascade → step4 scatter iterates an empty array**, so `attachment_item` never binds → `expense_rows` empty → the send step (step14) delivers an empty/degraded report (suppressed in dry-run by the recent empty-send guard, commit `2f40172`).
4. **The `attachment_item.filename` "broken variable" is a detector artifact of the same defect.** `StructuralRepairEngine.findBrokenVariableReferences` (L1737) flags any `{{root.field}}` whose `root` is not a step id / `output_variable` / one of a **hardcoded builtins set** — `['current_item','current_email','current_row','index','context','input','inputs','item','var']` (L1759). The scatter's declared `itemVariable` **`attachment_item` is not in that list**, so every `{{attachment_item.*}}` ref in step5–7 is reported as "reference non-existent variable" (L395–397). It surfaced on `.filename` first.

So the two "remaining issues" are: one **symptom** of the field-shape defect (`attachment_item.filename`) and one **unrelated cosmetic warning** (`hardcode_detected "500"`). The genuinely blocking defect (the `mime_type` filter empties the pipeline) was **auto-repaired at the wrong layer and never re-surfaced** — see §7.

## 4. Classified root-cause layer

**V6 generation.** The compiled DSL is internally inconsistent: step2's `flatten` output_schema names fields (`mime_type`, plus the snake_case set) that the flatten runtime — feeding from the Gmail plugin's camelCase output — does not produce, and step3/step4 then reference those non-existent field names. This is a generation-phase field-fidelity failure (the WP-56 family: a transform/scatter references a field the upstream element shape doesn't actually have), not a bad user value (input/data), not an API rejection (runtime/external), and not a calibration misreport.

Secondary/contributing layer — **calibration-detection (under-report + mis-targeted auto-fix)**: the `broken_variable_reference` detector does not treat a scatter's declared `itemVariable` as an in-scope variable, and the flatten auto-repair "fixed" step2 by re-setting `config.field` rather than reconciling the field-name shape (§7). These are contributing detector gaps, but the **durable owner is generation**.

## 5. Defensible root cause (the "why," with exact references)

**Primary (blocking):** `flatten` field-shape divergence.
- Plugin truth: `lib/plugins/definitions/google-mail-plugin-v2.json` **L408–435** — `attachments[]` items expose `filename`, `mimeType`, `size`, `attachment_id`, `message_id`. No `mime_type`.
- Runtime truth: `lib/pilot/StepExecutor.ts` **L5064–5096** — per-item flatten spreads `...child` verbatim, adds only `_parentId`/`_parentData`. No case/style normalization.
- Compiled DSL: step2 `config.output_schema.items.properties` declares **`mime_type`** (agent dump L196–205, L243) and step3 filters on **`field: "mime_type"`** (dump L269–283) with `_on_empty: "throw"` (dump L286). The reference and the reality disagree → empty filter → thrown/empty pipeline.

**Symptom-level:** `attachment_item.filename` flagged broken.
- `lib/pilot/shadow/StructuralRepairEngine.ts` **L1758–1760**: builtins allow-list omits scatter item variables; **L392–401**: any non-allow-listed `{{root.field}}` in a sub-step's params becomes a `broken_variable_reference`.
- **Unfixable** because the auto-fix handler (**L859–888**) only matches broken *step-id* variables against `validVarNames` (step ids + `output_variable` + `gather.outputKey`) and suggests a correction via Levenshtein ≤ 2. `attachment_item` is a **legitimate loop variable**, not a mistyped step id, so `suggestVariableCorrection` returns `null` → `autoFixable:false` (L399) → calibration can only warn, forever. That is precisely why "a simple issue" survived 3 iterations.

**Why the deeper `mime_type` defect was masked:** `ScatterItemFieldValidator.resolveElementFields` (`ScatterItemFieldValidator.ts` **L180–189**) prefers the plugin definition only when the scatter source is a plugin action. Here the scatter source is **step3 (a transform)**, so it falls back to step3's **stored** `output_schema` — which itself carries the wrong snake_case `mime_type`/`filename` set inherited from step2. The stored schema *agrees with the broken references*, so the validator sees no mismatch (the documented schema-mutation trap). No detector compares the flatten's *declared* item shape against the *plugin's actual* attachment item shape.

## 6. Named fix-owner

- **Primary — `v6-pipeline`** (field fidelity across a `flatten` boundary). The pipeline phase that emits the `flatten` step's `output_schema` and the downstream `filter`/`scatter` field references must derive those field names from the **producing plugin action's item schema** (Gmail `search_emails` → `attachments[].mimeType`), not invent a normalized snake_case shape. Candidate owners in order: IntentToIRConverter / ExecutionGraphCompiler where the transform I/O schema is synthesized; and the Phase-1 FIELD FIDELITY prompt guidance (same class as WP-56). Confirm against the persisted `intent_contract` on the *next* WP-55-era regeneration — this agent predates WP-55 persistence.
- **Contributing — `calibration`** (detection): (a) `StructuralRepairEngine.findBrokenVariableReferences` should treat a scatter/loop `itemVariable` as in-scope (resolve `{{itemVariable.field}}` against the iterated element schema, as `ScatterItemFieldValidator` already does) so it stops emitting a permanent unfixable warning; (b) a validator should compare a `flatten`'s declared item field names against the source plugin action's real item field names (camelCase vs snake_case), so the `mime_type` mismatch is *surfaced* instead of silently emptying the pipeline.

## 7. Why calibration applied 3 fixes and still failed (the teammate's question, answered)

Calibration is **not** buggy in its verdict — it correctly ended `failed`. But its auto-repair could not converge because the two survivors are, respectively, **structurally unfixable by design** and **not actually the blocker**:

1. **`attachment_item.filename` is unfixable by this repair path.** The `broken_variable_reference` fixer only knows how to (a) add missing `{{input.X}}` fields or (b) Levenshtein-correct a mistyped *step-id* variable (`StructuralRepairEngine.ts` L829–888). `attachment_item` is a valid loop variable with no near step-id match → `suggestion=null` → `autoFixable:false`. It re-emits identically every iteration; 3 iterations cannot resolve a warning the engine has no action for. It *looks* simple only because the fix (teach the detector about scatter item variables) lives in the detector, not in the DSL.
2. **The one genuinely blocking issue was "fixed" at the wrong layer and disappeared from the ledger.** The `high`/`configuration_missing` flatten issue *was* auto-repaired (it is in the session `issues[]` but absent from `issues_remaining`) — but the repair re-affirmed `config.field="attachments"` (root/per-item extraction) and never touched the **field-name shape** (`mime_type` vs `mimeType`). So calibration recorded a "fix," the blocking mismatch remained, and because the dry-run mailbox path produced an empty/degraded set that the empty-send guard suppressed (commit `2f40172`), no downstream "throw" propagated back as a *new* critical issue. The result: convergence limit hit (`awaiting_fixes` → `failed`) with the real defect **masked** behind a satisfied-looking flatten repair.
3. **Are these the only issues? No.** At minimum the **`step3` filter empties `eligible_attachments`** because of the `mime_type`/`mimeType` mismatch — a blocking defect neither reported issue names. Additional smells the reports don't surface: step3's `_on_empty:"throw"` will hard-fail a real run once step1 returns attachment-bearing mail; and every `{{attachment_item.*}}` ref (not just `.filename`) is technically flagged by the same detector gap. The two "remaining issues" are the tip; the flatten field-shape defect is the iceberg.

## 8. Did calibration behave correctly? (honest-failure distinction)

**Mostly yes — say so.** Calibration was right to end **`failed` / not production-ready**: this workflow genuinely cannot produce a correct expense report. That is honest failure detection, not a false alarm. **However**, two detection gaps are real and belong to the `calibration` owner: (a) it emitted a **permanent, unfixable** `broken_variable_reference` for a legitimate scatter variable (noise that misleads triage — "looks simple, won't fix"), and (b) it **under-reported blast radius** by treating a mis-targeted flatten repair as resolved, masking the `mime_type` filter-empties-everything defect. So: honest *verdict*, but a *misleading issue set*. This is not a "calibration lied about success" defect (that would be P1); it is honest-failure + two detector-quality gaps.

---

## Proposed V6 backlog entry (text only — do NOT write to WEAK_POINTS / OPEN_ITEMS)

Per CLAUDE.md V6 Work Protocol, TS proposes the entry text; TL/Dev own the actual write when the fix lands.

**Proposed `V6_..._WEAK_POINTS.md` entry (WP-NN — flatten field-shape fidelity):**

> **Problem:** A generated `flatten` step declares its item `output_schema` with normalized snake_case field names (`mime_type`, `message_id`, …) while the runtime `transformFlatten` emits the source plugin action's **native** keys verbatim (Gmail `search_emails` → `attachments[].mimeType`). Downstream `filter`/`scatter` reference the declared (non-existent) names → filter matches nothing → `eligible_attachments` empties → scatter iterates nothing → empty report. Also trips `broken_variable_reference` noise on the scatter `itemVariable`.
> **Evidence:** agent `0ee53785-44d0-4b46-85dd-367551a657ba`, session `e5dd96fd-…`. Plugin truth `google-mail-plugin-v2.json` L408–435 (`mimeType`); runtime `StepExecutor.ts` L5064–5096 (verbatim `...child`, no rename); DSL step2 declares `mime_type`, step3 filters on `mime_type` (`_on_empty:"throw"`).
> **Fix shape:** When synthesizing a `flatten` (and any transform crossing a plugin→transform boundary) output_schema and its downstream field refs, derive field names from the **producing plugin action's item schema** — never a re-cased/renamed shape. Add a validator comparing a flatten's declared item fields to the source plugin action's actual item fields.
> **Why not caught earlier:** `ScatterItemFieldValidator` resolves element fields from the **stored** schema when the scatter source is a transform (not a plugin action), so the mutated snake_case schema agreed with the broken refs (schema-mutation trap). No validator cross-checks a flatten's declared shape vs the plugin's real item shape.

**Proposed one-line `V6_OPEN_ITEMS.md` pointer:**

> - WP-NN — `flatten` field-shape fidelity (snake_case declared vs plugin camelCase native); empties downstream filter/scatter. See WEAK_POINTS WP-NN. (RCA: `docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md`)

---

## Answers to the three team questions

1. **What caused the failure?** A field-name-shape mismatch at the `flatten` boundary (step2). The runtime flatten emits the Gmail plugin's native `mimeType`/`filename`/`attachment_id`/`message_id` keys verbatim, but the generated DSL declared and referenced a normalized snake_case shape (`mime_type`, …). step3's filter on `mime_type` therefore matches nothing (`eligible_attachments = []`), the scatter iterates nothing, and the report is empty; separately the scatter's `{{attachment_item.filename}}` refs are flagged as "non-existent variable" by a detector that doesn't recognize scatter loop variables.
2. **Why wasn't the agent created as expected?** The **V6 generation** pipeline synthesized the transform/scatter field names as a normalized snake_case shape instead of deriving them from the producing plugin action's real item schema (Gmail `search_emails.attachments[].mimeType`). A field-fidelity failure of the WP-56 family, owned by `v6-pipeline`. (No persisted WP-55 `intent_contract` for this pre-WP-55 agent; diagnosed from the compiled DSL + plugin definition per the non-determinism rule.)
3. **Why didn't calibration fix it?** The `attachment_item.filename` warning is **structurally unfixable** by the repair engine — its `broken_variable_reference` fixer only corrects mistyped step-id variables or adds `{{input.X}}` fields; a valid scatter loop variable yields no suggestion → `autoFixable:false`, so it recurs unchanged across all 3 iterations. The one genuinely blocking issue (the flatten) was auto-repaired at the wrong layer (re-set `config.field`, never the field-name shape), so it vanished from `issues_remaining` while the real mismatch persisted — masked further by the empty-send guard suppressing the empty dry-run send. **These are not the only issues:** the `mime_type` mismatch empties the filter (a blocking defect neither reported issue names). Calibration's *verdict* was correct (honest failure); its *issue set* was incomplete and carried one permanent unfixable warning.

## Recommended remediation path

**Full cycle (not a hotfix).** The durable fix is a `v6-pipeline` field-fidelity change (derive flatten/scatter field names from the plugin action item schema; do not re-case), plus two `calibration` detector improvements (recognize scatter `itemVariable` in the broken-ref detector; add a flatten-declared-vs-plugin-actual field validator). That spans the generation pipeline and the shadow validators, needs SA design (WP-56-adjacent, touches IR/compiler schema synthesis) and QA regression via the V6 execution scripts — beyond a single-file hotfix. TS recommends TL route to **BA** to open a formal requirement referencing this doc and the proposed WP entry. The `hardcode_detected "500"` survivor is cosmetic (a `max_results` literal) and can ride along as a low-priority parameterization, not a blocker.

> **Handoff:** TS recommends; TL routes. Diagnostic only — no product code, prompts, DSL, schemas, or backlog files were modified by this investigation.

---

## Regression analysis — why this class re-surfaced on a post-fix agent

**Follow-up question:** "We already fixed this field-fidelity class (WP-2 / WP-56). Why a regression now?"

### Timeline — this is NOT a stale pre-fix workflow

| Fact | Value | Source |
|---|---|---|
| Agent `created_at` | **2026-07-07** 20:13:57 UTC | `agents.created_at` (read-only query) |
| Workflow hash | `e892994eff35…` | `calibration_history` (single row, 2026-07-07) |
| WP-2 field reconciliation shipped | **2026-03-30** (`ebe51c6`) | `git show -s ebe51c6` |
| O10/O10a compiler reconciliation shipped | **2026-03-20** (`dcb509c`) | `git show -s dcb509c` |
| WP-56 FIELD FIDELITY prompt rule shipped | **2026-06-08** (`4724e67`) | `git show -s 4724e67` |

The agent was generated **~1 month after the last relevant fix** by post-fix HEAD code. So this is a **genuine regression of an incompletely-closed class**, not an un-recalibrated old workflow. Hypothesis "(c)-as-stale-pre-fix-workflow" is off the table.

### Which hypothesis: (a) incomplete-coverage / (b) code-reverted / (c) conditionally-skipped?

**Verdict: (a) incomplete coverage.** The guard code is present in HEAD (not reverted), but its coverage never extended to the shape this agent hits.

1. **WP-56's fix was prompt-only and non-deterministic; the deterministic safety net was explicitly deferred and never built.** WP-56 is marked **🟡 Partial (2026-06-08)** in WEAK_POINTS.md L74. Its only shipped change is a Phase-1 prompt nudge (FIELD FIDELITY) in `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` L1291 (confirmed present in HEAD). The WP's own "Still open" list records: *"(i) deterministic safety net — extend WP-2-style reconciliation to scatter/loop iteration-variable field refs."* A prompt nudge only steers a non-deterministic LLM; on this generation it did not prevent the snake_case emission. There was never a deterministic guard to catch it.

2. **WP-2 / O10 reconciliation is scoped to `{{variable.field}}` template refs — the break here is a bare `condition.field` literal, which no branch inspects.** The corrector `checkSingleRef` (`ExecutionGraphCompiler.ts` L3507) only matches `{{variable.field}}` templates (L3517 `refPattern`) and bare `item.`/`element.` refs (L3577 `bareRefPattern`). step3's filter uses a plain object property `{ "field": "mime_type", "operator": "in", … }` (agent dump L269–283) — the value `"mime_type"` is a bare field-name string with no `{{…}}` wrapper and no `item.`/`element.` prefix, so it is invisible to every corrector branch. WEAK_POINTS.md L74 states the boundary in as many words: *"WP-2 reconciliation does NOT cover scatter/loop item-refs."*

3. **The one guard that DOES target `mime_type`→`mimeType` (O10a) exists but its lookup misses this step.** `reconcileTransformSchemaWithUpstream` (L3273, comment L3266 literally names the `mime_type`/`mimeType` case; shipped `dcb509c` 2026-03-20, present in HEAD) fires only from `buildSchemaMap` L3233 `if (step.type === 'transform' && step.config?.input)` and then looks up `fullSchemaMap.get(inputVar)` at L3236. For step2 `config.input` is the **dotted path** `"expense_emails.emails"` (agent dump L168), but `fullSchemaMap` is keyed by `output_variable` only — i.e. `"expense_emails"` — so `get("expense_emails.emails")` returns `undefined` and reconciliation is skipped (the O25a dotted-input handling at L3587 exists for the *bare-ref* path, but not for this schema-map reconcile path). And even had O10a corrected step2's own props to `mimeType`, it would still not rewrite step3's bare `condition.field` literal (reason #2).

### Pinpointed single reason

> **(a) Incomplete coverage.** The camelCase-vs-snake_case field-fidelity class was only *partially* closed: WP-56 (`4724e67`, 2026-06-08) shipped a **non-deterministic Phase-1 prompt nudge** and explicitly **deferred the deterministic safety net** ("extend WP-2-style reconciliation to scatter/loop iteration-variable field refs" — WEAK_POINTS.md L74, still open); and the deterministic reconcilers that do exist (O10/O10a, `dcb509c` 2026-03-20; WP-2, `ebe51c6` 2026-03-30) are **present in HEAD but structurally scoped** to `{{variable.field}}` / `item.`/`element.` references and to input variables keyed by a bare `output_variable`. This agent's break is a **bare `config.condition.field` literal** (`"mime_type"`, step3, agent dump L269–283) on a `flatten`-fed filter whose `config.input` is a **dotted path** (`expense_emails.emails`) — a shape none of the shipped guards inspect (bare-literal condition fields) or can resolve (dotted-path schema-map key at `ExecutionGraphCompiler.ts` L3236). Not reverted, not stale — a coverage gap the prior WPs knowingly left open. Evidence: WEAK_POINTS.md L74 (WP-56 🟡 Partial + "Still open"); `intent-system-prompt-v2.ts` L1291 (nudge present); `ExecutionGraphCompiler.ts` L3233–3240, L3266–3307, L3507–3572 (corrector scope + missed lookup); agent dump L168 (dotted input), L269–283 (bare `mime_type` filter). Owner: **`v6-pipeline`** — build the deferred deterministic reconciler covering (i) bare `condition.field` literals on transform/filter steps and (ii) dotted-path input variables in the schema-map reconcile, validated against the producing plugin action's item schema.

---

## Addendum — Why `intent_contract` / `data_schema` are null even on this post-WP-55 agent (persistence clobber)

> **Added**: 2026-07-08 · **Scope**: correction to §2 evidence + a *separate, independently shippable* defect surfaced while diagnosing this agent. **Owner: `agent-creation-flow`** (client save path), not `v6-pipeline`. This is a diagnosability defect, not the cause of the calibration failure above.

### The correction

§2's agent-dump row states `agent_config.ai_context.intent_contract` / `data_schema` were "**not persisted (pre-WP-55 / null)**" and the main RCA therefore fell back to diagnosing generation from the compiled DSL + plugin definition. That premise is **half wrong**. The agent was created **2026-07-07**, roughly one month *after* WP-55's persistence code landed, so "pre-WP-55" does not explain the null. The real reason both fields are null is a **clobber bug in the V6 client save path**: WP-55's persistence is written by a helper whose result is then overwritten before the row is saved. The consequence for RCA is real — the non-deterministic-regeneration fallback the main investigation was forced into (§5, §Q2) was **only** necessary because this bug silently discards the exact artifact WP-55 added to avoid it.

### The defect

The V6 branch of the agent-creation save flow builds `ai_context` **twice**, and the second build wins:

| # | Where | `ai_context` contents | Fate |
|---|---|---|---|
| 1 | `mapV6ResponseToAgent()` — `app/v2/agents/new/page.tsx` L266–278 | reasoning, confidence, original/enhanced prompt, **`intent_contract` (L276), `data_schema` (L277)** — the WP-55 fields, correctly read from `v6Response.intent_contract` / `.data_schema` | **discarded** |
| 2 | inline rebuild at the save site — L1382–1401 | reasoning, confidence, original/enhanced prompt, `generated_plan` — **no `intent_contract`, no `data_schema`** | **persisted** |

The merge at **L1404–1406** is the clobber:

```ts
agentData = {
  ...v6Agent,                 // v6Agent.agent_config has ai_context WITH intent_contract (build #1)
  agent_config: agentConfig,  // ← explicit key overwrites the spread with build #2 (no IC)
  ...
}
```

The explicit `agent_config` key shadows the spread, so build #1's `agent_config` (with the IntentContract) never reaches the payload. `POST /api/create-agent` then persists `agent_config` verbatim (`app/api/create-agent/route.ts` L175) — no server-side re-population — so the stored row carries only build #2's five fields. That is exactly the shape observed on this agent (reasoning + original_prompt + enhanced_prompt + confidence + generated_plan, no IC).

### Why it's a genuine dead path, not a mis-source

- The producing endpoint **does** return the artifacts at the top level: `app/api/v6/generate-ir-intent-contract/route.ts` L240–241 (`intent_contract: intentContract`, `data_schema: …`), under `architecture: 'intent_contract_pipeline_a'`.
- The response type declares them: `V6GenerateResponse.intent_contract` / `.data_schema` (`page.tsx` L96–97, WP-55 comment).
- `mapV6ResponseToAgent` reads them correctly (L276–277). So the data flows all the way to build #1 and is then thrown away by the merge — removing the clobber alone is sufficient to persist it. The V4 fallback branch (L1469) also omits the fields, but V4 produces no IntentContract, so its null is expected and out of scope.

### Fix shape (owner `agent-creation-flow`)

Restore WP-55 persistence at the save site (which owns the richer `creation_metadata` — real `thread_id`, `clarification_answers`, `enhanced_prompt_data`), and eliminate the divergent builder at the root so this cannot silently regress again:
- Extract a pure, exported `buildV6AiContext(args): CreateAgentAIContext` (`app/v2/agents/new/buildV6AiContext.ts`) as the **single source of truth** for `ai_context`, sourcing `intent_contract`/`data_schema` from the V6 response (`v6Data.intent_contract` / `.data_schema`, `?? null`).
- Call it from the save handler `createAgent` (`page.tsx`), and **remove** the now-dead `agent_config` construction from `mapV6ResponseToAgent` (it was always overridden — build #1 was the clobber victim).
- Add a co-located Jest regression (`__tests__/buildV6AiContext.test.ts`) pinning "IntentContract present ⇒ persisted non-null" plus the save-site merge shape — the assertion WP-55 shipped without.

### Blast radius

**Every V6/Pipeline-A agent created since WP-55 shipped has a null `intent_contract`/`data_schema`**, defeating WP-55's entire purpose (turn Phase-1 emission diagnosis into a SQL lookup instead of a non-deterministic re-run). This does **not** change the primary RCA verdict above — the flatten field-shape defect stands on the compiled DSL — but it is why that verdict had to be reconstructed the hard way, and it will keep forcing the non-deterministic fallback on every future creation-side RCA until fixed.

**Status:** ✅ Fixed 2026-07-08 (see Change History) — divergent builder removed; `ai_context` centralized in `buildV6AiContext`; regression test added. SA APPROVE-WITH-NITS, QA PASS.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-08 | Addendum + fix | Documented the WP-55 IntentContract persistence clobber in the V6 save path (`page.tsx` L1404–1406) and corrected §2's "pre-WP-55" premise. Initial fix carried `intent_contract`/`data_schema` into the inline `ai_context`. |
| 2026-07-08 | Refactor (SA nit) | Extracted single-source `buildV6AiContext` helper, removed the dead `agent_config` build from `mapV6ResponseToAgent`, added `__tests__/buildV6AiContext.test.ts` (6 cases, green). Closes the divergent-builder smell + the missing WP-55 regression coverage. |

---

## Role of the Workflow Data Schema object — did the "one shared shape" fail to propagate?

**Follow-up question (user's architectural intuition):** "A schema data object is supposed to define the exact structure for ALL objects across the DSL — every step should use the SAME shape. How did step2 end up with an `ai_declared` `mime_type` item shape that diverges from step1's `plugin` `mimeType`? Investigate the ROLE of the schema data object."

### 1. What IS the schema data object?

It is a real, named construct: the **`WorkflowDataSchema`** — `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` L86–88:

> `interface WorkflowDataSchema { slots: Record<string, DataSlot> }`

Each `DataSlot` (L56–80) is one named output ("slot") with a `schema: SchemaField`, a `produced_by` step, and `consumed_by[]`. It is built **deterministically in Phase 2 (CapabilityBinderV2)** by `DataSchemaBuilder.build()` (`DataSchemaBuilder.ts` L61–144), from four sources (file header L5–9): plugin `output_schema` (`source:"plugin"`), LLM-declared `output_schema` for shape-**changing** transforms (`source:"ai_declared"`), LLM-declared `fields[]`/`outputs[]` for extract/generate (`source:"ai_declared"`), and derived schemas for shape-**preserving** transforms/loops/aggregates (`source:"inferred"`). The `source` tag on each step's `output_schema` in the DSL dump (`plugin` / `ai_declared` / `inferred`) is exactly this lineage marker.

The **design intent** is unambiguous: the plugin schemas are the single source of truth and every downstream reference should use the producer's real field names. `V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` L116, L293, L327, L456 all state the thesis — inject the producing action's actual field names so *"[the LLM] uses `from` not `sender`, `id` not `message_id`, because those are the field names it sees."* So the user's intuition is architecturally correct: divergence like `mime_type` vs `mimeType` is exactly what this object is meant to prevent.

### 2. Single source of truth, or per-step copies?

**Both — and that is the crux.** There is ONE canonical `WorkflowDataSchema.slots` map (the intended source of truth), but its per-slot `schema` is **not always a projection of the producer's real shape**: for `ai_declared` slots it is a *verbatim copy of what the LLM authored*, never reconciled against the upstream producer slot. The DSL's per-step `output_schema` copies are serializations of these slots. So the object is canonical in *structure* (one slot per output) but **not canonical in *field-name fidelity*** — an `ai_declared` slot can carry field names that contradict its own producer slot, and nothing forces agreement.

### 3. Why the shared structure did NOT propagate here — exact mechanism

The propagation that *should* have inherited step1's plugin attachment item shape (`mimeType`, `filename`, `attachment_id`, `message_id`) into step2's flatten output slot is **short-circuited by WP-18 Bug A**. `DataSchemaBuilder.inferSchemaForTransformStep()` — `DataSchemaBuilder.ts` **L282–287**:

> ```ts
> // WP-18 Bug A: LLM-declared output_schema wins for ANY transform op.
> if (step.transform.output_schema) {
>   return this.convertJsonObjectToSchemaField(step.transform.output_schema, 'ai_declared')
> }
> ```

Because step2 (the flatten) carried an LLM-authored `output_schema` (the snake_case `mime_type`/`message_id`/… block, DSL dump L171–208), this branch returns it **verbatim as `ai_declared`** and returns *before* the flatten-inherit path at **L289–295** — the path that would have unwrapped step1's array items and inherited the plugin's real `mimeType`. The LLM declaration literally **overrode** the shared-shape inheritance.

And **no later pass repairs it**:
- **Pass 2c** `fixupDerivedTransformSchemas` (**L711–739**) is gated to shape-**preserving** ops only — `if (!op || !SHAPE_PRESERVING_OPS.has(op)) continue` (**L719**). `flatten` is a shape-**changing** op (L43 `SHAPE_CHANGING_OPS`), so it is skipped entirely.
- Even for the ops it does touch, it only overwrites when `outputSlot.schema.items?.type === 'any'` (**L729–732**) — i.e. it fills *empty* item shapes, but never *reconciles concrete-but-wrong-cased* field names. A declared shape that "looks real" (`mime_type`) is treated as authoritative.

So there is **no pass in `DataSchemaBuilder` that compares an `ai_declared` transform slot's field names against its producer slot's field names.** The `mime_type` shape enters the canonical slot map unchallenged and serializes into step2's DSL `output_schema` — and step3's filter is then authored against that same wrong `mime_type`.

**Is this the SAME break as the O10a `fullSchemaMap` dotted-path miss? No — it is a SECOND, independent, and upstream gap.** They are two different phases failing on the same class:
- **Gap A (this section) — Phase 2 authoring gap** (`DataSchemaBuilder`, capability-binding): the canonical data-schema slot is *created wrong* — an `ai_declared` flatten schema is admitted without reconciliation to its producer. This is where `mime_type` *originates* in the shared object.
- **Gap B (Regression analysis §, above) — Phase 5 safety-net gap** (`ExecutionGraphCompiler` O10/O10a): the compiler reconciler that could have *rescued* it later misses because step2's `config.input` is a dotted path (`expense_emails.emails`) not keyed in `fullSchemaMap`, and because step3's break is a bare `condition.field` literal outside the corrector's `{{var.field}}` scope.

Gap A **plants** the divergence in the source-of-truth object; Gap B **fails to catch** it downstream. Fixing either alone would have prevented this agent's failure; the durable fix belongs at Gap A (don't admit an unreconciled `ai_declared` transform shape into the canonical schema).

### 4. Verdict

**(ii) — There IS a single shared data-schema object, but the propagation/reconciliation that binds a transform's declared schema to its producer's real field names is incomplete for the flatten→filter path.** It is not the case (i) that steps author schemas in a vacuum with no shared object: the `WorkflowDataSchema.slots` map (Phase 2, `DataSchemaBuilder`) is precisely the canonical registry the user describes, and the design (`V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` L116/L293/L456) intends every reference to use the producer's real field names. The flaw is that **WP-18 Bug A** (`DataSchemaBuilder.ts` L282–287) makes an LLM-declared transform `output_schema` win for **any** op — including shape-changing `flatten` — and returns it as `ai_declared` **without reconciling it against the producer slot's plugin-sourced field names**; the fix-up convergence loop (Pass 2c, L711–739) is scoped to shape-preserving ops with `type:"any"` items and never revisits a concrete-but-wrong `ai_declared` flatten slot. Net: the shared object exists and is authoritative in structure, but its field-name fidelity guarantee was **explicitly deferred** in the design (L165: *"Include the upstream output_schema field names in the LLM prompt … deeper changes to Phase 1/2 … deferred for later"*), so a flatten can legally publish a snake_case shape that its own camelCase producer contradicts. **Owner: `v6-pipeline` (Phase 2 CapabilityBinderV2 / `DataSchemaBuilder`)** — reconcile an `ai_declared` transform slot's item field names against the `produced_by` input slot's schema (plugin source of truth) before admitting it to `WorkflowDataSchema.slots`, so the "one shared shape" the user expects is actually enforced, not merely intended.

---

## Should the compiler have caught this? — plugin-field-fidelity vs step-to-step reference integrity

**Follow-up question (user):** "Isn't it the compiler's job to identify that the DSL references field names the plugins don't support?"

Short answer: the compiler validates **reference integrity between steps** (does a consumer reference a field the PRODUCER STEP DECLARES) — it does **not** validate **field fidelity against the plugin definition** (does that declared field actually exist in the producing plugin action's real output). The user's suspected nuance is correct. Evidence:

### 1. Is there a compiler pass that checks DSL field refs against the plugin definition's real output schema?

**Almost none — and not on the path that matters here.** The reference reconciler `reconcileFieldReferences` -> `buildSchemaMap` builds its schema map from each **step's own `output_schema`** (`ExecutionGraphCompiler.ts` L3220-3225: `extractSchemaProperties(step.output_schema)` / `fullSchemaMap.set(step.output_variable, step.output_schema)`) — i.e. from **declared** schemas, whatever their `source` tag. It never re-reads the plugin definition to validate a transform's declared fields.

There *is* exactly one spot that consults the plugin definition's real output: `getActionOutputSchema()` (L6366, reads `actionDef.output_schema`) + `schemaContainsField()` (L6390), used at L6184-6197. But its scope excludes this case three times over:
- It fires **only inside `x-variable-mapping` param normalization** (L6173) — a plugin-parameter feature, not a general field-ref validator.
- It reads `ctx.variableSources`, which is populated **only for `fetch`/`deliver` (plugin-action) steps** (L479: `operation_type === 'fetch' || 'deliver'`). Transform steps (step2 flatten) are **never registered** there, so their `ai_declared` output is not even a candidate.
- It emits a **`this.warn(...)`** (L6191), not a hard failure, and only for a `mapping.field_path` — never for a transform/filter `condition.field`.

So: **no compiler pass validates a transform's declared field names, or step3's `condition.field`, against the producing plugin action's real output schema.** `mime_type` was never checked against Gmail's `mimeType`.

### 2. Why step3's `condition.field:"mime_type"` was NOT caught — the exact mechanism

**Your hypothesis is confirmed.** The step-to-step consistency check is *satisfied* because it validates against the **declared** producer schema, and the lie lives in that declaration:

- The reconciler only attempts a correction when a referenced field is **absent** from the producer's schema map — `checkSingleRef` L3532 (`if (field in props) continue`) and the bare-ref path L3603 (`if (field in props) continue`). `resolveFieldMismatch` (L3668) is invoked **only on a miss**.
- step2's `output_schema` is `source:"ai_declared"` and **does contain `mime_type`** (agent dump L196-205). So any reference resolving against step2's slot finds `mime_type` present -> **exact match -> `continue` -> no mismatch, no correction, no warning.**
- (Independently, step3's `mime_type` is a **bare `config.condition.field` literal**, which — as established in the Regression analysis section — the corrector's `{{var.field}}` / `item.`/`element.` scanners don't even inspect. So even the declared-schema check never runs on it. Two reasons it sails through: the declared schema *agrees*, and the literal is *out of scanner scope*.)

The compiler treats the `ai_declared` transform schema as **ground truth** and validates references *against* it, rather than validating *it* against the producer's real plugin schema. That is the mechanism.

### 3. Is there ANY point a plugin-unsupported field WOULD be caught — e.g. a direct `{{step.output.field}}` ref into a `source:"plugin"` schema?

**Partially, and weakly.** If the bad field were referenced **directly off a plugin-output variable** (not laundered through a transform), two things could fire:
- **O10/O10a reference reconciliation** (`checkSingleRef` L3507): a `{{expense_emails.mime_type}}`-style ref would resolve against step1's `source:"plugin"` slot, miss (step1 has `emails[].attachments[].mimeType`, no top-level `mime_type`), and `resolveFieldMismatch` (L3668, casing-fuzzy `mime_type` vs `mimeType`) could **auto-correct** it. This is the WP-2 safety net — but it works on `{{var.field}}` templates, not bare `condition.field` literals, and only when the producing slot is the plugin schema (not a transform's laundered `ai_declared` copy).
- **The `x-variable-mapping` check** (L6187) would warn — but only for plugin-param mappings on `fetch`/`deliver` variables.

Crucially, **the transform laundered the field name out of plugin scope.** Once step2 republishes the attachment items as an `ai_declared` slot with `mime_type`, step3 references a *transform* variable, not a *plugin* variable — so the plugin-schema-aware paths never apply. The direct-plugin-ref safety net exists but was bypassed the moment the shape passed through the flatten.

### 4. Verdict for the user

**(ii) — validating plugin-unsupported field names is NOT the compiler's job today; it trusts declared schemas by design, and the one plugin-schema-aware check is narrowly scoped to plugin-param mappings.** The compiler's field-reference validation (O10/O10a) is a **step-to-step reference-integrity** check against declared producer schemas plus a **casing/fuzzy corrector** (WP-2 safety net) — both operate on what steps *declare*, and both are template-ref-scoped. There is no general "does this declared field exist in the producing plugin action's real output?" gate. So "the compiler should catch plugin-unsupported field names" is a **legitimate gap to close, not a currently-owned responsibility that merely failed.**

Relation to Gap A / Gap B (so this isn't read as a third restatement):
- **Gap A** — Phase 2 `DataSchemaBuilder` *admits* the unreconciled `ai_declared` flatten shape into the canonical `WorkflowDataSchema` (where `mime_type` originates). **Prevention.**
- **Gap B** — Phase 5 `ExecutionGraphCompiler` O10/O10a *fails to rescue* it (dotted-path schema-map miss + bare-`condition.field` out of scanner scope). **Missed cure at the existing safety net.**
- **This question (Gap C)** — a *distinct, stronger* class of check the compiler does **not** implement at all: **validate declared transform/step field names against the producing plugin action's real `output_schema`** (the `getActionOutputSchema`-style plugin-truth check), so an `ai_declared` schema that contradicts its plugin producer is rejected regardless of whether any later reference happens to be in corrector scope. Gap B is "the existing corrector didn't fire on this shape"; Gap C is "no plugin-truth validation gate exists to begin with."

**Recommendation:** a **plugin-schema-validation gate is a legitimate THIRD layer of defense**, complementary to the Phase-2 reconciler the requirement already calls for. Defense-in-depth: (1) **Phase 2 (primary, Gap A fix)** — reconcile an `ai_declared` transform slot's item field names to the `produced_by` plugin slot before admitting it to `WorkflowDataSchema` (stops the lie at authorship); (2) **Phase 5 (Gap B fix)** — extend O10a to bare `condition.field` literals and dotted-path input keys (widens the existing corrector); (3) **Compile-time gate (Gap C, this section)** — a validation pass that walks every step's declared `output_schema` whose lineage traces to a plugin action and asserts its item field names exist in that action's real `output_schema` (via `getActionOutputSchema`), failing/flagging on divergence. (1) prevents, (2) corrects, (3) catches — and (3) is the one that most directly answers "shouldn't the compiler notice the field isn't on the plugin?": today it structurally cannot, because it never compares declared fields to plugin-real fields outside the narrow `x-variable-mapping` path. Owner for all three: **`v6-pipeline`**.

---

## Why calibration cannot catch this (even for deterministic steps)

**Follow-up question (user):** step2 (flatten) and step3 (filter) are DETERMINISTIC transforms with knowable outputs — so why can't calibration solve this? This is the crux.

### 1. What data does the dry-run feed the transforms? — REAL Gmail, not fixtures

Calibration's Layer-3 dry-run does **not** synthesize fixtures from declared schemas. It runs the **actual execution engine against real plugin data**:

- `DryRunValidator.validateWithDryRun()` (`lib/pilot/shadow/DryRunValidator.ts` L55-92) constructs a real `WorkflowPilot` and calls `pilot.execute(pilotAgent, userId, '', inputValues, …, 'batch_calibration', …)` — the same engine production uses, with `runMode='batch_calibration'`. Header comment L2-4: *"Executes workflow with REAL user input data to detect runtime issues."*
- `batch_calibration` mode does **not** stub plugins; it only makes execution **lenient** (collect issues and continue instead of hard-failing) — `WorkflowPilot.ts` L509 `isBatchCalibration`, L1088-1143 "collect issues after failure." step1 really called Gmail: `execution_summary.data_sources_accessed = [{count:14, action:"search_emails", plugin:"google-mail", description:"Found matching emails"}]` and `plugins_used:["google-mail"]` (calibration_history).

**So hypothesis #1 (fixtures fabricated from step2's declared `mime_type` schema, making the filter match in dry-run) is REFUTED.** The dry-run used real Gmail attachment items — which carry `mimeType`. That means the divergence was *present* in the data. Why it still didn't surface is answered in #3 — and it is NOT because fixtures hid it.

### 2. Do calibration's validators reason about the declared schema (the same blindness as the compiler)?

**Yes — same ground-truth blindness (Gap C) on the static side.** The two static validators that touch this both source "the field exists" from the **stored/declared `output_schema`**, never the plugin definition:

- `StructuralRepairEngine.findBrokenVariableReferences` (`lib/pilot/shadow/StructuralRepairEngine.ts` L1737-1768) validates a variable's *root* against step ids / `output_variable` / a hardcoded builtins list — it does not validate `.field` segments against any schema at all. It flags `attachment_item.filename` only because the scatter item-var isn't recognized (a false-positive), not because it checked field fidelity.
- `ScatterItemFieldValidator.resolveElementFields` (`ScatterItemFieldValidator.ts` L164-205) *does* compare scatter item-refs to an element schema — but when the scatter source is a **transform** (step3), it falls back to the transform's **stored** `output_schema` (L189), which carries the same snake_case lie. It prefers the plugin definition only when the source is a plugin action (L181-188), which step3 is not. So it sees `mime_type`/`filename` as legitimately present and raises no mismatch (the documented schema-mutation trap).

Neither validator holds a plugin-schema oracle for a transform-produced slot. Step3 references `mime_type`, step2 *declares* `mime_type` → the static consistency check is satisfied — the identical blindness the compiler has (see "Should the compiler have caught this?" § Gap C).

### 3. The 14/0/0 puzzle — why no step failed despite `_on_empty:"throw"`

Facts to reconcile: `completed=14, failed=0, skipped=0`, yet `status=failed`; and step3 has `_on_empty:"throw"` (agent dump L286).

**Why no step registered failed:** `_on_empty:"throw"` fires only under a two-part guard — `StepExecutor.ts` L2761-2768: `if (onEmpty && Array.isArray(result) && result.length === 0)` **and** L2762-2763 `inputLength > 0`. The throw is raised only when the filter empties a **non-empty** input. Here step2's flatten (`_on_empty:"warn"`, dump L211) fed step3 an **empty** array — because the 14 matched emails yielded no eligible attachment items into `all_attachments` (either the query's emails had no attachments, or the `mime_type` divergence had already collapsed the item shape upstream). With `inputLength === 0`, the `inputLength > 0` guard is **not met**, so step3 takes the `warn` path, not `throw`. No exception → no failed step → the filter's emptiness is silently a "0 from 0," which the engine treats as benign. (Even had it thrown, `batch_calibration` leniency would have collected it as an issue and continued — but it never reached that.)

**Why "failed" then:** the final status is decided **purely from the issue ledger, not the execution counters** — `app/api/v2/calibrate/batch/route.ts` L4444-4445: `const hasCriticalIssues = summary.critical > 0; const calibrationStatus = hasCriticalIssues ? 'needs_review' : 'failed'`. The session's `issue_summary` was `{critical:0, warnings:2, autoRepairs:1}` → `critical===0`, and the loop exited non-converged with 2 warnings still unrepaired (`issues_remaining`: the unfixable `attachment_item.filename` + the `hardcode "500"`) → status `failed`. `completed_steps/failed_steps` (14/0/0) are copied straight from the last dry-run's `finalResult` (L4437-4438) and had no bearing on the verdict. **So: 14/0/0 = the live run threw no exception (throw-guard bypassed by empty input); "failed" = two unrepaired warning issues kept it out of production-ready.** The two facts are independent — execution counters vs issue ledger — and both are consistent with the dump.

### 4. The core "why" — ranked, and why "deterministic steps" doesn't save calibration

Calibration is incapable here due to a combination, ranked by causal weight:

1. **(b) It trusts declared schemas as ground truth — no plugin-schema oracle (primary).** Every static validator (and the compiler) checks step3's `mime_type` against step2's *declared* `mime_type` and finds them consistent. Nothing compares the transform's declared item fields to Gmail's real `mimeType`. This is the same Gap C blindness end to end. Determinism does not help: the steps are perfectly deterministic, but they are deterministic **relative to a lying schema** — a deterministic filter on a field the data doesn't have deterministically returns nothing, and no validator knows the field is wrong.
2. **(a) The dynamic path that COULD have observed the real-vs-declared divergence was neutralized by data + guard, not by fixtures.** The dry-run *did* run on real `mimeType` data, so in principle the emptiness was observable — but step2 fed step3 an empty input, so the one runtime signal that would have screamed (`_on_empty:"throw"`, or even the `empty_result` heuristic at `DryRunValidator.ts` L107-121) never triggered: the `inputLength > 0` guard suppressed the throw, and the final output emptiness didn't register as the flagged `empty_result` type on this run. The dynamic oracle exists but was silent on this specific data shape.
3. **(c) Even if detected, the repair engine can't rewrite this class.** As established earlier, the `broken_variable_reference` fixer only corrects mistyped step-ids or adds `{{input.X}}` fields (`StructuralRepairEngine.ts` L829-888); it has no action for a field-name-shape mismatch or a valid loop variable → the one issue it *did* surface is permanently `autoFixable:false`.

**Head-on to the user's framing — why "deterministic steps with clear outputs" does NOT save calibration:** determinism guarantees the steps behave the *same way every time given the same input* — it does **not** guarantee anyone validates the *field names* against the plugin's real output. The transforms are deterministic, but they were authored against a **declared schema that lies about the producing plugin's field casing** (`mime_type` vs `mimeType`). A deterministic `filter` on `mime_type` deterministically matches zero real rows — and because (b) no static validator has a plugin-schema oracle for a transform slot, and (a) the runtime symptom was masked by an empty upstream + the `inputLength>0` throw guard, and (c) the one surfaced issue is unrepairable — calibration converges to "can't fix," honestly, without ever naming the real defect. Determinism makes the failure *reproducible*, not *detectable*: detection requires comparing declared fields to plugin-real fields, which nothing in calibration (or the compiler) does today. **Primary reason: (b) declared-schema-as-ground-truth; enabled by (a) the runtime oracle being silent on this data; sealed by (c) unrepairable even if flagged.** The durable fix is upstream (Gap A: Phase-2 reconcile the declared transform schema to the plugin producer) plus the plugin-schema gate (Gap C) — calibration is the wrong layer to expect a cure.

### Origin of the empty attachment list

**Follow-up question:** the dry-run ran on real Gmail (14 emails matched), yet step2's flatten fed step3 an empty array. Where did the emptiness actually come from, in plain terms — and is it the same problem as the `mime_type` field-name bug or a separate one?

#### Evidence available (and its limit)

What the run **did** persist (execution `36d0514c-…`, session `e5dd96fd-…`, history `583a5c00-…`):
- `agent_executions.logs`: `stepsCompleted=14, stepsFailed=0, stepsSkipped=0`, `success=true`, final `response="Workflow completed"`. `agent_executions.result` is `null`; `workflowExecution` is empty; `agent_logs` for this agent: **0 rows**.
- `execution_summary`: `items_processed:14`, `data_sources_accessed:[{count:14, action:"search_emails", plugin:"google-mail"}]`, `plugins_used:["google-mail"]`, `data_written:[]`.

**The intermediate step values were NOT persisted.** `items_processed:14` and `count:14` both count **step1's `search_emails` output** — the metric collector records the plugin operation's returned item count (`StepExecutor.ts` L6398-6408, `extractItemCount` of the action output). So we can confirm **14 emails were returned**, but the run kept **no record of the `attachments` arrays, `all_attachments`, or `eligible_attachments`**. That is an evidentiary limit — the specific attachment values are not recoverable from the DB for this run — so the step-by-step below combines the one hard number (14 emails) with deterministic code behavior.

#### The wiring is sound — ruling out option (ii)

The flatten is correctly wired to the real data shape, so "flatten couldn't find the attachments" is **not** the cause:
- Real Gmail `search_emails` with `include_attachments:true` (DSL L28) returns each email carrying an `attachments[]` array, and each attachment item is emitted with `filename`, **`mimeType`**, `size`, `attachment_id`, `message_id` (and legacy `attachmentId`/`messageId`) — `gmail-plugin-executor.ts` L769-783. Note: the real item has **`mimeType` only — there is no `mime_type` key**.
- step2's flatten reads `input:"{{expense_emails.emails}}"` → the emails array, and `field:"attachments"` → per-item extraction of each email's `attachments[]` (`StepExecutor.ts` L5064-5096). This lines up exactly with the real shape. So **whenever an email has attachments, the flatten produces items — and those items carry `mimeType`, never `mime_type`.** Option (ii) is ruled out.

#### So the emptiness is (i) or (iii) — and both point at the SAME root, in sequence

Two candidates remain, and the un-persisted intermediate means we name the likely one and prove the causal relationship rather than guess the exact row counts:

- **(i) The 14 matched emails had no eligible attachments this run** → step2's flatten had nothing to extract → `all_attachments` empty → step3 filter received empty input → (as established) `_on_empty:"throw"` was bypassed by the `inputLength>0` guard → the pipeline ran to the end on an empty list, sending an empty/degraded report (suppressed by the dry-run empty-send guard). In this case the `mime_type` bug never got the chance to bite — it is **latent**.
- **(iii) The emails DID have attachments** → step2 flatten produced items carrying **`mimeType`** → step3's filter tested `mime_type` (which those items don't have) → every item's `mime_type` read as "missing" → the `in [pdf/jpeg/png]` test matched nothing → `eligible_attachments` empty. In this case the emptiness **is** the `mime_type` bug, firing exactly as the RCA predicts.

**Why the distinction doesn't change the root cause:** in case (iii) the field-name bug *is* the emptiness. In case (i) the field-name bug is dormant this run but **guaranteed to produce the identical empty result the moment any matched email carries a PDF/image attachment** — because step3 will always test `mime_type` against items that only have `mimeType`. Either way the workflow **cannot ever produce a non-empty expense table**: with no attachments it has nothing; with attachments the filter drops them all. The two branches are not two different bugs — they are "the bug is asleep" vs "the bug is awake," on the same defect.

(Precise-wording correction to the earlier calibration section: saying "step2 fed step3 empty" was the *proximate* runtime observation. Strictly, either step2 was empty because there were no attachments (i), **or** step2 was non-empty and step3's `mime_type` filter emptied it (iii). Both are consistent with the captured `_on_empty` non-throw only if step2 was empty — i.e. the *observed non-throw* specifically implies branch (i) occurred on THIS run, because a non-empty step2 emptied by step3 would satisfy `inputLength>0` and **would** have thrown. So: on this specific run the evidence — no thrown step, 14 emails, throw-guard requires non-empty input — points to **(i): the 14 emails had no eligible attachments this run**, with the `mime_type` bug latent.)

#### Relationship to the `mime_type` field-name bug — the unambiguous causal chain

1. On THIS run: the immediate reason the attachment list came out empty was almost certainly **(i)** — the 14 emails Gmail matched did not carry eligible (PDF/image) attachments, so there was simply nothing to put in the table. (Proof it wasn't (iii) on this run: if attachments had existed, step2 would have been non-empty, and step3 emptying a non-empty input would have tripped `_on_empty:"throw"` and shown a failed step — but the run was 14/0/0 with no throw.)
2. The **`mime_type` vs `mimeType` mismatch is a separate, still-latent defect** on this run — it did not cause this run's emptiness, but it is real and will cause the identical empty result on the first run where a matched email has a PDF/image attachment.
3. So there are effectively **two problems stacked**, and the workflow fails on whichever applies: today, no eligible attachments to process; the day attachments appear, the filter silently discards them all. Neither path yields a populated report. The `mime_type` bug is the durable one to fix; the "no attachments this run" is a data condition, not a bug.

#### Plain-language summary (no code terms)

The agent searched Gmail and found 14 emails, but on this particular test run those emails did not carry any PDF or image attachments — so there was simply nothing to build the expense table from, and the report came out empty. That is the immediate reason this run produced an empty list. Separately, there is a hidden naming bug: the agent looks for an attachment's file-type under the label "mime_type," but Gmail actually labels it "mimeType" (same word, different capitalization). That bug did nothing this run because there were no attachments to check — but the moment a matched email does include a PDF or image, the agent will look under the wrong label, find nothing, and throw every attachment away, producing the same empty report. So it is **two problems, not one**: an empty inbox result today, and a dormant naming mismatch that will empty the list tomorrow. Fixing the naming bug is what makes the agent actually able to produce a report once real attachments arrive.

### The hardcoded 500 — where it came from and why it lingered

**Follow-up question:** the user never asked for 500 (`step1.params.max_results:500`). Where did it come from, and why did calibration flag it but never fix it across 3 iterations?

#### A) Where the `500` came from — the LLM invented it during V6 generation

It was **written by the Phase-1 IntentContract LLM during V6 generation**, not by the plugin, the compiler, or the user. Evidence:

- **Not the plugin default.** The Gmail plugin defines `search_emails.max_results` as `default: 10, minimum: 1, maximum: 100` (`lib/plugins/definitions/google-mail-plugin-v2.json` L305-310). So `500` is neither the plugin's default (10) nor even within its allowed range — **it exceeds the plugin's stated `maximum: 100`.** (The plugin only warns above 100/50 via `condition` hints at L344-354; it doesn't hard-clamp.)
- **Not a compiler/step-builder default.** A search of the V6 pipeline finds no code that injects `500` into `max_results`; the `500`s in the codebase are unrelated (LLM `max_tokens`, log-truncation lengths).
- **The prompt explicitly told the LLM NOT to do this.** `intent-system-prompt-v2.ts` L139-140 gives the exact anti-pattern: *"WRONG: config declares max_results with default 50, step uses literal 50; CORRECT: step uses `{ kind: "config", key: "max_results" }`,"* and L2156 reinforces making `max_results` a config key. The model ignored that guidance and baked a bare literal `500` straight into `step1.params` — a number it picked itself (the user's inputs were only the 12-month window, subject keywords, and "PDFs & images").

So in plain terms: when the generator built the "search Gmail" step, it decided on its own to cap the search at 500 emails and wrote that number directly into the step, instead of making it an adjustable setting — and it even picked a number the Gmail connector says is too high.

#### B) Why it was flagged, then never fixed

**Why flagged:** `HardcodeDetector` flags any bare literal sitting directly in a step's `.params` as a value that ought to be an adjustable input. For `step1.params.max_results:500` it hits the "values directly in `.params` are configuration" rule (`HardcodeDetector.ts` L438-453): category `configuration`, priority `medium`, `suggested_param` `max_results` (surfaced as `step1_max_results`), reason "Configuration parameter used in [the Search Gmail step]." (`max_results` is not on the technical-skip allow-list at L88-99, so it isn't exempted the way `query`/`mime_type` are.) That is exactly the issue in the alert.

**Why never auto-fixed — by design, not a failed attempt.** Your hypothesis is correct. Every hardcode detection is constructed as a **user-confirmation suggestion, explicitly non-auto-applicable**: `IssueCollector.ts` L326-327 sets `autoRepairAvailable: false` and `requiresUserInput: true` on the issue, with a `suggestedFix.type: 'parameterization'` (L314-324). The reason is structural: turning a literal into a named input **changes the agent's input schema and needs a human to supply a field label and confirm a default** — the system will not silently rewrite the agent's inputs (the same WP-40 "no silent rewrites" contract). So no auto-fix ever ran and reverted; it was never eligible for auto-fix in the first place. Because it needs user action and no user acted during the auto-loop, it stayed in the remaining-issues list on every iteration.

**It is NOT execution-breaking.** Severity for a `configuration` hardcode is `medium`, never critical (`IssueCollector.ts` L896-906: `configuration → 'medium'`). The agent runs perfectly fine with `max_results:500` — the value works at runtime (the connector just returns up to what it allows). This is a **code-quality / reusability nag** ("you could make this adjustable"), not a runtime fault. It contributed `0` to the run's `critical` count (`issue_summary:{critical:0, warnings:2}`), which is why the final status resolved to `failed` only via the *warnings-remain-unresolved* path (`app/api/v2/calibrate/batch/route.ts` L4444-4445), not because anything broke.

#### C) One-line verdict for the user

The `500` was a number the AI generator made up on its own when building the Gmail-search step (the user never asked for it, and it's actually above the connector's stated max of 100) — and calibration didn't "fail to fix" it so much as **correctly decline to auto-change it**: converting a fixed value into an adjustable setting rewrites the agent's inputs, so it's offered as a suggestion a human must confirm, never applied silently. It is a cosmetic/reusability nag, not a real breakage, and on its own it should not count as a hard failure — the run was only marked "failed" because it, plus the (also non-critical) `attachment_item.filename` warning, stayed unresolved through the auto-loop.

---

## Live Re-run RCA (2026-07-11) — post Phase 0/1

> **Added**: 2026-07-11 · **Scope**: a LIVE calibration re-run of agent `0ee53785-…` with the newly-shipped Phase 0/1 field-fidelity + calibration-verdict changes active. Run window ~06:25–06:32 (`dev.log`). New session `92b928db-97d8-44f9-972b-f57e024e1aa1`, history `93450b15-993e-4374-a11a-08a7d6863912`, execution `4c2b39d3-c5ff-442b-9787-0f8921c86416` (dry-run exec id `61d9fa74-…`). DIAGNOSTIC ONLY — no product code changed.

### Plain-language top line

Our Phase 0/1 fix **worked** — the original flatten→filter naming bug is gone (the filter now keeps 13 PDFs instead of 0). But the re-run surfaced **three new, independent problems**, and none of them is the same bug we just fixed:

1. **The PDF loses its "this is a PDF" label between two steps.** The download step (step5) correctly produces a real PDF (`mimeType: application/pdf`), but the way the extract step (step6) is wired throws the whole download result into one text box, so the extractor can no longer see it is a PDF, calls it `application/octet-stream`, and refuses it — on **every** attachment. Result: 13 rows, all blank. **Owner: V6 generation (field-fidelity) — same class as the original, one step further down. NEW instance.**
2. **The report's "From / Subject / Date" columns are blank** because the flatten never carries the parent email's `from`/`subject`/`date` as the fields the report asks for (it tucks `from`/`subject` under an internal `_parentData` and drops `date` entirely). **Owner: V6 generation (reference shape) + a small runtime gap in the flatten. NEW item, separate from #1.**
3. **A useless all-blank report can still slip past the "did it really work?" guard.** The new coverage floor only counts *how many rows* were delivered, not whether they contain *any real data*. This run was saved only by luck (the blank send was not counted as delivered, so the floor happened to fire). **Owner: calibration. NEW item — a real hole in the anti-false-success guarantee.**

**Actual verdict of this run: `corrected_not_verified` ("We fixed an issue, but could not fully verify it yet") — DB status `needs_review`, `isPassing: false`.** Calibration did **not** pass this run and did **not** falsely call it green — but it also **never saw** the extraction failure or the blank data. It held the run back for an unrelated reason (a correction was applied but the real path was not verified), not because it detected the empty report.

### 1. Reported symptom

Post-fix calibration re-run produced empty report emails (~13 blank rows). Every scatter item's `document-extractor.extract_structured_data` (step6) failed with `Unsupported MIME type: application/octet-stream`; step7 built 13 rows with `amount/vendor/date_time/source_email_from` all empty. UI showed only the cosmetic "Hardcoded Values (500)" heads-up.

### 2. Evidence gathered

| Evidence | Salient output |
|---|---|
| `dev.log` L1575–1580 | `[FieldFidelityCorrector] Applied in-place field-fidelity corrections … "step2:mime_type→mimeType"` — **our fix ran and persisted before the dry-run.** |
| `dev.log` L4614 (transformFilter) | flatten output item `{"filename":"trip-receipt-2_…pdf","mimeType":"application/pdf", …}` — filter now reads `mimeType` and keeps PDFs. Original 0-kept bug **resolved.** |
| `dev.log` L6702–6716 | step5 `get_email_attachment` produced correct objects: `filename:"Invoice677931.pdf", mimeType:"application/pdf", size:51342`. **The executor did NOT return octet-stream.** |
| `dev.log` L6740 | step5 output object preview: `{"filename":"Invoice677931.pdf","mimeType":"application/pdf","size":51342,"data":"JVBERi0xLjcK…"}` (`JVBERi0` = `%PDF-` in base64 → genuine PDF). Stored to variable `attachment_content` (L6777, `valueType:"object"`). |
| `dev.log` L7231–7257 | step6 extractor took the **string** branch: `WARN: Could not detect MIME type from magic bytes … firstBytes:[126,41,94,…]` → `detectedMimeType:"application/octet-stream"` → `Using provided file content string … contentLength:68642, mimeType:"application/octet-stream", filename:"document"`. Bytes `126,41,94` decode `"fil…"` — i.e. the extractor received the **JSON-stringified object**, not the base64 PDF. |
| `dev.log` L7261–7300 | `DeterministicExtractor: Extraction failed — Unsupported MIME type: application/octet-stream` thrown at `DeterministicExtractor.buildExtractionInput` (`DeterministicExtractor.ts:288`, the final `throw` after all handlers). Caught by `extract()` try/catch → `createFailureResult` (success:false). |
| `dev.log` L8063/L8130/L8197 | per-item extract output `{"_extraction_metadata":{"confidence":0,"method":"text","success":false,"missing_fields":["date_time","vendor","amount","currency","expense_type"]…}}` — every item returned success:false, all fields missing. **The throw was swallowed into a valid-looking empty result → no failed step, no calibration issue.** |
| DSL (`dev.log` L1972–2007) | step6 params: `output_variable:"attachment_content"`, action `extract_structured_data`, **`"file_content": "{{attachment_content}}"`** — the whole step5 object wired into one string param. |
| DSL (`dev.log` L2059, L4042–4053) | step7 instruction pulls `source_email_from` ← `attachment_item.from`, `source_email_subject` ← `attachment_item.subject`, date fallback ← `attachment_item.date`. step2 flatten `output_schema.required` still lists `subject, from, date, mime_type`. |
| `StepExecutor.ts` L5071–5080 (transformFlatten) | flatten enriches each child with `...child` + `_parentId` + `_parentData:{id, messageId, subject, from}`. **Parent fields are nested under `_parentData`; `date` is not carried at all.** step7's flat `attachment_item.from/.subject/.date` therefore resolve to `undefined`. |
| `dev.log` L64125–64137 | final `execution_summary`: `items_processed:14`, **no `items_delivered` key** (→ `?? 0`), `data_written:[]`, `plugins_used:[]`. |
| `dev.log` L64150–64161 | final verdict: `calibrationStatus:"needs_review", verdict:"corrected_not_verified", isPassing:false, blockingIssues:0, criticalIssues:0, totalIssues:1`. |
| `npx tsx scripts/dump-calibration.ts 0ee53785-…` | new history `93450b15` = `needs_review`, `iterations=1`, `auto_fixes_applied=0`, `first_execution_success=true`, `issues_remaining:[hardcode_detected "500"]`. The `broken_variable_reference` from the original run is **gone**. |

### 3. Earliest failing step + cascade

**Earliest new real failure: the step5→step6 boundary (extract input wiring).** step5 emits a correct PDF object; step6's `file_content:"{{attachment_content}}"` serializes that object to a JSON string, so the extractor loses the `mimeType:"application/pdf"` field, magic-byte detection on the JSON text returns `application/octet-stream`, and `buildExtractionInput` throws for all 13 items. Cascade: extractor catches its own throw → returns `success:false` empty data → step7 builds 13 blank rows → sort/count/sum operate on blanks → step13 composes an empty table → send is empty. The blank `source_email_from/subject`/date are a **second, independent** defect (parent-field carry-forward), not a cascade of the octet-stream failure — they would be blank even if extraction succeeded.

### 4. Classified root-cause layer (per new issue)

| New issue | Layer | Same class as original? |
|---|---|---|
| octet-stream extraction failure (step5→step6) | **V6 generation** (field fidelity; compiler wiring of plugin-object → plugin-params) | **Same CLASS** (declared/wired shape vs real runtime object shape), **distinct INSTANCE** — a plugin→plugin object-vs-param mapping, not a transform `output_schema` recasing. In scope for the planned Phase 2/3 field-fidelity work as a new case. |
| blank `source_email_from`/`subject`/`date` | **V6 generation** (reference shape) + **runtime** (`transformFlatten` `_parentData` omits `date`) | Same field-fidelity class; **NEW, independent item.** |
| coverage floor counts rows, not data quality | **calibration-detection** | **NEW calibration item** (not a generation bug). |
| 100%-failing extract raised **zero** calibration issues | **calibration-detection** | **NEW calibration item** — the extractor swallows its throw into a "valid empty" result, so no step fails and no issue is raised. |

### 5. Defensible root cause (with references)

**(1) octet-stream extraction — generation wired the whole object into one param.**
- step5 output is correct: `gmail-plugin-executor.ts` L306–338 derives `mimeType` from the `.pdf` filename extension → `application/pdf`; confirmed live at `dev.log` L6705/6740.
- The break is the wiring: DSL step6 `file_content:"{{attachment_content}}"` (`dev.log` L2007). A whole-object placeholder inside a **string** template is coerced to JSON text before it reaches the plugin. `document-extractor-plugin-executor.ts` L61 tests `typeof file_content === 'object'`; because it arrived as a **string**, the object branch (L66–71, which would have read `file_content.mimeType`) was **skipped** and the string branch (L80–94) ran → `detectMimeTypeFromBase64` on JSON-as-base64 → `application/octet-stream` (`DeterministicExtractor.ts` L288 throw).
- Correct wiring would bind the fields explicitly: `file_content ← {{attachment_content.data}}`, `mime_type ← {{attachment_content.mimeType}}`, `filename ← {{attachment_content.filename}}` (the plugin already declares `mime_type`/`filename` params, L48). The executor's object branch would also work **if** the resolver passed the object un-stringified — a contributing runtime enabler, but the durable fix is generation binding the specific fields.

**(2) blank parent-email columns.** step7 references flat `attachment_item.from/.subject/.date` (`dev.log` L2059), but `transformFlatten` (`StepExecutor.ts` L5071–5080) exposes parent `from`/`subject` only under `_parentData` and **never carries `date`**. The flatten `custom_code` *claims* to "carry forward the parent email id, subject, from, and date" (`dev.log` L4041) — the claim is not honored by the runtime. Declared item schema still lists `subject/from/date` as present (L4046–4053), which is why calibration's static validator wrongly reassured "these fields exist on attachment_item … this is actually correct" (`dev.log` L1484) — the same declared-schema-as-ground-truth blindness (Gap C).

**(3) coverage floor is a row COUNT, not a data-quality gate.** `app/api/v2/calibrate/batch/route.ts` L4316/L4636: `exercisedRealPath = !(processed > 0 && delivered === 0)` where `delivered = execution_summary.items_delivered ?? 0`. `CalibrationVerdict.computeVerdict` (`CalibrationVerdict.ts` L155–177) only checks the boolean `exercisedRealPath`; it never inspects field values. `items_delivered` is set only when `> 0` (`ExecutionSummaryCollector.ts` L217). On this run `items_delivered` was absent → `delivered=0` → `exercisedRealPath=false` → with `corrected=true` the verdict capped at `corrected_not_verified`. **That cap was incidental** (the blank send was not counted as delivered). Had the 13 built rows registered as delivered, `exercisedRealPath` would be `true`, the only remaining issue (`hardcode_detected`) is **waveable** (`CalibrationVerdict.ts` L52–55, L112–120), so `computeVerdict` would return **`passed`** (L192–204) for a 13-row all-blank report. **Genuine false-green gap: delivered-rows ≠ meaningful-data.**

**(4) 100%-failing extract is invisible to calibration.** The extractor catches its `Unsupported MIME type` throw (`DeterministicExtractor.ts` L247–250 → `createFailureResult`) and the executor applies fallback values (`document-extractor-plugin-executor.ts` L145–151), so the scatter records a per-item **success** with empty data (`dev.log` L8063). No step fails (14/0/0), no issue is raised (`totalIssues:1` = only the hardcode). A step that failed extraction on 100% of items produced zero calibration signal.

### 6. Named fix-owner

| Issue | Fix-owner |
|---|---|
| octet-stream extraction (step5→step6 wiring) | **`v6-pipeline`** — Phase 2/3 field-fidelity: when a plugin-action object feeds another plugin action, bind the consumer's params to the producer's specific fields (`.data`/`.mimeType`/`.filename`), not the whole object into one string param. (Secondary/optional runtime hardening: template resolver preserves object type for whole-placeholder templates.) |
| blank parent-email columns | **`v6-pipeline`** (reference the actually-carried shape) **+ `lib/pilot` StepExecutor** (`transformFlatten` should carry `date` and expose parent fields under the referenced names, or generation must reference `_parentData.*`). |
| coverage-floor row-count gap | **`calibration`** — `CalibrationVerdict` + coverage signal + `ExecutionSummaryCollector`: add a data-quality dimension (non-empty / non-degraded delivered items), do not treat raw delivered-count as "real path exercised." |
| invisible 100%-failing extract | **`calibration`** — surface an all-items-degraded/all-empty scatter output (and/or extractor `success:false` on 100% of items) as a blocking-class issue instead of swallowing it. |

### 7. Suggested solutions

- **Extraction (durable):** generation emits `extract_structured_data` with `file_content ← {{attachment_content.data}}`, `mime_type ← {{attachment_content.mimeType}}`, `filename ← {{attachment_content.filename}}`. Add a field-fidelity rule for plugin→plugin object handoffs (bind fields, never whole objects into scalar string params).
- **Extraction (defense-in-depth):** template resolver returns the raw object when a param value is exactly one whole-object placeholder, so the executor's existing object branch (`document-extractor-plugin-executor.ts` L61–79) can read `.mimeType`.
- **Parent fields:** either (a) generation references `attachment_item._parentData.from/.subject` and the flatten additionally carries `date`; or (b) `transformFlatten` promotes parent `from/subject/date` to the top-level names the report asks for. Fix `_parentData` to include `date` (`StepExecutor.ts` L5074–5079) regardless.
- **Coverage floor:** extend the coverage signal so `exercisedRealPath` requires delivered items to carry meaningful (non-empty/non-fallback) values, not just a positive count; and/or raise a blocking issue when extractor `success:false` (or fallback-applied) covers 100% of scatter items.

### 8. Recommended remediation path

- **Extraction octet-stream (#1)** and **parent-field carry-forward (#2):** fold into the **already-planned Phase 2/3 field-fidelity full cycle** as two new cases (they are the same class as the original, not new classes). Not a hotfix — they touch generation field-binding + (for #2) a runtime flatten change; needs SA design + QA regression.
- **Coverage-floor false-green (#3)** and **invisible 100%-failing extract (#4):** **NEW calibration items** — recommend a **full cycle** (they change the anti-false-success guarantee semantics and issue-surfacing, SA-level design). #3 is the one that most directly matters to the user: it is the difference between "13 blank rows quietly pass" and "held back for review." TS recommends TL route both extraction/parent items into the Phase 2/3 requirement and open a **new calibration requirement** for #3+#4.

### Honest-failure distinction

**Calibration behaved honestly on the verdict — say so — but was blind to the real defect.** It correctly returned `corrected_not_verified` / `needs_review` / `isPassing:false` and did **not** falsely mark the run green. However, that hold-back was for the coverage-floor "correction applied, real path not verified" reason — **not** because calibration detected the octet-stream extraction failure or the all-blank report (it saw neither: `totalIssues:1` was only the cosmetic hardcode). So: honest verdict, but two genuine detection gaps (#3 row-count coverage floor; #4 swallowed 100%-failing extract). This is not a "calibration lied about success" defect; it is honest-non-pass + two detector-quality gaps.

### Proposed backlog entry text (do NOT write to WEAK_POINTS / OPEN_ITEMS)

> **WP-NN — plugin→plugin object handoff field fidelity (extract input).** *Problem:* generation wires `extract_structured_data.file_content` to a whole `get_email_attachment` object via a scalar string template (`"{{attachment_content}}"`); the object is JSON-stringified in transit, the extractor loses `mimeType:"application/pdf"`, magic-byte detection returns `application/octet-stream`, and extraction throws on every item → all-blank report. *Evidence:* agent `0ee53785-…`, exec `61d9fa74-…`; step5 emits `application/pdf` (dev.log L6705/6740); step6 receives a 68642-char JSON string (dev.log L7231–7257); DSL L2007. *Fix shape:* bind consumer params to producer fields (`.data`/`.mimeType`/`.filename`); add a plugin→plugin object-handoff field-fidelity rule; optional resolver hardening to preserve object type for whole-placeholder templates. *Why not caught earlier:* the original fix (Phase 0/1) corrected the flatten→filter recasing one hop upstream; no rule covers plugin-object→plugin-param scalar wiring.
>
> **WP-NN — flatten parent-field carry-forward.** *Problem:* `transformFlatten` nests parent `from`/`subject` under `_parentData` and omits `date`; generation references flat `attachment_item.from/.subject/.date` → blank report columns. *Fix shape:* carry `date` in `_parentData` and/or reference `_parentData.*` / promote parent fields to top level. *Evidence:* `StepExecutor.ts` L5071–5080; DSL L2059; L4041 custom_code claim vs runtime.
>
> **CAL-NN — coverage floor is a row-count, not a data-quality, gate.** *Problem:* `exercisedRealPath = !(processed>0 && delivered===0)` treats any positive `items_delivered` as "real path exercised"; a 13-row all-blank report with only a waveable issue would verdict `passed`. This run escaped only because the blank send zeroed `items_delivered`. *Fix shape:* require delivered items to carry meaningful values; raise a blocking issue when 100% of scatter items extract to empty/fallback. *Evidence:* `calibrate/batch/route.ts` L4316/L4636; `CalibrationVerdict.ts` L155–204; `ExecutionSummaryCollector.ts` L217; run verdict `corrected_not_verified` (dev.log L64150–64155).

> **Handoff:** TS recommends; TL routes. Diagnostic only — no product code, prompts, DSL, schemas, or backlog files were modified by this investigation.

### Change History addendum

| Date | Change | Details |
|------|--------|---------|
| 2026-07-11 | Live re-run RCA | Post Phase 0/1 re-run of `0ee53785-…`. Confirmed the flatten→filter fix worked (13 PDFs kept). Found 3 new independent issues: (1) step5→step6 octet-stream extraction (V6 field fidelity, new instance); (2) blank parent-email columns (flatten carry-forward, new); (3) coverage-floor row-count false-green gap + invisible 100%-failing extract (calibration, new). Actual verdict: `corrected_not_verified` / `needs_review`. |

---

## Regression vs Novel-Shape Comparison (2026-07-11)

> **Added**: 2026-07-11 · **Scope**: does the V6 regression suite already contain a passing Gmail-search-with-attachments scenario that proves agent `0ee53785-…` is a genuine regression — or is this agent's chain structurally different / a coverage gap? Read-only codebase comparison. DIAGNOSTIC ONLY.

### Plain-language top line

**It is NOT a code regression — nothing that used to work broke.** Two separate things are going on:

1. **The `mime_type` vs `mimeType` filter bug (already fixed) is a "bad dice roll" from the generator**, not a regression. The closest passing regression scenario wired the filter on the *correct* `item.mimeType`; this agent's generation happened to emit the wrong-cased `mime_type`. The generator is non-deterministic, so a later generation drew a worse shape. Same conclusion as the original RCA's "incomplete coverage."
2. **The octet-stream extraction failure and the blank parent-email columns are NOT new bindings this agent invented — the "passing" regression scenario wires them IDENTICALLY.** The reason the regression suite is green while the real run fails is that **the suite never actually verified real attachment extraction**: every Gmail-attachment scenario "passed" Phase E with its extraction path recorded (in its own caveat) as *empty*, *untested*, or *fabricated*. So the suite's green was never proof the chain produces a real report. This is a **regression-suite coverage gap**, not a broken commit.

**Bottom line for the user's challenge:** the "passing" scenarios do NOT actually produce a correct data-filled report either. By their own recorded caveats they deliver an empty/fabricated report and the suite calls that a pass. Agent `0ee53785` reaches the same empty end-state; the only extra is the `mime_type` dice-roll that made it fail a little earlier and louder.

### The analogs compared

| Scenario | search_emails | get_email_attachment | extract_structured_data | flatten | `phase_e_success` | What the caveat says about the extraction path |
|---|---|---|---|---|---|---|
| **expense-invoice-email-scanner** (closest analog) | ✅ | ✅ | ✅ | ✅ | `true` | "image-PDF extraction returns **Unknown defaults**; email delivered but **content fabricated** … Real extraction requires text-layer PDF or Textract." |
| orders-po-extractor-xlsx | ✅ | ✅ | ✅ | ✅ | `"pipeline_passed_no_data"` | "step1 returned 0 results … **Extraction / grouping / per-vendor scatter logic UNTESTED because input was empty.**" |
| po-monitor-supplier-confirmation | ✅ | ✅ | ✅ | ✅ | `"pipeline_passed_no_data"` | "step3 flatten produced 0 attachments … **UNTESTED: document-extractor on real PO attachments.**" |
| drive-invoice-summary-extractor (Drive, not Gmail) | — | — | ✅ | — | `true` | "document-extractor field quality imperfect … mis-parsed (WP-59); the **LLM summarizer smooths it**." |

**No regression scenario has ever validated `search_emails → get_email_attachment → extract_structured_data` producing real extracted values end-to-end.** Each is green via cascade-integrity / no-fabrication-guard, with the extraction itself empty, untested, or fabricated.

### A) Extractor handoff (Finding 2 — object-into-scalar): IDENTICAL wiring, not a worse binding

| Source | `extract_structured_data.file_content` |
|---|---|
| Agent `0ee53785` (failing) | `"{{attachment_content}}"` — whole object (`dev.log` L2007) |
| expense-invoice-email-scanner (passing) | `"{{attachment_content}}"` — whole object (`phase4-pilot-dsl-steps.json` **L444**) |
| orders-po-extractor-xlsx (passing) | `"{{attachment_content}}"` (**L400**) |
| po-monitor-supplier-confirmation (passing) | `"{{attachment_content}}"` (**L570**) |

**The passing scenarios pass the whole object to the extractor exactly like the failing agent** — so this agent did **not** produce a worse binding. Tellingly, the same generator DOES decompose the object for a *different* consumer in the same passing DSL — the Drive upload uses `file_content:"{{attachment_content.data}}"`, `file_name:"{{attachment_content.filename}}"`, `mime_type:"{{attachment_content.mimeType}}"` (expense scenario **L588–591**). So the generator inconsistently binds `.data`/`.mimeType` for Drive but the whole object for the extractor — in the passing scenario and this agent alike. This is a **latent, shared defect**, not a novel one.

**Why the passing scenario doesn't hit octet-stream while the live run does — and why it supports SA's resolver fix:** the DSL simulator's variable resolver **preserves object type** for a whole-string placeholder — `variable-store.ts` **L119–130**: a `^\{\{(.+?)\}\}$` match `return resolved // preserves type — object`. So under the simulator the extractor's object branch (`document-extractor-plugin-executor.ts` L61–79) reads `.mimeType` from a real object. The **real runtime resolver instead stringifies** the whole-object placeholder to JSON (live evidence: 68642-char string, magic bytes `"fil…"`, `dev.log` L7231–7257) → the extractor's string branch → `application/octet-stream` → throw. **The extractor CAN handle a real object; the live break is purely the real resolver stringifying the whole-object placeholder.** SA's runtime-resolver fix (preserve object type for whole-placeholder templates, matching what the simulator already does at `variable-store.ts` L129) is directly supported.

### B) Flatten + parent-field pattern (Finding 3): IDENTICAL shape, not novel

The passing analog uses the same `flatten` on `attachments` with a `custom_code` claim to carry parent fields, and declares flat `from/subject/date` in its output_schema:
- `phase4-pilot-dsl-steps.json` **L146–199**: `"operation":"flatten"`, `custom_code:"…carrying parent email fields (id, from, subject, date) alongside each attachment…"`, `field:"attachments"`, output_schema.items declares `from, subject, date, mimeType, attachment_id` (L161–192).

This is the same flatten-then-scatter shape as agent `0ee53785` (which references flat `attachment_item.from/.subject/.date`). It is **not novel**. It passes Phase E only because the simulator's flatten fabricates items from the **declared** output_schema — `dsl-simulator.ts` **L169–199** (`generateFromSchema(step.output_schema …)`) — so the flat `from/subject/date` "exist" in the simulator. The **real `transformFlatten`** nests parent fields under `_parentData` and drops `date` (`StepExecutor.ts` L5071–5080), so those columns are blank at real runtime. The simulator's schema-driven flatten structurally cannot expose this. (In the preserved stub snapshot the flatten even produced `[]` — `output/workflowpilot-execution-log.txt` L158, step2/3/4 all `[]` — so the extract step never ran there at all.)

### C) mime_type vs mimeType filter: passing scenarios used the CORRECT `mimeType` — this agent's is a novel worse shape

| Source | Filter field |
|---|---|
| Agent `0ee53785` (failing) | `mime_type` (snake_case — the bug we fixed) |
| expense-invoice-email-scanner (passing) | `"field":"item.mimeType"` (`phase4` **L270**); flatten declares `mimeType` (**L173**) |
| po-monitor-supplier-confirmation (passing) | `"field":"item.mimeType"` (**L388**) |

**The passing scenarios never had the recasing bug — they used the plugin's real `mimeType`.** Agent `0ee53785`'s generation drew `mime_type`. Non-deterministic generation produced a worse shape here; not a code regression. (Consistent with the original RCA's regression-analysis §: the deterministic reconciler that would have caught it was explicitly deferred/partial.)

### D) Verdict — REGRESSION or NOVEL/COVERAGE GAP?

**Not a code regression. Two distinct causes, neither of which is "something that used to work and broke":**

1. **`mime_type` filter (already fixed) — NOVEL WORSE SHAPE from non-deterministic generation.** The passing analogs use `item.mimeType`; this agent emitted `mime_type`. New-case exposure, not a broken commit.
2. **Octet-stream extractor handoff (Finding 2) + blank parent fields (Finding 3) — NEW-CASE EXPOSURE of a latent defect the "passing" scenario ALSO contains, hidden by a regression-suite COVERAGE GAP.** The wiring is byte-for-byte the same as the passing scenario. The suite is green only because (a) **its success bar is content-blind** — every Gmail-attachment analog "passed" Phase E with its extraction path *empty / untested / fabricated* per its own caveat (`phase_e_success:"pipeline_passed_no_data"` literally encodes "passed with no data"); and (b) **the DSL simulator diverges from the real runtime** — it preserves object placeholders (real runtime stringifies them) and fabricates flatten items from the declared schema (real runtime nests parent fields under `_parentData`). The suite therefore *structurally cannot* observe either failure.

**Nothing regressed at a commit.** The identical chain in the regression suite never produced a real data-filled report either; it delivered an empty/fabricated one and was scored green. What the user is seeing is a **coverage gap in the regression suite's success criterion + simulator fidelity**, plus one non-deterministic generation dice-roll (`mime_type`).

### Coverage-gap fix recommendations (owner: QA / regression-suite — TS recommends, TL routes)

- **Tighten the Phase E success criterion for extraction chains:** a scenario whose extraction path is empty / untested / fabricated must NOT be recorded as `phase_e_success: true`. Add a data-quality assertion (at least one delivered row with non-fallback, non-"Unknown" values) before green. `pipeline_passed_no_data` should be a distinct, explicitly-non-passing state for the extraction-validation goal.
- **Add a regression scenario that exercises the real runtime resolver + real `transformFlatten`** (text-layer PDF or Textract-backed) so the whole-object placeholder stringification (Finding 2) and the `_parentData` parent-field drop (Finding 3) are observable — the current stub simulator masks both.
- These are the same defects already owned by `v6-pipeline` (Findings 2 & 3) and `calibration` (coverage floor); this section adds the **QA/regression-suite coverage gap** as the reason the suite's green was misleading.

### Change History addendum

| Date | Change | Details |
|------|--------|---------|
| 2026-07-11 | Regression-vs-novel comparison | Compared agent `0ee53785` against the V6 regression suite's Gmail-attachment analogs. Verdict: NOT a code regression. `mime_type` = novel worse generated shape (non-deterministic); octet-stream handoff + blank parent fields = new-case exposure of a latent defect the passing scenario shares, masked by a coverage gap (content-blind Phase E success bar + stub-simulator/runtime divergence). Passing analogs all wire `file_content:"{{attachment_content}}"` identically and recorded their extraction path as empty/untested/fabricated. Supports SA's runtime-resolver fix. |

---

## Live Re-run #2 RCA (2026-07-11) — blank columns + coverage-floor strictness

> **Added**: 2026-07-11 · **Scope**: third live calibration re-run of agent `0ee53785-…` with Phase 0/1 + 1.5 fixes active. Session `20e7c33c-2660-40a0-92b1-8b4839dbc48f`, history `6db38c7b-1085-4ab6-afad-5ad6630561ea`, exec `8a2dae1a-907d-4b9f-ad1d-c9416802113c`. Extraction now works (13 attachments → real vendor/amount/date, e.g. Wolt ILS 99.90, Expedia USD 232.96); no octet-stream errors. Run ended `verdict:"inconclusive"`, `isPassing:false`, `needs_review` (`dev.log` L67963). DIAGNOSTIC ONLY.

### Plain-language top line

Two separate things, both now understood:

1. **Blank From/Subject/Filename columns are a step7 wiring gap — NOT the flatten (Finding 3), which is now fixed.** The flattened attachments now DO carry the parent email's `from`/`subject`/`date` and the child `filename` (verified in the run). The problem is that **step7 — the AI that builds each table row — is only handed the extracted invoice fields, not the attachment item.** Its instructions tell it "put `attachment_item.subject` into source_email_subject," but `attachment_item` was never passed into that AI step's data, so the AI has nothing to copy and writes "". Owner: **V6 generation wiring** (a NEW, distinct issue from Finding 3).
2. **The `inconclusive` verdict is the right instinct but fires for the wrong reason — a metrics blind spot.** The report email actually sent (a real message went out), and 13 rows had real data — yet the run is capped to `inconclusive` because the delivery counter (`items_delivered`) stayed 0. A **send/notify-terminating agent can essentially never reach `passed`** in calibration, because a "send email" returns a single confirmation, not a counted list, so the delivery counter never moves. This is systemic over-strictness. Owner: **calibration** — and it folds into the same coverage-floor redesign already flagged in Live Re-run #1.

### Question 1 — why the email-metadata columns are still blank

**Answer: (a) confirmed — a step7 input-wiring gap. NOT (b). Finding 3's flatten fix IS working at runtime.**

**Finding 3 is fixed (rules out b).** The flattened `eligible_attachments` items now carry the parent email fields flat at the item root, plus the child attachment fields:

**File:** `dev.log` L64307–64344 (flatten output item)
- child fields present: `filename:"trip-receipt-2_260225_182409.pdf"`, `mimeType:"application/pdf"`, `size`, `attachment_id`, `message_id`
- parent fields present flat: `subject:"Your Hotel Invoice"`, `from:"…@gilbarco.com"`, `date:"Mon, 20 Apr 2026 …"` (L64325–64328), **and** under `_parentData:{id,subject,from,date}` (L64315–64320).

So `attachment_item.subject/.from/.date/.filename` all resolve on the item. The blanks are not a missing-data problem.

**The wiring gap (confirms a).** step7 is an `ai_processing/generate` step whose declared input is the step6 output ONLY:

**File:** dumped DSL (`dump-agent 0ee53785`), step4.scatter.steps → step7
```
scatter.itemVariable: "attachment_item"   (over {{eligible_attachments}})
step7.type:  "ai_processing" (config.type "generate")
step7.input: "{{extracted_fields}}"        ← step6 output ONLY
step7.instruction (prose, NOT templates):
  "5. source_email_subject: from attachment_item.subject
   6. source_email_from: from attachment_item.from
   7. attachment_filename: from attachment_item.filename"
```

An AI-processing step receives only its declared `input` payload as data context. `{{extracted_fields}}` carries `amount/vendor/date_time/expense_type` (which is why those columns are populated — `dev.log` L57087 row: `vendor:"Wolt", amount:"ILS 99.90", … source_email_subject:"", source_email_from:"", attachment_filename:""`). The instruction's *prose* mention of `attachment_item.subject` is just text to the LLM — `attachment_item` is never placed in step7's data context, so the model has no value to copy and emits `""`. The V6 ambiguity detector even flagged exactly this at generation time (`dev.log` L1490–1491: "attachment_item … named 'date','subject','from','filename' at the root level, not nested under attachment_item when accessed within the scatter context") and pre-flight warned "Field references could not be validated … attachment_item" (L1798) — but it shipped anyway.

**`attachment_filename` blank is the clincher.** `filename` is the child attachment's OWN field (present on the item, L64307/L64335), yet it is also blank in every row. That proves `attachment_item` in its entirety never reaches step7 — only `{{extracted_fields}}` does. If it were merely a parent-field nesting issue, the child `filename` would still come through; it doesn't.

**Classification & owner.** This is a **NEW/distinct issue from Finding 3**. Finding 3 was "the flatten doesn't carry parent fields" (now fixed). This is "the AI row-builder step isn't given the scatter loop variable it's told to read." Owner: **`v6-pipeline` generation wiring** — an `ai_processing` step inside a scatter whose instruction references the loop `itemVariable` must have that variable injected into its input/context (e.g. a multi-input `input` carrying both `{{extracted_fields}}` and `{{attachment_item}}`, or `{{attachment_item.*}}` template bindings resolved into the prompt). Same **family** as the "multi-input AI wiring gap" already noted for `drive-invoice-summary-extractor` (WP-58). For agent `0ee53785` specifically, the fix is a **DSL correction** (Dev after SA), not a runtime/calibration change — so it does not self-heal on recalibration; it needs the generation-wiring fix (durable, for new agents) plus an in-place DSL edit for this agent.

### Question 2 — is `inconclusive` correct, or is the coverage floor too strict for send-terminating agents?

**Answer: the cap is systemically too strict for send/notify-terminating agents — it fired here as a metrics artifact, not a genuine coverage shortfall.**

**What happened.** The terminal send actually executed — it was NOT suppressed:

**File:** `dev.log` L2750 (relative to the run) `"suppressSend": false`; L2789 step14 completed → `{message_id:"19f52a6c391f3aaa", sent_at:"2026-07-11T19:28:08…", subject:"[Calibration test · …]"}`. A real email was delivered.

Yet the execution summary shows `data_written:[]`, `items_processed:14`, **no `items_delivered`** (`dev.log` L67947–67949) → `delivered = items_delivered ?? 0 = 0` → `exercisedRealPath = !(processed>0 && delivered===0) = false` → `computeVerdict` with `corrected=false` returns `inconclusive` (`CalibrationVerdict.ts` L168–176). Confirmed `verdict:"inconclusive"` (L67963).

**Why `items_delivered` is 0 even though the send ran — the mechanism.** `items_delivered` is only incremented by `ExecutionSummaryCollector.recordDataWrite(count)` (`ExecutionSummaryCollector.ts` L78–103, `itemsDelivered += count`), and it is surfaced only when `> 0` (L217). `recordDataWrite` is driven by `WorkflowPilot.ts` L1220–1234: an action counts as a write when `usage_context` includes add/create/**send**, with `count = extractCountFromSchema(output.data, output_schema)`. `send_email`'s `usage_context` is "When user wants to **send** …" so it classifies as a write, **but its output is a scalar confirmation** — `{message_id, thread_id, sent_at, recipient_count, recipients, subject}` (`google-mail-plugin-v2.json` send_email output_schema) with **no counted item array** — so the extracted count does not yield a positive delivered count, and `items_delivered` stays 0 (data_written ended empty for this run). A "send one report email" is a scalar delivery, not N delivered items.

**Assessment.**
- **(a) Is `inconclusive` correct honest behavior here?** Only accidentally. The stated premise of the cap — "processed items but delivered none / real path not exercised" — is **false for this run**: the real path WAS exercised end-to-end, including a real send. The `delivered===0` is a **counting blind spot** (a scalar send isn't counted), not evidence delivery didn't happen. So the verdict is "right to hold back, wrong reason": it did not hold back because it noticed the blank source_email columns (it never detected those); it held back on a metrics artifact.
- **(b) Systemic over-strictness — YES.** Any agent whose terminal step is a send/notify (email, WhatsApp, a single-object write) returns a scalar confirmation, so `items_delivered` never moves off 0 → the coverage floor caps it to `inconclusive` **regardless of how good the internal data is**. Such agents can essentially never reach `passed` in calibration dry-run. That is a real design gap.

**Recommended design (owner: `calibration` — do NOT change code).** Redefine the coverage signal so "real path exercised" is judged on the **last PRE-delivery producing step's payload carrying meaningful data**, not on a terminal-delivery item count:
- Treat a terminal send/notify that **executed** (returned a confirmation / `message_id`) as delivery-exercised, rather than requiring a positive `items_delivered` count from a scalar send.
- Base `exercisedRealPath` on the last pre-delivery collection (here `sorted_expense_rows` / `expense_rows`) containing **≥1 row with meaningful, non-empty, non-fallback field VALUES** — not a raw row count.
- **Guard against reopening the false-green hole (Live Re-run #1):** the check must be on meaningful field *values*, so an **all-blank / all-"Unknown"-fallback** internal set still fails (Re-run #1's 13 blank rows would NOT pass), while a **genuinely-populated** set that simply wasn't counted at a scalar send DOES pass. A per-column meaningful-data check would additionally surface THIS run's blank `source_email_from/subject/filename` as a real data-quality issue → the correct verdict becomes `needs_review` **for the right reason** (report columns blank), not a metrics-artifact `inconclusive`.

**This is the SAME fix as Live Re-run #1's CAL item, from the other side.** Re-run #1: the floor was too *lenient* (row COUNT let 13 blank rows nearly pass). Re-run #2: the floor is too *strict* (delivery COUNT caps 13 real rows to inconclusive). Both are solved by one design: **replace count-based delivered/row signals with a meaningful-pre-delivery-data signal.** So it **folds into the existing CAL-NN coverage-floor item**, not a brand-new one.

### Classification summary

| Issue | Layer / owner | Helps 0ee53785 in place? | New or folds in? |
|---|---|---|---|
| Blank From/Subject/Filename columns (Q1) | **V6 generation wiring** (step7 AI step missing the scatter `attachment_item` in its input context); runtime data is present | No — needs a **DSL/generation fix** (Dev after SA); does not self-heal on recalibration | **NEW**, distinct from Finding 3 (which is fixed); same family as WP-58 multi-input AI wiring |
| Coverage floor caps send-terminating agents to `inconclusive` (Q2) | **calibration** (`CalibrationVerdict` coverage signal + `ExecutionSummaryCollector` delivery counting) | Yes — a calibration-side design change gives 0ee53785 (and all send-terminating agents) a fair verdict on recalibration | **FOLDS INTO** the Live Re-run #1 CAL-NN coverage-floor item (two sides of one fix) |

> **Handoff:** TS recommends; TL routes. Q1 → the same Phase 2/3 field-fidelity / AI-input-wiring generation track (plus an in-place DSL edit for 0ee53785). Q2 → the calibration coverage-floor requirement (extend CAL-NN to cover send-terminating agents with a meaningful-pre-delivery-data signal). Diagnostic only — no product code, DSL, schemas, or backlog files modified.

### Change History addendum

| Date | Change | Details |
|------|--------|---------|
| 2026-07-11 | Live re-run #2 RCA | Extraction confirmed working (13 rows, real vendor/amount/date). Q1: blank From/Subject/Filename = step7 AI-step input-wiring gap (`step7.input="{{extracted_fields}}"` only; `attachment_item` not in context) — NEW, distinct from the now-fixed Finding 3 (flatten carries parent fields at runtime, `dev.log` L64307–64344). Owner v6-pipeline generation wiring. Q2: `inconclusive` fired on a metrics artifact — a scalar `send_email` never increments `items_delivered`, so send-terminating agents are structurally capped; folds into the CAL-NN coverage-floor redesign (meaningful-pre-delivery-data signal, still rejects all-blank sets). |
