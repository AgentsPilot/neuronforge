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
