# WP-05: Plugin Output Schema Drift Detection

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending implementation session
> **Effort**: ~4–5h
> **Author**: Dev agent

## Problem

A workflow that passed calibration today may fail in production tomorrow because the plugin's API changed. Google adds a field, Slack renames `ts` → `timestamp`, HubSpot deprecates an action's response shape.

Today's calibration is **point-in-time**. After deployment there's no detection — the workflow fails opaquely in production until someone notices.

## Goal

When a plugin's actual response shape differs meaningfully from the shape it had at calibration time, **detect** the drift, **automatically mark the agent as `requires_review`**, and **surface a clear notice**: "Plugin X has changed since this workflow was calibrated. Re-calibrate to ensure it still works."

## Non-goals

- Auto-fixing the drift (impossible without understanding the user's intent).
- Detecting drift in plugin **request** shape (only response).
- Detecting drift in fields the workflow doesn't actually use.

## Design

### D1 — Cache the response shape at calibration time

After a successful calibration run, for each step that called a plugin action, record:

```ts
{
  agent_id,
  plugin_key,
  action_name,
  response_schema: <derived from actual response>,
  calibrated_at: <timestamp>,
}
```

Schema derivation: walk the actual response object, record `{key → type}` recursively. Lightweight (~few hundred bytes per action call).

### D2 — Compare on each subsequent execution

When the same plugin action runs in production, derive the live response schema and compare against the cached one. Only the **fields the workflow actually uses** matter — pull those from the workflow's `{{stepN.field}}` references.

If any used field is missing in the live response, or has a different type → drift detected.

### D3 — Drift policy

| Drift type | Action |
|---|---|
| Used field absent in live response | Mark agent `requires_review`; halt subsequent runs until user re-calibrates |
| Used field type changed (string → array, etc.) | Same — halt + re-calibrate |
| Used field optional in cache, also absent now | Soft-warn only (was already optional) |
| New fields appeared in live response | No-op (workflow doesn't use them) |
| Used field shape unchanged | No-op |

### D4 — Storage

New table `plugin_response_schema_cache`:

```sql
CREATE TABLE plugin_response_schema_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  plugin_key TEXT NOT NULL,
  action_name TEXT NOT NULL,
  step_id TEXT NOT NULL,
  response_schema JSONB NOT NULL,
  used_fields TEXT[] NOT NULL,
  calibrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, step_id)
);

CREATE INDEX idx_plugin_schema_cache_agent ON plugin_response_schema_cache(agent_id);
```

Lifecycle:
- Inserted/updated on successful calibration (the batch route).
- Read on each execution to compare against live response.
- Deleted when agent is deleted (via cascade).

### D5 — Where to derive `used_fields`

Walk the workflow's downstream step configs and find every `{{step_X.path.to.field}}` reference where `step_X` is THIS step. The path components become the "used fields" list. This is the existing `WorkflowValidator.extractVariableReferences` logic — already implemented (Tier 1 Fix #1).

### D6 — How execution detects drift

Two options:

(a) **Inline check** during `StepExecutor.executeAction`: after the plugin returns, derive schema, compare. Pros: deterministic. Cons: per-step overhead.

(b) **Background async check**: after execution, queue a job that compares. Pros: zero hot-path cost. Cons: drift detected one execution late.

Recommend (a) for the first version — overhead is small (one JSON walk per plugin response, typically <5ms). Move to (b) if profiling shows hot-path impact.

When drift detected, halt the current execution with a clear error, mark agent `requires_review`, emit audit event.

## File-by-file changes

| File | Change |
|---|---|
| `lib/pilot/shadow/PluginSchemaCache.ts` | **NEW** — service for derive/compare/store schema operations. |
| `lib/repositories/PluginSchemaCacheRepository.ts` | **NEW** — repository for `plugin_response_schema_cache` table. |
| `supabase/migrations/<date>_create_plugin_schema_cache.sql` | **NEW** — DB migration. |
| `app/api/v2/calibrate/batch/route.ts` | After calibration succeeds, iterate executed steps; for each plugin action, derive + upsert into cache. |
| `lib/pilot/StepExecutor.ts:executeAction` | After plugin call returns, look up cached schema; if present, compare; if drift, throw `SchemaDriftError`. |
| `lib/pilot/types.ts` | Add `SchemaDriftError` class. |
| `lib/pilot/shadow/userFacing.ts` | Translator branch for `SchemaDriftError`. |
| `lib/audit/events.ts` | New event `PLUGIN_SCHEMA_DRIFT_DETECTED`. |
| `lib/pilot/shadow/__tests__/PluginSchemaCache.test.ts` | **NEW** — tests for derive, compare, drift detection. |

## Tests

| # | Case | Expected |
|---|---|---|
| S1 | Calibration runs Gmail `search_emails` → schema cached | Row in `plugin_response_schema_cache` |
| S2 | Production run, same plugin, same response shape | No drift, execution proceeds |
| S3 | Plugin returns same shape PLUS new fields the workflow doesn't use | No drift |
| S4 | Plugin removes a field the workflow uses | `SchemaDriftError`, agent marked `requires_review` |
| S5 | Plugin changes a used field from `string` to `array<string>` | `SchemaDriftError` |
| S6 | Workflow re-calibrated after drift → cache updated, future runs OK | Verify cache row updated |
| S7 | Live response has a used field set to `null` (not absent) | Soft-warn only (field exists, just null) |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Plugins legitimately return `null` for optional fields → false drift | Distinguish "key absent" from "value null". Drift only on absence. |
| R2 | Plugin returns different schema PER-USER (HubSpot custom fields, e.g.) | Cache is per-`(agent_id, step_id)` not per-user. If schemas vary across users, drift detection misfires — accept as a known limitation; document. |
| R3 | Inline check adds latency to every plugin call | Profile after implementation; move to async if >10ms. |
| R4 | Cache growth | Per-agent rows; cascade-delete on agent deletion. Capped naturally. |

## Estimated effort

~4–5 hours.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
