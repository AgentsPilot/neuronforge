# Effort Estimator

> **Last Updated**: 2026-06-10

## Overview

The **Effort Estimator** is a standalone LLM-driven module in AgentPilot that produces a structured estimate of the manual work-time a customer saves by running each agent. It simulates a small/medium-business (SMB) owner persona, conditioned on the user's role and domain, and writes its output into the existing `agent_config.roi_estimate` JSONB slot consumed by the insights/ROI pipeline. v1 fires automatically once at agent creation (fire-and-forget) and is also exposed as an on-demand API for consumers that detect a missing or stale slot. This document captures the architectural decisions, persona-simulation rationale, model-resolution flow, retry/async behavior, deprecation strategy, and v1 known limitations.

---

## Table of Contents

1. [Purpose](#purpose)
2. [Architecture Overview](#architecture-overview)
3. [Trigger Points](#trigger-points)
4. [Persona Simulation](#persona-simulation)
5. [Model Resolution](#model-resolution)
6. [Retry & Async Pattern](#retry--async-pattern)
7. [Output Schema](#output-schema)
8. [Override Semantics](#override-semantics)
9. [Deprecation Strategy](#deprecation-strategy)
10. [Failure Semantics & Observability](#failure-semantics--observability)
11. [Known v1 Limitations](#known-v1-limitations)
12. [Future Extensions](#future-extensions)
13. [Related Documents](#related-documents)
14. [Change History](#change-history)

---

## Purpose

| Aspect | Detail |
|---|---|
| Business problem | Surface "time saved per run" as a concrete ROI number that AgentPilot can show customers. Without it, the value of running an agent is invisible until users compute it themselves. |
| Where it fits | Sits after V6 agent generation in the agent lifecycle. The estimator is the canonical writer of `agent_config.roi_estimate`. Downstream the slot is read by `MetricsCollector` and aggregated by `BusinessInsightGenerator` into weekly time/cost-saved figures. |
| Out of scope (v1) | USD cost-savings, automatic regeneration on prompt edit, retroactive backfill of existing agents, and UI changes to insights cards. See requirement MD for the full list. |

---

## Architecture Overview

The Effort Estimator lives in its own module so the deprecated logic embedded in `BusinessInsightGenerator` can be retired cleanly.

| File | Purpose |
|---|---|
| `lib/effort-estimator/types.ts` | `ROIEstimate` and supporting interfaces (extracted/adapted from `BusinessInsightGenerator.ts:50-54`). |
| `lib/effort-estimator/promptBuilder.ts` | Builds the LLM prompt from V6 enhanced prompt + persona + user context. |
| `lib/effort-estimator/personaResolver.ts` | Maps `user_context.role` + `user_context.domain` to a named SMB-owner persona. |
| `lib/effort-estimator/retry.ts` | 3-attempt exponential backoff helper (1s / 4s / 16s, 30s budget). |
| `lib/effort-estimator/modelResolver.ts` | DB-driven model resolution from `system_settings_config.effort_estimator_model` via `SystemConfigRepository`, with in-process cache. |
| `lib/effort-estimator/orchestrator.ts` | Top-level entry point: resolves persona + model, builds prompt, invokes provider factory, validates output, writes via `AgentRepository`. |
| `lib/effort-estimator/dispatch.ts` | Single source of truth for the fire-and-forget dispatch pattern used by the create path. |
| `lib/effort-estimator/index.ts` | Barrel export for the public module surface. |

**Output destination:** `agent_config.roi_estimate` — the existing JSONB slot read by `MetricsCollector` (`lib/pilot/MetricsCollector.ts:197-223`) and `BusinessInsightGenerator.calculateROIMetrics` (`lib/pilot/insight/BusinessInsightGenerator.ts:269-333`). Both readers are untouched in this cycle.

**What this replaces:** the inline ROI estimation logic in `lib/pilot/insight/BusinessInsightGenerator.updateAgentROI()` (lines 866-919) — marked `@deprecated` but not deleted in v1. See [Deprecation Strategy](#deprecation-strategy).

---

## Trigger Points

v1 ships with two triggers. Regeneration on prompt edit is deferred to v2 (Open Follow-Up #10 in the requirement MD).

| # | Trigger | Pattern | Where |
|---|---|---|---|
| 1 | Creation | Fire-and-forget, dispatched after `auditLog(AGENT_CREATED)` on the V6 save path. | `app/api/create-agent/route.ts` (calls `dispatchEffortEstimate(...)`) |
| 2 | API on-demand | Synchronous, callable by any consumer (e.g. insights) when `roi_estimate` is missing or stale. | `POST /api/v2/agents/[agentId]/estimate-effort` |

Trigger #1 is intentionally non-blocking: a failure in the estimator must never delay or fail the agent-creation user response. Trigger #2 is intentionally synchronous: the caller wants to know whether the regeneration succeeded so it can surface the freshly written value.

---

## Persona Simulation

The estimator does not ask the LLM "how long does this take?" cold. It conditions the model on a named SMB-owner persona derived from the user's profile so the answer reflects a plausible operator of the agent, not the model's prior.

| Decision | Rationale |
|---|---|
| Persona name source | `user_context.role` + `user_context.domain` from `buildUserContextFromAuth(user)` — the fast path with no DB call (see [USER_CONTEXT.md](/docs/USER_CONTEXT.md)). |
| Fallback | Generic "small/medium business owner" when either field is missing. |
| Persona recorded in `reasoning` | The chosen persona name MUST appear in the `reasoning` output so reviewers can audit whether the model actually adopted it (e.g., "logistics-ops manager", "marketing-agency owner"). |
| Drift detection | `verifyReasoningMentionsPersona()` is a **post-hoc drift detector**, not a hard gate. If the LLM ignores the persona, the estimator logs a WARN with the resolved persona name + first 500 chars of `reasoning` and still persists the result. This is intentional — gating would force retries on every model that paraphrases too aggressively, but we still want to know when it happens. |
| Future direction | Upgrade to `buildUserContextFromProfile` (DB call, richer fields) only if persona quality from auth metadata proves insufficient (Open Follow-Up #7). |

---

## Model Resolution

Model choice is DB-driven so ops can change it without a deploy.

| Step | Detail |
|---|---|
| 1. Read | `system_settings_config.effort_estimator_model` row, accessed via `SystemConfigRepository` (per the repository pattern mandatory rule). |
| 2. Accepted value shapes | Three: `{ provider, model }` object, bare string `"gpt-4o-mini"` (provider inferred), or a JSON-encoded string. The resolver normalizes all three. |
| 3. Fallback | If the row is missing/malformed: default to `{ provider: 'openai', model: 'gpt-4o-mini' }` and log at DEBUG. |
| 4. Invocation | Always through `getProviderFactory()` — no direct SDK calls. |
| 5. Cache | 5-minute in-process cache per cold instance to avoid hammering the config table from concurrent agent creations. |

The resolver reads `system_settings_config.effort_estimator_model` via `SystemConfigRepository.getByKey()` per CLAUDE.md mandatory rule #1 (all DB access goes through the repository layer). The repository absorbs the Supabase access; the resolver retains the 5-minute cache and the three-shape value parser.

**Why a 5-minute cache and not longer:** ops should be able to flip the configured model and see the change reflected within a single coffee break, without restarting Vercel functions. 5 minutes is a deliberate balance between latency and load.

---

## Retry & Async Pattern

### Retry

| Parameter | Value |
|---|---|
| Max attempts | 3 |
| Backoff | Exponential: 1s / 4s / 16s |
| Total budget | 30 seconds (hard cap — if exceeded mid-attempt, the in-flight call is allowed to finish but no further attempts are scheduled) |
| On exhaustion | Leaves `agent_config.roi_estimate` `null`. Never throws upward. Never blocks agent creation. |

**Why 3 attempts (in-attempt, not external retries):** the LLM call is idempotent, the failures we see are almost always transient (provider throttling, 5xx), and the user is waiting for the agent-creation response. Three attempts inside the same dispatch is the simplest way to get the recovery without dragging the operation onto an external queue.

### Async — fire-and-forget on create

| Aspect | Detail |
|---|---|
| Helper | `dispatchEffortEstimate(...)` in `lib/effort-estimator/dispatch.ts` — single source of truth. |
| Shape | IIFE that wraps the dynamic `import()` of the orchestrator and attaches a `.catch()` at the outer layer so any unhandled rejection is logged rather than crashing the route. |
| Why fire-and-forget on create | A non-critical analytic must not delay the agent-creation HTTP response. |
| Why synchronous on the API endpoint | The API caller is asking for a fresh value; they need to know whether the call succeeded. |

### Caveat — Vercel function timeout

Fire-and-forget work on serverless can be terminated when the function's main handler returns. The dispatcher attempts to complete inside the function's timeout budget (default 30s, which matches the estimator's own budget), but in the worst case a retry on the second or third attempt may be killed when the wrapping handler resolves quickly. Flagged for QA observation — if the loss rate is material, v2 should move to a queued job (Open Follow-Up #3-equivalent if surfaced).

---

## Output Schema

The canonical schema lives in the requirement MD. Brief restatement:

| Field | Type | Required | Source |
|---|---|---|---|
| `reasoning` | string | ✅ | LLM output. Must mention persona. |
| `is_bulk_workflow` | boolean | ✅ | LLM output. Explicit, not inferred. |
| `total_manual_time_seconds` | integer | ✅ | LLM output. Per-run figure (averaged for bulk). |
| `confidence` | number 0-1 | ⬜ optional | LLM output. If present, explained in `reasoning`. |
| `generated_at` | ISO timestamp | ✅ | Stamped by estimator at write time. |
| `model` | string | ✅ | Stamped by estimator from the resolved `{ provider, model }`. |
| `version` | string | ✅ | Schema version, currently `"v1"`. |

See [`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md) for the locked-scope schema and validation rules.

---

## Override Semantics

The new path is the canonical writer, so it **always overwrites** an existing `roi_estimate` on a successful run.

| Behavior | Detail |
|---|---|
| When overwriting | Log at INFO with `{ agent_id, previous_total_manual_time_seconds, new_total_manual_time_seconds, reason, correlationId }`. |
| `reasoning` field in logs | Truncated to ~500 chars in the log line. Full payload preserved in the audit trail entry (`EFFORT_ESTIMATE_GENERATED`). |
| Audit trail | Non-blocking via `.catch()` per CLAUDE.md audit pattern. |

The deprecated `updateAgentROI` retains its self-guard so the old and new paths cannot fight each other during the deprecation window — see next section.

---

## Deprecation Strategy

The old inline logic in `BusinessInsightGenerator.updateAgentROI()` is marked `@deprecated 2026-06-10` but **not deleted in v1**.

| Guard | Location | Purpose |
|---|---|---|
| Pre-existing | `lib/pilot/insight/BusinessInsightGenerator.ts:901` | Column-level guard on `agents.manual_time_per_item_seconds`. Stays. |
| New (this cycle) | `lib/pilot/insight/BusinessInsightGenerator.ts:916` | `existingROI` check on `agent_config.roi_estimate` — skips the write when the slot is already populated. Required for AC-4 (no double-writes from the deprecated path). |

**Why no deletion in v1:** one release window of co-existence lets us catch any consumer that relied implicitly on the old path before we tear it out. Final delete/keep decision is Open Follow-Up #1 in the requirement MD.

---

## Failure Semantics & Observability

| Outcome | Signal | HTTP (API path) |
|---|---|---|
| Agent not found | `success === false, attempts === 0` | 404 |
| LLM retries exhausted | `success === false, attempts === 3` | 503 |
| Success | `success === true` | 201 |

| Channel | Detail |
|---|---|
| Logs | Pino structured. ERROR on retry exhaustion carries `{ correlationId, attempts, totalDurationMs, lastErrorMessage }`. INFO on overwrite carries the previous + new `total_manual_time_seconds`. DEBUG on model-resolution fallback. |
| Audit | `EFFORT_ESTIMATE_GENERATED` event (entityType `agent`), non-blocking with `.catch()`. |
| Persona-drift WARN (AC-3) | Logged when `verifyReasoningMentionsPersona` finds neither role nor domain mentioned in `reasoning`. Includes the resolved persona name + first 500 chars of `reasoning`. Does NOT fail the run. |
| Missing slot | Visible via downstream — `MetricsCollector` will simply not have a value to use; consumers that care can call the API endpoint to refresh. |

---

## Known v1 Limitations

| # | Limitation | v1 stance | v2 fix |
|---|---|---|---|
| 1 | **Race on create-then-quick-edit.** Read-modify-write on `agent_config.roi_estimate` means a fast prompt edit during estimator dispatch can lose one of the two writes. | Accept the race. Estimator wins on conflict because it runs after save. | Open Follow-Up #8 — `AgentRepository.mergeAgentConfig` RPC backed by `agent_config = agent_config \|\| patch`. |
| 2 | **No `enhanced_prompt` persistence.** The V6 pipeline produces `enhanced_prompt` in memory but doesn't persist it. On the create dispatch the estimator reads it from the V6 payload. On an API re-trigger the column is empty and the estimator falls back to the raw `user_prompt`, producing a measurably lower-quality estimate. | Documented limitation. | Open Follow-Up #9 — extend the V6 save path to write `enhanced_prompt`. |
| 3 | **No automatic regeneration on prompt edit.** Editing the agent prompt does not refresh `roi_estimate`; the slot becomes stale until a consumer calls the API endpoint. | Descoped. | Open Follow-Up #10 — server-side hook in `PUT /api/agents/[id]` gating on prompt or workflow_steps diff, firing `dispatchEffortEstimate(...)`. |
| 4 | **No USD cost-savings.** Only `total_manual_time_seconds` is computed. | Out of scope. | Open Follow-Up #5 — extend schema with `total_manual_cost_usd` and add cost-rate context to the prompt. |

---

## Future Extensions

| Direction | Notes |
|---|---|
| v2 USD cost-savings | Extend the output schema with `total_manual_cost_usd`; reuse the same prompt, adding a per-role cost-rate context block. |
| v2 automatic regeneration trigger | See Open Follow-Up #10 above. |
| v2 atomic JSONB merge RPC | See Open Follow-Up #8 above — removes the read-modify-write race. |
| v2 enhanced_prompt persistence | See Open Follow-Up #9 above — unlocks high-quality API re-triggers. |
| Persona quality upgrade | If auth-metadata persona proves insufficient, switch to `buildUserContextFromProfile` (Open Follow-Up #7). |

---

## Related Documents

| Document | Purpose |
|---|---|
| [`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md) | Locked scope, ACs, output schema, retry policy, deprecation rules. |
| [`docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md`](/docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md) | Implementation workplan, task list, SA review history. |
| [`docs/USER_CONTEXT.md`](/docs/USER_CONTEXT.md) | Source for persona inputs (`user_context.role`, `user_context.domain`). |
| [`docs/AI_PROVIDER_MODELS.md`](/docs/AI_PROVIDER_MODELS.md) | Model catalogue for `system_settings_config.effort_estimator_model` value picks. |
| [`docs/REPOSITORY_STRATEGY.md`](/docs/REPOSITORY_STRATEGY.md) | Why `modelResolver` reads via `SystemConfigRepository` (CLAUDE.md mandatory rule #1). |
| [`docs/SYSTEM_LOGGING_GUIDELINES.md`](/docs/SYSTEM_LOGGING_GUIDELINES.md) | Pino logging conventions used throughout this module. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-10 | Initial design doc | Written after user code review of the implementation. Captures architecture decisions, persona-simulation rationale, model-resolution flow, retry/async pattern, deprecation strategy, and v1 known limitations. Reflects the descope of the automatic regeneration trigger (Open Follow-Up #10) and the removal of the feature flag from the requirement MD. |
