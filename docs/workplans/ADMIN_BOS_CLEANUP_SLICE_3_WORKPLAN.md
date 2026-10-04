# Workplan: Admin BOS Cleanup, Slice 3 (AI cost & usage: Business OS lens, drill-down phantom columns, and the owner-text cut)

> **Last Updated**: 2026-10-03

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.1 FR-AC1..FR-AC6; NF-3, NF-7 (§3); TA-6, TA-7, TA-8, TA-11 (§10); §8 Privacy; the slice 3 lines of §9; and **SA Review — slice 3 (2026-10-03), conditions C3-1 to C3-12** (binding; where it differs from §3, §4.1 or §10, it governs).
**User defaults (FYI-1..3, not objected to, treated as decided):** FYI-1 the "All" scope execution detail shows name, timing, status and plugins only. FYI-2 the Business OS drill path goes feature → component → account, never agents. FYI-3 Business OS scope shows only the Total card.
**Branch:** `fix/admin-ai-cost-bos-lens` @ `19566036` (created by RM from `origin/main`). Worktree `neuronforge-admin-cost`. It also holds SA's uncommitted slice 3 review in the requirement; this workplan does not edit the requirement.
**Process:** Full cycle (privacy change): Dev workplan → SA workplan review → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-03
**Status:** Code Complete (uncommitted). SA approved with conditions W3-1..W3-9 (folded into sections 2, 4, 5, 10, 11); the user accepted FYI-1..5. Owed: T-11 (SA, at code review), T-13 (QA manual check; the TA-7 values are optional).
**Effort:** S to M, about 1.5 days (SA §F). Breakdown in [section 12](#12-effort-estimate).

## Overview

`/admin/analytics` ("AI cost & usage") opens in Business OS scope by default, but still offers AgentsPilot's four category cards, the Agent and Execution group-bys, and drills a row click straight into Agent. Its execution detail asks `workflow_executions` for two columns that do not exist, so the read fails silently. That failure is the only thing stopping the route from sending each agent's prompts and steps to the browser, for any account (S3-1). This slice, in **one PR**:

- hides the AgentsPilot cards, group-bys, chips and drill steps in Business OS scope, and makes the route refuse them there (FR-AC1..FR-AC4, C3-1..C3-4);
- fixes the two phantom columns, retires the step-name lookup behind the phantom filter (W3-1), **and** cuts the prompts, steps, schemas, input and output out of the `select` in the same change (FR-AC5, NF-3/TA-8, C3-5, C3-6);
- logs failed execution-detail reads with the request's correlation id (FR-AC6, C3-7).

No database change, no new route, no guard, gate-list, register or sidebar change.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Manual QA Check](#6-manual-qa-check)
- [7. TA-7 Baseline: the four card values in Business OS scope](#7-ta-7-baseline-the-four-card-values-in-business-os-scope)
- [8. Acceptance Criteria and Conditions Traceability](#8-acceptance-criteria-and-conditions-traceability)
- [9. Logging Compliance and Recorded Debt](#9-logging-compliance-and-recorded-debt)
- [10. Risks and Rollback](#10-risks-and-rollback)
- [11. PR Body Draft](#11-pr-body-draft)
- [12. Effort Estimate](#12-effort-estimate)
- [13. Open Points for SA](#13-open-points-for-sa)
- [Implementation Notes](#implementation-notes)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Read on `fix/admin-ai-cost-bos-lens` @ `19566036`. Line numbers are from that commit.

| Area | As built today | What this slice does |
|---|---|---|
| Query schema (`route.ts:45-74`) | `DrillDownQuerySchema` accepts every `breakdownBy`, `agent`, `execution`, `category` under any `scope`. One `.refine` (date order). | One added refinement: with `scope=bos`, refuse `breakdownBy=agent\|execution`, any `execution`, any `agent`, any `category` other than absent or `all` (C3-3). |
| Execution short-circuit (`route.ts:228-230`) | `if (q.execution) return await getExecutionCalls(q.execution)` runs before any scope logic (S3-4). | Unchanged in shape. It now receives `requestLogger`. The schema refusal runs first, so a BOS request never reaches it. |
| `workflow_executions` read (`route.ts:993-998`) | Selects `input_data, output_data` (both missing live, 42703). Error discarded, so `executionInfo` is always null and the panel never renders. | Select `agent_id, started_at, completed_at, status`. Error bound and logged (C3-5, C3-7). |
| `agents` read (`route.ts:1000-1022`) | Never runs today (gated on `executionInfo?.agent_id`). Would select and return `user_prompt`, `system_prompt`, `pilot_steps`, `input_schema`, `output_schema`. | Select `id, agent_name, connected_plugins, mode, status`; the response object maps only those (C3-5). Error bound and logged. |
| Step-name read (`route.ts:1024-1036`) | Filters on `workflow_step_executions.execution_id` (missing live; real key `workflow_execution_id`). Error discarded; step names have never loaded. | **Retired (W3-1, amends C3-6):** read, map and label use deleted; rows fall back to "Step N". |
| Execution response (`route.ts:1140-1153`) | `executionDetails` carries `inputData`, `outputData`, `agent` (with the five owner-text keys). | `executionDetails` = `executionId, startedAt, completedAt, status, agent{id, name, connectedPlugins, mode, status}`. |
| Execution-path logging | `getExecutionCalls` logs through the module `logger` (no `correlationId`) (S3-9). | Takes `requestLogger`; every log line in the function uses it. |
| Category cards (`page.tsx:673-810`) | Total + Creation + Execution + Memory + System, in both scopes. | Business OS scope renders only Total (C3-1, FYI-3). "All" unchanged. |
| Group By (`page.tsx:161-172`, `:900-924`) | All 10 options in both scopes. | `breakdownOptionsFor(scope)` omits Agent and Execution in Business OS scope (C3-2). |
| Row click drill (`page.tsx:385-436`) | Activity, Request Type, Feature, Component, Endpoint, User all go to `agent` (S3-5). | Business OS scope goes to the first of `feature, component, user, model, provider` not already filtered (C3-2, FYI-2). "All" unchanged. |
| Chips and breadcrumbs (`page.tsx:833-895`, `:1098-1119`); `ContextChips` (`:177-206`) | Category, Agent, Execution chips and breadcrumbs; "N agents" / "N executions" context chips, in both scopes. | Not rendered in Business OS scope (C3-2, defence in depth). |
| Scope toggle (`page.tsx:558-571`) | `setScope(prev => …)`; leaves `breakdownBy`, filters, `selectedCall`, `executionDetails` as they were (S3-5 would then 400). | One handler: in the same event as `setScope('bos')`, clear agent/execution/category filters and labels, reset `breakdownBy` to `provider` if hidden, clear `selectedCall` and `executionDetails` (C3-4). |
| Execution detail panel (`page.tsx:1291-1523`) | Six collapsible sections: Pilot Steps, Input Schema, Output Schema, Execution Input, Execution Output, User Prompt; `expandedSections` defaults to `'pilotSteps'`. `systemPrompt` is typed but never rendered. | All six sections deleted, with the `AgentData` / `ExecutionDetails` fields, `expandedSections` and `toggleSection` (used only by them). The header, timing/status/agent-id grid and Connected Plugins stay (C3-5, FYI-1). |

**Who calls the route:** only `app/admin/analytics/page.tsx:312` (S3-10). Deep links into the page (`BusinessOsPanel.tsx:211`, `lib/admin/health/evaluateHealth.ts:388`, `platform-dashboard/page.tsx`) carry only `scope`, `user` and the linked window, never `breakdownBy`, `agent`, `execution` or `category`, so no existing link can be refused by C3-3.

**Schema (TA-11):** measured live by SA on `19566036` (requirement, SA Review — slice 3, §A). Dev has no database access in this cycle and relies on that measurement. The after-change re-check is owed (C3-10, [O-6](#13-open-points-for-sa)).

**OI-9 debt named (SA §C):** the route still uses an inline service-role `createClient` (`route.ts:21-24`) for the label lookups and the execution-detail reads on `token_usage`, `workflow_executions`, `agents` and `workflow_step_executions`. This slice edits two of those reads and narrows a third; it adds none. The unpaged `auth.admin.listUsers()` in the label lookups (NF-5) and their discarded errors also stay. Recorded, not fixed.

---

## 2. Implementation Approach

### 2.1 Route: `app/api/admin/token-usage/drill-down/route.ts`

**(a) C3-3, the Business OS refusal.** One `.superRefine` appended to `DrillDownQuerySchema`, after the existing date refine. It runs only when `q.scope === 'bos'` and adds one issue per refused parameter, `path: [name]`, with a fixed message (`'Not available in Business OS scope'`) and `params: { bosScope: true }`:

| Parameter | Refused when `scope=bos` |
|---|---|
| `breakdownBy` | `agent` or `execution` |
| `execution` | any value, including `single-…` |
| `agent` | any value, including `no-agent` |
| `category` | any value other than absent or `all` |

Each issue is added with `ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message, params: { bosScope: true } })`, no `fatal` (W3-6). Because Zod 3.25 skips object-level refinements when a field check fails, a request with a malformed field gets the same generic 400 without `rejectedForBosScope`; the B-* tests therefore use well-formed values. The existing `!parsed.success` branch is unchanged in its response: 400, `'Invalid query parameters'`, `details` only under `NODE_ENV === 'development'`. Its `warn` gains one field: the **names** of the parameters refused for Business OS scope, `rejectedForBosScope: ['breakdownBy', 'execution']`, taken from the issue paths that carry `params.bosScope`. No value is logged. Because the schema parse happens before the execution short-circuit, a refused request makes no read at all (S3-4 closed). `scope` absent or `all` adds no issue (S3-3).

**(b) C3-5 to C3-7, the execution detail.** `getExecutionCalls(executionId, requestLogger)`:

- The `single-` branch and the `token_usage` read are unchanged apart from logging through `requestLogger` with `executionId` in the context (O-5 ruling). The `token_usage` failure still returns `{ success: false, error: 'Failed to fetch data' }`, 500.
- `workflow_executions`: `.select('agent_id, started_at, completed_at, status')`. Bind `error`. `PGRST116` (no row from `.single()`) → `requestLogger.info({ executionId }, …)`; any other error → `requestLogger.error({ err, executionId }, …)`. Continue either way with `executionInfo = null`.
- `agents` (still only if `executionInfo?.agent_id`): `.select('id, agent_name, connected_plugins, mode, status')`. Same error handling. `agentData = { id, name, connectedPlugins, mode, status }`, typed explicitly (`ExecutionAgentSummary | null`), so a later edit cannot widen it by accident without a type change.
- ~~`workflow_step_executions`: fix the filter to `workflow_execution_id`.~~ **Retired (W3-1, amends C3-6).** The step-name read, its lookup map and its use in the call-row label chain are deleted. Step names are written from the owner's own instructions (`StateManager.ts:1122-1123`) and have never loaded, because the filter column is a phantom; fixing the filter would switch on a new cross-account text path. Call rows fall back to the existing chain (`activity_name`, `activity_step`, `feature`, `component`, then `formatStepLabel(workflow_step)`, e.g. "Step 1"). This also removes one inline service-role read (OI-9 shrinks).
- Response: `executionDetails: { executionId, startedAt, completedAt, status, agent: agentData }`. `inputData` and `outputData` are gone. Everything else (totals, items, per-call metadata, `categoryTotals`) is unchanged.
- No log line contains a prompt, payload or step name. The comments added avoid the literal column names the source guard forbids (5.3).

**Not changed (C3-8):** the aggregate path, `getAvailableFilters`, the label lookups, the comparison read (OI-P2), the classifier, `getAggregatedData`'s own module-logger lines, and the inline client.

### 2.2 Page: `app/admin/analytics/page.tsx`

All helpers stay **inside** `page.tsx` as non-exported module functions (an App Router `page.tsx` may not export arbitrary names, and SA's §D ruling keeps new files out of the diff; see O-4).

- **One scope-aware source (C3-2):**
  - `const BOS_HIDDEN_DIMENSIONS = new Set<BreakdownDimension>(['agent', 'execution'])`
  - `breakdownOptionsFor(scope)` → `BREAKDOWN_OPTIONS` minus the hidden set in `bos`.
  - `bosDrillTarget(nextFilters, clicked)` → the first of `['feature', 'component', 'user', 'model', 'provider']` that is not in `nextFilters` and is not `clicked`; `null` if none.
  - `handleRowClick`: after the existing switch computes `nextBreakdown`, if `scope === 'bos'` and `nextBreakdown` is hidden, use `bosDrillTarget(newFilters, breakdownBy) ?? breakdownBy`. "All" scope paths untouched. The menu and the drill path both read `BOS_HIDDEN_DIMENSIONS`, so they cannot disagree.
  - Resulting Business OS paths: Provider → Model → Activity → Feature → Component → User (account) → Model or Provider if unfiltered, else stays. Feature row → Component (FYI-2).
- **Table category columns (W3-7, O-1 ruling):** the Creation, Execution and Memory header cells, row cells and footer cells render only when `scope === 'all'` (header cells get `data-testid="table-col-{creation|execution|memory}"`). The empty-state `colSpan` becomes scope-aware (9 in "All", 6 in Business OS). The activity-row category badge and the Call Details "BI Category" field stay.
- **Cards (C3-1):** the four category `<button>`s render only when `scope === 'all'`. The `<section className="grid grid-cols-5 gap-4">` and the Total card's classes are unchanged (D-4; see O-2). `data-testid="category-card-{total|creation|execution|memory|system}"` added for the tests (no visual effect).
- **Group By:** maps `breakdownOptionsFor(scope)`; buttons get `data-testid="group-by-{value}"`.
- **Chips and breadcrumbs:** the Category, Agent and Execution active-filter chips (`:833`, `:878`, `:886`) and the Agent and Execution breadcrumbs (`:1098`, `:1112`) additionally require `scope === 'all'`.
- **`ContextChips`:** gains a `scope` prop; the "agents" and "executions" chips render only in `all`.
- **Toggle (C3-4):** `handleScopeToggle()` computes `next` from the current `scope`, calls `setScope(next)`, and when `next === 'bos'`, in the same handler: `setFilters` / `setFilterLabels` without `agent`, `execution`, `category`; `setBreakdownBy(b => BOS_HIDDEN_DIMENSIONS.has(b) ? 'provider' : b)`; `setSelectedCall(null)`; `setExecutionDetails(null)`. React 18 batches these, so the next `fetchData` sees all of them together. Switching back to "All" restores nothing.
- **Detail panel (C3-5, FYI-1):** delete the six sections (`:1381-1520`), `AgentData.userPrompt/systemPrompt/pilotSteps/inputSchema/outputSchema`, `ExecutionDetails.inputData/outputData`, and `expandedSections` / `toggleSection` (`:267-279`). Keep the panel header (name, mode, status, plugin count), the "Show details" toggle, the Started / Completed / Status / Agent ID grid and Connected Plugins. The icon imports all stay (`Code`, `Users`, `Bot`, `Database` are still used by `BREAKDOWN_OPTIONS`); ESLint confirms.
- No `clientLogger` line is needed. `console.*` stays at 0.

### 2.3 Phantom register: `docs/workplans/business-os-phantom-column-remediation.md` (C3-11)

One targeted `Edit` inserting **P6b — Admin AI cost drill-down execution detail (resolved by ADMIN_BOS_CLEANUP slice 3)** after P6a, in P6a's table shape: the three findings at `19566036`, Rule 5 shape from SA §A, resolution (C3-5 retired, not rebuilt; `workflow_step_executions.execution_id` recorded as "right idea, wrong column; **retired** at this site for privacy, never loaded" per W3-1). One line noting that `workflow_executions.input_data` in P6's representative list is resolved at this site only. One Change History row. `git diff --stat` after the edit.

---

## 3. Files to Create / Modify

| File | Action | Change |
|---|---|---|
| `app/api/admin/token-usage/drill-down/route.ts` | modify (about +45 / −20) | C3-3 refinement and 400 log field; C3-5 selects and response trim; W3-1 step-name lookup retired (replaces C3-6); C3-7 `requestLogger` and error binding (2.1). |
| `app/admin/analytics/page.tsx` | modify (about +40 / −165) | C3-1, C3-2, C3-4; delete six sections and their state (2.2). |
| `app/api/admin/token-usage/drill-down/__tests__/bosLens.route.test.ts` | **create** | Refusals, "All" unchanged, execution detail with a per-table mock (5.1, 5.2). |
| `app/api/admin/token-usage/drill-down/__tests__/ownerText.guard.test.ts` | **create** | C3-9 source guard over `route.ts` and `page.tsx` (5.3). |
| `app/admin/analytics/__tests__/bosLens.render.test.tsx` | **create** | Page in both scopes, switching, drill path, detail panel (5.4). |
| `docs/workplans/business-os-phantom-column-remediation.md` | modify (targeted Edit) | P6b and a Change History row (2.3). |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_3_WORKPLAN.md` | create (this file) | Workplan. |

**Deleted:** none.

**Explicitly not touched:** `route.test.ts`, `wire.qa.test.ts` (must pass **unedited**), `scope.render.test.tsx`, `linkedWindow.render.test.tsx`, `app/admin/analytics/linkedWindow.ts`, `lib/repositories/AdminTokenUsageAnalyticsRepository.ts`, `adminGate.writes.test.ts`, the authz guard, `AdminSidebar.tsx` and both nav tests, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (SA §C), and `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md`.

---

## 4. Task List

- [x] ✅ **T-1 Baselines** on `19566036`:
  - Run `drill-down/__tests__` (both), `app/admin/analytics/__tests__` (both), `app/api/admin/__tests__/adminGate.writes.test.ts`, the admin authz guard and `app/admin/__tests__/health.render.test.tsx`. Record the pass counts.
  - `grep -c "console\."` on both files (expect 0 / 0).
  - `git grep -n "input_data\|output_data\|user_prompt\|system_prompt\|pilot_steps\|input_schema\|output_schema" -- app/api/admin/token-usage/drill-down/route.ts` and `git grep -n "userPrompt\|systemPrompt\|pilotSteps\|inputSchema\|outputSchema\|inputData\|outputData" -- app/admin/analytics/page.tsx`. Record the hit lines (expected: route `:995`, `:1004`, `:1012-1016`, `:1147-1148`; page **40 lines** per W3-9, not 28). Also `git grep -n "workflow_step_executions\|step_name"` on `route.ts` (W3-9).
- [x] ✅ **T-2 Tests first.** Write 5.1 to 5.4. Run them on the unchanged code and confirm each fails for the intended reason (e.g. E-1 sees `input_data`, B-1 gets 200, P-1 finds the Creation card). Record which failed.
- [x] ✅ **T-3 Route, C3-3** (2.1 a). Run 5.1.
- [x] ✅ **T-4 Route, C3-5, C3-7, W3-1** (2.1 b), as one edit: the selects, the step-read retirement, the response and the logging land together, never in separate saves (S3-1). Run 5.2 and 5.3 (route half).
- [x] ✅ **T-5 Page, C3-1, C3-2, C3-4, W3-7** (2.2). Run 5.4 P-1 to P-8 and P-10 to P-13.
- [x] ✅ **T-6 Page, C3-5 deletions** (2.2). Run 5.3 (page half) and P-9.
- [x] ✅ **T-7 Regression.** All T-1 suites plus the new ones; `wire.qa.test.ts` and `route.test.ts` **unedited** (`git diff --exit-code 19566036 -- app/api/admin/token-usage/drill-down/__tests__/wire.qa.test.ts app/api/admin/token-usage/drill-down/__tests__/route.test.ts`). Then `npx jest app/admin app/api/admin lib/admin`; record counts and any known flake.
- [x] ✅ **T-8 Type check and lint (C3-10).** Scratch tsconfig in the scratchpad (`extends` the repo tsconfig, `include: []`, `files` = the two code files and three new tests), `NODE_OPTIONS=--max-old-space-size=8192`, judged by `tsc`'s **own exit code**, compared with the same run on a `git archive` export of `19566036` (new test files removed). `npx eslint` on the two code files: 0 errors, no new warnings. `npm run lint:hooks` exits 0.
- [x] ✅ **T-9 Sweeps.** `git diff --stat` shows only the files in section 3. Re-run the T-1 greps: route and page hits are 0 for the forbidden names, and `route.ts` has 0 hits for `workflow_step_executions|step_name` (W3-9). `grep -c "console\."` still 0 / 0.
- [x] ✅ **T-10 Phantom register** (2.3, C3-11), targeted Edit, then `git diff --stat` (insertions only, no deletions).
- [x] ✅ **T-11 Schema re-check (C3-10). Owner: SA, at code review (W3-8).** Done 2026-10-03: both selects succeed live (see SA Code Review §B). SA re-runs the §A whole-select probes for `workflow_executions(agent_id, started_at, completed_at, status)` and `agents(id, agent_name, connected_plugins, mode, status)` on the code-complete tree and records ref and result. The step-read probe is dropped (W3-1).
- [x] ✅ **T-12** Fill in Implementation Notes, tick tasks, set status Code Complete. Leave everything **uncommitted**.
- [ ] **T-13** (QA / user) Manual check, section 6 (owed by QA). The live TA-7 card values, section 7, are **optional and non-gating** (W3-8).

---

## 5. Test Plan

### 5.1 Route, Business OS refusals and "All" unchanged: `bosLens.route.test.ts` (new)

Mocks: `@/lib/auth`, `AdminAccessService` (as in `route.test.ts`); a hoisted logger whose `child()` returns a **distinct** child object with its own `jest.fn`s (so tests can tell `requestLogger` from the module logger); the repository's `listRowsAllAccountsInWindow` as `mockListRows`; and `@supabase/supabase-js` with a **per-table recording mock**: `from(table)` is a `jest.fn` that returns a chain recording `select(cols)`, every `eq(col, val)`, `order`, `single`, and resolves to a per-table result set by the test (`{ data, error }`).

| # | Case | Assertions |
|---|---|---|
| B-1..B-6 | `scope=bos` with each of `breakdownBy=agent`, `breakdownBy=execution`, `execution=<uuid>`, `execution=single-<uuid>`, `agent=<uuid>`, `category=memory` (all well-formed, W3-6) | 400; body equals `{ success: false, error: 'Invalid query parameters' }` (no `details` outside development); `mockListRows` **and** `from` not called (no read of any kind); the warn's `rejectedForBosScope` names the parameter, proving the 400 came from the BOS refinement and not a field check. |
| B-9 | Generic shape whatever the cause (W3-6) | A malformed `scope=bos&agent=abc` (field check) and a well-formed `scope=bos&agent=<uuid>` (BOS refinement) return byte-identical bodies. |
| B-7 | `scope=bos&agent=no-agent` and `scope=bos&category=all` | `no-agent` → 400; `category=all` → 200 (allowed). |
| B-8 | Refusal log | The child logger's `warn` was called with `rejectedForBosScope` equal to the refused names; `JSON.stringify` of every warn argument contains neither the uuid nor `single-`. |
| A-1..A-6 | The same six parameters with `scope=all` | 200 each. |
| A-7 | The same six with `scope` absent | 200 each (route default `all`, S3-3). |
| A-8 | `scope=bos` with `breakdownBy=feature`, `component`, `user`, `model`, `provider`, `activity` | 200 each (only the hidden views are refused). |

`wire.qa.test.ts:133` (route default `all`) passes unedited (T-7).

### 5.2 Route, execution detail: `bosLens.route.test.ts` (same file, own `describe`)

Per-table results: `token_usage` → two ledger rows with `execution_id = EXEC`, one with `workflow_step = 'step1'`; `workflow_executions` → a row that **also carries** `input_data` and `output_data` sentinels; `agents` → a row that **also carries** `user_prompt`, `system_prompt`, `pilot_steps`, `input_schema`, `output_schema` sentinels (`'SECRET-…'` strings) plus `agent_name`, `connected_plugins`, `mode`, `status`; `workflow_step_executions` → `[{ step_id: 'step1', step_name: 'SECRET-step' }]` (so that, were the retired read ever restored, E-3 and E-4 would catch it). The mock returns the extra columns on purpose, so the response test proves the mapping, not the mock.

| # | Case | Assertions |
|---|---|---|
| E-1 | `workflow_executions` select | Recorded select is exactly `agent_id, started_at, completed_at, status`; contains neither `input_data` nor `output_data`. |
| E-2 | `agents` select | Contains none of `user_prompt`, `system_prompt`, `pilot_steps`, `input_schema`, `output_schema`; is `id, agent_name, connected_plugins, mode, status`. |
| E-3 | Step-name lookup retired (W3-1) | `from('workflow_step_executions')` is never called. The call row whose ledger row has `workflow_step = 'step1'` and no `activity_name` is labelled by the existing fallback, `Step 1`, never by a step name. |
| E-4 | Serialised response | `await res.text()` contains none of `userPrompt`, `systemPrompt`, `pilotSteps`, `inputSchema`, `outputSchema`, `inputData`, `outputData`, and none of the `SECRET-` sentinels. |
| E-5 | Metadata comes through | `executionDetails.startedAt`, `completedAt`, `status`; `agent` equals `{ id, name, connectedPlugins, mode, status }` exactly (`toEqual`). |
| E-6 | Executions read fails (`{ code: '42703' }`) | 200; `items` has the two calls; `executionDetails.agent` is null; the **child** logger's `error` called with `{ err, executionId: EXEC }`; `agents` never queried; the body has no `details` and no `message` field (W3-4). |
| E-7 | Executions read `PGRST116` | 200; child `error` **not** called; `info` (or `warn`) called with `executionId`. |
| E-8 | Agents read fails | 200; logged at `error` with `{ err, executionId }`; calls returned. (The step read no longer exists, W3-1.) |
| E-9 | `token_usage` read fails | 500, body `{ success: false, error: 'Failed to fetch data' }`; logged on the child logger. |
| E-10 | `single-<uuid>` path, `scope=all` | 200, one item, no `executionDetails`; unchanged behaviour. |
| E-11 | Logs carry no owner text (W3-4) | Across E-4..E-9, `JSON.stringify` of every call on **both** the child (request) logger and the module logger contains no `SECRET-` sentinel. |

### 5.3 Source guard: `ownerText.guard.test.ts` (new, C3-9)

Reads both files with `fs.readFileSync` (raw source, comments included, so a comment cannot smuggle a restore hint either).

| # | Assertion |
|---|---|
| G-1 | `route.ts` contains neither `input_data` nor `user_prompt` (C3-9). |
| G-2 | `page.tsx` contains neither `userPrompt` nor `inputData` (C3-9). |
| G-3 | Extended, same intent: `route.ts` contains none of `output_data`, `system_prompt`, `pilot_steps`, `input_schema`, `output_schema`; `page.tsx` none of `outputData`, `systemPrompt`, `pilotSteps`, `inputSchema`, `outputSchema`. |
| G-4 | `route.ts` contains neither `workflow_step_executions` nor `step_name` (W3-1: the retired step-name lookup cannot come back silently). |

### 5.4 Page: `bosLens.render.test.tsx` (new)

Same harness as `scope.render.test.tsx` (jsdom, `next/navigation` mock with `mockSearch`, stubbed `fetch`). The fetch stub can return different bodies per request so the drill tests can serve typed items.

| # | Case | Assertions |
|---|---|---|
| P-1 | Business OS (default) | `category-card-total` present; `category-card-creation/execution/memory/system` absent; `group-by-agent` and `group-by-execution` absent; the other eight group-bys present; `table-col-creation/execution/memory` absent; empty-state cell `colSpan` 6 (W3-7). |
| P-2 | `?scope=all` | All five cards, all ten group-bys and the three table columns present; empty-state `colSpan` 9 (W3-7). |
| P-3 | Switching (C3-4) | Start `scope=all`, click `group-by-agent`, wait for a request with `breakdownBy=agent`. Click the toggle. The next request has `scope=bos` and `breakdownBy=provider`; **no** request ever has `scope=bos` together with `breakdownBy=agent`, `agent=`, `execution=` or `category=`; no error banner. |
| P-4 | Business OS Feature row click (C3-2) | Select `group-by-feature`, fetch returns one `type: 'feature'` item; click it. Next request has `feature=<id>` and `breakdownBy=component`, not `agent`. |
| P-5 | Business OS User row click with feature and component already filtered | Next `breakdownBy=model`. |
| P-6 | "All" Feature row click | Next `breakdownBy=agent` (unchanged). |
| P-7 | Context chips | Item with `metadata.agentCount: 2, executionCount: 3`: in Business OS, no "2 agents" / "3 executions"; in "All", both shown. |
| P-8 | Switching clears execution state | Start "All"; the stub returns `executionDetails` **only for requests that carry `execution=`** (W3-5). Drill Agent → Execution → an execution row so the panel renders; toggle to Business OS; panel gone and the next request carries no `execution=`. |
| P-9 | "All" execution detail (FYI-1) | Response with `executionDetails` whose `agent` **also carries** `userPrompt`, `pilotSteps`, `inputSchema`, `outputSchema` and top-level `inputData`/`outputData` (sentinel strings). Click "Show details": Started, Status and Connected Plugins render; none of "Pilot Steps", "Input Schema", "Output Schema", "Execution Input", "Execution Output", "User Prompt", nor any sentinel, is in the document. |
| P-10 | BOS Activity-like row → Feature (W3-5; the C3-12 path) | Parametrised over `activity`, `request_type` and `endpoint`: click a row; next request has `breakdownBy=feature`. |
| P-11 | BOS stay-put fallback (W3-5) | With `feature`, `component`, `user`, `model` and `provider` all filtered (deep link + drills), a row click keeps the current `breakdownBy`; no request carries `breakdownBy=agent`. |
| P-12 | "All" Activity → Agent, Agent → Execution (W3-5) | Unchanged "All" drill path. |
| P-13 | Whole-run invariant (W3-5) | A shared `afterEach` over every fetch-stub call in the file: no URL has `scope=bos` together with `breakdownBy=agent\|execution`, `agent=`, `execution=` or `category=`. |

### 5.5 Unchanged suites that must stay green

`route.test.ts`, `wire.qa.test.ts`, `scope.render.test.tsx`, `linkedWindow.render.test.tsx`, `adminGate.writes.test.ts` (its drill-down entry calls `?period=30d` with no `scope`, so it is unaffected), the admin authz guard, `app/admin/__tests__/health.render.test.tsx`, `lib/admin/health/__tests__/evaluateHealth.test.ts`.

### 5.6 Type check and lint

As T-8. `ts-jest` does not type-check here, so the scoped `tsc` is the only evidence that no deleted field is still referenced.

---

## 6. Manual QA Check

As a platform admin on `npm run dev` (C3-12):

1. **Business OS scope (default).** Only the Total card in the top row. Group By has no Agent or Execution. Click Provider → a row (lands on Model) → a row (Activity) → a row: it lands on **Feature**, never Agent; continue to Component and User. No error banner at any step. No "N agents" chips.
2. **"All" scope.** All five cards and all ten group-bys are back. Drill Provider → Model → Activity → a row: lands on Agent, as before. Open an agent → an execution with an agent. Press "Show details": Started, Completed and Status show real values (they were never shown before, FR-AC5), and there is **no** Pilot Steps, Input Schema, Output Schema, Execution Input, Execution Output or User Prompt section. Call rows show the ledger label or "Step N", never a recorded step name (W3-1; corrected per SA CR-1).
3. **DevTools → Network.** Open that execution-detail response. None of `userPrompt`, `systemPrompt`, `pilotSteps`, `inputSchema`, `outputSchema`, `inputData`, `outputData` is present.
4. **Switching.** In "All" with Agent selected (and ideally an execution open), switch to Business OS. No error banner, group-by is Provider, the agent panel is gone. Switch back: nothing is restored.
5. **Hand-edited API call.** `/api/admin/token-usage/drill-down?scope=bos&breakdownBy=agent` in the address bar returns 400 `Invalid query parameters`.

---

## 7. TA-7 Baseline: the four card values in Business OS scope

SA §C asks for the four card values in Business OS scope for the 30-day and 90-day periods, read off the current page. **Dev has no database and no browser session this cycle, so the live figures are not read here.** What can be stated from code and fixtures:

| Source | Creation | Execution | Memory | System | Total |
|---|---|---|---|---|---|
| **Code reading, real Business OS rows** (`buildBosCallContext` sets no category → tracker records `general`; embeddings record `embedding_generation` / `embedding`; BOS `activity_type` extras found: `narration`, `plan`, `repair`, `cache_hit`) | $0 | $0 | $0 | **= Total** | — |
| … except legacy-tagged rows that carry an AgentsPilot `category` or `activity_type` | may be > $0 | may be > $0 | may be > $0 | Total minus those | — |
| **Page fixture** `scope.render.test.tsx` `okBody()` | $0.00 | $0.00 | $0.00 | $1.50 | $1.50 |
| **Route fixture** `route.test.ts` `BOS_ROWS` through the classifier (`activity_type: 'llm_call'`, `category: null`) | $0 | **$0.0056** | $0 | $0 | $0.0056 |

The route fixture is unrepresentative (real Business OS rows carry `category: 'general'`, which the classifier checks first), but it makes SA's point from the other side: whichever card a Business OS row lands in, that card repeats the Total. Note also that `getActivityCategory`'s DB-category switch is checked **before** activity type, so the newly found `plan` / `repair` / `cache_hit` activity types change nothing.

**Optional, non-gating (T-13, W3-8):** QA records the four cards off **production** (which still runs the old page until this merges) in Business OS scope at 30d and 90d if convenient during the section 6 check. Otherwise this table stays "not read" with no consequence; after the merge the values remain readable from `categoryTotals` in the Network tab. No SQL is needed.

| Period | Creation | Execution | Memory | System | Total | Read by / when |
|---|---|---|---|---|---|---|
| 30d | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 90d | ☐ | ☐ | ☐ | ☐ | ☐ | |

---

## 8. Acceptance Criteria and Conditions Traceability

| §9 slice 3 criterion | Proven by |
|---|---|
| In BOS scope: no Creation, Execution or Memory card (and no System, C3-1), no Agent or Execution group-by, no execution detail, and a URL cannot bring them back. "All" unchanged (tested both ways). | P-1, P-2, P-3, P-8, B-1..B-8, A-1..A-8; QA 1, 2, 5 |
| An "All" scope execution detail shows its status and timing again (schema-check confirmed). | E-1, E-5, P-9; SA §A whole-select probe; T-11 re-check; QA 2 |
| All slices: happy path and a failure path; QA manual check | E-5 / E-6..E-9, B-* / A-*; section 6 |

| Condition | Where |
|---|---|
| C3-1 only Total in BOS; five in "All"; grid and classes unchanged | 2.2, P-1, P-2, O-2 |
| C3-2 group-bys, chips, breadcrumbs, `ContextChips`, drill path, one helper | 2.2, P-1, P-4..P-7 |
| C3-3 one schema refinement, standard 400, warn with names only | 2.1 a, B-1..B-8, A-1..A-8 |
| C3-4 toggle clears in the same event | 2.2, P-3, P-8 |
| C3-5 selects, response trim, six page sections, `expandedSections` | 2.1 b, 2.2, E-1, E-2, E-4, G-1..G-3, P-9, O-3 |
| C3-6 step filter (amended by W3-1: lookup retired) | 2.1 b, E-3, G-4 |
| W3-1..W3-9 (SA workplan review) | W3-1 2.1 b, E-3, G-4, §10, §11, 2.3; W3-2 §11, Implementation Notes; W3-3 §10, §11; W3-4 E-6, E-11; W3-5 P-8, P-10..P-13; W3-6 2.1 a, B-1..B-9; W3-7 2.2, P-1, P-2; W3-8 T-11, T-13, §7; W3-9 T-1, T-9 |
| C3-7 `requestLogger`, bound errors, PGRST116 not `error`, 200 kept, 500 kept, no text logged | 2.1 b, E-6..E-9 |
| C3-8 nothing else changes | 2.1 "Not changed", T-9 |
| C3-9 tests in the same PR | Section 5 |
| C3-10 scoped `tsc`; schema re-check | T-8, T-11, O-6 |
| C3-11 phantom register | 2.3, T-10 |
| C3-12 manual QA | Section 6 |

---

## 9. Logging Compliance and Recorded Debt

Counted with `grep -c "console\."` on `19566036`: `page.tsx` **0**, `route.ts` **0** (SA §D). No conversion needed; T-9 re-counts.

Recorded, not fixed (SA §C):

- **OI-9:** the inline service-role client in `route.ts` for the label lookups and the execution-detail reads.
- **NF-5:** the label lookups' unpaged `auth.admin.listUsers()` and their discarded errors.
- **S3-9 remainder:** `getAggregatedData` still logs through the module `logger` (no `correlationId`). C3-7 covers only the execution path, and C3-8 freezes the aggregate path.

---

## 10. Risks and Rollback

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| **The executions fix lands without the owner-text cut**, so prompts start flowing (S3-1) | Low / **High** (cross-account owner text) | T-4 is one edit; E-2, E-4 and G-1..G-3 fail the PR if the cut is missing; SA code review diffs the two selects together. |
| A Business OS click path still reaches a refused view and the page shows "not valid" | Low / Med | One `BOS_HIDDEN_DIMENSIONS` set feeds menu, drill path and toggle; P-3..P-5; QA 1. |
| Deploy skew: an operator has the **old** page open in Business OS scope and clicks a row that drills to Agent | Low / Low | The new route answers 400 and the old page shows its existing "filters not valid" message. A reload fixes it. Two admins. |
| A cut field is still referenced somewhere on the page | Low / Low | Scoped `tsc` (T-8), G-2/G-3, P-9. |
| Doc edit damages the 307-line phantom register | Low / Med | Targeted `Edit` only; `git diff --stat` shows insertions only (T-10). |

**Rollback (W3-3):** one PR, no migration, no data, gate or register change. Revert this PR as a whole: that is privacy-safe, because it restores the phantom columns, so the executions read fails again and the prompt read is again unreachable. **Never cherry-pick the `workflow_executions` column fix without the owner-text cut** (onto a tree without the cut, it would start sending prompts, S3-1). **Never revert the cut on its own** (the `agents` select, the agent mapping, the `executionDetails` shape) while the executions fix stays: that is the dangerous partial revert. Reverting only the executions select is harmless (the read fails again), but there is no reason to. The source guard (G-1..G-4) fails any partial revert that brings a prompt, payload or step-name reference back, but only when someone runs Jest (no CI job does, W3-2). The PR body says so.

---

## 11. PR Body Draft

```markdown
## fix(admin): AI cost & usage Business OS lens; execution detail no longer reads agent prompts (ADMIN_BOS_CLEANUP slice 3)

### Privacy fix, stated plainly
The AI cost page's execution detail was written to send each agent's prompts,
pilot steps, input/output schemas and the run's input and output to the admin's
browser, for any customer's account. **None of it was ever sent**, but only by
accident: the query also asked for two columns that do not exist
(`workflow_executions.input_data`, `output_data`), so it failed silently and the
prompt query never ran. Fixing that column bug on its own would have switched
the exposure on.

This PR fixes the column bug and, in the same change, removes the prompt,
step, schema, input and output fields **from the database queries themselves**,
so that text never leaves the database. The execution detail now shows the
agent's name, mode, status and connected plugins, plus the run's start, end and
status. Cross-account admin views are metadata only again (requirement §8).

### What changes
- **Business OS scope (the default):** only the Total card; no Creation,
  Execution or Memory table columns; no Agent or Execution group-by, chips or
  breadcrumbs; clicking down goes feature →
  component → account, never to agents. Switching to Business OS clears any
  agent, execution or category selection.
- **The route refuses** agent, execution and category views when
  `scope=bos` (400, standard format), before any read. `scope=all` and no
  `scope` behave exactly as before.
- **"All" scope execution detail** shows timing and status again (it never
  could, because of the missing columns).
- **The step-name lookup is retired.** It filtered on a column that does not
  exist (`workflow_step_executions.execution_id`), so it never loaded. Step
  names are written from the business owner's own instructions and can mention
  their clients, so fixing it would have started showing that text for every
  account. Call rows keep their existing labels ("Step 1", "Step 2", ...).
- Failed execution-detail reads are logged with the request's correlation id
  instead of being discarded.

### Not changed
No database change, no new route, no guard, admin gate list or sidebar change.
The aggregate path, filters, label lookups and classifier are untouched. The
inline service-role client (OI-9) stays recorded debt.

### Tests
Route: six Business OS refusals with no read, the same parameters 200 under
`scope=all` and with no scope; execution detail with a per-table mock (selects
name no prompt/payload column, no step-name read, serialised response free of all seven keys and of planted marker text, and
every log line free of the planted markers, even when the
database returns those columns, failed reads logged and still 200). Page: both
scopes, switching, the Business OS drill path (including the stay-put fallback),
the unchanged "All" path, the trimmed detail panel, and a whole-run check that
no Business OS request carries a hidden parameter. A source guard keeps the
prompt, payload and step-name references out of the route and page.
`wire.qa.test.ts` and `route.test.ts` unedited and green.

**Limit:** no CI workflow runs Jest today, so the source guard bites only in
local runs and at review. Putting it in the first CI tier is a recorded
follow-up for the test-tiering cycle.

### Rollback
Revert this PR as a whole. No migration. Never cherry-pick the
`workflow_executions` column fix without the owner-text cut. Never revert the
cut (the `agents` select, the agent mapping, the `executionDetails` shape) on
its own. Reverting only the executions select is harmless (the read fails
again), but there is no reason to.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 12. Effort Estimate

| Part | Estimate |
|---|---|
| Baselines (T-1) | 0.5 h |
| Tests written first and seen failing (T-2) | 3 to 4 h |
| Route: refinement, selects, filter, trim, logging (T-3, T-4) | 2 h |
| Page: lens, drill path, toggle, deletions (T-5, T-6) | 3 to 4 h |
| Regression, scoped `tsc`, lint, sweeps (T-7 to T-9) | 1.5 h |
| Phantom register and notes (T-10, T-12) | 0.5 to 1 h |
| **Total** | **about 10.5 to 13 h, within SA's ~1.5 days.** Excludes T-11 (DB holder) and T-13 (QA / user). |

---

## 13. Open Points for SA

| # | Point | Dev proposal |
|---|---|---|
| **O-1** | **The table's Creation / Execution / Memory columns** (`page.tsx:1142-1144` header, row cells `:1228-1236`, footer `:1261-1269`) are the same AgentsPilot taxonomy as the cards. In Business OS scope they are almost always "-" and $0.00, because Business OS rows classify as System, which has no column. C3-1 names only the cards, and §D rules out scope expansion. | Default: **unchanged** (C3-8 discipline). If SA rules them hidden in Business OS scope too, it is the same `scope === 'all'` condition on three header cells, three row cells and three footer cells (about 15 minutes plus one P-1 assertion). The activity-row category badge and the Call Details "BI Category" field would stay either way. |
| O-2 | With only the Total card in `grid grid-cols-5`, the card takes one fifth of the row and four slots stay empty. C3-1 says keep the grid and card classes. | Keep as ruled (D-4). Alternative if SA wants it: `scope === 'bos' ? 'grid-cols-1' : 'grid-cols-5'` on the section, an existing Tailwind class, no restyle of the card itself. |
| O-3 | C3-5 says "the five render sections" but names six (Pilot Steps, Input Schema, Output Schema, Input Data, Output Data, User Prompt), and the page has six. `systemPrompt` is typed but has no section. | Delete all six; remove `systemPrompt` from the type. Read as a count slip. |
| O-4 | The scope helpers (`breakdownOptionsFor`, `bosDrillTarget`) are pure and could live in a sibling `app/admin/analytics/bosLens.ts` (the `linkedWindow.ts` precedent) for direct unit tests. An App Router `page.tsx` cannot export them, and §D wants no new non-test file. | Keep them non-exported inside `page.tsx`; prove them through P-3..P-6. Move to `bosLens.ts` only if SA prefers. |
| O-5 | C3-7 passes `requestLogger` into `getExecutionCalls`. The function's two existing `logger.error` lines (the `single-` branch `:920`, the `token_usage` read `:988`) would then still use the module logger, while C3-8 says the `single-` path stays as is. | Switch both to `requestLogger` (logging only, no behaviour change), so every line from the function carries the `correlationId`. Confirm this is within C3-7, not a breach of C3-8. |
| **O-6** | **C3-10's schema re-check and section 7's live card values need database or browser access, which Dev does not have this cycle.** | SA (who ran §A) re-runs the §A probes on the code-complete tree and records ref and result in Implementation Notes; QA or the user reads the four cards off production before merge. Both are listed as owed (T-11, T-13). |
| O-7 | C3-6 makes `step_name` labels appear on "All" scope call rows for the first time. They are step labels written by the agent pipeline, possibly from the owner's own wording, but they are short labels, not prompts or payloads. | Ship as ruled (C3-6 keeps `step_id, step_name`). Raised only so the first appearance of new cross-account text is a conscious decision. |
| O-8 | The refusal also covers `agent=no-agent` (C3-3 "any `agent` value"). Nothing on the page sends it in Business OS scope after C3-2. | Refuse it, as ruled. B-7 pins it. |
| O-9 | Test placement: the refusals need a `from` spy and a capturable child logger, which the existing `route.test.ts` proxy mock lacks. | New file `bosLens.route.test.ts` with its own mocks; `route.test.ts` stays unedited, like `wire.qa.test.ts`. |
| O-10 | `data-testid`s added to the five cards and ten group-by buttons, for the tests. | Attributes only, no visual change (D-4). |

---

## Implementation Notes

**Dev, 2026-10-03.** Worktree `neuronforge-admin-cost`, branch `fix/admin-ai-cost-bos-lens` @ `19566036`. Everything is **uncommitted**.

### Baselines (T-1, on `19566036`)

| Check | Result |
|---|---|
| Drill-down (2) + analytics (2) + `adminGate.writes` + `health.render` | 6 suites, 348 tests, all green |
| `console.*` | `page.tsx` 0, `route.ts` 0 |
| Route forbidden names | `:995`, `:1004`, `:1012-1016`, `:1147-1148` as expected; `workflow_step_executions` / `step_name` at `:1024`, `:1027-1028`, `:1033-1034`, `:1071` |
| Page forbidden names (W3-9) | **40 lines** (incl. `expandedSections` / `toggleSection`) |

### Tests first (T-2)

Written before any code change and run on the unchanged tree: **49 failed, 21 passed** of 70.

- **Route (`bosLens.route.test.ts`, 37 tests):** B-1..B-9 failed (200 where 400 expected; no `rejectedForBosScope`); E-1..E-9 failed for their intended reasons (select contained `input_data` / `user_prompt`; `workflow_step_executions` was queried and the row label was the planted step name; the response carried the owner-text keys; errors went to the module logger, not the request logger). A-1..A-8 and E-10 passed on both trees, as they should (unchanged behaviour).
- **Guard (`ownerText.guard.test.ts`, 17 tests):** all 16 name checks failed; the "reads the real files" sanity check passed.
- **Page (`bosLens.render.test.tsx`, 16 tests):** on the bare old page most failed only on missing `data-testid`s, which proves nothing. So the page tests were **re-run against the old page with only the test ids added** (built in the scratchpad, swapped in, then the new page restored and `cmp`-checked). Result: every Business OS test failed on behaviour (Creation card present; `colSpan` 9 not 6; "2 agents" chip shown; toggle sent `breakdownBy=agent`; Activity / Request Type / Endpoint / Feature / User rows drilled to `agent`; the panel rendered "Pilot Steps"; P-8 kept sending `execution=`). The three "All unchanged" tests (P-2, P-6, P-12) passed on both, as intended.

### Implementation (T-3..T-6, T-10)

- **Route:** `.superRefine` with `ctx.addIssue({ code: custom, path, message, params: { bosScope: true } })`, no `fatal` (W3-6); the 400 `warn` gains `rejectedForBosScope` (names only). `getExecutionCalls(executionId, requestLogger)`: both existing error lines moved to `requestLogger` with `executionId` (O-5); executions select `agent_id, started_at, completed_at, status`; agents select `id, agent_name, connected_plugins, mode, status` into an explicit `ExecutionAgentSummary`; both errors bound (`PGRST116` → `info`, else `error` with `{ err, executionId }`); step-name read, map and label use **deleted** (W3-1); `executionDetails` trimmed. The route edits were applied back to back with no test or save-and-run in between (the Edit tool needs several calls; no intermediate state was ever run or shared).
- **Page:** `BOS_HIDDEN_DIMENSIONS`, `BOS_DRILL_ORDER`, `breakdownOptionsFor`, `bosDrillTarget` (non-exported, O-4); `handleRowClick` reroutes a hidden target in BOS scope; `handleScopeToggle` clears agent / execution / category filters and labels, resets a hidden `breakdownBy` to `provider`, and clears `selectedCall` and `executionDetails` in the same event; four category cards, the three table category columns (header, row, footer) and the Category / Agent / Execution chips and breadcrumbs render only in "All"; empty-state `colSpan` 9 / 6 (W3-7); `ContextChips` takes `scope`; six sections, the five owner-text type fields, `expandedSections` and `toggleSection` deleted. The four cards are wrapped in `{scope === 'all' && (<>…</>)}` **without re-indenting** them, to keep the diff readable; the grid and card classes are unchanged (C3-1, D-4). Test ids only, no visual change (O-10).
- **Register (T-10):** P6b inserted after P6a plus one Change History row; `git diff --numstat` = **13 insertions, 0 deletions**.

### Verification (T-7..T-9)

| Check | Result |
|---|---|
| New suites | 3 suites, **70 tests**, all green |
| Drill-down + analytics folders | 7 suites, 116 tests, green |
| `route.test.ts`, `wire.qa.test.ts` | `git diff --exit-code HEAD` clean (**unedited**) and green |
| Wide set `npx jest app/admin app/api/admin lib/admin lib/business-os/llm` | **117 suites, 3,110 tests, 23 snapshots, all green** (the prompt-snapshot fix from main is in the base) |
| ESLint, 2 code files + 3 tests | 0 errors; 7 warnings, **identical to the baseline** (unused `DollarSign`, `BarChart3`, `availableFilters`, `CREATION_/MEMORY_ACTIVITY_TYPES`, two `any`), none new |
| `npm run lint:hooks` | exit 0 |
| Scoped `tsc` (scratch tsconfig, `include: []`, `files` = 2 code files + 3 tests, 8 GB heap) | exit 2 on **both** trees. Baseline **30** errors (24 in `page.tsx`, 6 in `lib/analytics/aiAnalytics.ts`); after **25** (19 in `page.tsx`, the same 6). The 5 removed were in the deleted sections. The 19 remaining are the same pre-existing ones, shifted (3 `ContextChips` `{}` → `ReactNode`, 16 in the call-detail modal rendering `unknown` metadata). `route.ts` and the three test files: **0** on both. **No new error.** |
| Forbidden-name sweep (T-9, W3-9) | route 0 (incl. `workflow_step_executions` / `step_name`), page 0 |
| `console.*` | 0 in both code files and in the new tests |

**Deviation (T-8 baseline method):** a `git archive` export into the scratchpad could not resolve `react` types from outside the repo (`TS7016`, then cascading implicit-`any`), so that baseline was not comparable. The baseline was instead taken by writing the `19566036` versions of `page.tsx` and `route.ts` (`git show HEAD:<file>`) over the worktree copies, running the **identical** scratch tsconfig, then restoring both from scratchpad copies and `cmp`-checking them. No `git stash`, no commit.

### Follow-ups recorded

- **W3-2 (test tiering):** no CI workflow runs Jest, so `ownerText.guard.test.ts` bites only in local runs and at review. The test-tiering cycle should put it in the **first CI tier**. No workflow edit in this slice.
- Pre-existing, not touched: the 19 `tsc` errors in `page.tsx` and 7 ESLint warnings above; OI-9, NF-5 and the S3-9 remainder (section 9).

### Owed by others

- **T-11 (SA, at code review):** whole-select probes for `workflow_executions(agent_id, started_at, completed_at, status)` and `agents(id, agent_name, connected_plugins, mode, status)` on the code-complete tree. Dev has no database access.
- **T-13 (QA):** section 6 manual check. Section 7's live card values are optional and non-gating.

---

## SA Review Notes

### SA Workplan Review (2026-10-03)

**Reviewed by SA — 2026-10-03.** Ref `fix/admin-ai-cost-bos-lens` @ `19566036`. Checked against C3-1..C3-12, FYI-1..3, CLAUDE.md and the code on that ref (`route.ts`, `page.tsx`, both existing test files, `.github/workflows/*`, `package.json`, `lib/pilot/StateManager.ts`).
**Status: APPROVED WITH CONDITIONS (W3-1..W3-9).** Dev may implement once the conditions are folded into sections 2, 4, 5, 10 and 11. No re-review of the workplan is needed; SA checks the conditions at code review.

#### A. What was verified

| Claim in the workplan | Result |
|---|---|
| The C3-3 refinement runs before the execution short-circuit | ✅ `DrillDownQuerySchema.safeParse` is at `route.ts:193`, and every refinement runs inside that call. The short-circuit is at `:228`. `requireAdmin` stays the first statement (`:190`). A refused request makes no read. |
| `.superRefine` after the date `.refine` behaves | ✅ with one caveat (W3-6). In Zod 3.25 a failed *field* check aborts the object, so the refinement does not run and `rejectedForBosScope` is absent. That request still gets the same 400. A failed date refine only marks the result dirty, so the BOS refinement still runs. |
| Breadcrumbs never set `breakdownBy` | ✅ (`page.tsx:984-1120`) They only reset filters. So `handleRowClick`, the menu and the toggle are the only routes into a hidden view, and the workplan covers all three. |
| `removeFilter` / `clearAllFilters` cannot reach a hidden view | ✅ They change filters only. |
| Only one caller of the route; no deep link carries a refused parameter | ✅ (S3-10, and the workplan's own sweep) |
| `console.*` 0 / 0 | ✅ |
| The aggregate path reads no owner text | ✅ Its `agents` and `workflow_executions` label reads select `id, agent_name` and `id, agent_id, started_at, status` (`:519`, `:732`, `:744`, `:753`). |
| T-1's expected hits | Route ✅ (`:995`, `:1004`, `:1012-1016`, `:1147-1148`). Page: `git grep -c` gives **40 lines**, not 28. Record the real number. It does not matter, because T-9 must reach 0. |
| A CI job will run the new guard | ❌ **No workflow runs Jest** (`admin-authz-guard.yml:28`, `react-hooks-guard.yml:18`; `plugin-tests.yml` runs plugin suites only). See W3-2. |

#### B. Rulings on O-1..O-10

| # | Ruling |
|---|---|
| **O-1** | **Hide them in BOS scope.** The Creation, Execution and Memory columns belong to the same AgentsPilot taxonomy that C3-1 hides. In BOS scope they show "-" or $0.00 on every row, while the money sits in System, which has no column. That reads as "no execution cost", which is false. This is FR-AC1's intent, it stays in a file already in the diff, and it is not scope expansion. Hide the header (`:1142-1144`), row (`:1228-1236`) and footer (`:1261-1269`) cells under `scope === 'all'`. Also make the empty-state `colSpan={9}` (`:1154`) scope-aware (6 in BOS). Add the assertions to P-1 and P-2. Keep the activity-row category badge and the Call Details "BI Category" field. (W3-7) |
| O-2 | **Keep `grid-cols-5`, as ruled in C3-1.** A Total card stretched across the full row is a bigger visual change than one card with empty slots beside it. This is style only and does not block. |
| O-3 | **Agreed: a count slip.** Delete all six sections and remove `systemPrompt` from the type. |
| O-4 | **Keep the helpers inside `page.tsx`, non-exported.** Next 14 rejects unknown exports from a `page.tsx`, and §D keeps new non-test files out of the diff. P-3..P-6, as extended by W3-5, are enough proof. |
| O-5 | **Approved.** Moving both lines to `requestLogger` is logging only and inside C3-7 ("pass `requestLogger` into `getExecutionCalls`"). C3-8 freezes *behaviour* on the `single-` path, not its logger. Add `executionId` to the context of both lines. |
| **O-6** | **Owners:** **T-11 belongs to SA, at code review.** SA re-runs the §A whole-select probe for `workflow_executions(agent_id, started_at, completed_at, status)` and `agents(id, agent_name, connected_plugins, mode, status)` on the code-complete tree, and records the ref and result in this section. The step-read probe is no longer needed (W3-1). **T-13 (the TA-7 live values) is downgraded to optional and does not gate the merge.** C3-1 has no branch that depends on a measurement, NF-7 is already settled by code reading (S3-6), and the cards are hidden whatever the values are. The values only tell us how many legacy-tagged rows exist in BOS scope. After the merge they can still be read from `categoryTotals` in the Network tab. QA records them during the section 6 check if it is convenient; otherwise section 7 stays "not read" with no consequence. |
| **O-7** | **Not acceptable as built. C3-6 is amended: retire the step-name lookup instead of fixing its filter (W3-1).** `step_name` is the pilot step's `name` (`StateManager.ts:1122-1123`). The agent generator writes it from the owner's own instructions, so it can carry a client's name or address. That is exactly the "message text … client contact details" that the Privacy NFR (§8) keeps out of cross-account views. It has **never** been shown, because the filter column is a phantom. So fixing the filter would switch on a new cross-account text path, the same trap as S3-1 on a smaller scale. Rule 5 allows "retire". Cost analysis needs only the step id, which the existing fallback already formats ("Step 3"). Retiring the lookup also deletes one inline service-role read (OI-9 shrinks) and one discarded error. SA's own C3-6 ruling missed this; this ruling governs. |
| O-8 | **Agreed.** Refuse `agent=no-agent` (B-7 pins it). |
| O-9 | **Agreed.** Use the new `bosLens.route.test.ts`. The per-table mock must also stub `auth.admin.listUsers` (the A-* cases reach the label lookups), as the proxy in `route.test.ts` does. |
| O-10 | **Agreed.** Add `data-testid` attributes only. |

#### C. The rollback note and a structural guard

**The note is half wrong.** *Cherry-picking* only the `workflow_executions` select fix onto a tree without the cut would start sending prompts. That half is right. *Reverting* only that select is **safe**: it brings the phantom columns back, the read fails again, and the agent read never runs. The partial revert that is dangerous goes the other way: undoing the **cut** (the `agents` select, the `agentData` mapping or the `executionDetails` shape) while the executions fix stays. Rewrite section 10 and the PR body as W3-3 states.

**Structural protection.** The guard Dev already plans is the right one: G-1..G-3 forbid every prompt and payload column name anywhere in `route.ts`. Any partial revert that brings the cut back must re-add one of those names, so it fails the guard. E-2 pins the exact `agents` select, which also catches a later `select('*')`. The explicit `ExecutionAgentSummary` type stops the mapping from widening quietly. **The limit:** no CI job runs Jest, so these guards bite only when someone runs the suite (Dev, SA review, QA). Do **not** add the guard to the required `admin-authz-guard` job in this slice. C3-8 and §C say no guard moves, and the CI tiering work owns that. State the limit in the PR body, and record a follow-up for the test-tiering cycle to put `ownerText.guard.test.ts` in the first CI tier (W3-2).

#### D. Do E-1..E-10 prove that no owner text leaves the route?

For the **response body**, yes. E-4 serialises the real response while the mock returns every prompt and payload column with sentinels. So it tests the mapping and not the mock, and E-1/E-2 pin the selects themselves. Three gaps:

1. **Logs.** C3-7 says no prompt, payload or step text is logged, and nothing tests that. Add one assertion across E-4..E-9: `JSON.stringify` of every call on **both** the child and the module logger contains no `SECRET-` sentinel (W3-4).
2. **Step text.** After W3-1, E-3 becomes: `from('workflow_step_executions')` is never called, and the `step1` call row is labelled by the existing fallback (`activity_name` if the fixture sets it, else `Step 1`). G-4 becomes: `route.ts` contains neither `workflow_step_executions` nor `step_name` (W3-1).
3. **E-6 detail.** The 42703 error object passed as `err` must not be the response. Also assert that the body has no `details` or `message` field.

#### E. Do the page tests cover the BOS drill fix and the unchanged "All" behaviour?

Only partly. P-4 (Feature → Component), P-5 (User → Model) and P-6 ("All" Feature → Agent) leave the C3-12 path itself untested: Activity → ? in BOS. They also leave the "nothing left, stay" fallback untested. Add the cases in W3-5.

#### F. Conditions

1. **W3-1: Retire the step-name lookup (amends C3-6; O-7).** Delete the `workflow_step_executions` read, `stepNameMap` and its use in the label chain. The fallback chain is otherwise unchanged. Update 2.1(b), E-3, G-4 (as in §D), the 10 risk row (delete the "step names now appear" row), the PR body ("Step names on call rows now load" goes), and the phantom register's P6b. Record `workflow_step_executions.execution_id` there as "right idea, wrong column; **retired** at this site for privacy, never loaded". T-11 drops the step-read probe.
2. **W3-2: Say what the guard can and cannot do.** The PR body's Tests paragraph states that no CI job runs Jest, so the source guard is enforced at review and in local runs. Add a follow-up line under Implementation Notes for the test-tiering cycle (`ownerText.guard.test.ts` goes into the first CI tier). No workflow edit.
3. **W3-3: Correct the rollback text** in section 10 and the PR body. It should read: "Revert this PR as a whole. Never cherry-pick the `workflow_executions` column fix without the owner-text cut. Never revert the cut (the `agents` select, the agent mapping, the `executionDetails` shape) on its own. Reverting only the executions select is harmless (the read fails again), but there is no reason to."
4. **W3-4: Logs carry no owner text.** Add the logger-sentinel assertion to the E-4..E-9 cases. Add the no-`details`/`message` assertion to E-6. B-8 already does the same for refusals.
5. **W3-5: Drill-path cases.** Add to 5.4:
   - **BOS:** an Activity row goes to `feature`. Parametrise this over `activity`, `request_type` and `endpoint` rows.
   - **BOS fallback:** with `feature`, `component`, `user`, `model` and `provider` all filtered, a row click keeps the current `breakdownBy`, and no request carries `breakdownBy=agent`.
   - **"All":** an Activity row goes to `agent`, and an Agent row goes to `execution` (unchanged).
   - **Every page test:** across the whole run, no request URL has `scope=bos` together with `breakdownBy=agent|execution`, `agent=`, `execution=` or `category=`. A shared `afterEach` over the fetch-stub calls is enough.
   - **P-8:** the stub returns `executionDetails` only for requests that carry `execution=`. Otherwise the test proves the fetch, not C3-4.
6. **W3-6: Zod detail.** Use `ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message, params: { bosScope: true } })` with no `fatal`. B-1..B-8 use well-formed values (a real UUID shape, `single-<uuid>`), so each 400 comes from the BOS refinement and not from a field check. Add one assertion that the B-* bodies are the generic shape whatever the cause.
7. **W3-7: O-1, table category columns.** Hide them in BOS scope, with a scope-aware `colSpan`, as ruled in §B. Add P-1 and P-2 assertions (via `data-testid` on the three header cells).
8. **W3-8: T-11 and T-13 owners** as ruled in O-6. Change T-11 to "SA, at code review". Change T-13 to "optional, non-gating". Section 7's closing line says the same.
9. **W3-9: Housekeeping.** T-1 records the actual page hit count (40 lines on `19566036`). T-9's forbidden-name sweep adds `workflow_step_executions|step_name` for `route.ts`. The C3-9 source guard stays in its own new file, as planned.

#### G. For the user (business terms, non-blocking)

- **FYI-4: Step names stay hidden in the cost screen.** A run's individual steps will keep showing as "Step 1", "Step 2" and so on, not by the descriptive names the AI wrote for them. Those names are generated from the business owner's own instructions and can mention their clients. They have never been shown, because of a defect, and fixing the defect would have started showing them for every customer. *Default: they stay hidden. Say so if you want them shown.*
- **FYI-5: The table in Business OS mode loses the Creation, Execution and Memory columns**, for the same reason as the cards (FYI-3). They always read "-" there. They come back in "All" mode.

#### Approval
- [x] Workplan approved, **with conditions W3-1..W3-9**. Proceed to implementation. SA owns T-11 at code review.

### SA Code Review (2026-10-03)

**Code Review by SA — 2026-10-03.** Worktree `neuronforge-admin-cost`, branch `fix/admin-ai-cost-bos-lens` @ `19566036`, uncommitted tree. Read: `git diff` of `route.ts`, `page.tsx`, the phantom register and the requirement; the three new test files in full. Base comparisons made with `git show 19566036:<path>`; nothing in the worktree was overwritten, swapped or stashed.
**Status: ✅ Code Approved, with three doc-only fixes (CR-1..CR-3) before the PR is raised.** None blocks QA.

#### A. Claims verified (not taken on trust)

| Claim / condition | Result |
|---|---|
| C3-3 / W3-6: one `.superRefine` inside `DrillDownQuerySchema`, `custom` issues with `params.bosScope`, no `fatal` | ✅ `route.ts:79-90`. The parse is at `:215`, after `requireAdmin` (`:212`, still first) and before the execution short-circuit (`:257`). A refused request makes no read: B-1..B-7 assert `mockFrom` and `mockListRows` uncalled. |
| 400 log carries parameter **names** only | ✅ `bosRefusedParams` maps `path[0]` of flagged issues (`:93-97`); the warn adds `rejectedForBosScope` only (`:217-224`). B-8 asserts no id, agent id or `single-` in any log call. |
| C3-5: both selects narrowed, response trimmed, explicit type | ✅ `workflow_executions` `agent_id, started_at, completed_at, status`; `agents` `id, agent_name, connected_plugins, mode, status` into `ExecutionAgentSummary`; `executionDetails` has no `inputData`/`outputData`. `final_output` / `execution_results` not substituted. |
| W3-1: step-name lookup fully retired | ✅ No `workflow_step_executions` read, no map, no label use; `route.ts` has 0 hits for `workflow_step_executions` and `step_name` (base: 3 and 3). Call items carry ledger fields only (`activity_name`, `activity_step`, `workflow_step`, etc.), unchanged (C3-8). |
| No owner text leaves through logs | ✅ Every log line in `getExecutionCalls` logs `{ err, executionId }` or `{ executionId }` only; the entry `info` logs `hasExecution` (boolean). No row object is ever logged. |
| C3-7 / O-5: `requestLogger`, bound errors, PGRST116 at `info`, 200 kept, 500 kept | ✅ All four log lines in the function use `requestLogger`. Ledger failure still returns the bare 500 body. |
| C3-1 / C3-2 / W3-7 page lens | ✅ Four category cards, three table columns (header, row, footer), Category/Agent/Execution chips and breadcrumbs, and the `ContextChips` agent/execution chips all gated on `scope === 'all'`; `colSpan` 9 / 6; grid and card classes unchanged. Menu reads `breakdownOptionsFor(scope)`; drill path and toggle read the same `BOS_HIDDEN_DIMENSIONS`. |
| Drill order and stay-put | ✅ `bosDrillTarget(newFilters, breakdownBy)` picks the first of feature, component, user, model, provider not filtered and not the clicked dimension, else stays (`page.tsx:443-446`). Breadcrumbs only reset filters; the Agent breadcrumb (the only one that sets `agent`) is gated on "All". |
| C3-4 toggle clears in the same event | ✅ `handleScopeToggle` (`page.tsx:459-476`) sets scope and, in the same handler, strips `agent`/`execution`/`category` from filters and labels, resets a hidden group-by to `provider`, clears `selectedCall` and `executionDetails`. Scope is set nowhere else (initial state only). |
| C3-5 page deletions | ✅ Six sections, the owner-text type fields, `expandedSections`, `toggleSection` gone; no `JSON.stringify` remains in the page; the remaining panel renders name, mode, status, timing, agent id and plugins only. |
| Deviation 1 (temporary overwrites) | ✅ `page.tsx` and `route.ts` are the intended versions: the diff is coherent hunk by hunk, contains only the planned changes, and has no scratch, marker or conflict text. Only artefact: `page.tsx` now has LF endings in the working copy (`git ls-files --eol`: `w/lf`, its siblings `w/crlf`). The index is LF, so this has no effect on the commit or the diff (CR-4, informational). |
| Other three deviations | ✅ Accepted: T-4's route edits landing in several tool calls (only the final state was run or shared); cards not re-indented (readability); the T-2 "ids-only old page" run is a sound way to prove the page tests fail on behaviour. |
| Tests | ✅ 7 suites / 116 tests green (run read-only by SA). `route.test.ts`, `wire.qa.test.ts`, `scope.render.test.tsx`, `linkedWindow.render.test.tsx` byte-identical to `19566036`. |
| Guard is meaningful | ✅ Every name it forbids is present on `19566036` (route: 2 hits each for the seven column names, 3 each for the step-read names; page: 1 to 9 hits each) and 0 now. A sanity test proves it read the real files. |
| W3-4 log-marker checks are real | ✅ `expectNoMarkerInLogs` scans every call on **both** the request (child) logger and the module logger, which the mock keeps distinct. The seeded `workflow_executions` and `agents` rows carry `SECRET-` markers in E-4..E-8, so logging either row object would fail. (The E-6 / E-8 error objects carry no marker, so those two cases do not test error-content logging; error objects from PostgREST carry no row text, so this is acceptable.) |
| W3-5 page cases | ✅ P-10 (activity, request_type, endpoint → feature), P-11 stay-put, P-12 "All" unchanged, P-8 stub returns detail only for `execution=`, and the shared `afterEach` over every fetch call (P-13). A toggle that cleared state in a later effect would send one `scope=bos&breakdownBy=agent` request and fail that `afterEach`. |
| Scoped `tsc` (C3-10) | ✅ Re-run by SA on the current tree (scratch tsconfig, 8 GB heap): exit 2, **25** errors = 19 `page.tsx` + 6 `lib/analytics/aiAnalytics.ts`, matching the Dev's figure. All 19 are the pre-existing `{}`/`unknown` → `ReactNode` patterns; none refers to a deleted field. `route.ts` and the three tests: 0. |
| ESLint, `console.*` | ✅ 0 errors, the same 7 pre-existing warnings; `console.*` 0 / 0. |
| Phantom register (C3-11) | ✅ P6b is accurate: three columns, ref `19566036`, Rule 5 shapes, each marked **Retired**, the step filter as "right idea, wrong column; never loaded", retired for privacy per W3-1. Anchor link resolves. Insert-only (13 / 0). |
| Requirement doc in the diff | ℹ️ `ADMIN_BOS_CLEANUP_REQUIREMENT.md` (+151 / −1) is SA's own slice 3 requirement review, not a Dev change. It belongs in this PR. Section 3's "explicitly not touched" means "not touched by Dev". |

#### B. T-11 schema re-check (C3-10), SA

Live database, service role, `select(<cols>).limit(0)`, zero rows, no writes, no DDL. Ref: worktree `fix/admin-ai-cost-bos-lens` @ `19566036` + uncommitted slice 3 tree, 2026-10-03.

| Select (exactly as in the new `route.ts`) | Result |
|---|---|
| `workflow_executions`: `agent_id, started_at, completed_at, status` | ✅ HTTP 200, no error |
| `agents`: `id, agent_name, connected_plugins, mode, status` | ✅ HTTP 200, no error |
| Negative control: the old shape plus `input_data, output_data` | ❌ 400, `42703 column workflow_executions.input_data does not exist` (proves the probe can fail) |

The step-read probe is not needed (W3-1).

#### C. Code Review Comments

1. **CR-1** `ADMIN_BOS_CLEANUP_SLICE_3_WORKPLAN.md` §6 step 2 — "Call rows show step names where the run recorded them" contradicts W3-1. After this slice call rows never show step names; they show the ledger label or "Step N". QA is running §6 now, so this line must be read as: *call rows show "Step N" or ledger labels, never descriptive step names.* — Priority: **Medium** (doc, misleads QA)
2. **CR-2** §11 PR body, Tests paragraph — "serialised response and every log line free of all seven keys and of planted marker text". The logs are checked for the planted markers, not for the seven keys. Reword to "serialised response free of all seven keys and of planted marker text; every log line free of the markers". — Priority: Low
3. **CR-3** §3 Files table, `route.ts` row — still lists "C3-6 filter"; it is the W3-1 retirement. — Priority: Low
4. **CR-4** `app/admin/analytics/page.tsx` — LF working-copy endings left by the Deviation 1 swap. No effect on the commit. No action needed; RM should not be surprised by the CRLF warning. — Priority: Low (informational)

#### D. Optimisation Suggestions

- Process, for the retrospective: the two temporary overwrites (T-2 ids-only page, T-8 baseline) were restored and `cmp`-checked, but they would have been unsafe with QA in the same worktree. Next time take the `tsc` baseline from a scratch tsconfig whose `files` point at `git show` copies in the scratchpad and whose `typeRoots`/`baseUrl` point back at the repo (this worked for SA's run), and keep the "old page with ids" in the scratchpad under a jest `--rootDir` override or a throwaway worktree.
- `handleScopeToggle` derives `next` from the closure `scope`; a functional update is not needed for a click handler. No change.

#### Code Approved for QA: **Yes**

CR-1 should reach QA now. CR-1..CR-3 are doc edits for the Dev before the PR is raised; they do not need SA re-review.

---

## QA Testing Report

### QA Report (2026-10-03)

**Test mode:** full
**Strategy used:** A + B (Jest unit and route integration with a per-table recording Supabase mock), plus static checks. D (manual browser check) is **owed by the user**: QA cannot sign in. The checklist is below.
**Focus:** api, ui, security (privacy), schema
**Skipped:** live browser check (no session; handed to the user). No database access (T-11 was SA's, and it is done: SA §B above).
**Input source:** prompt keywords (coordinator brief) + workplan section 5 + SA CR-1.
**Tree:** worktree `neuronforge-admin-cost`, `fix/admin-ai-cost-bos-lens` @ `19566036` + uncommitted slice 3. No stash, no swap, no in-place overwrite. Edge-case probes ran from the scratchpad under an extra Jest `--roots`.

**Verdict: PASS WITH NOTES.** No bug blocks the commit. There is one Low edge case (a stale-response race, E-QA-1) and the CR-1 doc fix, which is already owned by the main session. The browser check (C3-12 / T-13) is owed by the user.

#### Test runs (independent re-run by QA)

| Set | Result |
|---|---|
| 3 new suites (`bosLens.route`, `ownerText.guard`, `bosLens.render`) | **3 suites, 70 tests, all pass** |
| `route.test.ts` + `wire.qa.test.ts` | **2 suites, 24 tests, pass.** `git diff --exit-code HEAD` on both = 0: **unedited** |
| `adminGate.writes` | **1 suite, 288 tests, pass** |
| Wide set `app/admin app/api/admin lib/admin lib/business-os/llm` (before QA's additions) | **117 suites, 3,110 tests, 23 snapshots, all pass** (matches Dev) |
| Both slice folders, incl. QA's 2 new files | **9 suites, 125 tests, pass** |
| QA's 2 new files | **2 suites, 9 tests, pass**; ESLint 0 findings; `console.*` 0 |
| Scoped `tsc` (2 code files + QA's 2 tests, scratch tsconfig, 8 GB) | exit 2, **25** errors = 19 `page.tsx` `TS2322` + 6 `lib/analytics/aiAnalytics.ts`. Same pre-existing set as Dev and SA. **0** in `route.ts` and in QA's tests |
| ESLint `page.tsx` + `route.ts` | 0 errors, the same 7 pre-existing warnings |
| Forbidden-name sweep | route 0 (incl. `workflow_step_executions`/`step_name`); page 0 (incl. `expandedSections`/`toggleSection`); `console.*` 0 / 0 |
| Diff scope | Only section 3's files + SA's requirement review + tests. Phantom register is insert-only (13 / 0) |

#### Tests added by QA (real gaps only; both pass on the current tree, as regression locks)

- `app/api/admin/token-usage/drill-down/__tests__/bosLens.qa.route.test.ts` (8 tests):
  - **Q-1:** an "All" execution whose run record has `agent_id: null` returns 200 with timing, status and `agent: null`. `agents` is never read, and nothing is logged at error.
  - **Q-2:** an execution id with no ledger rows and no run record (`PGRST116`) returns an empty 200 and no error log.
  - **Q-3 (×6):** malformed Business OS values (`execution=not-a-uuid`, `execution=single-<junk>`, `category=<junk>`, `breakdownBy=<junk>`, `agent=<junk>`, `scope=BOS`). Each gets the byte-generic 400, makes no read of any kind, and the planted value appears in no log line.
- `app/admin/analytics/__tests__/bosLens.qa.render.test.tsx` (1 test):
  - **C-1:** Memory card selected in "All" ("Category: Memory" chip shown), then switch to Business OS. The first BOS request carries no `category`, the chip is gone, and there is no error banner. Switching back to "All" restores nothing.
  - It carries the same whole-run `afterEach` invariant as P-13. C3-4's category branch was not exercised by any existing test.

#### Edge-case probes (coordinator list)

| Probe | Evidence | Result |
|---|---|---|
| "All" execution with no agent | QA Q-1 (route). Page: the panel renders only `executionDetails?.agent &&` (S3-7, accepted) | ✅ Pass. Timing and status are in the response, but no panel shows, as SA accepted |
| Execution id that does not exist | QA Q-2; E-7 covers `PGRST116` with rows present | ✅ Pass |
| BOS + `user=` (allowed) | `route.test.ts:201` (`scope=bos&user=…`, 200); P-11 and `linkedWindow.render.test.tsx:134` (page deep link); scratch probe Q-6 | ✅ Pass |
| Switch from "All" with an execution detail open | P-8 (panel gone, no `execution=` sent). Scratch race probe R-1: see **E-QA-1** | ✅ Pass, with one Low edge case |
| Stay-put fallback, every dimension filtered | P-11 (deep-link `user` + drills; next request keeps `breakdownBy=component`, never `agent`) | ✅ Pass. Note: in stay-put a row click re-requests the same view with the filter set, a harmless no-op |
| Page never sends a refused BOS request | P-13 shared `afterEach` checks every fetch in `bosLens.render` (16 tests); the same invariant is in QA's C-1 | ✅ Pass. Limit: it checks what was *sent*, not stale responses (E-QA-1) |
| Malformed values in BOS refusals | B-9 (`agent=abc`), QA Q-3 (6 cases), scratch Q-3b. When the date refine fails *and* a BOS param is present, the refinement still runs and names it (`{"issues":2,"rejectedForBosScope":["agent"]}`) | ✅ Pass |
| Planted owner text absent from body, logs and page | Body: E-4 (keys + `SECRET-` markers, mock returns the columns). Logs: E-4..E-9 + B-8 (both loggers), QA Q-3. Page: P-9 (stub sends every owner-text key; none renders). Source: G-1..G-4 | ✅ Pass |
| Duplicate `scope` keys (info) | Scratch Q-5: `?scope=all&scope=bos&agent=<uuid>` → 400; `?scope=bos&scope=all&agent=<uuid>` → 200 (last wins) | ℹ️ Consistent with S3-2: TA-6 is a consistency rule, and "All" returns the same data anyway. No action |

### Test Coverage

| Acceptance criterion / condition | Tested? | Result | Evidence |
|---|---|---|---|
| §9: BOS has no Creation, Execution or Memory card (and no System, C3-1) | ✅ | Pass | P-1, P-2 |
| §9: BOS has no Agent or Execution group-by | ✅ | Pass | P-1 (8 shown, 2 absent), P-2 (10 in "All") |
| §9: BOS has no execution detail | ✅ | Pass (see E-QA-1) | P-8, B-3/B-4, P-13; QA C-1 |
| §9: a URL cannot bring them back (FR-AC4, TA-6) | ✅ | Pass | B-1..B-9, QA Q-3; S3-2 (page reads only `scope`/`user`/window from its URL) |
| §9: "All" unchanged (both ways) | ✅ | Pass | A-1..A-7, P-2, P-6, P-12, `route.test.ts` + `wire.qa.test.ts` unedited and green |
| §9: "All" execution detail shows status and timing; schema-check confirmed | ✅ | Pass (unit); live **owed** (browser) | E-1, E-5, P-9, QA Q-1; SA T-11 live probe ✅ (SA §B) |
| FR-AC1 / W3-7 table columns, `colSpan` 6/9 | ✅ | Pass | P-1, P-2 |
| FR-AC2 chips, breadcrumbs, `ContextChips`, drill path | ✅ | Pass | P-4, P-5, P-7, P-10, P-11 |
| FR-AC3 / C3-4 switch clears agent, execution, category, group-by, panel | ✅ | Pass | P-3, P-8, **QA C-1 (category)** |
| FR-AC5 / NF-3 / TA-8 select cut + response trim | ✅ | Pass | E-1, E-2, E-4, E-5, G-1..G-3, P-9 |
| W3-1 step names retired (CR-1: rows show ledger label or "Step N") | ✅ | Pass | E-3 (`Step 1`, the step table is never read), E-10, G-4 |
| FR-AC6 / C3-7 logging on `requestLogger`; `PGRST116` not error; 200 kept; 500 kept | ✅ | Pass | E-6..E-9, QA Q-2 |
| §8 Privacy: no owner text in body or logs | ✅ | Pass | E-4, E-11, B-8, QA Q-3, P-9 |
| C3-10 scoped `tsc` | ✅ | No new errors | 25 = the pre-existing set |
| C3-11 phantom register | ✅ | Pass | P6b present, insert-only |
| C3-12 / T-13 manual check as platform admin | ⚠️ | **Owed by user** | Checklist below |
| All slices: happy path + failure path | ✅ | Pass | E-5 / A-* (happy), E-6..E-9, B-* (failure) |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The execution path now makes one fewer read: the step-name lookup is gone.

#### Edge Cases (nice to fix)

1. **E-QA-1: A stale "All" response can repaint the execution view after the switch to Business OS.** File: `app/admin/analytics/page.tsx:288-367` (`fetchData` has no abort or sequence guard) and `:1358` (`executionDetails?.agent &&`, not scope-gated). Severity: **Low**.
   - Steps to reproduce: in "All", open an execution whose response is slow, then click "Business OS only" before it returns.
   - Expected: the Business OS view shows no execution detail (FR-AC2).
   - Actual (scratch probe R-1, held fetch): the toggle reads Business OS (`aria-checked=true`), but once the held response resolves, the agent panel ("Agent One") and two "Step 1" call rows render, and they stay until the next fetch.
   - Impact: display only. The content is metadata after the cut, the viewer is a platform admin, the same data is available in "All", and no refused request is ever sent (P-13 holds). This is the page's pre-existing out-of-order-response pattern (any fast filter change can show it). The slice makes it visible because BOS is now meant to have no execution view.
   - Smallest fix, if wanted: gate the panel on `scope === 'all' && executionDetails?.agent`, which is defence in depth and one line. The general fix is to drop responses whose request is no longer current, via an `AbortController` or a request-id ref.
2. **Doc, CR-1 (SA, already routed):** §6 step 2 still says call rows show step names. QA tested and wrote the checklist against W3-1: call rows show the ledger label or "Step N", never a descriptive step name. The main session owns the fix; QA did not edit §6.

### Test Outputs / Logs

```text
bosLens.route + ownerText.guard + bosLens.render   Test Suites: 3 passed  Tests: 70 passed
route.test + wire.qa (unedited, git diff exit 0)     Test Suites: 2 passed  Tests: 24 passed
adminGate.writes                                     Test Suites: 1 passed  Tests: 288 passed
app/admin app/api/admin lib/admin lib/business-os/llm  Test Suites: 117 passed  Tests: 3110 passed  Snapshots: 23 passed
both slice folders incl. QA files                    Test Suites: 9 passed  Tests: 125 passed
scratch R-1: scope-toggle aria-checked= true  agent panel rendered= true  stale call rows= 2
scratch Q-3b warn arg: {"issues":2,"rejectedForBosScope":["agent"]}
```

### Browser checklist (for the user, as a platform admin, on `npm run dev`, desktop)

Open `/admin/analytics`, with DevTools open on the **Network** tab, filtered to `drill-down`.

1. **Business OS (default).**
   - The top row shows **only "Total Spend"**.
   - The table has **no** Creation, Execution or Memory column.
   - Group By lists 8 items, with **no Agent or Execution**.
   - No "N agents" / "N executions" chips appear under row names.
2. **BOS drill path.** Click a Provider row (→ Model) → a Model row (→ Activity Type) → an Activity row.
   - It must land on **Feature**, never Agent. Then a Feature row → Component, and a Component row → User.
   - There is no error banner at any step.
   - In Network, **no** request has `scope=bos` with `breakdownBy=agent`, `breakdownBy=execution`, `agent=`, `execution=` or `category=`.
3. **"All" scope.** Click the toggle to "All".
   - All five cards and all ten group-bys come back, and the three table columns return.
   - Click the **Memory** card: a "Category: Memory" chip appears. Clear it again.
4. **"All" execution detail.** Group By **Execution** (or Agent → an agent) → click an execution row that belongs to an agent. An agent panel appears. Click **Show details**.
   - **Started**, **Completed** and **Status** show real values. These are new: they never loaded before.
   - Connected Plugins shows if the agent has any.
   - There is **no** Pilot Steps, Input Schema, Output Schema, Execution Input, Execution Output or User Prompt section.
   - Call rows are labelled by the ledger label or **"Step N"**, **never** a descriptive step name (W3-1 / CR-1).
5. **Network check of that response.** Click the `drill-down?…execution=…` request, then Response (or Preview).
   - Search (Ctrl+F) for each of `userPrompt`, `systemPrompt`, `pilotSteps`, `inputSchema`, `outputSchema`, `inputData`, `outputData`, `user_prompt`, `input_data`: **none is present**.
   - `executionDetails` has exactly `executionId`, `startedAt`, `completedAt`, `status` and `agent`.
   - `agent` has exactly `id`, `name`, `connectedPlugins`, `mode` and `status`.
6. **Switching with state open.** Still in "All", with an execution open (or Agent selected, or the Memory card selected), click the toggle to Business OS.
   - There is no error banner, and Group By is **Provider**.
   - The agent panel and the Category chip are gone.
   - The new request has `scope=bos` and no `agent`/`execution`/`category`.
   - Switch back to "All": nothing is restored.
7. **Hand-edited API call.** In the address bar, open `/api/admin/token-usage/drill-down?scope=bos&breakdownBy=agent`.
   - It returns **400** `{"success":false,"error":"Invalid query parameters"}`.
   - The same with `scope=all` returns 200.
8. **Optional (T-13, non-gating):** in Business OS scope, read the four category values from the `categoryTotals` of a 30d and a 90d response in Network, for section 7.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **PASS WITH NOTES.** No bug blocks the commit and no High issue is open. Before commit: the user runs the browser checklist (C3-12 / T-13), and the main session applies the CR-1..CR-3 doc fixes. E-QA-1 is Low and optional (a one-line panel gate if wanted).

---

## Commit Info

*RM populates this section.*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-03 | Created | Dev workplan for slice 3 on `fix/admin-ai-cost-bos-lens` @ `19566036`, carrying SA conditions C3-1..C3-12 and the user's FYI-1..3 defaults. One PR. Ten open points for SA; O-1 (table category columns) and O-6 (schema re-check and live card values need DB/browser access) are the ones that need a ruling or an owner. |
| 2026-10-03 | SA workplan review | **APPROVED WITH CONDITIONS (W3-1..W3-9).** O-7 overturned: the step-name lookup is retired rather than fixed (C3-6 amended; step names are owner-derived text that never loaded). O-1: the table's category columns hide in BOS scope too. The rollback note is corrected: a partial revert of the cut is the danger, and reverting only the executions select is harmless. No CI job runs Jest, so the source guard is enforced at review (follow-up for test tiering). Log-sentinel and drill-path tests added. T-11 owned by SA at code review; T-13 is optional and does not gate the merge. |
| 2026-10-03 | Conditions folded; code complete | Dev folded W3-1..W3-9 into sections 2, 4, 5, 10 and 11, then implemented (uncommitted). 70 new tests (route 37, guard 17, page 16), each behaviour test seen failing on the old code first; wide set 117 suites / 3,110 tests green; ESLint and `tsc` no new findings; `lint:hooks` clean; phantom register P6b added (insert-only). T-11 owed by SA, T-13 by QA. |
| 2026-10-03 | SA code review | **Code approved for QA.** All C3 / W3 conditions and the Dev's claims verified independently (116 tests green, scoped `tsc` 25 = same pre-existing errors, guard names present on base and absent now, log-marker checks scan both loggers). T-11 done: both new selects succeed live (zero-row, read-only), negative control fails as expected. Doc fixes before the PR: CR-1 (§6 step 2 still promises step names, contradicts W3-1; Medium, tell QA), CR-2 (PR body log wording), CR-3 (§3 route row). CR-4: `page.tsx` LF endings from the Deviation 1 swap, informational. |
| 2026-10-03 | QA | **PASS WITH NOTES.** Independent re-run: new suites 3 / 70, `route.test` + `wire.qa` 2 / 24 (unedited), `adminGate.writes` 288, wide set 117 suites / 3,110 tests, all green; `tsc` and ESLint have no new findings. QA added 2 small test files (9 tests: no-agent execution, missing execution id, malformed BOS values never logged, Category cleared on switch). No bugs. One Low edge case (E-QA-1: a stale "All" response can repaint the execution view after the switch to BOS; display only, metadata only). Browser checklist written against W3-1 / CR-1; the user owes the C3-12 check. |
