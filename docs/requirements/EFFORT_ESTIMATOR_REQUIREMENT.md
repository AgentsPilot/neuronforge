# Effort Estimator Requirement

> **Last Updated**: 2026-06-11

**Created by:** BA
**Status:** Draft
**Feature branch:** `feature/effort-estimator`

## Overview

The **Effort Estimator** is a new standalone module that estimates the work-savings (time) a user gains from running an agent in AgentPilot. It simulates a small/medium-business (SMB) owner persona via LLM, using the agent's enhanced prompt / V6 IntentContract output plus `user_context` (domain + role) as inputs. It is triggered automatically after agent creation and is also exposed as an API endpoint for on-demand recomputation. Output is written to the existing `agent_config.roi_estimate` slot, which is consumed by the existing insights/ROI pipeline. Cost-savings ($) is explicitly out of scope and reserved as a future extension. Automatic regeneration on prompt edit is deferred to v2 (see Open Follow-Up #10).

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
11. [Integration Test Tooling](#integration-test-tooling)
12. [Deprecation of Old Path](#deprecation-of-old-path)
13. [Out of Scope](#out-of-scope)
14. [Acceptance Criteria](#acceptance-criteria)
15. [Open Follow-Ups (Post-Release Decisions)](#open-follow-ups-post-release-decisions)
16. [References](#references)
17. [Change History](#change-history)

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
| 2 | API-callable | `POST /api/v2/agents/[id]/estimate-effort` exposes regeneration to any consumer (e.g., the insights module) when `roi_estimate` is missing or stale. Final path subject to Dev/SA confirmation in the workplan. |

### Out of Scope (Deferred)

| # | Deferred Trigger | Reason |
|---|------------------|--------|
| 1 | Automatic regeneration on prompt edit / workflow regeneration | Deferred until v2. v1 covers create-time (Trigger #1) and API on-demand (Trigger #2 in revised numbering). Consumers that detect a stale `roi_estimate` after a prompt edit can call the API endpoint to refresh. Future v2: re-add a server-side hook in the `PUT /api/agents/[id]` handler with the Risk #4 gate logic (`agentData.user_prompt !== existingAgent.user_prompt` OR workflow_steps diff). See Open Follow-Up #10. |
| 2 | Workflow re-compilation auto-trigger | MetricsCollector re-fire would cover this in future if needed. |
| 3 | On-demand UI button on agent detail page | API is sufficient for this scope. |
| 4 | Auto re-fire from MetricsCollector at execution start | Consumer is responsible for calling the API if a missing slot is detected. |
| 5 | Render-time re-fire from agent detail page | Deferred. |
| 6 | Background cron job / backfill | Deferred. |

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
| ✅ | TypeScript strict mode; introduce a typed `ROIEstimate` interface in `lib/effort-estimator/types.ts` (extracted/adapted from `lib/pilot/insight/BusinessInsightGenerator.ts:50-54`). |

### Naming & Locations

| Item | Value |
|------|-------|
| Internal module name | **Effort Estimator** |
| Module path | `lib/effort-estimator/` |
| Persisted slot | `agent_config.roi_estimate` (existing slot — kept as-is) |
| API route (on-demand) | `POST /api/v2/agents/[id]/estimate-effort` (final path subject to Dev/SA confirmation) |
| Audit event | `EFFORT_ESTIMATE_GENERATED` |
| DB config key | `effort_estimator_model` (in `system_settings_config`, default `gpt-4o-mini`) |

---

## Insights Pipeline Contract (Existing — For Reference)

Both readers below remain **untouched** in this cycle.

| Component | Location | Behavior |
|-----------|----------|----------|
| MetricsCollector | `lib/pilot/MetricsCollector.ts:197-223` | Reads `agent_config.roi_estimate` per execution. If `is_bulk_workflow` is true, uses `total_manual_time_seconds` as a flat per-run figure. |
| BusinessInsightGenerator | `lib/pilot/insight/BusinessInsightGenerator.ts:269-333` (`calculateROIMetrics`) | Aggregates 7-day `execution_metrics` into weekly time/cost saved. |

---

## Integration Test Tooling

A developer-facing CLI script that runs the Effort Estimator end-to-end against an **existing** agent so the feature can be live-tested without going through the full agent-creation flow. Follows the same convention as the existing V6 regression scripts under `tests/v6-regression/scripts/` (project-standard `tsx`-executed TypeScript entry point with `--`-flag CLI args).

### Purpose

| # | Purpose |
|---|---------|
| 1 | Let engineers (and the user) validate the estimator on a real agent + real LLM + real DB without recreating an agent. |
| 2 | Provide a quick smoke path for pre-release live validation and post-merge spot checks. |
| 3 | Reuse the production code paths exactly — no mocks, no shortcuts — so what the script does on disk is what production does. |

### Location

| Item | Value |
|------|-------|
| Folder | `tests/effort-estimator/` |
| Scripts subfolder | `tests/effort-estimator/scripts/` |
| Entry point | `tests/effort-estimator/scripts/run-on-agent.ts` |

Layout intentionally mirrors `tests/v6-regression/scripts/` so the convention is consistent across V6 and Effort Estimator tooling.

### Invocation

```bash
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> [--dry-run] [--log-dir=<path>]
```

(Final command form — `tsx` vs. `ts-node` vs. project's existing runner — should match whatever the v6-regression scripts use; Dev to confirm during workplan.)

### Inputs

| Flag | Required | Description |
|------|----------|-------------|
| `--agent-id=<uuid>` | ✅ | UUID of an existing agent row in the `agents` table to estimate effort for. |
| `--dry-run` | ⬜ optional | When present, the script runs the estimator and prints the result but does NOT write to `agent_config.roi_estimate`. |
| `--log-dir=<path>` | ⬜ optional | Overrides the default per-run log directory (`tests/effort-estimator/logs/`). Useful for dumping to `/tmp` or a CI artifact directory. See [Per-run Log File](#per-run-log-file). |

### Behavior

1. Loads environment variables via the project's existing convention (`dotenv` — same as v6-regression scripts).
2. Fetches the target agent via `AgentRepository.findById(agent_id, user_id)`, where `user_id` is taken from the **agent row itself** (NOT from a CLI flag — see Safety below).
3. Hydrates an `EffortEstimatorInput` from the agent's stored fields:
   - `agent_id`
   - `user_id`
   - `user_prompt`
   - `enhanced_prompt` (from `agent_config.enhanced_prompt`; falls back to `user_prompt` if absent — see Open Follow-Up #9)
   - `workflow_steps`
4. Builds `user_context` from the `profiles` table via `buildUserContextFromProfile(user)` — the **full path** persona is preferred over the auth fast path for live testing, because the live test is the place where persona quality matters most.
5. Calls `estimateEffort(input, logger)` from the production `lib/effort-estimator/` module.
6. Prints to stdout:
   - The result object: `{ success, estimate, attempts, totalDurationMs, errorReason? }`
   - The override log preview: `{ previous_total_manual_time_seconds, new_total_manual_time_seconds, reason, correlationId }`
7. **Unless `--dry-run`** is set, persists the new estimate to `agent_config.roi_estimate` via the same code path the orchestrator uses (so production override semantics apply: old value logged at INFO, new value written via `AgentRepository`, `EFFORT_ESTIMATE_GENERATED` audit event fires).

### Side Effects

| Mode | DB Write | Logs | Audit Event |
|------|----------|------|-------------|
| Default (no `--dry-run`) | ✅ Writes new `agent_config.roi_estimate` for the agent | ✅ Override log at INFO | ✅ `EFFORT_ESTIMATE_GENERATED` fires |
| `--dry-run` | ❌ No mutation | ✅ Override log preview printed (not persisted) | ❌ Audit event does NOT fire |

### Safety

| # | Rule |
|---|------|
| 1 | Requires real Supabase + AI provider env vars. Fail loud with a clear error if any required env var is missing. |
| 2 | DOES NOT accept an arbitrary `--user-id` override. The script always uses the `user_id` stored on the agent row to prevent accidental cross-tenant testing. |
| 3 | DOES NOT batch — single `--agent-id` per invocation. Loop in the shell if you need to test multiple. |
| 4 | Print a one-line summary at the end (PASS / FAIL + duration + estimate id) for quick visual confirmation. |

### Per-run Log File

Every script execution writes a structured log file to disk capturing the full run trace, so engineers can debug behavioral issues post-hoc (LLM response shape, model resolution path, retry timings, hydrated input, persona drift warnings, audit-event payload, etc.) without re-running.

| Aspect | Behavior |
|--------|----------|
| **Behavior** | Every invocation writes a per-run log file capturing the full run trace — every Pino log line emitted by the script AND every Pino log line emitted by the estimator during the run, plus request/response payloads and errors. |
| **Default location** | `tests/effort-estimator/logs/` — folder is gitignored and created on first run if it does not exist. |
| **File naming** | `run-{ISO-timestamp}-{agentIdShort}.log`, where `agentIdShort` is the first 8 characters of the agent UUID. The timestamp guarantees no overwrite on repeated runs against the same agent. |
| **Format** | **JSON-Lines** — one Pino-formatted JSON record per line. Matches the project's structured logging convention ([SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md)). NOT plain text. |
| **Content** | Every log line emitted by the script and the estimator during the run, plus a synthetic final `RUN_SUMMARY` line: `{ agent_id, dry_run, success, attempts, totalDurationMs, started_at, finished_at, log_file_path }`. |
| **Configurable directory** | `--log-dir=<path>` overrides the default folder. Useful for dumping to `/tmp` or a CI artifact directory. |
| **Dry-run behavior** | The log file is written in BOTH dry-run and live-write modes. Dry-run is exactly where post-run debugging matters most, so the file is mandatory either way. |
| **Console behavior** | UNCHANGED — the user still sees the same console output as before. The log file is **in addition**, not a replacement. |

### Out of Scope (for this tool)

| # | Out-of-Scope Item |
|---|-------------------|
| 1 | Automated assertions — this is a developer-driven live test, not a CI-runnable test. QA's automated tests live elsewhere. |
| 2 | LLM or DB mocking — real calls only. That is the entire point of the tool. |
| 3 | Batch mode / multiple agents per invocation. |
| 4 | UI / dashboard wrapping — CLI only. |

---

## Deprecation of Old Path

In scope, but **no deletion yet**.

| Item | Action |
|------|--------|
| `lib/pilot/insight/BusinessInsightGenerator.ts:866-919` `updateAgentROI()` | Mark `@deprecated` with JSDoc. |
| ROI block embedded in `buildBusinessInsightPrompt` (lines 372-579, specifically 549-577) | Mark with inline comment that it is deprecated and the new Effort Estimator owns this responsibility. |
| Self-guard at line 876 | STAYS so the deprecated path never overwrites the new path's output. |
| Final delete/keep decision | Separate follow-up after one release window. |

- Before the new module ships, extend the existing self-guard at `lib/pilot/insight/BusinessInsightGenerator.ts:884` to also skip writes to `agent_config.roi_estimate` when a value is already present (today the guard at line 876 only protects the top-level `manual_time_per_item_seconds` column, not the nested JSON). This 2-line guard extension is in-scope for the implementing PR and is required for Acceptance Criterion #4 (no double-writes from the deprecated path).

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
| 11 | Automatic regeneration trigger on prompt edit / workflow regeneration (deferred to v2 — see Open Follow-Up #10). |

---

## Acceptance Criteria

- [ ] **AC-1** Given a newly created agent, when V6 IntentContract finishes and the agent is saved, then `agent_config.roi_estimate` is populated within 30s in ≥95% of cases.
- [ ] **AC-2** Given an LLM failure that exhausts retries, when the estimator finishes, then `agent_config.roi_estimate` remains `null` AND a structured error log entry exists with the `correlationId`.
- [ ] **AC-3** Given an agent owner with `user_context.domain` and `user_context.role` populated, when the estimator runs, then the `reasoning` field references the inferred SMB-owner persona by name (e.g., "logistics-ops manager", "marketing-agency owner").
- [ ] **AC-4** Given the deprecated `updateAgentROI` path runs against an agent that already has a fresh `roi_estimate` from the new path, then `updateAgentROI`'s self-guard prevents overwriting the new value.
- [ ] **AC-5** Given a call to `POST /api/v2/agents/[id]/estimate-effort`, when the call succeeds, then `agent_config.roi_estimate` is regenerated and the previous value is logged at INFO level with `{ old_value, new_value, reason, correlationId }`.
- [ ] **AC-6** Given an agent that already had a `roi_estimate`, when the new path writes a new estimate, then the override is logged with old + new values.
- [ ] **AC-7** Given the `system_settings_config.effort_estimator_model` row is missing, when the estimator runs, then it falls back to `gpt-4o-mini` AND logs the fallback at DEBUG level.
- [ ] **AC-8** Given an existing agent_id and the env is configured, when I run `npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid>`, then the estimator hydrates from DB, runs end-to-end against the live LLM, prints the result + override log, writes a per-run JSON-Lines log file to `tests/effort-estimator/logs/run-{ISO-timestamp}-{agentIdShort}.log` (or to `--log-dir` if specified), and (unless `--dry-run`) writes the new estimate to `agent_config.roi_estimate` for that agent.

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
| 8 | `AgentRepository.mergeAgentConfig` RPC for atomic JSONB merge. The Effort Estimator's first write to `agent_config.roi_estimate` uses a read-modify-write pattern (read row → mutate `agent_config` JSON → update row). This is exposed to a race condition if the user edits the agent prompt while the estimator is still running (write-skew loses one of the two updates). v1 mitigation: log + accept the race as a known limitation (estimator wins on conflict because it runs after save). v2 fix: add a Supabase RPC `merge_agent_config(agent_id, patch jsonb)` that performs `UPDATE agents SET agent_config = agent_config \|\| patch WHERE id = ?` atomically, and expose it via `AgentRepository.mergeAgentConfig()`. | TBD | ⬜ post-v1 |
| 9 | Persist V6 `enhanced_prompt` to the `agents` table. The Effort Estimator's prompt builder needs the *enhanced* prompt (rich V6 output), not the raw user prompt. Currently, the V6 pipeline produces `enhanced_prompt` in-memory during agent generation but does not persist it to `agents.enhanced_prompt` — it only writes to other columns. On a fresh estimator dispatch the estimator can read it from the V6 payload, but on a re-trigger (API on-demand or post-prompt-edit) the column is empty and the estimator must fall back to the raw user prompt, which produces a measurably lower-quality estimate. Fix: extend the V6 save path in `app/api/create-agent/route.ts` to write the enhanced prompt into a new (or existing) `agents.enhanced_prompt` column. | TBD | ⬜ blocks accurate re-triggers |
| 10 | **Automatic regeneration trigger on prompt edit (descoped from v1).** When the user edits an agent's prompt or workflow steps, the `roi_estimate` becomes stale. v1 ships without an automatic refresh; v2 should add a server-side hook in `PUT /api/agents/[id]` that gates on `agentData.user_prompt !== existingAgent.user_prompt` OR a workflow_steps diff, then fires the same `dispatchEffortEstimate(...)` helper used by the create path. | TBD | ⬜ post-v1 |

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

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-03 | Initial draft | BA authored requirement for Effort Estimator feature after 7 clarification turns. Scope locked: automatic + regeneration + API trigger paths; output schema with `reasoning`, `is_bulk_workflow`, `total_manual_time_seconds`, optional `confidence`, `generated_at`, `model`, `version`; always-overwrite behavior on new path; 3-attempt 1s/4s/16s retry with 30s budget; fire-and-forget async; DB-driven model selection with `gpt-4o-mini` fallback; deprecation of `updateAgentROI` (no deletion). |
| 2026-06-07 | Locked in deprecation guard fix; added Open Follow-Ups #8, #9 | Following SA review of the workplan, user approved a 2-line guard extension at BusinessInsightGenerator.ts:884 as in-scope, and approved adding Follow-Ups #8 (mergeAgentConfig RPC) and #9 (persist V6 enhanced_prompt) to capture known limitations. |
| 2026-06-10 | Removed feature flag; descoped automatic regeneration trigger | Removed feature flag `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` (not requested by user — was BA addition per project convention). Descoped automatic regeneration trigger on prompt edit to deferred (v2); v1 covers create-time + API on-demand only. AC count drops from 8 to 7 (AC-7 removed, former AC-8 renumbered to AC-7). Added Open Follow-Up #10 referencing the deferred regeneration trigger for v2. |
| 2026-06-11 | Added Integration Test Tooling section + AC-8 | CLI script `tests/effort-estimator/scripts/run-on-agent.ts` lets engineers test the estimator end-to-end against an existing agent without creating a new one. Live LLM call + live DB write (unless `--dry-run`). User-requested for pre-release live validation. |
| 2026-06-11 | Extended Integration Test Tooling: per-run log file output | Each script execution writes a JSON-Lines log file (`tests/effort-estimator/logs/run-{timestamp}-{agentIdShort}.log` by default, configurable via `--log-dir`) capturing the full run trace (every script + estimator log line + synthetic `RUN_SUMMARY`) for post-run debugging. Works in both dry-run and live-write modes. Console output unchanged. AC-8 updated to assert the log file is produced. Inputs table updated to include `--log-dir=<path>` flag. |
