# Calibration System — Overview & Doc Index

> **Last Updated**: 2026-06-02
> **Status**: Living index. Update the Change History when adding, archiving, or superseding docs.
> **Location**: All live calibration docs are consolidated under `docs/Calibration/`. Superseded fix-notes live under `docs/archive/`.

## Overview

After an agent is generated (V6 pipeline), **calibration** is the post-creation process that runs the workflow with real input, detects structural and runtime issues across three validation layers, attempts deterministic auto-repair, surfaces remaining issues to the user in a story-driven wizard, and records the outcome to `calibration_history` for analytics and fast-path skipping on subsequent runs.

This document is **an index** — every section links out to the authoritative doc for its topic. Read this first; follow the links you need.

---

## Table of Contents

- [Architecture at a Glance](#architecture-at-a-glance)
- [Code Anchors](#code-anchors)
- [Reading Path](#reading-path)
- [Doc Index by Area](#doc-index-by-area)
  - [Foundations](#foundations)
  - [Data Model & Lifecycle](#data-model--lifecycle)
  - [Detection Layers](#detection-layers)
  - [Repair Engines](#repair-engines)
  - [Hardcode Sub-system](#hardcode-sub-system)
  - [UX](#ux)
  - [Operations](#operations)
- [Undocumented Components](#undocumented-components)
- [Dead Code / Cleanup Backlog](#dead-code--cleanup-backlog)
- [Archived](#archived)
- [Change History](#change-history)

---

## Architecture at a Glance

```
User clicks "Run Calibration" (post-agent-creation)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Fast-path check: workflow_hash matches last success?    │  → CALIBRATION_STATUS_TRACKING
│   Yes → single verification run, skip iterations        │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Calibration loop (max 10 iterations, convergence-gated) │  → CONVERGENCE_DETECTION + CHECKPOINT_ROLLBACK
│                                                         │
│   Layer 1: Deterministic schema validation (~100 ms)    │  → AUTO_REPAIR_CONFIG_AND_PARAMS
│   Layer 2: Semantic validation (LLM)                    │  → LAYER2_NESTED_FIELD_DETECTION
│                                                            ACTION_MISMATCH_DETECTION
│   Layer 3: Dry-run execution with real input            │  → LAYER3_DRY_RUN_IMPLEMENTATION
│                                                         │
│   Structural repair (multi-step gaps)                   │  → MULTI_STEP_STRUCTURAL_REPAIR_FRAMEWORK
│   Hardcode detection & parameterization                 │  → HARDCODE_REPAIR_SYSTEM
│                                                         │
│   Auto-fix proposals applied silently                   │
│   Remaining issues collected for user                   │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Story-driven wizard surfaces unfixed issues to user     │  → UX_REDESIGN_STORY_DRIVEN
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Outcome persisted to calibration_history + agents.*     │  → CALIBRATION_HISTORY_IMPLEMENTATION
└─────────────────────────────────────────────────────────┘
```

---

## Code Anchors

| Concern | Location |
|---|---|
| Batch calibration API (live entry point) | [app/api/v2/calibrate/batch/route.ts](/app/api/v2/calibrate/batch/route.ts) |
| Live calibrate APIs | `batch`, `apply-fixes`, `load-configuration`, `save-configuration` under [app/api/v2/calibrate/](/app/api/v2/calibrate/) |
| Deprecated/uncalled calibrate APIs | `auto-fix`, `preview`, `inspect`, `rollback`, `session/[id]` — see [Dead Code / Cleanup Backlog](#dead-code--cleanup-backlog) |
| Shadow detectors / repair | [lib/pilot/shadow/](/lib/pilot/shadow/) |
| History repository | [lib/repositories/CalibrationHistoryRepository.ts](/lib/repositories/CalibrationHistoryRepository.ts) |
| Session repository | [lib/repositories/CalibrationSessionRepository.ts](/lib/repositories/CalibrationSessionRepository.ts) |
| Workflow hash utility | [lib/utils/workflowHash.ts](/lib/utils/workflowHash.ts) |
| Calibration metrics | [lib/utils/calibrationMetrics.ts](/lib/utils/calibrationMetrics.ts) |
| UI components | [components/v2/calibration/](/components/v2/calibration/) |
| Migrations | `supabase/migrations/20260428_*calibration*` |

---

## Reading Path

If you have **30 minutes** and want to understand the feature end-to-end:

1. [shadow-critic-architecture.md](/docs/Calibration/shadow-critic-architecture.md) — umbrella design (Shadow Agent, hold/fix/resume, intent validator).
2. [CALIBRATION_IMPLEMENTATION_SUMMARY.md](/docs/Calibration/CALIBRATION_IMPLEMENTATION_SUMMARY.md) — what was built, files modified, schema overview.
3. [CALIBRATION_STATUS_TRACKING.md](/docs/Calibration/CALIBRATION_STATUS_TRACKING.md) — fast-path skip logic.
4. [MULTI_STEP_STRUCTURAL_REPAIR_FRAMEWORK.md](/docs/Calibration/MULTI_STEP_STRUCTURAL_REPAIR_FRAMEWORK.md) + [MULTI_STEP_STRUCTURAL_REPAIR_IMPLEMENTATION.md](/docs/Calibration/MULTI_STEP_STRUCTURAL_REPAIR_IMPLEMENTATION.md) — repair coverage model + Phase 1 impl.
5. [CHECKPOINT_ROLLBACK.md](/docs/Calibration/CHECKPOINT_ROLLBACK.md) + [CONVERGENCE_DETECTION.md](/docs/Calibration/CONVERGENCE_DETECTION.md) — loop safety.
6. [UX_REDESIGN_STORY_DRIVEN.md](/docs/Calibration/UX_REDESIGN_STORY_DRIVEN.md) — user-facing wizard.

---

## Doc Index by Area

### Foundations

| Doc | Summary |
|---|---|
| [shadow-critic-architecture.md](/docs/Calibration/shadow-critic-architecture.md) ⭐ | Umbrella design: Shadow Agent + Business Insights + Pre-Execution Intent Validator. Defines hold/fix/resume model the calibration loop builds on. |
| [shadow-critic-implementation-plan.md](/docs/Calibration/shadow-critic-implementation-plan.md) | Original implementation plan for the shadow-critic subsystem. |
| [shadow-critic-memory-system-deep-dive.md](/docs/Calibration/shadow-critic-memory-system-deep-dive.md) | Deep dive on the shadow memory system (companion to the architecture doc). |
| [CALIBRATION_IMPLEMENTATION_SUMMARY.md](/docs/Calibration/CALIBRATION_IMPLEMENTATION_SUMMARY.md) ⭐ | Calibration-specific hub: files created/modified, schema overview, links to design docs. **Start here for the data/code side.** |

### Data Model & Lifecycle

| Doc | Summary |
|---|---|
| [POST_CREATION_CALIBRATION_FLOW.md](/docs/Calibration/POST_CREATION_CALIBRATION_FLOW.md) ⭐ | Post-creation flow: the `/v2/agents/new` prompt, background run + result email, the `agents.calibration_status` gate, the provider-agnostic email transport, and calibration outbound-message marking + recipient redirect. Flag: `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION`. |
| [CALIBRATION_HISTORY_IMPLEMENTATION.md](/docs/Calibration/CALIBRATION_HISTORY_IMPLEMENTATION.md) ⭐ | `calibration_history` table, `CalibrationHistoryRepository`, removed columns from `agents`, analytics view. |
| [CALIBRATION_STATUS_TRACKING.md](/docs/Calibration/CALIBRATION_STATUS_TRACKING.md) ⭐ | Fast-path: when `workflow_hash` matches a previous `status='success'`, run a single verification instead of full 3-iteration loop. |
| [CALIBRATION_TABLES_ANALYSIS.md](/docs/Calibration/CALIBRATION_TABLES_ANALYSIS.md) | Why three calibration objects coexist: `calibration_sessions` (active runs), `calibration_history` (analytics), `calibration_success_metrics` (view). |
| [CALIBRATION_DATA_COMPLETENESS_ANALYSIS.md](/docs/Calibration/CALIBRATION_DATA_COMPLETENESS_ANALYSIS.md) | What's currently tracked vs. what's missing (v6_version, model_used, plugins_used, complexity_score). |
| [CALIBRATION_PRODUCTION_READY_GAP_ANALYSIS.md](/docs/Calibration/CALIBRATION_PRODUCTION_READY_GAP_ANALYSIS.md) | Two issues: empty `calibration_success_metrics` view until migration applied, and skip-logic for already-production-ready workflows. |

### Detection Layers

| Doc | Summary | Layer |
|---|---|---|
| [AUTO_REPAIR_CONFIG_AND_PARAMS.md](/docs/Calibration/AUTO_REPAIR_CONFIG_AND_PARAMS.md) | Silent auto-repair for invalid `{{config.X}}` refs and missing required parameters (both common V6 generation bugs). | 1 |
| [LAYER1_ROOT_LEVEL_ARRAY_PRIORITY.md](/docs/Calibration/LAYER1_ROOT_LEVEL_ARRAY_PRIORITY.md) | Layer-1 priority handling for root-level arrays. | 1 |
| [LAYER2_NESTED_FIELD_DETECTION.md](/docs/Calibration/LAYER2_NESTED_FIELD_DETECTION.md) | Semantic validator detects fields referenced at wrong nesting level (e.g. `attachments` at root instead of `emails[].attachments`). | 2 |
| [ACTION_MISMATCH_DETECTION.md](/docs/Calibration/ACTION_MISMATCH_DETECTION.md) | Detects wrong plugin action based on parameter signature (e.g. `get_or_create_folder` with upload params → `upload_file`). | 2 |
| [SCATTER_GATHER_ERROR_PATTERNS.md](/docs/Calibration/SCATTER_GATHER_ERROR_PATTERNS.md) | Pattern library (1a–1e) for scatter-gather parameter-mismatch error messages. | 2 |
| [LAYER3_DRY_RUN_IMPLEMENTATION.md](/docs/Calibration/LAYER3_DRY_RUN_IMPLEMENTATION.md) | Executes workflow with real input data to catch type mismatches and empty results that schema validation cannot. | 3 |
| [MISSING_ACTION_AUTO_REPAIR.md](/docs/Calibration/MISSING_ACTION_AUTO_REPAIR.md) | Repairs V6-generated steps missing the `action` field. | any |

### Repair Engines

| Doc | Summary |
|---|---|
| [MULTI_STEP_STRUCTURAL_REPAIR_FRAMEWORK.md](/docs/Calibration/MULTI_STEP_STRUCTURAL_REPAIR_FRAMEWORK.md) ⭐ | Framework spec — 8 structural issue types, coverage matrix across Layers 1/2/3. Phase 1 implemented (see impl doc). |
| [MULTI_STEP_STRUCTURAL_REPAIR_IMPLEMENTATION.md](/docs/Calibration/MULTI_STEP_STRUCTURAL_REPAIR_IMPLEMENTATION.md) | Phase 1 of `MultiStepStructuralDetector.ts` — schema-output mismatch + missing intermediate flatten. Plugin-agnostic. |
| [MISSING_FLATTEN_STEP_DETECTION.md](/docs/Calibration/MISSING_FLATTEN_STEP_DETECTION.md) | Detection + auto-insertion of intermediate flatten steps. Logic lives in `MultiStepStructuralDetector`. |
| [STRUCTURAL_REPAIR_TRANSFORMATION_INTEGRATION.md](/docs/Calibration/STRUCTURAL_REPAIR_TRANSFORMATION_INTEGRATION.md) | Two-phase integration of `StructuralRepairEngine` into the calibration pre-flight pipeline — creates auto-repair proposals (e.g. `fields` object → `values` 2D array). |
| [CHECKPOINT_ROLLBACK.md](/docs/Calibration/CHECKPOINT_ROLLBACK.md) ⭐ | Saves agent state before each iteration; detects regression (issue count rising) and rolls back. |
| [CONVERGENCE_DETECTION.md](/docs/Calibration/CONVERGENCE_DETECTION.md) ⭐ | `Map<stepId, Set<fixType>>` tracking — prevents infinite fix-revert-refix loops before hitting `MAX_ITERATIONS=10`. |

### Hardcode Sub-system

The hardcode sub-system runs **inside** calibration but has its own self-contained design.

| Doc | Summary |
|---|---|
| [HARDCODE_REPAIR_SYSTEM.md](/docs/Calibration/HARDCODE_REPAIR_SYSTEM.md) ⭐ | Architecture — generic detector for resource IDs, business logic, configuration values. |
| [HARDCODE_DETECTION_V3_FINAL.md](/docs/Calibration/HARDCODE_DETECTION_V3_FINAL.md) ⭐ | **Authoritative approach**: reads `enhanced_prompt.specifics.resolved_user_inputs` from V6 instead of patterns/heuristics. Confirmed in [HardcodeDetector.ts:183](/lib/pilot/shadow/HardcodeDetector.ts#L183). |
| [HARDCODE_REPAIR_FLOW.md](/docs/Calibration/HARDCODE_REPAIR_FLOW.md) | End-to-end user-journey flow diagram (first calibration → failure → modal → parameterization). |

> The earlier `HARDCODE_DETECTION_V2_SIMPLIFIED.md` is superseded by V3 and now lives in [docs/archive/](/docs/archive/).

### UX

| Doc | Summary |
|---|---|
| [UX_REDESIGN_STORY_DRIVEN.md](/docs/Calibration/UX_REDESIGN_STORY_DRIVEN.md) ⭐ | Story-driven wizard concept — proactive, non-technical guidance replacing the reactive error modal. **Shipped** — the live entry is [CalibrationSetup.tsx](/components/v2/calibration/CalibrationSetup.tsx), which renders [CalibrationStory.tsx](/components/v2/calibration/CalibrationStory.tsx). |
| [CALIBRATION_FORM_FIX.md](/docs/Calibration/CALIBRATION_FORM_FIX.md) | Fix to always show input form before calibration (was conditional on issues being present). Small UX fix. |

### Operations

| Doc | Summary |
|---|---|
| [CALIBRATION_RCA_RUNBOOK.md](/docs/Calibration/CALIBRATION_RCA_RUNBOOK.md) | **Methodical RCA procedure for a failed calibration** (any agent ID): gather evidence → earliest-step/cascade → classify the root-cause layer → conclude. Backs the `calibration-rca` skill; companion script `scripts/dump-calibration.ts`. |
| [CALIBRATION_VALIDATION_MONITORING.md](/docs/Calibration/CALIBRATION_VALIDATION_MONITORING.md) | Expected Layer 1 / Layer 2 log sequences during a calibration run. |
| [CALIBRATION_LOG_GUIDE.md](/docs/Calibration/CALIBRATION_LOG_GUIDE.md) | Quick reference: `monitor-calibration.sh`, what log lines indicate Multi-Step Detection success/failure. |

---

## Undocumented Components

These shadow components exist in code but have no dedicated doc. Listed here so future contributors know to look at the source directly:

| Component | Location | What it does (from source) |
|---|---|---|
| `ShadowAgent` | [lib/pilot/shadow/ShadowAgent.ts](/lib/pilot/shadow/ShadowAgent.ts) | Top-level shadow orchestrator. |
| `RepairEngine` | [lib/pilot/shadow/RepairEngine.ts](/lib/pilot/shadow/RepairEngine.ts) | Applies repair proposals. |
| `IssueCollector` / `IssueGrouper` | [lib/pilot/shadow/](/lib/pilot/shadow/) | Collect issues during execution, group/prioritize for the wizard. |
| `ConstrainedSemanticValidator` | [lib/pilot/shadow/ConstrainedSemanticValidator.ts](/lib/pilot/shadow/ConstrainedSemanticValidator.ts) | Layer-2 LLM validator with structured-output constraints. Instantiates `MultiStepStructuralDetector`. |
| `ScatterGatherFlowValidator` | [lib/pilot/shadow/ScatterGatherFlowValidator.ts](/lib/pilot/shadow/ScatterGatherFlowValidator.ts) | Scatter-gather-specific data-flow validation. |
| `FailureClassifier` | [lib/pilot/shadow/FailureClassifier.ts](/lib/pilot/shadow/FailureClassifier.ts) | Classifies execution failures by error code/shape. |
| `SmartLogicAnalyzer` | [lib/pilot/shadow/SmartLogicAnalyzer.ts](/lib/pilot/shadow/SmartLogicAnalyzer.ts) | Detects logic issues across workflow steps. |
| `ResumeOrchestrator` / `ExecutionProtection` / `DataDecisionHandler` | [lib/pilot/shadow/](/lib/pilot/shadow/) | Hold/resume orchestration after fixes. |
| `userFacing` / `friendlyLanguage` | [lib/pilot/shadow/](/lib/pilot/shadow/) | Issue → user-readable copy. |

If you add a dedicated doc for any of these, link it here and remove the row.

---

## Dead Code / Cleanup Backlog

A dead-code audit (2026-06-02) found a sizeable unreferenced surface in the calibration code. **Nothing has been deleted** — this is a removal-candidate list pending sign-off. The live UI entry is `CalibrationSetup` (rendered from the sandbox page); the older `CalibrationDashboard` and `WorkflowPreview` UI trees have been superseded and are no longer rendered.

**Confidently dead (zero non-test references):**

| Item | Location |
|---|---|
| `ConfidenceCalculator` (empty 0-byte file) | `lib/pilot/shadow/ConfidenceCalculator.ts` |
| `ExecutionSummaryCard` | `components/v2/calibration/ExecutionSummaryCard.tsx` |
| `RequirementCoverageCard` | `components/v2/calibration/RequirementCoverageCard.tsx` |
| `CalibrationQualityBadge` | `components/v2/calibration/CalibrationQualityBadge.tsx` |
| `WorkflowHealthCard` | `components/v2/calibration/WorkflowHealthCard.tsx` |
| `CalibrationStoryView` | `components/v2/wizard/CalibrationStoryView.tsx` |

**Possibly dead (reachable only via other dead code, or deprecated stub routes — needs human judgment):**

- Superseded UI tree: `CalibrationDashboard` (imported for its *type* exports only — component never rendered) → `CalibrationWizard`, `AutoRepairCard`, `IssueCard`.
- Superseded UI tree: `WorkflowPreview` → `DataFlowDiagram`, `StepPreviewCard`; and `AutoFixProgress` → `UserQuestionCard`.
- Deprecated/uncalled API routes: `auto-fix` (stub, only caller is dead `AutoFixProgress`), `preview` (stub, only caller is dead `WorkflowPreview`), `inspect` (stub, zero callers), `rollback` (no client caller), `session/[id]` (no client caller).
- Unused exports in `lib/utils/calibrationMetrics.ts`: `calculateWorkflowComplexity`, `wasFirstExecutionSuccessful` (consumed only by dead `WorkflowHealthCard`).

---

## Archived

Point-in-time fix notes from the early-2026 calibration push, moved to [docs/archive/](/docs/archive/). Content is preserved there (and in commit history); not needed to understand the feature today.

[CALIBRATION_AUTO_FIX_NEEDED.md](/docs/archive/CALIBRATION_AUTO_FIX_NEEDED.md) ·
[CALIBRATION_DATA_TRANSFORMATION_FIX.md](/docs/archive/CALIBRATION_DATA_TRANSFORMATION_FIX.md) ·
[CALIBRATION_FIXES_APPLIED.md](/docs/archive/CALIBRATION_FIXES_APPLIED.md) ·
[FINAL_FIXES_SUMMARY.md](/docs/archive/FINAL_FIXES_SUMMARY.md) ·
[TRANSFORMATION_FIX_SUMMARY.md](/docs/archive/TRANSFORMATION_FIX_SUMMARY.md) ·
[GOOGLE_SHEETS_FIX_SUMMARY.md](/docs/archive/GOOGLE_SHEETS_FIX_SUMMARY.md) ·
[AMBIGUOUS_NUMBER_EXTRACTION_FIX.md](/docs/archive/AMBIGUOUS_NUMBER_EXTRACTION_FIX.md) ·
[calibration-errors-found.md](/docs/archive/calibration-errors-found.md) ·
[workflow-analysis.md](/docs/archive/workflow-analysis.md) ·
[STRUCTURAL_REPAIR_ROOT_LEVEL_FIX.md](/docs/archive/STRUCTURAL_REPAIR_ROOT_LEVEL_FIX.md) ·
[HARDCODE_DETECTION_V2_SIMPLIFIED.md](/docs/archive/HARDCODE_DETECTION_V2_SIMPLIFIED.md)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-27 | Post-creation flow doc | Added [POST_CREATION_CALIBRATION_FLOW.md](/docs/Calibration/POST_CREATION_CALIBRATION_FLOW.md) under Data Model & Lifecycle — the post-creation prompt, background run + email, `agents.calibration_status` gate, provider-agnostic email transport, and calibration outbound marking + recipient redirect. |
| 2026-06-02 | Consolidated docs + audit | Moved all live calibration docs from repo root and `docs/` into `docs/Calibration/` (30 docs incl. this index); moved 11 superseded fix-notes to `docs/archive/`. Fixed stale "Planned" headers on the multi-step framework + missing-flatten docs. Added Dead Code / Cleanup Backlog section from the 2026-06-02 audit. Rewrote all index links to new paths. |
| 2026-05-24 | Created | Initial overview/index covering 22 docs across root + `docs/`. Confirmed Phase 1 of multi-step framework is implemented, hardcode V3 is the live approach, and story-driven UX is shipped. |
