# WP-16 Inventory — Deterministic Operations Routed to AI

> **Last Updated**: 2026-05-08
> **Status**: Inventory complete — fulfills [WORKPLAN_INTENT_CONTRACT.md task 0.7](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md). Drift investigation also complete (2026-05-08) — see [Drift Investigation](#drift-investigation-2026-05-08).
> **Parent docs**: [WP-16 in WEAK_POINTS](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#wp-16-deterministic-data-operations-routed-to-ai-step) · [WORKPLAN_INTENT_CONTRACT](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md)

## Overview

This is the W1 deliverable from the Path B implementation plan: an inventory of every `ai_processing` step across the 10 V6 regression scenarios, classified as either **legitimate AI use** (genuinely needs an LLM) or a **WP-16 instance** (deterministic operation that should be a structured `transform` step). For each WP-16 instance, we identify the target primitive and whether the grammar already supports it.

The inventory feeds task 0.8 (grammar extension) — it tells us exactly which primitives must ship, with concrete reproducers from real scenarios.

---

## Methodology

For each of the 10 scenarios under `tests/v6-regression/scenarios/`:
1. Read `phase4-pilot-dsl-steps.json` and identify every `ai_processing` step
2. Read each step's `prompt` field to classify the underlying operation
3. Map to one of three categories:
   - **legitimate-ai** — genuine LLM need (extraction from unstructured text, classification, free-form synthesis)
   - **wp16-instance** — deterministic op that should be a `transform` step
   - **borderline** — partially deterministic (e.g., status reasoning that lists missing fields deterministically but phrases it humanely)
4. For WP-16 instances, identify the target structured kind and grammar gap

---

## Per-Scenario Findings

### 1. complaint-email-logger

| DSL Step | Prompt summary | Operation | Target primitive | Grammar status |
|---|---|---|---|---|
| step4 | Extract column 5 from 2D array | Column projection | `transform/project_column` | **missing** |
| step5 | Filter emails matching keyword set + project fields + URL string-build | Keyword filter + map + computed field | `transform/filter` + `transform/map` + `transform/with_fields` | filter ✅, map ✅, **with_fields missing** |
| step6 | Anti-join: keep rows where key NOT IN reference list | Set difference | `transform/set_difference` | **missing** |

**Total ai_processing:** 3 — **3 WP-16 instances, 0 legitimate AI**

### 2. aliexpress-delivery-tracker

| DSL Step | Prompt summary | Operation | Classification |
|---|---|---|---|
| step3 | Extract structured fields (package_number, products[], delivery_status, estimated_delivery_date) from email text | Unstructured-text extraction | **legitimate-ai** (uses `extract.fields[]`) |
| step4 | Generate professional HTML table with styling | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 2 — **0 WP-16, 2 legitimate**

### 3. leads-per-salesperson-email

| DSL Step | Prompt summary | Operation | Classification |
|---|---|---|---|
| step5 | Generate HTML table for user summary | HTML synthesis | **legitimate-ai** |
| step9 | Generate HTML table for salesperson email | HTML synthesis | **legitimate-ai** |
| step11 | Generate "no results" HTML | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 3 — **0 WP-16, 3 legitimate**. Filter and group correctly used as `transform` kinds.

### 4. expense-invoice-email-scanner

| DSL Step | Prompt summary | Operation | Target primitive | Grammar status |
|---|---|---|---|---|
| step3 (in scatter) | Extract invoice fields from PDF | Document extraction | **legitimate-ai** (uses `extract.fields[]`) |
| step5 (in scatter) | Combine extracted_fields + uploaded_file.web_view_link + computed `has_valid_amount = amount != null` | Cross-source merge + derived field | `transform/merge` (or multi-source `transform/map`) + `transform/with_fields` | **merge: design/code drift**, **with_fields missing** |
| step12 | Generate digest email HTML | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 3 — **1 WP-16 instance, 2 legitimate**

### 5. contract-enddate-summary

| DSL Step | Prompt summary | Operation | Target primitive | Grammar status |
|---|---|---|---|---|
| step3 | Filter Drive files by name CONTAINS any of [Contract, Agreement, MSA, SOW, Order Form, Statement of Work] | Keyword filter | `transform/filter` (with multi-value contains) | filter ✅; **needs richer `where` for "contains any of N values"** |
| step6 (in scatter) | Extract end_date, counterparty, notes from contract text | Document extraction | **legitimate-ai** |
| step7 | Compute days_remaining (end_date − today), filter where 0 ≤ days_remaining ≤ 30, sort, count, partition into expiring_soon vs missing_date | Computed field + filter + sort + partition + count | `transform/with_fields` (date arithmetic) + `transform/filter` + `transform/sort` + `aggregate` (count + partition) | filter/sort/aggregate ✅, **with_fields missing**, **partition pattern unclear** |
| step8 | Generate HTML email with conditional content | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 4 — **2 WP-16 instances, 2 legitimate**

### 6. gantt-urgent-tasks

| DSL Step | Prompt summary | Operation | Target primitive | Grammar status |
|---|---|---|---|---|
| step2 | Skip header → project columns A, F, G → filter blank task_name → parse date → compute date window (today+1 to today+3) → filter priority IN [Critical, High] → filter date in window → sort by date → count → compute spreadsheet_url | Multi-stage data prep | Many primitives in chain: `rows_to_objects` (already auto-injected) + `transform/filter` (multiple) + `transform/with_fields` (date computation) + `transform/sort` + `aggregate` (count) + computed config refs | filter/sort/aggregate ✅, **with_fields missing for date math + URL construction** |
| step3 | Generate HTML email with conditional content + styled rows | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 2 — **1 huge WP-16 instance, 1 legitimate**

> **Notable pattern: AI contagion.** The LLM jammed *all* the deterministic prep into one `ai_processing` step rather than splitting it. Likely because date arithmetic (`today+N`) and URL string construction aren't expressible in current grammar — those forced AI use, then nearby ops piggybacked on the same AI call. Strong evidence that **shipping `with_fields`/`derive` unlocks decomposition of multi-stage prep into multiple structured transforms**.

### 7. gmail-urgency-flagging

| DSL Step | Prompt summary | Operation | Classification |
|---|---|---|---|
| step2 | Classify each email as urgent/not_urgent | Text classification | **legitimate-ai** |
| step7 | Generate HTML summary with urgent emails table | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 2 — **0 WP-16, 2 legitimate**. Filter and reduce correctly used as `transform` kinds.

> **Data point:** step4 uses `transform/reduce`. `reduce` is in the design table but **NOT** in the [intent-schema-types.ts:143](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143) enum. Either the IR converter accepts it permissively, the grammar was extended elsewhere, or there's a parsing bypass. **Action: investigate before W2.**

### 8. leads-email-summary

| DSL Step | Prompt summary | Operation | Classification |
|---|---|---|---|
| step6 | Generate HTML table for qualified leads | HTML synthesis | **legitimate-ai** |
| step8 | Generate HTML "no results" message | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 2 — **0 WP-16, 2 legitimate**. Filter and reduce used.

> Same `reduce` data point as scenario 7.

### 9. orders-po-extractor-xlsx

| DSL Step | Prompt summary | Operation | Target primitive | Grammar status |
|---|---|---|---|---|
| step3 | Classify attachments as purchase_order vs not | Text classification | **legitimate-ai** |
| step8 (in scatter) | Add Status field: 'Complete' if all required fields present, else 'Needs review: <missing field list>' | Computed field + missing-field detection | `transform/with_fields` with conditional/list-comprehension expression | **with_fields missing** |
| step15 (in scatter) | Generate base64-encoded XLSX file | Binary file synthesis | **borderline** — should be a plugin (xlsx generator) not AI. Out of WP-16 scope but worth flagging. |
| step16 (in scatter) | Generate vendor email subject + body | Light synthesis | **legitimate-ai** (could be template-based — see scenario 10) |
| step18 | Confirmation email with totals | Light synthesis | **legitimate-ai** (template-based — see scenario 10) |

**Total ai_processing:** 5 — **1 WP-16 instance, 1 borderline (XLSX should be plugin), 3 legitimate**

> Confirms `reduce` accepted in DSL (step12, step13).

### 10. po-monitor-supplier-confirmation

| DSL Step | Prompt summary | Operation | Target primitive | Grammar status |
|---|---|---|---|---|
| step7 (in scatter) | Combine extracted_po_data + email metadata + supplier_email + computed Status | Cross-source merge + derived field | `transform/merge` + `transform/with_fields` | **merge: drift**, **with_fields missing** |
| step9 (in scatter) | Replace `{order_ID}` placeholder in config-driven template | Template substitution | `transform/with_fields` with template/interpolation, OR new `transform/template` primitive | **template/interpolation pattern not in grammar** |
| step11 | Generate HTML table | HTML synthesis | **legitimate-ai** |

**Total ai_processing:** 4 (one in conditional branch counted) — **2 WP-16 instances, 1 legitimate, 1 in branch**

---

## Cross-Scenario Summary

| Scenario | ai_processing total | Legitimate | WP-16 | Borderline |
|---|---|---|---|---|
| 1. complaint-email-logger | 3 | 0 | **3** | 0 |
| 2. aliexpress-delivery-tracker | 2 | 2 | 0 | 0 |
| 3. leads-per-salesperson-email | 3 | 3 | 0 | 0 |
| 4. expense-invoice-email-scanner | 3 | 2 | **1** | 0 |
| 5. contract-enddate-summary | 4 | 2 | **2** | 0 |
| 6. gantt-urgent-tasks | 2 | 1 | **1** (huge — multi-stage) | 0 |
| 7. gmail-urgency-flagging | 2 | 2 | 0 | 0 |
| 8. leads-email-summary | 2 | 2 | 0 | 0 |
| 9. orders-po-extractor-xlsx | 5 | 3 | **1** | 1 (XLSX synth) |
| 10. po-monitor-supplier-confirmation | 4 | 1 | **2** | 0 |
| **TOTAL** | **30** | **18** (60%) | **10** (33%) | **1** (3%) |

**Headline numbers:** 30 `ai_processing` steps across 10 scenarios; **10 are WP-16 instances** (one-third) spread across **6 scenarios**. After fixing WP-16, the residual `ai_processing` count would drop from 30 to ~19 (legitimate AI + the borderline XLSX case).

---

## Operation Frequency Across WP-16 Instances

| # | Pattern | Scenarios | Existing primitive? | Action |
|---|---|---|---|---|
| 1 | **Computed/derived field** (`field = f(other_fields)`, including booleans, status strings, date arithmetic) | expense-invoice (step5), orders-po (step8), po-monitor (step7), contract-enddate (step7), gantt (step2) — **5 scenarios** | ❌ none | **HIGHEST-LEVERAGE NEW PRIMITIVE** — `transform/with_fields` (or `transform/derive`). See [Recommendation 1](#recommendation-1-prioritize-with_fields--derive). |
| 2 | **Cross-source merge** (combine fields from N input slots into one row) | expense-invoice (step5), po-monitor (step7) — 2 scenarios | ❌ `merge` listed in design table but missing from [intent-schema-types.ts:143](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143) | **Reconcile design/code drift** — ship `merge` in code, OR confirm multi-source `transform/map` already handles it. |
| 3 | **Keyword filter** (case-insensitive `field CONTAINS any of [v1, v2, ...]`) | complaint (step5), contract-enddate (step3) — 2 scenarios | ⚠️ `filter` exists but `where` may not support multi-value contains | **Verify filter `where` grammar supports `contains_any` operator**; if not, extend. |
| 4 | **Column projection** (extract field N from each row) | complaint (step4) — 1 scenario | ❌ none | **Add `transform/project_column`** primitive. |
| 5 | **Set difference / anti-join** (keep where key NOT IN reference array) | complaint (step6) — 1 scenario | ❌ none | **Add `transform/set_difference`** primitive. |
| 6 | **Template substitution** (`"Order {x}"` style placeholders) | po-monitor (step9) — 1 scenario | ❌ none | **Decide:** new `transform/template` primitive, OR fold into `with_fields` with a template expression syntax. Recommendation: fold into `with_fields` to keep grammar small. |
| 7 | **Multi-stage chains** (project → filter → date math → filter → sort → count) | gantt (step2) — 1 scenario | Mostly exists, but `with_fields` missing forces all-AI fallback | **No new primitive** — falls out once `with_fields` is added (the missing piece). |

---

## Recommendation 1: Prioritize `with_fields` / `derive`

**Why this matters most:** 5 of 10 WP-16 instances need it. Without it:
- Cross-source merges fall back to AI (expense-invoice, po-monitor)
- Status field computations fall back to AI (orders-po, po-monitor)
- Date arithmetic forces AI use, which then **contaminates nearby ops** (gantt — the LLM jammed 7 deterministic steps into one ai_processing because date math forced AI anyway)

**Naming:** Recommend `transform/with_fields`. The op takes the input array and emits each item augmented with newly-computed fields. Cleaner than `derive` (which suggests replacing the input rather than augmenting).

**Config shape (proposed):**

```typescript
{
  kind: "transform",
  operation: "with_fields",
  input: "<slot_ref>",
  fields: [
    {
      name: "has_valid_amount",
      expression: { op: "neq", left: { ref: "amount" }, right: { kind: "literal", value: null } }
    },
    {
      name: "days_remaining",
      expression: { op: "date_diff", unit: "days", left: { ref: "end_date" }, right: { kind: "today" } }
    },
    {
      name: "spreadsheet_url",
      expression: { op: "concat", args: [
        { kind: "literal", value: "https://docs.google.com/spreadsheets/d/" },
        { kind: "config", key: "spreadsheet_id" },
        { kind: "literal", value: "/edit" }
      ] }
    },
    {
      name: "status",
      expression: { op: "if",
        condition: { op: "all_not_null", refs: ["order_ID", "Vendor", "QTY"] },
        then: { kind: "literal", value: "Complete" },
        else: { kind: "literal", value: "Needs review" }
      }
    }
  ]
}
```

The expression mini-language needs: `neq`/`eq`/`gt`/`lt`, `concat`, `date_diff`/`date_add`, `today`, `all_not_null`/`null_check`, `if`/`else`, basic logical ops. This is small enough to ship as a Zod-validated discriminated union — not a full DSL.

**Risk:** expression-language complexity. Mitigation: **start minimal**. Ship `concat`, `if/else`, `eq/neq`, `date_diff`, `date_add`, `today`, `null_check`. That covers all 5 WP-16 instances we have. Add more later if regression scenarios demand them.

**Subsumes template substitution** (pattern #6): `{order_ID}` → use `concat` with config + ref values.

---

## Recommendation 2: Reconcile `merge` / `reduce` / `select` Drift

> **NOTE (2026-05-08):** This section was originally drafted from the **wrong type-definition file** ([`lib/agentkit/v6/intent/intent-schema-types.ts:143`](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143) — a legacy/unused enum). The actual V6 IntentContract grammar lives in [`lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts:322`](../../lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts#L322) and **does** include `reduce`, `merge`, and `select`. The investigation also confirmed: `reduce` is fully supported end-to-end via `aggregate` → `reduce` synthesis in [IntentToIRConverter.convertAggregate()](../../lib/agentkit/v6/compiler/IntentToIRConverter.ts#L743). See [Drift Investigation](#drift-investigation-2026-05-08) below for the corrected analysis.

**Corrected status of each:**

| Op | Grammar type | System prompt | Runtime executor | DSL emission | Action |
|---|---|---|---|---|---|
| `reduce` | ✅ | ✅ | ✅ (top-level case in StepExecutor) | ✅ emitted in 3 scenarios | **Fully supported.** No drift. LLM uses `aggregate.outputs[].type=count`; IR converter synthesizes `transform/reduce`. |
| `merge` | ✅ | ✅ (recommended) | ⚠️ Only inside `reduce` strategy, no top-level case | Not observed in DSL | **Minor drift, low impact.** Prompt steers LLM to `map` with multi-source `inputs[]` for cross-source merges (line 1228 example), so `merge` is rarely emitted. **W2 action:** decide between (a) add top-level `merge` runtime case, or (b) remove from grammar/prompt and document `map` as the canonical cross-source op. |
| `select` | ✅ | ❌ explicitly forbidden | ❌ | Not observed | **Documented "do not use".** Coherent across prompt + runtime. **W2 action:** consider removing from grammar type for cleanliness, or leave as future. No urgency. |
| `custom` | ✅ | ❌ explicitly forbidden | ❌ | Not observed | Same as `select`. |
| `dedupe` vs `deduplicate` | grammar: `dedupe` | prompt: `dedupe` | runtime: `deduplicate` | — | **Naming inconsistency.** IR converter likely handles the rename. **W2 action:** verify the IR converter normalizes `dedupe` → `deduplicate`; if not, fix. |

**Runtime has primitives the grammar doesn't expose:** `partition`, `pivot`, `split`, `expand`, `join`, `set`, `map_headers`, `rows_to_objects`. Some (`rows_to_objects`, `map_headers`) are correctly compiler-only (auto-injected). Others (`partition`, `pivot`) might be useful future grammar additions; defer until a regression scenario needs them.

**Recommended W2 action:** No urgent drift work. The LLM correctly uses `aggregate` for counts (which becomes `reduce` in DSL), and `map` with multi-source `inputs[]` for cross-source merges (per prompt example). The framing of "ship `merge` and `reduce` formally" was based on a misread of the wrong source file. **W2's primary work is `with_fields` (Recommendation 1)** — the only genuinely missing primitive that fires across multiple scenarios.

---

## Recommendation 3: Existing Primitives Are Healthy

`filter`, `map`, `group`, `sort`, `flatten`, `dedupe`, `aggregate` all fire correctly across scenarios. The Phase 1 LLM uses them when they exist in the grammar — strong support for **WP-16's primary lever being grammar (task 0.8), with vocabulary visibility (task 0.9) as secondary**.

The two minor gaps in existing primitives:
- **`filter.where` may need a `contains_any` operator** (verify in W2 task 0.7 follow-up — pattern #3 above) — the current `where: {comparator: "eq"}` doesn't naturally express "contains any of [v1, v2, ...]".
- **Confirm multi-source `transform/map` works** — used implicitly by cross-source merges. WP-4 added structured `mapping[]` for single-source renames; need to verify N-source variant is supported by IR converter and runtime.

---

## Recommendation 4: Out-of-Scope but Worth Filing

**XLSX file synthesis via AI (orders-po-extractor-xlsx step15)** — generating a base64-encoded XLSX file from structured data via LLM is unreliable and inefficient. Should be a plugin action (xlsx-generator) or built-in primitive. Filed as a follow-up (NOT a WP-16 instance — different category):

> **Future**: Add a built-in `transform/to_xlsx` primitive or a `xlsx-generator` plugin so the LLM doesn't need to base64-encode binary files in its response. Current path is fragile (token-limit risk, format errors).

---

## W2 Action List (Summary)

> **Updated (2026-05-08)** after the [Drift Investigation](#drift-investigation-2026-05-08) — items 2 and 3 from the original draft are removed (`merge` and `reduce` are non-issues).

After this inventory, the W2 grammar wave should ship:

| # | Change | Source pattern | Used by |
|---|---|---|---|
| 1 | Add `transform/with_fields` with mini expression language (`concat`, `if/else`, `eq`/`neq`, `date_diff`, `date_add`, `today`, `null_check`, `all_not_null`) | Pattern #1 (computed/derived) | 5 scenarios |
| 2 | Add `transform/project_column` | Pattern #4 | 1 scenario |
| 3 | Add `transform/set_difference` | Pattern #5 | 1 scenario |
| 4 | Verify `filter.where` supports `contains_any` operator; extend if not | Pattern #3 | 2 scenarios |
| 5 | Verify multi-source `transform/map` end-to-end (used by cross-source merge per prompt line 1228 example) | Pattern #2 | 2 scenarios |
| 6 | (Optional) Verify IR converter normalizes `dedupe` → `deduplicate` for runtime | Naming inconsistency | All scenarios using dedupe |
| 7 | (Optional) Decide `merge` top-level support — either add runtime case or remove from grammar/prompt | Minor drift, rarely emitted | None observed |

**Out of scope for W2 (deferred):** `transform/select`, `transform/custom` removal, `transform/to_xlsx`, full template DSL, exposing runtime-only primitives (`partition`, `pivot`, etc.) to grammar.

---

## Drift Investigation (2026-05-08)

After the initial inventory flagged `merge`/`reduce`/`select` as design/code drift (based on the system prompt's reference list versus the apparent enum at [`lib/agentkit/v6/intent/intent-schema-types.ts:143`](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143)), a follow-up trace through the actual V6 IntentContract pipeline revealed the original analysis was reading the **wrong type-definition file**.

### Wrong file vs right file

| File | Status |
|---|---|
| [`lib/agentkit/v6/intent/intent-schema-types.ts:143`](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143) | **Legacy / unused.** Enum: `filter \| map \| group \| dedupe \| flatten \| sort`. Not the schema actually validated against. |
| [`lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts:322`](../../lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts#L322) | **Active V6 IntentContract grammar.** `TransformOp = filter \| map \| reduce \| group \| sort \| dedupe \| flatten \| merge \| select \| custom`. |

### End-to-end trace per op

| Op | Grammar | Prompt | Runtime | DSL emission | Verdict |
|---|---|---|---|---|---|
| `reduce` | ✅ | ✅ | ✅ top-level case ([StepExecutor.ts:2394](../../lib/pilot/StepExecutor.ts#L2394)) | ✅ in 3 scenarios | **Fully supported.** LLM emits `aggregate.outputs[].type=count`; [IntentToIRConverter.convertAggregate()](../../lib/agentkit/v6/compiler/IntentToIRConverter.ts#L743) synthesizes `transform/reduce` with `reduce_operation: count/sum/min/max`. No drift. |
| `merge` | ✅ | ✅ recommended | ⚠️ Inside `reduce` strategy only ([StepExecutor.ts:3045](../../lib/pilot/StepExecutor.ts#L3045)), no top-level case | Not observed | **Minor drift, low impact.** Prompt line 1228 example steers LLM to `transform/map` with multi-source `inputs[]` for cross-source merges — `transform/merge` is rarely emitted in practice. W2 decision: add top-level runtime case OR remove from grammar/prompt and document `map` as canonical. Either way, not a blocker. |
| `select` | ✅ | ❌ explicitly forbidden | ❌ | Not observed | Coherent across prompt + runtime — design type permits it but everyone agrees not to use it. Defer cleanup. |
| `custom` | ✅ | ❌ explicitly forbidden | ❌ | Not observed | Same as `select`. |
| `dedupe` vs `deduplicate` | grammar `dedupe` | prompt `dedupe` | runtime `deduplicate` | — | **Naming inconsistency.** IR converter probably handles the rename. W2 action: verify and confirm; fix if not. |

### Bonus finding — runtime is richer than grammar exposes

[StepExecutor.ts:2370-2447](../../lib/pilot/StepExecutor.ts#L2370-L2447) supports operations the grammar doesn't expose:

- **Compiler-injected** (correct that the grammar doesn't expose them — they're auto-inserted): `rows_to_objects`, `map_headers`, `set`
- **Potentially useful future grammar additions**: `partition`, `pivot`, `split`, `expand`, `join`

Defer the latter group until a regression scenario demands one. None of the current 10 scenarios use them.

### Why the original reading of WP-16 still mostly stands

The headline finding — **`with_fields`/`derive` is the highest-leverage missing primitive** — is unaffected by the drift correction. The 5 scenarios that fall back to `generate/internal` for computed fields (`has_valid_amount = amount != null`, `days_remaining = end_date - today`, `Status = "Complete" / "Needs review: ..."`) cannot be expressed in any current grammar form. The LLM falls back to AI not because of `merge`/`reduce` drift, but because computed-field expressions have no structured representation.

### Net impact on W2 scope

- **Add to W2:** `transform/with_fields` (unchanged, highest priority)
- **Add to W2:** `transform/project_column`, `transform/set_difference`, `filter.where contains_any` (unchanged)
- **Remove from W2:** "ship `merge`", "audit/formalize `reduce`" — both non-issues
- **Add to W2 (optional):** verify `dedupe` → `deduplicate` rename, multi-source `map`

The W2 Action List table above has been updated accordingly. **Net effect: W2 is slightly smaller than originally drafted, with sharper focus on the one primitive that actually matters.**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-08 | Drift investigation complete — original drift framing corrected | Trace through V6 pipeline confirmed `reduce` is fully supported end-to-end (LLM `aggregate` → IR converter → runtime). The original "drift" finding was based on the wrong type-definition file. The actual `TransformOp` at [`semantic-plan/types/intent-schema-types.ts:322`](../../lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts#L322) includes `reduce`, `merge`, and `select`. Real drifts identified: `merge` lacks top-level runtime case (low impact, LLM uses `map` instead), `dedupe` vs `deduplicate` naming inconsistency. W2 Action List updated — items 2 and 3 (ship `merge`, audit `reduce`) removed. Highest-leverage finding (`with_fields` for computed fields) unchanged. See [Drift Investigation](#drift-investigation-2026-05-08) section. |
| 2026-05-08 | Initial inventory complete (W1) | Sweep of 10 regression scenarios. 30 `ai_processing` steps total; 10 WP-16 instances across 6 scenarios; 18 legitimate AI uses; 1 borderline (XLSX synthesis). Highest-leverage primitive: `with_fields`/`derive` (5 of 10 WP-16 instances). Initially flagged design/code drift on `merge`/`reduce`/`select` — subsequent investigation showed this was a misread; see follow-up entry above and [Drift Investigation](#drift-investigation-2026-05-08) section. |

---

*V6 WP-16 Inventory — Neuronforge*
