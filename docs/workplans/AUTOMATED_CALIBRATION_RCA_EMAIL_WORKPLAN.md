# Workplan: Automated Calibration-Failure RCA in the Admin Alert Email

**Developer:** Dev
**Requirement:** [AUTOMATED_CALIBRATION_RCA_EMAIL_REQUIREMENT.md](/docs/requirements/AUTOMATED_CALIBRATION_RCA_EMAIL_REQUIREMENT.md)
**Branch:** `agent-failure-troubleshooting` (user-approved continuation on this existing branch for this cycle — NOT a `feature/` branch by explicit decision; do not create/switch/commit)
**Date:** 2026-07-05
**Status:** In Progress (SA-approved 2026-07-05 with binding conditions C1/C2 folded in)

---

## Analysis Summary

This feature productionizes the manual `calibration-rca` methodology as a runtime, LLM-driven service that augments the existing IMP-2 admin failure alert with a finished, structured root-cause analysis, persists it, and always falls back to today's deterministic email on any failure/timeout/flag-off.

**Surfaces this touches (all confirmed by reading the code):**

| Surface | File | Current state (verified) |
|---|---|---|
| Alert email contract + renderer | `lib/calibration/calibrationAdminAlert.ts` | `CalibrationAdminAlertInput` + `renderAdminAlertHtml` + `sendCalibrationAdminAlert` (never-throws, returns boolean). Has an `esc()` escaper and section-based HTML shell. Pino-clean. |
| Route tail (sole trigger) | `app/api/v2/calibrate/batch/route.ts` | `finally` tail L4585–4692. Alert dispatch at L4632–4681 inside `if (isBackground && !passed && latest?.workflow_hash)` → dedup via `histRepo.hasAdminAlertBeenSent(...)` → else-branch resolves `adminEmails` and calls `sendCalibrationAdminAlert(...)`, then `markAdminAlerted` only if `sent`. `export const maxDuration = 60`. Pino-clean. **No request `correlationId` exists in the route today** — one must be introduced (FR-23). |
| Config pattern to mirror | `lib/agentkit/v6/config/AgentGenerationConfigService.ts` | `system_settings_config`-backed, in-memory 5-min TTL cache, `DEFAULT_CONFIG` fallback. **Uses `console.*` (6 calls: 3× warn, 2× log, 1× error).** We MIRROR the pattern but the new accessor uses Pino (see § console.* note). |
| Evidence — calibration outcome | `lib/repositories/CalibrationHistoryRepository.ts` (history row: `issues_remaining`/`issues_found`, `metadata`, `markAdminAlerted` merge pattern), `lib/repositories/CalibrationSessionRepository.ts` (`findById`, session issues/execution_summary), `lib/repositories/ExecutionRepository.ts` (`findById` → `agent_executions`) | All exist. Persistence merge pattern is `markAdminAlerted` (spread existing metadata + patch → `.update({ metadata })`). |
| Evidence — workflow definition | `lib/repositories/AgentRepository.ts` `findById(id, userId)` → full `Agent` row (`pilot_steps`, `input_schema`, `user_prompt`/`enhanced_prompt`, `agent_config`) | Owner-scoped, excludes deleted. Read-only. |
| LLM call path | `lib/ai/providerFactory.ts` → `ProviderFactory.getProvider(provider).chatCompletion({ model, temperature, messages, max_tokens }, { userId, feature, component })`; response at `response.choices[0].message.content` | Confirmed via `ConstrainedSemanticValidator` usage. That validator **hardcodes** `model: 'claude-sonnet-4-5-...'` — the anti-pattern FR-13 tells us NOT to copy. |
| Admin recipients | `AdminAccessService.getInstance().listAdminEmails()` | Already used in the tail — unchanged. |

**Root-cause phase ownership:** this is NOT a V6-pipeline / compiler fix. It is a new best-effort side-channel bolted onto the calibration admin-alert tail. No plugin-specific logic and no changes to detectors, repair engines, or the compiler. The RCA prompt reasons from persisted evidence + plugin schemas as the source of truth (Platform Design Principles).

---

## Implementation Approach

### 1. New RCA service — `lib/calibration/calibrationRcaService.ts`
Single entry point `generateCalibrationRca(params): Promise<CalibrationRcaResult>` where the result is a discriminated union: `{ ok: true; rca: CalibrationAutoRca; modelUsed: string; providerUsed: string; generatedAt: string }` or `{ ok: false; reason: 'disabled' | 'timeout' | 'llm_error' | 'invalid_output' | 'evidence_error' }`. **The service NEVER throws** — all paths return a typed result; the caller only ever sees a value.

Flow inside the service:
1. **Gather evidence via repositories only** (FR-12, AC-7) — no `supabase.from(...)` in the service, no shelling to `dump-*.ts`:
   - Calibration outcome: the failed `calibration_history` row (already loaded as `latest` in the route — passed in to avoid a re-read), the `calibration_sessions` row via `CalibrationSessionRepository.findById(sessionId)`, and the execution via `ExecutionRepository.findById(executionId)` when an `executionId` is present.
   - Workflow definition (two-dump parity): `AgentRepository.findById(agentId, userId)` → `pilot_steps`, `input_schema`, `user_prompt`/`enhanced_prompt`, `agent_config.ai_context`.
   - Evidence-read failures are non-fatal where possible; if the workflow definition can't be read at all, return `{ ok: false, reason: 'evidence_error' }` (defensible layer classification isn't possible without it).
2. **Build the prompt** via `lib/calibration/calibrationRcaPrompt.ts` (separate module so redaction is unit-testable, FR-24/AC-15). The prompt encodes the `calibration-rca` 6-step method sourced from the shared methodology (`.claude/skills/calibration-rca/SKILL.md` / `CALIBRATION_RCA_RUNBOOK.md`) — no plugin-specific rules, no hardcoded operation/field names. It instructs a single structured-JSON response matching the 8-field / 5-layer shape.
3. **Resolve model/provider/temperature/timeout/max_tokens** from `lib/calibration/calibrationRcaConfig.ts` (see § 3). No hardcoded model literal, no `getDefaultModel()`, no env for model selection (AC-6).
4. **Call the LLM** through `ProviderFactory.getProvider(cfg.provider).chatCompletion({ model: cfg.model, temperature: cfg.temperature, messages, max_tokens: cfg.maxTokens }, { userId: 'system', feature: 'calibration-rca', component: 'CalibrationRcaService' })`. The whole call is wrapped in an internal `Promise.race` against a `cfg.timeoutMs` timer → on timeout returns `{ ok: false, reason: 'timeout' }` (FR-8).
5. **Validate with Zod** at the boundary (`calibrationRca-schema.ts`). Strip markdown fences (mirroring the existing validator), `JSON.parse`, `CalibrationAutoRcaSchema.safeParse`. On failure → `{ ok: false, reason: 'invalid_output' }` (FR-16, AC-8).
6. Return `{ ok: true, rca, modelUsed, providerUsed, generatedAt }`.

### 2. Zod schema + types — `lib/calibration/calibrationRca-schema.ts`
`CalibrationAutoRcaSchema` with the **8 fields**: `symptom`, `evidence`, `earliestFailingStep`, `rootCauseLayer`, `rootCause`, `fixOwner`, `suggestedSolutions` (array, min 1), `remediationPath`. `rootCauseLayer` is a `z.enum` of exactly the **5 TS values**: `'input/data' | 'V6 generation' | 'runtime/external API' | 'calibration-detection' | 'creation chat flow'` (FR-15, AC-1, Q5). Export `CalibrationAutoRca = z.infer<...>`. Keep field types strict (strings/arrays), no `any`.

### 3. Config accessor — `lib/calibration/calibrationRcaConfig.ts`
Mirror `AgentGenerationConfigService` exactly (module-level cache + 5-min TTL + `DEFAULT_CONFIG` fallback + `refresh`/`clearCache` for tests) **but with Pino, not `console.*`**. Reads `system_settings_config` keys `calibration_rca_provider`, `calibration_rca_model`, `calibration_rca_temperature`, `calibration_rca_timeout_ms`, `calibration_rca_max_tokens`. `DEFAULT_CONFIG` = mid-tier reasoning model, e.g. `{ provider: 'anthropic', model: <mid-tier Claude>, temperature: 0, timeoutMs: 25000, maxTokens: 4000 }` — timeout bounded to fit inside `maxDuration = 60` with headroom for preceding calibration work + the email send (FR-8). **Exact default model string is an SA decision** (see Questions for SA).

### 4. Prompt builder + redaction guardrails — `lib/calibration/calibrationRcaPrompt.ts`
Exports `buildRcaPrompt(evidence)` and the two guardrail helpers as named exports so they're unit-testable in isolation (AC-15):
- `truncateForPrompt(value, maxLen)` — caps long strings and large arrays/objects to a bounded length with a `…[truncated]` marker.
- `maskSecrets(value)` — masks values matching common secret patterns (API keys, `Bearer`/access tokens, `password`-like keys, long high-entropy strings) → `***MASKED***`.
Both applied to the **input values only before they enter the prompt** (FR-24). The email's embedded "Data the agent was processing" section is untouched. No plugin hardcoding in the prompt text.

### 5. Email augmentation — `lib/calibration/calibrationAdminAlert.ts`
- Add OPTIONAL `autoRca?: CalibrationAutoRca | null` to `CalibrationAdminAlertInput` (FR-22).
- Add a private `rcaSection(rca)` that renders an escaped section in the existing style (same shell, `<h2>` heading `Automated RCA (LLM-generated — verify before acting)` per FR-6, `esc()` on ALL fields incl. `suggestedSolutions`, dark `<pre>` for technical detail), inserted into `renderAdminAlertHtml` **only when `input.autoRca` is present**. When absent/null → output is byte-identical to today (guarantees existing `calibrationAdminAlert.test.ts` passes, AC-9). No change to transport, dedup, or the never-throws contract.

### 6. Persistence — `lib/repositories/CalibrationHistoryRepository.ts`
Add one metadata-merge method following the `markAdminAlerted` pattern (spread existing metadata + patch → `.update({ metadata })`), e.g. `mergeMetadata(id, existingMetadata, patch)` (generic) OR two purpose methods `persistAutoRca(...)` and `persistCorrelationId(...)`. Writes:
- `metadata.auto_rca` = the validated RCA object, `metadata.auto_rca_generated_at`, `metadata.auto_rca_model` / `metadata.auto_rca_provider` (FR-17, AC-5).
- `metadata.correlation_id` = the request correlationId (FR-23, AC-13).
Best-effort, non-blocking, logged on failure. No migration (Q2). No direct Supabase write in the route/service.

