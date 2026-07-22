# Agent Config De-duplication + Model Provenance — Workplan

> **Last Updated**: 2026-07-13
> **Owner**: Dev · **Status**: 🟢 A1 + Part B + A2 implemented (2026-07-14). A1 & Part B SA-reviewed (APPROVE-WITH-NITS). A2 awaiting SA code review, then QA end-to-end → user approval → RM.
> **Related**: [AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md](/docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md) (WP-55 Addendum — the clobber that motivated auditing this column)

## Overview

The `agents.agent_config` JSONB column stores substantial data that **duplicates dedicated top-level columns** on the same row, and the enhanced prompt is stored **three times**. This workplan (a) removes the safe duplicates forward-only, behind a single read accessor, and (b) adds **provider + model provenance** to `creation_metadata` for both the enhanced-prompt generation and the agent generation, so we can track which LLM produced each.

This is a **forward-only** change: no data migration, no touching existing rows. Legacy fat rows keep working via a column-first / JSONB-fallback accessor.

## Table of Contents

1. [Evidence — what is actually duplicated](#1-evidence)
2. [Scope decisions](#2-scope-decisions)
3. [Part A — De-duplication design](#3-part-a--de-duplication-design)
4. [Part B — Model & provider provenance (new)](#4-part-b--model--provider-provenance-new)
5. [Rollout order & safety](#5-rollout-order--safety)
6. [Reader migration checklist](#6-reader-migration-checklist)
7. [Test plan](#7-test-plan)
8. [Resolved decisions](#8-resolved-decisions)
9. [Documentation impact](#9-documentation-impact)
10. [Task checklist](#10-task-checklist)

---

## 1. Evidence

Verified against the live example agent `0ee53785-44d0-4b46-85dd-367551a657ba` (dumps in `c:/tmp/agent-0ee53785-*.json`) and the create/insert code path.

### 1a. The enhanced prompt is stored **three times**

| Location | Shape | Size (example agent) | Source |
|---|---|---|---|
| **`user_prompt` column** | structured object `{plan_title, plan_description, sections, specifics}` | 3783 chars | `JSON.stringify(enhancedPromptData)` — [page.tsx:214-216](/app/v2/agents/new/page.tsx#L214) |
| `creation_metadata.enhanced_prompt_data` | same structured object (+ `v6_metadata` on the V6-server path) | ~same | create-agent / page.tsx |
| `ai_context.enhanced_prompt` | flat rendered **string** | 4333 chars | `builderState.enhancedPrompt` |

**`user_prompt` is the canonical home** (confirmed by owner). The other two are redundant serializations of the same content. Note the top-level `enhanced_prompt` *column* exists in the schema but is **never written** at creation.

### 1b. `ai_context` mirrors dedicated columns (all written at creation)

| `agent_config` field | Canonical column | Written at creation | Verdict |
|---|---|---|---|
| `ai_context.reasoning` | `ai_reasoning` | ✅ [create-agent:172](/app/api/create-agent/route.ts#L172) | drop from JSONB |
| `ai_context.confidence` | `ai_confidence` | ✅ [:173](/app/api/create-agent/route.ts#L173) | drop |
| `ai_context.original_prompt` | `created_from_prompt` | ✅ [:162](/app/api/create-agent/route.ts#L162) | drop |
| `ai_context.generated_plan` | `generated_plan` | ✅ [:169](/app/api/create-agent/route.ts#L169) | drop |
| `ai_context.enhanced_prompt` | `user_prompt` (structured) | ✅ (as `user_prompt`) | drop (derive/keep string via renderer if a reader needs it) |
| `creation_metadata.ai_generated_at` | `ai_generated_at` | ✅ [:174](/app/api/create-agent/route.ts#L174) | drop |
| `creation_metadata.agent_id` | row `id` (PK) | ✅ | drop |

### 1c. Keep — genuinely unique to JSONB

- `ai_context.intent_contract`, `ai_context.data_schema` (WP-55 — no column; this is their only home)
- `creation_metadata`: `session_id`, `thread_id`, `prompt_type`, `version`, `platform_version`, `clarification_answers`, `v6_metadata` (telemetry)
- `roi_estimate.*` (see scope decision below)

---

## 2. Scope decisions

| Item | Decision | Reason |
|---|---|---|
| `ai_context` column-mirrors (1b) | **In scope** — drop forward-only | Clean wins; columns already authoritative |
| `ai_context.enhanced_prompt` + `creation_metadata.enhanced_prompt_data` payload | **In scope** — collapse to `user_prompt` | Owner confirmed `user_prompt` is canonical |
| `creation_metadata.v6_metadata` | **Keep** | Real telemetry (latency, phase times, grounding confidence) with no column |
| `roi_estimate` vs `manual_time_per_item_seconds` | **Out of scope** → separate BA requirement | Different semantics (total vs per-item) + branching consumer in `MetricsCollector`; not a straight dup |
| Backfilling / stripping legacy rows | **Out of scope** | Forward-only; fallback accessor covers legacy |
| Model/provider provenance | **In scope (Part B)** | Owner request |

---

## 3. Part A — De-duplication design

**Principle: the top-level columns (and `user_prompt`) are the source of truth; `agent_config` stores only what has no column.**

### Step A1 — Read accessor (keystone; lands + readers migrate FIRST)

New file `lib/agents/agentAiContextView.ts`:

```ts
import type { Agent } from '@/lib/repositories/types'

export interface AgentAiContextView {
  reasoning: string
  confidence: number
  original_prompt: string
  enhanced_prompt: string        // flat string, rendered from user_prompt if absent in JSONB
  enhanced_prompt_data: unknown  // structured — canonical = user_prompt
  generated_plan: string
  intent_contract: unknown | null
  data_schema: unknown | null
}

/**
 * Canonical read path. Column-first, JSONB-fallback so legacy fat rows and
 * future lean rows return identical data.
 *
 * SA-required (2026-07-13): the param is a `Pick` of the canonical columns, NOT
 * `Partial<Agent>`. `Pick` requires each key to be present on the passed row
 * (value may be null → triggers fallback), so a reader that forgot to widen its
 * `.select()` fails at COMPILE time instead of silently reading empty JSONB and
 * losing data on a lean row. This is the enforced form of the §6 constraint.
 */
type AgentAiContextRow = Pick<
  Agent,
  'ai_reasoning' | 'ai_confidence' | 'created_from_prompt' | 'generated_plan' | 'user_prompt' | 'agent_config'
>
export function getAgentAiContextView(agent: AgentAiContextRow): AgentAiContextView {
  const ac = ((agent.agent_config as any)?.ai_context ?? {}) as Record<string, unknown>
  const structured = parseEnhancedPromptData(agent.user_prompt)
    ?? (agent.agent_config as any)?.creation_metadata?.enhanced_prompt_data
    ?? null
  return {
    reasoning:       agent.ai_reasoning       ?? (ac.reasoning as string)       ?? '',
    confidence:      agent.ai_confidence       ?? (ac.confidence as number)      ?? 0,
    original_prompt: agent.created_from_prompt ?? (ac.original_prompt as string) ?? '',
    generated_plan: (agent.generated_plan as string) ?? (ac.generated_plan as string) ?? '',
    enhanced_prompt: (ac.enhanced_prompt as string) ?? renderEnhancedPrompt(structured) ?? '',
    enhanced_prompt_data: structured,
    intent_contract: ac.intent_contract ?? null,   // JSONB-only
    data_schema:     ac.data_schema ?? null,        // JSONB-only
  }
}
```

Helpers `parseEnhancedPromptData(user_prompt)` (JSON.parse guarded — `user_prompt` may be a raw string on the non-enhanced fallback path) and `renderEnhancedPrompt(structured)` (best-effort flat rendering) live in the same file.

### Step A2 — Slim the writers (forward-only)

- `buildV6AiContext` returns only the orphans: `{ intent_contract, data_schema }` (drop `reasoning`, `confidence`, `original_prompt`, `enhanced_prompt`, `generated_plan`).
- `creation_metadata` builders in `page.tsx` `createAgent`: drop `ai_generated_at` and `agent_id`; replace the full `enhanced_prompt_data` payload with **only `v6_metadata`** (the telemetry that has no column) — the enhanced prompt itself already lives in `user_prompt`.
- Make the dropped fields **optional** on `CreateAgentAIContext` / the metadata type (don't hard-delete — the V4 fallback branch and legacy `SmartAgentBuilder` still emit the fat shape, and that's fine).

**Net:** a new V6 agent's `ai_context` shrinks from 5–7 keys to 2–4 (`intent_contract`, `data_schema`, plus Part B model block); `creation_metadata` sheds the two self-dups and the duplicated enhanced-prompt blob.

Leave the V4 branch + `SmartAgentBuilder` untouched — the accessor covers their legacy shape.

---

## 4. Part B — Model & provider provenance (new)

**Goal:** record which LLM produced (1) the enhanced prompt and (2) the agent, in `creation_metadata`.

### Storage shape

```jsonc
// agent_config.creation_metadata
"models": {
  "enhanced_prompt": { "provider": "openai", "model": "gpt-4o", "generated_at": "2026-07-13T..." },
  "agent_generation": { "provider": "openai", "model": "<resolved>", "generated_at": "2026-07-13T..." }
}
```

### Sources (already available, need surfacing)

| Block | Source | Work required |
|---|---|---|
| `enhanced_prompt.{provider,model}` | `agent_prompt_threads.ai_provider` / `ai_model` — used in [process-message:296-297](/app/api/agent-creation/process-message/route.ts#L296) | Return `ai_provider`/`ai_model` in the Phase-3 response; page.tsx stashes into `creation_metadata.models.enhanced_prompt` |
| `agent_generation.{provider,model}` | ⚠️ **SA-corrected (2026-07-13):** `metadata.provider = config.provider \|\| 'auto'` ([v6 route:215-216](/app/api/v6/generate-ir-intent-contract/route.ts#L215)) reads the **request-body config**, NOT the resolved provider — it defaults to `'auto'` just like `model`. **Both** are wrong today. | **Thread the resolved `{ provider, model }` out of `callLLMJson`** ([generate-intent.ts:30-44](/lib/agentkit/v6/intent/generate-intent.ts)) → `generateGenericIntentContractV1` → route `metadata`. Rule-#5 compliant (read resolved values, no literals). |

### Notes
- Follow CLAUDE.md rule #5 — no hardcoded model names; read the resolved model from the provider factory / generation result, don't string-literal it.
- The V4 / thread path: `enhanced_prompt.model` is the thread's assistant model; `agent_generation.model` is the V4 route's model. Populate symmetrically where those paths persist `creation_metadata`.
- This block has **no column equivalent** — it legitimately belongs in `creation_metadata` (not a new duplicate).

---

## 5. Rollout order & safety

**Order is mandatory:**

1. **A1 accessor + §6 reader migration** ship and verify first. No behavior change (readers now column-first, JSONB-fallback). If this is skipped, lean rows would break readers.
2. **Part B** (additive — new `models` block). Safe to ship anytime; doesn't remove anything.
3. **A2 slim writers** ship last. New agents get lean JSONB.

**Safety:**
- Forward-only — zero migration, existing rows untouched, fallback covers them.
- The one real risk is the reader-`select` constraint (§6): a reader that doesn't `select` the canonical columns will read `undefined` and fall back to empty JSONB on a lean row → silent data loss. Pinned by tests.

---

## 6. Reader migration checklist

Every reader of the redundant fields must (a) call `getAgentAiContextView`, and (b) ensure its Supabase `.select()` includes `ai_reasoning, ai_confidence, created_from_prompt, generated_plan, user_prompt, agent_config`.

- [ ] `lib/calibration/calibrationRcaService.ts:120` — reads `agent_config.ai_context` whole for RCA evidence
- [ ] `scripts/dump-agent-thread.ts:51` — reads `ai_context.original_prompt` / `enhanced_prompt` / `confidence`
- [ ] **Execute** (not just list) an audit of `components/` + `app/v2/agents/[id]` for any UI rendering `ai_context.*` — SA note: this must be run before A2, not deferred
- [ ] `grep` sweep for `ai_context.` and `enhanced_prompt_data` reads before A2 lands
- [ ] Document (release note / UI): non-enhanced agents will render `enhanced_prompt` **empty** going forward (no flat string persisted; render-on-read yields empty when `user_prompt` is a raw prompt)

---

## 7. Test plan

- `getAgentAiContextView` unit tests: (a) lean row → reads columns; (b) legacy fat row with empty columns → reads JSONB; (c) column vs JSONB disagreement → **column wins**; (d) `user_prompt` = raw non-JSON string → no throw, `enhanced_prompt_data` = null.
- `buildV6AiContext.test.ts`: assert slimmed shape (only `intent_contract`/`data_schema` + Part B block); regression that WP-55 fields still persist non-null.
- Part B: assert `creation_metadata.models.{enhanced_prompt,agent_generation}` populated with real (non-`'auto'`) model on a V6 create; provider/model absent → graceful null, no throw.
- Guard test: the migrated readers select the required columns (lint-style assertion or explicit test).
- QA: create one V6 agent end-to-end; verify persisted row has lean `ai_context`, `models` block populated, and the accessor returns identical data to a pre-change legacy row.

---

## 8. Resolved decisions

Owner-confirmed 2026-07-13:

1. **`ai_context.enhanced_prompt` (flat string)** — ✅ **Drop it.** Render on read via `renderEnhancedPrompt(user_prompt)` in the accessor. No writer emits it going forward.
2. **`creation_metadata.enhanced_prompt_data`** — ✅ **Reduce to `v6_metadata` only.** The structured enhanced-prompt payload is dropped (canonical copy lives in `user_prompt`); keep just the `v6_metadata` telemetry sub-object.
3. **ROI (`roi_estimate` vs `manual_time_per_item_seconds`)** — ✅ **Do not touch.** Out of scope entirely; not folded here (separate BA requirement if pursued later).

---

## 9. Documentation impact

Several living docs **document the exact field shape this change alters** — they go stale (or actively mislead) the moment A2 lands. This is coupled to §6: the same fields the RCA method reads are the ones being dropped, so the docs and the reader migration must move together.

### 9a. Must update (living docs describing the shape/method)

| Doc | Why it breaks | Action |
|---|---|---|
| `.claude/skills/agent-creation-rca/SKILL.md` (L104-108) | Evidence table tells RCA to read `ai_context.original_prompt` / `.enhanced_prompt` / `.confidence` — **all dropped**. Method silently breaks on lean agents. | Repoint to canonical columns (`created_from_prompt`, `user_prompt`, `ai_confidence`) or the `getAgentAiContextView` accessor. Note the equivalence they already record (`== agents.user_prompt`). |
| `docs/investigations/AGENT_CREATION_RCA_RUNBOOK.md` (L59-60, L95-98) | Same evidence-table instructions as the skill. | Same repoint. |
| `docs/V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md` (L188-194, L552-557) | Documents the **write shape** of `agent_config` (`original_prompt`, `enhanced_prompt_data`) that A2 slims. | Update the persisted-shape example to the lean shape + `creation_metadata.models` (Part B) + `v6_metadata`-only. |
| `docs/v6/V6_DEVELOPER_GUIDE.md` (L513-576) | WP-55 diagnosis section reads `ai_context.intent_contract`/`data_schema` — **still valid** (KEEP fields), but the surrounding `ai_context` is now lean. | Add a note: `ai_context` now holds only `intent_contract`/`data_schema`; other fields moved to columns; document the new `models` block. |

### 9b. Verify (may reference the shape; confirm at implementation)

- `.claude/skills/calibration-rca/SKILL.md` and `.claude/agents/troubleshooter.md` — reference `ai_context` (mainly `intent_contract`, which is KEPT). Grep for dropped-field reads; update only if present.
- Code doc-strings: `scripts/dump-agent-thread.ts` (L134) and `dump-agent.ts` output descriptions change with the reader migration (§6) — update the printed field list.

### 9c. Do NOT touch (frozen investigation snapshots — historical record)

`docs/investigations/AGENT_RCA_CONCLUSION_*.md` (flatten, ai-extract, sheets-range), `V6_RCA_df67bf69_missing-topic.md`, `EP_PRODUCTION_RCA_HANDOFF_sheets-range.md`, `AGENT_CREATION_RCA_CONCLUSION/HANDOFF_sheets-range.md`. These record what was true at the time; leave them.

### 9d. Standards

- Add a **Change History** row to each doc in 9a per CLAUDE.md Documentation Standards.
- **Sequencing:** the 9a doc updates land **with A2** (the slimming commit), not before — until A2 ships, the old shape is still what new agents get.

## 10. Task checklist

**Part A — de-dup**
- [x] A1: `lib/agents/agentAiContextView.ts` + `parseEnhancedPromptData`/`renderEnhancedPrompt` helpers + unit tests (10 cases, green)
- [x] A1: migrate readers — `calibrationRcaService.ts` (via accessor) + `dump-agent-thread.ts` (accessor + widened `select`); UI audit of `components/` + `app/v2/agents/[id]` **executed → clean** (no reader of the redundant `ai_context.*` fields)
- [x] A2: slimmed `buildV6AiContext` (→ `{intent_contract, data_schema}` only) + V6 `creation_metadata` (dropped `ai_generated_at`/`agent_id`/`enhanced_prompt_data`); dropped fields made optional in types. V4/SmartAgentBuilder left fat (accessor covers them).
- [x] A2: rewrote `buildV6AiContext.test.ts` for the lean shape (6 cases)
- [x] A2 Option A (BA req + SA-approved): added `buildV6Metadata` helper + `creation_metadata.v6_metadata` (V6 telemetry, replaces the dup payload) + `buildV6Metadata.test.ts` (5 cases). Requirement: `docs/requirements/AGENT_CONFIG_CREATION_TELEMETRY_REQUIREMENT.md`
- [x] A2 (A1-review follow-up): reconciled `calibrationRcaService` `evidence.enhancedPrompt` → now `aiContext.enhanced_prompt || agent.enhanced_prompt || null` (was always-null column read)

**Part B — provenance**
- [x] B1: expose resolved provider+model in `v6` route `metadata` — threaded `{provider,model}` out of `callLLMJson` → both intent generators → route (was `'auto'`/`'auto'`). Non-breaking (additive return; all callers destructure a subset).
- [x] B2: return `ai_provider`/`ai_model` from the Phase-3 `process-message` response (`ProcessMessageResponse` extended, set from `threadRecord.ai_provider/ai_model`)
- [x] B3: page.tsx captures enhanced-prompt provenance (`enhancedPromptModelRef`) + writes `creation_metadata.models` via `buildCreationModels` in both V6 (agent_generation from `v6Data.metadata`) and V4 (agent_generation null) branches
- [x] B4: `buildCreationModels` + `__tests__/buildCreationModels.test.ts` (4 cases, green)

**Docs (landed WITH A2 — see §9)**
- [x] Updated `agent-creation-rca` SKILL + `AGENT_CREATION_RCA_RUNBOOK` evidence tables → canonical columns / accessor
- [x] Updated `V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION` — added lean-shape note (models + v6_metadata) after the persisted-shape example
- [x] Updated `V6_DEVELOPER_GUIDE` WP-55 section — noted lean `ai_context` + `models`/`v6_metadata` (SQL unchanged)
- [ ] Verify + update if needed: `calibration-rca` SKILL, `troubleshooter.md`, dump-script output descriptions (at code review)
- [x] Change History / note added to each updated doc

**Standards (SA-required)**
- [ ] Rule #3 logging: `app/v2/agents/new/page.tsx` (touched by A2 + B3) has **49 `console.*`** calls. Surface to owner + propose Pino conversion — with the caveat that this is a `'use client'` component where server-side Pino does not apply, so conversion is its own decision, not an in-line drop-in. This fix adds zero new `console.*`.

**Gates**
- [x] SA review of approach — **APPROVE WITH CHANGES** (2026-07-13); 3 required changes folded into this doc, to be verified at code review
- [ ] QA end-to-end verification
- [ ] User approval → RM commit

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-13 | Created | Initial draft: de-dup design (Part A) + model/provider provenance (Part B), grounded on example agent `0ee53785`. |
| 2026-07-13 | Decisions locked | §8 resolved: drop `ai_context.enhanced_prompt` (render on read); reduce `enhanced_prompt_data` → `v6_metadata` only; ROI out of scope. Routed to SA for approach review. |
| 2026-07-13 | SA changes + docs impact | Folded SA's 3 required changes (Pick-typed accessor, provider also `'auto'`, rule-#3 logging). Added §9 Documentation impact — RCA skill/runbook read the dropped fields, so docs + §6 reader migration must land together with A2. |
| 2026-07-13 | A1 implemented + SA-reviewed | Built `agentAiContextView` accessor (14 tests incl. lean/fat parity) + migrated `calibrationRcaService` & `dump-agent-thread`; UI audit clean. SA code review: APPROVE-WITH-NITS. F1: `Pick` does not hard-enforce column selection (Agent fields optional) — comment corrected, guard is the §6 checklist + parity test. Deferred `evidence.enhancedPrompt` null bug to A2. |
| 2026-07-14 | Part B implemented | B1: resolved provider+model threaded out of `callLLMJson` → intent generators → `v6` route metadata (was `'auto'`). B2: `process-message` returns `ai_provider/ai_model`. B3: `page.tsx` writes `creation_metadata.models` via new `buildCreationModels` (both branches). B4: 4 tests. All 43 affected tests green; tsc clean on touched files. |
| 2026-07-14 | Part B SA-reviewed | APPROVE-WITH-NITS (approved for QA). Nit: pre-existing `console.*` in page.tsx (0 new). |
| 2026-07-14 | Option A decided | `enhanced_prompt_data` reduction: BA requirement → SA APPROVE-WITH-CHANGES. New `creation_metadata.v6_metadata` telemetry (V6 only); dropped `generated_at`/`plugins_used` (column dups); `phase_times_ms` verbatim; omit null confidences. Req: `docs/requirements/AGENT_CONFIG_CREATION_TELEMETRY_REQUIREMENT.md`. |
| 2026-07-14 | A2 implemented + docs | Slimmed `ai_context` (V6) to `{intent_contract,data_schema}`; slimmed V6 `creation_metadata` (dropped ai_generated_at/agent_id/enhanced_prompt_data); added `v6_metadata` (buildV6Metadata). Reconciled `evidence.enhancedPrompt`. Updated the 4 §9a docs. 58/58 affected tests green; tsc clean. |
| 2026-07-14 | A2 SA-reviewed | APPROVE-WITH-NITS (approved for QA). Data-loss check PASSED — every dropped field has a confirmed written column (incl. `generated_plan` = `''` before & after, no regression). `?? undefined` for v6_metadata correct (omits key vs null). Nits all pre-existing/defensive. Next: QA end-to-end (§7). |
| 2026-07-13 | SA review | Approach reviewed — **Approve with Changes**. See `## SA Review (2026-07-13)`. 3 required changes (accessor row-type, Part B provider threading, page.tsx logging standard) + nits. |

---

## SA Review (2026-07-13)

**Reviewed by SA — 2026-07-13**
**Status:** 🔄 Approve with Changes (3 required changes; none architectural — the strategy is sound)

The forward-only + single-read-accessor strategy is the right shape and the phase/root-cause discipline is correct. I verified the accessor targets (`buildV6AiContext.ts`, `CreateAgentAIContext`), the V6 route metadata block, the model-resolution internals in `generate-intent.ts`, the two `ai_context` readers, and `AgentRepository.findById`. Findings below are grounded in that code, not the summary.

### Verified facts that shape the review

- **`AgentRepository.findById` selects `*`** (`lib/repositories/AgentRepository.ts:48`). Both §6 readers reach `agent_config` through `findById` (`calibrationRcaService.ts:81` → `:120`; `scripts/dump-agent-thread.ts`), so **on today's readers the §6 select-hazard does not fire** — they already get every canonical column for free. The real exposure is *future* narrow-`select()` readers (e.g. the summary query at `AgentRepository.ts:144`), not the ones listed. This lowers present risk but does **not** remove the need for a structural guard — see Required Change 1.
- **§6 reader inventory is complete.** A repo-wide grep for `.ai_context` object reads returns exactly the two the plan lists; `enhanced_prompt_data` has no external *reader* (only writers in `page.tsx:1365/1446` + the type). Dropping it is low-risk. Good.
- **`generateGenericIntentContractV1` returns only `{ intent, rawText }`** (`generate-intent.ts:316,382`); provider/model are resolved inside `callLLMJson` (`:30-44`, via `systemConfigRepository.getAgentGenerationConfig()`, defaults `anthropic`/`claude-sonnet-4-5`) and **not returned**. Part B is feasible but requires threading — see Required Change 2.

### Per-focus-item findings

**1. Forward-only + accessor strategy, and the mandatory rollout order — APPROVED.**
Column-first / JSONB-fallback is correct, and the ordering (A1 accessor + all readers migrate → Part B additive → A2 slim writers last) is right and sufficient. The invariant that makes it safe: *no writer may emit a lean row until every reader is column-first*. One ordering hazard the prose implies but doesn't pin: a reader may adopt the accessor yet keep a narrow `select()` that omits the columns — that stays green until A2 lands, then silently breaks. Close it structurally (Required Change 1) rather than by discipline.

**2. Reader-`select()` constraint (§6) — mitigation is NOT strong enough. REQUIRED CHANGE.**
The accessor signature `getAgentAiContextView(agent: Partial<Agent>)` uses the weakest possible type: `Partial<Agent>` type-checks for a row that selected *none* of the canonical columns, so a lean row silently falls through to empty JSONB — exactly the data-loss the plan flags, with zero compile-time signal. A "lint-style guard test" is fragile and easy to under-specify. **Replace `Partial<Agent>` with a required pick** of the canonical source fields, e.g.:
```ts
type AgentAiContextSource = Pick<Agent,
  'ai_reasoning' | 'ai_confidence' | 'created_from_prompt' |
  'generated_plan' | 'user_prompt' | 'agent_config'>
export function getAgentAiContextView(agent: AgentAiContextSource): AgentAiContextView
```
`Pick` requires each key to be *present* (value may still be `null` for legacy/lean fallback), so any caller that forgot to select a canonical column fails at compile time. This converts a silent runtime data-loss into a build error, makes the §6 "widen the select()" step self-enforcing, and lets you delete the brittle guard test. Keep the checklist for the *runtime* audit (does the query actually request the column), but the type is the real guard.

**3. `enhanced_prompt` drop + render-on-read — APPROVED, with one gate.**
`parseEnhancedPromptData` guarding `JSON.parse` on the raw-string fallback path is adequate (raw string → throw caught → `null` → `renderEnhancedPrompt(null)` → `''`). Losing the exact byte-for-byte flat rendering is acceptable because the only consumers are diagnostic (RCA evidence + dump script), not a user-facing or persisted contract — grep confirms no `components/` or `app/v2/agents/[id]` surface renders `ai_context.enhanced_prompt`. **Gate:** the §6 audit checkbox for `components/` + `app/v2/agents/[id]` must be *executed and ticked* before A2 ships, not merely listed. Also note a behavioural change to document: for **non-enhanced** agents going forward, the view's `enhanced_prompt` renders to `''` (no structured `user_prompt`, no stored flat string). Confirm no reader treats empty `enhanced_prompt` as an error; `original_prompt` (from `created_from_prompt`) remains the covering field.

**4. Part B storage + provenance sourcing — location APPROVED; sourcing is wrong for `provider`. REQUIRED CHANGE.**
`creation_metadata.models.{enhanced_prompt, agent_generation}` is the correct home (no column equivalent; genuine telemetry alongside `v6_metadata`). But the table's claim that `agent_generation.provider` is "real today, work required: none" is **incorrect**. `metadata.provider = config.provider || 'auto'` (`v6 route:215`) reads the **request-body** `config`, not the resolved provider — when the V2 UI doesn't pass a provider it records `'auto'`, the same defect as `model`. The resolved provider *and* model both live inside `callLLMJson`. **Thread both out** at the root: have `callLLMJson` return `{ content, provider, model }`, `generateGenericIntentContractV1` return `{ intent, rawText, provider, model }`, and the route set `metadata.provider`/`metadata.model` from that result. This is the correct phase (the phase that owns model resolution) and is rule-#5-compliant (report the resolved value from config/factory; never a literal). Update the §4 table row accordingly.

**5. Scope discipline — APPROVED.** ROI-out is correct (total vs per-item, branching consumer — not a straight dup). Leaving V4/`SmartAgentBuilder` fat is safe *because the shared create-agent insert writes the canonical columns for all paths*, so column-first read wins and any fat JSONB is harmless dead weight; even a hypothetical path that skips the columns degrades gracefully into the JSONB-fallback case the accessor already handles. No inconsistency the accessor can't hide.

**6. Standards.**
- Accessor purity (no Supabase, operates on a fetched row) — correct intent, approved; no new DB access in Part A or B. Good.
- Making dropped `CreateAgentAIContext` fields optional — fine; the accessor's `?? ''`/`?? 0` defaults absorb it. Ensure no non-accessor consumer still assumes the fields are required.
- **Pino logging — REQUIRED CHANGE (process, not code).** `app/v2/agents/new/page.tsx` (touched by A2 + B3) contains **49 `console.*` calls**. Per CLAUDE.md rule #3 you must surface this and propose conversion when you touch the file; the workplan is silent on it. Add an explicit task/decision line: flag the 49 calls and propose conversion, noting the client-component caveat (Pino `createLogger` is server-oriented — the realistic outcome may be a scoped browser logger or a user decision to defer, but it must be *surfaced*, not silently left). `generate-intent.ts`, the v6 route, `process-message`, and `calibrationRcaService` are already `console`-clean — no action there.

### Required changes (must land before "Code Approved")
1. **Accessor row type:** `Partial<Agent>` → `Pick<Agent, ai_reasoning|ai_confidence|created_from_prompt|generated_plan|user_prompt|agent_config>`. Compile-time enforcement of column selection; supersedes the fragile guard test.
2. **Part B provider sourcing:** thread the *resolved* `provider` **and** `model` out of `callLLMJson` → `generateGenericIntentContractV1` → route metadata. Do not source `agent_generation.provider` from request-body `config.provider`. Correct the §4 "work required: none" row.
3. **Logging standard:** add a task to surface the 49 `console.*` calls in `page.tsx` and propose conversion (with client-component caveat) per CLAUDE.md rule #3.

### Nits / optimisation suggestions (non-blocking)
- `generated_plan`: `(agent.generated_plan as string)` — the column may be JSON/object, not a string. Tighten the view type or `String()`-coerce for the rendered field.
- §7 test plan: once Required Change 1 lands, drop the "lint-style guard test" and instead add a negative *type* test (a row missing a column must not compile) or rely on the accessor's typed signature; keep the runtime "column vs JSONB disagreement → column wins" and raw-string cases.
- Confirm `Agent` in `@/lib/repositories/types` actually types all six canonical columns (needed for the `Pick`); if `generated_plan`/`user_prompt` are typed loosely, tighten there.

### Approval
- [x] Approach sound; **conditionally approved** — implement the 3 required changes, then proceed to implementation. No re-review of the workplan needed for the required changes; they will be verified at code review.
- [ ] Blocked / needs re-plan — N/A.

---

## QA Testing Report

**QA — 2026-07-14**
**Test mode:** full (final commit-readiness validation of A1 + Part B + A2)
**Strategy used:** A (Jest unit) + B-static (write-path trace) + type-check regression. No E2E — the persisted shape + LLM plumbing require a running app (client component + live LLM); manual E2E procedure documented below instead of refactoring product code.
**Focus:** api + schema + no-data-loss + provenance
**Skipped:** live E2E (documented as manual procedure — not unit-testable without running app; per task instruction, no product-code refactor to force testability)
**Input source:** parent task instructions + workplan §5/§6/§7

### Test Coverage

| Acceptance Criterion (§7) | Tested? | Result | Notes |
|---|---|---|---|
| Accessor lean row → reads columns | ✅ | Pass | `agentAiContextView.test.ts` "lean row" |
| Accessor legacy fat row → reads JSONB | ✅ | Pass | "legacy fat row falls back" |
| Column-vs-JSONB disagreement → column wins | ✅ | Pass | "column wins when column and JSONB disagree" + confidence-0 `??` case |
| Raw non-JSON `user_prompt` → no throw, `enhanced_prompt_data`=null | ✅ | Pass | dedicated test + `parseEnhancedPromptData` suite |
| **Lean-vs-fat parity (identical output)** | ✅ | Pass | "lean and equivalent fat rows produce IDENTICAL output" — the core invariant |
| `buildV6AiContext` lean shape (only intent_contract+data_schema) | ✅ | Pass | "writes ONLY intent_contract + data_schema" |
| WP-55 fields persist non-null | ✅ | Pass | buildV6AiContext + save-site merge test |
| `buildV6Metadata` excludes generated_at/plugins_used, omits null confidences | ✅ | Pass | 3 assertions confirm exclusion + omission |
| `buildCreationModels` null (not hollow ref) when provenance absent | ✅ | Pass | "nulls a step whose ref is empty/undefined" |
| No-data-loss: every A2-dropped field written to a column | ✅ | Pass (static trace) | see confirmation below |
| Persisted lean shape end-to-end | ⚠️ | Deferred → manual E2E | client + LLM; procedure below |

### Test Output (pasted)

Primary set — `npx jest app/v2/agents/new/__tests__/ lib/agents/__tests__/ lib/calibration/__tests__/`:
```
Test Suites: 12 passed, 12 total
Tests:       115 passed, 115 total
Time:        5.074 s
```
Regression sweep — `npx jest lib/calibration lib/agents app/v2/agents`:
```
Test Suites: 12 passed, 12 total
Tests:       115 passed, 115 total
Time:        5.048 s
```
(The stderr "db down"/"api down"/"not valid JSON" lines are asserted error-path fixtures in the calibration RCA suite — expected, all suites PASS.)

Type-check — `tsc --noEmit`, filtered to touched files: **zero errors in any of the 11 touched files.** The only hits (`app/api/generate-agent-v2/route.ts`, `route copy.ts`) are **pre-existing and out of scope** — `git diff HEAD` shows neither file is modified by this change, and the type edits are purely additive/widening (fields made optional + new types), which cannot introduce a new consumer error.

### Core-invariant confirmation

`getAgentAiContextView` returns **identical** output for a lean row (columns populated, `ai_context = {intent_contract,data_schema}`) and an equivalent legacy fat row (columns null, everything in `ai_context`). Asserted directly by `agentAiContextView.test.ts:104` via `expect(getAgentAiContextView(lean)).toEqual(getAgentAiContextView(fat))`. Column-wins-on-disagreement is separately asserted (reasoning `??` at :82, and confidence `0` preserved via `??` not `||` at :136). **Confirmed by reading the test — the assertions are real, not stubs.**

### No-data-loss confirmation (static trace, V6 path)

Every field A2 dropped from V6 `agent_config` has a confirmed authoritative column, written at creation:

| Dropped from JSONB | Set in `mapV6ResponseToAgent` (page.tsx) | Persisted in `create-agent/route.ts` insert | Recoverable |
|---|---|---|---|
| `ai_context.reasoning` | `ai_reasoning` (:234) | `:172` | ✅ |
| `ai_context.confidence` | `ai_confidence` (:236) | `:173` | ✅ |
| `ai_context.original_prompt` | `created_from_prompt` (:233) | `:162` | ✅ |
| `ai_context.enhanced_prompt` | `user_prompt` structured JSON (:219) | `:160` (rendered on read) | ✅ |
| `ai_context.generated_plan` | (not set on V6 mapper) → `''` both before & after | `:169` | ✅ no regression (was empty on V6 pre-change too) |
| `creation_metadata.ai_generated_at` | `ai_generated_at` (:237) | `:174` | ✅ |
| `creation_metadata.agent_id` | row `id` (PK) | insert id | ✅ |
| `creation_metadata.enhanced_prompt_data` | `user_prompt` (structured) | `:160` | ✅ |

Nothing dropped is unrecoverable. `v6_metadata` (telemetry) and `models` (provenance) have no column and are legitimately new JSONB — not duplicates.

### Provenance/telemetry shape confirmation

- `buildV6Metadata`: excludes `generated_at` and `plugins_used` (column dups) and `provider` (lives in `models`); omits `grounding_confidence`/`formalization_confidence` when null — all three asserted in `buildV6Metadata.test.ts`.
- `buildCreationModels`: yields `null` (not `{provider:null,model:null}`) when a step's provenance is absent — asserted for the V4 `agentGeneration: null` case and empty-ref cases. V6 wiring sources `agent_generation` from `v6Data.metadata.{provider,model}` (resolved values threaded out of `callLLMJson`, Part B), not request-body config.

### Manual E2E verification procedure (required before/at commit)

Not automatable without a running app + live LLM. Run once:

1. Create a new **V6** agent end-to-end via `/v2/agents/new` (enhanced-prompt path, at least one plugin).
2. In Supabase: `select agent_config, user_prompt, ai_reasoning, ai_confidence, created_from_prompt, ai_generated_at from agents where id = '<new id>';`
3. Assert on `agent_config`:
   - `ai_context` has **exactly** `{ intent_contract, data_schema }` — no `reasoning`/`confidence`/`original_prompt`/`enhanced_prompt`/`generated_plan`.
   - `creation_metadata.models.agent_generation.model` is a **real resolved model** (e.g. `claude-sonnet-4-5`), **not `'auto'`**; `models.enhanced_prompt.{provider,model}` populated from the thread.
   - `creation_metadata.v6_metadata` populated (architecture, total_time_ms, phase_times_ms, steps_generated).
   - **Absent:** `creation_metadata.enhanced_prompt_data`, `creation_metadata.ai_generated_at`, `creation_metadata.agent_id`.
   - Columns populated: `ai_reasoning`, `ai_confidence`, `created_from_prompt`, `ai_generated_at`, `user_prompt` (structured JSON).
4. Call `getAgentAiContextView(newRow)` and confirm its output equals the view of a pre-change legacy fat row for the equivalent logical agent (parity holds on real data).

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None — all builders are pure, no new DB calls (SA-confirmed accessor purity).

#### Edge Cases / Observations (nice to note, non-blocking)
1. **Documented behavior change** (already tracked in §6/§8): non-enhanced agents render `enhanced_prompt` as `''` going forward. Covered by accessor default + release note item. Not a defect.
2. **Pre-existing `console.*` in `page.tsx`** (49 calls) — flagged in §10 Standards; this change adds **zero** new. Client-component Pino caveat noted; owner decision, not a QA blocker.
3. **Out-of-scope pre-existing tsc errors** in `app/api/generate-agent-v2/route.ts` and a stray `route copy.ts` backup — unrelated to this change but worth a separate cleanup ticket (`route copy.ts` should likely be deleted).

### Final Status
- [x] All automatable acceptance criteria pass (115/115 tests green, touched files tsc-clean, core invariant + no-data-loss confirmed).
- [x] One criterion (persisted end-to-end shape) is **not unit-testable** — documented as a manual E2E procedure to run at commit.

**Verdict: PASS-WITH-CAVEATS** — commit-ready. No bugs, no High-severity issues. The single caveat is the manual E2E step above (persisted shape + provenance on a live create), which cannot be unit-verified; the pure builders and the read accessor are fully covered and the write-path trace is statically confirmed lossless.
