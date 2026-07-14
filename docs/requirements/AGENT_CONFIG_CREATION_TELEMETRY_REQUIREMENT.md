# Requirement: Agent Creation Telemetry — disposition of `creation_metadata.enhanced_prompt_data`

> **Last Updated**: 2026-07-14

**Created by:** BA
**Status:** Draft
**Related workplan:** [AGENT_CONFIG_DEDUP_AND_MODEL_PROVENANCE_WORKPLAN.md](/docs/workplans/AGENT_CONFIG_DEDUP_AND_MODEL_PROVENANCE_WORKPLAN.md) (§1 Evidence, §2 Scope decisions, §4 Part B, §8 Resolved decisions)

## Overview

The `agents.agent_config` JSONB de-duplication (Part A/A2) removes the duplicated structured enhanced-prompt payload stored at `creation_metadata.enhanced_prompt_data` — it duplicates the canonical `agents.user_prompt` column and has no live reader. This requirement decides **what, if anything, takes its place**: nothing (pure de-dup), or newly captured V6 pipeline run telemetry (`v6_metadata`). It exists because the workplan's approved decision ("reduce to `v6_metadata` only") assumed `v6_metadata` was already being written — it is not, so the disposition must be decided explicitly rather than assumed.

## Background (verified facts)

- **The dropped payload is a true duplicate.** `creation_metadata.enhanced_prompt_data` holds the same `{plan_title, plan_description, sections, specifics}` object that is canonical in the `user_prompt` column (verified on agent `0ee53785`). No live reader consumes it — only the new accessor's legacy fallback, which prefers `user_prompt` anyway.
- **"Keep `v6_metadata`" is moot as written.** Workplan §8 decision #2 says reduce `enhanced_prompt_data` to `v6_metadata` only. But `v6_metadata` (architecture, per-phase timings, total time, grounding confidence, steps generated) is **not written anywhere** in live code today. There is nothing to "keep" — it would have to be newly populated from the V6 response (`v6Data.metadata`), which is available at save time.
- **A sibling provenance block was just added.** Part B added `creation_metadata.models` (provider/model provenance for enhanced-prompt + agent generation). That establishes `creation_metadata` as the home for creation-time provenance/telemetry with no column equivalent.
- **Forward-only.** Existing rows are untouched under every option; this governs only newly created V6 agents.

## Decision

When A2 stops writing the duplicated enhanced-prompt payload at `creation_metadata.enhanced_prompt_data`, do we replace it with newly-captured V6 run telemetry (`v6_metadata`), write nothing, or leave it duplicated?

### Option A — Repurpose to V6 run telemetry (`v6_metadata`)

Stop writing the duplicated payload; newly populate `creation_metadata.v6_metadata` from `v6Data.metadata` at save time.

**Pros**
- Fulfils the already-approved §8 intent ("keep the `v6_metadata` telemetry") correctly, instead of silently dropping it.
- Consistent with Part B's `creation_metadata.models` — same class of creation provenance/telemetry, same home, no column equivalent.
- Per-agent, queryable observability: debug slow / low-confidence generations, product analytics on pipeline performance. Today this exists only transiently in Pino logs.
- Source data is already in hand at save time — low incremental work; no new DB call, no new pipeline instrumentation.

**Cons**
- Slightly more work than dropping.
- Adds a small, always-present object on every new V6 agent row, permanently.
- Goes marginally beyond "pure de-dup" — though it lands the workplan's own approved decision.

### Option B — Drop it (write nothing)

Pure de-dup: omit the field. Timings remain only in Pino logs (ephemeral, not queryable per-agent).

**Pros**
- Smallest change; least storage.
- Strictly within a narrow "de-dup only" reading of scope.

**Cons**
- Departs from the approved §8 decision (which intended to retain telemetry), effectively a silent scope reduction.
- Per-run creation telemetry stays ephemeral in logs — not queryable per agent for debugging or analytics.
- Leaves `creation_metadata` provenance half-built: `models` is captured but pipeline timings/confidence are discarded.

### Option C — Leave it duplicated (no change)

**Pros**
- Zero work.

**Cons**
- Directly contradicts the de-dup goal; keeps a reader-less duplicate of `user_prompt`. **Not recommended.**

## RECOMMENDATION

**Adopt Option A — repurpose `creation_metadata.enhanced_prompt_data` into a newly-populated `creation_metadata.v6_metadata` telemetry object on the V6 path.**

