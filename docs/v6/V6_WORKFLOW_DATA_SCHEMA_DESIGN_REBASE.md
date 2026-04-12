# V6 Workflow Data Schema — Design Rebase

> **Last Updated**: 2026-04-08
> **Status**: All three Directions implemented — Direction #1 ✅, Direction #2 ✅, Direction #3 ✅
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent docs**: [V6_WORKFLOW_DATA_SCHEMA_DESIGN.md](./V6_WORKFLOW_DATA_SCHEMA_DESIGN.md) · [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md)

## Overview

This document is a **rebase of the V6 Workflow Data Schema design** based on what the implementation has taught us after ~26 O-series compiler fixes, 14 identified weak points (WP-1 through WP-14), and two scenarios that reached the user with silently-fabricated output ("Unknown package_number / Unknown products" in the AliExpress Delivery Tracker run).

> **Note (2026-04-06):** Since this document was drafted, WP-11, WP-12, WP-13, and WP-14 have been fixed with tactical IR-converter + runtime patches. The fixes are **compiler/runtime-level mitigations** — they do not address the root causes identified in this document (Phase 1 lacks schema context, binder lacks input-type checking). The structural analysis and Directions #1–#3 remain valid and are now *preventive* rather than *reactive*.

The goal here is not to redesign V6 from scratch. The **5-phase separation of concerns is sound**. The goal is to identify the structural gaps between the original design's intent and what the implementation has drifted into, and to decide where to re-anchor.

The document proceeds in two parts:

1. **Part 1 — Bird's-Eye Problems.** Six structural issues identified by reading the design doc, the workplans, and the weak-points catalog together. These are the patterns, not the individual bugs.
2. **Part 2 — Deep Dives.** For each prioritized problem, a focused analysis of root cause, proposed direction, and impact on existing code. *(Pending — to be filled collaboratively.)*

---

## Table of Contents

