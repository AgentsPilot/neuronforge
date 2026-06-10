# Effort Estimator Workplan

> **Last Updated**: 2026-06-07

**Developer:** Dev
**Requirement:** [EFFORT_ESTIMATOR_REQUIREMENT.md](/docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md)
**Feature branch:** `feature/effort-estimator` (cut from main `6d08cb9` by RM)
**Status:** ⏸️ **PAUSED** — see Resume Instructions below

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
| `lib/effort-estimator/index.ts` | Barrel | ⬜ | `estimateEffort`, `ROIEstimate`, `EffortEstimatorInput` |
| `lib/effort-estimator/types.ts` | Typed interfaces (see [Type definitions](#type-definitions)) | ⬜ | `ROIEstimate`, `EffortEstimatorInput`, `EffortEstimatorResult`, `ROIEstimateV1`, `ROI_ESTIMATE_SCHEMA_VERSION` |
| `lib/effort-estimator/EffortEstimator.ts` | Orchestrator: prompt → LLM (retry) → parse → merge-write → audit | ⬜ | `estimateEffort(input)`, class `EffortEstimator` (testable seam) |
| `lib/effort-estimator/buildEffortPrompt.ts` | System + user prompt assembly | ⬜ | `buildEffortPrompt({ persona, enhancedPrompt, userContext })` |
| `lib/effort-estimator/personaResolver.ts` | UserContext → persona string | ⬜ | `resolvePersona(userContext)` |
| `lib/effort-estimator/modelResolver.ts` | Read `effort_estimator_model` from `system_settings_config` (cached, 5min TTL) → `{ provider, model }`; default `gpt-4o-mini` on openai | ⬜ | `resolveEffortEstimatorModel()`, `clearModelCache()` (test helper) |
| `lib/effort-estimator/retryWithBackoff.ts` | Generic retry: 3 attempts, delays [1000, 4000, 16000]ms, total budget 30000ms, abort if budget exceeded | ⬜ | `retryWithBackoff<T>(fn, opts?)` |
| `lib/effort-estimator/dispatch.ts` | **REQUIRED single-source-of-truth helper for the new fire-and-forget pattern.** Exports `dispatchEffortEstimate(input, logger): void` — wraps the `useEffortEstimator()` flag check, dynamic import, `void`-wrapping, and `.catch()` error logging in one place. Both async callers (V6 save site + PUT regen handler) call this; the synchronous API endpoint does NOT (it awaits the estimator and returns the result). Per CLAUDE.md mandatory rule #7, this net-new dispatch pattern needs SA-approved single-source-of-truth. | ⬜ | `dispatchEffortEstimate(input: EffortEstimatorInput, logger: Logger): void` |
| `lib/effort-estimator/__tests__/personaResolver.test.ts` | Unit | ⬜ | — |
| `lib/effort-estimator/__tests__/retryWithBackoff.test.ts` | Unit | ⬜ | — |
| `lib/effort-estimator/__tests__/buildEffortPrompt.test.ts` | Unit | ⬜ | — |
| `lib/effort-estimator/__tests__/EffortEstimator.test.ts` | Integration (mocks provider + repo) | ⬜ | — |
| `app/api/v2/agents/[id]/estimate-effort/route.ts` | `POST` API per [API endpoint](#api-endpoint) | ⬜ | `POST` handler |
| `app/api/v2/agents/[id]/estimate-effort/__tests__/route.test.ts` | Integration: happy / auth-fail / bad-id / overwrite | ⬜ | — |

### Files modified

| File | Action | Reason | Status |
|------|--------|--------|--------|
| `lib/utils/featureFlags.ts` | Add `useEffortEstimator()` reading `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` (default OFF in prod, ON in dev — set via `.env.local`) | Feature flag per requirement | ⬜ |
| `app/api/create-agent/route.ts` | After `auditLog(AGENT_CREATED)` (~line 250), insert a single `dispatchEffortEstimate(...)` call (the required helper from `lib/effort-estimator/dispatch.ts` — see [Async fire pattern](#async-fire-pattern)) | Wire estimator into V6 save hook via the SSoT helper | ⬜ |
| `app/api/agents/[id]/route.ts` (PUT handler) | After the regen update succeeds AND the corrected gate (`promptOrWorkflowChanged`, computed from `agentData` per Risk #4) is true, call `dispatchEffortEstimate(...)` with `reason: 'agent_regenerated'`. Pre-existing CLAUDE.md mandatory-rule violation in this handler (direct Supabase calls) is OUT OF SCOPE for this cycle. | Wire trigger #2 (regeneration) via the SSoT helper | ⬜ |
| `lib/audit/events.ts` | Add `EFFORT_ESTIMATE_GENERATED: 'EFFORT_ESTIMATE_GENERATED'` to `AUDIT_EVENTS` + metadata entry | New audit event | ⬜ |
| `lib/repositories/types.ts` | Extend `UpdateAgentInput` with optional `agent_config?: Record<string, unknown> \| null` (it isn't present today — see Risk #3) | Allow repository writes of `agent_config` | ⬜ |
| `lib/pilot/insight/BusinessInsightGenerator.ts` | (1) Extend the `agent_config.roi_estimate` write at line ~884 with a guard checking whether `agent_config.roi_estimate` is already populated — if yes, SKIP the write entirely (DEBUG log: "deprecated path skipping write — fresh estimate already present"). (2) Mark `updateAgentROI` (line 866) `@deprecated` JSDoc. (3) Inline `@deprecated` comment in `buildBusinessInsightPrompt` ROI block (lines 549-577). (4) KEEP the legacy self-guard at line 876 (on `manual_time_per_item_seconds`) — it protects a different column and stays. | AC-4 root-cause fix + deprecation — no deletion this cycle | ⬜ |

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
| 6 | `lib/pilot/insight/__tests__/updateAgentROI.guard.test.ts` (new) | **AC-4** — call deprecated `updateAgentROI()` against an agent whose `agent_config.roi_estimate` is already populated by the new effort estimator. Assert (a) Supabase is NOT called to update `agent_config.roi_estimate`, (b) a DEBUG log line "deprecated path skipping write — fresh estimate already present" is emitted, (c) the agent row's `agent_config.roi_estimate` is unchanged. Also add a control case: when `agent_config.roi_estimate` is absent and `manual_time_per_item_seconds` is null, the deprecated path still writes both fields (existing behavior preserved). |
| 7 | `app/api/create-agent/__tests__/effort-estimator-dispatch.test.ts` (new) | **AC-7** — with `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR=false`, mock `estimateEffort` and assert it's NOT called. |
| 8 | Reuse #4 case (c) | **AC-8** — `modelResolver` returns `gpt-4o-mini` default + a DEBUG log when the `system_settings_config` row is missing. |

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
| AC-7 | Flag OFF → no fire, no error | Feature flag dispatcher guard | Test #7 |
| AC-8 | Missing config row → fallback `gpt-4o-mini` + DEBUG log | modelResolver default branch | Test #8 |

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


1. **Add feature flag** + (if Risk #2 → (b)) seed `system_settings_config` migration.
   - `lib/utils/featureFlags.ts` — add `useEffortEstimator()`.
2. **Define types** + add `AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED`.
   - `lib/effort-estimator/types.ts`, `lib/audit/events.ts`.
   - Extend `UpdateAgentInput` per Risk #3 → (a).
3. **Build core estimator module** in this order (test-first where practical):
   - `personaResolver.ts` + test
   - `retryWithBackoff.ts` + test
   - `modelResolver.ts` + test (mock Supabase)
   - `buildEffortPrompt.ts` + test
   - `EffortEstimator.ts` + test (mock provider + repository)
4. **Wire `AgentRepository` write path** — verified at the type level via Risk #3 → (a).
5. **Build the dispatch helper** and wire the V6 save hook async dispatch.
   - (a) Implement `lib/effort-estimator/dispatch.ts` exporting `dispatchEffortEstimate(input, logger)` (flag check + dynamic import + IIFE+catch). Add unit test `dispatch.test.ts` covering flag-OFF → no-call and flag-ON → estimateEffort called once.
   - (b) Wire `dispatchEffortEstimate(...)` in `app/api/create-agent/route.ts` after `auditLog(AGENT_CREATED)`.
   - (c) Manual smoke-test: create an agent in dev with the flag ON, verify slot populates.
6. **Build API route** `app/api/v2/agents/[id]/estimate-effort/route.ts` + integration tests.
7. **Wire regen dispatch** in `app/api/agents/[id]/route.ts` PUT with the **corrected** changed-fields gate from Risk #4 — read from `agentData` (line 169), NOT `updateData` (lines 262-283). Use `dispatchEffortEstimate(...)` (do NOT duplicate the dispatch shape).
8. **Mark deprecated path + extend self-guard** per [Deprecation work](#deprecation-work).
   - (a) Insert the new presence-guard at `BusinessInsightGenerator.ts:~884` — skip the `agent_config.roi_estimate` write when `existingROI` is truthy (DEBUG log on skip). **This is the AC-4 root-cause fix from SA blocking item #1.**
   - (b) Add `@deprecated` JSDoc on `updateAgentROI` (line 866).
   - (c) Add inline `@deprecated` comment above the prompt block (lines 549-577).
   - (d) Add the one-line comment above the legacy line-876 guard noting why it stays.
9. **Cross-cutting tests** #6 (deprecated guard) and #7 (flag OFF).
10. **Manual verification** in dev — confirm `agent_config.roi_estimate` populates, AC-3 persona presence, override log on second call via API.

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

_To be populated by QA._

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
