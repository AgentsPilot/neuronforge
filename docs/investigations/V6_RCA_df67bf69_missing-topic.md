# V6 Generation RCA — `df67bf69` missing `research_topic.topic` (Part A follow-up)

> **Last Updated**: 2026-07-05
> **Agent**: `df67bf69-c2ec-45e7-8d77-0301caa1ae54` ("Daily Retail Solutions (Israel) Blog Digest Email")
> **Thread**: `2f6607d7-cef8-4699-8341-daa1b51d8a02`
> **Scope**: Pin the EXACT lifecycle phase that dropped the plugin-required `topic` param on compiled
> `step1` (`chatgpt-research/research_topic`), confirm whether it is the same class as the `3fc703fd`
> "Sheet1" fabrication, and name the fix-owner + fix direction.
> **Companion (do NOT redo)**: [AGENT_CALIBRATION_RCA_df67bf69.md](./AGENT_CALIBRATION_RCA_df67bf69.md) —
> the calibration-layer diagnosis (earliest failing step, cascade, "2 empty emails", admin-alert Part B).
> **Sibling class**: [EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md](./EP_PRODUCTION_RCA_CONCLUSION_sheets-range.md)
> + [EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md](../workplans/EP_PRODUCTION_SHEETS_RANGE_FIX_WORKPLAN.md).

## Overview

This is the **Part A generation follow-up** to the concluded calibration RCA. The calibration RCA already
established (and this document does **not** re-litigate): compiled `step1` has `params: {}`, the
plugin-required `topic` was never bound, steps 2-5 cascaded, and **calibration behaved correctly** (honest
failure detection). What was left open was the precise phase attribution — *where* in the lifecycle the
`topic` binding was lost — and whether this is the same defect class as the "Sheet1" case. This document
pins that phase (with confidence), returns an explicit class verdict, and names the fix-owner. It is
**diagnostic only**; no code was changed.

---

## 1. Reported symptom (restated, not re-diagnosed)

Compiled `step1` (`chatgpt-research / research_topic`) has `params: {}`. At runtime the executor rejected the
call (`Topic is required for research`) because `research_topic` declares `required: ["topic"]`
(`topic.minLength = 3`). The single most important input — the **research subject** — was never bound. See
the companion RCA for the full cascade and the empty-email explanation. The sharpened question here: the
topic value is **known in prose everywhere** (original prompt, EP `sections.data`, and even `step1.name` /
`step1.description`) yet appears in **no structured slot**. Which phase dropped it?

---

## 2. Evidence gathered

