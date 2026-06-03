# Effort Estimator Requirement

> **Last Updated**: 2026-06-03

**Created by:** BA
**Status:** Draft
**Feature branch:** `feature/effort-estimator`

## Overview

The **Effort Estimator** is a new standalone module that estimates the work-savings (time) a user gains from running an agent in AgentPilot. It simulates a small/medium-business (SMB) owner persona via LLM, using the agent's enhanced prompt / V6 IntentContract output plus `user_context` (domain + role) as inputs. It is triggered automatically after agent creation and after prompt/workflow regeneration, and is also exposed as an API endpoint for on-demand recomputation. Output is written to the existing `agent_config.roi_estimate` slot, which is consumed by the existing insights/ROI pipeline. Cost-savings ($) is explicitly out of scope and reserved as a future extension.

---

## Table of Contents

1. [Goals & Non-Goals](#goals--non-goals)
2. [Trigger Points](#trigger-points)
3. [Output Schema](#output-schema)
4. [Override Behavior](#override-behavior)
5. [Retry Policy](#retry-policy)
6. [Async Behavior](#async-behavior)
7. [Model Selection (DB-Driven)](#model-selection-db-driven)
8. [User Context Source](#user-context-source)
9. [Architectural / Compliance Requirements](#architectural--compliance-requirements)
10. [Insights Pipeline Contract (Existing — For Reference)](#insights-pipeline-contract-existing--for-reference)
11. [Deprecation of Old Path](#deprecation-of-old-path)
12. [Out of Scope](#out-of-scope)
13. [Acceptance Criteria](#acceptance-criteria)
14. [Open Follow-Ups (Post-Release Decisions)](#open-follow-ups-post-release-decisions)
15. [References](#references)
16. [Change History](#change-history)

---

## Goals & Non-Goals

### Goals

| # | Goal |
|---|------|
| 1 | Produce a structured `roi_estimate` for every newly created agent automatically, with no user action required. |
| 2 | Reuse the existing `agent_config.roi_estimate` persistence slot so the existing insights/ROI pipeline (`MetricsCollector`, `BusinessInsightGenerator`) keeps working unchanged. |
| 3 | Provide a callable API for consumers (e.g., insights module) to regenerate the estimate when the slot is missing. |
| 4 | Ensure estimator failures never block agent creation or surface as user errors. |
| 5 | Centralize the LLM persona-simulation logic in one well-named module (`lib/effort-estimator/`) so the deprecated logic in `BusinessInsightGenerator` can be cleanly retired. |

### Non-Goals

| # | Non-Goal |
|---|---------|
| 1 | Computing cost-savings in USD (future extension). |
| 2 | Measuring the user's actual time spent on tasks (this remains an LLM estimate). |
| 3 | Redesigning insights/ROI UI cards. |
| 4 | Backfilling existing agents in production. |
| 5 | Migrating legacy `agents.manual_time_per_item_seconds` data. |

---

## Trigger Points

### In Scope

| # | Trigger | Description |
|---|---------|-------------|
| 1 | Automatic (creation) | Fires after V6 IntentContract has run and the agent is saved to the DB (initial creation). |
| 2 | Automatic (regeneration) | Fires after agent prompt edits / workflow regeneration (same hook point as creation). |
| 3 | API-callable | `POST /api/v2/agents/[id]/estimate-effort` exposes regeneration to any consumer (e.g., the insights module) when `roi_estimate` is missing. Final path subject to Dev/SA confirmation in the workplan. |

### Out of Scope (Deferred)

| # | Deferred Trigger | Reason |
|---|------------------|--------|
| 1 | Workflow re-compilation auto-trigger | MetricsCollector re-fire would cover this in future if needed. |
| 2 | On-demand UI button on agent detail page | API is sufficient for this scope. |
| 3 | Auto re-fire from MetricsCollector at execution start | Consumer is responsible for calling the API if a missing slot is detected. |
| 4 | Render-time re-fire from agent detail page | Deferred. |
| 5 | Background cron job / backfill | Deferred. |

---

## Output Schema

Persisted at `agent_config.roi_estimate`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `reasoning` | string | ✅ | LLM's explanation, including persona used and bulk/per-item assumptions. |
| `is_bulk_workflow` | boolean | ✅ | Explicit flag — NOT inferred from presence of `total_manual_time_seconds`. |
| `total_manual_time_seconds` | number | ✅ | Estimated manual time per workflow run (averaged for bulk cases). |
| `confidence` | string \| number | ⬜ optional | Optional confidence indicator; if present, MUST be explained in `reasoning`. |
| `generated_at` | ISO timestamp | ✅ | When this estimate was written. |
| `model` | string | ✅ | Model name actually used (e.g., `gpt-4o-mini`). |
| `version` | string | ✅ | Schema version (e.g., `"1"`) so future migrations are unambiguous. |

### Persona

- Persona is **"small/medium business owner"** adapted from `user_context.domain` and `user_context.role` when present.
- Falls back to a generic SMB owner when either field is missing.
- The chosen persona name MUST be recorded inside the `reasoning` field for auditing (e.g., "logistics-ops manager", "marketing-agency owner").

### Granularity

- Estimation is at the **full workflow** basis.
- The LLM averages bulk vs. per-item workflows itself and surfaces its assumptions in `reasoning` so the prompt can be calibrated over time.

---

## Override Behavior

This is a behavior change versus the existing path — call it out explicitly.

| Path | Behavior on Existing `roi_estimate` |
|------|-------------------------------------|
| **New Effort Estimator** (this module) | ALWAYS overwrites `agent_config.roi_estimate` when invoked. Logs at INFO level with `{ agent_id, old_value, new_value, reason, correlationId }`. |
| **Deprecated `updateAgentROI`** in `lib/pilot/insight/BusinessInsightGenerator.ts` | KEEPS its existing self-guard (only writes if `roi_estimate` is missing) so the old and new paths do not fight each other during the deprecation window. |

---

## Retry Policy

| Parameter | Value |
|-----------|-------|
| Max attempts | 3 |
| Backoff strategy | Exponential: 1s / 4s / 16s |
| Total budget | 30 seconds |
| On exhaustion | Leave `agent_config.roi_estimate` `null`. Do NOT throw. Do NOT block agent creation. Log the failure with `correlationId`. |

---

## Async Behavior

| Aspect | Behavior |
|--------|----------|
| Invocation from agent-save hook | Fire-and-forget — does NOT block the user's agent-creation UX. |
| Internal retries | Synchronous within the async fire — no external job queue. |
| Failure visibility to user | Silent. Visibility is via structured logs and the missing `roi_estimate` slot itself. |

---

## Model Selection (DB-Driven)

Resolution order:

| Order | Source |
|-------|--------|
| 1 | Read `effort_estimator_model` from `system_settings_config` table. |
| 2 | Fall back to default `gpt-4o-mini` if the row is missing. |
| 3 | Invoke via `getProviderFactory()` — never a hardcoded SDK call. |

Same pattern as `OrchestrationService` / `RoutingService` AIS-based routing.

---

## User Context Source

| Item | Decision |
|------|----------|
| Builder | `buildUserContextFromAuth(user)` (fast path, no DB call) per [USER_CONTEXT.md](/docs/USER_CONTEXT.md). |
| Sparse profile handling | Estimator MUST work with sparse data — omit empty fields from the prompt. |
| Profile upgrade | Upgrade to `buildUserContextFromProfile` only if auth metadata proves insufficient (NOT in v1 scope). |

---

## Architectural / Compliance Requirements

| Status | Requirement |
|--------|-------------|
| ✅ | Repository pattern: all writes go through `AgentRepository`. No direct Supabase calls. See [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md). |
| ✅ | Provider factory: no hardcoded model names. Use `getProviderFactory()`. See [AI_PROVIDER_MODELS.md](/docs/AI_PROVIDER_MODELS.md). |
| ✅ | Zod validation on any new API input. |
| ✅ | Structured Pino logging with `correlationId`. See [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md). |
| ✅ | Audit trail event `EFFORT_ESTIMATE_GENERATED` (entityType `agent`), non-blocking with `.catch()`. |
| ✅ | Feature flag `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR`: ON in dev, OFF in prod until validated. See [feature_flags.md](/docs/feature_flags.md). |
| ✅ | TypeScript strict mode; introduce a typed `ROIEstimate` interface in `lib/effort-estimator/types.ts` (extracted/adapted from `lib/pilot/insight/BusinessInsightGenerator.ts:50-54`). |

### Naming & Locations

| Item | Value |
|------|-------|
| Internal module name | **Effort Estimator** |
| Module path | `lib/effort-estimator/` |
| Persisted slot | `agent_config.roi_estimate` (existing slot — kept as-is) |
| API route (on-demand) | `POST /api/v2/agents/[id]/estimate-effort` (final path subject to Dev/SA confirmation) |
| Audit event | `EFFORT_ESTIMATE_GENERATED` |
| Feature flag | `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` |
| DB config key | `effort_estimator_model` (in `system_settings_config`, default `gpt-4o-mini`) |

---

## Insights Pipeline Contract (Existing — For Reference)

Both readers below remain **untouched** in this cycle.

| Component | Location | Behavior |
|-----------|----------|----------|
| MetricsCollector | `lib/pilot/MetricsCollector.ts:197-223` | Reads `agent_config.roi_estimate` per execution. If `is_bulk_workflow` is true, uses `total_manual_time_seconds` as a flat per-run figure. |
| BusinessInsightGenerator | `lib/pilot/insight/BusinessInsightGenerator.ts:269-333` (`calculateROIMetrics`) | Aggregates 7-day `execution_metrics` into weekly time/cost saved. |

---

## Deprecation of Old Path

In scope, but **no deletion yet**.

| Item | Action |
|------|--------|
| `lib/pilot/insight/BusinessInsightGenerator.ts:866-919` `updateAgentROI()` | Mark `@deprecated` with JSDoc. |
| ROI block embedded in `buildBusinessInsightPrompt` (lines 372-579, specifically 549-577) | Mark with inline comment that it is deprecated and the new Effort Estimator owns this responsibility. |
| Self-guard at line 876 | STAYS so the deprecated path never overwrites the new path's output. |
| Final delete/keep decision | Separate follow-up after one release window. |

---

## Out of Scope

Full explicit list — captured for SA + Dev clarity.

| # | Out-of-Scope Item |
|---|-------------------|
| 1 | Cost-savings in USD (already partially exists in insights pipeline; future extension). |
| 2 | Tracking the user's actual time spent (not measured). |
| 3 | UI redesign of insights / ROI cards. |
| 4 | Retroactive computation for existing agents in production (consumer can call API on demand if needed). |
| 5 | Migration of legacy `agents.manual_time_per_item_seconds` top-level column data into `roi_estimate` (separate cleanup task, not this cycle). |
| 6 | MetricsCollector auto-fire on missing slot (deferred). |
| 7 | Render-time re-fire on agent detail page (deferred). |
| 8 | Cron-based backfill (deferred). |
| 9 | UI button for manual re-estimate (deferred; the API endpoint provides the mechanism). |
| 10 | Final deletion of deprecated `updateAgentROI` writer (post-release decision). |

---

## Acceptance Criteria

- [ ] **AC-1** Given a newly created agent, when V6 IntentContract finishes and the agent is saved, then `agent_config.roi_estimate` is populated within 30s in ≥95% of cases.
- [ ] **AC-2** Given an LLM failure that exhausts retries, when the estimator finishes, then `agent_config.roi_estimate` remains `null` AND a structured error log entry exists with the `correlationId`.
- [ ] **AC-3** Given an agent owner with `user_context.domain` and `user_context.role` populated, when the estimator runs, then the `reasoning` field references the inferred SMB-owner persona by name (e.g., "logistics-ops manager", "marketing-agency owner").
- [ ] **AC-4** Given the deprecated `updateAgentROI` path runs against an agent that already has a fresh `roi_estimate` from the new path, then `updateAgentROI`'s self-guard prevents overwriting the new value.
- [ ] **AC-5** Given a call to `POST /api/v2/agents/[id]/estimate-effort`, when the call succeeds, then `agent_config.roi_estimate` is regenerated and the previous value is logged at INFO level with `{ old_value, new_value, reason, correlationId }`.
- [ ] **AC-6** Given an agent that already had a `roi_estimate`, when the new path writes a new estimate, then the override is logged with old + new values.
- [ ] **AC-7** Given the feature flag `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` is OFF, when an agent is created, then the estimator does NOT fire AND no error is raised.
- [ ] **AC-8** Given the `system_settings_config.effort_estimator_model` row is missing, when the estimator runs, then it falls back to `gpt-4o-mini` AND logs the fallback at DEBUG level.

---

## Open Follow-Ups (Post-Release Decisions)

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | Decide whether to delete or keep the deprecated `updateAgentROI` writer after one release window. | user | ⬜ open (post-release) |
| 2 | Evaluate whether to add UI button on agent detail page for manual re-estimate. | TL | ⬜ deferred |
| 3 | Evaluate auto-re-fire from MetricsCollector when `roi_estimate` is missing at execution start. | SA | ⬜ deferred |
| 4 | Evaluate cron-based backfill for existing agents in production. | SA | ⬜ deferred |
| 5 | Extend module to compute USD cost-savings (currently `total_manual_time_seconds` only). | BA | ⬜ future extension |
| 6 | Migrate legacy `agents.manual_time_per_item_seconds` column data into `roi_estimate`. | Dev | ⬜ separate cleanup task |
| 7 | Upgrade to `buildUserContextFromProfile` if auth metadata proves insufficient for persona quality. | BA | ⬜ pending observation |

### Cycle Plan (FYI — Tracked by TL, Not Authoritative Here)

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Gather requirements (this doc) | BA | ✅ done |
| 2 | Write workplan | Dev | ⬜ next |
| 3 | Review workplan | SA | ⬜ todo |
| 4 | Implement | Dev | ⬜ todo |
| 5 | Code review | SA | ⬜ todo |
| 6 | Test | QA | ⬜ todo |
| 7 | Commit + PR (branch already cut) | RM | ⬜ todo |
| 8 | Mark old `updateAgentROI` deprecated | Dev | ⬜ todo (in implementation step) |
| 9 | Decide: delete or keep deprecated writer | user | ⬜ post-release |

---

## References

- [CLAUDE.md](/CLAUDE.md) — project rules
- [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) — repository pattern
- [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md) — Pino logging standards
- [USER_CONTEXT.md](/docs/USER_CONTEXT.md) — user context module
- [AI_PROVIDER_MODELS.md](/docs/AI_PROVIDER_MODELS.md) — model catalog
- [feature_flags.md](/docs/feature_flags.md) — feature flag conventions

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-03 | Initial draft | BA authored requirement for Effort Estimator feature after 7 clarification turns. Scope locked: automatic + regeneration + API trigger paths; output schema with `reasoning`, `is_bulk_workflow`, `total_manual_time_seconds`, optional `confidence`, `generated_at`, `model`, `version`; always-overwrite behavior on new path; 3-attempt 1s/4s/16s retry with 30s budget; fire-and-forget async; DB-driven model selection with `gpt-4o-mini` fallback; deprecation of `updateAgentROI` (no deletion); feature flag `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` (ON dev / OFF prod). |
