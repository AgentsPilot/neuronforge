---
name: calibration-rca
description: A methodical, repeatable procedure for diagnosing WHY a specific agent's calibration failed and driving it to a root-cause conclusion. Use whenever the user gives an agent ID (or a calibration result) and asks to debug / investigate / RCA / "why did calibration fail" / "agent created but calibration failed" / "what step didn't work" — for ANY agent, production or sandbox. It loads the 6-step method (gather persisted evidence → read the issues array → find the EARLIEST failing step and trace the cascade → classify the root-cause LAYER [input/data vs V6 generation vs runtime/external API vs calibration-detection] → check whether calibration itself behaved correctly → conclude), the two evidence scripts (scripts/dump-calibration.ts, scripts/dump-agent.ts), the calibration_sessions / calibration_history / agent_executions data model and issue-object shapes, and the recurring traps (cascade masking, schema-mutation, dry-run side-effects, misleading 403/SERVICE_DISABLED errors, non-deterministic generation). This skill is DIAGNOSTIC ONLY — it concludes RCA and names the fix-owner; it does not change code. For CHANGING calibration code use the `calibration` skill; for the upstream generation pipeline use the `v6-pipeline` skill. Full detail: docs/Calibration/CALIBRATION_RCA_RUNBOOK.md.
---

# calibration-rca

Load this context **before** investigating why a specific agent's calibration failed. It's the durable, repeatable method for going from a bare **agent ID** to a defensible root cause — *which step didn't do its job, why, which layer owns the fix, and whether calibration itself behaved correctly* — **before** any fix is proposed.

> **First read**: [`docs/Calibration/CALIBRATION_RCA_RUNBOOK.md`](../../../docs/Calibration/CALIBRATION_RCA_RUNBOOK.md) — the full methodology, data-model reference, traps, and worked examples. This skill is the working summary; the runbook is the source of truth.

> **Scope**: DIAGNOSTIC ONLY. You produce an RCA and name the fix-owner — you do **not** change code here. Changing calibration code → `calibration` skill. The generation pipeline that produced the broken workflow → `v6-pipeline` skill. The upstream chat creation flow → `agent-creation-flow` skill.

> **Golden rule**: conclude the RCA — failing step, why, layer, fix-owner — **before** discussing fixes. Calibration failures almost always cascade from one earliest step; name that step first.

---

## When this skill fires

- "Agent `<id>` was created but calibration failed — debug it / find the RCA."
- "Why did calibration fail for this agent? What step didn't work?"
- A `needs_review` / `failed` calibration outcome the user wants explained.

It works for **any** agent (production or Vercel sandbox) — most evidence is already persisted in the DB; you rarely need a local reproduction.

---

## The 6-step method (summary)

### 1. Gather evidence (DB-first; no repro needed)
```bash
npx tsx scripts/dump-calibration.ts <agent_id>   # sessions + history + executions + RCA HINT
npx tsx scripts/dump-agent.ts       <agent_id>   # pilot_steps + WP-55 intent_contract/data_schema → c:/tmp/agent-<prefix>.json
```
`dump-calibration.ts` prints an **RCA HINT** (earliest failing step + cascade note) — start there. Production/Vercel runs are **not** in `dev.log`; the DB rows are your evidence.

### 2. Read the issues array
Separate the **summary** issue (`type:"steps_failed"` — an aggregate, set aside) from the **specific** per-step issues. Each specific issue's `category` is your first signal: `parameter_error` (bad value, often with a high-confidence `suggestedFix`), `execution_error` (often "…has no input data" = **cascade**), `scatter_item_field` (WP-56), `data_shape_mismatch`, `hardcode_detected` (warning), `execution_failed`/`steps_failed` (aggregates).

**BLOCKING-class detector issues (2026-07 field-fidelity batch — these can never be waved to a pass):** `plugin_field_fidelity_mismatch` (a transform declares a field name the producing plugin action doesn't emit — e.g. `mime_type` vs the real `mimeType`; the calibration twin of the compiler Gap C gate), `degraded_step_all_failed` / `degraded_step_all_empty` (a step/scatter where 100% of items errored or returned empty/fallback — the hidden-failure anti-pattern, previously invisible). Plus the non-blocking `partial_report_data` (`needs_review`: the report was produced but some columns are blank in every row). These carry an explicit top-level `type` and `blocking:true` (except `partial_report_data`).

### 3. Find the EARLIEST failing step + trace the cascade
The single most important move. Take the **lowest-numbered** step in `failedStepIds`. Confirm downstream issues say *"…has no input data. Available variables: …"* — that's fallout, **not** an independent bug. **Only the earliest step is the real failure** (unless two genuinely-independent steps fail with different errors).

### 4. Classify the root-cause LAYER (the crux)
Open the earliest failing step in `pilot_steps` and decide who owns the fix:

| Layer | Signs | Fix-owner |
|---|---|---|
| **Input / data** | Value wrong for *this user's* data/access (e.g. `range="Sheet1"` but the tab isn't named that; inaccessible/empty source). DSL structurally fine. | The input value / user data — **or** a generation choice to *derive* the value instead of guessing it. |
| **V6 generation** | DSL is wrong: non-existent field ref (WP-56 scatter), dropped EP constraint (WP-53), wrong plugin/action, lying `output_schema` (WP-15/17/18), missing step. Pull the WP-55 `intent_contract`. | `v6-pipeline` skill (prompt / binder / IR / compiler). |
| **Runtime / external API** | Valid request the API rejects: `403 SERVICE_DISABLED`, auth expired, rate limit, 5xx. DSL + values correct. | Plugin executor / external config (enable API, reconnect). Not a workflow bug. |
| **Calibration detection** | Calibration *misreported*: claimed success on a failed run, merged/dropped a real issue, or showed a misleading message. | `calibration` skill (batch route / IssueGrouper / userFacing / DryRunValidator). |

