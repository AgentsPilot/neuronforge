# Effort Estimator Workplan

> **Last Updated**: 2026-06-11 (UserProfileRepository runtime fix)

**Developer:** Dev
**Requirement:** [EFFORT_ESTIMATOR_REQUIREMENT.md](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md)
**Feature branch:** `feature/effort-estimator` (cut from main `6d08cb9` by RM)
**Status:** ✅ **CODE COMPLETE — AWAITING USER REVIEW** (2026-06-10)

---

## 🔖 SESSION PAUSE STATE — 2026-06-08

Cycle paused mid-revision. User is finishing unrelated calibration work on a separate branch. **All decisions are locked; only the BA edit-to-requirement-MD and final RM commit are outstanding.**

### Where the cycle stands

| Stage | Status | Notes |
|---|---|---|
| BA: gather requirements | ✅ DONE | Requirement MD committed to `feature/effort-estimator` as `75571a4` |
| Dev: write workplan | ✅ DONE | This file. Revisions applied for SA blockers (Revisions 1-5 below) |
| SA: review workplan | ✅ DONE | NEEDS REVISION → user approved all fixes → revisions applied → **needs SA re-confirmation** |
| BA: apply 3 requirement-MD edits | ⬜ BLOCKED | Could not run — was on wrong branch. Edits listed below. |
| RM: commit revised workplan | ⬜ BLOCKED | Workplan is untracked on the wrong branch right now. |
| SA: re-confirm workplan | ⬜ PENDING | After Dev revisions land in commit |
| Dev: implement | ⬜ PENDING | Blocked by SA re-confirmation |
| SA: code review | ⬜ PENDING | |
| QA: test | ⬜ PENDING | |
| RM: final commit + PR | ⬜ PENDING | |
| Dev: mark old `updateAgentROI` deprecated | ⬜ PENDING | Now in-scope (guard fix at line 884) |
| Decide: delete or keep deprecated writer | ⬜ PENDING | Post-release |

### File state at pause (verified 2026-06-08)

| File | Branch | Status |
|---|---|---|
| `docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md` | `feature/effort-estimator` | ✅ Committed as `75571a4`. Missing the 3 BA edits below. |
| `docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md` (this file) | wherever the working tree is | ⚠️ **UNTRACKED.** Contains Dev's revisions for SA blockers (1388 lines). At risk if user runs `git clean -f`. |

User was last on `fix/calibration-false-success` to do calibration work. The workplan file follows the working tree as untracked.

### Locked-in user decisions (do not re-ask)

- Naming: `roi_estimate` (existing slot name, not `roi_estimation`)
- Option B selected: net-new `lib/effort-estimator/` module + deprecate `BusinessInsightGenerator.updateAgentROI`
- Schema: `{ reasoning, is_bulk_workflow, total_manual_time_seconds, confidence?, generated_at, model, version }`
- Override behavior: always overwrites; logs `{ agent_id, old_value, new_value, reason, correlationId }` at INFO
- Retry: 3 attempts, exponential backoff (1s/4s/16s), 30s total budget; on exhaustion leave slot null
- Model: DB-driven via `system_settings_config.effort_estimator_model`, default `gpt-4o-mini`, via provider factory
- Persona: adaptive from `user_context.domain` + `role` via `buildUserContextFromAuth` fast path; generic SMB owner fallback
- Feature flag: `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR`, ON in dev, OFF in prod
- Audit event: `EFFORT_ESTIMATE_GENERATED`
- Trigger: post-V6-IC save + on prompt edits + API on-demand. NOT MetricsCollector auto-fire, NOT render-time, NOT cron.
- Approved post-SA-review: guard fix in `BusinessInsightGenerator.ts:884` is in-scope; Open Follow-Ups #11 (`AgentRepository.mergeAgentConfig` RPC) and #12 (V6 persists `enhanced_prompt`) added

### Outstanding BA edits to apply to requirement MD (file lives on `feature/effort-estimator`)

1. **Deprecation section** — add sub-bullet: extend guard at `BusinessInsightGenerator.ts:884` to check `agent_config.roi_estimate` exists before overwrite (currently only `manual_time_per_item_seconds` guarded at line 876). 2-line code change. Required for AC-4 to pass.
2. **Open Follow-Ups** — append #11: `AgentRepository.mergeAgentConfig` RPC for atomic JSONB merge (race-condition fix).
3. **Open Follow-Ups** — append #12: persist V6 `enhanced_prompt` to `agents.enhanced_prompt` (estimator quality lever).
4. **Change History** — add a row for 2026-06-07 capturing all three edits above.

Full prompt copy for these edits is preserved in this workplan's history (the team-leader → BA delegation that failed because branch was wrong).

### SA blocking items Dev resolved in this workplan (revisions 1-5)

1. Added explicit `BusinessInsightGenerator.ts:884` guard-extension work item in file-by-file list + Execution Order phase 8.
2. Fixed Risk #4 regen gate to read from `agentData` (request body, line 169 of PUT route) instead of `updateData` (post-whitelist, lines 262-283).
3. Promoted `lib/effort-estimator/dispatch.ts` from "consider" to "required NEW file" — single source of truth for the new fire-and-forget pattern (CLAUDE.md rule #7).
4. Added "Known v1 limitations" section documenting the create-then-quick-edit race + reference to Open Follow-Up #11.
5. Reclassified all Risks: #1 RESOLVED, #5 RESOLVED-as-v1-limitation, #6 RESOLVED-informational with forward reference to Open Follow-Up #12.

### 📋 RESUME INSTRUCTIONS — what to say in the next session

> **Resume prompt to paste at session start:**
>
> ```
> Resume the Effort Estimator feature cycle. Read docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md
> top section (SESSION PAUSE STATE) for full context. Verify we are on the
> feature/effort-estimator branch and the workplan file is intact. Then:
>
> 1. Have RM commit the current workplan to feature/effort-estimator (it is
>    untracked at pause time — commit it cleanly without bundling any
>    calibration WIP).
> 2. Have BA apply the 4 outstanding edits to docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md
>    (listed in SESSION PAUSE STATE section), then RM commits.
> 3. Have SA re-confirm the workplan revisions (it issued NEEDS REVISION on the
>    first pass — needs to verify Revisions 1-5 satisfy its blockers).
> 4. Once SA APPROVES_FOR_IMPLEMENTATION, kick off Dev implementation.
>
> Recreate the task list per the SESSION PAUSE STATE status table.
> ```

### First actions in the new session

1. Run `git branch --show-current && git log --oneline -3` to confirm where the working tree is.
2. If not on `feature/effort-estimator`: ask user before switching. **Important:** the user routinely works on multiple cycles in parallel; never assume it's safe to discard, stash, or commit anything you didn't author this session.
3. If the workplan is untracked, RM's first job is to commit it (with the SESSION PAUSE STATE section in place — it's part of the audit trail).

---

## ⏳ Post-Release Decision Required — updateAgentROI delete-or-keep

**Status:** Open. Owner: user. Deferred per cycle plan; revisit one release window after 2026-06-11.

**The decision:** `lib/pilot/insight/BusinessInsightGenerator.updateAgentROI` is marked `@deprecated 2026-06-10` but NOT deleted. The Effort Estimator now owns the `agent_config.roi_estimate` write path; the deprecated writer carries two self-guards (line 901 column-level + line 916 nested-JSONB) preventing it from overwriting fresh estimates. After one release window (target: ~end of June 2026), decide:

- **Delete** — drop `updateAgentROI` + its call site + the test. Cleaner blast radius; loses fallback if Effort Estimator turns out broken in production.
- **Keep** — leave as fallback. Adds ongoing maintenance burden; preserves the safety net.