| # | Source | Command / location | Salient finding |
|---|---|---|---|
| E1 | Compiled DSL | `dump-agent.ts` → `c:/tmp/agent-df67bf69.json` `pilot_steps[0]` | `step1.params = {}`. Yet `step1.name`/`description` = *"Research the web for recent blog posts and news articles about **retail solutions in Israel**, collecting title, URL, source name, and publication date…"* — the topic is in the step's own prose but **not** in `params`. |
| E2 | Plugin definition | `lib/plugins/definitions/chatgpt-research-plugin-v2.json` | `research_topic.parameters.required = ["topic"]`, `topic.minLength = 3`, `topic.maxLength = 500`. `topic` is the **only** required param. |
| E3 | Persisted EP (the plan authored by the creation flow) | `c:/tmp/agent-df67bf69.json` `user_prompt` **and** `c:/tmp/agent-df67bf69-aictx.json` `enhanced_prompt` | `specifics.resolved_user_inputs` = `[user_email, google-mail__send_message__recipients, digest_language, source_scope, max_items, no_repeats_requested]`. **No `topic` / `research_topic__topic` / any entry carrying "retail solutions in Israel".** `user_inputs_required: []`. `services_involved` includes `chatgpt-research`. The topic lives **only** in `sections.data` prose: *"Use web research to find recent and relevant items about 'retail solutions in Israel'."* |
| E4 | Creation thread | `dump-agent-thread.ts df67bf69…` → `c:/tmp/agent-df67bf69-thread.json` | Original prompt already names the subject: *"most 5 relevant blogs related to **Retail solutions in Israel**"*. 7 iterations: Phase 1 narrative → 4 Phase-2 clarifications (q1 source-kind, q2 language, q3 no-repeats, q4 storage) → `phase2_done` → **iter 6 Phase 3 "EP produced"**. **No clarification ever asked for the topic** — correctly, it was already supplied. The topic was known from turn 0. |
| E5 | Intent system prompt | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` §5.5 (L190-261), §6.1 DATA_SOURCE (L267-347) | §5.5 "EP FIDELITY" enumerates filter/format/recipient/scope/language constraint patterns (L214-224) but **no row for the primary search subject/topic** as a required-param binding. §6.1 routes a text search subject into the intent's `query` field (L336, decision tree L343-347), **not** into a required-param-aware payload keyed to the bound action's schema. |
| E6 | IR converter | `lib/agentkit/v6/compiler/IntentToIRConverter.ts` L375-378; L450-458 / L1054-1059 | `step.query` is mapped to `params.query` (L376-377) — **never** to the bound plugin's required `topic`. There IS a required-param validator (L454-458, L1056-1059) that would throw `Missing required parameter 'topic'` — but it only fires when the schema path is taken with a non-empty candidate; a search-intent authored with the subject in `query` yields `params.query`, and nothing populates `topic`. Multiple explicit `effectivePluginKey !== 'chatgpt-research'` carve-outs (L536, L566, L612) exist on the *extract* path (not the direct cause, but they show `chatgpt-research` is special-cased in the converter). |
| E7 | Compiler | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Has a `query_filters → query` fold (L5873) and O16 nullable-to-required **warning-only** detection (L3890-3997), but **no guard that blocks emitting `params: {}` on an action whose plugin declares required params**, and no `query → topic` (search-subject → required-param) mapper. |
| E8 | WP-55 fingerprint | `c:/tmp/agent-df67bf69.json` | `agent_config.ai_context.intent_contract` / `data_schema` = **null/omitted** for this agent — the exact Phase-1 IntentContract emission is **not persisted**, so it cannot be read directly (see §5 confidence caveat). |

> Note on the dump projection: `dump-agent.ts` for this agent returns a projection
> (`pilot_steps`, `input_schema`, `output_schema`, `user_prompt`=the EP plan, `system_prompt`) with no
> `agent_config`; the persisted EP evidence (E3) therefore comes from both the `user_prompt` field and the
> thread's `ai_context.enhanced_prompt` (E4). Both agree exactly.

---

## 3. Earliest failing step + cascade (inherited, not re-diagnosed)

Established by the companion RCA and re-confirmed against the DSL here:

| Step | Action | Outcome | Classification |
|---|---|---|---|
| **step1** | `chatgpt-research/research_topic` | FAILED — `params:{}`, `Topic is required` | **Earliest & only independent failure (root)** |
| step2 | `transform/dedupe` on `{{research_results.key_points}}` by `url` | FAILED — no input data | Cascade **+ independent shape bug** (see §6) |
| step3 | `transform/filter` on `{{unique_results}}` | FAILED — no input data | Cascade **+ independent shape bug** (see §6) |
| step4 | `ai_processing/generate` (asks for Source name + Date columns) | ran empty → `"No data available."` | Cascade **+ phantom-field bug** (see §6) |
| step5 | `google-mail/send_email` | sent empty digest | Cascade side-effect |

---

## 4. The phase-pin (core deliverable)

### 4.1 Where the `topic` binding was lost

The disputed value's journey, traced across the three candidate phases:

| Phase | Did it have the topic? | Did it materialize it into a structured slot? | Verdict |
|---|---|---|---|
| **EP-production (creation chat flow / v16 Phase 3)** | **Yes** — in the original prompt (turn 0) and written into `sections.data` prose | **No** — `resolved_user_inputs` has 6 entries, none is the topic; `user_inputs_required: []`; `research_topic.topic` is a required plugin param that was never surfaced as a structured EP input | **PRIMARY ROOT — the binding was never created here** |
| V6 Phase 1 (IntentContract emission) | Would have received the EP with the topic in prose only | Cannot be read directly (E8: `intent_contract` null). Reasoning from downstream: the subject would land in the step's `query`/summary, not in a payload keyed to `research_topic.topic` | Contributing / unconfirmed — see confidence |
| Phase 2 binder / Phase 3-4 converter+compiler | Received an intent with the subject in `query`/summary, not as a `topic` binding | `query → params.query` (E6 L376), never `→ topic`; no no-empty-params guard (E7) | Contributing — did **not** repair the upstream gap; let `params:{}` through |

**Pin:** the defect **originates at EP-production (the creation chat flow, v16 Phase 3)** — the phase that
authored the structured EP. It failed to **materialize the research subject into `resolved_user_inputs`** as
the input that satisfies `research_topic`'s required `topic`. Every downstream phase then had nothing to bind
`topic` from, and none of them backstopped it: the intent stage would carry the subject only as free-text
`query`/summary; the IR converter maps `query → params.query` (not `→ topic`); and neither the converter's
required-param validator nor the compiler blocked an action step from compiling with `params: {}`.

This is the **same structural gap the Sheet1 workplan already named**: the primary Sheet1 fix is a
**Phase-2 carve-out that asks for required plugin params** (see the workplan's "ask for required plugin
params" carve-out), precisely because required plugin inputs must be surfaced/structured at EP time. Here
that carve-out — had it existed and covered `research_topic.topic` — would have surfaced the topic as a
structured `resolved_user_inputs` entry (it was already supplied, so no question even needed to be asked —
it only needed to be *structured*).

### 4.2 Confidence

| Attribution | Confidence | Basis |
|---|---|---|
| **The EP never structured the topic (EP-production gap)** | **High** | Directly read from two persisted copies of the EP (E3) + the thread (E4). This is deterministic persisted evidence, not inference. |
| **Downstream (Phase 1→4) did not backstop it → `params:{}`** | **High** | Read from the compiled DSL (E1) + the converter/compiler source (E6, E7): `query → params.query`, no `→ topic` mapper, no no-empty-params guard. |
| **The exact V6 Phase-1 IntentContract emission** | **Medium** | `intent_contract`/`data_schema` are null for this agent (E8), so the literal Phase-1 payload cannot be read. A definitive Phase-1 pin would require re-running `/api/v6/generate-ir-intent-contract` on the EP — which is **NON-deterministic** (V6 Phase 1 is an LLM step) and is a fix-testing action, **out of TS scope**. I therefore do **not** over-claim a Phase-1-specific bug; the defensible, evidence-backed root is the **EP-production structuring gap**, with the downstream phases confirmed as non-repairing pass-throughs. |

---

## 5. Class verdict — same class as "Sheet1"? **YES**

**Yes — same class.** Both are: *a required plugin input the user genuinely supplied (in prose) that never
got materialized into structured `resolved_user_inputs`, so the downstream pipeline had no value to bind.*

| Dimension | `3fc703fd` "Sheet1" | `df67bf69` "topic" (this case) |
|---|---|---|
| Required plugin param | `google-sheets` `range` | `chatgpt-research` `research_topic.topic` (`required:["topic"]`) |
| User genuinely supplied it? | Yes (as `gid=0` URL) | **Yes — verbatim in the original prompt** ("Retail solutions in Israel"), even more explicit than Sheet1 |
| Present in EP prose? | Yes (`gid=0`, first tab) | Yes (`sections.data`, and `step1.name`/`description`) |
| Present in structured `resolved_user_inputs`? | **No** | **No** |
| Phase that failed to structure it | Phase 3 EP-production | Phase 3 EP-production |
| Failure **mode** (the one difference) | **Fabricated** a default (`"Sheet1"`) — Phase 3 was *mandated* to emit a value and guessed | **Dropped** entirely (`params:{}`) — the topic wasn't recognized as a structured input at all, so nothing was emitted (not even a guess) |

The only difference is the failure *mode* (fabricate-a-default vs drop-entirely), and that difference is
itself explained by the sibling RCA's mechanics: Sheet1's Phase 3 was pushed to emit *some* value for a slot
it recognized (range), so it guessed; here the research subject was **never recognized as a bindable
required plugin input at all**, so no slot was created and the value simply vanished. Same root gap
(required plugin inputs not surfaced/structured at EP time), two symptoms.

**Implication:** this case should **fold into the EP required-plugin-param cycle** already scoped for
Sheet1 — it is not a new, unrelated bug. The Sheet1 carve-out ("Phase 2/EP must surface required plugin
params") must be generalized so it covers a **search/analysis subject** (`research_topic.topic`), not only
resource identifiers (ranges, folder ids). The anti-fabrication rule from the Sheet1 fix addresses
*fabrication*; a **required-param surfacing rule** is what addresses *dropping* — the two are complementary
halves of the same cycle.

---

## 5A. v15 vs v16 — is the topic-drop a prompt regression? (empirical, added 2026-07-05)

**Question raised:** a v15-era research agent (`25bb9eac-c290-4475-aacf-9360d774d3f3`, created 2026-06-26,
"Daily EV Charger Blogs (Israel)") **did** structure the topic — its EP `resolved_user_inputs` contains
`{"key":"chatgpt-research__research_topic__topic","value":"English-language blog posts about EV chargers in
Israel; …"}`. df67bf69 (v16) did not. Is the drop therefore a v15→v16 regression?

**Method:** replayed df67bf69's exact conversation (thread `2f6607d7…`, iters 0–5 verbatim + the Phase-3
request) through **both** prompt versions via `PromptLoader`, `gpt-5.2`, temp 0.1, 5 runs each, measuring
whether Phase 3 emitted a structured topic entry (`*__topic` key or the subject in a value).

