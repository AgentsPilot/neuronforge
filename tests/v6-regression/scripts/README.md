# V6 Regression — Scenario Authoring Scripts

> **Last Updated**: 2026-06-09

## Overview

Scenario-authoring tools for the V6 regression suite. These build/capture/import
the per-scenario snapshot files under `tests/v6-regression/scenarios/<slug>/`.
**Run all of them from the project root** (paths and `env-preload` assume cwd = repo root).

## Scripts in this folder

| Script | Purpose |
|--------|---------|
| `capture-scenario-from-agent.ts` | **Compile-suite capture.** Full headless run of Phases 0–4 (same as the `/api/v6/generate-ir-intent-contract` route), writing a mutually-consistent `intent-contract.json` + `phase2-data-schema.json` + fresh `phase4-pilot-dsl-steps.json` into `scenarios/<slug>/`. Phase 1 is an LLM call — **review the IC before committing**. Use for Phase A/D regression coverage. |
| `build-phase-e-scenario-from-agent.ts` | **Exact-DB-DSL capture, AS IS.** Captures the agent's EXACT current DB state — `pilot_steps` (DSL) + `agent_configurations.input_values` — into `scenarios/<slug>/` as a `dsl_provided: true` scenario. No LLM, no recompile, no IntentContract. Runs in the suite via Phase D (mocked); runs live via `test-live-agent-execution.ts` (below), which **persists edits back onto the agent in the DB** (DSL → `agents.pilot_steps`, config → `agent_configurations.input_values`). |
| `build-scenario-from-agent.ts` | Lighter seed: writes `enhanced-prompt.json` + the agent's **stored** DSL only. Does not regenerate the IntentContract. Superseded for most uses by the two above. |
| `import-regression-scenarios-as-agents.ts` | Reverse direction — upserts committed `scenarios/` into the DB as runnable agents (so they can be opened/run from the UI). Requires `TEST_USER_ID` in `.env.local`. |

### Two kinds of scenario, both under `scenarios/`

| Kind | Marker | What `run-regression.ts` does | Files |
|------|--------|-------------------------------|-------|
| **IntentContract** (default) | has `intent-contract.json` | Compile (IC→DSL) → Phase A → Phase D | `intent-contract.json`, `enhanced-prompt.json`, `phase2-data-schema.json`, `scenario.json` |
| **DSL-provided** (exact DB DSL) | `scenario.json` → `"dsl_provided": true`, **no** `intent-contract.json` | Skips Compile + Phase A (no IR/data_schema), runs the committed DB DSL through **Phase D** (mocked) | `phase4-pilot-dsl-steps.json`, `phase4-workflow-config.json` (flat `input_values`), `enhanced-prompt.json`, `scenario.json` |

A DSL-provided scenario is **also** runnable live as **Phase E** (real plugins) via `test-live-agent-execution.ts --input-dir scenarios/<slug>`.

## Usage

```bash
# Compile-suite capture from a live agent (Phases 0–4, fresh IC)
npx tsx --import ./scripts/env-preload.ts \
  tests/v6-regression/scripts/capture-scenario-from-agent.ts <agent_id> <scenario_slug>

# Phase-E live capture, AS IS (exact DB DSL + configured inputs, no LLM)
npx tsx tests/v6-regression/scripts/build-phase-e-scenario-from-agent.ts <agent_id> [<slug>]

# Import committed scenarios into the DB as agents
npx tsx --import ./scripts/env-preload.ts \
  tests/v6-regression/scripts/import-regression-scenarios-as-agents.ts [--only <slug>] [--dry-run]
```

After a compile-suite capture: review `intent-contract.json`, then rename
`scenario.json.suggested` to `scenario.json` and refine its metadata by hand.

### Running Phase E (live) on an AS-IS capture

```bash
npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
  --agent-id <agent_id> \
  --input-dir tests/v6-regression/scenarios/<slug>
```

`TEST_USER_ID` in `.env.local` must equal the agent's owner. This **writes the
files to the DB** (DSL → `agents.pilot_steps`, config → `agent_configurations.input_values`)
then executes live with real plugins — outward-facing (real email/API calls).
Edit the files and re-run to change the agent's saved settings.

## Related (NOT in this folder)

The runner and the shared pipeline harnesses it orchestrates live elsewhere because
they are general-purpose (used well beyond regression):

| Path | Role |
|------|------|
| `tests/v6-regression/run-regression.ts` | Suite runner (Compile → Phase A → Phase D across all scenarios). |
| `scripts/test-complete-pipeline-with-vocabulary.ts` | Compile harness (Phases 0–4); invoked by the runner. |
| `scripts/test-dsl-execution-simulator/` | Phase A execution simulator. |
| `scripts/test-workflowpilot-execution.ts` | Phase D real execution. |
| `scripts/env-preload.ts` | Loads `.env.local` before any module import (`--import` hook). |

Run the suite:

```bash
npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts
```