Ask in order: (1) value wrong for the data? → input/data. (2) DSL wrong? → generation. (3) API rejected a valid request? → runtime. (4) calibration misreported? → detection. **Common combo:** value wrong *because generation guessed it* (e.g. defaulting a Sheets range to "Sheet1" from a `gid=0` URL) — name both; prefer the generation fix (derive, don't guess).

### 5. Did calibration itself behave correctly?
Separate "the agent's workflow fails" from "calibration is buggy." A failed run should be `needs_review`/`failed` with the real issues surfaced (not `success`). Check the actionable issue wasn't collapsed into `unique:undefined` (missing `category`/`id`/`affectedSteps`). Check `execution_summary.data_written` for **dry-run side-effects** (it can send real emails / write real data). Usually the answer is "calibration behaved correctly — it honestly caught a real problem"; say so.

### 6. Conclude (then stop)
State: **failing step** → **why** (precise error + cause) → **cascade** (+ side-effects) → **layer / fix-owner** → **did calibration behave correctly**. Do not jump to fixes unless asked.

---

## Traps & gotchas (these bite every time)

- **Cascade masking** — RCA the *earliest* step, not the loudest issue. "No input data" = upstream produced nothing.
- **Schema-mutation trap** — the stored `output_schema` can be mutated to *agree* with a wrong reference (WP-56 `id`→`folder_id`), hiding the bug. Validate field refs against the **plugin definition**, not the stored schema.
- **Dry-run side-effects** — Layer-3 executes real plugin actions; a "no data" email reaching the user may have come *from calibration*. Check `execution_summary.data_written`.
- **Misleading external errors** — a `403` may be `SERVICE_DISABLED` (API not enabled) reported as "request access from the owner." Read the raw API `reason`. Plugin OAuth ≠ API enablement.
- **Non-deterministic generation** — a failed agent's bug may not reproduce on a fresh generation (Phase 1 is the only non-deterministic phase). Use the **persisted** WP-55 `intent_contract`; don't re-generate to diagnose.

---

## Data model (where the evidence lives)

| Object | Use |
|---|---|
| `calibration_sessions` (latest) | Live run state: `status`, `completed_steps`/`failed_steps`, **`issues[]`**, `issue_summary`, `execution_summary` (side-effects). |
| `calibration_history` (latest) | Recorded outcome: `status`, `iterations`, `auto_fixes_applied`, **`issues_remaining[]`**, `steps_failed`, `plugins_used`. Precise verdict lives in `metadata.verdict` (see below). |
| `agent_executions` | The runs incl. the dry-run (`run_mode` = `calibration`/`batch_calibration`), `error_message`. |
| `agents.agent_config.ai_context.intent_contract` / `.data_schema` | WP-55 generation fingerprint (null pre-WP-55) — needed for *generation*-layer RCA. |
| `agents.calibration_status` | Wizard/gate column: `running`/`passed`/`failed`/`skipped`. Keys on history `status === 'success'` — a **cosmetic-only pass now reads `passed`** (was wrongly `failed`). Distinct from the fast-path `agents.last_calibration_status` (`success`/`needs_review`/`failed`). |

Issue shape: `{ id, category, severity, message, technicalDetails, affectedSteps:[{stepId,…}], suggestedFix?:{action:{parameterName, problematicValue}, confidence}, requiresUserInput }`. The `dry_run` summary issue: `{ type:'steps_failed', details:{failedStepIds, stepsFailed, stepsCompleted} }`. The 2026-07 detector issues additionally carry a top-level `type` (`plugin_field_fidelity_mismatch`, `degraded_step_all_failed`, `degraded_step_all_empty`, `partial_report_data`) and `blocking`.

**Verdict states (Item 6, in `calibration_history.metadata.verdict` + the API response):** `passed` / `failed` / `needs_review` / `inconclusive` (real path never exercised / delivered all-blank — never a clean pass) / `corrected_not_verified` (an in-place field-fidelity correction was applied but the re-run still didn't exercise the path). `inconclusive` + `corrected_not_verified` both persist as DB `status='needs_review'`; only a genuine `passed` writes `status='success'`. **RCA relevance:** an `inconclusive`/`corrected_not_verified` verdict means calibration behaved correctly by refusing a false-green — treat it as "honestly not verified," not a calibration bug.

---

## Related

- `calibration` skill — the calibration module's architecture + constraints (use to *change* calibration code).
- `v6-pipeline` skill — the generation pipeline (most generation-layer root causes get fixed here; file/extend a WP).
- `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md` — full method + worked examples (`3fc703fd` Sheets range, `8c7caa01` scatter item-ref).
- `docs/Calibration/CALIBRATION_LOG_GUIDE.md` / `CALIBRATION_VALIDATION_MONITORING.md` — live-log tailing when reproducing locally.
