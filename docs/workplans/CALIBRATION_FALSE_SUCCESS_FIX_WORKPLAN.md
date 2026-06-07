# Calibration False-Success Reporting — Fix Workplan

> **Last Updated**: 2026-06-03
> **Status**: ⬜ Open — analysis complete, fixes not yet implemented
> **Surface**: (A) Post-creation Batch Calibration (`/api/v2/calibrate/batch` + sandbox UI)
> **Triggering incident**: agent `8c7caa01-e328-4b0a-ae04-afbcd10add45`, calibration session `c59c66c5-68e4-427c-8174-7e65cde05a8e`, execution `cc4e821b-ebe5-4d72-aaf6-bb4e1f47f69d` (2026-06-03 06:13 run)

## Overview

A calibration run on agent `8c7caa01` was reported to the user as **"ran successfully, no data found, fixed 5 items"** when in reality **every scatter item failed**, the dry-run returned `success: false`, **zero** auto-fixes were applied, and the backend correctly classified the outcome as `needs_review` with **2 critical issues**. The agent cannot send a real result.

This workplan separates the failure into four problems and assigns each to the layer that owns its fix. **Three are calibration-owned reporting/detection bugs (P1–P3); one is the upstream V6 generation defect that produced the broken DSL (P4).** Per [CLAUDE.md § Platform Design Principles](/CLAUDE.md) ("fix at the root cause") and the calibration skill § 7, the durable fix for the underlying agent bug is in the V6 pipeline; calibration's job is to *detect, safely repair, and report honestly* — which it currently does not do for this class.

## Table of Contents