Rationale:
1. **It faithfully lands the already-approved decision.** §8 #2 approved "reduce to `v6_metadata` only." The only reason this is re-opened is the verified fact that `v6_metadata` isn't written yet — so honoring that decision means populating it (A), not silently dropping it (B).
2. **Consistency with Part B.** `models` provenance was just added to `creation_metadata`; `v6_metadata` is the same class of creation-time telemetry with no column. Storing them side by side is coherent; capturing one and discarding the other is not.
3. **Real, low-cost observability.** The payload is available for free at save time (`v6Data.metadata`), so incremental effort is small and adds no DB call. Per-agent queryable timings/confidence have concrete debugging and analytics value that ephemeral logs cannot serve.
4. **Bounded permanence cost.** The stored object is small, forward-only, and only on V6-created agents — a proportionate cost for durable observability.

This is not a genuine business trade-off requiring user escalation: the storage cost is trivial and bounded, the data is already available, and A simply completes the workplan's own approved intent. SA to approve the persisted shape.

### Exact fields to persist if A (V6 path only)

Under `agent_config.creation_metadata.v6_metadata`, sourced from `v6Data.metadata` at save time:

| Field | Source | Notes |
|---|---|---|
| `architecture` | `v6Data.metadata.architecture` | pipeline architecture identifier |
| `phase_times_ms` | `v6Data.metadata.phase_times_ms` | per-phase timings object |
| `total_time_ms` | `v6Data.metadata.total_time_ms` | end-to-end generation time |
| `grounding_confidence` | `v6Data.metadata.grounding_confidence` | grounding phase confidence |
| `steps_generated` | `v6Data.metadata.steps_generated` | count of generated steps |
| `generated_at` | save-time ISO timestamp | mirrors the `models` block convention |

Rules:
- Populate only from the resolved V6 response — do not hardcode or synthesize values; omit any sub-field the response does not provide (graceful null, no throw).
- **V4 / non-V6 paths write nothing** (null/omit) — no equivalent telemetry exists there, matching how Part B sets `agent_generation` null on the V4 branch.
- Do **not** write the structured enhanced-prompt payload — it is dropped; `user_prompt` remains canonical (accessor already handles it).

## Out of Scope

- Backfilling `v6_metadata` onto existing rows (forward-only, consistent with the workplan).
- A dedicated top-level column for telemetry (JSONB `creation_metadata` is the agreed home; revisit only if query volume warrants it).
- ROI / `roi_estimate` disposition (separate BA requirement per workplan §2).

## Open Questions

- [ ] Confirm `v6Data.metadata` exposes all six fields above at page.tsx save time with stable keys (raised by: BA | status: for SA/Dev to verify at implementation). Suggested resolution: if any field is absent, persist the available subset and omit the rest — no schema hard-fail.

## Notes on Integration Points

- **Writer:** `app/v2/agents/new/page.tsx` `createAgent` (V6 branch) — where `creation_metadata.models` is already assembled via `buildCreationModels`; add a parallel `v6_metadata` build alongside it.
- **Source:** V6 generation response `v6Data.metadata`.
- **Reader/accessor:** `lib/agents/agentAiContextView.ts` — unaffected; it reads `enhanced_prompt_data` only as a legacy fallback and prefers `user_prompt`. `v6_metadata` is telemetry, not part of the AiContext view.
- **Types:** the `creation_metadata` builder type in page.tsx (dropped fields already being made optional under A2) — add optional `v6_metadata`.
- **Tests:** extend the A2 / `buildV6AiContext` slim-shape assertions to cover `v6_metadata` populated on V6 create and absent (null/omitted) on V4.

## SA Approval (2026-07-14)

**Reviewed by SA — 2026-07-14**
**Status:** ✅ APPROVE-WITH-CHANGES (Option A adopted; two field changes required before implementation)

Verified against the live save path (`app/v2/agents/new/page.tsx` V6 branch, `V6GenerateResponse.metadata` at L70-87) and the sibling `buildCreationModels` builder — not just the requirement prose.

**Decision 1 — Option A vs B: APPROVE Option A.** Per-agent queryable creation telemetry is worth a small, forward-only JSONB object on V6 agents. The data is already in hand at save time (no new DB call, no new instrumentation), it lands the already-approved workplan §8 #2 intent instead of silently dropping it, and it sits coherently beside the just-added `creation_metadata.models`. Option B would leave `creation_metadata` provenance half-built (models captured, timings discarded). Not a business trade-off requiring user escalation — cost is trivial and bounded.

