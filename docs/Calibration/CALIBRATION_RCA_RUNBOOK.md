# Calibration RCA Runbook

> **Last Updated**: 2026-07-13

## Overview

A repeatable, methodical procedure for investigating **why a specific agent's calibration failed** and driving it to a root-cause conclusion. Given only an **agent ID**, this runbook takes you from "calibration failed" to a precise statement of *which step didn't do its job, why, which layer owns the root cause, and whether calibration itself behaved correctly* — **before** any fix is proposed.

It is **generic** (works for any agent) and **diagnostic-only** (it concludes RCA; it does not change code). For *changing* calibration code, use the `calibration` skill; for the upstream generation pipeline, use the `v6-pipeline` skill.

> **Golden rule:** conclude the RCA — failing step, why, layer, fix-owner — **before** discussing fixes. Most calibration failures cascade from a single earliest step; name that step first.

## Table of Contents

- [When to use](#when-to-use)
- [The 6-step method](#the-6-step-method)
  - [Step 1 — Gather evidence](#step-1--gather-evidence)
  - [Step 2 — Read the issues](#step-2--read-the-issues)
  - [Step 3 — Find the earliest failing step + trace the cascade](#step-3--find-the-earliest-failing-step--trace-the-cascade)
  - [Step 4 — Classify the root-cause LAYER](#step-4--classify-the-root-cause-layer)
  - [Step 5 — Did calibration itself behave correctly?](#step-5--did-calibration-itself-behave-correctly)
  - [Step 6 — Conclude](#step-6--conclude)
- [Data model reference](#data-model-reference)
- [Traps & gotchas](#traps--gotchas)
- [Worked examples](#worked-examples)
- [Change History](#change-history)

---

## When to use

- A user reports "agent created but calibration failed" / "calibration says needs-review" / "agent doesn't work after calibration."
- You have an **agent ID** (production or sandbox) and need a defensible root cause.

You do **not** need a local reproduction — most of the evidence is already persisted in the DB.

> **Start from the automated RCA if one exists.** When `CALIBRATION_AUTO_RCA_ENABLED` is on, a background calibration failure now runs an **automated** version of this exact 6-step method at failure time and persists the result to **`calibration_history.metadata.auto_rca`** (an 8-field conclusion + one of the 5 root-cause layers), alongside `metadata.auto_rca_status` (`success` \| `timeout` \| `llm_error` \| `invalid_output` \| `evidence_error` \| `skipped_budget`) and `metadata.correlation_id`. If `auto_rca` is present, read it first and verify/refine it — it is a machine-generated **starting point**, not a hand-verified conclusion. If `auto_rca_status` is a non-`success` value (or absent), fall back to the full manual method below. See [POST_CREATION_CALIBRATION_FLOW.md § Admin failure alert + automated RCA](/docs/Calibration/POST_CREATION_CALIBRATION_FLOW.md#admin-failure-alert--automated-rca-best-effort-augmentation).

---

## The 6-step method

### Step 1 — Gather evidence

Pull the persisted evidence. Two scripts (run from repo root; both read `.env.local`):

```bash
# Calibration outcome: sessions (live issues) + history (recorded outcome) + executions
npx tsx scripts/dump-calibration.ts <agent_id>

# The workflow itself: pilot_steps + (WP-55) agent_config.ai_context.intent_contract / data_schema
npx tsx scripts/dump-agent.ts <agent_id>   # writes c:/tmp/agent-<prefix>.json
```

`dump-calibration.ts` already prints an **RCA HINT** (earliest failing step + cascade note). Start there.

What each source gives you:

| Source | What it tells you |
|---|---|
| `calibration_sessions` (latest) | Live state of the most recent run: `status`, `completed_steps`/`failed_steps`, the **`issues[]`** array, `issue_summary`, and `execution_summary` (incl. **side-effects** like emails sent). |
| `calibration_history` (latest) | The recorded outcome: `status` (`success`/`needs_review`/`failed`), `iterations`, `auto_fixes_applied`, `issues_remaining[]`, `steps_failed`, `plugins_used`. |
| `agent_executions` | The underlying runs (incl. the Layer-3 **dry-run**); `run_mode`, `status`, `error_message`. |
| `pilot_steps` (dump-agent) | The compiled DSL — open the failing step here. |
| `agent_config.ai_context.intent_contract` / `.data_schema` (WP-55) | The Phase 1 emission + slot schemas — needed when the root cause is **generation** (non-deterministic; this is the only recoverable fingerprint). Pre-WP-55 agents have these = null. |

> **Production/Vercel agents:** the dev-server `dev.log` won't have the run. The DB rows above are your primary evidence. Live logs (when reproducing locally) come via `monitor-calibration.sh` / `CALIBRATION_LOG_GUIDE.md`.

### Step 2 — Read the issues

The `issues[]` / `issues_remaining[]` array mixes two kinds — separate them:

- **The summary issue** — `type: "steps_failed"` ("N step(s) failed", lists `failedStepIds`). This is an *aggregate*, not a cause. Note the count and IDs, then set it aside.
- **The specific issues** — one per failing step, each with `category`, `severity`, `message`, `affectedSteps[0].stepId`, and sometimes `suggestedFix` (with `confidence` + `problematicValue`).

Read each specific issue's `category` — it's your first classification signal:

| `category` | Usually means |
|---|---|
| `parameter_error` | A param value the plugin/API rejected (wrong range, bad id, invalid format). Often carries a high-confidence `suggestedFix`. |
| `execution_error` | A step threw at runtime — frequently **"…has no input data. Available variables: …"** (a **cascade** symptom, not a root cause). |
| `data_shape_mismatch` | A transform's input/output shape disagreement (often auto-fixed silently). |
| `hardcode_detected` | A literal that should be a parameter (a *warning*, rarely the failure). |
| `scatter_item_field` | A scatter/loop item-ref names a field the iterated items don't have (WP-56 family). |
| `execution_failed` / `steps_failed` | Aggregate/whole-run failure markers. |

**BLOCKING-class detector issues (2026-07 field-fidelity batch).** These carry an explicit top-level `type` + `blocking:true` and can NEVER be waved to a passing verdict:

| `type` | Means |
|---|---|
| `plugin_field_fidelity_mismatch` | A transform declares an item field the producing plugin action doesn't emit — a clearly-same-field spelling divergence (e.g. `mime_type` while the producer emits `mimeType`). Detected against the plugin's real `output_schema`. The calibration twin of the compiler-side Gap C gate. |
| `degraded_step_all_failed` | A step/scatter where 100% of items carry an error / `success:false` marker (the hidden-failure anti-pattern — previously swallowed into valid-looking empty results). |
| `degraded_step_all_empty` | A step/scatter where 100% of items return empty / fallback data (no meaningful values). |
| `partial_report_data` (non-blocking, `needs_review`) | The report was produced with real data, but some columns are blank in every row (the step that fills them isn't receiving the source data). |

### Step 3 — Find the earliest failing step + trace the cascade

**The single most important move.** Calibration failures almost always cascade: one step fails, and every downstream step then fails with **"has no input data."**

1. From `failedStepIds`, take the **lowest-numbered / earliest** step (`step1` before `step2`…). The `dump-calibration.ts` RCA HINT computes this.
2. Confirm the cascade: downstream issues should say *"Transform step stepN has no input data. Available variables: …"* — that's "my upstream produced nothing," **not** an independent bug.
3. **Only the earliest step is the real failure.** Investigate it; treat the rest as fallout until proven otherwise.

> If two *independent* steps fail (e.g. step1 *and* an unrelated step6 with a different error), you have two root causes — handle each.

### Step 4 — Classify the root-cause LAYER

Open the earliest failing step in `pilot_steps` and decide **which layer owns the fix**. This is the crux — it determines where the fix belongs per CLAUDE.md's "fix at the root cause."

| Layer | Signs | Where the fix lives |
|---|---|---|
| **Input / data** | The param value is wrong for *this user's data* — e.g. `range="Sheet1"` but the tab isn't named Sheet1; a spreadsheet/folder the user can't access; an empty source. The DSL is structurally fine; the *value* or *data* is the problem. | The input value / the user's data — **or** a generation choice to *derive* the value instead of guessing it (see below). Often surfaced as a calibration `parameter_error` with a `suggestedFix`. |
| **V6 generation** | The DSL itself is wrong: a field ref to a non-existent field (WP-56 scatter item-refs), a dropped EP constraint (WP-53), a wrong plugin/action, a lying `output_schema` (WP-15/17/18), a missing intermediate step. Pull the WP-55 `intent_contract` to see the Phase 1 emission. | The **`v6-pipeline`** skill — prompt (`intent-system-prompt-v2.ts`), binder, IR converter, or compiler. File/extend a WP. |
| **Runtime / external API** | The request is valid but the API rejects it: `403 SERVICE_DISABLED` (API not enabled), auth expired, rate limit, transient 5xx. The DSL and values are correct. | Plugin executor error-handling / external config (enable the API, reconnect). Not a workflow bug. |
| **Calibration detection** | Calibration *misreported* — claimed success on a failed run, dropped/merged a real issue, or surfaced a misleading message. The agent ran (or failed) but calibration's verdict/UX is wrong. | The **`calibration`** skill — batch route, IssueGrouper, userFacing, DryRunValidator. |

**Decision aid — ask in order:**
1. Is the **value** wrong for the user's data/access? → *input/data* (consider deriving it in generation).
2. Is the **DSL** wrong (ref/param/schema/step)? → *V6 generation* (check the WP-55 intent_contract).
3. Did the **API** reject a valid request? → *runtime/external*.
4. Did calibration **misreport** what actually happened? → *calibration detection*.

A subtle but common case: the value is wrong (*input/data*) **because** generation *guessed* it instead of deriving it (e.g. defaulting a Sheets range to "Sheet1" from a `gid=0` URL). That is *both* an input symptom *and* a generation root cause — name both, and prefer the generation fix (derive, don't guess) as the durable one.

### Step 5 — Did calibration itself behave correctly?

Separate **"the agent's workflow fails"** from **"calibration is buggy."** Check:

- Did calibration report the truth? A failed run should be `needs_review`/`failed` with the real issues surfaced — **not** `success`. (If it claimed success on a failed run, that's a *calibration-detection* bug — see P1 history.)
- Did it surface the **actionable** issue distinctly, or collapse it? (Issues missing `category`/`id`/`affectedSteps` get merged into the `unique:undefined` bucket — see P3 history.)
- Did the dry-run cause **side-effects**? `execution_summary.data_written` showing `"Sent email"` means the Layer-3 dry-run *actually sent a real email* on whatever data flowed (often empty) — note it; it can confuse the user and is its own concern.

Most of the time the answer is "calibration behaved correctly — it honestly reported the agent doesn't work yet." Say so explicitly; it reframes "calibration failed" as "calibration correctly caught a real problem."

### Step 6 — Conclude

State the RCA in this shape, then stop (don't jump to fixing unless asked):

1. **Failing step** — the earliest one (e.g. `step1 google-sheets.read_range`).
2. **Why** — the precise error + cause (e.g. `range="Sheet1"` → "Unable to parse range" → the tab isn't named Sheet1).
3. **Cascade** — which downstream steps failed as fallout (e.g. step2–4 "no input data"), and any side-effects (e.g. a real email was sent).
4. **Layer / fix-owner** — input/data vs generation vs runtime vs calibration-detection (and the durable fix location).
5. **Did calibration behave correctly?** — usually yes; call it out.

---

## Data model reference

(See the `calibration` skill § 6 and the repos for the authoritative schema.)

- **`calibration_sessions`** — active-run state, one open row per in-flight run. Key fields: `status`, `completed_steps`/`failed_steps`/`skipped_steps`/`total_steps`, **`issues`** (the live array), `issue_summary` (`{critical, warnings, autoRepairs}`), `execution_summary`, `execution_id`. Repo: `CalibrationSessionRepository`.
- **`calibration_history`** — one row per completed run. Key fields: `status` (`success`/`needs_review`/`failed`/`verification_only`), `iterations`, `auto_fixes_applied`, `first_execution_success`, `marked_production_ready`, **`issues_remaining`**, `steps_failed`, `plugins_used`, `workflow_hash`, `metadata.verdict` (the precise verdict — see below). Repo: `CalibrationHistoryRepository`.
- **`agent_executions`** — the runs (the dry-run shows `run_mode = 'calibration'` / `'batch_calibration'`). Fields: `status`, `error_message`, `run_mode`.
- **`agents.agent_config.ai_context.intent_contract` / `.data_schema`** — WP-55 generation fingerprint (null pre-WP-55).
- **`agents.calibration_status`** — the wizard/gate column: `running`/`passed`/`failed`/`skipped`, set at the route tail via `AgentRepository.setCalibrationStatus`. It keys on the persisted verdict (`calibration_history.status === 'success'`), so a **cosmetic-only pass now reads `passed`** (previously it wrongly read `failed` because it also required zero remaining issues). Distinct from the fast-path `agents.last_calibration_status` (`success`/`needs_review`/`failed`) documented in `CALIBRATION_STATUS_TRACKING.md`.

**Issue object shape (inside `issues[]`):** `{ id, category, severity, title, message, technicalDetails, affectedSteps:[{stepId, stepName, friendlyName}], suggestedFix?:{action:{parameterName, problematicValue, …}, confidence}, requiresUserInput, autoRepairAvailable }`. The `dry_run` summary issue is shaped differently: `{ type:'steps_failed', details:{failedStepIds, stepsFailed, stepsCompleted} }`. The 2026-07 detector issues additionally carry a top-level `type` (`plugin_field_fidelity_mismatch`, `degraded_step_all_failed`, `degraded_step_all_empty`, `partial_report_data`) and `blocking`.

**Verdict states (Item 6 — `CalibrationVerdict.computeVerdict`, carried in `calibration_history.metadata.verdict` + the API response).** The verdict keys on issue CLASS, not a raw count:

| Verdict | Meaning | DB `status` |
|---|---|---|
| `passed` | No blocking issues, real path exercised with meaningful data; at most waved cosmetic suggestions. | `success` |
| `failed` | Hard failure. | `failed` |
| `needs_review` | A blocking-class or non-cosmetic issue remains. | `needs_review` |
| `inconclusive` | The real/failure-prone path was never exercised, OR the delivered set was all-blank/all-fallback (false-green guard). **Never a clean pass.** | `needs_review` |
| `corrected_not_verified` | An in-place field-fidelity correction (Item 7) was applied but the re-run still didn't exercise the real path. | `needs_review` |

**RCA relevance:** an `inconclusive` / `corrected_not_verified` verdict means calibration behaved *correctly* by refusing a false-green — that is "honestly not verified," NOT a calibration-detection bug. A BLOCKING-class detector issue (`plugin_field_fidelity_mismatch`, `degraded_step_all_*`) forcing `needs_review` is likewise calibration doing its job.

---

## Traps & gotchas

- **Cascade masking.** Don't RCA the loudest issue — RCA the *earliest* step. "No input data" is a symptom of an upstream failure.
- **Schema-mutation trap.** When validating a field reference against a schema, the agent's **stored** `output_schema` can be *mutated to agree with the wrong reference* (the WP-56 `id`→`folder_id` case), hiding the bug. Resolve against the **plugin definition** (source of truth), not the stored schema.
- **Dry-run side-effects.** Layer-3 dry-run executes real plugin actions — it can **send real emails / write real data**. Check `execution_summary.data_written`. A "no leads found" email reaching the user may have come *from calibration*, not a real run.
- **Misleading external errors.** A Google `403` can be `SERVICE_DISABLED` (API not enabled — a project config toggle) yet get reported as "request access from the owner" (a document-permission message). Read the **raw** API `reason`, not just the friendly message. Plugin connection (OAuth) ≠ API enablement.
- **Non-deterministic generation.** A failed agent's bug may not reproduce on a fresh generation (Phase 1 is the only non-deterministic phase). Use the **persisted** WP-55 `intent_contract`; don't re-generate to diagnose.
- **`success: false` ≠ the route crashed.** A `needs_review` outcome with a 200 response is calibration working correctly. A 500 (top-level catch) is calibration itself erroring.

---

## Worked examples

### Example A — `3fc703fd` (Sheets range; input/data + generation)
- **Earliest failing step:** `step1 google-sheets.read_range`.
- **Why:** `range="Sheet1"` → Sheets API "Unable to parse range: Sheet1" → the target tab (`gid=0`) isn't named "Sheet1." High-confidence `parameter_error` (0.95) with a `suggestedFix`.
- **Cascade:** step2–4 "no input data"; step5–6 ran on empty → a real "no leads" email was sent by the dry-run.
- **Layer:** *input/data* symptom with a *generation* root cause — Phase 1 guessed the tab name ("Sheet1") instead of deriving it from the `gid=0` URL. Durable fix: derive/resolve the sheet name (generation), or `read_range` first-sheet fallback (runtime). Secondary smell: duplicate input fields (`sheet_range` vs `google-sheets__table/get__range`).
- **Calibration:** behaved correctly — honest `needs_review`, accurate high-confidence fix hint.

### Example B — `8c7caa01` (scatter item-ref; V6 generation)
- **Earliest failing step:** the scatter sub-step `read_document`.
- **Why:** `{{doc_item.folder_id}}` — Drive `list_files` items expose `id`, not `folder_id` (the *folder's* key reused for *file* items). Resolved to `undefined` → empty `document_id` → Docs 400.
- **Layer:** *V6 generation* (Phase 1 field-fidelity — WP-56). Note the **schema-mutation trap**: the stored `output_schema` also said `folder_id`, so you must check the plugin def. Fixed in generation (prompt FIELD FIDELITY) + caught/auto-repaired in calibration (`ScatterItemFieldValidator`).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-13 | Field-fidelity + calibration-hardening data-model refresh | Documented the class-based verdict states (`passed`/`failed`/`needs_review`/`inconclusive`/`corrected_not_verified`) and their DB `status` mapping; added the 2026-07 BLOCKING detector issue `type`s (`plugin_field_fidelity_mismatch`, `degraded_step_all_failed`, `degraded_step_all_empty`) + non-blocking `partial_report_data` to Step 2 and the data-model reference; added the `agents.calibration_status` gate column (cosmetic-only pass now `passed`). Reflects the batch-1 field-fidelity/calibration-hardening + Group A wizard/verdict-unblock changes. |
| 2026-07-05 | Automated RCA note | Added a "start from the automated RCA if one exists" note under [When to use](#when-to-use): a background calibration failure now runs this method automatically (flag `CALIBRATION_AUTO_RCA_ENABLED`) and persists the result to `calibration_history.metadata.auto_rca` (+ `auto_rca_status`, `correlation_id`), so a human doing the manual RCA can start from it. |
| 2026-06-30 | Created | Initial RCA runbook: 6-step method (gather → read issues → earliest-step/cascade → classify layer → calibration-correctness → conclude), data-model reference, traps, and two worked examples (`3fc703fd` Sheets range, `8c7caa01` scatter item-ref). Backs the `calibration-rca` skill; companion script `scripts/dump-calibration.ts`. |