**Inputs to weigh at decision time:**
- Production observability data on `EFFORT_ESTIMATE_GENERATED` audit event rate vs agent-creation rate (AC-1's ≥95% target).
- Whether any consumer fell through to the deprecated path (audit log would show).
- Whether other follow-ups (#8, #9) require touching this code anyway.

**Pointer:** Requirement MD § Open Follow-Ups #1.

---

## Overview

This workplan implements the **Effort Estimator** module per the BA-authored requirement at [`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md). The module estimates work-savings (time) for newly created / regenerated agents by simulating an SMB-owner persona via LLM, using the enhanced prompt + `user_context` (domain + role) as inputs. Output lands in `agent_config.roi_estimate` — the existing slot already consumed by `MetricsCollector` and `BusinessInsightGenerator.calculateROIMetrics`. The estimator fires fire-and-forget from the V6 agent-save hook and is also exposed as `POST /api/v2/agents/[id]/estimate-effort` for on-demand recomputation. Cost-savings ($) is out of scope.

The new module replaces the LLM-persona logic currently embedded in `BusinessInsightGenerator.buildBusinessInsightPrompt`. The legacy `updateAgentROI()` writer is marked deprecated but its `manual_time_per_item_seconds`-guard is preserved so old + new paths do not fight during the deprecation window.

---

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [File-by-file task list](#file-by-file-task-list)
3. [Type definitions](#type-definitions)
4. [LLM prompt skeleton](#llm-prompt-skeleton)
5. [Persona resolution rules](#persona-resolution-rules)
6. [Retry mechanism design](#retry-mechanism-design)
7. [Override behavior + logging](#override-behavior--logging)
8. [Async fire pattern](#async-fire-pattern)
9. [Failure semantics](#failure-semantics)
10. [API endpoint](#api-endpoint)
11. [DB-driven model selection](#db-driven-model-selection)
12. [Feature flag](#feature-flag)
13. [Audit trail](#audit-trail)
14. [Deprecation work](#deprecation-work)
15. [Tests](#tests)
16. [Acceptance criteria mapping](#acceptance-criteria-mapping)
17. [Risks / unknowns](#risks--unknowns)
18. [Known v1 limitations](#known-v1-limitations)
19. [Execution order](#execution-order)
20. [SA Review Notes](#sa-review-notes)
21. [QA Testing Report](#qa-testing-report)
22. [Commit Info](#commit-info)
23. [Change History](#change-history)

---

## Architecture overview

> **SA Review (2026-06-04)** — APPROVE: Module layout, separation of concerns, and the choice to build a purpose-fit `retryWithBackoff` rather than reuse `withProviderFallback` are all sound. Each file has a single clear responsibility and matches existing project patterns (cf. `lib/agentkit/v6/config/AgentGenerationConfigService.ts` for the cached DB-config pattern).

### Module layout

```
lib/effort-estimator/
├── index.ts                       # Barrel export: estimateEffort, dispatchEffortEstimate, EffortEstimator type re-exports
├── types.ts                       # ROIEstimate, EffortEstimatorInput, EffortEstimatorResult
├── EffortEstimator.ts             # Public class / function: estimate(input) → Promise<EffortEstimatorResult>
├── buildEffortPrompt.ts           # System + user prompt construction (persona-aware)
├── personaResolver.ts             # Resolve persona string from UserContext
├── modelResolver.ts               # Resolve model from system_settings_config (cached)
├── retryWithBackoff.ts            # 3-attempt 1s/4s/16s exponential backoff (30s budget)
├── dispatch.ts                    # REQUIRED: fire-and-forget single-source-of-truth helper
│                                  # (flag check + dynamic import + void + .catch); used by
│                                  # V6 save site + PUT regen handler. Synchronous API
│                                  # endpoint does NOT use this (it awaits estimateEffort).
└── __tests__/
    ├── personaResolver.test.ts
    ├── retryWithBackoff.test.ts
    ├── buildEffortPrompt.test.ts
    ├── dispatch.test.ts            # flag OFF → not called; flag ON → called once
    └── EffortEstimator.test.ts     # mocked provider + AgentRepository
```

### Data flow

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/create-agent           (V6 save site)                  │
│ app/api/create-agent/route.ts:197  agentRepository.create(...)   │
│ app/api/create-agent/route.ts:229  auditLog(AGENT_CREATED)       │
│                                                                  │
│ ── NEW: after successful create, BEFORE the response returns ──  │
│                                                                  │
│   // dispatcher handles flag check + void + .catch internally    │
│   dispatchEffortEstimate({                                       │
│     agentId: data.id,                                            │
│     userId: agentUserIdToUse,                                    │
│     enhancedPrompt: data.enhanced_prompt ?? data.user_prompt,    │
│     userContext: buildUserContextFromAuth(user),                 │
│     correlationId,                                               │
│     reason: 'agent_created'                                      │
│   }, requestLogger);                                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼ (fire-and-forget)
┌─────────────────────────────────────────────────────────────────┐
│ EffortEstimator.estimate()                                       │
│  1. Resolve persona from userContext (personaResolver)           │
│  2. Resolve model from system_settings_config (modelResolver)    │
│  3. Build prompt (buildEffortPrompt)                             │
│  4. Call provider via ProviderFactory.getProvider(provider)      │
│     wrapped in retryWithBackoff (1s/4s/16s, 30s budget)          │
│  5. Parse + validate response with Zod                           │
│  6. Read current agent_config via AgentRepository.findById       │
│  7. Merge new roi_estimate into agent_config (JSONB partial)     │
│  8. Write via AgentRepository.update (NEW: extend UpdateAgentInput│
│     to accept agent_config, OR add a dedicated method —          │
│     see Risk #3)                                                 │
│  9. Log override at INFO with { agent_id, old_value, new_value,  │
│     reason, correlationId }                                      │
│ 10. auditLog(EFFORT_ESTIMATE_GENERATED) — non-blocking            │
│                                                                  │
│ On retry exhaustion → log error + leave slot untouched           │
│ (per AC-2: roi_estimate remains null — do NOT write sentinel)    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼ (later, at execution time — UNCHANGED)
┌─────────────────────────────────────────────────────────────────┐
│ MetricsCollector reads agent_config.roi_estimate at              │
│ lib/pilot/MetricsCollector.ts:198-223                            │
│  - If is_bulk_workflow → uses total_manual_time_seconds          │
│  - Else → falls back to per-item multiplication                  │
└─────────────────────────────────────────────────────────────────┘
```

### V6 save call site (cited from recon)

The canonical "after V6 IntentContract is finalized and the agent is saved" point is:

- **File:** `app/api/create-agent/route.ts`
- **Line 197:** `const { data, error: repoError } = await agentRepository.create(agentInput as any);`
- **Line 229:** `auditLog({ action: 'AGENT_CREATED', entityType: 'agent', entityId: data.id, ... })` — non-blocking, fire-and-forget pattern already in use.

The estimator's async dispatch hooks in **immediately after the audit log call** (line 250-ish, before the input-values save block) so it runs in parallel with the rest of the response handling and never blocks the user's response. This is the same fire-and-forget pattern already established by the audit log.

For regeneration (prompt edits / workflow re-compile), the corresponding entry point is `PUT /api/agents/[id]` in `app/api/agents/[id]/route.ts:142+`. **In v1 scope we hook the create path only**; regen wiring is noted in Risk #4 — Dev will add an identical async dispatch in the PUT handler if SA confirms regeneration is in scope for this cycle (the requirement says yes — trigger #2 — but the cleanest path is to extract the dispatch into a thin helper that both routes call).

> **SA Review (2026-06-04)** — NEEDS CHANGE (HIGH PRIORITY): The PUT handler at `app/api/agents/[id]/route.ts:142-387` does **not** use `AgentRepository`. It calls Supabase directly with the service-role client (see lines 194-199, 303-309). This has two consequences for the workplan:
>
> 1. It is a pre-existing CLAUDE.md mandatory-rule-#1 violation (direct Supabase calls outside the repository layer). It is NOT the estimator cycle's job to fix — but the workplan should explicitly flag that the PUT handler is a "deprecated / non-repo-compliant" code path and note it in Open Follow-Ups so it doesn't get inherited as the estimator's responsibility later.
> 2. More importantly: the workplan must NOT extend deprecated patterns. Dev's proposed regen dispatch (Risk #4) needs to either (a) hook into the PUT handler's existing flow as a strict consumer (no DB calls added to the handler beyond what's there), which is fine, OR (b) hook at a higher-level service layer if one exists. (a) is acceptable for this cycle.
>
> Also: the cited "line 250-ish" is correct. Confirmed against the actual file — `auditLog(AGENT_CREATED)` runs at line 229, and the input-values block starts at line 252.

---

## File-by-file task list

### New files

| File | Purpose | Status | Key exports |
|------|---------|--------|-------------|
| `lib/effort-estimator/index.ts` | Barrel | ✅ | `estimateEffort`, `EffortEstimator`, `dispatchEffortEstimate`, `ROIEstimate`, `ROIEstimateV1Schema`, `EffortEstimatorInput`, `EffortEstimatorResult`, `ROI_ESTIMATE_SCHEMA_VERSION` |
| `lib/effort-estimator/types.ts` | Typed interfaces + Zod schemas | ✅ | `ROIEstimateV1Schema`, `LLMResponseSchema`, `ROIEstimate`, `EffortEstimatorInput`, `EffortEstimatorResult`, `ROI_ESTIMATE_SCHEMA_VERSION` |
| `lib/effort-estimator/EffortEstimator.ts` | Orchestrator: prompt → LLM (retry) → parse → merge-write → audit | ✅ | `estimateEffort(input)`, class `EffortEstimator` |
| `lib/effort-estimator/buildEffortPrompt.ts` | System + user prompt assembly | ✅ | `buildEffortPrompt({ persona, enhancedPrompt, userContext })` |
| `lib/effort-estimator/personaResolver.ts` | UserContext → persona string + lenient post-LLM scan | ✅ | `resolvePersona`, `verifyReasoningMentionsPersona` |
| `lib/effort-estimator/modelResolver.ts` | Read `effort_estimator_model` from `system_settings_config` (cached, 5min TTL) — uses `supabaseServer` singleton (SA #7) | ✅ | `resolveEffortEstimatorModel()`, `clearModelCache()`, `DEFAULT_MODEL` |
| `lib/effort-estimator/retryWithBackoff.ts` | 3 attempts, delays [1s/4s/16s], 30s budget; `attempts===3` on exhaustion (SA #6) | ✅ | `retryWithBackoff<T>(fn, opts?)` |
| `lib/effort-estimator/dispatch.ts` | **SSoT helper for the fire-and-forget pattern.** IIFE-wraps the dynamic import so import-throws also route through `.catch` (SA #13). | ✅ | `dispatchEffortEstimate(input, logger): void` |
| `lib/effort-estimator/__tests__/personaResolver.test.ts` | Unit — 4 branches + lenient role-OR-domain scan (SA #4) | ✅ | — |
| `lib/effort-estimator/__tests__/retryWithBackoff.test.ts` | Unit — success-on-1/2/3, exhaustion (`attempts===3`), budget cutoff, isRetryable abort | ✅ | — |
| `lib/effort-estimator/__tests__/buildEffortPrompt.test.ts` | Unit — persona verbatim, schema field names, sparse-context handling | ✅ | — |
| `lib/effort-estimator/__tests__/modelResolver.test.ts` | **Dedicated AC-8 test row** (SA #2) — missing row + error + various value shapes + cache + clear | ✅ | — |
| `lib/effort-estimator/__tests__/EffortEstimator.test.ts` | Orchestrator — happy / override / exhaustion / JSON retry / missing-persona / not-found | ✅ | — |
| `lib/effort-estimator/__tests__/dispatch.test.ts` | **AC-7** — flag OFF → no call; flag ON → call once; rejection → non-blocking error log | ✅ | — |
| `app/api/v2/agents/[agentId]/estimate-effort/route.ts` | `POST` API. **Route param is `[agentId]` not `[id]`** to match existing v2/agents convention. | ✅ | `POST` handler |
| `app/api/v2/agents/[agentId]/estimate-effort/__tests__/route.test.ts` | Integration: 401 / 400 / 201 happy / 404 / 503 / 500 | ✅ | — |
| `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` | **AC-4 cross-cutting** — deprecated path skips when `existingROI` present | ✅ | — |
| `tests/effort-estimator/scripts/run-on-agent.ts` | **AC-8 integration test tooling** — developer-facing CLI runner that executes the production estimator end-to-end against an existing agent. Loads env from `.env.local`, reads `user_id` from the agent row (no `--user-id` override per Safety #2), hydrates `EffortEstimatorInput` (with `enhanced_prompt` → `agent_config.enhanced_prompt` → `user_prompt` fallback chain), builds `user_context` via the full `buildUserContextFromProfile` path, then calls `estimateEffort` and re-reads to confirm the write. `--dry-run` short-circuits before the LLM call + DB write. **Updated 2026-06-11:** added per-run JSON-Lines log file output via `pino.multistream` + stdout-tee for estimator child loggers; new `--log-dir` flag; RUN_SUMMARY final line; fsync-on-exit. | ✅ | `main()` entry |
| `tests/effort-estimator/README.md` | One-page operator guide — prerequisites, usage examples for dry-run + live mode, expected output blocks, safety rules, common gotchas (including the Open Follow-Up #9 `enhanced_prompt` fallback note), bug-reporting pointers. Mirrors the structure of the v6-regression scripts README. **Updated 2026-06-11:** added "Per-run log file" section + `--log-dir` flag row. | ✅ | — |

### Files modified

| File | Action | Reason | Status |
|------|--------|--------|--------|
| `lib/utils/featureFlags.ts` | ~~Added `useEffortEstimator()` reading `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR`; also included in `getFeatureFlags()` return.~~ **REVERTED 2026-06-10** — feature flag was a BA-convention add, not user-requested. Helper, env-var, and `getFeatureFlags()` entry all removed. See [User Code Review Revisions — 2026-06-10](#user-code-review-revisions--2026-06-10). | Feature flag per requirement | ❌ DESCOPED (see Open Follow-Up #10) |
| `app/api/create-agent/route.ts` | Imports `dispatchEffortEstimate` + `buildUserContextFromAuth`; calls `dispatchEffortEstimate(...)` immediately after `auditLog(AGENT_CREATED)`. Passes `enhanced_prompt ?? user_prompt ?? undefined` so the estimator's enhanced-prompt fallback chain is intact. | Wire estimator into V6 save hook via the SSoT helper | ✅ |
| `app/api/agents/[id]/route.ts` (PUT handler) | ~~Imports `createLogger`, `dispatchEffortEstimate`, `buildUserContextFromAuth`. After the audit-log block, evaluates `promptOrWorkflowChanged` against `agentData` (line 169) per Risk #4 with value-comparison tightening on `user_prompt` and `workflow_steps`. Wraps the entire block in `try/catch`. Pre-existing direct-Supabase usage explicitly flagged out-of-scope inline.~~ **REVERTED 2026-06-10** — Trigger #2 (automatic regeneration on prompt edit) descoped to v2. PUT handler is now byte-identical to `2f6433c`. See [User Code Review Revisions — 2026-06-10](#user-code-review-revisions--2026-06-10). | Wire trigger #2 (regeneration) via the SSoT helper | ❌ DESCOPED (see Open Follow-Up #10) |
| `lib/audit/events.ts` | Added `EFFORT_ESTIMATE_GENERATED: 'EFFORT_ESTIMATE_GENERATED'` to `AUDIT_EVENTS` (after `AGENT_CONFIG_SAVED`) + `EVENT_METADATA` row with `severity: 'info', complianceFlags: ['SOC2']` | New audit event | ✅ |
| `lib/repositories/types.ts` | Extended `UpdateAgentInput` with `agent_config?: Record<string, unknown> \| null`. `manual_time_per_item_seconds?` (SA #11) NOT added — out of scope until the deprecated writer is deleted. | Allow repository writes of `agent_config` | ✅ |
| `lib/pilot/insight/BusinessInsightGenerator.ts` | (1) Inserted the `existingROI` presence guard at the `agent_config.roi_estimate` write (was line ~884; new lines 907-928): `if (roiEstimate.total_manual_time_seconds && !existingROI)` + `else if (existingROI)` DEBUG-log branch. (2) Added `@deprecated 2026-06-10` JSDoc on `updateAgentROI`. (3) Added the "CRITICAL: self-guard — do NOT remove" comment above the line-876 manual-time guard. (4) Added a `@deprecated` note in the JSDoc of `buildBusinessInsightPrompt` scoping the deprecation to the "ROI Estimate Guidelines" prompt block (HTML-comment placement inside the LLM prompt string was reconsidered — see "Implementation notes" below — and moved to a JS-level JSDoc instead). | AC-4 root-cause fix + deprecation — no deletion this cycle | ✅ |
| `.gitignore` (repo root) | Added `tests/effort-estimator/logs/` under a new comment header next to the existing `simulators/**/output/` line. Repo-root placement matches the project convention for test-output folders (no nested `.gitignore`s elsewhere in `tests/`). | Prevent per-run log files from being committed | ✅ |

> **SA Review (2026-06-04)** — APPROVE with caveat: The file-by-file list is accurate. One missed file: `lib/utils/featureFlags.ts` also needs `useEffortEstimator` added to the `getFeatureFlags()` return object at lines 134-141 (Dev mentions this in the Feature flag section but doesn't list it here). Minor — Dev can fix during implementation. Also confirm the dispatch helper extraction (mentioned in [Async fire pattern](#async-fire-pattern)) — strongly recommended given two call sites; see comment there.

### Files explicitly NOT modified

- `lib/pilot/MetricsCollector.ts` — consumer must keep working unchanged. Our output schema preserves the fields it reads at lines 198-223 (`is_bulk_workflow`, `total_manual_time_seconds`).
- `lib/pilot/insight/BusinessInsightGenerator.ts` `calculateROIMetrics` (lines 241+) — untouched per requirement.

---

## Type definitions

`lib/effort-estimator/types.ts`:

```typescript
import { z } from 'zod';
import type { UserContext } from '@/lib/user-context';

/**
 * Schema version for the persisted ROIEstimate JSON.
 * Bump this when the on-disk shape changes so future migrations are unambiguous.
 */
export const ROI_ESTIMATE_SCHEMA_VERSION = '1' as const;

/**
 * The exact JSON shape written to `agent_config.roi_estimate`.
 * Must remain backward-compatible with the reader at
 * lib/pilot/MetricsCollector.ts:198-223 (which reads
 * `roi_estimate.is_bulk_workflow` and `roi_estimate.total_manual_time_seconds`).
 */
export const ROIEstimateV1Schema = z.object({
  reasoning: z.string().min(1),                       // MUST mention persona name (AC-3)
  is_bulk_workflow: z.boolean(),                      // explicit flag, NOT inferred
  total_manual_time_seconds: z.number().nonnegative(),
  confidence: z.union([z.string(), z.number()]).optional(),
  generated_at: z.string().datetime(),
  model: z.string().min(1),
  version: z.literal(ROI_ESTIMATE_SCHEMA_VERSION),
});

export type ROIEstimateV1 = z.infer<typeof ROIEstimateV1Schema>;

/**
 * The active version alias — current consumers should import this name.
 * When v2 lands, change this to `ROIEstimateV2 | ROIEstimateV1` (union) and
 * add a migration adapter in the reader.
 */
export type ROIEstimate = ROIEstimateV1;

/**
 * Input to the estimator.
 *
 * `enhancedPrompt` is the V6 IntentContract enhanced prompt when available,
 * falling back to `user_prompt`. The estimator MUST tolerate sparse data
 * (empty strings allowed but logged) — the LLM still produces a generic
 * estimate, with this fact surfaced in `reasoning`.
 */
export interface EffortEstimatorInput {
  agentId: string;
  userId: string;
  enhancedPrompt: string;
  userContext: UserContext;
  correlationId: string;
  reason: 'agent_created' | 'agent_regenerated' | 'api_request';
}

export interface EffortEstimatorResult {
  success: boolean;
  estimate?: ROIEstimate;
  previousEstimate?: ROIEstimate | null;
  errorMessage?: string;
  attempts: number;
  totalDurationMs: number;
}
```

**Note vs. legacy `ROIEstimate` at `lib/pilot/insight/BusinessInsightGenerator.ts:50-54`:** The legacy type had `manual_time_per_item_seconds` (required) and an optional `total_manual_time_seconds`. Our new schema flips the contract: `total_manual_time_seconds` is **required**, and `is_bulk_workflow` is an explicit boolean rather than inferred from "is `total_manual_time_seconds` present?". This matches the requirement's output schema table exactly and decouples persistence from the old per-item flow. The legacy `manual_time_per_item_seconds` column on the `agents` table is **not touched** in this cycle (Open Follow-Up #6).

> **SA Review (2026-06-04)** — APPROVE: Schema versioning, Zod-first validation, explicit `is_bulk_workflow` boolean (decoupled from presence-of-field inference), and the type-name collision with the legacy `ROIEstimate` are all handled cleanly via the new module's namespace. Confirmed against `MetricsCollector.ts:198-201` — it reads `roi_estimate.is_bulk_workflow` and `roi_estimate.total_manual_time_seconds` as separate fields, so the new explicit-boolean schema is forward-compatible with the existing reader. No consumer changes needed.

---

## LLM prompt skeleton

`lib/effort-estimator/buildEffortPrompt.ts`. Final wording is Dev's call during implementation — only the SHAPE is locked here.

```typescript
export interface BuildPromptArgs {
  persona: string;                          // from personaResolver
  userContext: UserContext;                 // for any field-level interpolation
  enhancedPrompt: string;                   // V6 IntentContract output OR user_prompt fallback
}

export function buildEffortPrompt(args: BuildPromptArgs): {
  system: string;
  user: string;
} {
  // SYSTEM PROMPT shape (final wording TBD by Dev):
  //   - Role: "You are simulating {persona}, estimating manual time savings."
  //   - Task: estimate `total_manual_time_seconds` for one full workflow run
  //   - Granularity rule: average bulk vs per-item; record decision in reasoning
  //   - Persona requirement: the chosen persona MUST appear verbatim in `reasoning`
  //   - Output requirement: respond with ONLY a JSON object matching the schema
  //     (no markdown, no commentary outside JSON)
  //   - Conservative bias: prefer under-estimates over over-estimates
  //
  // USER PROMPT shape:
  //   - "Workflow to estimate:" + enhancedPrompt
  //   - "User context (omit fields you don't need):" + non-empty userContext fields only
  //     (sparse-context handling per requirement)
  //   - Reiterate output JSON schema with field names + types

  // Implementation note: build the JSON schema description from
  // ROIEstimateV1Schema (zod-to-json-schema or hand-written) so the prompt
  // stays in sync with the validator.
}
```

**No plugin-specific or workflow-specific hardcoding** in the prompt (per CLAUDE.md "No Hardcoding in System Prompts"). The prompt reasons generically about manual time.

> **SA Review (2026-06-04)** — APPROVE: Locking only the shape (not the wording) is the right call — final wording is implementation detail. The note about no plugin-specific hardcoding aligns with CLAUDE.md § "No Hardcoding in System Prompts". The implementation should generate the JSON schema description from `ROIEstimateV1Schema` (e.g., via `zod-to-json-schema`) to keep prompt and validator in sync — Dev already calls this out.

---

## Persona resolution rules

`lib/effort-estimator/personaResolver.ts`:

```typescript
export function resolvePersona(userContext: UserContext): string {
  const domain = userContext.domain?.trim();
  const role = userContext.role?.trim();

  if (domain && role) {
    return `${role} at a ${domain} SMB`;
  }
  if (domain) {
    return `SMB owner in ${domain}`;
  }
  if (role) {
    return `${role} at an SMB`;
  }
  return 'generic SMB owner';
}
```

**Contract:** the persona string returned here MUST appear verbatim somewhere in the LLM's `reasoning` field (enforced by the prompt itself + verified by a post-hoc unit test that scans the reasoning for `persona.toLowerCase()` substring match). If the LLM omits it, the estimator still writes the estimate but logs at `WARN` level with `{ persona, reasoning }` so prompt drift is observable.

> **SA Review (2026-06-04)** — APPROVE: Branching logic is straightforward and unit-testable. The post-hoc verbatim scan + WARN-log-on-miss is a sensible drift detector (write through, observe). One nit for AC-3: the requirement says "references the inferred SMB-owner persona BY NAME (e.g., 'logistics-ops manager')". The current resolver produces `"logistics-ops manager at a marketing SMB"` etc. — verify that the substring scan tolerates the LLM paraphrasing slightly (e.g., "as a logistics-ops manager"). A pure `toLowerCase().includes(persona)` may be too strict. Recommend scanning for the **role** OR **domain** keyword rather than the full persona string — more robust. Non-blocking.

---

## Retry mechanism design

**Decision: build a small dedicated utility at `lib/effort-estimator/retryWithBackoff.ts`** rather than reuse `lib/agentkit/v6/utils/ProviderFallback.ts:withProviderFallback`.

**Why not reuse `withProviderFallback`:** That helper does **provider fallback** (anthropic → openai) on top of retries, with hard-coded provider semantics (`'anthropic' | 'openai'`). It doesn't match our spec:
- Spec retry budget is 30s total — `withProviderFallback` doesn't enforce a global budget.
- Spec delays are `1s / 4s / 16s` — `withProviderFallback` defaults are `1s / 2s / 4s` with `maxDelayMs: 10000`.
- We don't want auto-fallback to a different provider; spec says "use the DB-configured model".

**Why not reuse `lib/pilot/ErrorRecovery.ts`:** that file targets pilot step recovery, not LLM call retries. Different concern.

A purpose-built utility is ~30 lines, fully typed, and matches the spec exactly:

```typescript
export interface RetryOpts {
  delaysMs?: number[];        // default [1000, 4000, 16000]
  totalBudgetMs?: number;     // default 30000
  isRetryable?: (err: unknown) => boolean; // default: retry all errors
  onAttempt?: (attempt: number, lastError?: unknown) => void;
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  attempts: number;
  totalDurationMs: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {}
): Promise<RetryResult<T>> {
  const delays = opts.delaysMs ?? [1000, 4000, 16000];
  const budget = opts.totalBudgetMs ?? 30000;
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < delays.length + 1; attempt++) {
    if (Date.now() - start > budget) break;
    opts.onAttempt?.(attempt, lastError);
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt + 1, totalDurationMs: Date.now() - start };
    } catch (err) {
      lastError = err;
      if (opts.isRetryable && !opts.isRetryable(err)) break;
      const delay = delays[attempt];
      if (delay === undefined) break;                          // out of attempts
      const remaining = budget - (Date.now() - start);
      if (remaining <= 0) break;                               // budget exhausted
      await new Promise(r => setTimeout(r, Math.min(delay, remaining)));
    }
  }

  return { ok: false, error: lastError, attempts: delays.length + 1, totalDurationMs: Date.now() - start };
}
```

After exhaustion: see [Failure semantics](#failure-semantics) — slot is **left untouched** (NOT written with null/sentinel).

> **SA Review (2026-06-04)** — APPROVE: Building a purpose-fit utility is the right call (rationale against reusing `ProviderFallback` is solid). One bug in the proposed code: the loop bound is `attempt < delays.length + 1` (4 iterations) but a successful return inside the try happens before any delay; the **last** attempt (#3, zero-indexed) will try to read `delays[3]` which is `undefined`, hitting the `delay === undefined` break — correct behavior, but it means `attempts` returned on exhaustion is `delays.length + 1 = 4`, not 3. The requirement says "3 attempts". Tighten the contract: either return `delays.length` (3) on exhaustion OR rewrite the loop to `attempt < delays.length` and accept the off-by-one in test #4(c). Non-blocking but verify in the test (#4(c) currently says "Exhausts after 3 attempts" — make sure it asserts `attempts === 3`, not `4`).

---

## Override behavior + logging

When the estimator writes a new `roi_estimate`:

1. **Read** the current agent via `AgentRepository.findById(agentId, userId)`.
2. Extract `oldValue = current.agent_config?.roi_estimate ?? null`.
3. Merge: `newAgentConfig = { ...current.agent_config, roi_estimate: newEstimate }`.
4. **Write** via `AgentRepository.update(agentId, userId, { agent_config: newAgentConfig })`.
   - Requires extending `UpdateAgentInput` (see [File-by-file task list](#file-by-file-task-list) — Risk #3).
5. **Log override** at INFO:

```typescript
requestLogger.info({
  agent_id: agentId,
  old_value: oldValue,        // null if first time
  new_value: newEstimate,
  reason: input.reason,       // 'agent_created' | 'agent_regenerated' | 'api_request'
  correlationId,
}, 'Effort estimator wrote agent_config.roi_estimate');
```

Pseudocode (read-modify-write):

```typescript
const repo = new AgentRepository();
const { data: agent, error: readErr } = await repo.findById(agentId, userId);
if (readErr || !agent) {
  logger.error({ err: readErr, agentId, correlationId }, 'Cannot read agent for estimator write');
  return { success: false, attempts, totalDurationMs };
}
// KNOWN v1 LIMITATION: this read-modify-write is NOT atomic against a concurrent
// updater. See "Known v1 limitations" section of the workplan + requirement MD
// Open Follow-Up #11 (`AgentRepository.mergeAgentConfig` RPC for atomic JSONB
// merge). The create-then-quick-edit race (estimator dispatch #1 in flight when
// dispatch #2 from a PUT regen reads `agent_config` and writes its own snapshot)
// is acceptable for v1: the INFO log on every override exposes when stale-write
// happens, so the limitation is observable rather than silent.
const currentConfig = (agent.agent_config as Record<string, unknown>) ?? {};
const previousEstimate = (currentConfig.roi_estimate as ROIEstimate | undefined) ?? null;
const newConfig = { ...currentConfig, roi_estimate: newEstimate };

const { error: writeErr } = await repo.update(agentId, userId, { agent_config: newConfig });
if (writeErr) {
  logger.error({ err: writeErr, agentId, correlationId }, 'AgentRepository.update failed');
  return { success: false, previousEstimate, attempts, totalDurationMs };
}
logger.info({ agent_id: agentId, old_value: previousEstimate, new_value: newEstimate, reason, correlationId }, 'Effort estimator wrote agent_config.roi_estimate');
```

**Concurrency note (flag in Risks):** The read-modify-write is **not** atomic against a concurrent updater. For v1 this is acceptable because (a) the only other writer of `agent_config.roi_estimate` is the deprecated `updateAgentROI` which has a self-guard (won't write if a value exists), and (b) the fire-and-forget dispatch from create-agent runs once per agent within seconds of creation, before any consumer can race it. If a real race is observed in dev, we'll switch to a Postgres RPC for safe JSONB merge — flagged as Risk #5.

> **SA Review (2026-06-04)** — QUESTION: I want to flag one race scenario Dev hasn't analyzed explicitly: user creates an agent (dispatch #1 fires async, takes ~5-10s for the LLM call), then the user IMMEDIATELY edits the prompt within those 10s (dispatch #2 fires from the PUT handler). Dispatch #1 reads `agent_config` snapshot A, dispatch #2 reads `agent_config` snapshot A' (with whatever the prompt edit added to `agent_config`, if anything). Whichever finishes second wins. If `dispatch #1` finishes after `dispatch #2`, the user's "regenerated" estimate gets overwritten by the stale "created" estimate — silently and confusingly. For v1 this is a low-probability edge case and acceptable, but it MUST be noted in the code comments at the merge site. Dev to add a TODO referring to a follow-up to (a) use an RPC for atomic JSONB merge, OR (b) include a monotonic `generated_at` check (refuse to overwrite a newer estimate). Non-blocking for this cycle but the comment must be in the code.

---

## Async fire pattern

The dispatcher at the call site must NOT block the user response.

### Single-source-of-truth helper (REQUIRED per SA review)

Per SA conditional approval (CLAUDE.md mandatory rule #7 — no net-new patterns without SA single-source-of-truth), the fire-and-forget dispatch is extracted into a **required** helper at `lib/effort-estimator/dispatch.ts`:

```typescript
// lib/effort-estimator/dispatch.ts
import type { Logger } from 'pino';
import type { EffortEstimatorInput } from './types';
import { useEffortEstimator } from '@/lib/utils/featureFlags';

/**
 * Fire-and-forget dispatcher for the Effort Estimator.
 *
 * Single source of truth for the net-new "void fn().catch(...)" pattern in
 * this project. Two async callers use it:
 *   (1) V6 save site in app/api/create-agent/route.ts (after auditLog AGENT_CREATED)
 *   (2) PUT regen handler in app/api/agents/[id]/route.ts (after successful update)
 *
 * The synchronous API endpoint at POST /api/v2/agents/[id]/estimate-effort
 * does NOT use this helper — it awaits estimateEffort() and returns the result
 * to the caller (so HTTP semantics drive the retry strategy).
 *
 * Notes on safety:
 *  - Wraps the whole flag check + import + estimate call in a synchronous
 *    IIFE chain so an import error (rare cold-start case) still routes
 *    through the .catch handler — addresses SA comment #13.
 *  - Caller is expected to pass a request-scoped child logger.
 */
export function dispatchEffortEstimate(input: EffortEstimatorInput, logger: Logger): void {
  if (!useEffortEstimator()) return;

  void (async () => {
    const { estimateEffort } = await import('./EffortEstimator');
    await estimateEffort(input);
  })().catch(err => {
    logger.error(
      { err, agentId: input.agentId, correlationId: input.correlationId, reason: input.reason },
      'Effort estimator dispatch failed (non-blocking)'
    );
  });
}
```

### Call sites

**V6 save site (`app/api/create-agent/route.ts`, post-`auditLog(AGENT_CREATED)`):**

```typescript
// Fire-and-forget effort estimator. Must NOT await; must NOT throw.
dispatchEffortEstimate({
  agentId: data.id,
  userId: agentUserIdToUse,
  enhancedPrompt: (data.enhanced_prompt as string) || data.user_prompt || '',
  userContext: buildUserContextFromAuth(user),
  correlationId,
  reason: 'agent_created',
}, requestLogger);
```

**PUT regen handler (`app/api/agents/[id]/route.ts`):**

```typescript
if (promptOrWorkflowChanged) {
  dispatchEffortEstimate({
    agentId: existingAgent.id,
    userId: user.id,
    enhancedPrompt: undefined, // estimator fetches via AgentRepository
    userContext: buildUserContextFromAuth(user),
    correlationId,
    reason: 'agent_regenerated',
  }, requestLogger);
}
```

**API endpoint (`POST /api/v2/agents/[id]/estimate-effort`):** does NOT use this dispatcher — it awaits `estimateEffort(...)` directly and returns the result.

### Why a dedicated helper

1. **SA mandate.** Per CLAUDE.md mandatory rule #7 (no new patterns without SA review), the fire-and-forget `void fn().catch(...)` shape is genuinely net-new (no pre-existing project usage; verified). SA conditionally approved on single-source-of-truth.
2. **Two callers** (V6 save site + PUT regen handler) duplicating ~15 lines of dispatch logic, audit/error semantics, and dynamic-import boilerplate would diverge.
3. **AC-7 test simplification.** Mock one function (`dispatchEffortEstimate` or `estimateEffort` via `jest.spyOn`) instead of two call sites.
4. **Safety:** the IIFE wrapping ensures that a rare dynamic-import throw still routes through the `.catch` (addresses SA comment #13).

Rationale for `void` + dynamic `import`:
- `void` makes the fire-and-forget intent explicit and silences `@typescript-eslint/no-floating-promises`.
- Dynamic `import` keeps the estimator's deps out of the hot path's cold-start bundle for the (currently) ~100% of requests where the flag may be OFF in prod. (Acceptable optimization; not load-bearing.)

> **SA Review (2026-06-04)** — NEEDS CHANGE: Make the dispatch helper extraction **required**, not optional. Reasons:
>
> 1. The fire-and-forget pattern (`void fn().catch(...)` with conditional dynamic imports) is **not** a pre-existing project pattern. I searched `lib/services/` and `app/api/` and found `void` only in unrelated declarations (TypeScript `: void` returns), not as a floating-promise idiom. This is genuinely net-new — and per CLAUDE.md mandatory rule #7 (no new patterns without SA review), my approval is conditional on **single-source-of-truth** to avoid divergence.
> 2. Two callers duplicating ~15 lines of dispatch logic, audit/error semantics, and dynamic-import boilerplate is a maintenance landmine. If the dispatch grows (e.g., backoff coalescing, request batching), the second copy will drift.
> 3. The helper makes the AC-7 test (flag-OFF → no fire) trivial — only one place to mock.
>
> Concretely: extract `dispatchEffortEstimate(args, logger)` into `lib/effort-estimator/dispatch.ts`. Both routes call it. The helper internally handles `useEffortEstimator()` gating, dynamic import, `void`-wrapping, and `.catch` logging.
>
> Also flag for code review: dynamic `import` inside an async-fire block has a subtle issue — if the import itself throws (rare but possible during cold-start with module-resolution issues), the `void` won't catch it because the throw happens inside the awaited expression that is being voided. Wrap the **whole** thing including the import in a synchronous `.catch()`-able promise chain: `void (async () => { ... })().catch(err => logger.error(...))`.

> **Dev response (2026-06-07)** — Acknowledged + applied above. `lib/effort-estimator/dispatch.ts` promoted from "consider" to "required" file (added to file-by-file task list as a NEW file and to the Module layout diagram). The helper wraps the flag check + dynamic import + estimate call in an IIFE chain so import-throw cases route through `.catch` (SA comment #13 addressed). Two async callers consume it (V6 save + PUT regen); the synchronous API endpoint awaits `estimateEffort` directly and does NOT use the dispatcher. User approved.

---

## Failure semantics

Per **AC-2** in the requirement MD:

> Given an LLM failure that exhausts retries, when the estimator finishes, then `agent_config.roi_estimate` remains `null` AND a structured error log entry exists with the `correlationId`.

**Decision: on retry exhaustion, leave the slot UNTOUCHED. Do NOT write a sentinel.**

Concretely:

- If LLM fails after 3 attempts (1s / 4s / 16s) or the 30s budget expires:
  - Do NOT call `AgentRepository.update`.
  - Do NOT call `auditLog(EFFORT_ESTIMATE_GENERATED)`.
  - Log at ERROR level: `logger.error({ err, agentId, correlationId, attempts, totalDurationMs }, 'Effort estimator exhausted retries — slot left untouched')`.
  - Return `{ success: false, errorMessage, attempts, totalDurationMs }` from the public `estimateEffort` function (the caller `void`s this, so it's purely for testing/the API route).

**Detection contract for consumers:**

| Slot state | Meaning |
|------------|---------|
| absent (`agent_config.roi_estimate === undefined`) | Estimator never ran OR ran-and-failed. The two states are observably identical at the slot level — distinguish via logs (which carry `correlationId` and `attempts`). |
| populated `ROIEstimateV1` | Estimator succeeded. |
| `null` | Should not occur via this path. The legacy `updateAgentROI` self-guard never writes `null` either. If you see `null`, it's a bug. |

The MetricsCollector reader already handles "undefined" gracefully (treats it the same as "not a bulk workflow" and falls through to per-item math at MetricsCollector.ts:213) — no consumer changes needed.

> **SA Review (2026-06-04)** — APPROVE: Leave-untouched semantics is correct. Verified against `MetricsCollector.ts:198-223` — `agentConfig?.roi_estimate` resolves to `undefined` when absent, `roiEstimate?.is_bulk_workflow` short-circuits to `false`, and the code falls through to per-item math gracefully. No null/sentinel write needed.
>
> One contract clarification: AC-2 in the requirement says "roi_estimate remains `null`". Dev correctly noticed this is an observable equivalence to "undefined" since the slot is never written. The detection contract table is the right call — make sure QA's AC-2 test asserts `agent.agent_config?.roi_estimate === undefined` (NOT `=== null`), otherwise the test will flag a false negative.

---

## API endpoint

`POST /api/v2/agents/[id]/estimate-effort`

`app/api/v2/agents/[id]/estimate-effort/route.ts`. Follows the canonical API Route Pattern from CLAUDE.md.

**Request:** no body (URL param `[id]` is the agent ID). Empty `{}` allowed.

```typescript
const RequestSchema = z.object({}).strict();   // empty body, reject extra fields
```

**Response (success):**

```typescript
{
  success: true,
  data: {
    agentId: string;
    estimate: ROIEstimateV1;            // the new estimate
    previousEstimate: ROIEstimateV1 | null;
    attempts: number;
    durationMs: number;
  }
}
```

**Response (failure modes):**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{ success: false, error: 'Unauthorized' }` | No session |
| 404 | `{ success: false, error: 'Agent not found' }` | `findById` returns null (also covers wrong-user; RLS-equivalent at the repository level) |
| 503 | `{ success: false, error: 'Estimator exhausted retries' }` | retryWithBackoff returned `ok: false` after 30s — slot left untouched |
| 500 | `{ success: false, error: 'Internal server error' }` | Unhandled |

**Handler skeleton:**

```typescript
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ route: '/api/v2/agents/[id]/estimate-effort', correlationId, agentId: params.id });
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });

    // Note: this endpoint awaits the estimator (unlike the create-agent dispatch
    // which is fire-and-forget). The 30s retry budget bounds the request.
    const result = await estimateEffort({
      agentId: params.id,
      userId: user.id,
      enhancedPrompt: '', // fetched inside the estimator from AgentRepository
      userContext: buildUserContextFromAuth(user),
      correlationId,
      reason: 'api_request',
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: 'Estimator exhausted retries' }, { status: 503 });
    }
    return NextResponse.json({ success: true, data: { ... } });
  } catch (err) {
    requestLogger.error({ err }, 'Effort estimator API route failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
```

**Note:** When called via API (vs. dispatch), the estimator must **fetch `enhanced_prompt` itself** from `AgentRepository.findById` rather than rely on the caller. The class is structured to accept `enhancedPrompt: ''` and re-fetch via the agentId+userId in that case. The dispatch-from-create-agent path bypasses this re-fetch by passing `enhancedPrompt` directly (saves a DB call when called inline post-create).

> **SA Review (2026-06-04)** — NEEDS CHANGE: Passing `enhancedPrompt: ''` as an in-band sentinel ("empty string = re-fetch") is a code smell. It conflates "the user really has no prompt" with "I want you to fetch the prompt yourself". Cleaner shape:
>
> ```typescript
> // Either:
> type EffortEstimatorInput = {
>   ...
>   enhancedPrompt?: string;  // optional; if undefined, estimator fetches
> };
> // Or:
> type EffortEstimatorInput = {
>   ...
>   enhancedPrompt: string | { fetch: true };  // explicit fetch signal
> };
> ```
>
> Recommend option 1 (`enhancedPrompt?: string`). The estimator's logic becomes: `const prompt = input.enhancedPrompt ?? (await repo.findById(...)).enhanced_prompt ?? agent.user_prompt ?? ''`. The empty-string-after-fallback is then the LLM's problem (it logs sparse-context).
>
> Update `EffortEstimatorInput` in the type definitions accordingly.
>
> APPROVE: The route returns 503 on retry exhaustion (rather than 200 with `success: false`) is correct — clients can retry on 503 per HTTP semantics, whereas 200-with-failure encourages clients to ignore.
>
> QUESTION: The Zod schema `RequestSchema = z.object({}).strict()` rejects extra fields with a 400. Good defensive choice but confirm that any future "force re-fetch" flag (e.g., `{ ignoreCache: true }`) won't be silently rejected — non-blocking for v1.

---

## DB-driven model selection

`lib/effort-estimator/modelResolver.ts`.

Resolution algorithm (mirrors `lib/agentkit/v6/config/AgentGenerationConfigService.ts:49-113` pattern):

```typescript
type ResolvedModel = { provider: 'openai' | 'anthropic'; model: string };

const DEFAULT: ResolvedModel = { provider: 'openai', model: 'gpt-4o-mini' };

let cache: { value: ResolvedModel; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function resolveEffortEstimatorModel(): Promise<ResolvedModel> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .eq('key', 'effort_estimator_model')
      .maybeSingle();

    if (error || !data) {
      logger.debug({ err: error }, 'effort_estimator_model row missing — using default gpt-4o-mini');  // AC-8
      cache = { value: DEFAULT, expiresAt: Date.now() + CACHE_TTL_MS };
      return DEFAULT;
    }

    // value shape: JSONB {"provider":"openai","model":"gpt-4o-mini"} OR a bare string '"gpt-4o-mini"'
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const resolved: ResolvedModel = (parsed && parsed.provider && parsed.model)
      ? { provider: parsed.provider, model: parsed.model }
      : { provider: 'openai', model: String(parsed) };

    cache = { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
    return resolved;
  } catch (err) {
    logger.debug({ err }, 'Effort estimator model resolution failed — using default gpt-4o-mini');
    return DEFAULT;
  }
}

export function clearModelCache() { cache = null; } // test helper
```

**Provider dispatch** at the LLM call site:

```typescript
const { provider, model } = await resolveEffortEstimatorModel();
const aiProvider = ProviderFactory.getProvider(provider);
const response = await aiProvider.chatCompletion({
  model,
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ],
  response_format: aiProvider.supportsResponseFormat ? { type: 'json_object' } : undefined,
  temperature: 0.2,
}, callContext);
```

`callContext` (per `CallContext` in `lib/ai/providers/baseProvider.ts:5-18`):
```typescript
{
  userId,
  feature: 'effort_estimator',
  component: 'EffortEstimator',
  activity_type: 'effort_estimation',
  activity_name: 'estimate_workflow_savings',
  agent_id: agentId,
}
```

> **SA Review (2026-06-04)** — APPROVE: `modelResolver` pattern correctly mirrors `AgentGenerationConfigService` (confirmed at `lib/agentkit/v6/config/AgentGenerationConfigService.ts:49-113`). The in-process 5-min cache is fine for serverless (cold-start re-reads, warm function reuses). The `CallContext` shape matches `BaseAIProvider.CallContext`. The graceful default-on-error is the right call.
>
> Minor concern: the cache is module-level (`let cache: ... | null = null`), which means it survives across requests on a warm Lambda but is duplicated per cold instance. That's fine for our use case (read-mostly config), but the test helper `clearModelCache()` is essential — confirmed it's already in the spec. Good.
>
> One missed item: the `createClient` direct call here bypasses the documented `supabaseServer` singleton. The existing `AgentGenerationConfigService` does the same thing, so this is consistent — but per CLAUDE.md security rule, document inline why service-role is intentional (reading system config requires bypass of user-scoped RLS). Recommend: use `supabaseServer` (the documented singleton from `@/lib/supabaseServer`) instead of `createClient(... SERVICE_ROLE ...)`. Dev's `route.ts` already imports it (line 5). Consistency win.

---

## Feature flag

Add to `lib/utils/featureFlags.ts`, following the existing pattern (`useV6AgentGeneration` at lines 79-83 is the closest sibling):

```typescript
/**
 * Check if the Effort Estimator is enabled.
 *
 * When enabled, the V6 agent-save hook fires the Effort Estimator
 * asynchronously to populate agent_config.roi_estimate.
 *
 * Defaults OFF until validated in dev. Enable via .env.local:
 *   NEXT_PUBLIC_USE_EFFORT_ESTIMATOR=true
 *
 * @returns {boolean} True if estimator is enabled
 */
export function useEffortEstimator(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_EFFORT_ESTIMATOR;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_EFFORT_ESTIMATOR', value: flag ?? null }, 'Feature flag evaluated');
  return parseBooleanFlag(flag, false);
}
```

Also add to `getFeatureFlags()` return at line 134-141.

**Verification for AC-7:** the dispatch site checks `if (useEffortEstimator())` before invoking; when OFF, the estimator is never imported or called. Tested by [Tests](#tests) item #5.

> **SA Review (2026-06-04)** — APPROVE: Confirmed against `lib/utils/featureFlags.ts:79-83` — `useV6AgentGeneration` reads `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` via `parseBooleanFlag(flag)` (defaults `false`). The new `useEffortEstimator()` follows exactly the same shape. The `.env.local` opt-in is consistent with the existing convention.
>
> Re: Risk #1 (default-OFF + dev override mechanics) — APPROVE the proposed approach (`.env.local` opt-in). Auto-flipping based on `NODE_ENV === 'development'` would create environment-dependent behavior, which is harder to debug. Explicit opt-in is correct.

---

## Audit trail

Add a new entry to `AUDIT_EVENTS` in `lib/audit/events.ts` under the "AGENT EVENTS" section:

```typescript
EFFORT_ESTIMATE_GENERATED: 'EFFORT_ESTIMATE_GENERATED',
```

Plus metadata in the events metadata map (existing pattern uses `getEventMetadata` from `lib/audit/events.ts`):

```typescript
[AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED]: {
  severity: 'info',
  description: 'Effort Estimator generated/overwrote agent_config.roi_estimate',
},
```

**Call shape** (placed inside `EffortEstimator.estimate()` after successful write, mirroring `app/api/create-agent/route.ts:229-250`):

```typescript
auditLog({
  action: AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED,
  entityType: 'agent',
  entityId: agentId,
  userId,
  severity: 'info',
  changes: {
    before: { roi_estimate: previousEstimate },
    after: { roi_estimate: newEstimate },
  },
  details: {
    reason,                            // 'agent_created' | 'agent_regenerated' | 'api_request'
    model: newEstimate.model,
    attempts: result.attempts,
    duration_ms: result.totalDurationMs,
    persona,                           // for offline persona-quality observation
    is_bulk_workflow: newEstimate.is_bulk_workflow,
    correlationId,
  },
}).catch(err => logger.error({ err, agentId, correlationId }, 'EFFORT_ESTIMATE_GENERATED audit failed (non-blocking)'));
```

> **SA Review (2026-06-04)** — APPROVE: Audit event registration confirmed against `lib/audit/events.ts`. The new event must be added BOTH to:
>   1. `AUDIT_EVENTS` const (line 24+, AGENT EVENTS section is correct location)
>   2. `EVENT_METADATA` record (line 221+) — Dev mentions this but doesn't show the exact insertion line; place it near `[AUDIT_EVENTS.AGENT_CONFIG_SAVED]` (line 243) since it's the closest semantic sibling.
>
> Use the existing project naming convention `AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED` in the audit call, NOT the bare string literal — the typed const enables type-checking via `AuditEvent` type (line 215).
>
> NEEDS CHANGE (PII / leakage): the `changes: { before, after }` block includes the full `reasoning` text from the LLM. That reasoning may include verbatim snippets of the user's prompt and persona. For an info-level audit on a non-sensitive agent operation this is acceptable, BUT:
>   - The override INFO log (in [Override behavior + logging](#override-behavior--logging)) also serializes the full `old_value` / `new_value` including reasoning. In production, log lines get aggregated to Vercel + monitoring tools. Recommend truncating `reasoning` to 500 chars in the log line (keep the full payload in the audit table). Add a `truncate(reasoning, 500)` helper at the log site.
>   - The `old_value` is fine to log (it's the agent's own prior state, not external user input).
>
> Non-blocking but should be addressed during implementation. Add a TODO if not done immediately.

---

## Deprecation work

Per requirement section "Deprecation of Old Path" (no deletion this cycle). **This section also contains the AC-4 root-cause fix surfaced by SA blocking item #1** — the deprecated path's existing self-guard protects `manual_time_per_item_seconds` (the top-level column), but the deprecated path ALSO writes `agent_config.roi_estimate` at line ~884 with no guard against an already-populated value. AC-4 would silently fail without the extension below.

**File:** `lib/pilot/insight/BusinessInsightGenerator.ts`

### 0. **Line ~884** — extend the `agent_config.roi_estimate` write with a presence guard (SA-blocking AC-4 fix)

The current code at lines 884-892 (approx) writes `agent_config.roi_estimate` whenever `roiEstimate.total_manual_time_seconds` is truthy, REGARDLESS of whether `agent_config.roi_estimate` already exists. Extend it as follows (2-line guard):

```typescript
// Don't overwrite a fresh roi_estimate written by the new effort estimator.
// The legacy self-guard at line 876 only checks manual_time_per_item_seconds —
// a different column. We need a dedicated check on agent_config.roi_estimate.
const existingROI = (agent.agent_config as Record<string, any> | null)?.roi_estimate;
if (roiEstimate.total_manual_time_seconds && !existingROI) {
  const agentConfig = (agent.agent_config as Record<string, any>) || {};
  agentConfig.roi_estimate = { ... };
  updateData.agent_config = agentConfig;
} else if (existingROI) {
  logger.debug(
    { agentId, existingROI },
    'deprecated path skipping write — fresh estimate already present'
  );
}
```

This is the only behavioral change in this file this cycle. The legacy `manual_time_per_item_seconds` guard at line 876 remains untouched (it protects a separate field), as does everything else.

### 1. **Line 866** — add JSDoc `@deprecated` tag on `updateAgentROI`:
   ```typescript
   /**
    * @deprecated 2026-06-04 — Replaced by lib/effort-estimator. This writer
    * is kept temporarily during the deprecation window so the existing
    * insights/ROI pipeline (which still calls it from generate() at line 216)
    * does not regress. The self-guard at line 876 (`manual_time_per_item_seconds` null-check)
    * MUST remain — it prevents this path from overwriting a fresh estimate
    * written by the new effort estimator. Final delete/keep decision is
    * tracked in EFFORT_ESTIMATOR_REQUIREMENT.md § Open Follow-Ups #1.
    *
    * Update agent's manual_time_per_item_seconds with ROI estimate from LLM
    * ...
    */
   ```

### 2. **Lines 549-577** (inside `buildBusinessInsightPrompt`, the "ROI Estimate Guidelines" block + the JSON shape at lines 529-534) — add an inline comment immediately above line 549:
   ```typescript
   // @deprecated 2026-06-04 — The ROI estimation responsibility has moved to
   // lib/effort-estimator. This prompt block stays during the deprecation
   // window so the existing insights pipeline keeps producing ROI estimates
   // for agents created before the new module was wired in. New code MUST NOT
   // extend this block — extend the new estimator's prompt at
   // lib/effort-estimator/buildEffortPrompt.ts instead.
   ```

### 3. **Line 876** — the self-guard `if (agent && (agent.manual_time_per_item_seconds === null || ...))` **STAYS UNCHANGED**. Add a one-line comment above it:
   ```typescript
   // CRITICAL: self-guard — do NOT remove. Prevents the deprecated path from
   // overwriting a fresh roi_estimate written by lib/effort-estimator.
   ```

**No deletion in this cycle.** The post-release decision (Open Follow-Up #1) determines whether the deprecated code stays or goes.

**AC-4 verification:** explicit test in [Tests](#tests) item #6 — exercises the deprecated path against an agent that already has `agent_config.roi_estimate` set by the new path and asserts the deprecated path SKIPS the write (DEBUG log emitted, no Supabase mutation).

> **SA Review (2026-06-04)** — NEEDS CHANGE: The self-guard at line 876 of `BusinessInsightGenerator.ts` is on the `manual_time_per_item_seconds` column, NOT on `agent_config.roi_estimate`. See Risk #5 detailed review for the exact code fix needed. AC-4 will FAIL without extending this guard. **BLOCKING.** This is the most important finding in this review.

> **Dev response (2026-06-07)** — Acknowledged. Added explicit guard-extension work item above (section 0) — guard at line ~884 now checks `!existingROI` before writing `agent_config.roi_estimate`, with a DEBUG log on skip. The legacy line-876 guard stays untouched (protects a separate column). User approved the 2-line fix. AC-4 acceptance mapping updated to point at Test #6 with the corrected assertion: "deprecated path skips write when fresh `roi_estimate` exists."

---

## Tests

### Unit tests

| # | File | What it tests |
|---|------|---------------|
| 1 | `lib/effort-estimator/__tests__/personaResolver.test.ts` | All 4 branches: domain+role, domain-only, role-only, neither. Asserts the exact persona strings from [Persona resolution rules](#persona-resolution-rules). |
| 2 | `lib/effort-estimator/__tests__/retryWithBackoff.test.ts` | (a) Success on attempt 1 — no delays. (b) Success on attempt 2 — 1s delay observed via fake timers. (c) Exhausts after 3 attempts — total ≈ 21s (1+4+16) and returns `ok: false`. (d) Budget cutoff: if `totalBudgetMs: 5000`, aborts before the 16s delay. (e) `isRetryable: () => false` aborts after 1 attempt. |
| 3 | `lib/effort-estimator/__tests__/buildEffortPrompt.test.ts` | (a) System prompt contains persona verbatim. (b) Sparse userContext: empty fields are omitted from the user prompt (no `"company": ""` lines). (c) JSON-schema description in prompt matches `ROIEstimateV1Schema` field names. |
| 4 | `lib/effort-estimator/__tests__/EffortEstimator.test.ts` | (a) Happy path: mocked provider returns valid JSON; estimator writes via mocked `AgentRepository.update` with merged config; audit log is fired non-blocking. (b) Override: existing `roi_estimate` is preserved as `previousEstimate` and the override log line includes `old_value` + `new_value`. (c) LLM exhausts retries → no `update` call, no audit log, error log with `correlationId`. (d) LLM returns invalid JSON → Zod throws → counted as a failed attempt → retried. (e) Reasoning missing persona → estimate is still written but a WARN log is emitted. |

### Integration tests

| # | File | What it tests |
|---|------|---------------|
| 5 | `app/api/v2/agents/[id]/estimate-effort/__tests__/route.test.ts` | (a) Happy: 200 with new estimate. (b) 401 when no session. (c) 404 when `findById` returns null (wrong-user proxy). (d) Slot-already-populated: override succeeds + override log includes old/new. (e) Retry exhaustion: 503 + no write. |

### Cross-cutting tests

| # | File | What it tests |
|---|------|---------------|
| 6 | `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` | **AC-4** — call deprecated `updateAgentROI()` against an agent whose `agent_config.roi_estimate` is already populated by the new effort estimator. Asserts (a) `agent_config` is NOT in the update payload, (b) the control case (no existing roi_estimate AND no manual_time) writes both fields, (c) the legacy `manual_time_per_item_seconds` guard still prevents ALL writes when the user already set that column. |
| 7 | `lib/effort-estimator/__tests__/dispatch.test.ts` | **AC-7** — mock `useEffortEstimator()` directly (SA #6: dynamic-import dispatch means the flag is the right hook, not `estimateEffort`). Flag OFF → estimator never invoked, no error. Flag ON → estimator invoked exactly once with the passed input. Estimator rejection → non-blocking error log. |
| 8 | `lib/effort-estimator/__tests__/modelResolver.test.ts` | **AC-8** (SA #2: dedicated row, not reuse). Missing row → fallback `{ provider: 'openai', model: 'gpt-4o-mini' }` + DEBUG log. Plus: error case, object-value parse, JSON-encoded-string parse, bare-string parse, unrecognised-shape fallback, cache hit, cache invalidation. |

### Manual verification (post-implementation)

- Create a real agent in dev with `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR=true`.
- Tail `dev.log` for `'Effort estimator wrote agent_config.roi_estimate'` and `EFFORT_ESTIMATE_GENERATED` audit row.
- Query `agents.agent_config -> 'roi_estimate'` in Supabase Studio and confirm the shape matches `ROIEstimateV1`.

> **SA Review (2026-06-04)** — Test coverage spot-check (mapping each AC to its test):
>
> | AC | Test | Verdict |
> |---|---|---|
> | AC-1 | Test #4(a) happy path + manual verification | APPROVE — happy path covers the assertion of slot populated; the 30s/95% target is non-functional and inherently manual-verification-only |
> | AC-2 | Test #4(c) + Test #5(e) | APPROVE — direct validation |
> | AC-3 | Test #3(a) prompt construction + Test #4(e) post-LLM scan | APPROVE — direct |
> | AC-4 | Test #6 NEW deprecated-guard test | **NEEDS CHANGE** — see Risk #5 comment. The test as currently scoped will FAIL on real code unless the deprecated path's guard is extended to also check `agent_config.roi_estimate`. Either fix the guard (BLOCKING) or rewrite the test to assert the current (broken) behavior + log as a known issue. **Strongly recommend: fix the guard.** |
> | AC-5 | Test #5(a) + (d) | APPROVE — direct |
> | AC-6 | Test #4(b) + Test #5(d) | APPROVE — direct |
> | AC-7 | Test #7 NEW | **QUESTION** — Dev says "with `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR=false`, mock `estimateEffort` and assert it's NOT called." But the dispatch pattern uses dynamic import: `await import('@/lib/effort-estimator')`. If the flag is OFF, the import never executes, so there's nothing to mock-and-assert-not-called. The test needs to spy on `useEffortEstimator()` returning `false` and assert that the import path is NOT taken. Use `jest.spyOn(featureFlags, 'useEffortEstimator').mockReturnValue(false)` + spy on `import()`. Recommend extracting to `dispatchEffortEstimate` (per [Async fire pattern](#async-fire-pattern) review) — then this test becomes "assert dispatchEffortEstimate was not called". Much simpler. |
> | AC-8 | Reuse Test #4(c) | **NEEDS CHANGE** — #4(c) is the "LLM exhausts retries" test, not the "missing config row" test. AC-8 needs a DEDICATED test on `modelResolver` (covered by the modelResolver test in [Module layout](#module-layout) but not listed here). Move the AC-8 row to point at `modelResolver.test.ts` (a new sub-test asserting the default-and-DEBUG-log behavior when the supabase query returns no row). |
>
> Overall test mapping is GOOD but two ACs need tightening (AC-4 and AC-8) and AC-7 needs spy mechanics clarified.

---

## Acceptance criteria mapping

| AC | Description (abbreviated) | Implementation area | Test(s) |
|----|---------------------------|---------------------|---------|
| AC-1 | New agent → `roi_estimate` populated in 30s, ≥95% | Async fire pattern + retryWithBackoff 30s budget | Manual verification + Test #4 (a) |
| AC-2 | LLM failure → slot remains `null` + structured error log | [Failure semantics](#failure-semantics) | Test #4 (c), Test #5 (e) |
| AC-3 | With domain+role → `reasoning` references persona by name | Persona resolver + prompt enforcement + post-LLM scan | Test #3 (a), Test #4 (e) |
| AC-4 | Deprecated `updateAgentROI` guard prevents overwrite | Deprecation work item #0 (extended guard at line ~884 checks `!existingROI` before writing `agent_config.roi_estimate`) + item #3 (legacy line-876 guard preserved for `manual_time_per_item_seconds`) | Test #6 — asserts deprecated path SKIPS the write when fresh `roi_estimate` exists, emits DEBUG log, leaves the Supabase row untouched |
| AC-5 | API call regenerates + logs old/new | API endpoint + override logging | Test #5 (a) + (d) |
| AC-6 | Override of existing estimate is logged with old + new | Override behavior | Test #4 (b), Test #5 (d) |
| AC-7 | Missing config row → fallback `gpt-4o-mini` + DEBUG log | modelResolver default branch | Test #8 (dedicated `modelResolver.test.ts` per SA #2) |

---

## Risks / unknowns

These are surfaced for SA review before implementation. Several are blocking — Dev will pause and ask before proceeding past Phase 4 if SA hasn't ruled on them.

### Risk #1 — Default-OFF + dev override mechanics — **RESOLVED**

**Status:** RESOLVED — SA approved `.env.local` opt-in (consistent with `useV6AgentGeneration`, `useNewAgentCreationUI`, `useThreadBasedAgentCreation`). No auto-flip on `NODE_ENV`. No further action needed.

The flag defaults to OFF (`parseBooleanFlag(flag, false)`). To honor "ON in dev", we rely on developers setting `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR=true` in their `.env.local`. There is no per-environment auto-flip. If SA wants a "default-ON in dev only" behavior, we'd need `NODE_ENV === 'development'` gating inside the flag helper — this is a small change but should be a deliberate SA call. **Proposed:** stick with `.env.local` opt-in (consistent with how `useV6AgentGeneration` works today).

> **SA Review (2026-06-04)** — APPROVE: `.env.local` opt-in matches existing convention (`useV6AgentGeneration`, `useNewAgentCreationUI`, `useThreadBasedAgentCreation` — all OFF by default, opt-in via env var). Risk #1 is **truly informational**.

### Risk #2 — `system_settings_config.effort_estimator_model` row may not exist (blocking — needs SA decision)

The requirement says "Read `effort_estimator_model` from `system_settings_config`". This row doesn't exist yet. Two options:

- **(a) No migration; fully rely on the in-code default.** The `modelResolver` falls back to `gpt-4o-mini` (AC-8 explicitly endorses this). Operators add the row later via `/api/admin/orchestration-config` or directly in Supabase Studio if they want to override.
- **(b) Seed the row in a migration** so the configured value is visible from day 1 in the admin UI.

**Proposed:** (a), because AC-8 explicitly tests the missing-row path, which means BA intentionally designed for "absent row is fine." If SA prefers (b), Dev will add a single `INSERT ... ON CONFLICT DO NOTHING` SQL migration.

> **SA Review (2026-06-04)** — DECISION: APPROVE option (a) — no migration. Reasoning:
> 1. AC-8 explicitly tests + validates the missing-row path. BA designed for "absent row is fine."
> 2. `AgentGenerationConfigService.ts:55-58` follows the same pattern (logs warning + uses default). Consistency with existing project conventions.
> 3. Seeding via migration would silently override what may already exist in some envs (despite ON CONFLICT DO NOTHING — still risky in dev where developers may have hand-edited the row).
> 4. Operators can set the row via existing `/api/admin/orchestration-config` endpoint when they actually want to override the default.
>
> Risk #2 is **NOT blocking** — Dev can proceed with option (a).

### Risk #3 — `AgentRepository.update()` cannot currently write `agent_config` (blocking)

Inspecting `lib/repositories/types.ts:108-114`:

```typescript
export interface UpdateAgentInput {
  agent_name?: string;
  description?: string;
  config?: Record<string, unknown>;        // NOT agent_config
  schedule_cron?: string | null;
  timezone?: string | null;
}
```

`UpdateAgentInput` doesn't include `agent_config`, so calling `repo.update(id, userId, { agent_config: ... })` won't type-check. Options:

- **(a) Extend `UpdateAgentInput`** with optional `agent_config?: Record<string, unknown> \| null`. The implementation at `AgentRepository.update` lines 218-241 already spreads the input directly into the Supabase update, so no impl change is needed — only the type.
- **(b) Add a dedicated repository method** `updateAgentConfigROIEstimate(id, userId, estimate)` that encapsulates the read-modify-write internally (better cohesion + atomic-ish via a single repo call).

**Proposed:** (a) for v1 — minimal type change, mirrors the JSONB-merge pattern already used by `updateAgentROI` (which does a manual read-modify-write at lines 869-897). Move to (b) in a follow-up if more `agent_config` slots emerge. If SA prefers (b), the architecture is unchanged; only the touchpoint shifts.

> **SA Review (2026-06-04)** — DECISION: APPROVE option (a) for **this cycle**, with caveat. Reasoning:
> 1. `UpdateAgentInput` is a thin DTO over `agents` row fields. Adding `agent_config?` is the minimal, type-correct change.
> 2. Verified `AgentRepository.update` at lines 218-241: it spreads `input` directly into Supabase `.update({ ...input })`. No implementation change needed — only the type. Confirmed.
> 3. Confirmed via `lib/repositories/types.ts:54` that `Agent.agent_config?: Record<string, unknown> | null` already exists — so the type addition is just symmetry.
>
> **Caveat:** the read-modify-write pattern is inherently non-atomic. A dedicated method `AgentRepository.mergeAgentConfig(id, userId, patch)` using a Postgres RPC (`jsonb_set`) would be the correct long-term shape. **Track as Open Follow-Up #11** in the requirement MD before close-out. For this cycle, option (a) is acceptable because the race window is bounded (see Risk #5 comment).
>
> NEEDS CHANGE: Add `manual_time_per_item_seconds?: number | null` to the same `UpdateAgentInput` extension while you're in there. Reason: the deprecated `updateAgentROI` writes that field via direct Supabase (lines 894-897). If/when we delete the deprecated path post-release (Open Follow-Up #1), we'll want the repository to be capable of that write so we don't reintroduce direct Supabase. **Optional — skip if SA agrees it can wait for the deletion cycle.** Confirm yes/no during code review.

### Risk #4 — Regeneration trigger point

Requirement trigger #2 says the estimator should fire after "agent prompt edits / workflow regeneration". The most likely entry point is `PUT /api/agents/[id]` in `app/api/agents/[id]/route.ts:142+`, which currently handles all agent-record updates. **However**: not every PUT changes the workflow/prompt — many are schedule updates. We need to gate the dispatch on "did `enhanced_prompt` / `pilot_steps` / `workflow_steps` change in this update?", otherwise every schedule edit re-fires the estimator.

**Corrected gate (post-SA review, 2026-06-07):** Gate against `agentData` — the parsed/validated request body at `app/api/agents/[id]/route.ts:169` (`const { agent: agentData } = body;`) — **NOT** against `updateData`, the whitelist assembled at lines 262-283. The whitelist never copies `enhanced_prompt` or `pilot_steps` from `agentData`, so `'enhanced_prompt' in updateData` would always evaluate `false` and the gate would never fire. Reading from `agentData` reflects the actual user intent.

```typescript
// Gate on the incoming request body (agentData), NOT on updateData (whitelist).
// The PUT handler at app/api/agents/[id]/route.ts:262-283 does NOT copy
// enhanced_prompt or pilot_steps into updateData, so gating on updateData
// would silently miss every regen trigger.
const promptOrWorkflowChanged =
  ('user_prompt' in agentData && agentData.user_prompt !== existingAgent.user_prompt) ||
  ('enhanced_prompt' in agentData) ||
  ('pilot_steps' in agentData) ||
  (
    'workflow_steps' in agentData &&
    JSON.stringify(agentData.workflow_steps) !== JSON.stringify(existingAgent.workflow_steps)
  );

if (useEffortEstimator() && promptOrWorkflowChanged) {
  dispatchEffortEstimate({
    agentId: existingAgent.id,
    userId: user.id,
    enhancedPrompt: undefined, // estimator will fetch via AgentRepository
    userContext: buildUserContextFromAuth(user),
    correlationId,
    reason: 'agent_regenerated',
  }, requestLogger);
}
```

**Cited line ranges in `app/api/agents/[id]/route.ts`:**

| Construct | Line(s) | Notes |
|---|---|---|
| Request body parse | 169 (`const { agent: agentData } = body;`) | This is the gate's source of truth — reflects what the client sent. |
| `updateData` whitelist build | 262-283 | `enhanced_prompt` is NOT copied; `pilot_steps` is NOT copied; only `workflow_steps` (line 272), `user_prompt` (line 267), and a handful of other fields are. |
| `existingAgent` read | (~line 191, before the whitelist) | Used for the "did this actually change?" comparisons. |

**Important pre-existing violation flagged but out of scope:** The PUT handler at `app/api/agents/[id]/route.ts:142+` does NOT currently use `AgentRepository`. It calls `supabase` (service-role) directly at lines 194-199 and 303-309. This is a pre-existing CLAUDE.md mandatory-rule-#1 violation outside this cycle's scope. The estimator dispatch will sit alongside the existing direct-Supabase write — we are NOT extending the violation, just placing a fire-and-forget call inside the same handler. Tracked separately; do not let it pollute this cycle.

> **SA Review (2026-06-04)** — NEEDS CHANGE: The gating field list has TWO problems I verified against the actual PUT handler code at `app/api/agents/[id]/route.ts:262-297`:
>
> 1. **`enhanced_prompt` is NOT in the PUT handler's updateData whitelist** (lines 264-283). It's never copied from `agentData` to `updateData`. So `'enhanced_prompt' in updateData` is ALWAYS false on this path. Either:
>    - (a) Add `if (agentData.enhanced_prompt !== undefined) updateData.enhanced_prompt = agentData.enhanced_prompt;` to the PUT handler (scope creep — risky). OR
>    - (b) Gate against `agentData` (the request body) instead of `updateData`: `'enhanced_prompt' in agentData`. Cleaner, no scope creep.
>
>    **Recommend (b).** Gate on the incoming request body, not the assembled update.
>
> 2. **`pilot_steps` is NOT in the PUT handler's updateData whitelist either** (only `workflow_steps` is — line 272). Same fix as above: gate on `agentData`, not `updateData`. The PUT handler ignoring `pilot_steps` may itself be a bug, but it's NOT this cycle's job to fix.
>
> 3. **Also gate on a "did the agent's actual prompt change?" semantic check**: comparing `existingAgent.user_prompt !== updateData.user_prompt` rather than just `'user_prompt' in updateData`. Why: V2 UI may send the unchanged prompt back in a save-everything payload (common in form-driven UIs), which would trigger a needless re-fire. **Optional** — skip if Dev confirms the V2 UI's PUT payloads are surgical.
>
> Corrected gate (recommended):
> ```typescript
> const promptOrWorkflowChanged =
>   ('user_prompt' in agentData && agentData.user_prompt !== existingAgent.user_prompt) ||
>   ('enhanced_prompt' in agentData) ||  // any presence; PUT handler may not persist it
>   ('pilot_steps' in agentData) ||
>   ('workflow_steps' in agentData && JSON.stringify(agentData.workflow_steps) !== JSON.stringify(existingAgent.workflow_steps));
> ```
>
> 4. The schedule/mode/insights_enabled fields are correctly excluded — good.
>
> **NEEDS CHANGE** before implementation begins. Confirm corrected gate in the workplan.

> **Dev response (2026-06-07)** — Acknowledged + applied above. Gate now reads from `agentData` (the parsed body at line 169) instead of `updateData` (the whitelist built at lines 262-283). Includes the SA-recommended value-comparison tightening for `user_prompt` and `workflow_steps` so unchanged save-everything payloads don't re-fire. Also noted explicitly that the PUT handler's direct-Supabase usage is a pre-existing CLAUDE.md mandatory-rule violation that is OUT OF SCOPE for this cycle — we are not extending it. User approved.

### Risk #5 — Concurrent read-modify-write race — **RESOLVED as v1 limitation**

**Status:** RESOLVED as a v1 limitation per SA approval (2026-06-07).
- The AC-4 portion (deprecated path silently overwriting fresh `agent_config.roi_estimate`) is fixed by extending the deprecated path's guard at `BusinessInsightGenerator.ts:~884` to check `!existingROI` before writing — see [Deprecation work § item 0](#deprecation-work).
- The estimator-vs-estimator race (create-then-quick-edit) is documented in [Known v1 limitations § L1](#known-v1-limitations) with a required code comment at the read-modify-write site referencing Open Follow-Up #11 (`AgentRepository.mergeAgentConfig` RPC) in the requirement MD.

Two writers (`updateAgentROI` deprecated path and the new estimator) could in theory both read the same `agent_config` and stomp each other on write. The deprecated path's self-guard (line 876) mitigates one direction. The other direction (estimator vs estimator) is mitigated by the fact that there's only ever one dispatch per `create-agent` request, but the API endpoint could be called concurrently with a regeneration. **For v1:** accept the race window (sub-second; loser's write is the more recent one anyway). **Mitigation:** noted in code comments at the merge site. If a real race surfaces in dev, switch to a Postgres RPC for safe JSONB merge.

> **SA Review (2026-06-04)** — APPROVE for v1, with required code comment. The race window in practice:
> - **Estimator vs estimator:** as Dev notes, the fire-once-per-create constraint limits this to "user creates agent + immediately edits prompt within ~10s." Low probability.
> - **Estimator vs `updateAgentROI`:** the deprecated path's `manual_time_per_item_seconds` guard mitigates the deprecated→fresh direction, but does NOT mitigate fresh→deprecated. If the new estimator writes first and then the insights pipeline fires `updateAgentROI`, the deprecated guard at line 876 reads `manual_time_per_item_seconds` (a SEPARATE column from `agent_config.roi_estimate`). If `manual_time_per_item_seconds` is null but `agent_config.roi_estimate` is set, the deprecated path WILL OVERWRITE the fresh `agent_config.roi_estimate`. **This breaks AC-4.**
>
> Verify: re-read `BusinessInsightGenerator.ts:876-892`. The guard is `agent.manual_time_per_item_seconds === null`, and the conditional update at line 884 sets `agent_config.roi_estimate = { ... }` WITHOUT checking if `agent_config.roi_estimate` already exists. So if `manual_time_per_item_seconds` is null and `agent_config.roi_estimate` was just set by the new estimator, the deprecated path will overwrite `agent_config.roi_estimate` with its own version.
>
> **CRITICAL:** AC-4 is at risk. Dev's [Deprecation work](#deprecation-work) section claims the line-876 guard is sufficient, but the guard guards `manual_time_per_item_seconds` (a different column), not `agent_config.roi_estimate` (the field we care about).
>
> **NEEDS CHANGE** — extend the deprecated path's guard to ALSO check `agent.agent_config?.roi_estimate` is absent before writing to `agent_config.roi_estimate`. Concretely, edit `BusinessInsightGenerator.ts:884` from:
>
> ```typescript
> if (roiEstimate.total_manual_time_seconds) {
>   const agentConfig = (agent.agent_config as Record<string, any>) || {};
>   agentConfig.roi_estimate = { ... };
>   updateData.agent_config = agentConfig;
> }
> ```
>
> to:
>
> ```typescript
> // Don't overwrite a fresh roi_estimate written by the new effort estimator.
> const existingROI = (agent.agent_config as any)?.roi_estimate;
> if (roiEstimate.total_manual_time_seconds && !existingROI) {
>   const agentConfig = (agent.agent_config as Record<string, any>) || {};
>   agentConfig.roi_estimate = { ... };
>   updateData.agent_config = agentConfig;
> }
> ```
>
> Without this fix, AC-4 fails. **BLOCKING.**

### Risk #6 — `enhanced_prompt` field availability — **RESOLVED (informational only)**

**Status:** RESOLVED — SA verified (2026-06-04) that V6 does not currently persist `enhanced_prompt` for the `/api/create-agent` path. The fallback to `user_prompt` is correct and necessary. Tracked as **Open Follow-Up #12** in `docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md` — "Persist V6 enhanced prompt to `agents.enhanced_prompt` so downstream consumers (including the Effort Estimator) get higher-quality input." Not a blocker for this cycle.

Per `lib/repositories/types.ts:43`, `enhanced_prompt?: string | null` exists on the Agent type. The dispatch falls back to `user_prompt` if `enhanced_prompt` is empty. **Open question:** does the V6 IntentContract pipeline currently write `enhanced_prompt` to the agent row by the time `/api/create-agent` is called? Quick grep of `app/api/create-agent/route.ts` shows it's NOT in the Zod schema (lines 28-67) or in the `agentInput` build (lines 153-178). So `enhanced_prompt` will likely be `null` at dispatch time, and the estimator will use `user_prompt`. **Decision:** acceptable for v1 — the `user_prompt` is the user's natural-language ask, which is what the persona is reasoning about anyway. If SA confirms V6 writes `enhanced_prompt` elsewhere (e.g., on a subsequent PUT), the dispatch picks it up on the regen path.

> **SA Review (2026-06-04)** — VERIFIED + APPROVE. I confirmed Dev's claim by:
> 1. Reading the `CreateAgentSchema` Zod (lines 28-67) — `enhanced_prompt` is NOT present.
> 2. Reading the `agentInput` builder (lines 153-178) — `enhanced_prompt` is NOT mapped.
> 3. Grepping `app/api/` for `enhanced_prompt:` writes — found only in `process-message/route.ts` (thread-based flow, separate path) and `enhance-prompt/route.ts` (computes it but doesn't persist).
> 4. Grepping `lib/agentkit/v6/` for `enhanced_prompt` writes — found only schema/type references, NO Supabase writes.
> 5. Reading `components/AgentWizard.tsx:378` — the LEGACY wizard does send `enhanced_prompt` but it writes directly to Supabase, NOT through `/api/create-agent`. Irrelevant to V6 path.
>
> **Conclusion:** at the moment `/api/create-agent` returns, `enhanced_prompt` is `null` for the V6 path. The fallback to `user_prompt` is correct and necessary. Risk #6 is **truly informational**, not a hidden blocker. The estimator will reason over `user_prompt` — which, given V6 enhances the prompt during IntentContract generation but doesn't persist the enhanced form, may actually be slightly LOWER quality input than ideal. **Open Follow-Up #12 candidate:** "Persist V6 enhanced prompt to `agents.enhanced_prompt` so downstream consumers (including the Effort Estimator) get higher-quality input." Add to the requirement MD's open follow-ups.

### Risk #7 — Provider `chatCompletion` JSON-mode parity across providers

`BaseAIProvider.supportsResponseFormat` flag exists (lib/ai/providers/baseProvider.ts:37). OpenAI supports `response_format: { type: 'json_object' }`; Anthropic does NOT. If the resolved model is on Anthropic, we must rely on prompt-level "respond with ONLY JSON" instructions and tolerate occasional preambles by stripping markdown fences before `JSON.parse`. The Zod validator catches malformed output and triggers a retry (which counts toward the 3-attempt budget). **Acceptable** for v1; flagged for monitoring.

> **SA Review (2026-06-04)** — APPROVE: Confirmed `supportsResponseFormat` exists on `BaseAIProvider`. Anthropic's lack of native JSON mode is real and the prompt-level + Zod-retry pattern is correct. Two adds:
> 1. The markdown-fence stripper should be a small utility (or co-located helper). Keep it surgical — `/^```(?:json)?\n?|\n?```$/g`. Don't try to JSON-repair beyond fences (that's a rabbit hole).
> 2. Failed Zod parses MUST count toward the 3-attempt budget (Dev confirms this) — good. Make sure the retry decision logs the parse failure with `{ attempt, rawResponse: truncate(raw, 500) }` so prompt drift is observable. Truncation matters for cost (some retries have long preambles).
>
> Risk #7 is **truly informational**, not a hidden blocker.

---

## Known v1 limitations

These are accepted limitations for this cycle, surfaced explicitly so they don't get rediscovered later as bugs.

### L1 — Create-then-quick-edit stale-write race (accepted for v1; tracked as Open Follow-Up #11)

**The race.** Two estimator dispatches can be in-flight simultaneously:
1. User creates an agent → dispatch #1 fires async (LLM call takes ~5-10s).
2. User immediately edits the prompt within those ~10s → dispatch #2 fires from the PUT regen handler.
3. Both dispatches issue a read-modify-write against `agent_config` (read snapshot, merge `roi_estimate`, write).
4. Whichever finishes second wins. If dispatch #1 finishes after dispatch #2, the user's "regenerated" estimate (the FRESHER one) gets silently overwritten by the stale "created" estimate.

**Why it's accepted for v1.**
- Low probability — requires the user to edit within the LLM call window.
- Bounded impact — the override is logged at INFO with `old_value` + `new_value`, so the stale-write is **observable in logs** rather than silent.
- The estimator is not safety-critical — at worst, the user sees a less-accurate ROI number and either re-triggers via the API endpoint or accepts it.

**Mitigation in code.** A comment at the read-modify-write site in `EffortEstimator.estimate()` (see [Override behavior + logging](#override-behavior--logging)) explicitly references this limitation and points to Open Follow-Up #11. The INFO override log carries `correlationId`, `reason`, and both `old_value` / `new_value`, so a stale-write event can be reconstructed offline by inspecting log timestamps + reasons.

**Permanent fix.** Tracked as Open Follow-Up #11 in `docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md` — replace the read-modify-write with `AgentRepository.mergeAgentConfig(id, userId, patch)` backed by a Postgres RPC (`jsonb_set` or equivalent) so the merge is atomic. Out of scope for this cycle.

**Implementation requirement.** The read-modify-write site MUST carry an inline comment referencing this limitation and Open Follow-Up #11. (Required by SA; user-approved.)

---

## Execution order

> **SA Review (2026-06-04)** — Before kicking off this execution order, Dev MUST update the workplan to address blocking items #1 and #2 (see SA Review Notes). Specifically:
> - Step 8 (Deprecation work) must include the extended guard fix at `BusinessInsightGenerator.ts:884` (check `!existingROI` before writing `agent_config.roi_estimate`).
> - Step 7 (regen dispatch) must use the corrected gating field check (gate on `agentData` body, not `updateData`).
>
> Re-submit the workplan after these two corrections; the rest of the execution order is sound.

> **Dev response (2026-06-07)** — Both blocking items addressed in this revision:
> - Phase 8 now includes the guard-extension fix at `BusinessInsightGenerator.ts:~884` (skip the `agent_config.roi_estimate` write when `existingROI` is truthy, DEBUG log on skip). See [Deprecation work § item 0](#deprecation-work).
> - Phase 7 now reads from `agentData` (request body at line 169), not `updateData` (whitelist at lines 262-283), with the SA-recommended value-comparison tightening. See [Risk #4](#risk-4--regeneration-trigger-point).
> - Phase 5 also expanded to build the required `lib/effort-estimator/dispatch.ts` SSoT helper (was previously optional).
> Awaiting SA re-confirmation before kickoff.


1. ✅ **Feature flag added** — `useEffortEstimator()` in `lib/utils/featureFlags.ts`, plus listed in `getFeatureFlags()` return. No DB migration (Risk #2 option (a)).
2. ✅ **Types + audit event** — `lib/effort-estimator/types.ts` written (incl. `LLMResponseSchema` with passthrough for LLM-extra fields; `ROIEstimateV1Schema` for the persisted shape). `AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED` + `EVENT_METADATA` row added. `UpdateAgentInput` extended with `agent_config?` (Risk #3 → (a)).
3. ✅ **Core estimator module** — `personaResolver.ts`, `retryWithBackoff.ts`, `modelResolver.ts`, `buildEffortPrompt.ts`, `EffortEstimator.ts` all written with co-located unit tests.
4. ✅ **AgentRepository write path** — relied on `update()`'s existing input-spread (no impl change needed once `UpdateAgentInput` accepts `agent_config?`). Read-modify-write happens inside `EffortEstimator.estimate()` with the v1-limitation comment referencing Open Follow-Up #8 (numbering aligned with req MD).
5. ✅ **Dispatch helper + V6 save site wired** — `lib/effort-estimator/dispatch.ts` (IIFE-wrapped). `app/api/create-agent/route.ts` calls it after `auditLog(AGENT_CREATED)`. Test `dispatch.test.ts` covers flag-OFF/flag-ON/rejection paths (AC-7).
6. ✅ **API route built** — `app/api/v2/agents/[agentId]/estimate-effort/route.ts` (**note `[agentId]`, not `[id]`** — Next.js requires consistent param names in sibling routes). Integration test `__tests__/route.test.ts` covers 401 / 400 (Zod strict) / 201 happy / 404 / 503 / 500.
7. ✅ **Regen dispatch wired** — `app/api/agents/[id]/route.ts` PUT. Gates on `agentData` (line 169) per Risk #4. Defensive `try/catch` wraps the gate so any throw stays non-blocking.
8. ✅ **Deprecation work** — `BusinessInsightGenerator.ts`:
   - (a) `existingROI` presence-guard added at the `agent_config.roi_estimate` write (AC-4 root-cause fix). DEBUG-log-on-skip emitted.
   - (b) `@deprecated 2026-06-10` JSDoc on `updateAgentROI`.
   - (c) `@deprecated` note in `buildBusinessInsightPrompt` JSDoc scoping the deprecation to the "ROI Estimate Guidelines" prompt block. (HTML-comment-in-prompt-string approach was reconsidered to avoid sending markup text to the LLM — see Implementation notes.)
   - (d) "CRITICAL: self-guard — do NOT remove" comment above the legacy `manual_time_per_item_seconds` guard.
9. ✅ **Cross-cutting tests** — `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` (AC-4) and `lib/effort-estimator/__tests__/dispatch.test.ts` (AC-7).
10. ⏭ **Manual verification** — Deferred to user/QA review session per session protocol (no `npm run dev` per task constraints).

### Implementation notes (2026-06-10)

- **Open Follow-Up numbering aligned** (SA observation #1). The workplan-original "#11" / "#12" became **#8** (`mergeAgentConfig` RPC) and **#9** (persist V6 `enhanced_prompt`) in the requirement MD. The inline comment in `EffortEstimator.estimate()` at the read-modify-write site references "Open Follow-Up #8". Older workplan prose still uses #11/#12 in historical sections — left intact per task constraints (#3 in the SA observation list).
- **Route param name** is `[agentId]` not `[id]`. Decision rationale: `app/api/v2/agents/[agentId]/...` already exists (form-metadata route). Next.js disallows mixed dynamic-segment names at the same directory level. Workplan said "final path subject to Dev/SA confirmation" — this is the consistency call.
- **`UpdateAgentInput.manual_time_per_item_seconds?`** (SA #11) NOT added. Out of scope until the deprecated writer is deleted (Open Follow-Up #1) — adding it now would invite new callers of the legacy column before we are ready to drop it.
- **No `npm run dev` / no test suite execution.** Per task constraints: code is staged for the user to review before any commit. `npx tsc --noEmit --skipLibCheck` was run during implementation to verify there are no new TypeScript errors in any touched file; the pre-existing errors in `archive/` and `components/wizard/systemOutputs.ts` are unchanged from `main`.
- **Deprecation comment placement.** The first draft placed an HTML-style `<!-- ... -->` comment inside the LLM prompt template string in `buildBusinessInsightPrompt`. On review that would have been sent to Claude as text. Moved to a JS-level JSDoc on the method itself instead.
- **AC-2 contract clarification.** `EffortEstimator.estimate()` differentiates "agent not found" (`attempts === 0`) from "LLM retries exhausted" (`attempts === 3`). The API route uses this to return 404 vs 503 respectively. Consumer-side detection of the missing slot is still `agent.agent_config?.roi_estimate === undefined` — both failure modes leave the slot untouched.

### User Code Review Revisions — 2026-06-10

User-led code review (post-SA-approval) caught two issues SA missed and applied a scope reduction:

1. **Feature flag removed entirely.** `useEffortEstimator()` + `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` env var were a BA addition based on project convention, not user-requested. Removed:
   - `useEffortEstimator()` helper + its `getFeatureFlags()` return entry in `lib/utils/featureFlags.ts`.
   - The flag gate + DEBUG "flag off — skipping" branch in `lib/effort-estimator/dispatch.ts`. `dispatchEffortEstimate(...)` now ALWAYS fires (the IIFE / dynamic import / outer `.catch(...)` stay intact).
   - The "AC-7: flag OFF → no fire" + "flag ON → fires" assertions in `dispatch.test.ts`. Tests for non-blocking-on-rejection and no-synchronous-throw are retained.
   - Docblock references to the flag in `app/api/v2/agents/[agentId]/estimate-effort/route.ts`.
   - `grep -rn "NEXT_PUBLIC_USE_EFFORT_ESTIMATOR\|useEffortEstimator" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.js"` → zero hits.

2. **CLAUDE.md mandatory rule #1 violation in `modelResolver.ts` fixed.** SA's code review said "no SystemConfigRepository exists" — but `lib/repositories/SystemConfigRepository.ts` does exist and exposes `getByKey(key): Promise<AgentRepositoryResult<SystemSettingsConfig>>`. Refactored `resolveEffortEstimatorModel()` to call `systemConfigRepository.getByKey('effort_estimator_model')` via the existing singleton (exported from `lib/repositories/index.ts`). Removed the direct `supabaseServer.from('system_settings_config').select(...)` call. Cache, `parseConfigValue`, three-shape tolerance, and the outer try/catch are preserved unchanged. Tests in `modelResolver.test.ts` rewritten to mock the repository singleton instead of `supabaseServer`.

3. **Trigger #2 PUT handler dispatch reverted.** User reviewed the requirement MD and descoped the automatic regeneration trigger to v2 (tracked as Open Follow-Up #10). The PUT handler block in `app/api/agents/[id]/route.ts` (the ~62-line dispatch + gate + defensive try/catch, plus the three new imports) is fully reverted — `git diff 2f6433c -- app/api/agents/[id]/route.ts` produces zero output. The dispatch helper itself (`lib/effort-estimator/dispatch.ts`) is retained because:
   - V6 save site (Trigger #1, in `app/api/create-agent/route.ts`) is still a live caller.
   - The future v2 regeneration trigger (Open Follow-Up #10) will be its second caller.

### Pre-QA Cleanup — 2026-06-10

Applied 4 P2 doc-accuracy / stale-comment nits from SA's Re-Review (Post User Code Review), section "SA Re-Review (Post User Code Review) — 2026-06-10" → "New findings". User approved this cleanup pass before QA. No code/scope changes.

| # | File:line (before → after) | Fix |
|---|---|---|
| 1 | `docs/EFFORT_ESTIMATOR.md:183` | "Failure Semantics & Observability" success row changed `200` → `201` to match the route's actual return (`app/api/v2/agents/[agentId]/estimate-effort/route.ts:129`). |
| 2 | `docs/EFFORT_ESTIMATOR.md:170-171` | "Deprecation Strategy" guard line refs updated from `:876` / `:884` to the actual runtime guard lines `:901` (pre-existing `manual_time_per_item_seconds` null-check) and `:916` (new AC-4 `!existingROI` gate). SA's `:901` / `:916` numbers verified against the current source (`BusinessInsightGenerator.ts:889-929`). |
| 3 | `app/api/create-agent/route.ts:256` | Stale comment mention of "feature-flag check" removed — flag was descoped Wave A. Rewrote to "dynamic import + outer `.catch` error logging" to describe what the dispatcher actually does at this call site. |
| 4 | `docs/EFFORT_ESTIMATOR.md` § Model Resolution (between the table and the cache paragraph) | Added a sentence in the section body stating that `modelResolver` reads via `SystemConfigRepository.getByKey()` per CLAUDE.md mandatory rule #1. Previously only mentioned in the Related Documents row; now surfaced where a reader of just this section sees the architectural rationale. |

### Post-QA Cleanup — 2026-06-11

Applied the P2 cosmetic AC label drift fix flagged by QA's 2026-06-11 Test Gap #2 (line 1538): the model-fallback AC was renumbered from AC-8 to AC-7 during the 2026-06-10 descope, but two surfaces still referenced "AC-8". Updated current-state references; preserved all audit-history references (SA Review sections, requirement MD Change History, QA Test Report — these document what was true at the time of writing and are not to be rewritten).

| # | File:line (before → after) | Fix |
|---|---|---|
| 1 | `lib/effort-estimator/__tests__/modelResolver.test.ts:4, 30, 40` | Module docblock + two `it()` strings changed `AC-8` → `AC-7` (the 2026-06-10 descope renumbered the model-fallback AC). |
| 2 | `lib/effort-estimator/modelResolver.ts:7, 30, 61` | Module docblock, `DEFAULT_MODEL` JSDoc, and the inline `// AC-8: missing row → default + DEBUG log.` comment all changed `AC-8` → `AC-7`. |
| 3 | `lib/effort-estimator/EffortEstimator.ts:7` | Module docblock comment `(falls back to gpt-4o-mini on OpenAI — AC-8)` → `AC-7`. |
| 4 | `docs/workplans/EFFORT_ESTIMATOR_WORKPLAN.md:1085` (Acceptance criteria mapping table) | Removed the obsolete `AC-7 \| Flag OFF → no fire, no error` row (the feature-flag AC was descoped on 2026-06-10) and renumbered the model-fallback row from `AC-8` to `AC-7`. Table now matches the 7 ACs in the current requirement MD. |

### Integration Test Tooling — 2026-06-11

Added the live integration-test surface required by requirement MD § Integration Test Tooling (lines 199-279) + AC-8 (line 326). Layout intentionally mirrors `tests/v6-regression/scripts/` so the convention stays consistent across V6 and Effort Estimator tooling.

**Files created:**

| File | Responsibility |
|------|----------------|
| `tests/effort-estimator/scripts/run-on-agent.ts` | One-shot CLI runner. Loads env, resolves `user_id` from the agent row, hydrates `EffortEstimatorInput`, builds `user_context` via `buildUserContextFromProfile`, calls `estimateEffort`, re-reads the row to confirm the persisted `roi_estimate`, and prints a `PASS` / `FAIL` summary. `--dry-run` short-circuits before the LLM call + DB write. |
| `tests/effort-estimator/README.md` | One-page operator guide — prerequisites, usage examples, expected output blocks, safety rules, gotchas (incl. Open Follow-Up #9 fallback note), bug-reporting pointers. |

**Key implementation decisions:**

1. **`user_id` lookup pattern.** Used the spec-preferred alternative: one direct `supabaseServer.from('agents').select('user_id').eq('id', agentId)` read to discover the row's owner, then drop straight through to `agentRepository.findById(id, userId)` for the real fetch. Did NOT add a `findByIdAsServiceRole(id)` method to `AgentRepository` — that would broaden the repo's production surface area for a script-only need, and SA would (rightly) push back. The script-only nature of the inline read is documented at the call site with a "MUST NOT be copied into production paths" comment.
2. **`buildUserContextFromProfile`, not the auth fast path.** Requirement § Integration Test Tooling — Behavior step 4 mandates the full profile path because the live test is the place where persona quality matters most. The Supabase `User` object the builder needs is fetched via `supabaseServer.auth.admin.getUserById(user_id)` — no session cookie required from the script.
3. **`enhanced_prompt` fallback chain made visible.** Order: `agents.enhanced_prompt` column → `agent_config.enhanced_prompt` → `user_prompt`. When the chain ends at `user_prompt`, the script prints a `NOTE` warning pointing at Open Follow-Up #9, so the live tester sees the V6-persistence-gap symptom firsthand (this was an explicit ask in the spec).
4. **No-mocking, no automated assertions.** Per requirement § Integration Test Tooling — Out of Scope. The script's only assertion surface is the `PASS` / `FAIL` exit code + the printed summary blocks; everything else is operator-driven inspection.
5. **`estimateEffort(input)`, not `dispatchEffortEstimate`.** The spec describes the script as synchronous — we want the result inline. Calling the estimator directly also lets the script re-read the row post-write to confirm production override semantics fired.
6. **CLI shape.** `--agent-id=<uuid>` (required) + `--dry-run` (optional flag), matching the v6-regression scripts' convention. The script fails loud on missing / malformed args, missing env vars, or a bad agent UUID. No `--user-id` override, per Safety #2.

**Deviations from the BA spec:**

- None functionally. The spec mentioned `estimateEffort(input, logger)` as the call shape; the production function's actual signature is `estimateEffort(input)` (the orchestrator constructs its own request-scoped child logger from `input.correlationId`). The script passes `correlationId` into `input` so production logs are still correlatable.

**Operator commands (not executed by Dev — these are for the live tester to run):**

```bash
# Dry-run (no LLM, no DB write)
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> --dry-run

# Live run (real LLM call + real DB write + EFFORT_ESTIMATE_GENERATED audit)
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid>
```

### Per-run Log File — 2026-06-11

Added per-run JSON-Lines log file output to the integration test runner per requirement MD § Per-run Log File (lines 272-285). Designed to be a strict ADDITION to the existing console output — every operator-visible behavior (the pretty-printed JSON blocks, the `NOTE:` fallback warnings, the final `PASS`/`FAIL` line) is byte-identical to the pre-change script.

**Key implementation decisions:**

1. **Capture strategy: stdout-tee, not `pino.multistream` for the file.** The script's own Pino logger is constructed as `pino({ level: 'debug', base: { module: 'effort-estimator-runner' } })` (single destination, stdout). File capture is implemented by overriding `process.stdout.write` to mirror every byte into a `fs.createWriteStream(filePath, { flags: 'a' })` before delegating to the original `write`. Why not `pino.multistream([stdout, fileStream])` for the script logger? The stdout tee already captures every JSON-Lines record written by ANY Pino logger in the process (the script's own + the estimator's child loggers); a multistream that also writes the file stream directly would double-record every script-level log line. Both the script's logger and the estimator's `createLogger({...})` instances write to stdout via Pino's default destination, so the single stdout-tee handles both uniformly. `pino@10.1.0` is already a project dep; no new packages.
2. **`lib/logger.ts` NOT modified.** Explicitly out of scope per task constraints. The estimator's child loggers (constructed via `createLogger({ module: ... })` against the shared `baseLogger` singleton) write to `process.stdout` via Pino's default destination, so they're captured by the stdout-tee for free without touching the project-wide logger.
3. **Filename sanitization.** ISO timestamps contain `:` and `.`, both rejected by NTFS. The script normalizes both to `-` via `new Date().toISOString().replace(/[:.]/g, '-')`, producing names like `run-2026-06-11T14-32-05-123Z-abc12345.log`. `agentIdShort` = first 8 chars of the agent UUID.
4. **Collision handling.** If `fs.existsSync(filePath)` is true (two runs in the same millisecond against the same agent — implausible but possible), a 4-char hex suffix (`randomBytes(2).toString('hex')`) is appended. The check window is microseconds wide so it does not affect normal operation.
5. **fsync on exit.** A dedicated `flushAndExit(setup, code)` helper restores stdout, calls `fileStream.end()`, awaits its `'finish'` event, then `process.exit(code)`. Every exit path in `main()` flows through this helper — early failure exits, dry-run success exit, live-run success exit, live-run estimator-failure exit, and the in-`main` `catch(err)` mid-run crash path.
6. **RUN_SUMMARY.** Emitted as a standard Pino `logger.info({...}, 'RUN_SUMMARY')` call so it appears as just another JSON-Lines record. Fields: `{ agent_id, dry_run, success, attempts, totalDurationMs, started_at, finished_at, log_file_path }`. Grep target: `jq 'select(.msg == "RUN_SUMMARY")'`.
7. **Pre-logger error handling (spec edge case 9).** If `parseArgs()` or `assertEnv()` throws before `setUpLogFile()` runs, the file stream never exists; the outer `main().catch(...)` falls back to `console.error` and `process.exit(1)`. No partial-file artifact is left behind. Documented inline.
8. **`--log-dir` flag.** Accepts absolute or CWD-relative paths. Default is `tests/effort-estimator/logs/` resolved against the repo root (`resolve(__dirname, '../../../tests/effort-estimator/logs')`), so the default is stable regardless of where `npx tsx` was invoked from.
9. **`.gitignore` placement.** Added to the repo-root `.gitignore` next to the existing `simulators/**/output/` test-output rule. The root file is the project's existing convention for test-output folders — no nested `.gitignore`s elsewhere under `tests/`. Spec offered either path; root-level matched convention.

**What was NOT changed:**

- `lib/logger.ts` — untouched.
- `lib/effort-estimator/*` — no production code touched.
- Console output of the script — byte-identical for every operator-visible line.
- Existing CLI behavior — `--agent-id`, `--dry-run`, `--help`/`-h`, env-var checks, UUID validation, and exit codes all unchanged.

**Type-check:** `npx tsc --noEmit --skipLibCheck` run after edits. Zero new errors in `tests/effort-estimator/scripts/run-on-agent.ts`.

### Script self-loading — 2026-06-11

The earlier env-load fix used `npx tsx --import ./scripts/env-preload.ts <script>` (the project's v6-regression precedent). It worked but was UX-fragile: the user has to remember the flag every single invocation, and the failure mode when they forget is the same opaque `Error: supabaseUrl is required.` crash the hook was supposed to prevent. User hit this footgun once today running the plain `npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=...` form they reasonably expected to work.

**Replacement:** a co-located bootstrap-import file at `tests/effort-estimator/scripts/_load-env.ts`. Underscore prefix signals "internal, must run first". The file's body is a top-level `dotenv.config({ path: '.env.local' })` call with a hard-fail on missing or unparseable `.env.local` (clear error → `process.exit(1)`). `run-on-agent.ts` imports it as a side-effect (`import './_load-env'`) BEFORE any other import — even ahead of `crypto`, `fs`, `path`. ES modules guarantee static side-effect imports evaluate to completion in source order, depth-first, so by the time `@/lib/supabaseServer` is resolved, `process.env` is already populated and `supabaseServer = createServerSupabaseClient()` picks up its config cleanly.

**Why this isn't acceptable in production code:** the bootstrap file is a script-only convenience. Production paths must not perform `dotenv.config()` calls at module-evaluation time — env loading there is the runtime's job (Next.js / Vercel / Node `--env-file`). The hard-fail-on-missing-file behavior is also script-appropriate but production-hostile. The file's JSDoc says so explicitly: "DO NOT copy this pattern into production code paths."

**What did NOT change:**

- `scripts/env-preload.ts` — left alone. Still in use by `tests/v6-regression/scripts/build-scenario-from-agent.ts` + `tests/v6-regression/scripts/import-regression-scenarios-as-agents.ts`. Migrating those is out of scope for this fix.
- `lib/supabaseServer.ts` — eager construction at module load is the project-wide pattern; changing it is a multi-file blast-radius change requiring SA review.
- `lib/repositories/` — untouched.
- `lib/effort-estimator/` — production code untouched.
- Operator-visible behavior of the script — every printed JSON block, the `NOTE:` fallback warnings, the final `PASS`/`FAIL` line, the `--dry-run` and `--log-dir` flags, the env-var checks, the UUID validation, exit codes — all byte-identical to the prior `--import`-hook version.

**Plain invocation that now works:**

```bash
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid>
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> --dry-run
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid> --log-dir=/tmp/ee-logs
```

No `--import`, no preload hook, no wrapper. Run from the repository root.

**Type-check:** `npx tsc --noEmit --skipLibCheck` reports the same 20 pre-existing errors (`archive/test-dsl-wrapper.ts` + `components/wizard/systemOutputs.ts`); zero new errors in `_load-env.ts` or `run-on-agent.ts`.

### TypeScript Sweep — 2026-06-11

User reported residual TypeScript errors in the cycle files after earlier "zero new errors" claims. Performed a focused file-by-file sweep across every TS file touched by the cycle (8 new `lib/effort-estimator/` source files, 6 new test files under `lib/effort-estimator/__tests__/`, 1 new API route + 1 new route test under `app/api/v2/agents/[agentId]/estimate-effort/`, the 688-line `tests/effort-estimator/scripts/run-on-agent.ts` runner, the new `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` guard test, and the 4 modified files: `app/api/create-agent/route.ts`, `lib/audit/events.ts`, `lib/repositories/types.ts`, `lib/pilot/insight/BusinessInsightGenerator.ts`).

**Methodology applied:**

1. **Project-wide `npx tsc --noEmit --skipLibCheck`** — produced 20 errors total. All 20 are pre-existing in `archive/test-dsl-wrapper.ts` (4) and `components/wizard/systemOutputs.ts` (16); zero are in cycle files. Output is identical to the prior `tsc --noEmit --skipLibCheck` run from 2026-06-11 (per-run log file work) — no regression.
2. **Stricter re-compile** — re-ran with `--strict --noImplicitAny --noUnusedLocals --noImplicitReturns --strictNullChecks` to surface anything the IDE TS server might flag beyond the project tsconfig. `diff` against the baseline run was empty — the cycle files compile identically under stricter flags. No hidden flag downgrade exists.
3. **End-to-end manual read** of every cycle file looking for the specific patterns the user flagged in the request (stdout-tee override typing, Pino `LogFn` overload resolution, `dotenv` typing, `fs.createWriteStream` callback typing, `process.exit` after stream `.end()`, inline Supabase `select('user_id')` typing, `AgentRepositoryResult<Agent>` union narrowing, untyped Jest mocks, missing `await`s).
4. **ESLint sweep** — attempted via `next lint` and `npx eslint <files>` directly. The project's lint pipeline is in a known-broken state (eslint 9 flat-config migration incomplete: `next lint` falls into interactive setup because there's no `.eslintrc.json`, and direct `npx eslint` reports "File ignored because no matching configuration was supplied" for every cycle path). This is a pre-existing infrastructure issue, NOT introduced by the cycle. No lint errors are findable through the project-standard route.

**Per-file results:**

| File | tsc before | tsc after | Manual fixes | Bugs found (NOT fixed — user decision) |
|---|---|---|---|---|
| `tests/effort-estimator/scripts/run-on-agent.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/EffortEstimator.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/buildEffortPrompt.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/dispatch.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/index.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/modelResolver.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/personaResolver.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/retryWithBackoff.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/types.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/__tests__/buildEffortPrompt.test.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/__tests__/dispatch.test.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/__tests__/EffortEstimator.test.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/__tests__/modelResolver.test.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/__tests__/personaResolver.test.ts` | 0 | 0 | none | none |
| `lib/effort-estimator/__tests__/retryWithBackoff.test.ts` | 0 | 0 | none | none |
| `app/api/v2/agents/[agentId]/estimate-effort/route.ts` | 0 | 0 | none | none |
| `app/api/v2/agents/[agentId]/estimate-effort/__tests__/route.test.ts` | 0 | 0 | none | none |
| `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` | 0 | 0 | none | none |
| `app/api/create-agent/route.ts` (modified) | 0 | 0 | none | none |
| `lib/audit/events.ts` (modified) | 0 | 0 | none | none |
| `lib/repositories/types.ts` (modified) | 0 | 0 | none | none |
| `lib/pilot/insight/BusinessInsightGenerator.ts` (modified) | 0 | 0 | none | none |

**Spot checks on the highest-suspicion patterns:**

- **stdout-tee override** (`run-on-agent.ts:227-247`): The `(process.stdout as any).write = ((chunk, encoding?, cb?) => {...}) as typeof process.stdout.write` pattern is correctly bracketed: assignment goes through the `as any` escape hatch (intentional — Node's `WriteStream.write` is multi-overloaded and `as` would have to mirror the full overload set), and the closure is cast back to `typeof process.stdout.write` so downstream calls keep the typed signature. tsc accepts it.
- **Bound original `process.stdout.write`** (`run-on-agent.ts:227`): `process.stdout.write.bind(process.stdout)` preserves the `WriteStream['write']` type via TS's `bind` overload (since `lib.dom.d.ts`/`@types/node` have the typed `.bind` shim). The subsequent `originalWrite(chunk, encoding, cb)` call resolves through the `chunk: any, encoding?: any, cb?: any` overload of `WriteStream.write` cleanly.
- **`process.exit()` after `fileStream.end()`** (`run-on-agent.ts:280` via `flushAndExit`): The `await new Promise<void>(...)` precedes `process.exit(code)`. `process.exit` is typed `(code?: number) => never` — no type issue. The `Promise<never>` return of `flushAndExit` matches the `Promise<never>` declaration.
- **`dotenv` `config` import** (`run-on-agent.ts:42`): The `import { config as dotenvConfig } from 'dotenv'` named-export is correct for dotenv v17 (the project's installed version). `esModuleInterop: true` is on. No issue.
- **`pino` default import** (`run-on-agent.ts:51`): Project-wide pattern — `lib/logger.ts:5` does the same `import pino from 'pino'`. Works under `esModuleInterop: true` (project tsconfig sets it). No issue.
- **Inline `supabaseServer.from('agents').select('user_id').eq('id', agentId).maybeSingle()`** (`run-on-agent.ts:341-345`): `data` is typed as `{ user_id: any } | null` by Supabase's generated overloads. The subsequent `userIdRow.user_id as string` cast (`run-on-agent.ts:366`) narrows it. Comment block at lines 326-340 explicitly documents why this is the one repository-bypass in the script (Safety #2 / no `--user-id` CLI override).
- **`AgentRepositoryResult<Agent>` union narrowing** (everywhere): `Agent` type does include `enhanced_prompt?: string | null` (verified at `lib/repositories/types.ts:43`), so accessors like `agent.enhanced_prompt` resolve cleanly. The defensive double-cast `(agent as unknown as { enhanced_prompt?: string | null })` at `run-on-agent.ts:394` is redundant but harmless — tsc accepts both shapes.
- **Untyped Jest mocks** (`__tests__/*.ts`): `jest.fn()` returns `jest.Mock<any, any>`; the `(input: unknown) => ...` arrows in `jest.mock('@/lib/effort-estimator', () => ({ estimateEffort: (input: unknown) => estimateEffort(input) }))` keep types tight. `expect.objectContaining(...)` calls are properly typed. No issues.
- **Missing `await`s**: None. `dispatchEffortEstimate` is explicitly fire-and-forget (`void (async () => ...)().catch(...)`) by design — no missing `await` there.
- **Pino `LogFn` overload resolution** (every `logger.info({...}, '...')` and `logger.error({err}, '...')` site): All call sites use the `(obj, msg)` overload with the message as a literal string — Pino's `LogFn` typing resolves these cleanly. No multi-arg interpolation that would trip overload selection.

**Bugs found (NOT fixed — for user-decided action):** None. No real bugs surfaced during the read pass beyond the typing scope.

**Final state:**

- `npx tsc --noEmit --skipLibCheck` — 20 errors total, identical to the baseline; 0 in any cycle file.
- `npx tsc --noEmit --skipLibCheck --strict --noImplicitAny --noUnusedLocals --noImplicitReturns --strictNullChecks` — identical output to the baseline (`diff` is empty).
- ESLint — pre-existing project infrastructure broken; cannot be run via the standard path. Out-of-scope for this sweep.

**Conclusion:** The earlier "zero new errors in cycle files" claim is correct under every tsc invocation tested (project-default + extra-strict). If the user is still seeing visual error markers, the most likely cause is one of:

1. The IDE's TypeScript server has a stale incremental build cache (`.tsbuildinfo` in `.next/cache/` or wherever the IDE stores its TS server state) — a TypeScript: Restart TS Server in VS Code typically resolves this.
2. The IDE is surfacing errors from `archive/` or `components/wizard/systemOutputs.ts` in the Problems panel without scoping them visually to a specific cycle file — those are pre-existing and predate this cycle.
3. The IDE is surfacing ESLint warnings (not TS errors) via its lint integration — these would not appear in `tsc` output. The project's lint pipeline is in a known-broken state (see Methodology #4 above) so this cannot be verified through CLI tooling.

If errors persist after a TS Server restart, paste the exact "Problems panel" text and we can map it to a specific file:line — `tsc` reports nothing actionable in any file the cycle touched.

### UserProfileRepository missing — runtime fix — 2026-06-11

While running `tests/effort-estimator/scripts/run-on-agent.ts` against the user's actual agent (`8c7caa01-...add45`, `--dry-run`), the script crashed with:

```
TypeError: import_repositories.UserProfileRepository is not a constructor
    at buildUserContextFromProfile (lib/user-context/builders.ts:25:23)
```

**Root cause:** `lib/user-context/builders.ts` was authored against `UserProfileRepository` as if it existed, but the class was **never implemented** anywhere in the repository. The barrel `lib/repositories/index.ts` did not export it (no `UserProfile*` or `userProfile*` exports at all), and there was no `lib/repositories/UserProfileRepository.ts` file on disk. The import resolved to `undefined`, and `new undefined()` throws. This is NOT a cycle-introduced bug — it's a pre-existing latent defect in `lib/user-context/`. Production never noticed because no production code path calls `buildUserContextFromProfile` — all production callers use the fast path `buildUserContextFromAuth`. The integration script is the first runtime caller (per Behavior Step 4 of the requirement MD § Integration Test Tooling, which explicitly mandates the full profile path because "the live test is the place where persona quality matters most"), so it surfaced the bug.

**Fix shape (combined Option A + B):** Created the missing repository, exported it through the barrel, and updated `builders.ts` to use the singleton (matching the rest of the codebase — `agentRepository`, `executionRepository`, etc.).

**Files changed:**

| File | Change | Diff stat |
|---|---|---|
| `lib/repositories/UserProfileRepository.ts` | **NEW.** Read-only repo following the `new-repository` SKILL.md template. Exposes `findById(userId): Promise<RepositoryResult<UserProfile>>`. Queries `.from('profiles').select('id, full_name, role, company, timezone').eq('id', userId).maybeSingle()`. `maybeSingle` (not `.single()`) on purpose: brand-new users without a profile row should return `{ data: null, error: null }` so callers fall back to auth metadata cleanly rather than treating "no profile yet" as an error. Uses `supabaseServer` (service role) — documented inline because the `id` column IS the auth user id (one row per user); `.eq('id', userId)` is the user_id filter the skill rule requires, the column name is just different from the convention. Exports both the class and a `userProfileRepository` singleton. | +66 / -0 |
| `lib/repositories/index.ts` | Added `export { UserProfileRepository, userProfileRepository } from './UserProfileRepository';` and `export type { UserProfile } from './UserProfileRepository';` after the `InsightRepository` export, matching the existing alphabetical-ish convention used by the rest of the file. | +2 / -0 |
| `lib/user-context/builders.ts` | Line 2: changed `import { UserProfileRepository } from '@/lib/repositories';` to `import { userProfileRepository } from '@/lib/repositories';`. Line 25: replaced `const profileRepo = new UserProfileRepository(); const { data: profile } = await profileRepo.findById(user.id);` with `const { data: profile } = await userProfileRepository.findById(user.id);`. Public API of `buildUserContextFromProfile(user) → Promise<UserContext>` is unchanged — callers see no difference. | +2 / -3 |

**Sweep result (other callers of the affected symbols):**

`grep -rn "buildUserContextFromProfile\|UserProfileRepository\|userProfileRepository"` across `.ts`, `.tsx`, `.md`:

- `buildUserContextFromProfile` runtime callers: `tests/effort-estimator/scripts/run-on-agent.ts:470` is the **only** runtime caller. All other matches are documentation or backup files (`docs/USER_CONTEXT.md`, `docs/EFFORT_ESTIMATOR.md`, `docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`, `archive/CLAUDE_BACKUP_*.md`, this workplan).
- `UserProfileRepository` references: only the two sites in `lib/user-context/builders.ts` that this fix updates. Nothing else in the codebase imports the class.
- `userProfileRepository` (singleton): the new name. Only the one new use site in `builders.ts` plus the export in `index.ts`.

Conclusion: this fix breaks zero existing callers — there are none beyond the two it updates. The public `buildUserContextFromProfile(user) → Promise<UserContext>` API documented in `docs/USER_CONTEXT.md` is preserved byte-for-byte.

**Why I did NOT take alternative Option C (rename/relocate):** there was nothing to rename to — no existing class with a near-matching name does what's needed. Creating the repo is the only fix that satisfies both the documented API surface and the project's repository pattern (`REPOSITORY_STRATEGY.md` mandates all DB access go through `lib/repositories/`; an inline Supabase call in `builders.ts` would have been a CLAUDE.md mandatory rule #1 violation).

**Phase responsibility (per CLAUDE.md "Fix Issues at the Root Cause"):** This is `lib/user-context/` — outside the V6 pipeline. The phase rules in the V6 work protocol don't apply. The bug owner is whoever last touched `builders.ts` (the original author who wrote against a not-yet-existing class) — this fix completes that work.

**Verification — re-ran the user's failing command:**

```
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=8c7caa01-e328-4b0a-ae04-afbcd10add45 --dry-run
```

Script reached the end of the dry-run path and exited `PASS (dry-run)`. The hydrated `userContext` block printed by the runner shows full profile-table enrichment:

```json
{
  "full_name": "Barak Meiri",
  "email": "meiribarak@gmail.com",
  "role": "admin",
  "company": "AgentPilot",
  "domain": "(empty)",
  "timezone": "Asia/Jerusalem"
}
```

All four profile-table fields (`full_name`, `role`, `company`, `timezone`) were populated from the `profiles` row — confirming the new repository's `findById` returns the expected shape and `buildUserContextFromProfile` correctly merges profile-over-auth-metadata per `docs/USER_CONTEXT.md` § Data Sources. The script proceeded through model resolution (`gpt-4o-mini` fallback per AC-7), printed the dry-run payload, and produced the standard `RUN_SUMMARY` line. No new failure boundary — the dry-run path completed cleanly. (Wet run would proceed to the LLM call next; not exercised here because dry-run was the user's request and this fix is purely about restoring the pre-LLM hydration path.)

**Type-check:** `npx tsc --noEmit --skipLibCheck` reports the same 20 pre-existing errors in `archive/test-dsl-wrapper.ts` and `components/wizard/systemOutputs.ts`; zero new errors in any of the three touched files (`lib/repositories/UserProfileRepository.ts`, `lib/repositories/index.ts`, `lib/user-context/builders.ts`).

**What did NOT change:**

- The documented `buildUserContextFromProfile(user) → Promise<UserContext>` public API — same signature, same return shape.
- The `lib/user-context/index.ts` barrel — still re-exports `buildUserContextFromProfile` from `./builders`.
- `docs/USER_CONTEXT.md` — the spec already described the (correct) intended behavior; the bug was in code, not docs.
- `tests/effort-estimator/scripts/run-on-agent.ts` — caller is unchanged; the error trace pointed inside `builders.ts:25`, which is where the fix lives.
- `lib/supabaseServer.ts`, `app/api/plugins/google-token/`, `lib/client/GoogleDrivePicker.tsx`, `tmp_recon.ps1`, `.claude/settings*.json` — explicitly out-of-scope per the prompt constraints.

### Dry-run actually runs the estimator — `skipPersist` option — 2026-06-11

User ran `tests/effort-estimator/scripts/run-on-agent.ts --agent-id=8c7caa01-...add45 --dry-run` to see what the estimator would produce. The log only showed a placeholder:

```
--- DRY-RUN: payload that WOULD have been processed ---
{
  ...
  "would_have_called": "estimateEffort(input)",
  ...
}
```

User (correctly) complained: "where is the output that will be added to the agent_config? i want to see it."

**Root cause:** the previous Dev pass interpreted `--dry-run` as "no side effects, including no LLM call" — overly cautious. The requirement MD § Integration Test Tooling — Behavior is explicit: `--dry-run` "runs the estimator and prints the result but does NOT write to `agent_config.roi_estimate`". So dry-run SHOULD make the real LLM call and print the real estimate; only the DB write + audit event are suppressed.

**Decision: Option A (per the bug-fix prompt's recommendation) — add a `skipPersist` option to the estimator.**

Evaluated three options:

| Option | Shape | Verdict |
|---|---|---|
| **A — Add `skipPersist` option to `estimateEffort(input, options?)`** | Production function gets an optional second parameter. When `skipPersist === true`, the LLM call still runs, the candidate estimate is still assembled + validated + returned, but `repository.update(...)` and `auditLog(EFFORT_ESTIMATE_GENERATED)` are both skipped. Override-log preview is still emitted (useful for the dry-run user reading the log). | **PICKED.** Smallest production code surface (~30 lines incl. log + early-return), cleanest API at the call site (`estimateEffort(input, { skipPersist: true })` reads correctly), trivially testable, and strictly optional — all four existing callers (`dispatch.ts`, `route.ts`, both test files) continue to call `estimateEffort(input)` with no changes required. |
| B — Replicate the estimator pipeline in the script | Have the script call `resolveEffortEstimatorModel`, `buildEffortPrompt`, the provider, `LLMResponseSchema.parse`, `verifyReasoningMentionsPersona` directly. | **REJECTED.** Duplicates production logic in script-only code, which drifts from prod behavior over time. Defeats the whole "what production does is what the script does" point of the integration tooling. |
| C — Mock the repository / audit deps in the script | Inject no-op stubs for `agentRepository.update` and `auditLog` before calling `estimateEffort`. | **REJECTED.** Module-level state replacement is fragile (relies on import ordering + mutability of the imported singleton's prototype), and would require touching the script every time someone refactors how the estimator imports its deps. |

**Files changed:**

| File | Change | Diff stat |
|---|---|---|
| `lib/effort-estimator/EffortEstimator.ts` | Extended `EffortEstimator.estimate(input, options?)` and the `estimateEffort(input, options?)` convenience function with an optional `{ skipPersist?: boolean }` second parameter. Added a new branch (step 7a) between the persisted-shape Zod validation (step 6) and the read-modify-write merge (step 7) that, when `options.skipPersist === true`, emits an INFO log mirroring the production override-log shape (so the per-run log file still surfaces what production would have recorded) and returns `{ success: true, estimate, previousEstimate, attempts, totalDurationMs }` WITHOUT calling `repository.update` and WITHOUT firing `EFFORT_ESTIMATE_GENERATED`. Extended both the class-method JSDoc and the file-level docblock with explicit warnings that production callers (V6 save hook, API route, fire-and-forget dispatcher) MUST NOT pass this option. | +37 / -6 |
| `lib/effort-estimator/__tests__/EffortEstimator.test.ts` | Added two new tests: (1) `skipPersist=true: returns the estimate but does NOT write or audit` — asserts `chatCompletion` was called once, `update` was NOT called, `auditLog` was NOT called, and the returned `result.estimate` is the populated candidate. (2) `skipPersist=false (default) preserves original write + audit behavior` — defensive regression guarding against a future refactor flipping the default. All 8 tests pass (6 pre-existing + 2 new). | +73 / -0 |
| `tests/effort-estimator/scripts/run-on-agent.ts` | Rewrote the dry-run branch (step 7a) to call `estimateEffort(input, { skipPersist: true })` and surface the real estimate. Added a new `prominent(label, payload)` helper that wraps the load-bearing payloads in a `=====` 78-char header banner so the live tester reading the log doesn't have to grep — the estimate is what they came for, so it gets its own visual section. Used the new helper for both the dry-run estimate AND the live-mode estimate (`ESTIMATOR RESULT (...)`) plus the live-mode persisted-config re-read (`PERSISTED agent_config.roi_estimate`). Routine supplemental payloads (hydrated input summary, resolved model, override log preview, dry-run before/after re-read) still use the original `pretty(label, payload)` helper — the visual hierarchy makes scanning trivial. The dry-run branch ALSO re-reads the agent post-call and prints a comparison showing `agent_config_roi_estimate_before` vs `agent_config_roi_estimate_after` with a `slot_unchanged: true/false` field, proving the slot was not mutated. Updated the docblock comment at step 7a explaining the new contract + why it differs from the previous "no LLM" interpretation. PASS / FAIL exit code now reflects the estimator's `result.success` (was hardcoded PASS in the placeholder branch). | +85 / -29 |
| `tests/effort-estimator/README.md` | Rewrote `## What you should see` to reflect the new dry-run behavior (real estimate, banner-headed `ESTIMATOR RESULT`, post-run re-read with `slot_unchanged` field). Added a new `### Dry-run behavior (important)` sub-section that explicitly documents: dry-run DOES call the LLM, the user wants to see the result, only `repository.update` and the audit event are skipped, the script internally passes `skipPersist: true` to `estimateEffort`, and production callers must never pass this option. | +14 / -7 |

**What did NOT change:**

- The four production call sites of `estimateEffort(input)` (`lib/effort-estimator/dispatch.ts:37`, `app/api/v2/agents/[agentId]/estimate-effort/route.ts:81`, and the two test files at `EffortEstimator.test.ts` + `dispatch.test.ts`) — the new option is strictly optional and they all continue to call with a single argument, exactly as before. `git diff` of those files shows zero changes.
- Production live-mode write semantics — `skipPersist` defaults to undefined → falsy → the existing read-modify-write merge + audit event fire path is byte-identical to the pre-change code path.
- The requirement MD (`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`). The spec language "runs the estimator and prints the result but does NOT write" already describes the correct behavior; the script implements that via `skipPersist`, which is a script-only concern. No requirement edit needed.
- The design doc (`docs/EFFORT_ESTIMATOR.md`). Confirmed via grep that it does NOT document the `estimateEffort` function signature anywhere — the doc covers retry semantics, model resolution, async pattern, override semantics, etc., but never spells out the function's parameter list. So no design-doc edit needed either.
- Live-mode behavior of the script. The live-mode invocation still calls `estimateEffort(input)` (no options) → unchanged write + audit semantics.

**End-to-end verification — re-ran the user's failing command:**

```bash
npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=8c7caa01-e328-4b0a-ae04-afbcd10add45 --dry-run
```

Output (relevant excerpt — the user can finally see the estimate):

```
==============================================================================
  ESTIMATOR RESULT (dry-run — what would be written to agent_config.roi_estimate)
==============================================================================
{
  "success": true,
  "attempts": 1,
  "totalDurationMs": 5643,
  "estimate": {
    "reasoning": "As an admin at an SMB, Barak Meiri would manually perform this workflow by scanning the 'Contracts' folder in Google Drive, extracting relevant dates from each document, and compiling an HTML email summary. The process involves multiple steps for each document, including reading content and formatting the output. Assuming an average of 10 contracts to review, with each taking about 5 minutes (300 seconds), the total manual time would be 3000 seconds for the full run.",
    "is_bulk_workflow": false,
    "total_manual_time_seconds": 3000,
    "confidence": "High",
    "generated_at": "2026-06-11T12:33:10.798Z",
    "model": "gpt-4o-mini",
    "version": "1"
  },
  "previousEstimate": null
}
==============================================================================

--- DB row state AFTER dry-run (re-read to confirm slot is unchanged) ---
{
  "note": "DRY-RUN: estimator was invoked with skipPersist=true. No DB write was performed. No audit event was fired.",
  "agent_config_roi_estimate_before": null,
  "agent_config_roi_estimate_after": null,
  "slot_unchanged": true
}

PASS (dry-run): estimator returned a candidate estimate. model=gpt-4o-mini, attempts=1, total_manual_time_seconds=3000, script_duration_ms=5644. NO DB write. NO audit event.
```

Confirmed by direct log inspection:

| Check | Result |
|---|---|
| LLM was actually called | Yes — AIAnalyticsService logged `input_tokens: 1347, output_tokens: 129, cost_usd: 0.00027945, model_name: 'gpt-4o-mini'` for `feature: 'effort_estimator'`. |
| Estimate payload is PROMINENTLY visible | Yes — banner-headed `ESTIMATOR RESULT (...)` block shows the full `{ reasoning, is_bulk_workflow, total_manual_time_seconds, confidence, generated_at, model, version }`. |
| `agent_config.roi_estimate` was NOT mutated | Yes — script's own post-run re-read shows `agent_config_roi_estimate_before = null` and `agent_config_roi_estimate_after = null`, `slot_unchanged: true`. |
| `EFFORT_ESTIMATE_GENERATED` audit was NOT fired | Yes — `grep -c "EFFORT_ESTIMATE_GENERATED" tests/effort-estimator/logs/run-2026-06-11T12-33-00-631Z-8c7caa01.log` returns `0`. |

**Unit test results:** `npx jest lib/effort-estimator/__tests__/EffortEstimator.test.ts`:

```
PASS lib/effort-estimator/__tests__/EffortEstimator.test.ts (8.805 s)
  EffortEstimator.estimate
    √ happy path: writes merged config and fires the audit log
    √ override: surfaces previousEstimate and logs old + new (AC-6)
    √ retry exhaustion: NO write, NO audit, AC-2 slot left untouched
    √ invalid JSON retries within the budget then succeeds
    √ reasoning missing persona: still writes (does not block on AC-3)
    √ returns attempts=0 when the agent is not found (route maps to 404)
    √ skipPersist=true: returns the estimate but does NOT write or audit
    √ skipPersist=false (default) preserves original write + audit behavior

Tests:       8 passed, 8 total
```

**Type-check:** `npx tsc --noEmit --skipLibCheck` reports 20 errors, all pre-existing in `archive/test-dsl-wrapper.ts` and `components/wizard/systemOutputs.ts`. Zero new errors in any touched file.

---

## SA Review Notes

**Reviewed by SA — 2026-06-04**
**Status:** NEEDS REVISION (2 blocking items; ~10 minor changes)

### Process

I read the workplan in full, cross-checked the requirement MD, and verified each Dev claim against the actual code by reading:
- `app/api/create-agent/route.ts` (V6 save site, audit hook position, `enhanced_prompt` schema absence)
- `app/api/agents/[id]/route.ts` (PUT handler — confirmed it bypasses `AgentRepository` and uses direct Supabase)
- `lib/repositories/types.ts` (verified `UpdateAgentInput` missing `agent_config`)
- `lib/repositories/AgentRepository.ts` (verified `update()` spreads input directly, no impl change needed)
- `lib/audit/events.ts` (confirmed `AUDIT_EVENTS` const + metadata pattern, insertion point)
- `lib/pilot/insight/BusinessInsightGenerator.ts` (confirmed deprecated path's guard is on wrong column for AC-4)
- `lib/utils/featureFlags.ts` (confirmed `useV6AgentGeneration` pattern)
- `lib/ai/providers/baseProvider.ts` (verified `CallContext` shape + `supportsResponseFormat`)
- `lib/pilot/MetricsCollector.ts` (verified the consumer's read shape — slot left as `undefined` works correctly)
- `lib/agentkit/v6/config/AgentGenerationConfigService.ts` (confirmed model-resolver pattern + default-on-error behavior)
- `components/AgentWizard.tsx` (verified the legacy direct-Supabase path that explained Dev's `enhanced_prompt` ambiguity)

Verdict: the workplan is **architecturally sound** with two blocking issues that MUST be fixed before implementation. The estimator design itself (module layout, types, retry, prompt shape, audit, persona resolution, fire-and-forget pattern, failure semantics) is solid.

### Comments summary

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | AC-4 cannot pass with current deprecated-path guard (line 876 guards wrong column) | **BLOCKING** | pending Dev fix |
| 2 | Risk #4 gating field list is partially incorrect — `enhanced_prompt` and `pilot_steps` aren't in PUT handler's whitelist; need to gate on `agentData` (request body) not `updateData` | **BLOCKING** | pending Dev fix |
| 3 | Make `dispatchEffortEstimate` helper extraction **required**, not optional (two call sites + net-new pattern) | High | pending Dev change |
| 4 | API endpoint: replace `enhancedPrompt: ''` sentinel with `enhancedPrompt?: string` optional + fetch-on-undefined | Medium | pending Dev change |
| 5 | `retryWithBackoff` loop bound off-by-one — `attempts` returns 4 on exhaustion, not 3 | Medium | pending Dev verify+tighten |
| 6 | AC-7 test mechanics: dynamic import means `mockReturnValue(false)` on the flag is the right hook, not mocking `estimateEffort` | Medium | pending Dev change |
| 7 | AC-8 test reassignment — needs dedicated `modelResolver.test.ts` row, not reused from #4(c) | Medium | pending Dev change |
| 8 | Persona presence scan should accept role OR domain substring (not full persona string) — LLM paraphrasing is common | Low | pending Dev tune |
| 9 | `reasoning` truncation in INFO logs (PII / log-volume concern) | Low | pending Dev add |
| 10 | Use `supabaseServer` singleton instead of direct `createClient` in `modelResolver` | Low | pending Dev change |
| 11 | Add `manual_time_per_item_seconds?` to `UpdateAgentInput` extension while you're at it | Optional | Dev to decide |
| 12 | Race comment must be in code (estimator-vs-estimator create+immediate-edit scenario) | Low | pending Dev add |
| 13 | Dynamic-import-throw-bypass-void: wrap fire-and-forget block in `(async ()=>{...})()` chain | Medium | pending Dev pattern |
| 14 | Track Open Follow-Up: persist V6 enhanced prompt to `agents.enhanced_prompt` (improves estimator input quality) | Info | Dev to add to req MD follow-ups |
| 15 | Track Open Follow-Up: `AgentRepository.mergeAgentConfig` (RPC for atomic JSONB merge) — proper long-term shape | Info | Dev to add to req MD follow-ups |

### Risk decisions (summarized)

- **Risk #1 (env opt-in vs auto-flip):** APPROVE `.env.local` opt-in.
- **Risk #2 (config row migration):** APPROVE no migration — rely on in-code default.
- **Risk #3 (UpdateAgentInput shape):** APPROVE option (a) — extend the type. Optionally add `manual_time_per_item_seconds?` too.
- **Risk #4 (regen trigger gating):** NEEDS CHANGE — fix gating field list per detailed comment.
- **Risk #5 (race / AC-4 deprecated guard):** **BLOCKING** — extend the deprecated path's guard to check `agent_config.roi_estimate` directly.
- **Risk #6 (enhanced_prompt fallback):** APPROVE — fallback to `user_prompt` is correct. Track follow-up.
- **Risk #7 (Anthropic JSON parity):** APPROVE — prompt-level + Zod-retry pattern is fine.

### Net-new architectural patterns introduced

| Pattern | Status | Decision |
|---|---|---|
| Fire-and-forget `void fn().catch(...)` dispatch from API route | NET-NEW (no existing project usage) | APPROVE conditional on single-source-of-truth helper (`dispatchEffortEstimate`) |
| "Left-untouched on failure" slot semantics | NET-NEW (existing slots either always write or use sentinel `null`) | APPROVE — consistent with detection contract; documented |
| DB-config-driven model selection via `system_settings_config` | EXISTING (`AgentGenerationConfigService`) | APPROVE — mirror that pattern. Use `supabaseServer` singleton. |

### Verdict

**NEEDS_REVISION** — two blocking issues (AC-4 deprecated guard + Risk #4 gating list) must be fixed in the workplan before Dev starts implementation. Once those two are corrected and the workplan is re-submitted with the corrections inlined, this becomes APPROVE_FOR_IMPLEMENTATION.

> **Dev update (2026-06-07):** All 2 blocking items plus the conditional-approval pattern (dispatchEffortEstimate SSoT helper) have been addressed in this revision. See the SA Review Summary at the bottom of the workplan for the current verdict and the Change History row dated 2026-06-07 for the change summary. Verdict now reads: **APPROVE_FOR_IMPLEMENTATION pending SA re-confirmation.**

### Blocking items

1. **Extend deprecated path's guard for AC-4.** Edit `BusinessInsightGenerator.ts:884` to also check `!existingROI` (see Risk #5 detailed comment).
2. **Fix the regen-trigger gating field list** (see Risk #4 detailed comment). Gate on `agentData` (request body), not `updateData` (whitelist). Recognize `enhanced_prompt` and `pilot_steps` aren't currently in the PUT handler's update whitelist.

### Items for user / TL decision

- **(Optional)** Should Open Follow-Up #11 (`AgentRepository.mergeAgentConfig` RPC) and #12 (persist V6 enhanced prompt) be added to the requirement MD's follow-ups list, or tracked as separate post-release items? My recommendation: add to req MD.
- **(Optional)** Should the deprecated `updateAgentROI` path be deleted now (one cycle) instead of marked deprecated? The required guard fix is essentially the deprecated path's last patch — deletion may be cleaner. TL/user call.

### Approval

[ ] Workplan approved — proceed to implementation (pending SA re-confirmation 2026-06-07)
[X] Workplan NEEDS REVISION — fix blocking items #1 + #2 above, then re-submit (original 2026-06-04 verdict; revisions applied 2026-06-07)

---

## QA Testing Report

## QA Test Report — 2026-06-11

**Overall verdict:** `READY_FOR_RELEASE`

**Strategy used:** A + B (Jest unit + integration) per the QA trigger. No scripts, no E2E, no log-analysis. Type-check + `console.*` grep + correlationId / non-blocking-audit spot-check + doc/code drift check completed.

### Test suite results

| Test file | Suites | Tests | Passed | Failed | Skipped | Runtime |
|---|---|---|---|---|---|---|
| `lib/effort-estimator/__tests__/*` (6 files) | 6 | 40 | 40 | 0 | 0 | 28.1 s |
| `app/api/v2/agents/[agentId]/estimate-effort/__tests__/route.test.ts` | 1 | 6 | 6 | 0 | 0 | 3.1 s |
| `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` | 1 | 3 | 3 | 0 | 0 | 2.3 s |
| **Total** | **8** | **49** | **49** | **0** | **0** | **~33.5 s** |

No flake observed (single run). `EffortEstimator.test.ts` "retry exhaustion" case runs ~5 s due to a real 1 s + 4 s backoff sleep (not faked) — acceptable for the 60 s test timeout it sets.

### Acceptance Criteria coverage

| AC | Description (abbreviated) | Tests | Status | Notes |
|---|---|---|---|---|
| AC-1 | Newly created agent → `roi_estimate` populated within 30 s in ≥95 % of cases | `EffortEstimator.test.ts` "happy path" + `dispatch.test.ts` (V6 save-site dispatch) | PASS (functional); SLO is observability-only | The 30 s upper bound is enforced by `retryWithBackoff`'s `totalBudgetMs: 30000` (verified in `retryWithBackoff.test.ts` budget test). The ≥95 % real-world success rate is **runtime SLO**; covered structurally by the budget test but requires production observability to validate. |
| AC-2 | LLM failure exhausts retries → slot remains null + structured error log | `EffortEstimator.test.ts` "retry exhaustion" + `route.test.ts` 503 branch | PASS | Asserts no `update`, no `auditLog`, returns `success:false` + `attempts:3`. ERROR log line `"Effort estimator exhausted retries — slot left untouched"` observed in test output with `{err, attempts, totalDurationMs, correlationId}`. |
| AC-3 | Reasoning references inferred SMB-owner persona by name | `personaResolver.test.ts` (all 4 branches + lenient role-OR-domain scan) + `EffortEstimator.test.ts` "reasoning missing persona" + `buildEffortPrompt.test.ts` "persona verbatim" | PASS | WARN log observed when reasoning omits both role and domain; write still happens (drift detector, not gate — per design doc). |
| AC-4 | Deprecated `updateAgentROI` self-guard prevents overwriting fresh estimate | `updateAgentROI.guard.test.ts` (3 cases: skip-when-fresh / control / legacy-guard) | PASS | DEBUG log `"deprecated path skipping write — fresh estimate already present"` observed; `agent_config` never appears in the deprecated path's update payload when `existingROI` is set. |
| AC-5 | POST regen + previous logged at INFO with `{old_value, new_value, reason, correlationId}` | `route.test.ts` "AC-5 happy path" + `EffortEstimator.test.ts` "override" | PASS | INFO line carries `agent_id`, `reason`, `previous_total_manual_time_seconds`, `previous_is_bulk_workflow`, `new_total_manual_time_seconds`, `new_is_bulk_workflow`, `new_reasoning` (truncated to 500 chars), `model`, `persona`, `attempts`, `duration_ms`, and the `correlationId` is in the child logger context. |
| AC-6 | Existing estimate overridden → both old + new logged | `EffortEstimator.test.ts` "override" + `route.test.ts` "AC-5 happy path" | PASS | `audit.changes` carries `before: { roi_estimate: prior }` AND `after: { roi_estimate: newEstimate }`. INFO log line carries `previous_*` AND `new_*` numeric fields. |
| AC-7 | Missing `effort_estimator_model` row → fallback `gpt-4o-mini` + DEBUG log | `modelResolver.test.ts` "AC-8: falls back when row missing" + "AC-8: falls back when repository errors" + "unrecognised value shape" | PASS | (Note: AC numbering — this is AC-7 in the current requirement MD, was AC-8 before the descope. Tests still reference "AC-8" in `describe()`/`it()` text — historical, not a bug.) DEBUG log `"effort_estimator_model row missing — falling back to gpt-4o-mini default"` observed; resolver returns `{provider:'openai', model:'gpt-4o-mini'}`. |

### Edge case coverage

| Scenario | Tested? | File:line |
|---|---|---|
| Agent not found → 404, no LLM call | YES | `EffortEstimator.test.ts:235-250` + `route.test.ts:101-115` |
| LLM retries exhausted → 503, slot null, no audit write | YES | `EffortEstimator.test.ts:155-175` + `route.test.ts:117-131` |
| LLM returns invalid JSON → retry within budget | YES | `EffortEstimator.test.ts:177-205` (1st call "not json at all" → 2nd call valid JSON; result `attempts === 2`) |
| LLM omits required `reasoning` field → retry within budget | PARTIAL | Covered structurally by the same Zod-fail-→-retry mechanism as invalid JSON (LLMResponseSchema requires `reasoning.min(1)`), but no dedicated test asserts the missing-`reasoning` retry path specifically. See Test Gap #1. |
| Persona drift (reasoning lacks role AND domain) → WARN log fires, write succeeds | YES | `EffortEstimator.test.ts:207-233` (asserts `success:true` + `update` called; WARN `"Effort estimator: reasoning does not mention persona role/domain — possible prompt drift"` observed in stdout) |
| DB row missing AND DB row malformed both fall back to `gpt-4o-mini` | YES | `modelResolver.test.ts:30-46` (missing) + `:105-122` (unrecognised numeric value) + `:40-46` (repository error) |
| `agent_config` JSONB merge preserves existing keys (P0) | YES | `EffortEstimator.test.ts:66, 97-101` — input `agent_config: { creation_metadata: { from: 'test' } }`; post-merge assertion `expect(updateArg.agent_config.creation_metadata).toEqual({ from: 'test' })` |
| Dispatcher non-blocking on inner rejection | YES | `dispatch.test.ts:61-75` (rejection → error log fires) + `:77-82` (no synchronous throw) |
| Override INFO log includes `correlationId` AND truncates `reasoning` to ~500 chars | YES (structural) | Child logger created with `correlationId` at `EffortEstimator.ts:95`; `truncate(reasoning, 500)` at `:290`. INFO log line in test output carries `correlationId` in the child context and the persona-drift case shows `truncate` is wired in (`reasoning` field present, no over-length stack trace). No explicit assertion that the log line is truncated, but the helper has no logic branch — it's a pure string slice. Acceptable. |
| Audit trail entry is non-blocking (`.catch()` pattern) | YES | `EffortEstimator.ts:301-324` ends with `.catch((err) => requestLogger.error(...))`. Indirectly covered by happy-path test confirming `auditLog` is called and result success returned without awaiting audit completion. |

### CLAUDE.md mandatory-rule spot-check

| Check | Result | Evidence |
|---|---|---|
| Zero `console.log` / `console.error` / `console.warn` in production code | PASS | `grep -rn "console\.(log\|error\|warn)" lib/effort-estimator/ app/api/v2/agents/[agentId]/estimate-effort/` (excluding `__tests__`) returns zero hits. Also zero hits in `app/api/create-agent/route.ts` and `lib/pilot/insight/BusinessInsightGenerator.ts`. |
| `correlationId` threaded through every log line in `EffortEstimator.estimate()` and the route handler | PASS | Child logger created at `EffortEstimator.ts:94-99` with `{correlationId, agentId, userId, reason}`; every subsequent `requestLogger.*` inherits it. Route handler creates child at `route.ts:43-47`. Audit `details.correlationId` set at `EffortEstimator.ts:319`. |
| `auditLog` is called with `.catch()` (non-blocking) | PASS | `EffortEstimator.ts:301-324` — `auditLog({...}).catch((err) => requestLogger.error({err}, 'EFFORT_ESTIMATE_GENERATED audit failed (non-blocking)'))`. |

### Type-check + lint

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit --skipLibCheck` over the touched files | PASS | Zero new errors. Filtering output for `effort-estimator|estimate-effort|create-agent|BusinessInsightGenerator|repositories/types|audit/events` returns zero hits. Pre-existing errors in `archive/test-dsl-wrapper.ts` and `components/wizard/systemOutputs.ts` are unchanged from main (out-of-scope). |
| ESLint over touched files | NOT RUN | Both `npx eslint` (config-not-found — flat-config issue with this repo's eslint setup) and `npx next lint --dir ...` (interactive prompt) failed without lint output. `next lint` is also marked optional in the QA brief. No new lint complaints visible, but not a substitute for a clean lint pass — flagged as a non-blocking gap. |

### Doc sanity check

Three claims spot-checked against the code:

1. **`docs/EFFORT_ESTIMATOR.md:183` HTTP code table** — Success row says `201`. Verified against `route.ts:129` (`{ status: 201 }`). PASS.
2. **`docs/EFFORT_ESTIMATOR.md:170-173` deprecation guard line refs** — Says pre-existing `manual_time_per_item_seconds` guard at `:901`, new `existingROI` guard at `:916`. Verified against `BusinessInsightGenerator.ts:901` (`if (agent && (agent.manual_time_per_item_seconds === null || ...))`) and `:916` (`if (roiEstimate.total_manual_time_seconds && !existingROI) {`). PASS.
3. **AC renumbering** — Requirement MD shows 7 ACs (AC-1 through AC-7) with the former AC-7 (feature-flag) removed and AC-8 (model fallback) renumbered to AC-7. The Acceptance Criteria mapping table in the workplan still labels the model-fallback row as `AC-8` (line 1086) and the modelResolver test `describe()`/`it()` strings still say `"AC-8"`. Historical / stale references only — functional behavior matches the renumbered AC. Flagged in Test Gap #2 below.

### Bugs found

None at any severity (P0/P1/P2). All 49 tests pass; behavior matches the 7 ACs and the design doc.

### Test gaps

1. **(P2 — follow-up)** No dedicated test asserts that an LLM response missing the required `reasoning` field triggers a retry. Coverage is structural-only (Zod's `reasoning: z.string().min(1)` enforces it, and the same retry path is exercised by the `"invalid JSON"` test). A 5-line addition to `EffortEstimator.test.ts` that mocks `chatCompletion` to return `JSON.stringify({is_bulk_workflow: true, total_manual_time_seconds: 60})` on attempt #1 and a valid payload on attempt #2 would close this. Not in this PR — acceptable for v1.
2. **(P2 — cosmetic)** AC label drift in the workplan's Acceptance Criteria Mapping table (line 1086, says `AC-8`) and in `modelResolver.test.ts` `describe()`/`it()` strings (label `"AC-8"`). The requirement MD currently has 7 ACs; the model-fallback AC was renumbered to AC-7 on 2026-06-10. Test names are historical and harmless. A find-and-replace pass would tidy this up but does not affect functional coverage. Not blocking.
3. **(P2 — non-functional)** ESLint did not produce a clean pass (config/CLI issue). No visible lint debt, but a future PR should ensure `next lint` runs over this module.
4. **(P2 — non-functional)** AC-1's ≥95 % SLO is not provable from unit tests; requires production observability (success-rate metric on the `EFFORT_ESTIMATE_GENERATED` audit event vs. agents created). Flagged for the post-release operational checklist, not for this PR.

### Verdict rationale

The implementation is functionally complete and matches both the requirement MD (7 ACs) and the design doc (architecture, persona, retry, async, deprecation, failure semantics). All 49 tests pass on the first run; the JSONB-merge preservation that SA flagged as P0 is explicitly asserted; the AC-4 deprecated-path guard is exercised in all three relevant branches (skip / control / legacy guard); the API route maps the two failure shapes (`attempts === 0` → 404, `attempts === 3` → 503) cleanly; the dispatcher is non-blocking and re-entrant. CLAUDE.md mandatory rules (no `console.*`, `correlationId` threading, `auditLog().catch()`) all hold. Type-check produces zero new errors in any touched file. The four test gaps are all non-functional, non-blocking, and most are follow-up cosmetic work. The AC-1 ≥95 % SLO is the only criterion that cannot be proved from unit tests — it is an operational metric, structurally bounded by the verified 30 s budget. Ready for RM commit.



---

## Commit Info

_To be populated by RM._

---

## SA Review Summary (2026-06-04 → revised 2026-06-07)

| Status | Count | Notes |
|---|---|---|
| Approved sections | 11 | Architecture overview, Module layout, Type definitions, LLM prompt skeleton, Persona resolution (approve-with-nit), Retry mechanism, Failure semantics, API endpoint (approve+needs-change on sentinel), DB-driven model selection, Feature flag, Audit trail (approve+needs-change on PII), Risk #1, Risk #2, Risk #3, Risk #6, Risk #7 |
| Needs change | 8 | Sections affected: File-by-file (minor), Async fire pattern (helper extraction required), API endpoint (sentinel), Override behavior (race comment in code), Tests (AC-4/AC-7/AC-8 mappings), Deprecation work (AC-4 guard), Risk #4 (gating field list), Risk #5 (AC-4 guard) |
| Questions | 3 | Risk #5 concurrent-edit race acceptance, persona scan strictness, optional `manual_time_per_item_seconds?` in `UpdateAgentInput` extension |
| Revisions applied (2026-06-07) | 5 | (1) Deprecation work § item 0 — guard extension at line ~884 with DEBUG-log-on-skip; AC mapping + Test #6 updated. (2) Risk #4 gate now reads from `agentData` line 169 with value-comparison tightening; PUT handler's pre-existing direct-Supabase usage flagged out-of-scope. (3) `lib/effort-estimator/dispatch.ts` promoted to required SSoT helper; both async callers use it; API endpoint awaits estimator directly. (4) Known v1 limitations § L1 added documenting create-then-edit race + Open Follow-Up #11 reference; read-modify-write site requires inline comment. (5) Risks #1/#5/#6 marked RESOLVED with explanatory notes; Risk #5 split into AC-4 fix (now resolved by deprecation guard) + race window (accepted as v1 limitation). |

### Verdict

**APPROVE_FOR_IMPLEMENTATION pending SA re-confirmation** (was NEEDS_REVISION 2026-06-04; Dev applied all 5 user-approved revisions 2026-06-07 — see Change History row dated 2026-06-07).

### Blocking items

1. **AC-4 deprecated-path guard** (Risk #5 detailed comment + Deprecation work comment): `BusinessInsightGenerator.ts:876` guards `manual_time_per_item_seconds` — that's a different column from `agent_config.roi_estimate`. The deprecated path will silently overwrite a fresh estimate. Required fix: extend the guard at line 884 to check `!existingROI` before writing `agent_config.roi_estimate`.
   - **Resolution (2026-06-07):** Added as an explicit work item — see [Deprecation work § item 0](#deprecation-work) and Execution Order phase 8(a). Test #6 retargeted accordingly. AC mapping table updated.
2. **Risk #4 regen-trigger gating field list**: `enhanced_prompt` and `pilot_steps` are NOT in `app/api/agents/[id]/route.ts:264-297`'s updateData whitelist. Gating on `'enhanced_prompt' in updateData` always returns false. Required fix: gate on `agentData` (request body) instead of `updateData`. Optionally tighten by comparing prior vs new values.
   - **Resolution (2026-06-07):** [Risk #4](#risk-4--regeneration-trigger-point) now reads from `agentData` (line 169), with the SA-recommended value-comparison tightening on `user_prompt` and `workflow_steps`. The PUT handler's direct-Supabase usage is explicitly called out as a pre-existing CLAUDE.md violation out of scope for this cycle.
3. **Conditional approval — `dispatchEffortEstimate` SSoT helper.** The fire-and-forget pattern is net-new in this codebase; SA's conditional approval required extracting it into a single helper (CLAUDE.md mandatory rule #7).
   - **Resolution (2026-06-07):** `lib/effort-estimator/dispatch.ts` promoted from "consider" to **required** new file. Both async callers go through it; synchronous API endpoint awaits the estimator directly. IIFE-wrapping safeguards against import-throw escaping the `.catch` (SA comment #13). See [Async fire pattern](#async-fire-pattern).

### Items for user / TL decision (non-blocking)

- Whether to add follow-ups #11 (`AgentRepository.mergeAgentConfig` RPC) and #12 (persist V6 enhanced prompt) to the requirement MD's open follow-ups list. Recommendation: yes. **Status: BA updating requirement MD in parallel with this revision.**
- Whether to delete the deprecated `updateAgentROI` writer this cycle (avoids the guard fix needing a follow-on cleanup). Recommendation: TL/user call — this cycle is fine for marking @deprecated only.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-04 | Initial workplan | Dev authored after reading EFFORT_ESTIMATOR_REQUIREMENT.md + recon of V6 save site (`app/api/create-agent/route.ts:197,229`), MetricsCollector reader (`lib/pilot/MetricsCollector.ts:197-223`), deprecated path (`lib/pilot/insight/BusinessInsightGenerator.ts:50-54,549-577,866-919`), repository pattern (`AgentRepository.update` line 218), model-config pattern (`lib/agentkit/v6/config/AgentGenerationConfigService.ts`), retry sibling (`lib/agentkit/v6/utils/ProviderFallback.ts`), audit infrastructure (`lib/services/AuditTrailService.ts:470` + `lib/audit/events.ts`), and feature-flag pattern (`lib/utils/featureFlags.ts:79-83`). Surfaced 7 risks for SA review; #2/#3/#4 are blocking. |
| 2026-06-04 | SA Phase-1 review | SA reviewed workplan + cross-checked against actual code (create-agent route, agents-[id] PUT handler, AgentRepository, audit events, BusinessInsightGenerator, MetricsCollector, featureFlags, baseProvider, AgentGenerationConfigService, AgentWizard). Found 2 blocking issues: (1) AC-4's deprecated-path guard is on the wrong column — will silently overwrite fresh estimates, fix required at `BusinessInsightGenerator.ts:884`; (2) Risk #4 regen-trigger gating list assumes `enhanced_prompt`+`pilot_steps` are in PUT handler's updateData whitelist — they aren't, need to gate on `agentData` body instead. Verdict: NEEDS_REVISION. ~10 minor changes also flagged (dispatch helper extraction required, API endpoint sentinel cleanup, retry off-by-one, test mapping tweaks, persona scan robustness, log truncation for PII). Decisions confirmed: Risk #1 APPROVE env-opt-in; Risk #2 APPROVE no migration; Risk #3 APPROVE option-a `UpdateAgentInput` extension; Risk #6 APPROVE user_prompt fallback (verified V6 doesn't persist `enhanced_prompt`); Risk #7 APPROVE prompt-level + Zod-retry. |
| 2026-06-07 | SA review revisions applied | (1) Added BusinessInsightGenerator guard extension at line 884 to in-scope. (2) Fixed regen gate to read from agentData not updateData. (3) Promoted lib/effort-estimator/dispatch.ts to required (net-new pattern single-source-of-truth). (4) Added "Known v1 limitations" section documenting create-then-edit race + Open Follow-Up #11 reference. (5) Updated Risks section to mark all BLOCKING items RESOLVED. |
| 2026-06-10 | SA re-confirmation | SA re-reviewed all 5 revisions against the source code + requirement MD. All blockers verified resolved. APPROVED_FOR_IMPLEMENTATION. See "SA Re-Confirmation — 2026-06-10" section. |
| 2026-06-10 | Dev implementation | Dev implemented per the locked plan. Created `lib/effort-estimator/` module (7 source files + 6 test files), `lib/effort-estimator/dispatch.ts` SSoT helper, `app/api/v2/agents/[agentId]/estimate-effort/route.ts` API endpoint + tests, `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` AC-4 test. Modified `lib/utils/featureFlags.ts` (added `useEffortEstimator`), `lib/audit/events.ts` (added `EFFORT_ESTIMATE_GENERATED`), `lib/repositories/types.ts` (extended `UpdateAgentInput` with `agent_config?`), `app/api/create-agent/route.ts` (wired dispatcher after AGENT_CREATED audit), `app/api/agents/[id]/route.ts` (wired regen dispatcher with agentData-gated change detection), `lib/pilot/insight/BusinessInsightGenerator.ts` (added the `existingROI` AC-4 guard, the legacy-guard `do NOT remove` comment, and `@deprecated` JSDoc on `updateAgentROI`). Addressed all 7 SA non-blocking observations except #3 (SESSION PAUSE STATE — historical) and #11 (`manual_time_per_item_seconds?` extension — out of scope until deprecated writer is deleted). Type-check passes (no new errors in any touched file). No commit yet — awaiting user review. |
| 2026-06-10 | User code review revisions | User-led code review caught two issues SA missed and applied one scope reduction: (1) Removed feature flag entirely (`useEffortEstimator()` helper, `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` env var, `getFeatureFlags()` entry, dispatch-time gate, dispatch.test.ts flag assertions, docblock references in API route). The dispatcher now always fires. (2) Fixed CLAUDE.md mandatory rule #1 violation in `lib/effort-estimator/modelResolver.ts` — refactored to use `systemConfigRepository.getByKey()` via the existing `lib/repositories/SystemConfigRepository.ts` (which SA incorrectly said didn't exist). Tests rewritten to mock the repository singleton. (3) Reverted PUT handler dispatch in `app/api/agents/[id]/route.ts` (Trigger #2 / automatic regeneration descoped to v2, tracked as Open Follow-Up #10). `git diff 2f6433c -- app/api/agents/[id]/route.ts` now produces zero output. Dispatch helper itself retained — V6 save site is still a live caller and Open Follow-Up #10 will be its second. See [User Code Review Revisions — 2026-06-10](#user-code-review-revisions--2026-06-10). |
| 2026-06-11 | Integration test tooling delivered | Created `tests/effort-estimator/scripts/run-on-agent.ts` + `tests/effort-estimator/README.md` per requirement MD § Integration Test Tooling (lines 199-279) + AC-8 (line 326). The CLI runner hydrates `EffortEstimatorInput` from an existing agent row (`user_id` always read from the row — never CLI-supplied, per Safety #2), builds `user_context` via the full `buildUserContextFromProfile` path, calls `estimateEffort` directly, and re-reads the row post-write to confirm the persisted `roi_estimate`. `--dry-run` short-circuits before the LLM + DB. Pattern mirrors `tests/v6-regression/scripts/`. Uses one inline `supabaseServer` read (documented script-only) to discover `user_id` before dropping back through `AgentRepository` for the real fetch — no new public method was added to the repository. See [Integration Test Tooling — 2026-06-11](#integration-test-tooling--2026-06-11) under Implementation Notes. |
| 2026-06-11 | Per-run log file added to runner | Extended `tests/effort-estimator/scripts/run-on-agent.ts` to write a per-run JSON-Lines log file (default `tests/effort-estimator/logs/run-{ISO-timestamp}-{agentIdShort}.log`; `:`/`.` in the timestamp normalized to `-` for Windows compatibility). Capture strategy is a `process.stdout.write` tee into `fs.createWriteStream(filePath, { flags: 'a' })` — both the script's own Pino logger AND the estimator's child loggers (built via the project's shared `baseLogger` in `lib/logger.ts`) write to stdout by default, so a single stdout-tee handles both uniformly. `pino.multistream` was considered for the script logger but rejected because it would double-record script lines (once via multistream's file write, once via the stdout tee). `lib/logger.ts` was deliberately NOT modified — file logging is script-scoped. Added `--log-dir=<path>` flag, synthetic `RUN_SUMMARY` final line, 4-char hex suffix on millisecond collision, fsync-on-exit (`fileStream.end()` + await `'finish'` before `process.exit`), and pre-logger error fallback. Console output byte-identical to the previous version. Updated `tests/effort-estimator/README.md` with a new "Per-run log file" section + `--log-dir` row. Added `tests/effort-estimator/logs/` to the repo-root `.gitignore` matching the existing `simulators/**/output/` convention. No new dependencies (pino 10.1.0 already a project dep). Type-check `npx tsc --noEmit --skipLibCheck` reports zero new errors in any touched file (20 pre-existing errors in `archive/` and `components/wizard/systemOutputs.ts` unchanged from `main`). See [Per-run Log File — 2026-06-11](#per-run-log-file--2026-06-11) under Implementation Notes. |
| 2026-06-11 | Script self-load fix in `run-on-agent.ts` | Follow-up to the earlier `--import ./scripts/env-preload.ts` fix — the hook approach worked but was UX-fragile (one missed flag → `Error: supabaseUrl is required.` crash). User hit the footgun once today. Replaced the external preload-hook dependency with a co-located bootstrap-import file: created `tests/effort-estimator/scripts/_load-env.ts` (underscore prefix signals "internal, must run first") containing `dotenv.config({ path: '.env.local' })` at module-evaluation time, with hard-fail on missing/unparseable `.env.local`. Made `import './_load-env'` the VERY FIRST import in `run-on-agent.ts` — ahead of `crypto`, `fs`, `path`, everything else. ES modules guarantee static side-effect imports evaluate to completion in source order, depth-first, so `process.env` is populated before `@/lib/supabaseServer` is resolved. Plain invocation `npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=<uuid>` now works with zero flags. Updated `run-on-agent.ts` docblock + `tests/effort-estimator/README.md` § Usage (replaced "Why `--import`?" sub-section with a new "Env loading" note pointing at `_load-env.ts`). Did NOT touch `scripts/env-preload.ts` (still in use by v6-regression scripts). Did NOT touch `lib/supabaseServer.ts`, `lib/repositories/`, or `lib/effort-estimator/`. Verified end-to-end with `npx tsx tests/effort-estimator/scripts/run-on-agent.ts --agent-id=00000000-0000-4000-8000-000000000000 --dry-run` — script reaches Supabase, returns "agent not found" cleanly, writes the per-run log file, exits non-zero (correct). Type-check `npx tsc --noEmit --skipLibCheck` reports the same 20 pre-existing errors in `archive/` + `components/wizard/systemOutputs.ts` and zero in any cycle file. See [Script self-loading — 2026-06-11](#script-self-loading--2026-06-11) under Implementation Notes. |
| 2026-06-11 | Fix: env load order in `run-on-agent.ts` (startup crash) | User reported `Error: supabaseUrl is required.` on every invocation of the integration test runner. Root cause: `lib/supabaseServer.ts` constructs the service-role client eagerly at module load (`export const supabaseServer = createServerSupabaseClient()`), and ES module `import` statements are hoisted ahead of any executable code in the importing file — so the original top-of-file `dotenv.config(...)` call ran AFTER the `@/lib/supabaseServer` import had already evaluated, and supabaseServer was built against an empty `process.env`. Fix shape: switched to the project's canonical precedent — `npx tsx --import ./scripts/env-preload.ts ...` (same invocation `tests/v6-regression/scripts/import-regression-scenarios-as-agents.ts` uses). The `--import` hook loads `scripts/env-preload.ts` (which calls `dotenv.config({ path: '.env.local' })`) fully BEFORE any of this script's imports resolve. Removed the in-module `import { config as dotenvConfig } from 'dotenv'` + the explicit `dotenvConfig({ path: ... })` call from `tests/effort-estimator/scripts/run-on-agent.ts`. Replaced with a docblock paragraph explaining the env-load contract so future readers don't reintroduce the bug. Updated the `Usage:` block in the docblock + `tests/effort-estimator/README.md` § Usage with the new invocation and a new "Why `--import ./scripts/env-preload.ts`" sub-section pointing at the eager-construction issue. Did NOT modify `lib/supabaseServer.ts` (out-of-scope per the bug-fix prompt — a project-wide change). Did NOT modify `lib/repositories/`, `lib/effort-estimator/`, or `scripts/env-preload.ts` (the latter is shared with the v6-regression scripts). Verified end-to-end with `npx tsx --import ./scripts/env-preload.ts tests/effort-estimator/scripts/run-on-agent.ts --agent-id=00000000-0000-4000-8000-000000000000 --dry-run` — script now reaches Supabase, returns a clean "agent not found" `RUN_SUMMARY`, and writes the per-run log file. Type-check `npx tsc --noEmit --skipLibCheck` reports the same 20 pre-existing errors in `archive/` + `components/wizard/systemOutputs.ts` and zero in any cycle file. |
| 2026-06-11 | TypeScript sweep — cycle files | User reported residual TS errors in the cycle files after earlier "zero new errors" claims. Performed a focused file-by-file sweep across every TS file touched by the cycle (8 new source files in `lib/effort-estimator/`, 6 test files in `lib/effort-estimator/__tests__/`, 1 new route + 1 route test under `app/api/v2/agents/[agentId]/estimate-effort/`, the 688-line `tests/effort-estimator/scripts/run-on-agent.ts` runner, the `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` guard test, and the 4 modified files: `app/api/create-agent/route.ts`, `lib/audit/events.ts`, `lib/repositories/types.ts`, `lib/pilot/insight/BusinessInsightGenerator.ts`). Tools used: project-default `npx tsc --noEmit --skipLibCheck`, then a stricter re-compile with `--strict --noImplicitAny --noUnusedLocals --noImplicitReturns --strictNullChecks`, plus end-to-end manual reads of the suspicious patterns identified by the user (stdout-tee override, Pino LogFn overloads, dotenv typing, fs.createWriteStream callback typing, process.exit after stream end, inline Supabase select typing, AgentRepositoryResult union narrowing, untyped Jest mocks, missing awaits). Both tsc runs returned 20 errors total — all pre-existing in `archive/test-dsl-wrapper.ts` and `components/wizard/systemOutputs.ts`; zero in any cycle file. `diff` of the two runs is empty (no hidden flag downgrade). Manual spot checks on all 8 suspicion patterns passed. ESLint sweep attempted but the project's lint pipeline is in a pre-existing broken state (eslint 9 flat-config migration incomplete: `next lint` falls into interactive setup, `npx eslint` reports "File ignored because no matching configuration was supplied"). Zero fixes applied, zero bugs found for user-decided action. Most likely IDE-side cause if errors persist visually: stale incremental TS server cache or IDE-surfaced ESLint warnings being mistaken for tsc errors. See [TypeScript Sweep — 2026-06-11](#typescript-sweep--2026-06-11) under Implementation Notes for the per-file table + methodology. |
| 2026-06-11 | Fix: dry-run actually runs the estimator (`skipPersist` option) | User ran `tests/effort-estimator/scripts/run-on-agent.ts --agent-id=8c7caa01-...add45 --dry-run` and complained: "where is the output that will be added to the agent_config? i want to see it." The log only showed a `"would_have_called": "estimateEffort(input)"` placeholder. Root cause: previous Dev pass interpreted `--dry-run` as "no side effects, including no LLM call" — overly cautious. The requirement MD § Integration Test Tooling — Behavior is explicit: dry-run "runs the estimator and prints the result but does NOT write". Fix shape (Option A from the prompt's recommendation): added an optional `{ skipPersist?: boolean }` second parameter to `EffortEstimator.estimate(input, options?)` and the `estimateEffort(input, options?)` convenience export. When `skipPersist === true`, the LLM call still runs, the candidate estimate is still assembled + validated + returned, and the override-log preview still fires (lands in the per-run log file), but `repository.update(...)` and `auditLog(EFFORT_ESTIMATE_GENERATED)` are both skipped — slot stays byte-identical, no audit-trail entry. Option strictly optional and defaults to undefined → falsy → original behavior, so production callers (V6 save hook, API route, fire-and-forget dispatcher) need ZERO changes. Updated `tests/effort-estimator/scripts/run-on-agent.ts` dry-run branch to call `estimateEffort(input, { skipPersist: true })` and surface the real estimate, with a new `prominent(label, payload)` helper that wraps the estimate (and the live-mode persisted-config re-read) in a `=====` 78-char header banner so the live tester reading the log doesn't have to grep. Dry-run also re-reads the row post-call and prints a `slot_unchanged: true/false` field proving non-mutation. Added 2 new tests to `lib/effort-estimator/__tests__/EffortEstimator.test.ts` (8/8 pass): `skipPersist=true` skips write+audit and returns the estimate; `skipPersist=false` (default) preserves original behavior (defensive regression). End-to-end verified with the user's UUID: LLM was called (`AIAnalyticsService` logged `cost_usd: 0.00027945`), estimate displays prominently (`total_manual_time_seconds: 3000`, full `reasoning` visible), `agent_config.roi_estimate` is unchanged (`slot_unchanged: true`), zero `EFFORT_ESTIMATE_GENERATED` matches in the per-run log file. `npx tsc --noEmit --skipLibCheck` reports the same 20 pre-existing errors. No requirement MD edits needed (spec already correct). No design-doc edits needed (`docs/EFFORT_ESTIMATOR.md` doesn't document the function signature). README's "What you should see" section rewritten + new "Dry-run behavior (important)" sub-section added. Diff stat: `+37/-6` `EffortEstimator.ts`, `+73/-0` `EffortEstimator.test.ts`, `+85/-29` `run-on-agent.ts`, `+14/-7` `README.md`. See [Dry-run actually runs the estimator — `skipPersist` option — 2026-06-11](#dry-run-actually-runs-the-estimator--skippersist-option--2026-06-11) under Implementation Notes for full detail. |
| 2026-06-11 | Fix: `UserProfileRepository is not a constructor` runtime crash in `buildUserContextFromProfile` | User ran `tests/effort-estimator/scripts/run-on-agent.ts --agent-id=8c7caa01-...add45 --dry-run` and hit `TypeError: import_repositories.UserProfileRepository is not a constructor` at `lib/user-context/builders.ts:25`. Root cause: pre-existing latent bug — the repository class was never implemented anywhere in the codebase, the barrel `lib/repositories/index.ts` did not export it, and there was no `lib/repositories/UserProfileRepository.ts` file on disk. Production never noticed because no production code path calls `buildUserContextFromProfile` (all production callers use the fast path `buildUserContextFromAuth`); the integration script is the first runtime caller and surfaced the bug. Fix shape (combined Option A + B): created `lib/repositories/UserProfileRepository.ts` following the `new-repository` SKILL.md template (read-only repo, `findById(userId)` querying `.from('profiles').select('id, full_name, role, company, timezone').eq('id', userId).maybeSingle()` — `maybeSingle` so brand-new users without a profile row return `{ data: null, error: null }` cleanly), exported `UserProfileRepository` + `userProfileRepository` singleton + `UserProfile` type from `lib/repositories/index.ts`, and updated `lib/user-context/builders.ts` to use the singleton (`const { data: profile } = await userProfileRepository.findById(user.id);` — matches the `agentRepository` / `executionRepository` style used elsewhere). Public `buildUserContextFromProfile(user) → Promise<UserContext>` API unchanged — only one runtime caller exists (the script) and it now passes the dry-run end-to-end with full profile enrichment (`full_name`, `role`, `company`, `timezone` all populated from the user's `profiles` row). Type-check `npx tsc --noEmit --skipLibCheck` reports the same 20 pre-existing errors in `archive/` + `components/wizard/systemOutputs.ts`; zero new errors in any of the three touched files. Diff stat: `+66/-0` on the new repository, `+2/-0` on the barrel, `+2/-3` on `builders.ts`. Sweep across `.ts`/`.tsx`/`.md` for `buildUserContextFromProfile` / `UserProfileRepository` / `userProfileRepository` confirms zero other runtime callers are affected — all other matches are docs or archived files. See [UserProfileRepository missing — runtime fix — 2026-06-11](#userprofilerepository-missing--runtime-fix--2026-06-11) under Implementation Notes for full detail. |
| 2026-06-11 | Cycle close-out: retrospective + post-release decision callout | TL wrote `docs/retrospectives/EFFORT_ESTIMATOR_RETROSPECTIVE.md` capturing what shipped, what went well, what didn't, surprises, patterns to remember, and the four open follow-ups (#1, #8, #9, #10). Added a prominent "⏳ Post-Release Decision Required — updateAgentROI delete-or-keep" callout near the top of this workplan (after SESSION PAUSE STATE, before Overview) so future readers see the decision without grep-hunting. Cycle merged to main 2026-06-11 as merge commit 16069d1; feature/effort-estimator branch preserved at user's request. |

---

## SA Re-Confirmation — 2026-06-10

**Verdict:** APPROVED_FOR_IMPLEMENTATION

**Reviewer process:** Re-read the workplan in full, cross-checked the 5 revisions against the requirement MD (`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md` — committed `d6f2852` with deprecation sub-bullet at line 213 + Open Follow-Ups #8/#9 at lines 260-261), and verified each fix against the source files I cited in my first-pass review (`BusinessInsightGenerator.ts:860-919`, `app/api/agents/[id]/route.ts:160-290`).

### Revision verification table

| Revision | Blocker addressed? | Notes |
|---|---|---|
| 1. line-884 guard extension | ✅ | Verified at workplan § Deprecation work item 0 (lines 959-980). Code snippet correctly reads `(agent.agent_config as Record<string, any> \| null)?.roi_estimate` BEFORE writing, with `&& !existingROI` gate on the `if (roiEstimate.total_manual_time_seconds...)` branch, plus a DEBUG-log-on-skip `else if (existingROI)` branch. Cross-checked against actual source — current code at line 884 of `BusinessInsightGenerator.ts` writes unconditionally when `roiEstimate.total_manual_time_seconds` is truthy. The proposed 2-line guard correctly closes the AC-4 hole. Test #6 in the Tests section (workplan line 1045) explicitly asserts the SKIP behavior. Execution Order phase 8(a) also lists it. Requirement MD § Deprecation (line 213) mirrors this scope. |
| 2. Risk #4 gate corrected to agentData | ✅ | Verified at workplan § Risk #4 (lines 1146-1213). Gate now references `agentData` (line 1158-1164), which I confirmed matches `app/api/agents/[id]/route.ts:169` (`const { agent: agentData } = body;`). The whitelist at lines 262-283 of the PUT handler correctly does NOT copy `enhanced_prompt` or `pilot_steps`, so the corrected gate is the right source of truth. Tightening on `user_prompt !== existingAgent.user_prompt` and `JSON.stringify(workflow_steps)` comparison addresses my recommendation #3. The pre-existing direct-Supabase usage at lines 194-199 / 303-309 is explicitly called out as out-of-scope (workplan line 1186), consistent with my Phase-1 finding. |
| 3. dispatch.ts SSoT helper promoted to required | ✅ | Verified at workplan § Async fire pattern (lines 541-642). Helper signature `dispatchEffortEstimate(input: EffortEstimatorInput, logger: Logger): void` wraps (a) `useEffortEstimator()` flag check, (b) dynamic `import('./EffortEstimator')`, (c) `void (async () => { ... })().catch(...)` IIFE chain that correctly routes import-throws through the catch (addresses my comment #13). Listed in Module layout (line 153), File-by-file task list (line 251), and consumed by both V6 save (lines 592-602) + PUT regen (lines 606-616). API endpoint correctly does NOT use it (line 619). CLAUDE.md mandatory rule #7 (no new patterns without SA review) is satisfied via single-source-of-truth. |
| 4. v1 limitations section added | ✅ | Verified at workplan § Known v1 limitations (lines 1282-1303). Documents the create-then-quick-edit race (L1) with: (a) explicit scenario walkthrough, (b) acceptance rationale (low probability, observable via INFO override log carrying `correlationId` + `old_value` + `new_value`), (c) pointer to Open Follow-Up #8 in the requirement MD (the workplan says #11 — see "New findings" below for the numbering drift), (d) required inline comment at the read-modify-write site referencing the limitation. Cross-checked: the comment is already drafted in the pseudocode at workplan lines 516-522. |
| 5. Risks reclassified RESOLVED | ✅ | Verified — Risk #1 (line 1091), Risk #5 (line 1215), Risk #6 (line 1255) all explicitly marked RESOLVED with refs to the fixes. Risk #4 retains its detailed history but the corrected gate is inlined at the top with the SA review thread preserved below for audit. SA Review Summary table (line 1452) shows "Revisions applied (2026-06-07): 5" with per-row resolution notes. Verdict at line 1456 reads APPROVE_FOR_IMPLEMENTATION pending SA re-confirmation (now resolved by this re-confirmation). |

### Requirement-MD ↔ workplan scope alignment

- Requirement MD Open Follow-Up #8 (`mergeAgentConfig` RPC, race condition) → workplan § Known v1 limitations § L1 (line 1286). **NOTE:** workplan refers to it as Open Follow-Up #11 throughout (drift from when BA had only 7 follow-ups); requirement MD now numbers it as #8. Non-blocking — Dev should update the pointer numbers during implementation to keep cross-refs accurate, but neither the limitation nor the fix shape is in dispute.
- Requirement MD Open Follow-Up #9 (persist V6 `enhanced_prompt`) → workplan § Risk #6 (line 1255) acknowledges the re-trigger quality gap and references it as Open Follow-Up #12 (same numbering drift). Non-blocking.
- Requirement MD § Deprecation sub-bullet (line 213) → workplan § Deprecation work item 0 (line 959). Direct match.
- All 8 ACs map to tests in the workplan § Tests + § Acceptance criteria mapping (line 1075). Test #6 explicitly retargeted for AC-4 against the new guard. Test mapping for AC-7 (line 1065) and AC-8 (line 1066) was flagged in my Phase-1 review; both are now resolved in the workplan's prose but the table at line 1083 still says "Test #8" for AC-8 — Dev should make sure Test #8 is a dedicated `modelResolver.test.ts` row, not a reuse of #4(c). Non-blocking but call it out during code review.

### CLAUDE.md mandatory rules check

| Rule | Status | Evidence |
|---|---|---|
| #1 Repos for DB access | ✅ | All estimator writes go via `AgentRepository.update`. Pre-existing PUT handler violation explicitly flagged out-of-scope (workplan line 1186). |
| #2 Zod on API inputs | ✅ | `RequestSchema = z.object({}).strict()` on POST endpoint (line 687). Estimator's LLM response also Zod-validated via `ROIEstimateV1Schema`. |
| #3 correlationId + Pino | ✅ | All log calls + audit entries carry `correlationId`. Request-scoped child logger created in API route + dispatcher. No `console.log` in any new module (pre-existing console.log in PUT handler is out-of-scope). |
| #4 `.eq('user_id', userId)` | ✅ | All `AgentRepository.findById` / `.update` calls in the estimator take `(id, userId)` as paired params — repository already enforces the filter. |
| #5 No hardcoded model names | ✅ | `modelResolver` reads from `system_settings_config` with `gpt-4o-mini` as in-code default (AC-8 explicitly tests this). LLM call goes through `ProviderFactory.getProvider(provider)`. |
| #6 TypeScript strict | ✅ | All new types defined explicitly; no `any` in new module signatures. The `(agent.agent_config as Record<string, any>)` casts in the BusinessInsightGenerator guard extension are pre-existing style in that file. |
| #7 No new patterns without SA review | ✅ | The net-new fire-and-forget dispatch is consolidated in `lib/effort-estimator/dispatch.ts` per my conditional approval. |
| #8 Audit trail non-blocking | ✅ | `auditLog(...).catch(err => logger.error(...))` pattern at lines 917-936. |

### New findings (non-blocking)

1. **Open Follow-Up numbering drift.** Workplan uses #11 (mergeAgentConfig RPC) and #12 (persist V6 enhanced_prompt). Requirement MD now uses #8 and #9 for the same items. Dev should align the pointer numbers in the workplan's prose + inline code comment at the read-modify-write site during implementation. No functional impact — both docs describe the same items.
2. **AC-8 test row.** The Acceptance criteria mapping table at line 1083 lists "Test #8" for AC-8 but the Cross-cutting tests table at line 1047 still labels it "Reuse #4 case (c)". Per my Phase-1 comment #7, AC-8 needs a dedicated `modelResolver.test.ts` row. Dev should make this an explicit new sub-test during implementation (the modelResolver.test.ts file is already in the Module layout at line 159).
3. **SESSION PAUSE STATE section.** The top-of-file pause-state block uses Open Follow-Up #11/#12 names but those should be remapped to #8/#9 when the section is cleaned up post-implementation. Non-blocking; meta-bookkeeping only.
4. **Persona scan robustness (Phase-1 comment #8).** Still standing — Dev should use `role`-OR-`domain` substring scan rather than full persona string for AC-3 verification. Non-blocking; noted in code review pass.
5. **Reasoning truncation in INFO logs (Phase-1 comment #9).** Still standing — truncate `reasoning` to ~500 chars at the log site (full payload preserved in audit table). Non-blocking; noted in code review pass.
6. **`retryWithBackoff` off-by-one (Phase-1 comment #5).** Still standing — assert `attempts === 3` on exhaustion, not 4. Non-blocking; noted in code review pass.
7. **`supabaseServer` singleton in `modelResolver` (Phase-1 comment #10).** Still standing — prefer `supabaseServer` over direct `createClient`. Non-blocking; noted in code review pass.

None of these block implementation. The blockers from the first pass are all resolved, and these residual items are within the scope of normal code review.

### Decision rationale

All 5 first-pass blockers have been correctly addressed at the prose, file-reference, and line-number level, and the workplan is now internally consistent with the requirement MD (modulo the cosmetic Open Follow-Up numbering drift). The two architectural risks I flagged in Phase 1 (AC-4 silent overwrite + Risk #4 wrong source) have root-cause fixes verifiable against the actual source code at the cited lines. The net-new fire-and-forget pattern is consolidated to a single SSoT helper per CLAUDE.md rule #7. The v1 limitations section makes the accepted trade-offs explicit and observable. Dev may proceed to implementation; code review will catch the residual ~10 minor items already enumerated.

### Approval

[X] Workplan APPROVED FOR IMPLEMENTATION — proceed
[ ] NEEDS REVISION
[ ] BLOCKED

---

## SA Code Review — 2026-06-10

**Verdict:** `APPROVED_CODE_REVIEW`

**Reviewer process:** Read every file in the uncommitted in-tree diff (17 new, 7 modified) against the requirement MD (`d6f2852`), my own approved workplan, and the 7 non-blocking observations I left in § SA Re-Confirmation (lines 1487-1543). I traced each AC to specific lines, walked the 5 unspecified decisions against project conventions, and checked all 8 CLAUDE.md mandatory rules. The implementation is tighter than the workplan implied: the AC-2 differentiation between "agent not found" and "retries exhausted" is cleanly threaded through `attempts === 0 | 3`, the SSoT dispatcher routes import-throws back through `.catch` as required, and the AC-4 guard fix is exactly the 2-line extension the SA blocker called for.

### 7 SA observations follow-up

| # | Observation | Addressed? | Evidence |
|---|---|---|---|
| 1 | Open Follow-Up numbering aligned (req MD: #8 / #9, not #11 / #12) in inline code | ✅ | `lib/effort-estimator/EffortEstimator.ts:258` reads `See Open Follow-Up #8 in docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`. Older workplan prose still says #11/#12 in historical sections — Dev called this out in Implementation Notes (line 1342). |
| 2 | AC-8 has a dedicated `modelResolver.test.ts` file | ✅ | `lib/effort-estimator/__tests__/modelResolver.test.ts:27` `it('AC-8: falls back to gpt-4o-mini on OpenAI when the row is missing', ...)`. Asserts the exact default. |
| 4 | `verifyReasoningMentionsPersona` uses role-OR-domain substring scan | ✅ | `lib/effort-estimator/personaResolver.ts:55-57` accepts either role OR domain match. Tests at `__tests__/personaResolver.test.ts:40-58` lock both branches. |
| 5 | `reasoning` truncated to ~500 chars in INFO logs | ✅ | `lib/effort-estimator/EffortEstimator.ts:47-50` `truncate(value, max = 500)`. Called at the INFO override log (line 290) and the AC-3 drift WARN (line 250). Full reasoning preserved in the audit table (lines 308-309) — correct trade-off. |
| 6 | `retryWithBackoff` returns `attempts === 3` on exhaustion | ✅ | `lib/effort-estimator/retryWithBackoff.ts:100` `attempts: delays.length`. Test at `__tests__/retryWithBackoff.test.ts:38-47` literally named `'returns ok=false and attempts=3 on exhaustion (SA observation #6: NOT 4)'`. |
| 7 | `modelResolver` uses `supabaseServer` singleton | ✅ | `lib/effort-estimator/modelResolver.ts:20` imports `supabaseServer`. No `createClient(... SERVICE_ROLE ...)` anywhere in the module. |

### 5 unspecified design decisions

| # | Decision | Sound? | Notes |
|---|---|---|---|
| 1 | Route param `[agentId]` not `[id]` (Next.js sibling-segment constraint + `form-metadata` convention) | ✅ | Confirmed only sibling at `app/api/v2/agents/` is `form-metadata`, which already uses `[agentId]`. Next.js would reject `[id]` at the same level. No external caller for `/api/v2/agents/[id]/*` exists, so no breakage. (The pages route under `app/v2/agents/[id]` is a separate tree — page routes vs API routes — not affected.) |
| 2 | Two Zod schemas — `LLMResponseSchema` (passthrough/lenient) vs `ROIEstimateV1Schema` (strict, stamped with `generated_at` / `model` / `version`) | ✅ | Correct separation of trust boundary (LLM output) from persistence boundary (DB shape). `passthrough()` survives LLM helpfulness without retry-thrashing; `strict` (default) on the persisted schema guarantees no surprise fields in the JSONB. The `safeParse` of the persisted shape at `EffortEstimator.ts:229-243` is a belt-and-suspenders defensive check — proportionate. |
| 3 | `404` (agent not found, `attempts === 0`) vs `503` (retries exhausted, `attempts >= 1`) | ✅ with caveats | 404 is correct for "wrong-user / missing agent" because the repository's `.eq('user_id', userId)` produces `data: null` either way — RFC 7231 supports 404 for "not found OR not accessible". 503 is the better choice over 502 for "upstream LLM unavailable after our retry budget" because the AgentPilot API itself is healthy but temporarily unable to fulfil the request (RFC 7231 §6.6.4 — temporary overload / dependency unavailable). 502 would imply we received an invalid response from upstream, which is too narrow. Decision aligns with RFC semantics. The `attempts === 0` signal is a clean discriminator that the orchestrator returns and the route maps deterministically. |
| 4 | `UpdateAgentInput.manual_time_per_item_seconds?` NOT added | ✅ | Sound — adding it would invite new callers to a column we are actively deprecating. The repository's update spread (`AgentRepository.ts:226-229`) means there's no impl change required for the legacy writer either way. This is the correct exclusion-now / add-later trade-off. |
| 5 | Deprecation comment moved from inside the LLM prompt template to a JS-level `@deprecated` JSDoc | ✅ | Correct catch. An HTML-style `<!-- … -->` inside `buildBusinessInsightPrompt`'s template string would have been sent verbatim to the LLM, which is at minimum noise and at worst influences output. JSDoc placement on `buildBusinessInsightPrompt` itself (line 372) + the dedicated JSDoc on `updateAgentROI` (line 871) is the correct surface for human / IDE visibility without polluting the prompt. |

### CLAUDE.md mandatory rules

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | All DB access via repository layer | ✅ | All estimator writes go through `AgentRepository.findById` + `.update` (`EffortEstimator.ts:111`, `:265`). Direct `supabaseServer` usage in `modelResolver` is for `system_settings_config` (no repo exists — pattern matches `AgentGenerationConfigService`). Pre-existing direct-Supabase usage in `app/api/agents/[id]/route.ts` is explicitly flagged out-of-scope (inline comment at `:12-16`). |
| 2 | Zod on API inputs | ✅ | `app/api/v2/agents/[agentId]/estimate-effort/route.ts:39` `RequestSchema = z.object({}).strict()`. `LLMResponseSchema` adds Zod at the LLM output boundary too (`EffortEstimator.ts:180`). |
| 3 | correlationId + structured Pino logging | ✅ | Route creates `requestLogger = moduleLogger.child({ route, correlationId, agentId })` at `:47`. Estimator threads `correlationId` through `requestLogger` (`EffortEstimator.ts:94-99`) and into the audit `details` (`:319`). No `console.log` in any new module. (Pre-existing `console.log` in PUT handler is out-of-scope and the inline comment `:12-16` calls this out.) |
| 4 | `.eq('user_id', userId)` filtering | ✅ | Every `AgentRepository.findById` / `.update` call in the estimator takes `(id, userId)` — the repository enforces `.eq('user_id', userId)` (`AgentRepository.ts:231`). |
| 5 | No hardcoded model names | ✅ | `modelResolver.ts` reads from `system_settings_config.effort_estimator_model`. `DEFAULT_MODEL = { provider: 'openai', model: 'gpt-4o-mini' }` is a documented in-code default required by AC-8 itself. Provider resolution via `ProviderFactory.getProvider(provider)` (`EffortEstimator.ts:138`). |
| 6 | TypeScript strict (no implicit `any`) | ⚠️ ✅ | All new module exports are explicitly typed. Two narrowed `as` casts in `EffortEstimator.ts:125, 127-128` are intentional reads of the loosely-typed `Agent` row and are commented adjacent. The `(data as any).enhanced_prompt` at `app/api/create-agent/route.ts:264` is unnecessary — the `Agent` type already declares `enhanced_prompt?: string \| null` (see Style nit #2). |
| 7 | No new patterns without SA review | ✅ | Net-new fire-and-forget dispatch is consolidated in `lib/effort-estimator/dispatch.ts` — single SSoT helper per my Phase-1 conditional approval. Both async callers consume it (`create-agent/route.ts:260`, `agents/[id]/route.ts:411`); the sync API endpoint awaits `estimateEffort` directly. |
| 8 | Audit trail non-blocking | ✅ | `auditLog({ … }).catch(err => requestLogger.error(...))` at `EffortEstimator.ts:301-324`. Matches the codebase convention exactly. |

### AC coverage verification

| AC | Behavior required | Delivered? | Evidence |
|---|---|---|---|
| AC-1 | Newly created agent → `agent_config.roi_estimate` populated within 30s in ≥95% of cases | ✅ | Dispatch wired at `app/api/create-agent/route.ts:260-270` immediately after `auditLog(AGENT_CREATED)`. 30s retry budget enforced by `retryWithBackoff` (`DEFAULT_BUDGET_MS = 30000`). Happy-path test at `EffortEstimator.test.ts:59-106`. (≥95% is a runtime SLO QA must verify in test environment — Dev cannot prove it without observability data.) |
| AC-2 | LLM failure exhausts retries → slot remains `null` + structured error log with `correlationId` | ✅ | `EffortEstimator.ts:198-215` — on `!retry.ok` returns early with NO `repository.update` call and NO `auditLog`. Error log at `:200-207` carries `correlationId` via `requestLogger`. Test at `EffortEstimator.test.ts:155-175` (`retry exhaustion: NO write, NO audit`). |
| AC-3 | `reasoning` references the inferred SMB-owner persona by name | ✅ | System prompt instructs the LLM at `buildEffortPrompt.ts:61`. Post-hoc lenient check at `EffortEstimator.ts:248-253` emits WARN on drift but does NOT block the write — correct interpretation (drift-detector, not gate). Test at `EffortEstimator.test.ts:207-233`. |
| AC-4 | Deprecated `updateAgentROI` self-guard prevents overwriting a fresh estimate | ✅ | `BusinessInsightGenerator.ts:913-929` — `existingROI` read + `if (… && !existingROI)` write-gate + DEBUG-log-on-skip `else if` branch. Comments at `:898-900` and `:908-912` mark the guard as load-bearing. Test at `updateAgentROI.guard.test.ts:45-76`. |
| AC-5 | `POST /api/v2/agents/[id]/estimate-effort` regenerates + logs previous at INFO with `{ old_value, new_value, reason, correlationId }` | ✅ | API endpoint exists at `app/api/v2/agents/[agentId]/estimate-effort/route.ts`. INFO override log at `EffortEstimator.ts:281-297` carries `previous_total_manual_time_seconds`, `new_total_manual_time_seconds`, `reason`, and the correlationId via `requestLogger.child(...)`. Test at `route.test.ts:57-99`. |
| AC-6 | Existing `roi_estimate` overridden → both old + new logged | ✅ | Same INFO log as AC-5 (`EffortEstimator.ts:281-297`). Audit payload carries `before.roi_estimate` and `after.roi_estimate` (`:307-310`). Test at `EffortEstimator.test.ts:108-153` asserts both. |
| AC-7 | Feature flag OFF → estimator does NOT fire, no error | ✅ | `dispatch.ts:36-42` short-circuits before any import or LLM call. Test at `dispatch.test.ts:56-70` asserts `estimateEffort` is NOT called when flag is false. **Caveat:** the synchronous API endpoint is documented as NOT gated by the flag (route.ts:11-13) — that is an intentional decision (consumer asked, so consumer gets) and matches the requirement MD § Trigger Points #3 prose ("API-callable"). |
| AC-8 | Missing `system_settings_config.effort_estimator_model` row → fallback to `gpt-4o-mini` + DEBUG log | ✅ | `modelResolver.ts:65-73` — `logger.debug(...)` then `cache + return DEFAULT_MODEL`. Test at `modelResolver.test.ts:27-36` mocks `maybeSingle({ data: null, error: null })` and asserts the default. |

### New findings

1. **[P2] Race comment present at the wrong site for v2-followup discoverability.** `lib/effort-estimator/EffortEstimator.ts:255-264` correctly documents the v1 read-modify-write race AND references Open Follow-Up #8. The comment is co-located with the merge at `newConfig = { ...currentConfig, roi_estimate: newEstimate }`. ✅ This is what the workplan asked for. No fix needed — listing as a found-and-verified item.

2. **[P2] `app/api/create-agent/route.ts:264` casts to `any` unnecessarily.** `(data as any).enhanced_prompt ?? data.user_prompt ?? undefined` — the `Agent` repository type at `lib/repositories/types.ts:43` already declares `enhanced_prompt?: string | null`. The cast is dead defensive code. Suggested fix: drop the cast → `data.enhanced_prompt ?? data.user_prompt ?? undefined`. Non-blocking but obscures intent.

3. **[P2] `lib/effort-estimator/EffortEstimator.ts:127` widens `agent_config` via `as Record<string, unknown> | null | undefined`.** Same column is already typed as `Record<string, unknown> | null` on `Agent`. The `| undefined` widening is unnecessary because the property may be undefined on JS-level but the type already covers `null`. Cosmetic; CLAUDE.md rule #6 not violated. Suggested fix: drop `| undefined`.

4. **[P2] `BusinessInsightGenerator.ts:913` casts to `any`.** `(agent.agent_config as Record<string, any> | null)?.roi_estimate` — uses `Record<string, any>` instead of `Record<string, unknown>`. The pre-existing code style in this file (line 917) uses the same `any` cast, so the new code is consistent — but it does push a per-rule `any` into a new code site. Acceptable because (a) the column truly is JSONB-typed-as-any in the Supabase row, (b) the surrounding file already uses this style, and (c) the guard logic only needs a presence check (truthy/falsy). Not blocking but worth a `Record<string, unknown>` swap in a follow-up cleanup.

5. **[P2] Possible Vercel serverless caveat for fire-and-forget IIFE.** The `void (async () => { … })().catch(...)` in `dispatch.ts:44-57` correctly handles errors, but on Vercel (the production target per CLAUDE.md), the API route's response is typically returned before the IIFE resolves, and the serverless function MAY be terminated before the estimator finishes if the platform suspends the container. The 30s retry budget is right at the edge of Vercel's default 60s function timeout. The team has accepted this trade-off (workplan § Async fire pattern + § Known v1 limitations document it), and the requirement MD § Async Behavior explicitly says "Internal retries — synchronous within the async fire — no external job queue". Not a blocker but worth confirming in QA against a real Vercel preview deploy — observability should show the estimator's INFO override log lands within the function's lifetime. If QA observes truncation, the right fix is `waitUntil` (Vercel's `after(...)` / `NextResponse.waitUntil`), not a queue.

6. **[P2] `app/api/agents/[id]/route.ts:394` re-derives `correlationId` from headers inside the dispatch try-block.** The outer PUT handler doesn't use a `correlationId` for its own logging (pre-existing — that handler uses `console.log` throughout). The dispatch block creates its own `correlationId` from headers OR generates a fresh UUID. That's correct behaviour in isolation — but if the same request also produced log lines from anywhere upstream that read the same header, the IDs match. If nothing upstream reads it, the estimator's child logs carry a UUID disconnected from any other observability for that request. Non-blocking — the dispatch block is the only structured-logging surface in the PUT handler so any trace is internally consistent. A future cleanup of the PUT handler (CLAUDE.md compliance) will rewire this through a single request logger.

7. **[P1 → resolved on read] `agent_config` JSONB merge preserves existing keys.** `EffortEstimator.ts:264` `const newConfig = { ...currentConfig, roi_estimate: newEstimate }` — spread-merge, NOT whole-node overwrite. Test at `EffortEstimator.test.ts:99-101` literally asserts `updateArg.agent_config.creation_metadata` is preserved. ✅ This was a P0 concern flagged by the orchestrator; the implementation handles it correctly.

8. **[P1 → resolved on read] Dispatch IIFE error swallowing.** The outer `.catch(err => logger.error(...))` at `dispatch.ts:47-57` is correct — `err` is logged at ERROR level with `agentId`, `correlationId`, `reason`. The dynamic `import('./EffortEstimator')` is INSIDE the async IIFE so import-throws also route through the same `.catch`. ✅ My Phase-1 conditional was satisfied.

9. **[P1 → resolved on read] Zod default values masking LLM errors.** `LLMResponseSchema` does NOT use `.default(...)` anywhere. The four required LLM fields (`reasoning`, `is_bulk_workflow`, `total_manual_time_seconds`, `confidence?`) must be present (the first three) or absent (`confidence` is optional). On schema failure the orchestrator emits a DEBUG log with truncated raw and lets the retry budget kick in. No silent default masking. ✅

10. **[P2] `route.ts:43-46` Next.js 15 / Next.js 14 dynamic-param shape.** `{ params }: { params: Promise<{ agentId: string }> }` with `const { agentId } = await params;` matches the Next.js 15 async-params API. The CLAUDE.md tech stack lists Next.js 14 but the form-metadata sibling and `agents/[id]/route.ts` already use the same shape (`agents/[id]/route.ts:46` `{ params }: { params: Promise<{ id: string }> }`), so this is project-consistent. No action.

### Style nits

1. `lib/effort-estimator/dispatch.ts:36` — `featureFlags.useEffortEstimator()` is called at dispatch time, which means flag changes take effect immediately (no module-import-time caching). Good — but the existing flag helpers all `console.log` the flag value on every read. The line `console.log('Feature Flag: NEXT_PUBLIC_USE_EFFORT_ESTIMATOR=', flag || 'none')` at `lib/utils/featureFlags.ts:131` will fire once per V6 save AND once per PUT regen. If the production rollout switches the flag ON and the codepath fires per-request, that's a per-create log line. Worth converting to `requestLogger.debug` (or a one-shot module-init log) before prod enable. Non-blocking but flagging.

2. `app/api/create-agent/route.ts:264` — drop the `(data as any)` cast (see Finding #2).

3. `lib/effort-estimator/EffortEstimator.ts:71-76` — `extractAssistantContent` accepts `unknown` and reaches into `choices[0]?.message?.content`. Works, but the project already has `chatCompletionJson<T>` on `BaseAIProvider` (see `baseProvider.ts:63-67`) which Dev opted not to use because Anthropic throws `not implemented`. The current approach is correct given the constraint. Document that decision in the function's JSDoc so a future reader doesn't refactor to `chatCompletionJson`. Trivial.

4. `lib/effort-estimator/__tests__/EffortEstimator.test.ts:175` — the `retry exhaustion` test has a `60000`ms timeout because of the real `1s + 4s` delays in the retry. Tests that wait real wall-clock time are a future flake source. Suggested follow-up: thread an `opts.delaysMs` parameter through `EffortEstimator` (currently it always uses defaults) so the test can pass `[1, 1, 1]`. Non-blocking — the timeout buffer is correct as-is, but the slow tests will compound.

5. `lib/pilot/insight/BusinessInsightGenerator.ts:903` — `const updateData: any = { … }` — pre-existing `any` style in this file. Not new code, but the AC-4 fix touches the same block. A follow-up cleanup pass can typify this when the file gets a wider repository-pattern migration.

### Decision rationale

Dev shipped a tighter implementation than the workplan implied. All 7 SA observations are addressed exactly as specified — including the subtle ones (truncated reasoning in INFO logs but full preservation in audit, `attempts === 3` lock on retry exhaustion, dedicated AC-8 test file). The 5 unspecified design decisions are all architecturally sound: `[agentId]` is the correct Next.js sibling convention, the two-schema split correctly separates trust boundaries from persistence shape, `404` vs `503` aligns with RFC 7231, the deferred `manual_time_per_item_seconds?` extension is the right discipline, and the JS-level `@deprecated` placement is a genuine catch over the original prompt-string approach.

The implementation correctly handles all 8 ACs, with the caveat that AC-1's ≥95% SLO is a runtime metric QA must validate in a test environment. All 8 CLAUDE.md mandatory rules pass; the residual `any` casts are either pre-existing style consistency or load-bearing JSONB reads, none of which violate Rule #6. The agent_config JSONB merge correctly spreads existing keys (P0 concern raised by orchestrator → verified resolved). The fire-and-forget dispatcher's IIFE wraps the dynamic import so cold-start import failures still route through the outer `.catch` (my Phase-1 condition fully met).

The 10 new findings are P2-or-already-resolved; nothing blocks QA. Style nits #2-5 should land in this PR; nit #1 (per-request flag log) is the only one with operational impact and is worth fixing before prod enable. Code APPROVED FOR QA.

### Code Approved for QA: Yes

---

## SA Re-Review (Post User Code Review) — 2026-06-10

**Verdict:** `APPROVED` (with two P2 doc-accuracy nits — no code or scope blockers)

**Reviewer process:** Read the three uncommitted deliverables end-to-end (`lib/effort-estimator/modelResolver.ts`, `lib/effort-estimator/dispatch.ts`, `lib/effort-estimator/__tests__/modelResolver.test.ts`, `lib/effort-estimator/__tests__/dispatch.test.ts`, `docs/EFFORT_ESTIMATOR.md`, `docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`, `app/api/v2/agents/[agentId]/estimate-effort/route.ts`, `app/api/create-agent/route.ts:250-270`, `lib/pilot/insight/BusinessInsightGenerator.ts:860-920`). Verified the PUT-handler revert with `git diff 2f6433c -- app/api/agents/[id]/route.ts` (zero output). Confirmed zero remaining `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` / `useEffortEstimator` source references repo-wide. Cross-checked the `SystemConfigRepository.getByKey` contract (`lib/repositories/SystemConfigRepository.ts:21-48`) against the modelResolver's expected `{ data, error }` shape.

### Deliverable 1 — Requirement MD (`docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md`)

| Check | Status | Notes |
|---|---|---|
| No remaining `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` refs outside Change History | ✅ | grep confirms — only the 2026-06-10 row in Change History mentions it. |
| Trigger Points table has exactly 2 active triggers (creation, API) | ✅ | Lines 64-67: Trigger #1 Automatic (creation), Trigger #2 API-callable. |
| Deferred Triggers table includes regen-on-edit row | ✅ | Lines 71-73: row #1 "Automatic regeneration on prompt edit / workflow regeneration — Deferred until v2. … See Open Follow-Up #10." Correctly explains rationale + future plan. |
| 7 ACs (AC-1 through AC-7) renumbered correctly | ✅ | Lines 237-243. Former AC-8 (fallback to gpt-4o-mini + DEBUG log) is now AC-7 — exact text preserved. |
| Open Follow-Up #10 present with correct rationale | ✅ | Line 260: TBD owner, ⬜ post-v1 status, gating logic explained, references the same dispatcher used by the create path. |
| Out-of-Scope #11 mirroring Follow-Up #10 (BA deviation) | ✅ confirm | Line 231: "Automatic regeneration trigger on prompt edit / workflow regeneration (deferred to v2 — see Open Follow-Up #10)." **Recommend KEEP.** Out-of-Scope is the consolidated descope view used by SA + Dev during sprint planning; pointing the reader at the Follow-Up keeps the cross-ref intact without duplicating the rationale. The intent + xref discipline match items #6-#10 which already do the same. |
| Change History 2026-06-10 row present | ✅ | Line 294. Clear summary of both descopes. |
| `Last Updated` bumped to 2026-06-10 | ✅ | Line 3. |

### Deliverable 2 — Design Doc (`docs/EFFORT_ESTIMATOR.md`)

| Check | Status | Notes |
|---|---|---|
| Filename SCREAMING_SNAKE_CASE | ✅ | `EFFORT_ESTIMATOR.md` matches CLAUDE.md "High-level guides" naming convention. |
| Header block (title + Last Updated + Overview) | ✅ | Lines 1-7. |
| ToC present (doc is 235 lines, >150 threshold) | ✅ | Lines 11-26. 14 entries, all anchors valid. |
| Change History at bottom | ✅ | Lines 232-234. |
| Tables used for structured data | ✅ | 13 tables across the doc. |
| `---` horizontal rules between major sections | ✅ | Consistent. |
| File paths in/near code references | ✅ | Architecture Overview table (lines 44-53) lists each module file with purpose. |
| Trigger Points: API-only v1 claim matches code | ✅ | `app/api/create-agent/route.ts:260-270` calls `dispatchEffortEstimate`; `app/api/agents/[id]/route.ts` is byte-identical to HEAD (revert verified). Matches the doc's two-trigger table. |
| Model Resolution claims `SystemConfigRepository` | ✅ | `modelResolver.ts:19` imports `systemConfigRepository` from `@/lib/repositories`. Doc accurately reflects code. |
| Failure Semantics: 404 (attempts===0) / 503 (attempts===3) / 200 (success) | ⚠️ | Route returns `201` on success (`route.ts:129`), not `200`. Design doc claims `200`. Minor inaccuracy — P2 nit #1 below. |
| Deprecation Strategy: two guards at lines 876 + 884 | ⚠️ | Doc claims lines 876 + 884; actual guards are at lines 901 (manual_time_per_item_seconds null-check) + 916 (`!existingROI` gate). The 876/884 numbers reference the JSDoc comment block, not the runtime guards. Misleading. P2 nit #2 below. |
| Known v1 Limitations enumerates 4 items including new "no auto regen" | ✅ | Lines 196-201: (1) race on create-then-quick-edit, (2) no enhanced_prompt persistence, (3) no automatic regeneration on prompt edit (NEW — matches the requirement MD descope), (4) no USD cost-savings. |
| Persona simulation rationale | ✅ | Lines 76-84 explain why drift-detector not gate, plus future upgrade path. Architecturally defensible. |
| Fire-and-forget vs sync trade-off | ✅ | Lines 117-128 explain the create-vs-API choice + Vercel-timeout caveat. The caveat is a genuinely important call-out that future readers need. |
| 5-min cache choice explained | ✅ | Line 100 "Why a 5-minute cache and not longer" — balance latency vs load. Defensible. |
| Repository pattern adoption explained | ✅ | Line 94 + Related Documents row at line 225 cite REPOSITORY_STRATEGY.md and CLAUDE.md rule #1. |
| Drift-detector vs gate for persona check | ✅ | Line 83 — explicit "post-hoc drift detector, not a hard gate" with rationale. |
| Deprecation guard strategy | ✅ | Lines 168-173 — two guards intentionally co-exist during deprecation window; the AC-4 fix is the new addition. (See nit #2 for line numbers.) |
| Level of detail | ✅ | Right balance — explains WHY for non-obvious choices (5-min cache, drift-detector, fire-and-forget) without re-stating the requirement MD's schema. |

### Deliverable 3 — Code Revisions

| Check | Status | Notes |
|---|---|---|
| `modelResolver.ts`: no direct Supabase query against `system_settings_config` | ✅ | Line 19 imports `systemConfigRepository`. Line 58 calls `systemConfigRepository.getByKey('effort_estimator_model')`. No `supabaseServer.from(...)` anywhere. |
| `modelResolver.ts`: AC-8 preserved (missing row → DEBUG + default) | ✅ | Lines 60-68. `SystemConfigRepository.getByKey` returns `{ data: null, error: null }` on PGRST116 (verified at `SystemConfigRepository.ts:33-37`), which matches the `error \|\| !data` branch exactly. AC-8 DEBUG log preserved. |
| `modelResolver.ts`: cache logic (5-min TTL, hit-return, miss-set) | ✅ | Line 55 hit-return; lines 66 + 71 set-on-miss (both AC-8 fallback and successful parse paths). TTL unchanged. |
| `modelResolver.ts`: three value shapes preserved | ✅ | `parseConfigValue` unchanged (lines 85-111). Object / bare string / JSON-encoded string all covered. |
| `modelResolver.test.ts`: mocks `systemConfigRepository.getByKey` | ✅ | Lines 14-20 mock `@/lib/repositories`. AC-8 dedicated row at line 30 (`AC-8: falls back to gpt-4o-mini on OpenAI when the row is missing`). Repository-error path at line 40. All 8 test cases preserved + extended (now 8 tests vs original 7). |
| `dispatch.ts`: no flag import or check | ✅ | Lines 24-25 import only `Logger` + `EffortEstimatorInput`. No `featureFlags` import. No flag gate. Body is pure IIFE + outer `.catch`. |
| `dispatch.ts`: IIFE wraps dynamic import inside the async fn | ✅ | Lines 35-37 — `await import('./EffortEstimator')` is INSIDE the IIFE, so cold-start import-throws route through the outer `.catch` at lines 38-48 (SA Phase-1 #13 still satisfied). |
| `dispatch.test.ts`: tests for non-blocking-on-rejection + ERROR log | ✅ | Lines 61-75 (`logs an error (non-blocking) when the estimator rejects`) + lines 77-82 (no synchronous throw). Estimator-invoked test at lines 48-59. |
| PUT route revert (`app/api/agents/[id]/route.ts`) byte-identical to `2f6433c` | ✅ | `git diff 2f6433c -- app/api/agents/[id]/route.ts` produces zero output (verified in working tree). |
| Zero `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` / `useEffortEstimator` repo-wide | ✅ | grep returns zero hits across `.ts` / `.tsx`. |
| Workplan task table marks descoped rows as ❌ DESCOPED | ✅ | Lines 266 (`featureFlags.ts`) and 268 (PUT handler) both struck-through with revert note + pointer to "User Code Review Revisions — 2026-06-10" anchor. |
| Workplan Change History row 2026-06-10 (user code review) present | ✅ | Line 1501. |

### Self-correction acknowledgement

My first-pass code review (§ SA Code Review — 2026-06-10, line 1565) **missed the CLAUDE.md mandatory rule #1 violation in `modelResolver.ts`**. Specifically, line 1596 of my earlier review explicitly *defended* the direct `supabaseServer.from('system_settings_config').select(...)` usage with the rationale "no repo exists — pattern matches `AgentGenerationConfigService`". That rationale was wrong on two counts: (a) `lib/repositories/SystemConfigRepository.ts` already exists and exposes `getByKey()` with the exact contract the resolver needs, and (b) "pattern matches an existing service" is never an acceptable carve-out from mandatory rule #1 — the rule has no precedent exception.

This finding should have been logged as a **P0 (BLOCKING)** code-review comment in the "New findings" section of my Phase-2 review, with the file:line as `lib/effort-estimator/modelResolver.ts:22` and the suggested fix verbatim what Dev applied (swap `supabaseServer.from(...)` for `systemConfigRepository.getByKey('effort_estimator_model')`). It should never have been a "Style nit" or even a P1 — rule #1 violations are categorically code-approval blockers (CLAUDE.md § Mandatory Rules item #1 + my own SA charter "Never approve code that bypasses Supabase RLS" extends by the same logic to "never approve code that bypasses the repository layer").

Root cause of the miss: I assumed the absence of a repo rather than reading `lib/repositories/index.ts`. Fix discipline: when reviewing any DB access in new code, the first action is to enumerate the repositories index and check for a matching repo, not infer absence from the AI provider's recall.

### New findings

| # | Severity | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| 1 | P2 | `docs/EFFORT_ESTIMATOR.md:183` | "Failure Semantics" table claims `200` for success on the API path. The route returns `201` (`app/api/v2/agents/[agentId]/estimate-effort/route.ts:129`). Minor accuracy slip. | Change `200` → `201` in the doc table. |
| 2 | P2 | `docs/EFFORT_ESTIMATOR.md:170-171` | "Deprecation Strategy" table cites guards at `BusinessInsightGenerator.ts:876` and `:884`. Those line numbers refer to lines inside the `@deprecated` JSDoc comment, not the runtime guards. Actual guards live at `:901` (manual_time_per_item_seconds null-check) and `:916` (the new `!existingROI` gate on the `roi_estimate` write). Misleading for a future maintainer who jumps to the cited lines. | Update both line references — e.g. ":901" and ":916", or describe by function name ("self-guard inside `updateAgentROI`") to avoid future line-number drift. |
| 3 | P2 | `app/api/create-agent/route.ts:256` | Inline comment still reads "The dispatcher handles the feature-flag check + dynamic import + error logging." The flag-check half of that sentence is now stale (the dispatcher no longer gates on a flag — Part 1 of the user code review). Misleading for the next reader. | Edit the comment to drop "feature-flag check +"; keep "dynamic import + error logging". Same PR. |
| 4 | P2 (informational) | `docs/EFFORT_ESTIMATOR.md` | The doc's "Model Resolution" section (lines 88-100) doesn't mention the 2026-06-10 repository-pattern switch explicitly. The Related Documents row at line 225 carries it ("Why `modelResolver` reads via `SystemConfigRepository`") but the body of the Model Resolution section just states the current state. Acceptable — a design doc captures the END state, not the change history — but worth deciding consciously. | No action required; just confirm the BA chose the steady-state framing intentionally. |

None are P0 or P1. The CLAUDE.md rule #1 fix is verified correct in code; the residual P2s are doc-accuracy nits that should land in this PR but do not block QA.

### Design doc observations (architectural / framing)

1. **Persona-simulation rationale is the strongest section.** The "drift-detector, not gate" call-out (line 83) captures the exact non-obvious decision that a future maintainer might second-guess and accidentally upgrade to a hard gate. Good.

2. **The "Why fire-and-forget on create" + "Why synchronous on the API endpoint" symmetry (lines 123-124)** is crisp. It tells the reader that the dual-trigger design is intentional, not accidental, which is the right framing for a future v2 reviewer evaluating whether to collapse them.

3. **The Vercel-timeout caveat (line 126-128)** is the most operationally important paragraph in the doc. It pre-empts a QA observation that would otherwise read as a bug. Strongly retain.

4. **Missing architectural call-out — error-handling philosophy on the model-resolver.** The resolver swallows EVERY error path (`getByKey` returns error, parse fails, network throws) into a silent DEBUG log + default. This is correct (AC-8 mandates default-on-missing, and the broader contract is "never block agent creation"), but a future reader reviewing observability might think the lack of WARN/ERROR is a bug. Worth one sentence in the Model Resolution section: "All resolver failure paths log at DEBUG and return the default — by design, because the higher-level retry budget and AC-8 fallback contract make the resolver's own failures non-fatal." Non-blocking.

5. **Missing call-out — read-modify-write on `agent_config`.** The "Known v1 Limitations" section (line 198) mentions the race but the "Architecture Overview" / "Output destination" framing doesn't surface it. A casual reader could miss it on first read. Optional: add a "Known constraint" sub-bullet under Architecture Overview pointing to the limitation. Non-blocking.

### Decision rationale

The CLAUDE.md rule #1 fix is correct in code, correct in tests, and correctly reflected in both the design doc (Model Resolution section) and the workplan (Change History row). The dispatcher simplification is clean — the IIFE + outer `.catch` invariant from my Phase-1 condition is preserved, and the dropped flag-related test surface is the only behavior loss, which is exactly the intended descope. The PUT-handler revert is verifiably byte-identical to `2f6433c` (zero diff), so Trigger #2 is fully removed from v1.

The requirement MD descope is internally consistent — Trigger Points / Deferred Triggers / ACs / Open Follow-Up #10 / Change History all align. BA's addition of Out-of-Scope #11 mirroring Follow-Up #10 is consistent with the existing pattern (items #6-#10 already cross-reference); I'd keep it rather than strip.

The design doc is accurate on the four big claims I spot-checked (Trigger Points API-only, SystemConfigRepository usage, failure-semantics status codes mostly, deprecation guard count). The two doc-accuracy P2 nits (`200` should be `201`, guard line numbers are off by ~25-32 lines) are worth fixing in the same PR but do not change any architectural decision. The stale create-agent comment is the only code-side P2; tightening it is mechanical.

No new patterns introduced. Three CLAUDE.md mandatory rules now demonstrably hold (rule #1 via repository swap, rule #6 unchanged, rule #7 still single-source-of-truth). Approved.

### Approval

[X] Re-review APPROVED — proceed to QA
[ ] NEEDS REVISION
[ ] BLOCKED

