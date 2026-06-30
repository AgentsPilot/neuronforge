# Calibration Data-Source Resolver Framework — Workplan (Option A)

> **Last Updated**: 2026-06-30
> **Status**: ⬜ Planning — design drafted, **no code written yet**. Awaiting SA review + sign-off on the open questions (§ 6) before implementation.
> **Origin**: RCA on agent `3fc703fd` (Sheets `range="Sheet1"` → "Unable to parse range"). See `docs/Calibration/CALIBRATION_RCA_RUNBOOK.md` and the handoff `docs/investigations/AGENT_CREATION_RCA_HANDOFF_sheets-range.md`.
> **Skills**: load `calibration` (architecture) before implementing; `calibration-rca` for the failing-agent context.

## Overview

Calibration today **detects** parameter errors it cannot **fix**, because the correct value isn't knowable from the agent blueprint alone — it requires querying the **live data source**. Example: `google-sheets.read_range` was generated with `range="Sheet1"`, the spreadsheet's first tab isn't named "Sheet1", the API returns *"Unable to parse range: Sheet1"*, and calibration surfaces a high-confidence (0.95) `parameter_error` with a `suggestedFix` — but `autoRepairAvailable: false`. It can flag, it can't correct.

**Option A** adds a generic **resolver framework**: when calibration hits a parameter error that has a registered *resolver*, it asks that resolver to look up the correct value from the live source (e.g. read the spreadsheet's real tab names), then **auto-applies** it when confident or **asks the user** when ambiguous. The framework is plugin-agnostic; each app contributes a small, opt-in resolver only where needed. First (and only initial) resolver: Google Sheets range.

This is a **calibration-side mitigation**. The durable fix for *this* class is upstream in generation (the parallel agent-creation RCA). The two are complementary: generation stops creating the bug; the resolver catches & fixes it if it still slips through.

## Table of Contents

- [Goals & non-goals](#1-goals--non-goals)
- [Architecture](#2-architecture)
- [The resolver contract](#3-the-resolver-contract)
- [The Google Sheets resolver (first tenant)](#4-the-google-sheets-resolver-first-tenant)
- [Auto-apply vs ask policy + where the fix lands](#5-auto-apply-vs-ask-policy--where-the-fix-lands)
- [Open questions for SA sign-off](#6-open-questions-for-sa-sign-off)
- [Action tracklist](#7-action-tracklist)
- [Test plan](#8-test-plan)
- [Risks](#9-risks)
- [Change History](#change-history)

---

## 1. Goals & non-goals

**Goals**
- A **generic, reusable engine** in calibration that turns a detected parameter error into an auto-applied fix *when* a resolver can look up the right value.
- A **plugin-agnostic** design: zero app-specific logic in the engine; all app specifics live in opt-in per-app resolvers.
- The **Google Sheets range** resolver as the first tenant (the proven real case).
- Auto-apply high-confidence fixes (persist + re-validate); surface ambiguous ones as a user choice.

**Non-goals**
- ❌ Building resolvers for apps/params we don't yet have a real failure for (grow on demand).
- ❌ Replacing the upstream generation fix (the resolver mitigates; generation root-causes).
- ❌ Changing the detection layers' *detection* behavior — only adding a *repair* path for already-detected parameter errors.
- ❌ Re-deriving values heuristically without consulting the live source (that's guessing — the whole point is to *look it up*).

## 2. Architecture

Two cleanly separated parts:

```
        Calibration batch route (existing)
                  │  dry-run detects a parameter_error issue
                  ▼
   ┌─────────────────────────────────────────────┐
   │  RESOLVER ENGINE  (generic — written once)   │   lib/pilot/shadow/ParameterResolverEngine.ts
   │  • for each parameter_error issue:           │
   │    – look up a resolver by plugin/action/param│
   │    – if found, call resolver.resolve(ctx)    │
   │    – resolved + confident → apply + persist  │
   │    – ambiguous → surface a "pick one" proposal│
   │    – none/unresolved → leave issue as-is     │
   └─────────────────────────────────────────────┘
                  │ asks ▼
   ┌─────────────────────────────────────────────┐
   │  RESOLVER REGISTRY  (generic lookup)          │   lib/pilot/shadow/parameterResolvers/index.ts
   │  key: `${plugin}.${action}.${parameter}`      │
   └─────────────────────────────────────────────┘
                  │ contains ▼
   ┌─────────────────────────────────────────────┐
   │  GoogleSheetsRangeResolver  (app-specific)    │   lib/pilot/shadow/parameterResolvers/googleSheetsRange.ts
   │  • reads spreadsheet metadata (live)          │
   │  • maps a bad range → the real tab            │
   └─────────────────────────────────────────────┘
```

- **Engine**: contains the *process* and the auto/ask policy. **No app-specific code.** Lives in `lib/pilot/shadow/` (the calibration toolbox).
- **Registry**: a simple map from `plugin.action.parameter` → resolver. The engine looks up generically.
- **Resolver**: the only place with app-specific logic. The Sheets one calls the Sheets API to list tabs. It reuses the existing plugin auth (the connected account), so it lives near/with the plugin layer.

**Where the engine hooks in (existing flow):** the Layer-3 dry-run already produces `parameter_error` issues (e.g. via the executor → `mapPluginSpecificError` → calibration's parameter detector). The engine runs **after** the dry-run surfaces the issue and **inside the calibration loop**, so an applied fix is re-validated by the next iteration (same mechanism P3/structural fixes already use). Exact insertion point: the batch route's issue-processing, alongside the existing auto-fix application (`app/api/v2/calibrate/batch/route.ts`).

## 3. The resolver contract

Draft types (final shapes during implementation):

```ts
interface ResolverContext {
  currentValue: unknown;                 // the value that failed, e.g. "Sheet1"
  resolvedInputs: Record<string, any>;   // all input values (spreadsheet_id, etc.)
  stepParams: Record<string, any>;       // the failing step's params
  stepId: string;
  userId: string;                        // for plugin auth (reuse connected account)
  rawError: string;                      // "Unable to parse range: Sheet1"
}

type ResolverResult =
  | { status: 'resolved';   value: unknown; confidence: number; reason: string }
  | { status: 'ambiguous';  candidates: { value: unknown; label: string }[]; confidence: number; reason: string }
  | { status: 'unresolved'; reason: string };

interface ParameterResolver {
  plugin: string; action: string; parameter: string;   // registry key
  /** Only attempt when this returns true (e.g. error matches /Unable to parse range/). */
  appliesTo(ctx: ResolverContext): boolean;
  resolve(ctx: ResolverContext): Promise<ResolverResult>;
}
```

The engine is the only caller; resolvers never touch the DSL or the DB directly (the engine owns applying + persisting).

## 4. The Google Sheets resolver (first tenant)

- **Key**: `google-sheets.read_range.range` (also consider `table/get`).
- **appliesTo**: `rawError` matches `/Unable to parse range/i`.
- **resolve**:
  1. Read spreadsheet metadata (`spreadsheets.get`, fields `sheets.properties(title,sheetId,index)`) for `resolvedInputs.spreadsheet_id`, using the user's connected Google account.
  2. List the real tabs `[{title, sheetId, index}]`.
  3. Map to a corrected `range`:
     - **1 tab** → use its `title` → `status: 'resolved'`, confidence **0.95**.
     - **Current value looks like a bare sheet name** (no `!`) and one title is a clear match (case-insensitive / close) → that title, confidence **0.9**.
     - **Multiple tabs, no clear match** → `status: 'ambiguous'` with `candidates` = each title (default-highlight `index 0`, since the original intent was `gid=0`/first tab). Let the user pick.
  - Corrected value = the tab **title** (read_range treats a bare sheet name as "whole sheet"). *(Alt to evaluate: a sheet-name-less range that targets the first tab — decide in § 6.)*

> Note: the saved agent lost the original `gid=0` (a generation bug), so the resolver can't read the gid from the blueprint. "First tab" is the safe default for the ambiguous case because `gid=0` = first tab.

## 5. Auto-apply vs ask policy + where the fix lands

- **`resolved` + confidence ≥ 0.9** → **auto-apply**, persist, count as an auto-fix, let the loop re-validate (mirrors P3). Log clearly.
- **`ambiguous`** → **surface a user-choice proposal** (the candidates) via the wizard — never silently pick. `userFacing` gets a translator for this.
- **`unresolved` / no resolver** → leave the existing `parameter_error` issue exactly as today.

**Where the corrected value is written (important nuance):**
- If the failing param is `{{input.X}}` (this case — `range = {{input.sheet_range}}`) → the fix updates the **input value/config** (`agent_configurations` + the in-memory inputs for re-validation), not the DSL. The engine must detect the `{{input.X}}` indirection and target the input.
- If the failing param is a **literal** in the step → rewrite the step param (like P3).

This input-vs-DSL distinction is a first-class engine responsibility (see § 6).

## 6. Open questions for SA sign-off

1. **Registration mechanism** — a static registry module the engine imports (simplest) vs. resolvers exposed on plugin executors vs. a flag in the plugin JSON definition pointing at a resolver. Recommendation: **static registry** keyed by `plugin.action.parameter`; resolvers co-located under `lib/pilot/shadow/parameterResolvers/`.
2. **Corrected range format** — use the resolved **tab title** as the range, or a **sheet-name-less** range that always targets the first tab? (Title is more faithful to multi-tab sheets; sheet-name-less is simpler but only correct for first-tab intent.)
3. **Input-config vs DSL fix mechanics** — confirm the path to update a saved input value (`agent_configurations`) and feed it into the loop's re-validation. Reuse existing config-save? New helper?
4. **Auto-apply confidence threshold** — 0.9? Align with P3's 0.9.
5. **Trigger timing** — react to the dry-run's `parameter_error` and re-validate in the next loop iteration (recommended), vs. a dedicated targeted re-run. Confirm no convergence/checkpoint conflicts.
6. **Live-call budget/safety** — the resolver makes a real API call during calibration. Cap attempts (1 per param), handle resolver failure non-blockingly (fall back to surfacing the original issue).
7. **Scope of the Sheets resolver** — `read_range` only, or also `table/get` and other range-taking Sheets actions?

## 7. Action tracklist

> Checkboxes are the living status. Update as work lands. Do **not** start Phase 1 until § 6 is signed off.

**Phase 0 — Design sign-off**
- [ ] SA reviews this workplan; resolve the § 6 open questions.
- [ ] Decide branch (own feature branch vs. continue on `agent-failure-troubleshooting`).

**Phase 1 — Generic engine + registry (no app specifics)**
- [ ] Define `ParameterResolver` / `ResolverContext` / `ResolverResult` types.
- [ ] Build `ParameterResolverRegistry` (lookup by `plugin.action.parameter`).
- [ ] Build `ParameterResolverEngine`: iterate `parameter_error` issues → lookup → `appliesTo` → `resolve` → apply/surface/skip. Non-blocking try/catch per resolver.
- [ ] Implement **apply** for both targets: input-config value AND DSL literal. Persist; count as auto-fix.
- [ ] Implement **surface** (ambiguous) → `CollectedIssue` shaped for `IssueGrouper` (id/category/affectedSteps) + a `userFacing` translator.
- [ ] Hook the engine into `app/api/v2/calibrate/batch/route.ts` (alongside existing auto-fix application).
- [ ] Unit tests for the engine with a **mock resolver** (resolved/ambiguous/unresolved; input-target vs DSL-target).

**Phase 2 — Google Sheets range resolver**
- [ ] Implement `googleSheetsRange` resolver (`appliesTo` on the parse-range error; `resolve` reads spreadsheet metadata via the connected account).
- [ ] Confidence heuristic (single tab / clear match / ambiguous-with-candidates).
- [ ] Register it for `google-sheets.read_range.range` (+ decide `table/get`).
- [ ] Unit tests with **mocked Sheets metadata** (1 tab → auto; multi-tab → ambiguous; no match → candidates).

**Phase 3 — Verify**
- [ ] `npx tsc --noEmit` clean on touched files; `npx jest lib/pilot/shadow` green.
- [ ] **Live test on agent `3fc703fd`**: re-run calibration → confirm the resolver reads the sheet, fixes `range`, step1 reads data, calibration converges (or asks if the sheet is multi-tab). Capture via `dump-calibration.ts`.

**Phase 4 — Docs**
- [ ] New `docs/Calibration/PARAMETER_RESOLVER_FRAMEWORK.md` (the durable design) + link in `CALIBRATION_OVERVIEW.md`.
- [ ] Update the `calibration` skill (the resolver is a new repair path) + note in this workplan's Change History.

## 8. Test plan

- **Engine unit** (mock resolver): resolved→applied (input + DSL targets), ambiguous→surfaced, unresolved→untouched, resolver-throws→non-blocking.
- **Sheets resolver unit** (mock metadata): 1 tab → resolved 0.95; exact-ish match → resolved; multi-tab no match → ambiguous candidates (first-tab default highlighted).
- **Live**: agent `3fc703fd` end-to-end via `/v2/sandbox/[agentId]`.
- **Regression**: existing `lib/pilot/shadow` tests stay green; calibration still converges on agents with no resolver-eligible issues.

## 9. Risks

- **Live API call in calibration** — adds latency + a real call; cap to one attempt/param, non-blocking on failure.
- **Wrong-tab auto-pick** — mitigated by asking when ambiguous; only auto-apply on single/clear-match.
- **Input-vs-DSL apply complexity** — the `{{input.X}}` indirection is the trickiest part; covered by Phase 1 tests.
- **Plugin-agnostic drift** — guard in review: the engine must contain zero Sheets code; all specifics in the resolver.
- **Persisting a fix on a run that ends needs_review** — acceptable (the fix is independently correct), consistent with P3; confirm in § 6.5.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-30 | Created | Option A design + phased tracklist. Generic resolver engine + registry + Google Sheets range resolver (first tenant); auto-apply ≥0.9 / ask-on-ambiguous; input-vs-DSL apply targets. Awaiting SA sign-off on § 6 open questions before implementation. Origin: RCA on agent `3fc703fd`. |