**Result:**

| Prompt | Structured the topic | Note |
|---|---|---|
| **v15** | **4/5 (80%)** | 1 miss |
| **v16** | **3/5 (60%)** | 2 misses |

**Findings:**
- **Not a clean regression, and not "v15 solved it."** Both versions structure the topic *non-deterministically*;
  neither is reliable. The two production agents were single draws on opposite sides of the same coin
  (25bb9eac hit v15's ~80%; df67bf69 hit v16's ~40% miss).
- **v16 is modestly worse (80% → 60%).** The full v15→v16 diff shows the *only* additions relevant here are
  the **AUDIENCE NOTE** (*"Prefer inference and sensible defaults over interrogation … use it silently"*;
  *"avoid jargon: schema, JSON, plugin"*; applies to **every phase**) and the **PACING/CONVERGENCE** rule
  (*"default bias is STOP … Phase 3 owns surfacing ambiguity"*). The `resolved_user_inputs` **structuring rules
  are byte-identical** between v15 and v16. So the modest degradation is attributable to v16's added
  **"be-light / infer-defaults" bias layer**, not a changed structuring rule — the *same* philosophy that
  regressed the Sheet1 asking behavior, here nudging Phase 3 to leave a required input inferred/prose rather
  than materialized.
- **Caveat:** N=5, so the 80-vs-60 effect size is suggestive, not statistically nailed. The load-bearing
  conclusion is qualitative and robust: **prompt-only structuring of a required plugin param is
  non-deterministic in BOTH versions** (≈60–80%), so the fix cannot be "tune the prompt" or "revert to v15" —
  it needs a deterministic downstream layer (see §7). This is the identical lesson to the Sheet1 cycle
  (prompt tuning tops out ~4/6; the guarantee lives in a downstream guard).