### 7. Route tail wiring — `app/api/v2/calibrate/batch/route.ts`
- **CorrelationId (FR-23):** introduce `const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();` near the top of `POST` and lift it (or add to `runCtx`) so the tail can read it. Persist it on the failed calibration row **independently of the flag and of RCA success** — i.e. inside the `if (isBackground && !passed && latest?.workflow_hash)` block (or wherever `latest.id` is known on a non-passing background run), even when the flag is off / RCA times out / Zod fails (AC-13). Best-effort, must not throw.
- **RCA generation (flag-gated):** inside the existing **non-dedup else-branch only** (respects `hasAdminAlertBeenSent`, FR-2/AC-10), before building the alert input: if `process.env.CALIBRATION_AUTO_RCA_ENABLED === 'true'`, call `generateCalibrationRca({ agentId, userId, sessionId, calibrationHistoryId: latest.id, workflowHash, inputValues: lastRunInputs, latest, executionId: lastExecutionId, supabase: runCtx.supabase, correlationId })`. If it returns `{ ok: true }`, pass `autoRca: result.rca` into `sendCalibrationAdminAlert(...)` and persist via the repo (FR-17). If `{ ok: false }`, log via Pino and proceed with `autoRca` undefined → deterministic-only (FR-7/FR-10, AC-3/AC-4). Flag off → skip entirely: no LLM, no RCA persistence (FR-19, AC-9).
- **Isolation:** all of the above stays inside the existing `try/catch` around the alert (L4633/4678) plus the outer tail `try/catch` — never throws out of the tail, never changes the HTTP response, never delays calibration completion or the gate update (FR-9, AC-11). `markAdminAlerted` semantics unchanged — marked only when the email is actually dispatched (FR-20).

