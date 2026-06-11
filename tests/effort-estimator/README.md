# Effort Estimator — Integration Test Tooling

> **Last Updated**: 2026-06-11

Developer-facing CLI tools for live-testing the Effort Estimator module against real agents in a real Supabase + real LLM environment. **Not** a Jest / CI test surface — see `lib/effort-estimator/__tests__/` for those.

## Overview

Today this folder contains one tool:

| Script | Purpose |
|--------|---------|
| `scripts/run-on-agent.ts` | Run the production Effort Estimator end-to-end against an existing agent row. Live LLM call, live DB write (unless `--dry-run`). |

The script follows the same conventions as the V6 regression scripts under `tests/v6-regression/scripts/` — `tsx`-executed TypeScript, `--`-flag CLI args, env loaded from `.env.local`.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js | Whatever the project's `package.json` targets. |
| `.env.local` | At project root. Must contain `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` (the default model resolves to OpenAI per AC-7). Other provider keys are only required if `system_settings_config.effort_estimator_model` points to a non-OpenAI provider. |
| An existing agent row | The script reads `user_id` from the row itself — there is no `--user-id` flag. See [Safety](#safety). |
| Supabase reachability | The script uses the service-role client (`lib/supabaseServer.ts`) for the user-id lookup + auth-user fetch, then drops through the production `AgentRepository` for the real read/write. |

---

## Usage

```bash
# Dry-run: hydrate the input + resolve the model, print everything,
# do NOT call the LLM, do NOT write the DB, do NOT fire the audit event.
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> --dry-run

# Live-write: full end-to-end. Real LLM call + real DB write +
# real EFFORT_ESTIMATE_GENERATED audit event.
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid>
```

Run from the repository root. No `--import` flag, no preload hook, no wrapper — the script self-loads `.env.local` via its first import (see [Env loading](#env-loading) below).

### Env loading

The script self-loads `.env.local` via a co-located bootstrap-import file (`tests/effort-estimator/scripts/_load-env.ts`). That file is the FIRST `import` statement in `run-on-agent.ts`, and it calls `dotenv.config({ path: '.env.local' })` at module-evaluation time. ES modules guarantee static side-effect imports run to completion in source order, so by the time `@/lib/supabaseServer` is imported, `process.env` is already populated and the eagerly-constructed Supabase service-role client picks up its config cleanly.

If you add a new script in this folder that touches Supabase, the LLM provider factory, or any repository, do the same thing: make `import './_load-env'` the very first import. Do NOT extract the dotenv call into a function — it must run at module-evaluation time, not when called. If `.env.local` is missing or unparseable, `_load-env.ts` fails loud with a clear error and exits non-zero (silent fallback to the default `.env` is worse than failing).

| Flag | Required | Description |
|------|----------|-------------|
| `--agent-id=<uuid>` | yes | UUID of an existing row in `agents`. Format-validated up front — a non-UUID exits with code 1 before any DB call. |
| `--dry-run` | no | Skips the estimator call and the DB write. Useful for verifying env / persona / model-resolution without spending an LLM call or mutating the row. |
| `--log-dir=<path>` | no | Directory for the per-run log file. Default: `tests/effort-estimator/logs/`. Useful for dumping to `/tmp` or a CI artifact directory. |
| `--help` / `-h` | no | Prints usage and exits. |

---

## What you should see

Each run prints labeled JSON blocks in order. The load-bearing payloads (the estimator's result, the persisted row state) are wrapped in a `=====` header banner so they stand out against the supplemental routine blocks.

1. **Hydrated input (summary)** — a redacted view of what gets passed to `estimateEffort`. The `enhancedPromptPreview` is truncated to 200 chars for readability; the full string still goes to the estimator.
2. **Resolved model (DB-driven, with `gpt-4o-mini` fallback per AC-7)** — `{ provider, model }` that the estimator will use. Confirms the `system_settings_config.effort_estimator_model` lookup worked (or hit the fallback).
3. **`ESTIMATOR RESULT` (banner-headed)** — `{ success, attempts, totalDurationMs, errorMessage?, estimate?, previousEstimate? }`. **Dry-run and live mode both produce a real estimate** — the only difference is the suffix in the banner header (`dry-run — what would be written` vs. `live — written`). This is the payload the live tester opened the log to see.
4. **Override log preview** — same shape as the production INFO log in `EffortEstimator.ts` so you can verify what production observability will record. Printed on a successful run in both modes.
5. **Either:**
   - **`DB row state AFTER dry-run`** (dry-run only) — re-read of `agent_config.roi_estimate` post-run with a `slot_unchanged: true/false` field proving the DB was NOT mutated.
   - **`PERSISTED agent_config.roi_estimate`** (live only, banner-headed) — re-read of the row to confirm the write succeeded.
6. **Final one-line `PASS` / `FAIL` line** — the at-a-glance summary including model, attempts, `total_manual_time_seconds`, and script duration. Dry-run runs append `NO DB write. NO audit event.` to the PASS line so the live tester sees the no-side-effect contract acknowledged in plain text.

### Dry-run behavior (important)

Dry-run **does call the LLM** — the user explicitly wants to see what the estimator would produce. What dry-run skips is:

- `AgentRepository.update(...)` — the row's `agent_config.roi_estimate` slot stays byte-identical to the pre-call state.
- The `EFFORT_ESTIMATE_GENERATED` audit event — nothing lands in `audit_trail`.

Internally the script passes `{ skipPersist: true }` to `estimateEffort(...)` (an option strictly reserved for this script). Production callers — the V6 save hook, the API route, the fire-and-forget dispatcher — must never pass this option, and `EffortEstimator.ts` documents this contract.

For the persisted schema details see [`docs/EFFORT_ESTIMATOR.md`](/docs/EFFORT_ESTIMATOR.md) § Output Schema, and [`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md) § Output Schema.

---

## Per-run log file

Every invocation also writes a structured log file capturing the full run trace — the script's own Pino lines AND the estimator's child-logger lines — so engineers can debug behavioral issues post-hoc without re-running.

| Aspect | Value |
|--------|-------|
| **Default location** | `tests/effort-estimator/logs/` (created on first run if it does not exist; gitignored at the repo-root `.gitignore`) |
| **Override** | `--log-dir=<path>` — accepts absolute or CWD-relative paths |
| **File naming** | `run-{ISO-timestamp}-{agentIdShort}.log` where `agentIdShort` is the first 8 chars of the agent UUID. Example: `run-2026-06-11T14-32-05-123Z-abc12345.log`. The `:` and `.` in the ISO timestamp are replaced with `-` so Windows filesystems accept the name. |
| **Format** | JSON-Lines — one Pino record per line, matching the project's structured-logging convention ([SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md)). NOT plain text. |
| **Content** | Every log line emitted by the script + every log line emitted by the estimator during the run, plus a synthetic final `RUN_SUMMARY` line with `{ agent_id, dry_run, success, attempts, totalDurationMs, started_at, finished_at, log_file_path }`. |
| **Dry-run** | Log file is written in BOTH dry-run and live-write modes — debugging dry-runs is a common case. |
| **Console** | UNCHANGED — operators still see the same pretty-printed JSON blocks. The file is **in addition**, not a replacement. |

The log file path is printed at the end of every run so you know where to find it.

### Inspecting a log

```bash
# Pretty-print all lines from a specific run
cat tests/effort-estimator/logs/run-2026-06-11T14-32-05-123Z-abc12345.log | npx pino-pretty

# Extract the RUN_SUMMARY across many runs (useful for retry-budget tuning)
cat tests/effort-estimator/logs/run-*.log | jq 'select(.msg == "RUN_SUMMARY")'

# Find all FAIL runs in the log folder
cat tests/effort-estimator/logs/run-*.log | jq 'select(.msg == "RUN_SUMMARY" and .success == false)'

# Inspect every error-level line for a specific correlationId
cat tests/effort-estimator/logs/run-*.log | jq 'select(.level >= 50 and .correlationId == "<uuid>")'
```

---

## Safety

| Rule | Why |
|------|-----|
| No `--user-id` flag. | The script always reads `user_id` from the agent row to prevent accidental cross-tenant testing (requirement § Integration Test Tooling — Safety #2). |
| Fail loud on missing env vars / bad UUIDs. | Silent fallback would mask config issues during pre-release validation. |
| One agent per invocation. | No batch mode — loop in the shell if you need to test more than one. |
| Live mode IS destructive. | A successful live run overwrites `agent_config.roi_estimate` and fires an audit event. Use `--dry-run` first if you're unsure. |

---

## Common gotchas

### `enhanced_prompt` falling back to `user_prompt`

If you see this warning at the top of the run:

```
NOTE: enhanced_prompt is not persisted on this agent — falling back to user_prompt.
      This is the symptom of Open Follow-Up #9 in the requirement MD...
```

it means the V6 pipeline did not persist its enhanced prompt to a place the script can find it (`agents.enhanced_prompt` column, or `agent_config.enhanced_prompt`). The estimator will still run, but the persona reasoning will be based on the raw user prompt, not the V6 enrichment. This is a known gap tracked as **Open Follow-Up #9** in [`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md) and is the entire reason the script logs the fallback path explicitly — surfacing the persistence gap to live testers is the point.

### The `FAIL` exit on a real LLM call

If the estimator returns `success: false`, the script exits non-zero and prints `errorMessage` + `attempts`. `agent_config.roi_estimate` is NOT mutated in this case (per AC-2 — slot left untouched). Re-run the script (the retry-with-backoff inside the estimator will reset).

### Why the script has one direct `supabaseServer` read

The script reads the agent's `user_id` directly via `supabaseServer` (rather than via `AgentRepository`) for one specific reason: `AgentRepository.findById(id, userId)` requires both inputs by design, and there is no `findByIdAsServiceRole(id)` method (we don't want one in production code). This script-only pattern is documented inline at the call site. After the `user_id` lookup, every subsequent read/write goes back through the repository so the rest of the script behaves exactly like production.

---

## Reporting bugs found via this tool

If the live run surfaces an issue (bad estimate, missing persona reference, audit event misfires, etc.), file a bug:

- **Estimator / persona / model issues** → annotate the live run output and add a new finding to the QA Test Report section of [`docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md`](/docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md), or open a new workplan if the issue is large.
- **Persistence gap (V6 `enhanced_prompt` not stored)** → Open Follow-Up #9 already tracks this — just confirm the symptom rather than refiling.
- **Race conditions on the `agent_config` write** → Open Follow-Up #8 (mergeAgentConfig RPC) already tracks this.
- **Anything else** → add to the workplan with the `correlationId` printed by the script so logs can be correlated.

---

## See also

- [`docs/EFFORT_ESTIMATOR.md`](/docs/EFFORT_ESTIMATOR.md) — design doc + output schema reference.
- [`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md) — requirement MD, especially § Integration Test Tooling.
- [`lib/effort-estimator/`](/lib/effort-estimator) — production estimator module the script exercises.
- [`tests/v6-regression/scripts/`](/tests/v6-regression/scripts) — sibling V6 scripts the runner is patterned after.