---

## 6. Compounding defects — confirmed same layer (V6 generation)

The companion RCA flagged three further defects; the DSL + plugin schema confirm all three are V6-generation
defects in the same broken version, and they **share the topic case's root shape**: the plan was authored
against a **mis-modeled `research_topic` output** that the EP prose invented.

| Defect | DSL evidence | Plugin-schema truth | Root |
|---|---|---|---|
| step2 dedupe wrong source/field | `step2.input = {{research_results.key_points}}`, `dedupe_field: "url"` | `key_points` is `array<string>` (no `url`); the per-item objects live in `sources[]{title,url,snippet}` | Plan deduped the wrong variable — authored against an assumed shape, not the real output schema |
| step3 filter on object | `step3.input = {{unique_results}}` (an object) | `filter` expects an array | Same — shape mismatch inherited from step2's mis-modeling |
| step4 phantom fields | step4 prompt/table columns require **Source (site/publication name)** and **Date (publication date)** | `research_topic.sources[]` exposes only `{title, url, snippet}` — **no source-name, no publication_date** | The EP `sections.data` **promised** *"title, source/site name, URL, and publication date"* (E3) — fields `research_topic` does not return. The plan faithfully implemented the EP's **mis-modeled data contract**. |

**Shared root:** all three trace to the **same EP-production authoring** that (a) dropped the required
`topic` and (b) described a `research_topic` output the plugin does not actually produce (source-name +
publication-date). The plan then honored that fictitious contract. So the compounding defects are **not
independent bugs** — they are the downstream consequence of the same EP-production step authoring a plan
against a mis-modeled `research_topic` capability (its required input and its output schema). This matches
the calibration RCA's "same broken version" grouping (`workflow_hash = ce0f123dfa91`).