- [Evidence from the run](#evidence-from-the-run)
- [Problem breakdown](#problem-breakdown)
  - [P1 — False "success" reporting (PRIMARY, calibration-owned)](#p1--false-success-reporting-primary-calibration-owned)
  - [P2 — "No data found" mislabels a hard failure (calibration-owned)](#p2--no-data-found-mislabels-a-hard-failure-calibration-owned)
  - [P3 — Detected-but-unrepaired scatter field ref (calibration-owned gap)](#p3--detected-but-unrepaired-scatter-field-ref-calibration-owned-gap)
  - [P4 — Upstream root cause: `doc_item.folder_id` (V6-owned)](#p4--upstream-root-cause-doc_itemfolder_id-v6-owned)
- [Proposed fixes](#proposed-fixes)
- [Task checklist](#task-checklist)
- [Test plan](#test-plan)
- [Change History](#change-history)

---

## Evidence from the run

All line numbers reference the captured `dev.log` for the 06:13 run.

| Signal | Evidence | Line |
|---|---|---|
| Workflow stopped early, no error | Layer 3 dry run: `success: false, stepsCompleted: 2, stepsFailed: 0, output: null, isEmpty: true` | 4524–4527 |
| Every scatter item failed | `WP-10: 3/3 scatter items failed — filtering out error objects` | (rel. exec range) |
| Per-item swallow | `Scatter item failed — swallowing (WP-54 continueOnError enabled)` ×3 | (rel. exec range) |
| Broken ref detected, only WARNed | `Structural auto-repair fired…` → `"Step params reference non-existent variable: doc_item.folder_id"` | 2160, 2173 |
| Empty doc id at runtime | `read_document` param `"document_id": ""` (resolved from `{{doc_item.folder_id}}`) | 3246, 3277, 3286 |
| Docs API rejects empty id | `GET https://docs.googleapis.com/v1/documents/ 400` (URL ends with empty id; body = "הדף לא נמצא" / page not found) | 7468 |
| Backend classified correctly | `calibrationStatus: "needs_review", criticalIssues: 2, totalIssues: 6` | 7431–7433 |
| No fixes applied | `autoFixesApplied: 0`, `autoRepairsCount: 0` | 7152, 7194, 7254 |
| Issue grouping | `originalCount: 6 → groupedCount: 5` (2 critical + 3 warnings) | 7243, 7252 |
| History row | `status: "needs_review", iterations: 1` | 7438 |
| HTTP result | `POST /api/v2/calibrate/batch 200 in 73644ms` | 7451 |

**The 6 raw issues (→5 grouped):** 1 critical scatter execution_error (`step3: all 3 items failed`), 1 critical `execution_failed` (empty output), and 3 `hardcode_detected` warnings (`"0"`, `"Contracts"`, `"document"`). None addresses the real `folder_id` defect with a fix proposal.

---

## Problem breakdown

### P1 — False "success" reporting (PRIMARY, calibration-owned)

**The batch route returns `success: true` unconditionally and an "all good" message even when the outcome is `needs_review` with critical issues.**

**File:** [app/api/v2/calibrate/batch/route.ts:4214-4225](/app/api/v2/calibrate/batch/route.ts#L4214-L4225)

```ts
return NextResponse.json({
  success: true,                                      // ← always true, ignores calibrationStatus
  autoCalibration: {
    iterations: loopIteration,
    autoFixesApplied,                                 // = 0
    message: autoFixesApplied > 0
      ? `We took care of ${autoFixesApplied} thing…`
      : 'Everything looked good while we tested.'     // ← shown WITH 2 critical failures
  },
  …
```

Just above (line 4140-4141) the route already computes `hasCriticalIssues = summary.critical > 0` and `calibrationStatus = hasCriticalIssues ? 'needs_review' : 'failed'` — but **neither value is reflected in the response payload's top-level `success` or the user-facing `message`.** The `message` branches only on `autoFixesApplied`, so a run with 0 fixes and 2 critical failures gets *"Everything looked good while we tested."*

**Impact:** The single most damaging bug — it tells a non-technical user their broken agent is fine.

> **Frontend note (needs live confirm):** the sandbox routes a non-empty result to `setFlowState('dashboard')` ([sandbox page:598-600](/app/v2/sandbox/[agentId]/page.tsx#L598-L600)), so the issues *should* render. The user-reported "ran successfully / fixed 5 items" headline most likely comes from the `autoCalibration.message` banner plus the grouped-issue count (5) being framed as handled. The exact component string was not pinned in this analysis — confirm via the FR12-style smoke test in the [Test plan](#test-plan) before editing copy, so we fix the real render path and not a guess.

### P2 — "No data found" mislabels a hard failure (calibration-owned)

The workflow returned empty output **because every Docs read 400'd**, not because the Contracts folder was empty. `DryRunValidator` *does* push an `execution_failed` critical issue (good — [DryRunValidator.ts:134-146](/lib/pilot/shadow/DryRunValidator.ts#L134-L146)), but the empty-vs-failed distinction is lost by the time it reaches the user as "no data found."

Relevant: `DryRunValidator.classifyWorkflowType()` maps this agent to `monitoring` (name/description contains "monitor"/"contract…ending"), and `isEmptyExpected('monitoring') === true` ([DryRunValidator.ts:211-235](/lib/pilot/shadow/DryRunValidator.ts#L211-L235)). For a *clean* empty run that's correct (a monitor with nothing to report is fine) — but here the emptiness is a **downstream symptom of all-items-failed**, which must never be presented as a benign "no data." The two states must be reported distinctly.

### P3 — Detected-but-unrepaired scatter field ref (calibration-owned gap)

The pre-flight `StructuralRepairEngine` **correctly detected** the broken reference (`doc_item.folder_id` references a non-existent variable, line 2173) but emitted only a **WARN** and produced **no auto-repair proposal**, because scatter *iteration* variable schemas are not reconciled — the WP-2 Phase-5 reconciler is scoped to step output schemas, not scatter item-refs (documented gap in the `contracts-googledocs-v2ui-pipeline-a` scenario `known_weaknesses`).

**Result:** calibration surfaces the failure as a critical issue the user can read but **cannot act on** — no fix button, no parameterization, nothing. This is the difference between "calibration caught it" and "calibration fixed it."

A generic, plugin-agnostic repair is possible here and within calibration's mandate (compiler-style normalization, not plugin-specific logic): when a scatter item-ref `{{item.X}}` resolves to `undefined` at dry-run AND the scatter's source array elements expose a field whose semantic role matches (e.g. the item objects carry `id` and the consuming param is a `*_id`/document/file identifier), propose rebinding to the correct field. Must be schema-driven and **surfaced as a proposal with before/after**, never a silent rewrite (calibration skill § 11).

### P4 — Upstream root cause: `doc_item.folder_id` (V6-owned)

Phase 1 (the only non-deterministic phase) emitted, for *this saved agent*, `google-docs.read_document` with `field: "folder_id"` for the file reference. Drive `list_files` items use `id`; `folder_id` is the **folder** step's output key, which the LLM reused for the **doc items**. Because the agent's stored step output_schema also carried `folder_id`, the V6 compiler's O10 reconciliation saw no mismatch.

This is the same defect family as WP-49/53/54 and the `contracts-googledocs-v2ui-pipeline-a` regression scenario — but note that scenario's committed snapshot is the **2026-06-01 re-run that emitted correctly**, so the bug does not reproduce statically. **This 06:13 run is a fresh live reproduction against the agent's persisted (buggy) DSL.** Per the v6-pipeline skill, the durable fix belongs in `intent-system-prompt-v2.ts` (steer Phase 1 to use the item's actual identifier field) and/or the binder/compiler scatter-ref reconciliation — tracked as a V6 weak point, **not** as plugin-specific logic in calibration.

> Calibration cannot un-break this specific agent by regeneration (that's a re-create flow). P3's repair proposal is the calibration-side mitigation; P4 prevents future agents from being generated this way.

---

## Proposed fixes

| # | Fix | Location | Owner | Risk |
|---|---|---|---|---|
| P1a | Set response `success` from outcome: `success: calibrationStatus === 'success'` (or a dedicated `status` field surfaced to the client). Do **not** hardcode `true`. | `batch/route.ts` ~L4216 | Calibration | 🟢 |
| P1b | Branch the user-facing `message` on `summary.critical`/`calibrationStatus`, not only `autoFixesApplied`. When critical > 0 and fixes = 0: honest "We found N issue(s) that need your attention before this agent is ready." | `batch/route.ts` ~L4222 | Calibration | 🟢 |
| P1c | Audit the no-issue success path ([sandbox page:587-600](/app/v2/sandbox/[agentId]/page.tsx#L587-L600)) and the banner component to ensure they key off `summary.critical`/`status`, not the `message` string. Confirm exact "fixed N" copy first (Test plan). | sandbox page + calibration UI | Calibration | 🟡 |
| P2 | Distinguish *clean-empty* from *empty-because-failed*: when `stepsFailed > 0` OR any scatter all-failed issue exists, never apply the `isEmptyExpected` benign framing. Tag the issue as `execution_failed`, not `empty_result`. | `DryRunValidator.ts` + `batch/route.ts` issue promotion (G-CAL-1 block ~L1029) | Calibration | 🟡 |
| P3 | Add a schema-driven, plugin-agnostic scatter item-ref repair proposal (detect undefined item-ref at dry-run → match against source array element fields by semantic role → surface before/after proposal). No silent rewrite. | new logic in `StructuralRepairEngine` / a detector under `lib/pilot/shadow/` | Calibration | 🔴 |
| P4 | Steer Phase 1 to reference the scatter item's real identifier field; and/or extend scatter-ref reconciliation. Open/extend a V6 weak point per the v6-pipeline skill. | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (+ binder/compiler) | V6 | 🔴 |

**Sequencing:** P1 first (highest impact, lowest risk — stops the lie). P2 next (clarifies the report). P3 and P4 are the deeper fixes; P4 should be filed as a V6 weak point and P3 covered by a regression scenario before merge.

---

## Task checklist

- [x] **P1a** — derive response `success`/`status` from `calibrationStatus`; stop hardcoding `success: true`. *(Done: `batch/route.ts` issues-path now returns `success:false` + `status: calibrationStatus`; semantic-issue path flipped to `success:false`; clean-success path gains explicit `status:'success'`.)*
- [x] **P1b** — make `autoCalibration.message` critical-aware. *(Done: message branches on `summary.critical`, never says "everything looked good" with open criticals.)*
- [x] **P1c** — fixed the render path. **Root cause was deeper than copy:** `CalibrationSetup`'s `criticalIssues`/`improvements` filters keyed off a stale raw-issue schema (`requiresUserInput`, `'parameter_error'`, …) while the API sends `UserFacingIssue` (`severity`/userFacing `category`). The predicate dropped **every** issue (`requiresUserInput` always undefined) → `hasIssues` always false → all-green success story on every run. Filters now trust the backend grouping (`severity !== 'will_auto_fix'`). Issue cards already read `title`/`message`, so no card change needed. **Live smoke test still required** (FR12-style) to confirm end-to-end.
- [x] **P2** — separate clean-empty from failed-empty in the calibration **success-branch UI**. The "No data found / ran successfully" message keyed off `failedSteps === 0`, which is unreliable (scatter failures are swallowed by WP-10/WP-54 without incrementing it). Replaced with a data-source-driven distinction in `CalibrationSetup.tsx`: `genuinelyNoData` (the source itself returned nothing → benign) vs `dataFoundButNotProcessed` (source returned items but none were delivered → a red "Found data, but couldn't process any of it" caution, never framed as success). **Scope note:** for the `8c7caa01` run the acute mislabel was actually fixed by **P1** — that run surfaces criticals so `hasIssues` is true and the success branch (incl. any "no data" message) never renders; its `execution_summary` was also `null`. P2 is therefore the defense-in-depth fix for runs that *do* reach the success branch with a populated summary. Backend `DryRunValidator` was left as-is: it already pushes `execution_failed` for `!success` (the all-failed path), and suppressing `empty_result` for genuinely-empty monitoring runs is correct. **Related gap (not fixed):** `execution_summary` is `null` on failed runs (the collector is skipped when the run throws), which limits post-failure diagnostics — separate enhancement.
- [ ] **P3** — schema-driven scatter item-ref repair *proposal* (surfaced, not silent); add a regression scenario covering it.
- [ ] **P4** — file a V6 weak point for the `folder_id` scatter-ref class; link to the `contracts-googledocs-v2ui-pipeline-a` scenario; implement prompt/binder fix per v6-pipeline skill protocol.
- [ ] Update `docs/Calibration/CALIBRATION_OVERVIEW.md` Change History + link this workplan.
- [ ] If P4 ships, follow the v6-pipeline "after fixing a V6 bug" protocol (WEAK_POINTS row, OPEN_ITEMS removal, design-principles update if a new pattern emerged).

## Test plan

1. **Repro baseline (mandatory live smoke test):** run calibration on `8c7caa01` via `/v2/sandbox/8c7caa01-e328-4b0a-ae04-afbcd10add45`; capture the exact UI strings and the `/api/v2/calibrate/batch` JSON body. This pins P1c.
2. **P1/P2 unit:** assert the route response for a `needs_review` outcome has a non-success `status`/`success:false` and a critical-aware `message`; assert `DryRunValidator` tags empty-after-failure as `execution_failed`, and only tags clean-empty monitoring runs as benign.
3. **P3 unit + regression:** `npx jest lib/pilot/shadow`; add a scenario where a scatter item-ref is undefined at dry-run and assert a repair *proposal* (with before/after) is produced and surfaced (not auto-applied silently).
4. **Convergence/history:** confirm `calibration_history` row reflects the true status and the UI shows the issues as blocking (no "all good" banner) — `monitor-calibration.sh`.
5. **`npx tsc --noEmit`** clean on touched files.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-07 | P2 implemented | `CalibrationSetup.tsx` success-branch now distinguishes `genuinelyNoData` (benign) from `dataFoundButNotProcessed` (red caution) using `execution_summary.data_sources_accessed` counts instead of the unreliable `failedSteps === 0`. Found that `8c7caa01`'s acute symptom was already resolved by P1 (criticals surface → success branch never renders) and its `execution_summary` was `null`; P2 is defense-in-depth for populated-summary success runs. Backend `DryRunValidator` left as-is (already correct). Noted related gap: `execution_summary` null on failed runs. |
| 2026-06-03 | P1 implemented | P1a/P1b in `app/api/v2/calibrate/batch/route.ts` (honest `success`/`status` + critical-aware message). P1c in `components/v2/calibration/CalibrationSetup.tsx` — found the real cause: issue filters used a stale raw-issue schema vs the `UserFacingIssue` payload, dropping all issues and forcing the success story; filters now trust backend grouping via `severity`. Also noted: `IssueGroups` is typed `CollectedIssue[]` but runtime is `UserFacingIssue` (type-lie, separate cleanup); dead `CalibrationDashboard` has the same stale filter. Live smoke test pending. |
| 2026-06-03 | Created | Analysis of the `8c7caa01` false-success calibration run; identified P1 (unconditional `success:true` + fix-count-only message), P2 (empty-vs-failed conflation), P3 (detected-but-unrepaired scatter ref), P4 (upstream V6 `folder_id` emission). Fixes proposed, not yet implemented. |