### 8. Feature flag + config seeding
- Document `CALIBRATION_AUTO_RCA_ENABLED` (server-only, no `NEXT_PUBLIC_`) in `docs/feature_flags.md` (FR-19, Q4).
- Provide the `system_settings_config` seed rows for the RCA config (an idempotent `INSERT ... ON CONFLICT DO NOTHING` snippet, NOT a schema migration — Q2/Q1). Seeding is optional at runtime because `DEFAULT_CONFIG` covers absence, but documented so ops can tune without a code change.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/calibration/calibrationRcaService.ts` | create | The in-app RCA service (evidence read → prompt → provider-factory LLM → Zod). Never throws; returns typed result. FR-11–FR-16. |
| `lib/calibration/calibrationRca-schema.ts` | create | Zod schema (8 fields + 5-value layer enum) + inferred `CalibrationAutoRca` type. FR-15. |
| `lib/calibration/calibrationRcaConfig.ts` | create | Cached DB-config-with-defaults accessor (mirrors `AgentGenerationConfigService`, Pino). FR-13, FR-8. |
| `lib/calibration/calibrationRcaPrompt.ts` | create | Prompt builder + `truncateForPrompt`/`maskSecrets` guardrails (unit-testable). FR-14, FR-24. |
| `lib/calibration/calibrationAdminAlert.ts` | modify | Add optional `autoRca` to input; render escaped RCA section when present (byte-identical when absent). FR-3–FR-6, FR-22. |
| `lib/repositories/CalibrationHistoryRepository.ts` | modify | Add metadata-merge method(s) to persist `auto_rca` (+ generated-at, model/provider) and `correlation_id`. FR-17, FR-23. |
| `app/api/v2/calibrate/batch/route.ts` | modify | Introduce `correlationId`; flag-gated, timeout-bounded, best-effort RCA generation in the non-dedup branch; pass into alert; persist RCA + correlationId. FR-1, FR-2, FR-7–FR-10, FR-19, FR-23. |
| `docs/feature_flags.md` | modify | Document `CALIBRATION_AUTO_RCA_ENABLED`. FR-19. |
| `lib/calibration/__tests__/calibrationAdminAlert.test.ts` | modify | Keep existing green with `autoRca` absent; add RCA-section rendering + escaping cases. AC-9, AC-12. |
| `lib/calibration/__tests__/calibrationRcaService.test.ts` | create | Happy path, llm_error, timeout, invalid_output (Zod), evidence_error, disabled. AC-3/4/8/14. |
| `lib/calibration/__tests__/calibrationRcaPrompt.test.ts` | create | Redaction: secrets masked, oversized truncated, email section unaffected. AC-15. |
| `lib/calibration/__tests__/calibrationRca-schema.test.ts` | create | Valid object passes; malformed / bad layer value fails. AC-8. |
| `docs/Calibration/` (relevant area doc + `CALIBRATION_OVERVIEW.md` Change History) | modify | Per calibration skill § 12 — document the new best-effort RCA side-channel. |
| `system_settings_config` seed snippet (in feature_flags.md or a `docs/Calibration/` note) | create | RCA config rows (idempotent INSERT, not a migration). FR-13, FR-8. |

---

## Task List

- [x] **T1** ✅ — Zod schema `calibrationRca-schema.ts` (8 fields + 5-value layer enum, `.strict()`) + type. Unit test for valid/invalid. (FR-15, AC-8)
- [x] **T2** ✅ — Config accessor `calibrationRcaConfig.ts` mirroring `AgentGenerationConfigService` with Pino (cache/TTL/DEFAULT_CONFIG=`anthropic`/`claude-sonnet-4-6`/temp 0/25s/4000tok/refresh/clearCache). (FR-13, FR-8, AC-6)
- [x] **T3** ✅ — Prompt builder + redaction `calibrationRcaPrompt.ts` (`buildRcaPrompt`, `truncateForPrompt`, `maskSecrets`, `redactInputValues`); 6-step method sourced from shared methodology, no plugin hardcoding. Unit test redaction. (FR-14, FR-24, AC-15)
- [x] **T4** ✅ — RCA service `calibrationRcaService.ts`: repository-only evidence reads (workflow definition REQUIRED → `evidence_error`; session/execution sub-reads degrade gracefully + ownership-guarded), `ProviderFactory.getProvider(...).chatCompletion(...)` with config-resolved model + budget-aware timeout race, fence-strip + JSON.parse + Zod, typed never-throw result. (FR-11–FR-16, AC-6/7/8)
- [x] **T5** ✅ — Persistence: added generic `mergeMetadata(id, patch)` that **re-reads current metadata inside the method** (C1); refactored `markAdminAlerted(id)` to route through it. (FR-17, FR-23)
- [x] **T6** ✅ — Email: added optional `autoRca` to `CalibrationAdminAlertInput`; escaped `rcaSection` rendered only when present; absent → deterministic output unchanged. (FR-3–FR-6, FR-22)
- [x] **T7** ✅ — Route wiring: `reqStart` + `correlationId` at top of POST; correlationId persisted flag-independently BEFORE/OUTSIDE the dedup branch; flag-gated + budget-aware (C2) RCA in the non-dedup branch; RCA persisted independent of `sent` (Comment 6); `autoRca` passed into alert; `tailLogger = logger.child({ correlationId })` (Comment 7); dedup/markAdminAlerted/never-throw preserved. (FR-1, FR-2, FR-7–FR-10, FR-18, FR-19, FR-20, FR-23)
- [x] **T8** ✅ — Feature-flag doc (`CALIBRATION_AUTO_RCA_ENABLED`, server-only) + idempotent `system_settings_config` seed snippet in `docs/feature_flags.md`. (FR-19, FR-13/FR-8)
- [x] **T9** ✅ — Tests: extended `calibrationAdminAlert.test.ts` (RCA render/absent/escaping); added service, schema, prompt, config, and `CalibrationHistoryRepository.metadata` (C1 no-clobber) tests. 85 passing across 11 suites; existing alert tests green. (AC-3/4/8/9/12/14/15) See Dev note re: route-level integration.
- [x] **T10** ✅ — `npx tsc --noEmit` clean on all touched files (pre-existing errors only in unrelated `scripts/**` + `supabase/functions/**`). Workplan updated; docs/feature_flags carries the calibration RCA entry.

### Dev implementation notes (C1, C2, and coverage)

**C1 (metadata clobber) — how implemented.** Added `CalibrationHistoryRepository.mergeMetadata(id, patch)` that **first re-reads the row's current `metadata`** (`select('metadata').eq('id',id).single()`), shallow-merges the patch on top, then writes once. `markAdminAlerted` was refactored to `markAdminAlerted(id)` and now delegates to `mergeMetadata` (dropped the stale `existingMetadata` param). All three tail writes — `correlation_id`, `auto_rca*`, `admin_alerted` — go through the fresh-read merge, so none clobbers another. Proven by `CalibrationHistoryRepository.metadata.test.ts` "sequential writes COMPOSE" (asserts `existing` + `correlation_id` + `auto_rca` + `auto_rca_model/provider` + `admin_alerted` all coexist on the final row via a stateful mock where each read reflects the prior write).

**C2 (budget-aware timeout) — how implemented.** `const reqStart = Date.now()` captured at the very top of `POST`. In the tail's non-dedup branch: `remainingBudgetMs = 60_000 − (Date.now() − reqStart)`, `maxBudgetMs = remainingBudgetMs − RCA_SEND_RESERVE_MS (10_000)`. If `maxBudgetMs < RCA_MIN_BUDGET_MS (3_000)` the route **skips RCA entirely** (logs `Skipping auto-RCA — insufficient remaining budget`) and sends the deterministic alert. Otherwise `generateCalibrationRca({..., maxBudgetMs})` is called; inside the service the LLM call is `Promise.race`d against `min(cfg.timeoutMs, maxBudgetMs)` → a `timeout` result on elapse. Either way the email send + persistence run within the reserved 10s floor. Service-level timeout enforcement proven by `calibrationRcaService.test.ts` "timeout — call exceeds the budget-aware deadline" (`maxBudgetMs: 40`, chatCompletion never resolves → `{ ok:false, reason:'timeout' }`).

**Coverage note (route-level integration).** All unit-testable surfaces are covered (service result-shapes incl. all fallback reasons, config fallback/override/no-hardcoded-model, redaction, Zod, C1 no-clobber, C2 timeout enforcement, RCA render/absent/escaping). The `POST` handler of `batch/route.ts` only reaches its `finally` tail after a full calibration run (auth + distributed lock + WorkflowPilot execution + real DB reads); it is not unit-invocable at the tail without disproportionate whole-pipeline mocking, and the tail's RCA additions are thin conditional glue over the tested units. End-to-end route verification (flag-off deterministic-only, dedup skip, budget-skip, correlationId persisted, never-throws) is left for QA with the live harness — flagged here transparently rather than faked with a brittle mega-mock.

---

## console.* compliance note (CLAUDE.md § Logging)

- `lib/agentkit/v6/config/AgentGenerationConfigService.ts` uses `console.*` **6 times** (3× `console.warn`, 2× `console.log`, 1× `console.error`). I am **reading it only as a pattern reference and will NOT modify it** — so per the "don't reformat files you aren't working on" clause I will not convert it here (and the requirement's Logging-compliance NFR already directs that the reference stays as-is while the *new* accessor uses Pino). Flagging it for visibility; converting it would be a separate, out-of-scope cleanup if the user wants it.
- All **new** files (`calibrationRcaService.ts`, `calibrationRcaConfig.ts`, `calibrationRcaPrompt.ts`, `calibrationRca-schema.ts`) use `createLogger` from the outset. The two touched integration files (`calibrationAdminAlert.ts`, `batch/route.ts`) and `CalibrationHistoryRepository.ts` are already Pino-clean — no conversion needed.

---

## QA Test Scope

**Strategy:** unit + integration (Jest). **Focus areas:** api, schema, security.

| # | Case | Type | Maps to |
|---|------|------|---------|
| 1 | Happy path — flag ON, background failure → RCA section rendered with all 8 fields + a valid 5-value layer; workflow-definition evidence read. | integration | AC-1, AC-2, AC-7, AC-14 |
| 2 | RCA-error fallback — service throws/`llm_error` → deterministic-only email, Pino-logged, email not lost. | unit+integration | AC-3, AC-14 |
| 3 | Timeout fallback — generation exceeds `cfg.timeoutMs` → `{ ok:false, reason:'timeout' }` → deterministic alert; tail within budget. | unit | AC-4, AC-14 |
| 4 | Flag OFF → no LLM call, no RCA section, no `auto_rca` write; existing `calibrationAdminAlert.test.ts` passes unchanged (byte-compatible). | unit+integration | AC-9, AC-14 |
| 5 | Dedup skip — second failure for same `(agentId,userId,workflowHash)` with `hasAdminAlertBeenSent===true` → no RCA generated, no second email. | integration | AC-10 |
| 6 | Zod-invalid LLM output → `{ ok:false, reason:'invalid_output' }` → no-RCA fallback. | unit | AC-8 |
| 7 | Redaction — secret-pattern input values masked + oversized values truncated in the **prompt**; email's "Data the agent was processing" section unaffected. | unit | AC-15 |
| 8 | Escaping/privacy — malicious content in issues/inputs/workflow-def/LLM output is HTML-escaped in the RCA section (no `<script>` survives); internal-only footer retained; recipients from `listAdminEmails()`. | unit | AC-12 |
| 9 | correlationId persisted on the calibration record via repo — present even when flag OFF / timeout / Zod failure. | integration | AC-13 |
| 10 | Never-throws — forced exception in generation/persistence/send does not throw out of the `finally` tail, doesn't change HTTP response, gate still set. | integration | AC-11 |
| 11 | Provider-factory + DB config — grep proves no hardcoded model literal / no static `getDefaultModel` in the service; model used is recorded in `metadata.auto_rca_model`. | unit + code-review | AC-6, AC-5 |

Minimum bar per testing standard (happy path + one failure path) is exceeded; cases 1–4 + 7 are the priority set.

---

## Questions for SA

1. **Default model string (FR-13 DEFAULT_CONFIG).** Requirement says "mid-tier reasoning model" but no hardcoded literal in the service — it lives only in the config `DEFAULT_CONFIG`. Which exact model? (`ConstrainedSemanticValidator` uses `claude-sonnet-4-5-20250929`; the V6 config uses `claude-opus-4-6`. Propose a mid-tier Claude sonnet for cost/latency — SA to confirm the canonical string per `AI_PROVIDER_MODELS.md`.)
2. **Timeout default (FR-8).** Proposing `timeoutMs: 25000` inside `maxDuration = 60` with headroom for preceding calibration work + email send. Acceptable, or tighter?
3. **Persistence method shape.** Prefer one generic `mergeMetadata(id, existingMetadata, patch)` on `CalibrationHistoryRepository` (reused for both `auto_rca` and `correlation_id` writes) vs. two purpose-named methods? Generic is DRY but less self-documenting.
4. **correlationId scope.** The route has no request correlationId today. Adding it at the top of `POST` from `x-correlation-id || randomUUID()` and threading via `runCtx`. FR-23 wants it persisted even flag-off/RCA-skipped — I'll write it on every non-passing background run inside the existing `!passed` branch. Confirm that's the intended scope (vs. persisting on ALL background runs incl. passes).
5. **Evidence read failure semantics.** If `AgentRepository.findById` fails (workflow definition unreadable), I return `evidence_error` → deterministic-only, since the layer classification is undefensible without it (FR-12 makes it required evidence). Confirm that's preferred over generating a degraded RCA from calibration-outcome evidence alone.

---

## SA Review Notes

**Reviewed by SA — 2026-07-05**
**Status:** ✅ Approved — with 2 binding inline conditions (C1, C2) that will be re-verified at code review. No re-plan required; the architecture, phase ownership, and standards posture are sound.

I verified every integration-surface claim in the workplan against the real code (route tail L4574–4692, `calibrationAdminAlert.ts`, `AgentGenerationConfigService.ts`, `providerFactory.ts` + `baseProvider.ts` + `anthropicProvider.ts`, `CalibrationHistoryRepository.ts`, `AgentRepository.ts`, `CalibrationSessionRepository.ts`, `ExecutionRepository.ts`). The Dev's read of the codebase is accurate. Requirement coverage (FR-1–FR-24, AC-1–AC-15) is complete across T1–T10 + the QA Test Scope. No plugin hardcoding, correct phase ownership (this is a best-effort side-channel on the calibration tail — NOT a V6/compiler change).

### Comments

1. **[route tail — metadata write ordering] — C1 (BINDING, High).** This is the one genuine correctness defect in the plan. The tail will perform up to **three** `calibration_history.metadata` writes on the same row within one run: (a) correlationId persist, (b) `auto_rca` persist, (c) the existing `markAdminAlerted(latest.id, latest.metadata)`. Every one of these does a **full-object** `.update({ metadata })` spread from a **stale snapshot** — `latest.metadata` read once at L4589 (and the config's own merge pattern does the same). If each write spreads from that same stale snapshot, the **last write wins and silently drops the other keys** — e.g. `markAdminAlerted` would erase `correlation_id` and `auto_rca`. The workplan's "spread existing metadata + patch" description (§6) reproduces exactly this bug. **Required fix:** do NOT reuse the stale `latest.metadata` for the new writes. Either (i) accumulate a single merged patch and write **once**, or (ii) use the generic `mergeMetadata(id, patch)` from Q3 that **re-reads the row's current metadata inside the method** before merging, and route `admin_alerted` through the same method so all three keys compose. Whichever you pick, `correlation_id`, `auto_rca*`, and `admin_alerted` must all survive on the final row. Add a test asserting all three coexist after a successful-send run. — SA: pending

2. **[calibrationRcaService — timeout must be budget-aware, not fixed] — C2 (BINDING, High).** The tail runs in the route's `finally`, **after** all calibration iterations (executions + repairs) have already consumed part of the `maxDuration = 60` budget. A fixed `timeoutMs: 25000` only bounds the RCA *call*; it does nothing if only, say, 12s of wall-clock remain — Vercel hard-kills the function at 60s and can interrupt the **email send that follows the RCA**, losing the alert (violating FR-7 "never lose the alert"). **Required fix:** capture a request-start timestamp at the top of `POST` (the same place correlationId is added) and derive an **effective RCA deadline = min(cfg.timeoutMs, remainingBudget − emailHeadroom)**; if remaining budget is below a floor (recommend ≥ 8–10s reserved for the send + persistence), **skip RCA entirely** and go straight to the deterministic alert. The `Promise.race` timer should race against the effective deadline, not the raw config value. The gate update (L4599) already runs before the alert block, so the gate itself is safe — this condition is specifically about protecting the email send + persistence within budget. — SA: pending

3. **[providerFactory — call signature] — Resolved in-plan (informational).** Confirmed: the real API is the **static** `ProviderFactory.getProvider(cfg.provider).chatCompletion({ model, temperature, messages, max_tokens }, { userId, feature, component })`, returning an OpenAI-shaped object — `completion.choices[0].message.content` is correct (verified against `anthropicProvider.chatCompletionJson` L215–216 and its return shape L478–490). The workplan's Analysis Summary uses this correctly. **Note for Dev:** ignore the requirement's `provider.complete(...)` wording and CLAUDE.md's `getProviderFactory()` example — neither exists; there is no singleton factory function, only the static `ProviderFactory` class. Use `'system'` for the `userId` field in `CallContext` and set `feature: 'calibration-rca'`, `component: 'CalibrationRcaService'` as planned. — SA: resolved

4. **[config accessor — direct Supabase is acceptable here] — Low.** The RCA config accessor mirrors `AgentGenerationConfigService`, which reads `system_settings_config` via a **direct** `createClient(...)` service-role client, not a repository. This is technically outside mandatory-rule-1 (all DB via repositories), but it is the **explicitly-approved pattern to mirror** (FR-13, Q1) and is an established config-service precedent. Approved as-is **provided** (a) it is used **only** for config load — never for evidence — and (b) a one-line code comment notes it follows the `AgentGenerationConfigService` config-service precedent for the RLS-bypass. All **evidence** reads must go through repositories (as planned). — SA: resolved

5. **[session/execution repos — findById is not owner-scoped] — Low.** Confirmed `CalibrationSessionRepository.findById(id)` and `ExecutionRepository.findById(id)` exist but take **no `userId`** (no `.eq('user_id', …)` in-signature). This is acceptable because the ids are sourced from the already-owner-scoped `calibration_history` row (`getByAgent(agentId, userId)`) and the workflow-definition read *is* owner-scoped via `AgentRepository.findById(agentId, userId)`. Defensive nicety (not required): after reading the session/execution rows, assert their `user_id === userId` and drop the evidence (degrade, don't throw) on mismatch. — SA: resolved

6. **[FR-18 — persist RCA independently of send outcome] — Medium.** §7 says "if `{ok:true}`, pass `autoRca` into send **and** persist via the repo." Make the persist explicitly **independent of `sent`** — unlike `markAdminAlerted` (which is correctly gated on `sent`), the `auto_rca` write must happen whether or not the email dispatched (FR-18: "if the email fails but the RCA was generated, the persisted record MUST still be written"). Sequence: generate → persist RCA (best-effort) → send → markAdminAlerted only if sent. — SA: pending

7. **[FR-10 — correlation context in tail logs] — Low.** The RCA-failure/timeout log lines in the tail should carry the new `correlationId` to satisfy FR-10 ("log … with correlation context"). Cheapest: create `const tailLogger = logger.child({ correlationId })` once in the tail and use it for the RCA block. — SA: pending

8. **[Zod boundary — fence-strip robustness] — Low.** Mirroring the existing validator's markdown-fence strip + `JSON.parse` + `safeParse` is correct (FR-16). Ensure a `JSON.parse` throw is caught and mapped to `reason: 'invalid_output'` (not allowed to escape as an uncaught throw) — the service's never-throw contract covers it, but call it out in the test (AC-8). — SA: pending

### Answers to the 5 Questions for SA

1. **Default model string (DEFAULT_CONFIG).** Use **`{ provider: 'anthropic', model: 'claude-sonnet-4-6', temperature: 0 }`**. Per `docs/AI_PROVIDER_MODELS.md` L84, `claude-sonnet-4-6` is the documented "best speed/intelligence balance" tier ($3/$15 per M tok, 64K max output) — the correct **mid-tier reasoning** default: cheaper/faster than the V6 config's `claude-opus-4-6` and current (do **not** copy `ConstrainedSemanticValidator`'s legacy hardcoded `claude-sonnet-4-5-20250929`, L91 marks it "prefer Sonnet 4.6"). This string lives **only** in `DEFAULT_CONFIG`, overridable via the `system_settings_config` rows — no literal in the service (AC-6).

2. **Timeout default (25s).** Accept `timeoutMs: 25000` as the **config default**, but it is **not sufficient on its own** — see C2. It MUST be capped at runtime to the remaining wall-clock budget with a send/persist floor. With C2 in place, 25s is a fine ceiling for the common case where the tail starts with plenty of headroom; without C2 it is unsafe. So: keep 25000 in `DEFAULT_CONFIG`, add the dynamic `min(cfg.timeoutMs, remainingBudget − headroom)` cap in the service/caller.

3. **Persistence method shape.** Choose the **generic `mergeMetadata(id, patch)`** — but with the C1 constraint: it must **re-read the row's current `metadata` inside the method** and merge the patch on top, then `.update({ metadata })`. This is both DRY and the correct fix for the clobber bug (a generic method that reuses a caller-passed stale `existingMetadata` would NOT fix it — the read-fresh is the whole point). Route `correlation_id`, `auto_rca*`, and ideally `admin_alerted` through it so all writes compose. If you prefer to leave `markAdminAlerted`'s existing signature untouched for blast-radius reasons, that's acceptable **only** if `markAdminAlerted` is the **last** write and re-reads current metadata first (today it spreads the stale `latest.metadata` param — that must change).

4. **correlationId scope.** Confirmed: add `const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID()` at the top of `POST` (also reuse it as the request-start anchor for C2). Persist it on **every non-passing background run** for which `latest.id` is known — and place that write **before/outside the dedup else-branch**, so a dedup-**skipped** repeat failure still records **its own** row's correlationId (each calibration run creates a new `calibration_history` row via `create()`, so there is no cross-run clobber — the clobber concern in C1 is within a single row's writes). Do **not** persist on passing runs — AC-13 scopes this to failure time. Best-effort, flag-independent, never throws.

5. **Evidence-read failure semantics.** Confirmed: if `AgentRepository.findById` fails (workflow definition unreadable) → return **`{ ok: false, reason: 'evidence_error' }` → deterministic-only**. FR-12 makes the workflow definition **required** evidence (it's what makes the root-cause-layer classification — esp. V6-generation vs input/data — defensible); a degraded RCA from calibration-outcome evidence alone would produce exactly the low-confidence layer guesses the requirement is trying to eliminate. Calibration-outcome sub-reads (session/execution) failing individually should be **non-fatal** (degrade the evidence, still generate) — only the workflow-definition read is a hard `evidence_error`.

### Adjusted items (marked by SA)

- **T5 (persistence):** adopt the generic `mergeMetadata(id, patch)` **with internal re-read of current metadata** (Q3 + C1). Ensure `correlation_id`, `auto_rca`, `auto_rca_generated_at`, `auto_rca_model`, `auto_rca_provider`, and `admin_alerted` all coexist on the final row.
- **T7 (route wiring):** (i) capture request-start at top of `POST` and derive a budget-aware RCA deadline, skipping RCA when remaining budget < floor (C2); (ii) persist correlationId **before/outside** the dedup else-branch (Q4); (iii) persist `auto_rca` **independently of `sent`** (Comment 6); (iv) use a `correlationId` child logger in the tail (Comment 7).
- **T9 (tests):** add a case asserting `correlation_id` + `auto_rca` + `admin_alerted` **coexist** after a successful-send run (guards C1 against regression).

### Approval

[x] Workplan approved — proceed to implementation, subject to binding conditions **C1** (metadata write must not clobber — read-fresh/single-write) and **C2** (budget-aware RCA timeout with send/persist floor). Both will be re-verified at Phase 2 code review; all other comments are inline improvements to fold in during implementation. No fundamental re-architecture needed.

---

**Code Review by SA — 2026-07-05**
**Status:** ✅ Code Approved

I re-verified the implementation against the requirement, the standards, and — line by line — my two binding conditions and the API correction. I read all four new modules, the three modified integration files, and all five test suites; ran the feature test suites (66 passing across 8 suites) and confirmed `tsc` is clean on every touched file. The three binding items are implemented correctly (not merely claimed), verified against the real code below.

#### C1 — metadata no-clobber — CONFIRMED CORRECT
- `CalibrationHistoryRepository.mergeMetadata(id, patch)` (L285–314) **re-reads the row's current `metadata` inside the method** (`select('metadata').eq('id',id).single()` at L292–296) and shallow-merges the patch on top before a single `.update({ metadata })` — it does **not** trust a caller-passed snapshot. The stale `existingMetadata` param is **gone**.
- `markAdminAlerted(id)` (L321–330) was refactored to **delegate to `mergeMetadata`**; no caller passes a stale metadata snapshot anymore (route L4643 correlationId, L4711 auto_rca, L4759 markAdminAlerted all route through `mergeMetadata`).
- The "sequential writes COMPOSE" test (`CalibrationHistoryRepository.metadata.test.ts` L59–81) is **not** a trivial mock: `makeStatefulClient` holds row state in a closure so each `select().single()` reflects the prior `update()`. It asserts `existing` + `correlation_id` + `auto_rca` + `auto_rca_model/provider` + `admin_alerted` + `admin_alerted_at` all coexist on the final row. This genuinely proves coexistence.
- **Race note (Low, informational — no fix required):** read-modify-write on `metadata` is not atomic. It is safe *here* because (a) all three tail writes are sequentially `await`ed on a single code path (no intra-tail parallelism), each re-reading fresh, and (b) each background run writes its **own** freshly-`create()`d `calibration_history` row, so there is no second concurrent writer of the same row. If a future caller ever writes this row's metadata concurrently (e.g. a parallel job), last-writer-wins could drop a key — out of scope for this cycle, but worth a one-line comment if that pattern ever arises.

#### C2 — budget-aware timeout — CONFIRMED CORRECT
- `const reqStart = Date.now()` at the very top of `POST` (route L53), reused as the C2 anchor.
- Tail (L4676–4704): `remainingBudgetMs = 60_000 − (Date.now() − reqStart)`; `RCA_SEND_RESERVE_MS = 10_000` reserved for send+persist; `maxBudgetMs = remainingBudgetMs − 10_000`; **skip-below-floor** when `maxBudgetMs < RCA_MIN_BUDGET_MS (3_000)` → logs "Skipping auto-RCA — insufficient remaining budget" and proceeds straight to the deterministic alert.
- Service (`calibrationRcaService.ts` L148) races the LLM call against `min(cfg.timeoutMs, maxBudgetMs)`; on elapse → `{ ok:false, reason:'timeout' }`. Both the skip path and the timeout path fall through to `autoRca: undefined` → deterministic alert (route L4752). Timer is cleared in `finally` (L178–180) — no leak.
- **Numbers sanity-checked and safe:** worst case ≈ elapsed + min(25s, maxBudget) RCA + ≤10s send ≤ 60s. At 48s elapsed, maxBudget = 2s < 3s → skip (conservative). The 10s send reserve is generous (send is typically <2s) and the 3s floor avoids pointless sub-3s calls. Service-side enforcement is proven by the `maxBudgetMs: 40` timeout test.
- Minor coupling (Low): the `60_000` literal must track `export const maxDuration = 60` (L47) manually. Fine for now (both in this file); a `MAX_DURATION_MS` constant would remove the footgun.

#### Provider API — CONFIRMED CORRECT
- Service uses the real **static** `ProviderFactory.getProvider(cfg.provider as ProviderName)` (L151) → `.chatCompletion({ model, temperature, max_tokens, messages }, { userId:'system', feature:'calibration-rca', component:'CalibrationRcaService' })` (L160–168), and reads the result from `completion.choices?.[0]?.message?.content` (L183). Verified against `providerFactory.ts` (`static getProvider` L59, `ProviderName` L22). **No** `provider.complete(...)`, **no** `getProviderFactory()` singleton — both the requirement's `provider.complete` wording and CLAUDE.md's `getProviderFactory` example were correctly ignored per my Phase-1 note.

### Code Review Comments
1. **[calibrationRcaService.ts / repository — evidence + persistence] — CONFIRMED compliant — Priority: n/a.** All evidence reads go through repositories (`AgentRepository.findById(agentId, userId)` owner-scoped REQUIRED read → `evidence_error` on failure; `CalibrationSessionRepository`/`ExecutionRepository` sub-reads degrade gracefully and are ownership-guarded — session dropped on `user_id` mismatch L95, execution guarded L110). No `supabase.from(...)` in the service. The only direct-Supabase is the **config accessor**, which I accepted in Phase 1 (Comment 4) as the `AgentGenerationConfigService` config-load precedent — and it is used ONLY for config, with the RLS-bypass rationale documented in a header comment (`calibrationRcaConfig.ts` L7–11). Compliant.
2. **[Zod boundary + never-throw] — CONFIRMED — Priority: n/a.** Fence-strip → `JSON.parse` (wrapped, L190–195 → `invalid_output`) → `safeParse` (L197–201 → `invalid_output`); empty content → `invalid_output` (L184). An outer `try/catch` backstop (L211–216) guarantees the never-throw contract even for provider-construction failures. `.strict()` schema rejects unknown keys. All fallback reasons unit-tested.
3. **[calibrationAdminAlert.ts — byte-compat + escaping] — CONFIRMED — Priority: n/a.** RCA section is inserted only via `${input.autoRca ? rcaSection(...) : ''}` (L214) → byte-identical when absent; existing renderer tests are unchanged and green (no assertion weakened — the original cases L50–111 are intact, RCA cases appended L113–156). Every RCA field is `esc()`-escaped (`&`/`<`/`>`); fields render as element **text content** only (no HTML-attribute interpolation), so the absence of quote-escaping is not an injection vector. Malicious-LLM-output escaping is asserted (L144–156).
4. **[FR-24 redaction] — CONFIRMED — Priority: n/a.** `redactInputValues` (mask-then-truncate) is applied in the service before evidence assembly (L141) AND defensively re-applied in the prompt builder (L223). Secret-key-name masking, value-pattern masking, and high-entropy detection are present; the "secret input values masked / not present in prompt" path is unit-tested. The email's "Data the agent was processing" section is untouched (uses raw `inputValues`), per FR-24.
5. **[Logging] — CONFIRMED — Priority: n/a.** All new files use `createLogger` from the outset; the three touched integration files remain Pino-clean. No `console.*` introduced. The reference `AgentGenerationConfigService.ts` (6× `console.*`) was correctly left untouched and flagged — it is a read-only pattern reference, not a file this cycle modified, so no conversion obligation applies.
6. **[Route-level branch coverage gap] — DEFERRED to QA (accepted) — Priority: Medium (fast-follow recommended, non-blocking).** See ruling below.

### Optimisation Suggestions
- Introduce a `MAX_DURATION_MS = maxDuration * 1000` constant so the C2 budget math can't silently drift from `export const maxDuration` (Low).
- Optional owner-email lookup for the admin alert on admin-triggered runs (already noted inline as a future enhancement) — not in scope.

### Ruling on the flagged test gap (route-level AC-9/AC-10/AC-11/AC-13 + budget-skip)
**Deferral to QA live-harness is ACCEPTED for approval — I am not blocking on it — but I recommend a Medium-priority fast-follow to make these paths unit-covered.** Rationale:
- The unit layer is thorough: every service result-shape (all five `ok:false` reasons), config fallback/override/no-hardcoded-model, redaction, Zod, C1 composition, and C2 timeout enforcement are covered. The project's committed testing bar (happy path + one failure path) is **exceeded** at the unit level, and this is a *modified* route, not a new one.
- The tail's RCA additions are thin, readable conditional glue fully wrapped in the existing `try/catch` (L4656/L4762) plus the outer tail `try/catch` (L4768) — the never-throw envelope is structural, not test-derived.
- However, the branch wiring that is *not* unit-covered — flag-off skip (AC-9), dedup skip (AC-10), correlationId-persisted-independently-of-flag (AC-13), budget-skip, and never-throws (AC-11) — is exactly the class of logic where regressions are **silent and costly** (alert lost, double alert, or secret-bearing prompt sent when it shouldn't be). Live-harness verification catches them once; a unit test catches them on every future edit.
- **Extraction is feasible but not trivial** (the tail closes over ~13 locals: `latest`, `isBackground`/`passed`, `runCtx`, `histRepo`, `sessionId`, `lastExecutionId`, `lastRunInputs`, `resolverDisclosures`, `base`, `correlationId`, `reqStart`, `AdminAccessService`). Because it's a moderate refactor rather than a cheap one, I don't require it as a gate this cycle — but extracting `runCalibrationAdminAlertTail(deps)` into a pure-ish, injectable function would let AC-9/10/11/13 + budget-skip become fast unit tests and is the right next step. **QA MUST cover these five paths on the live harness this cycle** (they map to QA Test Scope rows 4, 5, 9, 10 + the budget case); the fast-follow extraction is a separate hardening ticket.

### Code Approved for QA: **Yes**
Conditions on QA (not on Dev): live-harness verification of AC-9 (flag-off deterministic-only, no LLM/no auto_rca write), AC-10 (dedup skip → no RCA, no second email), AC-11 (forced exception in generate/persist/send never throws out of the tail, gate still set, HTTP response unchanged), AC-13 (correlationId persisted even flag-off/timeout/Zod-fail), and the budget-skip path. All are enumerated in the QA Test Scope.

## QA Testing Report

**QA — 2026-07-05**
**Test mode:** full (unit + integration, as scoped)
**Strategy used:** A (Jest unit) + B (Jest integration with mocked repos/provider) for all unit-reachable surfaces; **E (static code-trace)** for the 5 route-tail paths that only run after a full calibration pipeline (per SA's accepted deferral — the tail is not unit-invocable without a whole-pipeline mega-mock, and the live calibration harness cannot be spun in this session).
**Focus:** api, schema, security
**Skipped:** No live end-to-end calibration run (harness not available in-session) — the 5 route-level paths are verified by code-trace and explicitly flagged as requiring live-harness confirmation below.
**Input source:** prompt keywords + workplan `## QA Test Scope` block + SA Code-Review ruling (route-level cases deferred to QA this cycle).

### Test run output

`npx jest lib/calibration lib/repositories`:

```
Test Suites: 11 passed, 11 total
Tests:       85 passed, 85 total
Snapshots:   0 total
Time:        ~8 s
```

Feature suites all green:
- `calibrationRca-schema.test.ts` (Zod: valid passes / bad layer + unknown key fail)
- `calibrationRcaConfig.test.ts` (DB override / DEFAULT_CONFIG fallback / DB-down → defaults)
- `calibrationRcaPrompt.test.ts` (mask / truncate / redact / prompt shape)
- `calibrationRcaService.test.ts` (happy, fence-strip, redaction, evidence_error, llm_error, invalid_output ×2, timeout, degrade, ownership-drop, DB-config model)
- `calibrationAdminAlert.test.ts` (**existing 8 deterministic cases intact + green, unchanged**; new RCA render/absent/escaping cases appended)
- `CalibrationHistoryRepository.metadata.test.ts` (C1 compose / no-clobber / read-fail)

**Confirmed:** the existing `calibrationAdminAlert.test.ts` deterministic cases (lines 50–111) are present, unmodified, and pass. The RCA section is only added via `${input.autoRca ? rcaSection(...) : ''}`, so with `autoRca` absent the output is byte-identical (AC-9 render path).

### Test Coverage

| Acceptance Criterion | Tested? | Result | Evidence / Notes |
|---|---|---|---|
| **AC-1** 8 fields + 5-value layer in RCA section | ✅ | Pass | `calibrationRca-schema.ts` enforces 8 required fields + `z.enum(ROOT_CAUSE_LAYERS)` (5 values) `.strict()`. Render test asserts all 8 fields + layer appear (`calibrationAdminAlert.test.ts` L122–133). Route wiring passes `autoRca` → verified by code-trace (route L4752). |
| **AC-2** RCA additive (deterministic content retained) | ✅ | Pass | Test "keeps ALL deterministic content when RCA added" asserts dump-cmd, runbook, remaining-issues, internal-only footer all coexist with the RCA section (L135–142). |
| **AC-3** Graceful fallback — RCA error/Zod-invalid → deterministic-only | ✅ | Pass | Service returns typed `{ok:false, reason:'llm_error'\|'invalid_output'}` (tests L140–156), never throws; route passes `autoRca: undefined` on `!ok` (code-trace L4752) → byte-compat render. Pino-logged (L4694). |
| **AC-4** Graceful fallback — timeout | ✅ | Pass | Service timeout proven: `maxBudgetMs:40`, chatCompletion never resolves → `{ok:false, reason:'timeout'}` (test L158–162). Route budget-skip + effective-deadline = `min(cfg.timeoutMs, maxBudgetMs)` verified by code-trace (route L4676–4704, service L148). |
| **AC-5** Persistence (auto_rca + generated_at + model + provider) | ✅ | Pass | `mergeMetadata` compose test asserts `auto_rca`, `auto_rca_model`, `auto_rca_provider` persist (repo test L59–81). Route writes all four keys + `auto_rca_generated_at` (code-trace L4710–4716). |
| **AC-6** Provider factory + DB config, no hardcoded model | ✅ | Pass | Grep: **no `getDefaultModel`** (only a comment) and **no model literal** in service/prompt/schema — model string lives only in `DEFAULT_CONFIG`. Service test "passes the DB-config model to the provider" proves `cfg.model` flows through and is recorded as `modelUsed` (L183–192). Uses static `ProviderFactory.getProvider(...).chatCompletion(...)`. |
| **AC-7** Repository pattern + two-dump evidence | ✅ | Pass | Service reads via `AgentRepository.findById(agentId, userId)` (owner-scoped, REQUIRED → `evidence_error`), `CalibrationSessionRepository`, `ExecutionRepository`; no `supabase.from(...)` in the service. Ownership guards drop mismatched session/execution (tests L164–181). |
| **AC-8** Zod-invalid → typed no-RCA | ✅ | Pass | Non-JSON → `invalid_output` (L146–150); JSON with bad layer → `invalid_output` (L152–156); `JSON.parse` throw is caught, not escaped. Schema test covers valid/invalid + unknown-key rejection. |
| **AC-9** Flag off → no LLM/no section/no write, byte-compatible | ⚠️ | Pass (code-trace) | Flag gate `process.env.CALIBRATION_AUTO_RCA_ENABLED === 'true'` (route L4671): off → `rcaResult` stays null → no LLM, no `auto_rca` persist (L4710 guard), `autoRca: undefined` → byte-compat email (render test proves byte-compat). **Full end-to-end flag-off run needs live-harness.** |
| **AC-10** Dedup skip → no RCA, no second email | ⚠️ | Pass (code-trace) | `if (dedup.data === true)` logs & skips the entire RCA+send else-branch (route L4662–4667). One RCA + one alert per version. **Live-harness confirmation required** (no unit test at tail). |
| **AC-11** Never throws / gate still set | ⚠️ | Pass (code-trace) | Gate set at L4606 **before** the alert block; RCA+persist+send wrapped in inner `try/catch` (L4656–4764) inside outer tail `try/catch` (L4768, which re-sets `failed` on any throw). Service + `mergeMetadata` are never-throw by contract (unit-proven). **Forced-exception live run required.** |
| **AC-12** Escaping / privacy | ✅ | Pass | Malicious LLM output (`<script>`, `<img onerror>`) HTML-escaped in RCA section; no `<script>` survives (test L144–156). Internal-only footer retained. Recipients via `AdminAccessService.getInstance().listAdminEmails()` (code-trace L4725) — never `profiles.role`. |
| **AC-13** correlationId persisted, flag-independent | ⚠️ | Pass (code-trace) | Persisted at route L4642–4650 **before/outside** the flag gate and the dedup branch, for every `isBackground && !passed && latest?.id` run. `mergeMetadata` compose test proves `correlation_id` coexists with other keys. **Live confirmation of "present when flag off / timeout / Zod-fail" requires harness.** |
| **AC-14** Test coverage | ✅ | Pass | 85 tests / 11 suites green. Happy path + every failure reason + redaction + escaping + C1 compose + C2 timeout covered — exceeds the happy+one-failure bar. Route-branch coverage is the known gap (below). |
| **AC-15** Prompt redaction (mask + truncate; email unaffected) | ✅ | Pass | `maskSecrets` (key-name, bearer/provider-key, JWT, high-entropy), `truncateForPrompt` (string/array/nested), `redactInputValues` (mask-then-truncate, null pass-through) all unit-tested. Service re-applies before the prompt (test L124–131). Email "Data the agent was processing" uses **raw** `inputValues` — unaffected (email test L58–63). |

### Verification-method breakdown (explicit, per task instruction)

**Verified by automated test:** AC-1 (schema+render), AC-2, AC-3 (service side), AC-4 (service timeout), AC-5 (repo compose), AC-6 (grep+test), AC-7, AC-8, AC-12, AC-14, AC-15.

**Verified by code-trace (static analysis of the route tail + the units it calls):**
- **AC-9 (flag-off end-to-end):** flag gate at L4671; on off, no `generateCalibrationRca` call, `rcaResult` null → no `auto_rca` write (L4710 guard) → `autoRca: undefined` (L4752) → byte-compat render (unit-proven).
- **AC-10 (dedup skip):** `hasAdminAlertBeenSent === true` → the whole RCA+send else-branch is skipped (L4662).
- **AC-11 (never-throws + gate set):** gate `setCalibrationStatus` at L4606 precedes the alert block; nested inner+outer `try/catch`; service and `mergeMetadata` never throw.
- **AC-13 (correlationId persist, flag-independent):** write at L4642 is outside both the flag gate and the dedup branch; runs on every non-passing background run.
- **Budget-skip (C2 branch):** `remainingBudgetMs = 60_000 − (Date.now() − reqStart)`, `maxBudgetMs = remainingBudgetMs − 10_000`, skip when `< 3_000` (L4676–4704); `reqStart` anchored at top of POST (L53); `maxDuration = 60` (L47).

**Requires live-harness confirmation (residual — cannot be executed this session):**
1. **AC-9** flag-off full run: assert zero LLM call + zero `auto_rca` key written on a real background failure with the flag unset.
2. **AC-10** dedup skip: second background failure for the same `(agentId,userId,workflowHash)` → confirm no RCA generated and no second email dispatched.
3. **AC-11** forced-exception: inject a throw in generate/persist/send on a live run → confirm the tail does not throw, HTTP response is unchanged, and the agent is not stuck on "running" (gate = failed).
4. **AC-13** correlationId under adverse paths: confirm `metadata.correlation_id` is written even when the flag is off / RCA times out / Zod fails.
5. **C2 budget-skip** under real elapsed time: confirm RCA is skipped and the deterministic email still sends when the tail starts with < ~13s of the 60s budget remaining.

### C1 / C2 spot-check (read the tests, not just their names)

- **C1 — `mergeMetadata` no-clobber:** `CalibrationHistoryRepository.metadata.test.ts` uses a **stateful** supabase mock (`makeStatefulClient`) whose `select().single()` returns the latest `update()`-written metadata via closure state. The "sequential writes COMPOSE" test performs `correlation_id` → `auto_rca(+model+provider)` → `markAdminAlerted`, then asserts **all five keys + the original `existing` key coexist** on the final row. This genuinely proves fresh-read composition, not a trivial pass-through; the read-fail case proves it returns an error result rather than throwing. `mergeMetadata` (repo L285–314) does re-read inside the method; `markAdminAlerted` (L321–330) delegates to it — the stale `existingMetadata` param is gone. **Claim proven.**
- **C2 — budget-aware timeout:** `calibrationRcaService.test.ts` "timeout — call exceeds the budget-aware deadline" passes `maxBudgetMs: 40` with a chatCompletion that **never resolves**, and asserts `{ok:false, reason:'timeout'}`. The service computes `effectiveTimeout = Math.min(cfg.timeoutMs, maxBudgetMs)` (L148) and races the call against it (L159), clearing the timer in `finally`. This proves the service enforces the caller-supplied budget cap, not just the config default. The route-side skip-below-floor math is code-traced (not unit-covered — part of the flagged gap). **Service-level claim proven; tail-level skip is code-trace only.**

### Security review (focus area)

- **RCA-section escaping (injection):** every RCA field is `esc()`-escaped and rendered as element text content (no HTML-attribute interpolation), so the absence of quote-escaping is not an injection vector (SA-confirmed). Malicious `<script>`/`<img onerror>` from LLM output is proven escaped. **Pass.**
- **Redaction (secrets masked, oversized truncated):** exercised by `calibrationRcaPrompt.test.ts` and re-proven at the service boundary (`redacts secret input values before the LLM sees them` — asserts `sk-...` absent, `***MASKED***` present). Email embedding intentionally unredacted (internal-only, "do not forward"). **Pass.**
- **Owner-scoping:** workflow-definition read is owner-scoped (`findById(agentId, userId)`); session/execution reads (not owner-scoped by signature) are ownership-guarded and dropped on `user_id` mismatch. Admin recipients via `AdminAccessService.listAdminEmails()`. **Pass.**

### Issues Found

#### Bugs (must fix before commit)
None. No High or Medium severity defect found. C1 (clobber) and C2 (budget) — the two correctness risks SA flagged — are implemented correctly and test-proven.

#### Performance Issues (should fix)
None. One RCA per broken version (dedup), single LLM call, budget-bounded with a 10s send/persist reserve. Cost/latency posture is sound.

#### Edge Cases (nice to fix — all Low, pre-noted by SA)
1. **`60_000` budget literal must track `export const maxDuration = 60` manually** (route L4678 vs L47). A `MAX_DURATION_MS = maxDuration * 1000` constant removes the drift footgun. — Low.
2. **Execution ownership guard is permissive when `user_id` column is absent** (`!execution.user_id || ...`, service L110). Acceptable because the id is sourced from the owner-scoped history row, but a stricter guard would be defence-in-depth. — Low.
3. **High-entropy secret masking requires length ≥ 32** — a short (<32-char) token under a fully innocuous key would pass unmasked. Covers "common patterns" per FR-24; broader coverage is a future hardening. — Low.
4. **Route-tail branch coverage gap** (AC-9/10/11/13 + budget-skip not unit-covered). SA's recommended fast-follow: extract `runCalibrationAdminAlertTail(deps)` into an injectable function so these become unit tests. Non-blocking this cycle; the live-harness checks above must be run. — Medium (fast-follow, tracked, non-blocking per SA ruling).

### Final Status
- [x] All **unit/integration-reachable** acceptance criteria pass (AC-1–AC-8, AC-12, AC-14, AC-15). No open High/Medium bug.
- [x] The 5 route-level paths (AC-9, AC-10, AC-11, AC-13, C2 budget-skip) are **verified by code-trace** and structurally correct; they remain **pending live-harness confirmation** this cycle, exactly as SA scoped.
- [ ] **Not yet fully signed off end-to-end** until the 5 live-harness checks above are executed against a real background calibration failure (with the flag on and off). No code change is required for that step — it is execution-only verification.

**Verdict:** PASS with a residual (no bugs). Code is functionally correct and standards-compliant across every surface the automated suite and static trace can reach. Recommend proceeding, conditioned on the 5 enumerated live-harness checks being run before/at release (per SA's accepted deferral), and the tail-extraction fast-follow ticket for durable unit coverage.

## Pre-commit review follow-ups (Dev — 2026-07-05)

User reviewed the implemented code and requested four items before commit. All done on the same branch (`agent-failure-troubleshooting`); NOT committed. Feature suites remain green (96 passing across 11 suites, was 85 — +11 new); every preserved guarantee (C1, C2, byte-identical email when `autoRca` absent, existing `calibrationAdminAlert.test.ts` green, AC-9) verified intact. `tsc --noEmit` clean on all touched files (only pre-existing `.next/types` + unrelated `__tests__/DeclarativeCompiler*` errors remain).

### Follow-up task list
- [x] **Q1** ✅ — Extracted `isCalibrationAutoRcaEnabled()` into `lib/calibration/calibrationRcaConfig.ts`; replaced the inline `process.env.CALIBRATION_AUTO_RCA_ENABLED === 'true'` in `batch/route.ts` with it. Unit tests (on/`'true'`, off/`'false'`, unset, truthy-not-"true" like `'1'`/`'yes'`) in `calibrationRcaConfig.test.ts`.
- [x] **Q2** ✅ — Calibration docs updated with the auto-RCA augmentation + a both-branches Mermaid flow diagram (flag ON: dedup→budget→generate→[success persist+augment]/[fail|timeout|skip persist status+deterministic]; flag OFF: deterministic exactly as today; dedup skip + never-throws envelope shown). Authoritative section + diagram in `POST_CREATION_CALIBRATION_FLOW.md`; index section + diagram in `CALIBRATION_OVERVIEW.md`; a "start from the automated RCA if one exists" note in `CALIBRATION_RCA_RUNBOOK.md`. Change-History rows added to all three.
- [x] **Q3** ✅ — Every RCA ATTEMPT now leaves a durable marker. Added `buildRcaAttemptMetadata(flagEnabled, outcome)` + `CalibrationRcaAttemptStatus`/`RcaAttemptOutcome` types in `calibrationRcaService.ts` (pure, flag-aware). The route tail records `auto_rca_status` (`success` | `timeout` | `llm_error` | `invalid_output` | `evidence_error` | `skipped_budget`) + `auto_rca_attempted_at` via `mergeMetadata` for success, every `ok:false` reason, AND the budget-skip — plus the full RCA payload on success. **AC-9 preserved:** the helper returns `null` when the flag is off (no write); `correlation_id` remains the only flag-independent write. Unit tests: flag-off→null (×3 outcomes), success→status+payload, timeout→status only, budget-skip→status, and each `ok:false` reason echoed.
- [x] **Q4** ✅ — True hard-abort via `AbortSignal` implemented (feasibility outcome below). Service creates an `AbortController`, passes `signal` into `chatCompletion`, and calls `controller.abort()` when the budget-aware timer fires — actively cancelling the in-flight LLM request (frees the connection / stops token spend) instead of merely abandoning it. Never-throw preserved (abort still resolves to `{ ok:false, reason:'timeout' }`). Tests: signal is aborted on timeout; signal present-but-not-aborted on the happy path.

### Q4 feasibility outcome (explicit)
`BaseAIProvider.chatCompletion(params: any, ctx)` takes `params` as `any`, so no shared-signature change was required — passing a `signal` field is type-safe and invisible to other callers. Neither provider forwarded a signal before; both underlying SDKs (`@anthropic-ai/sdk` `messages.create(body, { signal })`, `openai` `chat.completions.create(body, { signal })`) accept one via per-request options. I made the **minimal backward-compatible change**:
- **Anthropic (the DEFAULT_CONFIG provider):** added optional `signal?: AbortSignal` to the provider-local `ChatCompletionParams` and forwarded it as the SDK's RequestOptions (`params.signal ? { signal } : undefined`). Existing callers pass no signal → identical behaviour.
- **OpenAI (config also allows it):** extracted the optional `signal` out of the body and forwarded it as the per-request option, deleting it from the body so an `AbortSignal` is never serialized into the request JSON. Backward-compatible (undefined when not passed).
- **Nothing deferred.** No shared `BaseAIProvider` signature change; Kimi untouched (not selectable via the RCA config's `'openai' | 'anthropic'` type). The change is contained to the two providers the RCA can actually use, both optional-and-defaulted.

### Files touched this follow-up
| File | Item | Change |
|------|------|--------|
| `lib/calibration/calibrationRcaConfig.ts` | Q1 | Added `isCalibrationAutoRcaEnabled()`. |
| `app/api/v2/calibrate/batch/route.ts` | Q1, Q3 | Use the flag accessor; record `auto_rca_status`/`auto_rca_attempted_at` for every attempt (success/fail/skip) via `buildRcaAttemptMetadata`. |
| `lib/calibration/calibrationRcaService.ts` | Q3, Q4 | Added status types + `buildRcaAttemptMetadata`; AbortController wiring + signal on the LLM call. |
| `lib/ai/providers/anthropicProvider.ts` | Q4 | Optional `signal` on `ChatCompletionParams`, forwarded to the SDK. |
| `lib/ai/providers/openaiProvider.ts` | Q4 | Extract + forward optional `signal` as a per-request option. |
| `lib/calibration/__tests__/calibrationRcaConfig.test.ts` | Q1 | Flag-accessor tests. |
| `lib/calibration/__tests__/calibrationRcaService.test.ts` | Q3, Q4 | `buildRcaAttemptMetadata` + abort tests. |
| `docs/Calibration/CALIBRATION_OVERVIEW.md`, `POST_CREATION_CALIBRATION_FLOW.md`, `CALIBRATION_RCA_RUNBOOK.md` | Q2 | Auto-RCA sections + Mermaid diagrams + runbook note. |

### console.* note (CLAUDE.md § Logging) — flag for the user
The two provider files I touched for Q4 pre-date the Pino standard and still log via `console.*` — **`anthropicProvider.ts` (7 calls)** and **`openaiProvider.ts` (4 calls)**. Per the logging rule I am flagging them and proposing conversion to `createLogger`. I did **not** convert them in this follow-up because (a) they are shared provider-factory infrastructure (the Dev role requires SA sign-off before modifying the provider factory abstraction) and (b) it is out of scope for the tightly-scoped 4-item pre-commit review. Recommend a separate, SA-approved logging-cleanup ticket rather than folding a broad shared-infra rewrite into this commit. Awaiting the user's call.

## SA Review Notes — Code Review (pre-commit follow-ups)

**Code Review by SA — 2026-07-05 (second pass — 4 pre-commit follow-ups)**
**Status:** ✅ Code Approved

I re-verified the four follow-up items line-by-line against the real code (route tail L4637–4776, `calibrationRcaService.ts`, `calibrationRcaConfig.ts`, both providers, `baseProvider.ts`, both Mermaid docs, and the updated tests). All four are implemented correctly, every prior guarantee (C1, C2, byte-identical email when `autoRca` absent, AC-9) is intact, and no new `console.*` was introduced. The riskiest item (Q4 shared-provider signal forwarding) is genuinely backward-compatible. Details below.

### Per-item confirmation

**Q1 — flag accessor — CONFIRMED CORRECT.**
`isCalibrationAutoRcaEnabled()` (`calibrationRcaConfig.ts` L160–162) returns `process.env.CALIBRATION_AUTO_RCA_ENABLED === 'true'` — only the exact string `'true'` is truthy. Route imports it (L27) and uses it at the flag gate (L4671). Tests cover `'true'`, `'false'`, unset, and truthy-not-"true" (`'1'`, `'yes'`) — the last proving `'1'`/`'yes'` are false. Trivial and correct.

**Q2 — docs match code — CONFIRMED, no drift.**
The authoritative Mermaid in `POST_CREATION_CALIBRATION_FLOW.md` (L78–102) maps edge-for-edge onto the route tail: `A` = `isBackground && !passed`; `B` = flag-independent `correlation_id` persist **before** the dedup branch (route L4643–4651); `C` = `workflow_hash` gate (L4656); `D`/`DS` = `hasAdminAlertBeenSent` dedup skip (L4663–4667); `E OFF → G` = deterministic alert with `autoRca` undefined; `F`/`FB` = budget floor → `skipped_budget` status persisted → deterministic (L4687/4707); `H` = budget-aware generate; `HS` = `ok:true` → persist `auto_rca`+status → augmented section; `HF` = `ok:false` → persist `auto_rca_status = reason` → deterministic; `J`/`K` = `markAdminAlerted` only if `sent` (L4769). The never-throws envelope note matches the nested inner+outer `try/catch`. `CALIBRATION_OVERVIEW.md` (L188–193) carries a condensed copy and correctly defers to the POST_CREATION doc as authoritative. No contradiction between docs and code.

**Q3 — durable attempt status (AC-9 CRITICAL) — CONFIRMED CORRECT.**
`buildRcaAttemptMetadata(flagEnabled, outcome, attemptedAt)` (`calibrationRcaService.ts` L269–296) is pure and flag-aware. It persists `auto_rca_status` + `auto_rca_attempted_at` (plus the full `auto_rca`/`_generated_at`/`_model`/`_provider` payload on success) for success, **every** `ok:false` reason (`timeout`/`llm_error`/`invalid_output`/`evidence_error`), AND `skipped_budget`. The route writes it via `mergeMetadata` (route L4724–4726), so it composes with C1's no-clobber re-read. Unit-tested for all six statuses.

**AC-9 flag-off no-write — CONFIRMED byte-for-byte.** Two independent guards make the flag-off path write nothing from this feature: (1) in the route, `rcaEnabled === false` skips the entire generate block, leaving `rcaOutcome` null, so the `if (rcaOutcome && latest.id)` persist at L4723 never runs; (2) even if reached, `buildRcaAttemptMetadata(false, …)` returns `null` → no write. The unit test `flag OFF → returns null (writes NOTHING — AC-9)` proves the helper returns `null` for all three outcome kinds (success, timeout, skipped_budget). The **only** metadata write on a flag-off run is the pre-existing, flag-independent `correlation_id` (route L4644, from the approved base — not this follow-up). AC-9 holds byte-for-byte: no `auto_rca_status`, no `auto_rca`.

**Q4 — AbortSignal (the risk item) — CONFIRMED backward-compatible + never-throw-safe.**

*Backward-compat / no serialization:*
- **Anthropic** (`anthropicProvider.ts`): added optional `signal?: AbortSignal` to the provider-local `ChatCompletionParams` (L67). The request body (`requestParams`) is built **field-by-field** (model/messages/max_tokens/temperature/system/tools) — `params` is never spread — so `signal` is structurally impossible to leak into the body. It is forwarded only as the SDK's second-arg RequestOptions: `messages.create(requestParams, params.signal ? { signal } : undefined)` (L182–185). No signal → `undefined` second arg → identical to today.
- **OpenAI** (`openaiProvider.ts`): extracts `signal` off a shallow copy (`nonStreamParams = {...params}`) and **`delete`s it from the body** (L117–118) before `chat.completions.create(nonStreamParams, signal ? { signal } : undefined)` (L132–135). Verified: the delete acts on the copy, not the caller's object, and the signal is never serialized into the JSON. No signal → no-op delete + `undefined` option. Dev's claim ("openai deletes it from the body") is accurate.

*Never-throw on abort:* the service (L158–198) creates one `AbortController`, forwards `controller.signal`, and on the budget-aware timer fires `controller.abort()` then rejects `TimeoutError` → race rejects → caught → returns `{ok:false, reason:'timeout'}`. The losing `llmCall` promise's late `AbortError` cannot surface as an unhandled rejection: a `void Promise.resolve(llmCall).catch(() => {})` is attached **before** the `Promise.race` (L184), belt-and-suspenders over `Promise.race`'s own handler. Timer is cleared in `finally` (L197). The abort test (`hard-aborts the in-flight LLM request on timeout`) asserts `capturedSignal.aborted === true`; the happy-path test asserts `aborted === false` (no spurious cancel). Both green.

*Blast radius — LOW, contained:*
- The signal is optional on both providers; every existing caller passes no `signal` → unchanged behavior. No other provider-factory consumer is affected.
- **Kimi/Groq/Mistral untouched and safe:** the RCA config type constrains `provider` to `'openai' | 'anthropic'` (config L19, parser L100), so the RCA path can never select them; other callers of those providers never pass `signal`.
- **Type safety:** the service passes `signal` through `BaseAIProvider.chatCompletion(params: any, …)` (baseProvider L52) — this is a **pre-existing** `any`, not a new hole. No shared `BaseAIProvider` signature change was made; the change is confined to the two concrete providers the RCA can use. This is the minimal, correct footprint.

### Regressions — none
- **C1** (`mergeMetadata` re-read/no-clobber): unchanged; the new `rcaPatch` write routes through it (L4726), composing with `correlation_id`/`admin_alerted`.
- **C2** (budget math): unchanged (L4682–4687); the service still races against `min(cfg.timeoutMs, maxBudgetMs)` (L148).
- **Byte-identical email when `autoRca` absent:** `autoRca` is set only on `rcaResult?.ok` (L4763); flag-off / any `ok:false` → undefined → deterministic render unchanged. `calibrationAdminAlert.ts` untouched this pass.
- Existing `calibrationAdminAlert.test.ts` not modified; feature suites 96/96 green (was 85 — +11 for Q1/Q3/Q4).

### Ruling on the `console.*` conversion of the two provider files — DEFER (recommended)
Dev touched `anthropicProvider.ts` (7 `console.*`) and `openaiProvider.ts` (4 `console.*`) for Q4 and **flagged them with counts + proposed conversion** — satisfying the "flag it, don't silently leave it" half of the CLAUDE.md § Logging rule. On whether the conversion must land in *this* commit, my recommendation is **defer to a separate SA-approved logging ticket**, for the user's final call:
1. **Disproportionate blast radius.** The Q4 edit to these files is surgical (thread one optional param). Converting 11 `console.*` calls across shared provider-factory infra changes the observability of **every LLM call on the platform** and requires deliberate log-level decisions (e.g. the per-call "Converting OpenAI → Claude format" and "Raw response content" lines should almost certainly become `debug`, not a mechanical `info`). That is a design change, not a reformat.
2. **Scope/risk hygiene.** Folding a shared-abstraction rewrite into a narrowly-scoped calibration-RCA commit balloons the diff, makes the RCA change harder to review and revert, and mixes two unrelated risk profiles — exactly the coupling the standards discourage.
3. **The rule routes the final decision to the user.** CLAUDE.md says proceed with conversion "once the user approves, unless they explicitly decline." Dev flagged and proposed; the user decides. Given (1)/(2), I recommend the user **approve the deferral** and open a tracked `chore(logging)` ticket to convert both providers (with log-level triage) under its own SA review.
4. **Not a precedent.** This deferral is specific to shared provider-factory infra where the conversion exceeds the touching change's scope and risk envelope. It is **not** license to skip conversion on ordinary feature files you touch. No **new** `console.*` was added here.

### Optimisation Suggestions (Low, non-blocking — unchanged from first pass)
- `MAX_DURATION_MS = maxDuration * 1000` constant so the `60_000` budget literal can't drift from `export const maxDuration = 60`.
- Consider a shared `signal?: AbortSignal` on a typed provider-params interface if signal forwarding spreads beyond these two providers (avoids leaning on `BaseAIProvider`'s `any`).

### Approved for QA re-run: **Yes**
No code change required. The residual live-harness checks from the first code review still apply (AC-9 flag-off end-to-end, AC-10 dedup skip, AC-11 never-throws, AC-13 correlationId under adverse paths, C2 budget-skip) — the Q3 addition extends AC-9's live check to also assert **no `auto_rca_status` key** is written on a flag-off run, and Q4 adds a targeted check that a real over-budget RCA call is actually aborted (connection freed / token spend stops), not merely abandoned.

## QA Re-run — 2026-07-05 (4 pre-commit follow-ups: Q1 flag accessor, Q2 docs+diagram, Q3 attempt-status, Q4 AbortSignal)

**QA — 2026-07-05 (re-run)**
**Test mode:** full (unit + integration, as scoped) — re-verification of the 4 SA-approved follow-ups on top of the passing base.
**Strategy used:** A (Jest unit) + B (Jest integration with mocked repos/provider); light doc-sanity read for Q2. Route-tail paths remain E (static code-trace) — the follow-ups did **not** make the tail unit-invocable, so the same 5 route-level paths still need the live harness (restated below).
**Focus:** api, schema, security.
**Skipped:** No live end-to-end calibration run (harness not available in-session).
**Input source:** re-run prompt + workplan `## QA Test Scope` + SA second-pass ruling (`Approved for QA re-run: Yes`).

### Jest result — GREEN

`npx jest lib/calibration lib/repositories`:

```
Test Suites: 11 passed, 11 total
Tests:       96 passed, 96 total   (was 85 — +11 for Q1/Q3/Q4)
Snapshots:   0 total
Time:        ~7.5 s
```

All 11 suites pass. The +11 breakdown reconciles exactly: **Q1 = 4** (flag accessor), **Q3 = 5** (`buildRcaAttemptMetadata`), **Q4 = 2** (abort) → 4+5+2 = 11.

**Unchanged & still green (regression anchors):**
- `calibrationAdminAlert.test.ts` — the 8 existing deterministic cases (L49–111) are present, unmodified, and pass; the `autoRca`-absent case (L115–120) asserts **no `Automated RCA`** section → byte-identical email. `calibrationAdminAlert.ts` was **not** touched this pass.
- `CalibrationHistoryRepository.metadata.test.ts` (C1) — unchanged; "sequential writes COMPOSE" still proves `mergeMetadata` re-reads current metadata so `correlation_id` + `auto_rca(+model+provider)` + `admin_alerted` all coexist (no clobber). Green.
- `calibrationRcaService.test.ts` (C2) — the budget-aware timeout test (`maxBudgetMs: 40`) still returns `{ok:false, reason:'timeout'}`. The runtime log now reads **"RCA generation timed out (request aborted)"** — confirming Q4's AbortController actually fires on the timeout path (not merely abandons the promise). Green.

### New-test verification (read the tests, not just names)

- **Q1 — flag accessor** (`calibrationRcaConfig.test.ts` L81–109). `isCalibrationAutoRcaEnabled()` asserted: `'true'`→**true** (L88–91); `'false'`→**false** (L93–96); **unset**→false (L98–101); `'1'` and `'yes'`→**false** (L103–108). Only the exact string `'true'` is truthy. **Claim proven.**
- **Q3 — durable attempt status** (`calibrationRcaService.test.ts` L225–273, pure helper `buildRcaAttemptMetadata`).
  - **Flag OFF → returns `null` for all 3 outcome kinds** (success, timeout, budget-skip) — L236–242. This is the **AC-9 guard at the unit level**: the helper genuinely emits *no patch*, so nothing is passed to `mergeMetadata` — no `auto_rca_status`, no `auto_rca`. Proven.
  - Flag ON + **success** → `auto_rca_status: 'success'` + `auto_rca_attempted_at` + full RCA payload (`auto_rca`/`_generated_at`/`_model`/`_provider`) — L244–254.
  - Flag ON + **timeout** → `{auto_rca_status:'timeout', auto_rca_attempted_at}` and **explicitly asserts `not.toHaveProperty('auto_rca')`** — L256–260.
  - Flag ON + **budget-skip** → `auto_rca_status: 'skipped_budget'` — L262–265.
  - Flag ON + every `ok:false` reason (`llm_error`/`invalid_output`/`evidence_error`) → status echoes the reason — L267–272. **All claims proven.**
- **Q4 — AbortSignal hard-abort** (`calibrationRcaService.test.ts` L168–192).
  - Timeout path: provider receives an `AbortSignal`, and after the budget-aware deadline `capturedSignal.aborted === true` (**true cancellation, not abandonment**), result `{ok:false, reason:'timeout'}` — L168–180.
  - Happy path: signal present but `aborted === false` (**no spurious cancel**), result `ok:true` — L182–192. Never-throw preserved on both. **Claim proven.**

### Regression status — CLEAN
- Byte-identical email when `autoRca` absent: **holds** (renderer untouched; absent-case test green).
- C1 (`mergeMetadata` no-clobber): **intact & unchanged**, green.
- C2 (budget-aware service timeout): **intact**, green — now additionally exercises the live abort wiring.
- No new `console.*` introduced in the calibration modules. (Two touched **provider** files — `anthropicProvider.ts` 7×, `openaiProvider.ts` 4× `console.*` — pre-date Pino; Dev flagged + proposed conversion, SA recommended deferring to a separate `chore(logging)` ticket. Not a blocker; awaiting user's call — restated here for visibility.)

### Q2 docs sanity (light)
`POST_CREATION_CALIBRATION_FLOW.md` (L60–104) Mermaid + prose match the route at a high level, no obvious contradiction: `correlation_id` persisted **flag-independent, before the dedup branch**; `workflow_hash` gate; `hasAdminAlertBeenSent` dedup skip → no RCA/no second email; flag **OFF ⇒ deterministic exactly as today, no RCA-metadata write at all**; flag ON ⇒ budget-floor → `skipped_budget`; generate → success (persist `auto_rca` + augmented section) / `ok:false` (persist `auto_rca_status = reason` → deterministic); `markAdminAlerted` only if dispatched; never-throws envelope noted. Consistent with the marker table (L70–74). SA already did the edge-for-edge deep check; no discrepancy found on sanity pass.

### Updated AC notes (ACs touched by the follow-ups)

| AC | Status | Verified by | Note |
|---|---|---|---|
| **AC-9** flag-off → no LLM / no section / no RCA-metadata write, byte-compatible | ✅ unit-strengthened; ⚠️ end-to-end needs harness | automated (helper→null) + code-trace | Q3 adds a **unit-level** guard: `buildRcaAttemptMetadata(false, …)` returns `null` (no `auto_rca_status` either). Route double-guards (`rcaOutcome` stays null + helper null). **Full flag-off background run still needs the live harness** to assert zero LLM call + zero `auto_rca*`/`auto_rca_status` keys written. |
| **AC-13** correlationId persisted, flag-independent | ⚠️ code-trace (unchanged) | code-trace + C1 compose test | Written before/outside flag gate & dedup branch; composes via `mergeMetadata`. Live confirmation of "present when flag off / timeout / Zod-fail" still needs the harness. |
| New: **attempt-status durability** (Q3) | ✅ automated | unit | `auto_rca_status` + `auto_rca_attempted_at` for success / every `ok:false` reason / budget-skip; **null when flag off**. Route wiring of the helper → `mergeMetadata` is code-trace (tail not unit-invocable). |
| New: **hard-abort on timeout** (Q4) | ✅ automated | unit | Signal aborted on timeout, un-aborted on happy path; never-throw preserved. Real over-budget connection-cancellation is the one behaviour worth a live spot-check (token spend actually stops), per SA. |
| AC-1/2/3/4/5/6/7/8/12/14/15 | ✅ (unchanged from base QA) | automated | Re-run confirms all still green; no regression. |

### Route paths STILL needing the live harness (unchanged — the follow-ups did not make the tail unit-invocable)
1. **AC-9** flag-off full run — zero LLM call + **zero `auto_rca_status`/`auto_rca` keys** on a real background failure with the flag unset (Q3 extends this assertion).
2. **AC-10** dedup skip — second failure for same `(agentId,userId,workflowHash)` → no RCA, no second email.
3. **AC-11** forced-exception — throw in generate/persist/send never escapes the tail; HTTP response unchanged; gate = failed (agent not stuck "running").
4. **AC-13** correlationId under adverse paths — `metadata.correlation_id` written even when flag off / RCA times out / Zod fails.
5. **C2 budget-skip** under real elapsed time — RCA skipped (`skipped_budget` status persisted) and the deterministic email still sends when the tail starts with < ~13s of the 60s budget remaining; plus Q4's spot-check that an over-budget call is actually aborted.

### Issues Found (re-run)
- **Bugs:** None. No High/Medium/Low functional defect introduced by the follow-ups.
- **Performance:** None new.
- **Edge cases (Low, pre-noted, non-blocking):** `60_000` budget literal vs `maxDuration = 60` drift footgun; route-tail branch-coverage gap (SA's fast-follow: extract `runCalibrationAdminAlertTail(deps)`); provider-file `console.*` deferral (user's call). All carried over, none introduced this pass.

### Final Status (re-run)
- [x] Suite green — **96/96 across 11 suites**; the +11 new tests genuinely prove Q1/Q3/Q4 claims (verified by reading them).
- [x] No regression — byte-identical email (absent `autoRca`), C1 no-clobber, and C2 timeout all intact and green; `calibrationAdminAlert.ts` untouched.
- [x] Q2 docs sanity — Mermaid/prose match route behaviour at a high level; no contradiction.
- [ ] **Not fully signed off end-to-end** — the same **5 route-level paths** above remain **live-harness only**; Q3 adds a stronger AC-9 assertion (no `auto_rca_status` on flag-off) and Q4 adds an abort spot-check to that residual. No code change required for those checks — execution-only verification before/at release.

**Verdict:** PASS (re-run), no blocking bugs. The 4 follow-ups are correctly implemented and test-proven; nothing regressed. Not marking "ready for commit" outright only because the pre-existing 5 route-tail paths still require live-harness confirmation (per SA's accepted deferral) — that residual is unchanged, not introduced here.

## Commit Info

- **Branch:** agent-failure-troubleshooting (committed on branch; no merge to main)
- **Date:** 2026-07-05
- **Staged files (22):**
  - New (9):
    - `lib/calibration/calibrationRca-schema.ts`
    - `lib/calibration/calibrationRcaConfig.ts`
    - `lib/calibration/calibrationRcaPrompt.ts`
    - `lib/calibration/calibrationRcaService.ts`
    - `lib/calibration/__tests__/calibrationRca-schema.test.ts`
    - `lib/calibration/__tests__/calibrationRcaConfig.test.ts`
    - `lib/calibration/__tests__/calibrationRcaPrompt.test.ts`
    - `lib/calibration/__tests__/calibrationRcaService.test.ts`
    - `lib/repositories/__tests__/CalibrationHistoryRepository.metadata.test.ts`
  - Modified (10):
    - `app/api/v2/calibrate/batch/route.ts`
    - `lib/calibration/calibrationAdminAlert.ts`
    - `lib/calibration/__tests__/calibrationAdminAlert.test.ts`
    - `lib/repositories/CalibrationHistoryRepository.ts`
    - `lib/ai/providers/anthropicProvider.ts`
    - `lib/ai/providers/openaiProvider.ts`
    - `docs/Calibration/POST_CREATION_CALIBRATION_FLOW.md`
    - `docs/Calibration/CALIBRATION_OVERVIEW.md`
    - `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md`
    - `docs/FEATURE_FLAGS.md`
  - Cycle docs (3):
    - `docs/requirements/AUTOMATED_CALIBRATION_RCA_EMAIL_REQUIREMENT.md`
    - `docs/workplans/AUTOMATED_CALIBRATION_RCA_EMAIL_WORKPLAN.md`
    - `docs/retrospectives/AUTOMATED_CALIBRATION_RCA_EMAIL_RETROSPECTIVE.md`
- **Merge:** committed on agent-failure-troubleshooting, no merge to main, not pushed.