---

## 7. Fix-owner + recommended fix direction

| Concern | Fix-owner | Direction |
|---|---|---|
| **Primary — research subject never structured into the EP** | **agent-creation-flow** (v16 Phase 3 / the Phase-2 required-plugin-param carve-out) | Generalize the Sheet1 required-plugin-param surfacing carve-out so that **every required parameter of a bound plugin action** (not just resource identifiers) is surfaced into `resolved_user_inputs` at EP time — including a search/analysis **subject** like `research_topic.topic`. Here the value was already supplied, so no new question is needed; it must simply be **structured** (mapped to a `research_topic__topic` / `topic` key) rather than left prose-only. |
| **Backstop — downstream let `params:{}` through** | **v6-pipeline** (IR converter + ExecutionGraphCompiler) | (a) Map a search-intent `data_source` subject/`query` to the bound action's required text param when the schema names one (schema-driven, not hardcoded to `chatgpt-research`). (b) Add a **no-empty-required-params guard**: never compile an `action`/`data_source` step whose `params` omit a plugin-declared required field — fail the compile (or bind from EP) instead of emitting `params:{}`. This is the generic compiler-optimization class permitted by CLAUDE.md (scales to any plugin). |
| **Compounding — mis-modeled `research_topic` output (step2/3/4)** | **agent-creation-flow** (EP data-contract fidelity) **+ v6-pipeline** (transform-shape correctness) | EP-production must not promise output fields the bound action does not return (`source/site name`, `publication date` are not in `research_topic.sources[]`). The pipeline should ground transform inputs against the real upstream output schema (`sources[]{title,url,snippet}`), not an assumed one. |

### Should it fold into the EP required-plugin-param cycle?

**Yes.** Per §5 this is the same class as Sheet1. The primary fix belongs in — and should be folded into —
the **EP required-plugin-param surfacing cycle** already scoped by the Sheet1 workplan, generalized from
"resource identifiers" to "all required plugin params, including search/analysis subjects." The
**no-empty-required-params compiler guard** is the recommended companion backstop (catches any future
drop deterministically, plugin-agnostically), and should ship with it as defense-in-depth.

### Remediation path

**Full cycle** (BA → workplan → SA → Dev), folded into the existing EP required-plugin-param cycle. Rationale:
it touches the v16 creation prompt (EP structuring), the V6 converter/compiler (backstop guard + subject→
required-param mapping), and needs a regression scenario per the V6 Work Protocol. It is **not** a hotfix —
Phase 3 EP-production and V6 Phase 1 are non-deterministic, so the fix requires prompt/pipeline changes plus
a faithful-replay regression (as the Sheet1 cycle did), not a config toggle.