- [Part 1 — Bird's-Eye Problems](#part-1--birds-eye-problems)
  - [P1. The schema contract became advisory instead of enforced](#p1-the-schema-contract-became-advisory-instead-of-enforced)
  - [P2. Structured data decays into natural language, then is reconstructed downstream](#p2-structured-data-decays-into-natural-language-then-is-reconstructed-downstream)
  - [P3. The compiler has become a heuristic soup](#p3-the-compiler-has-become-a-heuristic-soup)
  - [P4. The IntentContract LLM lacks the context it needs to be correct](#p4-the-intentcontract-llm-lacks-the-context-it-needs-to-be-correct)
  - [P5. Binder correctness is thin — input-type constraints not checked](#p5-binder-correctness-is-thin--input-type-constraints-not-checked)
  - [P6. Scope creep across phases — unclear ownership of fixes](#p6-scope-creep-across-phases--unclear-ownership-of-fixes)
- [The Common Thread](#the-common-thread)
- [Prioritization](#prioritization)
- [Part 2 — Deep Dives](#part-2--deep-dives)
  - [Deep Dive A — Phase 1 Schema Context Injection (Direction #1)](#deep-dive-a--phase-1-schema-context-injection-direction-1)
  - [Deep Dive B — Runtime AI Output Validation (Direction #2)](#deep-dive-b--runtime-ai-output-validation-direction-2)
  - [Deep Dive C — Binder Input-Type Checking (Direction #3)](#deep-dive-c--binder-input-type-checking-direction-3)
- [Part 3 — Resolved Answers to Open Questions](#part-3--resolved-answers-to-open-questions)
- [Part 4 — Summary Decisions Table](#part-4--summary-decisions-table)
- [Part 5 — Implementation Sequencing](#part-5--implementation-sequencing)

---

## Part 1 — Bird's-Eye Problems

### P1. The schema contract became advisory instead of enforced

**What the design said:**

> *"The schema is the contract. Fail loud, not silent. When runtime data doesn't match the declared schema, execution stops with a descriptive error showing expected vs. received shape. No silent degradation."*
> — V6_WORKFLOW_DATA_SCHEMA_DESIGN.md §2

**What the implementation does:**

| Layer | Design intent | Actual behavior |
|---|---|---|
| Compile-time field refs | Reject references that don't match the source slot schema | Silently rewrites `.message_id` → `.id` via prefix-stripping heuristics (WP-2) |
| Runtime plugin output | Validate against slot schema, fail loud on mismatch | Validated for plugin steps; relies on plugin schemas being accurate |
| Runtime AI output | Validate declared `output_schema` matches actual LLM output | **Deferred** (WP-9) — mock tests pass, production can return any shape |
| Scatter-gather results | Fail if data shape doesn't match | Only all-failed case triggers failure (WP-10, recently fixed) |

**What this produces in practice:**

The AliExpress Delivery Tracker run (2026-04-05) sent the user a real email with fabricated rows — `"Unknown package_number / Unknown products / Unknown delivery_status"` — because the extractor returned placeholder strings that conformed to the declared schema's *shape* (strings in the right fields) but had `_extraction_metadata: {confidence: 0, success: false}` ignored by every downstream layer. The workflow reported `success: true`.

The schema structure exists. The data-flow diagram is intact. But the contract is not used as a gate at the one boundary that matters most: **the untrusted AI-output boundary that V6 was explicitly designed to tame.**

**Fix → [Direction #2: Runtime AI Output Validation (Deep Dive B)](#deep-dive-b--runtime-ai-output-validation-direction-2)**

Three changes that turn the advisory schema into an enforced contract:

1. **New `AIOutputValidator`** — after every `ai_processing` step, validate the actual output against the step's declared `output_schema`. Recursive walk: required fields present, types match, array items conform, nested objects checked. If the step declared a schema, it opted in to enforcement.
2. **Replace silent fallbacks with loud failures.** Today, when I3 extraction can't parse the LLM's response into the declared schema, it wraps the raw text in `{result, summary, analysis, ...}` aliases and continues silently. With Direction #2: schema-declared steps that fail extraction get one repair attempt (re-prompt with the validation errors), then a hard `SchemaViolationError` with the step ID, expected shape, actual shape, and truncated LLM response. No more alias wrappers masking bad output.
3. **Remove the memory-dump null-fill.** Today, if the LLM returns a garbage memory context dump, every declared field gets set to `null` and execution continues. With Direction #2: hard fail with `AIMemoryDumpError`. The root cause (WP-3) is already fixed — the null-fill is a band-aid that hides new regressions.

What Direction #2 does **not** fix: semantically-valid-but-fabricated output like `"Unknown package_number"` — those strings pass type-checking because `string === string`. That class of failure needs trust-metadata propagation (see [§B.6](#b6-trust-metadata--scoped-out-but-adjacent)) and the upstream fixes from Directions #1 and #3 that prevent bad input from reaching the AI step in the first place.

---

### P2. Structured data decays into natural language, then is reconstructed downstream

WP-4 is the cleanest example of a pattern that repeats across WP-1, WP-5, WP-6, WP-11:

```
Phase 1 LLM knows BOTH sides of a field mapping (upstream 'from' → downstream 'sender')
    ↓
    Emits: custom_code: "Extract sender, subject, date..."   ← prose blob
    ↓
Phase 2 (binder): can't interpret prose
    ↓
Phase 3 (IR converter): can't interpret prose
    ↓
Phase 4 (compiler): tries to guess — hardcoded alias table (from→sender, date→received_date)
    ↓
Runtime (StepExecutor): Mode 4 auto-map with a 3-entry alias dictionary
```

The fix for WP-4 required changing **four layers** (IntentContract schema, Phase 1 prompt, IR converter, runtime) so that the LLM emits structured `mapping: [{to, from}]` and it flows end-to-end unmodified.

**The pattern:**

| WP | Information that was lost | Where it had to be reconstructed |
|---|---|---|
| WP-1 | Which plugin param each notify-content field maps to | Hardcoded `isSendAction` branch in IR converter |
| WP-4 | Explicit field rename mapping | Hardcoded alias table in runtime |
| WP-5 | Group output shape (array vs object, key/items field names) | Schema inference with single-field heuristic |
| WP-6 | Whether `{kind: "X"}` refs are config, variable, literal, or computed | Phase 5 structured-ref resolver |
| WP-11 | Whether downstream needs email body (so `content_level=full`) | ✅ Fixed tactically — IR converter `enforceContentLevelForExtraction()` auto-sets `content_level=full`. Root cause (Phase 1 context) still open. |

**The principle violation:**

CLAUDE.md states *"Fix at the root cause — only implement a fix in a downstream phase if it is genuinely a generic compiler optimisation."* In practice, root-cause fixes (prompt + schema) are deferred because they require retesting LLM output; downstream patches ship first because they're scoped and testable. Technical debt then accretes in the "deterministic" phases.

**Fix → [Direction #1: Phase 1 Schema Context Injection (Deep Dive A)](#deep-dive-a--phase-1-schema-context-injection-direction-1)**

The information gets lost because Phase 1 doesn't have it. The LLM can't emit `mapping: [{to: "sender", from: "from"}]` if it doesn't know the upstream action's output contains a `from` field. Direction #1 injects plugin **output schemas** (compact summaries) and **coupling hints** (e.g. "body is empty unless `content_level=full`") into the Phase 1 vocabulary. The LLM then emits structured data with correct field names from the start — and the downstream reconstruction heuristics become unnecessary.

---

### P3. The compiler has become a heuristic soup

The design positions Phases 2–5 as **deterministic, rule-based, testable**. The actual compiler now contains:

| Heuristic | Location | Triggered by |
|---|---|---|
| Prefix stripping (`message_`, `contact_`, `file_`, `channel_`, `user_`) | ExecutionGraphCompiler Phase 5 | WP-2 |
| Alias table (`from→sender`, `date→received_date`, `matched_keywords→urgency_classification`) | StepExecutor transformMap Mode 4 | WP-4 |
| Gmail-specific string replacement (`.message_id` → `.id`) | D-B10 original fix | WP-2 |
| `isSendAction` branch | IntentToIRConverter.convertNotify | WP-1 (partially refactored) |
| Single-string-field + single-array-field group output inference | StepExecutor transformGroup | WP-5 |
| Case-insensitive + space/underscore normalization | Phase 5 field reconciliation | WP-2 |
| `enforceContentLevelForExtraction` — scan IR for extraction consumers, auto-set param | IntentToIRConverter | WP-11 *(added 2026-04-06)* |
| `actionExpectsFileAttachment` + `inputLooksLikeFileAttachment` — heuristic file-vs-text classification | IntentToIRConverter | WP-12 *(added 2026-04-06)* |
| `detectEmptyAIProcessingInput` — short-circuit LLM on empty input | StepExecutor | WP-13 *(added 2026-04-06)* |
| Base64-vs-text heuristic for runtime safety check routing | StepExecutor `shouldUseDeterministicExtraction` | WP-14 *(added 2026-04-06)* |
| Scatter merge branching on `isExtractLike` (ai_type + field count) | ParallelExecutor | WP-14 *(added 2026-04-06)* |

This **directly violates** the CLAUDE.md Platform Design Principle:

> *"Never add plugin-specific rules or operation names... Plugin schemas are the source of truth — let the compiler reason from them."*

The compiler has become the dumping ground for every mismatch the upstream layers couldn't resolve. This is the same failure mode V6 was explicitly built to escape — the V5 "new prompt, new error" problem, re-emerging one phase deeper in the pipeline.

**Fix → Directions #1 + #3, then delete the heuristics**

P3 is a *consequence* of P2 and P4, not a root cause. The heuristics exist because upstream phases emit wrong data. Fix the upstream problems (Direction #1 gives Phase 1 the output schemas; Direction #3 gives the binder input-type checking), then measure heuristic firing rates, and delete the ones that stop firing. See [Part 5 — heuristic-removal tracking table](#part-5--implementation-sequencing) for the specific gate (metric) that must be met before each heuristic is removed.

---

### P4. The IntentContract LLM lacks the context it needs to be correct

WP-2's own root-cause analysis is explicit:

> *"The IntentContract LLM generates field references based on what it thinks the field should be called (from action parameter names or natural language), not what the producing step's schema actually contains."*

The Phase 1 LLM does **not** see:

| Missing context | Consequence | Weak point |
|---|---|---|
| Upstream step output schemas at reference time | LLM guesses field names; compiler rewrites them with heuristics | WP-2 |
| Parameter coupling rules (if downstream consumes `.body`, set `content_level=full`) | Compiled DSL requests insufficient data; extractor silently fails. ✅ *Tactical fix landed:* `enforceContentLevelForExtraction()` in IR converter. Root cause remains — LLM doesn't know the coupling exists. | WP-11 |
| Plugin input *type* constraints (`from_type: "file_attachment"`) | Binder maps text inputs to file-based extractors. ✅ *Tactical fix landed:* `actionExpectsFileAttachment()` + `inputLooksLikeFileAttachment()` in IR converter reroute to AI extraction. Root cause remains — binder doesn't check input types. | WP-12 |
| Actual field names in upstream plugin outputs | References use synthesized names (`sender` vs `from`) | WP-2, WP-4 |

The long-term fix for WP-2 acknowledged this explicitly but **deferred it**: *"Include the upstream output_schema field names in the LLM prompt so the model knows the exact field names available. These are deeper changes to Phase 1/2 and are deferred for later."*

This is arguably the **single highest-leverage change in the system**. If Phase 1 produces correct references the first time, WP-2, WP-4, WP-11, and WP-12 all collapse — the downstream heuristics catalogued in P3 become unnecessary.

**Fix → [Direction #1: Phase 1 Schema Context Injection (Deep Dive A)](#deep-dive-a--phase-1-schema-context-injection-direction-1)**

Add plugin **output schema summaries** (compact field lists with types) and **coupling hints** (`⚠ body empty unless content_level=full`) to the Phase 1 vocabulary injection. Today the vocabulary shows input parameters only; Direction #1 extends it to also show what each action *returns*. The LLM sees the exact field names (`id`, `from`, `body`) and uses them directly instead of inventing `message_id`, `sender`, etc. Coupling hints tell it to set `content_level=full` when downstream extraction needs `.body`. Input-type markers tell it `document-extractor` needs a file, not text.

---

### P5. Binder correctness is thin — input-type constraints not checked

WP-12 (document-extractor bound to free-text email body) is not a bug — it is a **category of failure** that will repeat.

The CapabilityBinder reasons about *capabilities* ("this action can extract structured data"), but it does not check *input-type constraints* that plugin schemas already declare:

```
document-extractor.extract_structured_data
  input.file_content:
    x-variable-mapping:
      from_type: "file_attachment"    ← binder ignores this
```

The binder matched on capability ("extract") and ignored the type contract on the input. As the plugin catalog grows, this class of mis-binding will become the dominant failure mode. There is no systematic binder validation layer that asks: *"Can the source variable produce what this action's input actually requires?"*

The information needed is already in the plugin schemas. It's simply not consulted.

**Fix → [Direction #3: Binder Input-Type Checking (Deep Dive C)](#deep-dive-c--binder-input-type-checking-direction-3)**

Add a **Phase 2b input-type compatibility check** after binding + data_schema construction. Each plugin action's required-input `from_type` (e.g. `file_attachment`) is compared against the source slot's `to_type` (e.g. `text_content`). Mismatch → reject the candidate and try the next-ranked one. If all candidates reject → mark unbound with `input_type_incompatible`; the IR converter then rewrites text-source extract steps to `ai_processing/extract` instead. This replaces the current tactical heuristic (`actionExpectsFileAttachment` + `inputLooksLikeFileAttachment`) with a schema-driven check that works for any plugin, not just `document-extractor`.

---

### P6. Scope creep across phases — unclear ownership of fixes

Reading the weak points, each fix lands in **whichever phase is easiest to patch**, not where it architecturally belongs:

| Weak point | Correct architectural home | Where it was actually fixed |
|---|---|---|
| WP-2 (field reconciliation) | Phase 2 (binder) + Phase 1 prompt | Phase 5 (compiler safety net) |
| WP-4 (structured mapping) | Phase 1 (LLM schema) | 4 layers: schema + prompt + IR converter + runtime |
| WP-11 (content_level) | Phase 1 or Phase 2 | Fixed: IR converter (`enforceContentLevelForExtraction`) — correct phase but heuristic-based |
| WP-12 (binder correctness) | Phase 2 (binder) | Fixed: IR converter (`actionExpectsFileAttachment` + `inputLooksLikeFileAttachment`) — implemented one phase later than ideal |
| WP-13 (empty-input hallucination) | Runtime + compiler | Fixed: Runtime (`detectEmptyAIProcessingInput` + prompt guardrail) — purely runtime, correct home |
| WP-14 (scatter token bloat) | Runtime (I3 + scatter merge + safety check) | Fixed: 3 surgical patches in StepExecutor + ParallelExecutor |

**Consequences:**

- No phase has a clean, defensible responsibility boundary
- Refactors to shared infrastructure have unbounded blast radius — which is precisely why the regression suite had to be built
- New contributors cannot predict where to make a change
- The "5-phase separation of concerns" on the cover page no longer matches the code

**Fix → Directions #1 + #3 restore phase boundaries; #5 codifies them**

P6 is an organizational problem caused by the technical problems in P2–P5. Once Directions #1 and #3 land and the upstream heuristics are deleted, re-anchor each phase's contract:

| Phase | Owns | Rejects |
|---|---|---|
| Phase 1 (LLM) | Emit correct field refs + structured mappings using schema context | — |
| Phase 2 (binder) | Match capability AND validate input-type compatibility | Candidates whose `from_type` doesn't match source `to_type` |
| Phase 3 (IR converter) | Translate bound intent to IR; carry `data_schema` through | Steps that are `unbound` with no fallback path |
| Phase 4 (compiler) | Deterministic IR→DSL. Generic optimisations only | Plugin-specific rules, alias tables, field reconciliation heuristics |
| Runtime | Validate AI output against declared schema; fail loud | Silent alias wrappers, null-fills, fallback continuations |

This is Direction #5 from the [Prioritization table](#prioritization) — documenting these contracts and rejecting out-of-scope fixes in code review. It's ongoing discipline, not a one-time implementation.

---

## The Common Thread

All six problems reduce to **one structural observation**:

> **The plugin schemas are the source of truth — but only the compiler sees them richly.**

| Phase | Schema access | Uses schemas for |
|---|---|---|
| Phase 1 (LLM) | None at reference/mapping time | — (guesses field names from action param names) |
| Phase 2 (binder) | Full | Binding capability → action. **Not** cross-step type validation. **Not** input-type constraint checking. |
| Phase 3 (IR conversion) | Full (via BoundIntentContract) | Carrying data_schema through |
| Phase 4 (compiler) | Full (via PluginResolver) | Safety-net heuristics, field reconciliation, parameter validation |
| Runtime (Pilot) | Plugin schemas only | Plugin param validation; **not** AI output validation (WP-9 deferred) |

**Every phase downstream of Phase 1 is doing fixup work instead of enforcement work.** The asymmetry is the problem. Phase 1 generates with incomplete information, and every later phase tries to correct for that with increasingly elaborate heuristics.

The rebase question is: **what would it take to flip this — so Phase 1 has the schemas it needs at generation time, and Phases 2/4/runtime become contract enforcers rather than heuristic appliers?**

---

## Prioritization

Ranked by leverage (how many downstream problems each one collapses):

| # | Direction | Fixes | Effort |
|---|---|---|---|
| 1 | **Phase 1 schema context injection** — feed upstream output schemas + plugin parameter constraints into the IntentContract LLM prompt | WP-2 root cause, WP-4 root cause, WP-11, WP-12 (partial) | High (prompt engineering + token cost + regression testing) |
| 2 | **Runtime AI output validation** — enforce declared `output_schema` on every `ai_processing` step output, fail loud on mismatch | AliExpress-class silent fabrication failures, WP-9 | Medium (validator + error plumbing) |
| 3 | **Binder input-type checking** — validate `x-variable-mapping.from_type` against source variable types at bind time | WP-12 category | Medium (binder extension) |
| 4 | **Compiler heuristic purge** — once #1 is in place, remove the alias tables, prefix stripping, and string replacements | P3 code quality; reduces blast radius | Low (after #1 lands) |
| 5 | **Phase responsibility re-anchoring** — document the contract each phase owns and reject out-of-scope fixes | P6 discipline | Ongoing |

---

## Part 2 — Deep Dives

### Deep Dive A — Phase 1 Schema Context Injection *(Direction #1)*

#### A.1 What Phase 1 currently sees

The Phase 1 IntentContract LLM receives a vocabulary injection via `buildVocabularyInjection()` in [intent-system-prompt-v2.ts:1278](../../lib/agentkit/v6/intent/intent-system-prompt-v2.ts#L1278). The extractor that produces it is [PluginVocabularyExtractor.ts](../../lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts).

For each connected plugin action, the vocabulary emits:

```
- search_emails (email/search): Search Gmail messages with filters
  Parameters:
    * query: string — Search query (supports Gmail operators: from:, subject:, in:, etc.)
      max_results: number (default: 50) — Maximum messages to return
      include_attachments: boolean (default: false) — Include attachment metadata
      content_level: string [metadata | snippet | full] (default: metadata) — How much body to return
```

**What is injected:** plugin key, domain, capability, action name, description, **input parameters** (name, type, enum, default, description).

**What is NOT injected:**

| Missing context | Consequence today |
|---|---|
| Plugin action **`output_schema`** (field names, types, nesting) | LLM invents downstream field refs like `{{raw_leads.values}}` or `sender` without knowing the producing action's actual fields. Compiler Phase 5 reconciles with prefix-stripping + alias tables (WP-2). |
| **Cross-parameter coupling** hints (`content_level=full` required if downstream consumes `.body`) | Compiler emits `search_emails` with default metadata level. Body comes back empty. Extractor silently fabricates "Unknown X" placeholders. (WP-11) |
| **Input-type constraints** (`x-variable-mapping.from_type: "file_attachment"`) | LLM routes "extract from email body" to `document-extractor`, whose input requires a file. Extractor returns placeholders. (WP-12) |
| Reminder of **which RefNames the LLM has already declared** and what fields each provides | LLM writes `{{leads.Stage}}` when the actual producing action emits `{{leads.values[][3]}}`. |

This is the gap. **The LLM is reasoning about data flow without seeing the data shape.**

---

#### A.2 Why just "inject all output_schemas" is naive

A first reaction is: *"just add `output_schema` to the vocabulary injection alongside `input_params`."* This is the right direction but has three real obstacles:

**Obstacle 1 — Token cost.** A full Gmail `search_emails` output_schema with `content_level=full` declares 15+ fields nested 3 levels deep (message → payload → parts → attachments). Google Sheets `read_range` declares nested `array<array<string>>`. If the user has 8 plugins connected with ~5 actions each, full-schema injection for all of them runs into several thousand extra tokens per Phase 1 call. Many of those schemas won't be used — the LLM only consumes 2–4 actions per workflow.

**Obstacle 2 — The chicken-and-egg problem.** The LLM is *generating* the IntentContract, which *chooses* the capability (and thus indirectly the plugin action). It doesn't know *which* action's output schema to care about until it decides the step. Injecting all possible schemas eagerly is what causes Obstacle 1. Injecting lazily (after the LLM picks) requires a two-pass flow.

**Obstacle 3 — Capability → action is many-to-one.** A single `(domain=email, capability=search)` may map to `google-mail.search_emails` or `microsoft-outlook.search_messages`, each with different output field names. The Phase 2 binder picks based on `provider_family` + user's connected plugins. At Phase 1 time, the action is knowable but not yet bound.

None of these are blockers. They just mean the naive solution won't scale — we need a more careful shape.

---

#### A.3 Four approaches

| # | Approach | Token cost | LLM correctness lift | Impl complexity |
|---|---|---|---|---|
| **A** | Eager full-schema injection | High (+2–5k tokens/call) | High | Low |
| **B** | **Schema summaries in vocabulary** (field list + top-level types, one level of nesting) | Low (+300–800 tokens/call) | High for references; Medium for nested field access | Low |
| **C** | Two-pass generation: draft → bind → inject → finalize | 2× LLM latency | Very high (schemas match picked actions exactly) | High |
| **D** | Just-in-time tool use: LLM calls `lookup_output_schema(domain, capability)` when needed | Low–medium; adds tool-loop latency | Very high; only pulls what's needed | Medium |

**Recommendation: B as baseline, D as progressive enhancement.**

Schema summaries give the LLM the one thing it cannot guess today — **the exact field names that each action produces** — without blowing up the prompt. For the 80% case (flat or one-level-nested outputs like `search_emails` → `emails[].{id,subject,from,date,body,snippet}`), summaries are enough to eliminate WP-2 and WP-4 reference mismatches entirely.

For the 20% case (deeply nested outputs where the LLM needs to navigate `.payload.parts[0].body.data`), a JIT tool-use lookup is the right escape hatch — but it can be added later, once B's impact is measured.

Approach C (two-pass) is powerful but heavy. It's worth reserving for a future version where we also want Phase 2 binding decisions reflected back into Phase 1 (e.g., "we picked google-mail over outlook — here's the gmail-specific schema").

---

#### A.4 Proposed design — Approach B in detail

**B.1 — Output schema summarizer**

Add a summarizer function that takes a plugin action's `output_schema` and produces a compact, flat representation:

```typescript
// Input: plugin action output_schema (from plugin definition JSON)
{
  "type": "object",
  "properties": {
    "emails": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "subject": { "type": "string" },
          "from": { "type": "string" },
          "date": { "type": "string" },
          "body": { "type": "string" },
          "snippet": { "type": "string" },
          "attachments": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "filename": { "type": "string" },
                "mimeType": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "total_found": { "type": "number" }
  }
}

// Output: summary (inlined in the vocabulary injection)
Returns: { emails: array<item>, total_found: number }
  item: { id: string, subject: string, from: string, date: string,
          body: string, snippet: string, attachments: array<attachment> }
  attachment: { filename: string, mimeType: string }
```

Depth cap: 2 levels of nesting beyond the top, with deeper objects elided as `object` with a count hint (`{...8 more fields}`). This keeps summary size bounded.

**B.2 — Vocabulary injection shape change**

Each action entry in the injection grows from:

```
- search_emails (email/search): Search Gmail messages with filters
  Parameters:
    * query: string — ...
```

to:

```
- search_emails (email/search): Search Gmail messages with filters
  Input parameters:
    * query: string — ...
    ...
  Returns: { emails: array<email>, total_found: number }
    email: { id: string, subject: string, from: string, date: string,
             body: string, snippet: string, attachments: array<attachment> }
    attachment: { filename: string, mimeType: string }
  ⚠ body/snippet populated only when content_level="full" is set
```

The last line — the **coupling hint** — is the mechanism that addresses WP-11. It is not extracted from JSON Schema (JSON Schema can't express it); it is declared as metadata on the plugin action, next to the output schema.

**B.3 — Coupling hint format in plugin definitions**

New optional field on plugin action definitions:

```json
{
  "action_name": "search_emails",
  "parameters": { ... },
  "output_schema": { ... },
  "output_dependencies": [
    {
      "when_param": { "content_level": "metadata" },
      "unpopulated_fields": ["body", "snippet"],
      "message": "body and snippet are empty unless content_level is 'snippet' or 'full'"
    },
    {
      "when_param": { "content_level": "snippet" },
      "unpopulated_fields": ["body"],
      "message": "body is empty unless content_level='full'"
    }
  ]
}
```

The vocabulary extractor surfaces these as warnings in the injection. The LLM sees them at reference-generation time, and the prompt instructs it: *"If your downstream steps read fields marked ⚠, you MUST set the referenced parameter accordingly."*

This is the same pattern as `x-variable-mapping` in plugin parameters — metadata that travels with the plugin definition, not buried in the compiler.

**B.4 — Input-type constraints (WP-12 fix, folds into B naturally)**

The same vocabulary injection surfaces input-type constraints:

```
- document-extractor.extract_structured_data (document/extract): Extract fields from a file
  Input parameters:
    * file_content: file_attachment — REQUIRED type: file. Cannot accept plain text.
  Returns: { ... }
```

When the LLM considers routing "extract from email body" to `document-extractor`, the `file_attachment` type marker tells it: *this action requires a file source, not a text source.* Combined with a prompt rule — *"If your source is a text field (string, email body, message content), prefer an `extract` or `generate` step using an AI capability, not a plugin-bound extractor whose input requires file_attachment."* — this prevents the WP-12 mis-binding at intent-generation time.

---

#### A.5 Impact map — what B collapses

| Weak point | How B addresses it |
|---|---|
| **WP-2** (field mismatches `message_id` vs `id`, `sender` vs `from`) | LLM sees `Returns: { emails: array<{id, subject, from, date, body, ...}> }` when writing step references. It uses `from` not `sender`, `id` not `message_id`, because those are the field names it sees. **Compiler heuristic stack (P3) can be deleted.** |
| **WP-4** (custom_code natural language) | LLM sees source fields (`from`, `subject`, `date`) and can emit structured `mapping: [{to: "sender", from: "from"}, ...]` with correct from-field names. Already landed structurally; B removes the risk of the LLM guessing wrong. |
| **WP-11** (`content_level=full` missing) | ✅ *Tactically fixed* by `enforceContentLevelForExtraction()` in IR converter. Direction #1 adds the upstream fix: coupling hint `⚠ body/snippet populated only when content_level="full"` steers the LLM to set the right parameter at intent time — preventing the IR converter heuristic from being needed. |
| **WP-12** (document-extractor mis-bound) | ✅ *Tactically fixed* by `actionExpectsFileAttachment()` + `inputLooksLikeFileAttachment()` in IR converter. Direction #1 adds the upstream fix: input-type marker `file_content: file_attachment — REQUIRED type: file` steers the LLM away from mis-routing text inputs — preventing the IR converter heuristic from being needed. |
| **WP-5** (group output shape) | Indirect — if the LLM knows downstream plugin inputs expect `{salesperson, leads, lead_count}`, its `transform.output_schema` becomes correct by construction. |

Four weak points with shared root cause get upstream-anchored fixes. The compiler's heuristic stack (P3) becomes removable.

---

#### A.6 What B does NOT fix

- **Runtime AI output validation** (Direction #2). B ensures the LLM *declares* correct schemas; it doesn't ensure LLM-driven runtime steps *produce* matching outputs. AliExpress-style fabrication (confidence=0 placeholders) needs enforcement at runtime, not Phase 1 guidance.
- **Binder mis-binding when multiple candidate actions exist per (domain, capability)**. B gives the LLM enough context to *prefer* the right shape, but it doesn't make Phase 2 binding smarter. Direction #3 covers that.
- **Deeply nested field access** beyond the summary depth cap. Mitigated by future Approach D (JIT tool lookup).

---

#### A.7 Implementation outline

| # | Change | File(s) | Status |
|---|---|---|---|
| 1 | Add `summarizeOutputSchema(schema, depthCap=2): string` helper | `lib/agentkit/v6/vocabulary/outputSchemaSummarizer.ts` (new) | ✅ Done (2026-04-07) |
| 2 | Extend `PluginActionInfo` with `output_summary: string`, `output_dependencies: OutputDependency[]` | `lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts` | ✅ Done (2026-04-07) |
| 3 | Update extractor to pull `output_schema` and `output_dependencies` from plugin definitions, summarize | `lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts` | ✅ Done (2026-04-07) |
| 4 | Update `buildVocabularyInjection()` to render output summaries + coupling warnings under each action | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts:1298+` | ✅ Done (2026-04-07) |
| 5 | Add prompt rules: output field references + coupling hints + file-only input warning | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` | ✅ Done (2026-04-07) |
| 6 | Seed `output_dependencies` on `google-mail.search_emails` (content_level coupling) and `document-extractor.extract_structured_data` (file-only input warning) | `google-mail-plugin-v2.json`, `document-extractor-plugin-v2.json` | ✅ Done (2026-04-07) |
| 7 | Regression tests: run existing scenarios and verify output summaries appear in vocabulary + IntentContract references improve | `tests/v6-regression/` | ⬜ Running |
| 8 | Once stable, **delete** compiler-side heuristics (Phase 5 field reconciliation, alias tables, prefix stripping) and rely on Phase 1 correctness + compiler validation | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`, `lib/pilot/StepExecutor.ts` transformMap | ⬜ Gated on regression evidence |

Steps 1–6 are implemented. Step 7 validates. Step 8 is the payoff — removing P3's heuristic soup — gated on regression evidence.

---

#### A.8 Open questions for discussion

1. **Summary depth cap of 2** — is this aggressive enough? Should we let plugin definitions override it per-action (e.g., `document-extractor` might want depth 3 to show extraction result structure)?
2. **Multi-action capability mapping** — when `(domain=email, capability=search)` could bind to `google-mail.search_emails` OR `outlook.search_messages`, do we inject **both** schemas, a **union**, or only the **one matching the user's connected plugins**? (I'd argue: only the connected-plugin one, since that's what binder will pick.)
3. **`output_dependencies` as a new plugin-definition field** — is this the right place, or should it live in a sidecar metadata file to avoid touching stable plugin definitions?
4. **Removing compiler heuristics in step 10** — we could keep them as a safety net with logging for one release, measure how often they fire, and only delete once they stop firing. Safer but delays the P3 cleanup.
5. **Does this overlap with the EP key hints work?** EP key hints teaches Phase 1 about **input** parameters via prefixed config keys. B teaches Phase 1 about **output** schemas. The two are complementary but their prompt sections may need harmonizing.
6. **Token budget** — we should establish a target (e.g., "output summaries add ≤ 500 tokens per connected plugin action") and measure real impact on the top 5 scenarios before shipping.

---

### Deep Dive B — Runtime AI Output Validation *(Direction #2)*

#### B.1 The AliExpress failure, anatomized

The Delivery Tracker run (2026-04-05) delivered an email with 14 rows of `"Unknown package_number / Unknown products / Unknown delivery_status"` and reported `success: true`. Tracing the failure backward through the code:

1. `search_emails` returned 14 emails with `body: ""` (WP-11 — `content_level` not set). ✅ *Now fixed by `enforceContentLevelForExtraction()`.*
2. `document-extractor.extract_structured_data` was called on each email (WP-12 — mis-binding). ✅ *Now fixed by `actionExpectsFileAttachment()` reroute.*
3. With no file and no text to parse, the extractor returned:
   ```json
   {
     "package_number": "Unknown Package_number",
     "products": "Unknown Products",
     "delivery_status": "Unknown Delivery_status",
     "_extraction_metadata": { "confidence": 0, "success": false }
   }
   ```
4. The extractor's output **satisfied the declared `output_schema`** — three string fields, all present, all strings. The placeholder strings `"Unknown X"` are valid strings.
5. `_extraction_metadata.success: false` was ignored by every downstream layer.
6. A scatter-gather assembled 14 placeholder rows into an HTML table.
7. `send_email` delivered it.

**The validation blind spots, ordered by proximity to the failure:**

| # | Blind spot | Where it could have caught |
|---|---|---|
| 1 | **Confidence metadata ignored** | The extractor said `success: false`. No layer acts on it. |
| 2 | **Shape-valid but semantically-invalid outputs pass through** | `"Unknown X"` strings match `type: "string"` — schema validation as-declared can't see the semantic problem. |
| 3 | **No cross-step trust propagation** | Downstream HTML-table step + send-email step had no way to know upstream extraction was zero-confidence. |
| 4 | **Silent fallbacks in I3 extraction** | When LLM output doesn't parse cleanly, `StepExecutor` wraps raw string in `{result, summary, analysis, ...}` aliases so downstream references still resolve. |
| 5 | **`output_schema` on AI steps is advisory at runtime** | Design doc promised "fail loud" validation. Implementation does "best-effort extraction + silent fallback." |

Direction #2 (this deep dive) addresses blind spots 4 and 5 — the **schema enforcement gap**. Blind spots 1–3 are the **trust-metadata problem**, a closely related but distinct concern covered in §B.6.

---

#### B.2 What exists today

**`OutputValidator`** ([lib/pilot/OutputValidator.ts](../../lib/pilot/OutputValidator.ts)):
- Validates workflow **final output** against the agent's top-level `output_schema` array.
- Checks: field presence, top-level type, format regex.
- **Does not** validate per-step outputs. Does not validate nested structure. Does not validate array items.

**I3 extraction path** ([StepExecutor.ts:1433–1476](../../lib/pilot/StepExecutor.ts#L1433-L1476)):
- After an `ai_processing` step returns, if `output_schema.properties` exists, attempts to parse structured JSON from the LLM's text response via `extractBalancedJSON`.
- Acceptance criterion: **"ANY expected field is present in the parsed object"** (`hasExpectedField = expectedFields.some(f => f in parsed)`).
- On failure: logs warning, falls through to alias wrapper `{result, response, output, summary, analysis, decision, reasoning, classification}` — all aliases pointing at the raw LLM text.

**Memory-dump garbage handler** (StepExecutor.ts:1449):
- If LLM returns `{memory_context, agent_memory_context, user_profile}` (a known runAgentKit failure mode), replaces with `{field: null}` for every declared field and returns success.

**`callLLMDirect`** (StepExecutor.ts:1509):
- No output validation at all. Returns raw text.

The current regime is **permissive by construction**: every failure mode has a silent-continuation path.

---

#### B.3 Design principles for Direction #2

From the original design doc (V6_WORKFLOW_DATA_SCHEMA_DESIGN §2):
> *"Fail loud, not silent. When runtime data doesn't match the declared schema, execution stops with a descriptive error showing expected vs. received shape. No silent degradation."*

Applied to AI outputs specifically:

1. **If a step declares `output_schema`, it has opted into enforcement.** No declaration → no validation. Declaration → strict validation.
2. **No aliasing around a failed schema match.** If extraction produced something that doesn't match the schema, that is a failure, not a fallback.
3. **One repair attempt before failing.** LLM outputs are stochastic; a single re-prompt with the validation error is cheap and catches the majority of recoverable misshapes.
4. **Errors must be actionable.** The validation error needs: step ID, slot name, expected shape (with field types), actual shape (with received values truncated), and a pointer to the LLM response so the user can diagnose prompt vs. validation mismatches.
5. **Preserve backward compatibility for steps without `output_schema`.** Many existing steps emit freeform text and their consumers reference `.result`. Don't break those.

---

#### B.4 Proposed design

**B.4.1 — New module: `AIOutputValidator`**

A new validator distinct from `OutputValidator` (which stays responsible for final-workflow validation). This one validates individual AI-step outputs against their declared slot schema.

```typescript
// lib/pilot/AIOutputValidator.ts (new)

export interface AIOutputValidationResult {
  valid: boolean;
  errors: AIOutputValidationError[];
  actualShape: string;     // Compact string representation of received structure
  expectedShape: string;   // Compact string representation of declared schema
}

export interface AIOutputValidationError {
  path: string;            // e.g. "emails[0].subject"
  reason: 'missing_required' | 'type_mismatch' | 'not_array' | 'not_object' | 'array_items_invalid';
  expected: string;        // e.g. "string"
  actual: string;          // e.g. "undefined" or "number (42)"
}

export class AIOutputValidator {
  validate(data: any, schema: SchemaField, path: string): AIOutputValidationResult;
}
```

The validator walks the declared `SchemaField` tree recursively, mirroring the validation sketch in the original design doc (V6_WORKFLOW_DATA_SCHEMA_DESIGN §8):
- Required field missing → error
- Top-level type mismatch (expected object, got array) → error
- Property types (recurse into object properties) → errors per property
- Array items (validate first 1–3 items as representative, plus item count) → errors per invalid item
- `oneOf` (for branch unions) → must match at least one branch

**B.4.2 — StepExecutor integration**

Wire `AIOutputValidator` into the post-extraction path. Replace the current alias-wrapper fallback when `output_schema` is present:

```typescript
// In executeLLMDecision / callLLMDirect result handling:

if (stepOutputSchema && stepOutputSchema.properties) {
  const extracted = tryExtractStructuredJSON(cleanedResponse, stepOutputSchema);

  if (!extracted) {
    // Extraction itself failed — response wasn't parseable JSON matching the shape
    return await this.handleSchemaFailure(
      step, context, cleanedResponse, stepOutputSchema,
      'extraction_failed', /* attempt */ 1
    );
  }

  const validation = this.aiOutputValidator.validate(extracted, stepOutputSchema, step.id);

  if (!validation.valid) {
    return await this.handleSchemaFailure(
      step, context, cleanedResponse, stepOutputSchema,
      'validation_failed', /* attempt */ 1, validation
    );
  }

  return { data: extracted, tokensUsed: result.tokensUsed };
}

// No output_schema declared — keep existing alias-wrapper path (backward compat)
return { data: legacyAliasWrapper(cleanedResponse), tokensUsed: result.tokensUsed };
```

**B.4.3 — `handleSchemaFailure` with single repair attempt**

```typescript
private async handleSchemaFailure(
  step, context, rawResponse, schema, reason, attempt, validation?
): Promise<StepResult> {

  if (attempt === 1) {
    // One repair attempt: re-prompt with the validation feedback
    const repairPrompt = this.buildRepairPrompt({
      originalPrompt: step.prompt,
      previousResponse: rawResponse,
      schema,
      validation,
      reason,
    });

    logger.warn({ stepId: step.id, reason, errors: validation?.errors },
      'AI output validation failed — attempting repair (attempt 1)');

    const repaired = await this.callLLMDirect(repairPrompt, context, step.id);
    // Recurse with attempt=2
    return this.validateAndReturn(step, repaired, schema, /* attempt */ 2);
  }

  // Attempt 2 failed — fail loud
  throw new SchemaViolationError({
    stepId: step.id,
    slotName: step.output_variable,
    expected: validation?.expectedShape ?? 'declared schema',
    actual: validation?.actualShape ?? 'unparseable response',
    errors: validation?.errors ?? [],
    rawResponse: rawResponse.substring(0, 1000),
  });
}
```

**B.4.4 — Repair prompt shape**

```
Your previous response did not match the required schema.

Required schema:
{
  "package_number": { "type": "string", "required": true },
  "products": { "type": "array", "items": { "type": "string" } },
  "delivery_status": { "type": "string", "required": true }
}

Validation errors:
- products: expected type "array" but got "string"
- delivery_status: required field missing

Your previous response:
{"package_number": "AX123", "products": "box, cable", "delivery_status_info": "in transit"}

Respond ONLY with valid JSON matching the schema above. No prose, no explanation.
```

**B.4.5 — `SchemaViolationError` shape**

```
SCHEMA VIOLATION: AI step output does not match declared schema

  Step: step3_extract_package_fields (ai_processing/extract)
  Slot: extracted_package_data
  Attempt: 2 (after 1 repair attempt)

  Expected shape:
    { package_number: string (required),
      products: array<string>,
      delivery_status: string (required) }

  Received shape:
    { package_number: "Unknown Package_number",
      products: "Unknown Products",
      delivery_status: "Unknown Delivery_status" }

  Validation errors:
    - products: expected type "array" but got "string". Value: "Unknown Products"

  LLM response (first 1000 chars):
    { "package_number": "Unknown Package_number", ... }
```

Execution halts. The agent run is marked `failed` with this error. The user gets a meaningful diagnostic instead of a fabricated email.

---

#### B.5 What about the `"Unknown X"` case specifically?

**Schema validation alone does not catch it.** `"Unknown Package_number"` is a valid string. The schema says `package_number: string (required)`. It passes.

This is the boundary between schema validation (Direction #2) and trust-metadata propagation (§B.6). The correct fix for AliExpress specifically is a **combination**:

| Layer | Fix | Source | Status |
|---|---|---|---|
| Upstream | `search_emails` emits `content_level=full` (populated body) | Direction #1 (coupling hint injected to Phase 1) | ✅ Tactically fixed (IR converter heuristic). Direction #1 makes the heuristic unnecessary. |
| Upstream | `document-extractor` not bound to text sources | Direction #1 (input-type constraint) + Direction #3 (binder check) | ✅ Tactically fixed (IR converter file-vs-text heuristic). Directions #1/#3 make the heuristic unnecessary. |
| Upstream | Empty-input guard on AI processing steps | WP-13 (StepExecutor `detectEmptyAIProcessingInput`) | ✅ Fixed (runtime). Prevents hallucination when upstream produces no data. |
| Mid-stream | Extractor outputs honest confidence metadata → downstream sees trust=low | §B.6 trust propagation | ⬜ Not yet addressed |
| Runtime | `output_schema` validation catches structural deviations | Direction #2 (this deep dive) | ⬜ Not yet addressed |

Direction #2 by itself would **not** have caught AliExpress. That's important to be honest about: the structural-validation layer catches shape deviations, not semantic fabrication. You still need the upstream fixes (Direction #1) to stop the cascade at its source.

**However** — and this is the argument for Direction #2 being a high-leverage safety net — consider the failure modes it *does* catch:
- LLM returns prose instead of JSON → caught
- LLM returns JSON wrapped in extra keys (`{result: {package_number: ...}}`) → caught
- LLM returns array where object was expected → caught
- LLM returns object where required field is missing → caught, repaired
- LLM returns garbage memory dump (D-B13 case) → caught with actionable error instead of silent null-filling

Direction #2 is about preventing an entire class of LLM-misshape failures that silently corrupt downstream data today.

---

#### B.6 Trust metadata — scoped out, but adjacent

Many plugins and AI operations **already produce honest trust signals** that the runtime ignores:

| Source | Signal | Today's behavior |
|---|---|---|
| `document-extractor` | `_extraction_metadata: { confidence, success, missing_fields }` | Ignored |
| Scatter-gather iterations | `{error, item}` error wrappers | Filtered out (WP-10 fix) but no trust degradation |
| AI classify with low-confidence tag | `confidence: "low"` / probability score | No standard format, varies per step |
| Structural extractors | `matched_fields: []` vs expected | Not consistently checked |

A **trust-metadata propagation layer** would:
1. Recognize standard trust signals (`confidence`, `success`, `_extraction_metadata`) in step outputs
2. Attach a `_trust` marker to the slot value: `{ level: 'low' | 'medium' | 'high', reason }`
3. Propagate through transform/filter/loop steps (low-trust input → low-trust output)
4. Check at delivery boundaries: if `send_email` is about to send data with `_trust.level === 'low'`, block or require an explicit `allow_low_trust: true` flag

This is worth a separate deep dive but explicitly out of scope for Direction #2. Direction #2 is **structural** validation (does the shape match?), trust metadata is **semantic** validation (is the content believable?). Both needed, separable.

---

#### B.7 Impact map

| Case | Direction #2 outcome |
|---|---|
| LLM returns prose instead of JSON | ❌ caught → repaired (likely) → hard fail if repair fails |
| LLM returns JSON with extra wrapper (`{result: {...}}`) | ❌ caught → repaired → likely success |
| Required field missing | ❌ caught → repaired → likely success |
| Type mismatch (array vs string) | ❌ caught → repaired → variable success rate |
| Memory dump garbage (D-B13) | ❌ caught → hard fail with clear error (today: silent null-fill) |
| AliExpress `"Unknown X"` placeholders | ✅ passes (shape is valid) — need trust propagation or Direction #1 |
| Step without `output_schema` declared | ✅ passes (backward compat, no validation) |
| Scatter-gather iteration with wrong shape | ❌ caught per-iteration → iteration marked failed → WP-10 path |

---

#### B.8 Implementation outline

| # | Change | File(s) | Status |
|---|---|---|---|
| 1 | Create `AIOutputValidator` with recursive `SchemaField` walker | `lib/pilot/AIOutputValidator.ts` (new) | ✅ Done (2026-04-08) |
| 2 | Create `SchemaViolationError` typed error with structured context | `lib/pilot/types.ts` | ✅ Done (2026-04-08) |
| 3 | Add `buildRepairPrompt()` helper | `lib/pilot/AIOutputValidator.ts` | ✅ Done (2026-04-08) |
| 4 | Wire validation + repair into `executeLLMDecision` I3 path — replace alias-wrapper fallback with `extractValidateAndReturn()` + `handleSchemaFailure()` | `lib/pilot/StepExecutor.ts` | ✅ Done (2026-04-08) |
| 5 | Memory-dump detection converted from silent null-fill to extraction failure → repair → SchemaViolationError | `lib/pilot/StepExecutor.ts` (inside `extractValidateAndReturn`) | ✅ Done (2026-04-08) |
| 6 | Backward compat: steps without `output_schema` keep alias wrapper path | `lib/pilot/StepExecutor.ts` | ✅ Done (2026-04-08) |
| 7 | Surface `SchemaViolationError` in execution result | `lib/pilot/WorkflowPilot.ts` error path | ⬜ Future (see V6_WORKFLOW_DATA_SCHEMA_DESIGN.md §11) |
| 8 | Unit tests for `AIOutputValidator` | `lib/pilot/__tests__/AIOutputValidator.test.ts` | ⬜ Deferred |
| 9 | Metrics: repair attempts, success rate, hard failures | `lib/pilot/MetricsCollector.ts` | ⬜ Deferred |

Steps 1–6 are implemented. Step 7 is documented as a future enhancement (user-facing error reporting). Steps 8–9 are deferred follow-ups.

---

#### B.9 Open questions for discussion

1. **Repair attempt count — 1 or 2?** One repair is cheap (~1k tokens). Two doubles the worst-case token cost. Start with 1, revisit with data from step 11 metrics.
2. **Repair with a different/stronger model?** If Claude Haiku produced malformed JSON, retry with Sonnet? Adds a dimension to the repair strategy. Could be a later refinement.
3. **Array item validation depth.** Do we validate *all* items in a large array, or sample first 3 + spot-check? Performance vs thoroughness. I'd say: validate all for arrays ≤ 20, sample 5 for larger.
4. **Memory-dump garbage handler behavior.** Today: silent null-fill. Proposed: hard fail. Risk: if D-B13 recurs in production, we surface failures we previously masked. Counterargument: we *should* surface them — the mask created the AliExpress-style failures.
5. **Does validation apply to `llm_decision` steps (which use `runAgentKit`)?** `llm_decision` steps use tools/plugins and may have more varied output shapes. I'd say yes — if they declare `output_schema`, validate. Same rules.
6. **Scatter-gather + validation failure interaction.** When an iteration fails schema validation: (a) treat as iteration failure and continue via WP-10's error filtering, or (b) fail the scatter-gather immediately? I'd argue (a) — consistent with WP-10 and preserves partial progress.
7. **Telemetry for "catches that saved us"** — log validation failures distinctly from step failures so we can measure how often Direction #2 earns its keep in production.
8. **Interaction with Direction #1.** Once schema summaries are injected (Direction #1), LLMs should produce correct shapes more often. Direction #2 will *mostly* be catching edge cases. This is fine — it becomes a safety net, not a crutch.

---

### Deep Dive C — Binder Input-Type Checking *(Direction #3)*

#### C.1 How the binder picks an action today

[CapabilityBinderV2.bindStep()](../../lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts#L241) selects a plugin action via this sequence:

| # | Phase | What it matches | Hard filter or soft score |
|---|---|---|---|
| 1 | `findCandidates()` | `action.domain === use.domain && action.capability === use.capability` | Hard filter |
| 2 | `scoreByPreferences()` | `plugin.provider_family === use.preferences.provider_family` → `+0.5` | Soft score |
| 3 | `scoreByArtifactStrategy()` | artifact strategy (`get_or_create` → `upsert` bonus) | Soft score |
| 4 | `filterByMustSupport()` | `use.preferences.must_support` flags present on action | Hard filter |
| 5 | Pick highest score, sort by `score` desc | — | Winner-take-all |

**What is never considered:**

| Missing check | Where the info lives | Consequence |
|---|---|---|
| **Input type compatibility** — does the action's required input param accept the type the source variable produces? | `action.parameters[param].x-variable-mapping.from_type` | WP-12: `document-extractor` (expects `file_attachment`) bound to email text |
| **Field availability** — does the source variable actually expose the fields this action needs? | `data_schema.slots[source].schema.properties` | Runtime NullPointer or empty-string-masquerading-as-content |
| **Input parameter coupling** — does a required input param have a value derivable from available slots? | Input param `required` + resolved config + step inputs | "Missing required param" errors at runtime |

The binder is **capability-aware but not data-aware**. It picks the right *kind* of action without checking whether the specific *data at hand* can feed it.

---

#### C.2 The WP-12 trace, through the binder

```
IntentContract step (LLM-emitted):
  { id: "step3_extract", kind: "extract",
    uses: [{ domain: "document", capability: "extract" }],
    inputs: ["current_email"] }

Bound slot for current_email (loop-scoped, derived from step1.emails[].items):
  schema: { type: "object", properties: {
    id: string, subject: string, from: string, body: string,
    snippet: string, attachments: array<attachment> } }
  → source type: plain text fields, no file_attachment.

Binder finds candidates (domain=document, capability=extract):
  → document-extractor.extract_structured_data   (score 1.0, exact match)
  → [no other candidates]

document-extractor.extract_structured_data's input param:
  "file_content": {
    "x-variable-mapping": { "from_type": "file_attachment" },
    "required": true
  }

Binder does NOT compare source slot's shape to file_content's from_type.
Bindings: step3 → document-extractor.extract_structured_data ✓ score 1.0

Runtime: passes current_email (a text object, no file) → extractor returns placeholders.
```

The binder said *"yes, this action can extract, domain matches, capability matches"* — and that was enough. The type contract on `file_content` was silent.

---

#### C.3 What already exists in plugin definitions

`x-variable-mapping.from_type` is already used across the plugin catalog:

| Plugin | Param | from_type |
|---|---|---|
| `chatgpt-research` | research prompt input | `file_attachment` |
| `google-drive` | folder operations | `folder` |
| `google-drive` | file operations | `file_attachment` |
| `google-mail` | attachment send | `file_attachment` |
| `google-mail` | label operations | (specific label refs) |
| `google-sheets` | spreadsheet refs | (specific resource refs) |
| `document-extractor` | `file_content` | `file_attachment` |

So the constraints exist. They're just ignored by the binder. This is similar to P3's pattern: **the information is in the schema, but the phase that could use it doesn't read it.**

---

#### C.4 Design principles for Direction #3

1. **Hard filter, not soft score.** Input-type mismatch is not a preference — it's a contract violation. A candidate whose input type doesn't match should be *eliminated*, not penalized.
2. **Reason from the schema, not hardcoded types.** The `from_type` vocabulary (`file_attachment`, `folder`, etc.) is a small, closed set defined in plugin schemas. No hardcoded lookups in the binder.
3. **When no candidate survives, fail *helpfully*.** Don't silently mark unbound. Emit a structured error naming the rejected candidate, the required type, and the actual source type.
4. **The binder *may* remove candidates, but the *decision* to fall back to AI extraction belongs elsewhere.** The binder reports binding impossibility; the IR converter decides what to do about it (possibly: rewrite the step as `ai_processing`).
5. **Run the check *after* data_schema is built.** The source slot's schema is the authoritative type signal. Since `DataSchemaBuilder.build()` runs at the end of `CapabilityBinderV2.bind()`, we need a new post-schema validation pass.

---

#### C.5 Proposed design

**C.5.1 — Two-phase binding**

Restructure `CapabilityBinderV2.bind()` from a single pass into two phases:

```
Phase 2a (existing):
  1. Resolve subsets
  2. For each step, findCandidates + scoreByPreferences + scoreByArtifactStrategy + filterByMustSupport
  3. Pick best candidate
  4. Build data_schema (DataSchemaBuilder)

Phase 2b (new):
  5. For each bound step, validate input-type compatibility
     against data_schema
  6. If incompatible: try next candidate in the ranked list
  7. If no candidate survives: mark unbound with reason="input_type_incompatible"
     and emit structured diagnostic
  8. If candidate swap occurred: rebuild affected data_schema slot
     (plugin output_schema may differ between candidates)
```

The key refinement: today's binder keeps only the *winner* per step. For Phase 2b to try alternatives, **the binder must retain the full ranked candidate list** per step, not just the top one.

**C.5.2 — Input-type compatibility check**

```typescript
// New: lib/agentkit/v6/capability-binding/InputTypeChecker.ts

export type FromType = 'file_attachment' | 'folder' | 'email' | 'message' | 'record' | 'row' | string;

export interface InputTypeCheckResult {
  compatible: boolean;
  violations: InputTypeViolation[];
}

export interface InputTypeViolation {
  param_name: string;              // e.g. "file_content"
  required_from_type: FromType;    // e.g. "file_attachment"
  source_ref: string;              // e.g. "current_email"
  source_type: string;             // e.g. "object (no file_attachment marker)"
  reason: string;                  // human-readable
}

export class InputTypeChecker {
  check(
    action: ActionDefinition,
    step: BoundStep,
    dataSchema: WorkflowDataSchema
  ): InputTypeCheckResult {
    // For each required param with x-variable-mapping.from_type:
    //   Find the step input that maps to this param
    //   Look up the source slot's schema
    //   Compare slot schema's inferred "from_type" to required from_type
    //   If mismatch → violation
  }
}
```

**C.5.3 — Inferring slot `from_type`**

The tricky part: `x-variable-mapping.from_type` is an input-side vocabulary. Slot schemas use generic JSON-Schema-ish types (`string`, `object`, `array`). We need a mapping.

Two options:

| Option | Approach | Trade-off |
|---|---|---|
| **α** | Plugin output schemas also declare `x-variable-mapping.to_type` on their output fields | Symmetric with input side; requires touching every plugin definition |
| **β** | Infer `to_type` from slot schema structure + producing action metadata | Zero plugin-def changes; relies on heuristics |

**Recommended: α — symmetric `to_type` declarations.** It matches the "plugin schemas are the source of truth" principle. Each plugin action's `output_schema` declares the semantic types its fields represent:

```json
// google-mail.search_emails output_schema
"emails": {
  "type": "array",
  "items": {
    "type": "object",
    "x-variable-mapping": { "to_type": "email" },
    "properties": {
      "body": { "type": "string", "x-variable-mapping": { "to_type": "text_content" } },
      "attachments": {
        "type": "array",
        "items": { "x-variable-mapping": { "to_type": "file_attachment" } }
      }
    }
  }
}
```

Then a step reference like `{{current_email.body}}` resolves to `to_type: "text_content"`, which is **not** compatible with `from_type: "file_attachment"` — immediate compatibility fail.

`{{current_email.attachments[0]}}` resolves to `to_type: "file_attachment"` — **compatible** with `file_content: file_attachment`.

**C.5.4 — Compatibility matrix**

`from_type` ↔ `to_type` compatibility is a small, explicit table:

| from_type required | Compatible to_types |
|---|---|
| `file_attachment` | `file_attachment`, `file` |
| `folder` | `folder`, `folder_ref` |
| `text_content` | `text_content`, `string` |
| `email` | `email`, `email_message`, `email_ref` |
| `record` | `record`, `record_ref`, `row` |
| *(no from_type declared)* | anything (skip check) |

Lives in `lib/agentkit/v6/capability-binding/input-type-compat.ts`. Small, editable as the semantic vocabulary grows.

**C.5.5 — Candidate re-selection**

When the top candidate fails input-type check:

```typescript
for (const candidate of rankedCandidates) {
  const check = typeChecker.check(candidate.action, step, dataSchema);
  if (check.compatible) {
    bindStep.plugin_key = candidate.plugin_key;
    bindStep.action = candidate.action_name;
    bindStep.binding_reason.push(`✅ Input types compatible`);
    return;
  }
  logger.info({ step_id, rejected: candidate.action_name, violations: check.violations },
    '[InputTypeChecker] Candidate rejected');
  bindStep.binding_reason.push(
    `❌ Rejected ${candidate.plugin_key}.${candidate.action_name}: ${check.violations[0].reason}`
  );
}

// All candidates failed input-type check
bindStep.binding_method = 'unbound';
bindStep.binding_reason.push('input_type_incompatible');
return;
```

**C.5.6 — IR converter fallback to AI extraction**

When a `kind: "extract"` step lands in the IR converter with `binding_method: "unbound"` AND `binding_reason` includes `"input_type_incompatible"` AND the source is text-shaped → rewrite as `ai_processing/extract`:

```typescript
// In IntentToIRConverter.convertExtract():
if (boundStep.binding_method === 'unbound' &&
    boundStep.binding_reason?.includes('input_type_incompatible')) {
  const sourceType = inferSourceType(boundStep, dataSchema);
  if (isTextualSource(sourceType)) {
    logger.info({ step_id: boundStep.id },
      '[O31] Rewriting extract step as ai_processing/extract — no plugin candidate accepts text source');
    return convertToAIProcessingExtract(boundStep);
  }
}
```

This is the "graceful degradation" path that turns WP-12's silent-failure into an explicit, correct re-routing.

---

#### C.6 Impact map

| Weak point / risk | How Direction #3 addresses it |
|---|---|
| **WP-12** (document-extractor bound to text) | ✅ *Tactically fixed* in IR converter with heuristic file-vs-text detection. Direction #3 replaces the heuristic with schema-driven `from_type` vs `to_type` check — more robust and not reliant on field-name pattern matching (FILE_MARKERS/TEXT_MARKERS sets). |
| **Future: text-to-folder mis-routes** | `from_type: folder` vs source `to_type: string` → rejected |
| **Future: record-ID vs row confusion** | Different `to_type` markers separate incompatible entity refs |
| **WP-2** (field name mismatches) | Partial — if `current_email.sender` doesn't exist in the slot schema, type check catches it as "source reference does not resolve" |
| **WP-11** (missing `content_level`) | Not directly — this is a parameter-coupling issue, addressed by Direction #1's coupling hints, not binder input-type check |

Direction #3's scope is **input type compatibility at binding time**. It does not replace Direction #1 (which prevents the bad reference from being emitted) or Direction #2 (which catches runtime output violations). Together, the three Directions form a **defense in depth**:

```
Phase 1 (LLM intent):      Direction #1 — emit correct references + set coupled params
Phase 2 (binder):          Direction #3 — only bind to actions whose input types match
Runtime (step execution):  Direction #2 — validate AI outputs structurally
```

---

#### C.7 What Direction #3 does NOT fix

- **Semantic type correctness** — Direction #3 checks the `to_type`/`from_type` labels. If a plugin author mislabels a field (`to_type: file_attachment` on a string URL), the check passes with wrong data. Mitigation: plugin-definition linting, catalog review.
- **Under-specified semantic vocabulary** — if no existing `to_type` captures a concept (e.g. "webhook payload"), falls through as `string`/`object` and compatibility defaults to "unconstrained match." Expected evolution: grow the vocabulary as needs emerge.
- **Cases where multiple candidates could bind but none has `from_type`** — the check is only as strict as the plugin-definition metadata. Partial coverage during rollout.

---

#### C.8 Implementation outline

| # | Change | File(s) | Status |
|---|---|---|---|
| 1 | Extend CapabilityBinderV2 to retain ranked candidate list per step | `CapabilityBinderV2.ts` | ✅ Done (2026-04-07) |
| 2 | Add `from_type` vocabulary + compatibility matrix (~12 canonical types) | `lib/agentkit/v6/capability-binding/input-type-compat.ts` (new) | ✅ Done (2026-04-07) |
| 3 | Create `InputTypeChecker` class with `check()` method | `lib/agentkit/v6/capability-binding/InputTypeChecker.ts` (new) | ✅ Done (2026-04-07) |
| 4 | Wire input-type check into `bind()` — Phase 2b after DataSchemaBuilder + field reconciliation | `CapabilityBinderV2.ts` | ✅ Done (2026-04-07) |
| 5 | Add `x-semantic-type` annotations to plugin output schemas (google-mail emails → `email_message`, attachments → `file_attachment`) | `google-mail-plugin-v2.json` | ✅ Done (2026-04-07) |
| 6 | Extend `SchemaField` with `semantic_type` + propagate from `x-semantic-type` in `convertJsonSchemaToSchemaField()` | `workflow-data-schema.ts` | ✅ Done (2026-04-07) |
| 7 | Add `input_type_incompatible` rewrite path in IntentToIRConverter — runs before WP-12 heuristic fallback | `IntentToIRConverter.ts` | ✅ Done (2026-04-07) |
| 8 | Surface binding failures with structured diagnostic (`rejected_candidates` on BoundStep) | `CapabilityBinderV2.ts` | ✅ Done (2026-04-07) — `rejected_candidates` array with plugin_key, action_name, rejection_reason |
| 9 | Regression validation: all 10 scenarios pass with Phase 2b active | `tests/v6-regression/` | ⬜ Running |
| 10 | Metrics: count candidate rejections | `MetricsCollector.ts` | ⬜ Deferred (add when rejection telemetry is needed) |

Steps 1–8 are implemented. The WP-12 heuristic fallback (`actionExpectsFileAttachment` + `inputLooksLikeFileAttachment`) is retained as a safety net — it fires only if the schema-driven Phase 2b check didn't catch the incompatibility (e.g., missing `x-semantic-type` annotations). Will be removed per A.7 step 8 once annotations are complete.

---

#### C.9 Open questions for discussion

1. **`to_type` vocabulary size** — should we define a canonical closed list (e.g. ~15 types), or let plugins invent types freely? I'd argue closed list with extension process — prevents vocabulary drift.
2. **Who maintains the compatibility matrix?** Canonical types → matrix in code. Custom types → declarative annotation inline in plugin definitions (`compatible_with: ["file", "file_attachment"]`).
3. **Backwards compat during annotation rollout** — until all plugin defs have `to_type` on outputs, input-type checks pass by default (no constraint). Should we warn when a check is skipped due to missing annotation?
4. **Should Phase 2b swap candidates silently, or log loudly?** If top-ranked candidate fails check and second wins, the binding decision changed — this should be surfaced in logs and maybe in the compiler output trace.
5. **Interaction with Direction #1's input-type constraint injection** — Direction #1 tells the LLM "this param requires file_attachment"; Direction #3 enforces it at bind time. Is this belt-and-braces valuable, or redundant? I'd argue valuable: Direction #1 steers the LLM, Direction #3 guarantees correctness even if the LLM ignored the hint.
6. **Is rewriting to `ai_processing/extract` the binder's job or the IR converter's?** I've placed it in the IR converter (§C.5.6) to keep binder focused. Alternative: have binder emit both the failed-binding diagnostic AND a suggested fallback step type. The converter then trusts the suggestion.

---

## Part 3 — Resolved Answers to Open Questions

This section consolidates the open questions from Deep Dives A, B, and C with proposed answers. Each answer is a **working position** — defensible, internally consistent, and actionable. They are not immutable; they are the decisions we'll proceed with unless contradicted by implementation reality.

### Deep Dive A — Phase 1 Schema Context Injection

#### Q-A1. Summary depth cap of 2 — aggressive enough?

**Answer: Yes, 2 is the right default, with per-action override.**

Two levels (top + items + item's nested objects) covers the 80% case: `search_emails → emails[] → {id, subject, body, attachments[]}`. For the 20% case where deeper nesting matters (e.g., `document-extractor` output with nested extraction results), allow a per-action override in plugin definitions:

```json
"output_schema": { ... },
"x-summary-depth": 3
```

**Rationale:** keeping default at 2 bounds token cost predictably. Plugin authors who *need* depth 3 can opt in explicitly. This keeps the common case cheap and the rare case correct.

#### Q-A2. Multi-action capability mapping — inject which schema(s)?

**Answer: Only inject schemas for actions that belong to the user's connected plugins.**

When `(domain=email, capability=search)` could bind to `google-mail.search_emails` OR `outlook.search_messages`, the vocabulary extractor already filters by the user's connected plugins. Inject only those. If both Gmail and Outlook are connected, inject both — and rely on Phase 2's `provider_family` preference to resolve binding.

**Rationale:** unions would lie (a field in one action may not exist in the other). Injecting only disconnected options wastes tokens. The vocabulary already has the connected-plugin filter — we use it.

#### Q-A3. `output_dependencies` — plugin definition field or sidecar?

**Answer: Inline field on plugin definitions.**

Add `output_dependencies: [{when_param, unpopulated_fields, message}]` directly to action definitions in `lib/plugins/definitions/*-plugin-v2.json`. Treat it as a first-class schema annotation, same status as `x-variable-mapping`.

**Rationale:** sidecar files create a separate maintenance surface and make plugin definitions *not* self-contained. The whole premise of the rebase is "plugin schemas are the source of truth" — splitting the truth across two files contradicts that. The fields are optional and backward-compatible.

#### Q-A4. Removing compiler heuristics — delete immediately or keep as safety net?

**Answer: Keep as logged safety net for one release cycle, then delete.**

When Direction #1 lands, keep the existing compiler heuristics (prefix stripping, alias tables, string replacement) active but add a counter/log every time they fire. Ship Direction #1. Measure: if heuristics stop firing across all regression scenarios for one release, delete them.

**Rationale:** the heuristics are load-bearing for scenarios we may not have tested after Direction #1 lands. Deleting them blind risks regressions. Keeping them logged gives us empirical evidence that they're dead code before we delete. P3 cleanup is the goal, but it's gated on real data, not faith.

#### Q-A5. Overlap with EP key hints work?

**Answer: Harmonize prompt sections before Direction #1 ships.**

EP key hints teach Phase 1 about **inputs** via prefixed config keys (`gmail__search__filter_criteria`). Direction #1 teaches Phase 1 about **outputs** via schema summaries. The two should appear in the same "Plugin Reference" section of the prompt, each action showing:

```
google-mail.search_emails (email/search)
  Inputs:  query (from config key gmail__search__filter_criteria), content_level, ...
  Returns: { emails: array<email>, total_found: number }
  email:   { id, subject, from, date, body, snippet, attachments: array<attachment> }
  ⚠ body/snippet populated only when content_level="full"
```

**Rationale:** today they're separate prompt sections and the LLM has to mentally connect them. Unifying in one place per action reduces cognitive load and makes the full action contract visible at once.

#### Q-A6. Token budget target?

**Answer: ≤ 500 tokens per connected action for summary + coupling + input hints, with a hard cap of 5,000 tokens total for the plugin reference section.**

If the user has 12 connected actions and they average 400 tokens each = ~4,800 tokens. At the hard cap, degrade gracefully:
1. First degrade summary depth from 2 to 1
2. Then drop coupling hints from actions not chosen in `plugins_involved`
3. Finally drop the least-relevant actions entirely (based on `plugins_involved`)

**Rationale:** predictable, measurable, and keeps the Phase 1 prompt reasonable even for users with many plugins. The degradation order preserves the highest-value signals (field names) longest.

---

### Deep Dive B — Runtime AI Output Validation

#### Q-B1. Repair attempt count — 1 or 2?

**Answer: 1 attempt initially; make it configurable; tune with metrics.**

Ship with 1 repair attempt. Surface repair attempts + success/failure counts via `MetricsCollector`. If production shows that attempt-2 would salvage >20% of attempt-1 failures, raise to 2. If attempt-1 salvages <30%, consider dropping to 0 (straight to hard fail — the repair isn't earning its cost).

**Rationale:** one repair is cheap insurance against transient LLM formatting glitches. Beyond that, data-driven. Hardcoding a higher number without evidence wastes tokens.

#### Q-B2. Repair with a stronger/different model?

**Answer: Deferred — not in first ship.**

First ship: same model, same provider, same prompt (plus validation feedback). If metrics show a specific model has a high repair failure rate, *then* add per-model repair strategy as a follow-up.

**Rationale:** keeping repair simple makes the failure mode easy to reason about. Multi-model retry is a multiplier on top of the base mechanism — add after we understand whether the base mechanism is pulling its weight.

#### Q-B3. Array item validation depth.

**Answer: Validate all items for arrays ≤ 50, sample 10 (first 5 + last 5) for larger arrays.**

Full validation for the common case (scatter-gather batches of emails, rows, records are typically < 50). For larger arrays, the 10-sample covers early + late items where batch-processing bugs cluster (serialization of first, truncation of last).

**Rationale:** per-item validation is O(n) — for arrays of 500+ it becomes a latency cost. Sampling is a practical compromise. Exact numbers tunable if we see sampled-through-bugs.

#### Q-B4. Memory-dump garbage handler — silent null-fill or hard fail?

**Answer: Hard fail. Remove the silent null-fill.**

The null-fill was added to keep workflows running when `runAgentKit` returned memory dumps (D-B13). WP-3 has since fixed the root cause (`callLLMDirect` bypasses runAgentKit for ai_processing). The null-fill is now a mask that could hide new regressions.

Replace with a typed error: `AIMemoryDumpError` — a subclass of `SchemaViolationError` with the dump keys in the diagnostic. If D-B13 regresses, we'll see it loudly instead of silently producing null-field-filled outputs.

**Rationale:** the null-fill was a band-aid for a bug that's now fixed. Keeping band-aids after the wound heals hides future wounds. The AliExpress failure is partially downstream of this same "silent continuation" philosophy.

#### Q-B5. Does validation apply to `llm_decision` steps (runAgentKit-backed)?

**Answer: Yes, if the step declares `output_schema`.**

Same rule as `ai_processing`: declaration opts in to validation. `llm_decision` steps with tools/plugins have more varied outputs (tool call results interleaved with text), but if the step author declared an expected output shape, the runtime should honor that contract.

Implementation detail: `executeLLMDecision`'s existing I3 extraction path already runs for both `llm_decision` and `ai_processing`. Wire `AIOutputValidator` in at the same point — both paths benefit.

**Rationale:** the validation rule is tied to the declaration, not the step type. This keeps the rule simple and uniform.

#### Q-B6. Scatter-gather + validation failure interaction.

**Answer: Per-iteration failure, consistent with WP-10.**

If an AI step inside a scatter iteration fails schema validation (after repair attempt), mark that iteration failed and let WP-10's error-filtering path handle aggregation. The scatter continues with remaining successful iterations; the gather output reports `successful_items` / `failed_items` counts.

Exception: if **all** iterations fail validation, fail the scatter step entirely (WP-10's all-failed detection path).

**Rationale:** matches existing WP-10 semantics. Partial progress is better than all-or-nothing when 12 of 14 iterations succeeded.

#### Q-B7. Telemetry for validation catches.

**Answer: Required. Log `ai_output_validation_failed` and `ai_output_validation_repaired` events separately from generic step failures.**

Metrics:
- `ai_output_validation.repair_attempts` (counter)
- `ai_output_validation.repair_succeeded` (counter)
- `ai_output_validation.hard_failures` (counter, by step_id + schema_field_path)
- `ai_output_validation.skipped_no_schema` (counter)

Dashboard: weekly report of hard failures clustered by step → informs whether Direction #1 is doing its job.

**Rationale:** without telemetry we can't tell whether Direction #2 is catching real failures or is silently idle. The counters answer: "is this safety net earning its complexity?"

#### Q-B8. Interaction with Direction #1.

**Answer: Direction #1 reduces Direction #2's catch rate — this is success, not redundancy.**

If Direction #1 works well, LLMs produce shape-correct outputs more often, and Direction #2's repair/fail path fires rarely. That's the desired end state: Direction #2 becomes a silent safety net.

**Action:** treat Direction #2's telemetry as a *proxy metric* for Direction #1's effectiveness. Declining Direction #2 trigger rate = Direction #1 is working.

---

### Deep Dive C — Binder Input-Type Checking

#### Q-C1. `to_type` vocabulary — closed list or open?

**Answer: Canonical closed list with documented extension process.**

Start with ~12 types: `file_attachment`, `folder`, `text_content`, `html_content`, `email`, `email_message`, `message`, `record`, `row`, `spreadsheet_ref`, `url`, `identifier`. Define them in `lib/agentkit/v6/capability-binding/input-type-compat.ts` with descriptions.

Extension process: new type requires (a) definition + compatibility entries in the matrix, (b) reviewer approval, (c) at least one plugin definition using it. This prevents type proliferation while leaving room to grow.

**Rationale:** open vocabularies become dumping grounds. Closed vocabularies with a clear extension process stay coherent and scale with intent.

#### Q-C2. Who maintains the compatibility matrix?

**Answer: Matrix is code-owned for canonical types; plugins can declare their own compatibility for custom types.**

Canonical matrix in `input-type-compat.ts`:

```typescript
export const TYPE_COMPAT: Record<FromType, Set<ToType>> = {
  file_attachment: new Set(['file_attachment', 'file']),
  folder: new Set(['folder', 'folder_ref']),
  text_content: new Set(['text_content', 'string', 'html_content']),
  // ...
};
```

Plugin definitions may declare custom compatibility (rare, opt-in):

```json
"x-variable-mapping": {
  "to_type": "invoice_pdf",
  "compatible_with": ["file_attachment", "file"]
}
```

**Rationale:** canonical matrix is small and stable — code is the right home. Plugin-local extensions (custom types) need plugin-local compatibility declarations or they'd bloat the canonical matrix. Two-tier ownership matches two-tier vocabulary.

#### Q-C3. Backwards compat during annotation rollout.

**Answer: Warn when a check is skipped due to missing annotation.**

When `InputTypeChecker` encounters a param with `from_type` but the source slot has no `to_type`, skip the check but emit a warning: `[InputTypeChecker] Skipped check for ${action}.${param} — source slot ${ref} has no to_type annotation (check coverage incomplete)`.

Track in metrics: `input_type_check.skipped_missing_to_type`. Use the counter to drive plugin-definition annotation priorities — the highest-count skips tell us which plugin outputs to annotate first.

**Rationale:** rollout is incremental. Silence during rollout means we can't see our coverage gap. Warnings surface the gap without breaking anything.

#### Q-C4. Silent candidate swap or loud log?

**Answer: Loud log, structured reason field on the bound step.**

When the top-ranked candidate fails input-type check and the second wins:
- Log at INFO level with both candidates, the violation, and the swap outcome
- Attach swap details to `BoundStep.binding_reason` so the diagnostic is visible in IR output
- Add a structured field `BoundStep.rejected_candidates: Array<{plugin_key, action_name, rejection_reason}>`

**Rationale:** binding decisions drive the whole downstream pipeline. Silent swaps produce mysterious behavior. This is exactly the P6 (unclear ownership of fixes) problem — visible decisions are debuggable decisions.

#### Q-C5. Direction #1 vs Direction #3 — belt-and-braces or redundant?

**Answer: Belt-and-braces, with different failure modes.**

Direction #1 (prompt hint): "*this param requires file_attachment*" — steers LLM intent. Soft guidance, model-dependent.

Direction #3 (binder check): "*source slot's to_type doesn't match from_type*" — enforces at binding. Hard rule, deterministic.

Not redundant because:
- Direction #1 can fail: LLM might ignore the hint, or intent may be ambiguous.
- Direction #3 can't prevent bad intents; it only catches them at binding time.
- When the LLM *does* ignore the hint, Direction #3 prevents the bad binding from reaching runtime.

**Rationale:** the directions act at different layers with different guarantees. Keep both. The cost of Direction #3 is minimal (compatibility matrix lookup), so there's no argument against having both.

#### Q-C6. Rewrite-to-ai_processing — binder or IR converter?

**Answer: IR converter, informed by structured binder diagnostic.**

Binder emits: `binding_method: 'unbound'` + `binding_reason: ['input_type_incompatible']` + `rejected_candidates: [...]`.

IR converter reads this diagnostic and applies a rewriting rule:
- If `kind: "extract"` + unbound due to input-type + source is textual → rewrite as `ai_processing/extract`
- If `kind: "artifact"` + unbound due to input-type → fail with structured error (no sensible AI fallback)

**Rationale:** binder has a single responsibility (decide what can bind). IR converter has a single responsibility (translate to executable IR). Rewriting is a translation decision. Keep responsibilities clean — this is direct mitigation of P6.

---

## Part 4 — Summary Decisions Table

For each answered question, the final position:

| Q | Decision | Impact |
|---|---|---|
| A1 | Summary depth 2 default, per-action override | Token budget control |
| A2 | Only connected-plugin schemas | Simpler, no union lies |
| A3 | Inline in plugin definition | Single source of truth |
| A4 | Keep heuristics logged 1 release, then delete | Evidence-based cleanup |
| A5 | Harmonize with EP key hints in one section | Lower LLM cognitive load |
| A6 | ≤ 500 tok/action, 5K cap, graceful degradation | Predictable cost |
| B1 | 1 repair attempt, metrics-driven tuning | Cheap safety net |
| B2 | Same model/provider for repair (deferred) | Simple first ship |
| B3 | Full validation ≤ 50 items, sample 10 for larger | Balanced perf/correctness |
| B4 | Hard fail memory-dump (remove null-fill) | Remove masks |
| B5 | Validation applies to any step with `output_schema` | Uniform rule |
| B6 | Per-iteration fail; all-failed → scatter fail | Matches WP-10 |
| B7 | Telemetry required | Measurable safety net |
| B8 | Declining Direction #2 rate = Direction #1 working | Proxy metric |
| C1 | Closed canonical vocabulary (~12 types) + extension process | Avoids drift |
| C2 | Code-owned canonical matrix + plugin-local overrides | Two-tier ownership |
| C3 | Warn on skipped checks + counter | Drives rollout |
| C4 | Loud log + structured rejection records | Debuggable |
| C5 | Keep both directions — different guarantees | Defense in depth |
| C6 | Rewriting in IR converter, informed by binder | Single responsibility |

---

## Part 5 — Implementation Sequencing

> **Updated 2026-04-06:** Tactical fixes for WP-11, WP-12, WP-13, WP-14 have landed in the IR converter + runtime. The AliExpress scenario now passes. This **reduces urgency** but does not reduce **value** — the tactical fixes are heuristic-based and pattern-matching-dependent (see updated P3 table). Directions #1–#3 replace them with schema-driven solutions.

Based on dependencies + leverage:

```
Week 1–2:  Direction #1 (Phase 1 schema injection)
           — Foundational: reduces downstream work
           — Ship summary + coupling + input-type hints
           — Seed output_dependencies on google-mail, document-extractor
           — Harmonize with EP key hints prompt section
           — Measure: does IntentContract start emitting correct field names?

Week 2–3:  Direction #3 (Binder input-type checking)
           — Can proceed in parallel with #1
           — Add canonical to_type matrix
           — Annotate google-mail, document-extractor, google-drive outputs
           — Wire InputTypeChecker Phase 2b
           — Once stable: remove IR converter WP-12 heuristics
             (actionExpectsFileAttachment, inputLooksLikeFileAttachment,
              FILE_MARKERS/TEXT_MARKERS sets)

Week 3–4:  Direction #2 (Runtime AI output validation)
           — Independent of #1 and #3
           — AIOutputValidator + SchemaViolationError
           — Replace alias-wrapper fallback + memory-dump null-fill
           — Wire telemetry
           — Interacts with WP-13 empty-input guard (orthogonal: WP-13
             catches empty input; Direction #2 catches wrong-shape output)

Week 4+:   Measure + cleanup
           — Monitor heuristic firing rates (A4)
           — Delete compiler heuristics that stop firing, specifically:
             · WP-11 enforceContentLevelForExtraction (replaced by #1 coupling hints)
             · WP-12 actionExpectsFileAttachment/inputLooksLikeFileAttachment (replaced by #3)
             · WP-2 prefix stripping / alias tables (replaced by #1 schema summaries)
             · WP-14 base64-vs-text heuristic (replaced by #3 to_type annotations)
           — Drive plugin-def annotation priority from C3 telemetry
           — Tune repair attempt count from B1 metrics
```

**Critical path:** Direction #1 first (highest leverage), Direction #3 second (replaces WP-12 heuristics with schema-driven check), Direction #2 third (safety net that benefits from #1 being in place).

**Parallelizable:** #1 and #3 can run in parallel if two developers are available — they touch different phases and don't share files (aside from plugin definitions, where coordination is easy).

**New heuristics to track for eventual removal (added by WP-11–14 fixes):**

| Heuristic | Replacement | Gate for removal |
|---|---|---|
| `enforceContentLevelForExtraction()` | Direction #1 coupling hints | IntentContract consistently sets `content_level=full` when downstream extraction exists |
| `actionExpectsFileAttachment()` + `inputLooksLikeFileAttachment()` | Direction #3 `InputTypeChecker` | Binder rejects file-only actions for text sources at bind time |
| `detectEmptyAIProcessingInput()` | Keep permanently — legitimate runtime guard | N/A (WP-13 is a valid runtime concern, not a Phase 1 fix target) |
| Base64-vs-text heuristic in `shouldUseDeterministicExtraction` | Direction #3 `to_type` annotations | Plugin output schemas declare `to_type: text_content` vs `file_attachment` |
| `isExtractLike` scatter merge branching | Revisit after Direction #2 lands | Schema-aware merge decisions based on declared slot types |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-05 | Initial document | Part 1 bird's-eye problems identified from V6_WORKFLOW_DATA_SCHEMA_DESIGN + weak points catalog. Six structural problems, one common thread, five prioritized directions. Part 2 deep dives pending. |
| 2026-04-05 | Deep Dive A added | Phase 1 Schema Context Injection. Identified the concrete gap (vocabulary injects input_params but not output_schema). Evaluated 4 approaches, recommended B (schema summaries + coupling hints + input-type constraints). Impact map collapses WP-2, WP-4, WP-11, WP-12. Implementation outline + 6 open questions for discussion. |
| 2026-04-05 | Deep Dive B added | Runtime AI Output Validation. Anatomized AliExpress failure (5 validation blind spots). Documented silent fallbacks in current StepExecutor I3 path + alias wrapper + memory-dump null-fill. Proposed AIOutputValidator + SchemaViolationError + 1-repair-attempt pattern. Honest scoping: Direction #2 catches structural LLM misshapes but NOT semantic fabrication ("Unknown X") — that needs trust-metadata propagation (§B.6, scoped out). Impact map, 11-step implementation outline, 8 open questions. |
| 2026-04-05 | Deep Dive C + Parts 3-5 added | Binder Input-Type Checking. Documented how CapabilityBinderV2 ignores `x-variable-mapping.from_type`. Proposed two-phase binding with post-schema input-type checker, symmetric `to_type` annotations on plugin output schemas, canonical closed compatibility vocabulary, and IR-converter rewrite path for text sources → ai_processing/extract. Part 3: consolidated answers to all 20 open questions from A/B/C. Part 4: summary decisions table. Part 5: implementation sequencing (Direction #1 → #3 → #2, parallelizable #1+#3). |
| 2026-04-06 | Post-fix reconciliation | WP-11, WP-12, WP-13, WP-14 fixed tactically in IR converter + runtime (commit c175d49 parent). Updated all sections: P2 table (WP-11 status), P3 heuristic table (+5 new heuristics from WP-11–14), P4 phase ownership table (+WP-13/14), Deep Dive A impact map (WP-11/12 now "tactically fixed, Direction #1 makes heuristic unnecessary"), Deep Dive B AliExpress anatomy (steps 1-2 now fixed), B.5 combination table (+WP-13 row, status column), Deep Dive C impact map (WP-12 updated), Part 5 sequencing (reduced urgency note, heuristic-removal tracking table with gates). Core thesis unchanged: tactical fixes are heuristic-based and add to P3's soup; Directions #1–#3 replace them with schema-driven solutions. |
| 2026-04-07 | Direction #1 implemented (steps 1–7 of 8) | New `outputSchemaSummarizer.ts` (summarize JSON Schema → compact field list, depth-capped to 2 levels, named-type extraction for complex arrays). Extended `PluginActionInfo` with `output_summary` + `output_dependencies`. Vocabulary extractor now pulls output schemas from all plugin definitions. `buildVocabularyInjection()` renders `Returns:` + `⚠` coupling hints per action. Prompt rules added: exact field names from Returns, ⚠ coupling param enforcement, file-only input warning. Seeded `output_dependencies` on `google-mail.search_emails` (content_level coupling) and `document-extractor.extract_structured_data` (file-only input). **Regression: 10/10 passed.** |
| 2026-04-07 | Direction #3 implemented (steps 1–8 of 10) | New `input-type-compat.ts` (canonical FromType/ToType vocabulary, ~12 types, compatibility matrix). New `InputTypeChecker.ts` (validates from_type vs semantic_type at bind time, with heuristic fallback for unannotated schemas). CapabilityBinderV2 retains ranked candidates + Phase 2b validation after DataSchemaBuilder. SchemaField extended with `semantic_type`, propagated from `x-semantic-type` on plugin output schemas. IntentToIRConverter checks `input_type_incompatible` binding reason before WP-12 heuristic fallback. Added `x-semantic-type: "email_message"` and `"file_attachment"` to google-mail search_emails output schema. **Regression: 10/10 passed.** |
| 2026-04-08 | Direction #2 implemented (steps 1–6 of 9) | New `AIOutputValidator.ts` (recursive schema walker, supports both `{properties}` and `{fields[]}` formats, array sampling per Q-B3). `SchemaViolationError` added to `types.ts`. StepExecutor I3 path replaced: `extractValidateAndReturn()` + `handleSchemaFailure()` with 1-repair-attempt pattern. Memory-dump silent null-fill removed — now triggers repair → hard fail. Backward compat preserved for steps without `output_schema`. User-facing error reporting documented as future enhancement (V6_WORKFLOW_DATA_SCHEMA_DESIGN.md §11). **Regression: 10/10 passed.** |
| 2026-04-08 | input-type-compat.ts dedup cleanup | Refactored all hardcoded string sets into atomic building blocks (`FILE_NAMES`, `TEXT_NAMES`, `FILE_PROPERTY_ONLY`, `TEXT_PROPERTY_ONLY`, `OTHER_PRIMARY_PARAMS`). Exported `SEMANTIC_FILE_ATTACHMENT` / `SEMANTIC_TEXT_CONTENT` constants. All composed sets (`FILE_PROPERTY_MARKERS`, `TEXT_PROPERTY_MARKERS`, `FILE_PARAM_NAMES`, `PRIMARY_CONTENT_PARAMS`) derive from building blocks — zero duplicated strings. InputTypeChecker uses constants instead of hardcoded strings. |
| 2026-04-12 | Post-merge annotation gap identified | PR #1 (commit eb22311, merged a0c6c1e) added 7 new plugins (notion, outlook, meta-ads, salesforce, discord, dropbox, onedrive) and rewrote airtable + linkedin — none have `x-semantic-type` or `output_dependencies` annotations. Also overwrote `document-extractor-plugin-v2.json`, wiping its Direction #1 `output_dependencies` block (file-only input warning). **document-extractor restored** from be509d7. New plugin annotations implemented in same session: 7 plugins annotated with `x-semantic-type` on output_schema array items (outlook: email_message/file_attachment/identifier; notion: record; salesforce: record; discord: message/identifier; dropbox: file_attachment/folder/url; onedrive: file_attachment/folder/url). `output_dependencies` added where params conditionally suppress output fields (outlook create_event: online_meeting_url; onedrive download_file: content/size). Airtable + linkedin deferred — require `output_schema` authoring from scratch (only have `output_guidance`/`sample_output`). |