**Decision 2 — field set: APPROVE with two removals + one omit rule.**
- **REMOVE `generated_at`.** It duplicates the canonical `ai_generated_at` column (a save-time creation timestamp) — the exact class of column/JSONB duplication this workplan exists to eliminate (§1b drops `creation_metadata.ai_generated_at` for precisely this reason). The requirement's stated rationale ("mirrors the `models` block convention") is factually incorrect: `GenerationModelRef` / `buildCreationModels` store only `{provider, model}` — the `models` block carries no per-block `generated_at`. The row's creation instant is already covered by the `ai_generated_at` and `created_at` columns.
- **Do NOT add `plugins_used`.** It duplicates the agent's `plugins_required` column (already written at page.tsx:225 from `metadata.plugins_used`). Same duplication concern.
- **`phase_times_ms`: APPROVE as a generic passthrough of `v6Data.metadata.phase_times_ms`.** Store the object verbatim; do not hardcode or normalise the phase-name keys (they are the pipeline's own phase names — CLAUDE.md "no hardcoding" applies). Storing whatever phases the pipeline reports is the correct generic shape.
- **`grounding_confidence`: OMIT when null/absent** (null for pipeline A). Store no null sub-fields — matches the requirement's own "graceful null, no throw / omit absent" rule.
- **Optionally include `formalization_confidence`** under the identical omit-when-absent rule. It is the same class as `grounding_confidence` (pipeline confidence telemetry with no column) and is free at save time (`metadata.formalization_confidence?`). Non-blocking — include or skip at Dev's discretion.

**Decision 3 — naming/placement: APPROVE `creation_metadata.v6_metadata`.** Keep the name. The content is genuinely V6-pipeline-shaped (a V6 `architecture` id and V6 phase-name keys), so a generic `pipeline_metadata` would mislabel a V6-specific shape. The workplan already fixes `v6_metadata` as the name in its §1c KEEP list and §8; renaming now would desync an approved doc. Because V4/non-V6 writes nothing, the `v6_*` prefix also honestly signals "present only on V6-created agents." Placement beside `creation_metadata.models` is correct (both are no-column creation-time provenance/telemetry).

**Decision 4 — scope: CONFIRMED.** Forward-only, no backfill; V4/non-V6 paths write nothing (null/omit); ROI/`roi_estimate` and any dedicated top-level column stay out of scope (separate requirement). No re-scoping.

**Final shape to implement (V6 path only, sourced from `v6Data.metadata` at save time):**

```jsonc
// agent_config.creation_metadata.v6_metadata  (V6 branch only; V4 writes nothing)
{
  "architecture":   "<metadata.architecture>",
  "total_time_ms":  <number>,
  "phase_times_ms": { /* verbatim passthrough of metadata.phase_times_ms */ },
  "steps_generated": <number>,
  "grounding_confidence":     <number>,  // OMIT when absent/null (null on pipeline A)
  "formalization_confidence": <number>   // OPTIONAL; OMIT when absent/null
}
```
- No `generated_at`, no `plugins_used`.
- Omit any sub-field the response does not provide (graceful null, no throw).
- Build it as a small pure helper alongside `buildCreationModels` (e.g. `buildV6Metadata`), returning `null`/omitting on the V4 branch — mirror the `models` pattern. Add an optional `v6_metadata` field to the `creation_metadata` builder type. Cover populated-on-V6 / absent-on-V4 in the A2 test extension already listed in §Notes.

**Open Question resolution:** the six-field availability check is answered by the code — `V6GenerateResponse.metadata` (page.tsx L70-87) exposes `architecture`, `total_time_ms`, `phase_times_ms`, `steps_generated`, `grounding_confidence?`, `formalization_confidence?`. With `generated_at`/`plugins_used` removed, every remaining field has a stable key; persist the available subset, omit the rest — no schema hard-fail. Close the open question.

Proceed to implementation with the two removals folded in; verify at code review (no requirement re-review needed).

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-14 | Created | Framed the `enhanced_prompt_data` disposition decision; options A/B/C; RECOMMENDATION = A (populate `v6_metadata` telemetry) with exact fields. Routed to SA for approval. |
| 2026-07-14 | SA approval | APPROVE-WITH-CHANGES: adopt Option A; remove `generated_at` (dups `ai_generated_at` column) and drop `plugins_used` (dups `plugins_required` col); omit null confidences; optional `formalization_confidence`; keep `v6_metadata` name; forward-only confirmed. Open question closed against verified code. |