> Routing is the Team Leader's call: this Part A generation finding → **BA** to fold into the EP
> required-plugin-param requirement/cycle. (The companion RCA's Part B admin-alert config issue remains a
> separate hotfix.)

---

## 8. Honest-failure note

Consistent with the companion RCA: **calibration behaved correctly** (honest failure detection — landed
`needs_review`/`awaiting_fixes`, `passed=false`, surfaced the real earliest failure and even caught the
missing `topic` statically pre-execution via `ConstrainedSemanticValidator`). This document does not change
that verdict; it only pins the **generation-side origin** of the failure calibration honestly detected.

---

## 9. Proposed backlog entries (PROPOSAL ONLY — do not write to the backlog)

Per the CLAUDE.md V6 Work Protocol, this generation defect warrants a WEAK_POINTS entry. **TS only proposes
the text here; TL/Dev own the actual write** to `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`
and `V6_OPEN_ITEMS.md` when the fix lands. This should be tracked **as part of / cross-linked to the
existing EP required-plugin-param (Sheet1) cycle**, not as an unrelated item.

**Proposed WEAK_POINTS.md entry:**

> **WP-XX — Required plugin input supplied in prose but never structured into the EP → `params:{}` at
> compile (topic-drop; sibling of the Sheet1 range case)**
> - **Problem:** For agent `df67bf69`, the user's research subject ("retail solutions in Israel") was
>   supplied verbatim in the original prompt and written into EP `sections.data` prose, but Phase-3
>   EP-production never surfaced it into `resolved_user_inputs` (`user_inputs_required: []`; 6 unrelated
>   entries). Downstream, the subject carried only as `query`/summary; the IR converter maps `query →
>   params.query`, never `→ research_topic.topic`; no compiler guard blocks empty required params. Result:
>   `step1.params = {}`, runtime `Topic is required for research`, steps 2-5 cascade, empty digest emailed.
> - **Evidence:** `dump-agent df67bf69` `step1.params:{}` while `step1.name` contains the topic;
>   `enhanced_prompt.specifics.resolved_user_inputs` has no topic entry; thread `2f6607d7…` shows the topic
>   present from turn 0 and never structured; `chatgpt-research-plugin-v2.json` `research_topic.required=
>   ["topic"]`; `IntentToIRConverter.ts` L376-377 (`query→params.query`), L454-458 required-param validator
>   not reached; `ExecutionGraphCompiler.ts` no no-empty-required-params guard.
> - **Fix shape:** (1) Generalize the Sheet1 required-plugin-param EP carve-out to cover **all** required
>   params of bound actions, including a search/analysis **subject** — structure the already-supplied value
>   into `resolved_user_inputs` (no new question needed). (2) Add a schema-driven map from a data_source
>   search subject/`query` to the bound action's required text param. (3) Add a plugin-agnostic
>   no-empty-required-params compile guard. Also fix the mis-modeled `research_topic` output contract
>   (EP promised `source/site name` + `publication date`; the action returns only
>   `sources[]{title,url,snippet}`), which caused the step2/3/4 shape + phantom-field defects.
> - **Why not caught earlier:** §5.5 EP FIDELITY covers filter/format/recipient/scope/language patterns but
>   has **no pattern row for the primary search subject as a required plugin param**; the pipeline treats a
>   search subject as free-text `query`, disconnected from the bound plugin's required-param schema; and no
>   compile-time guard fails an action step with `params:{}`. The semantic validator did detect it
>   pre-execution, but detection did not gate the compile or the delivery.

**Proposed V6_OPEN_ITEMS.md one-liner:**

> - WP-XX — Required plugin input (search subject `research_topic.topic`) supplied in prose but never
>   structured into the EP → `params:{}` at compile. Same class as Sheet1 range; fold into the EP
>   required-plugin-param cycle. See WEAK_POINTS WP-XX. (agent `df67bf69`)
