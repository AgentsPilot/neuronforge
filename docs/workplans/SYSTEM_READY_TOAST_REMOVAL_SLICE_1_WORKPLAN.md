# Workplan: Remove the "System Ready" Toast and Close `/api/system/*` (Slice 1)

> **Last Updated**: 2026-09-19

**Developer:** Dev
**Requirement:** [SYSTEM_READY_TOAST_AND_STARTUP_INITIALIZER_REMOVAL_REQUIREMENT.md](/docs/requirements/SYSTEM_READY_TOAST_AND_STARTUP_INITIALIZER_REMOVAL_REQUIREMENT.md), Slice 1 per SA Review §C
**Date:** 2026-09-19
**Status:** Code Complete (2026-09-19): Slice 1 T0–T12 plus Part B done and uncommitted. Awaiting T13 (QA browser check) and SA code review.
**Branch:** `fix/system-initializer-removal`, cut from `origin/main` @ `94f9cfcd`, confirmed with `git branch --show-current` before the first edit. Worked in the worktree `neuronforge-system-initializer`.

## Overview

Every platform page load (including `/`, `/login` and marketing pages, logged in or out) mounts `SafeSystemInitializer`. It calls two unauthenticated `/api/system/*` endpoints. One of them runs a cross-tenant service-role write, and the component then shows a false "System Ready — NeuronForge scheduler is running" toast. A third endpoint, `/api/system/status`, lets anyone read platform-wide agent metadata (SA rated this F4 High). Slice 1 deletes the toast, the client initializer, the startup and cleanup libraries behind it, and the `/initialize` and `/status` routes. It reduces `/health` to a static liveness probe. The change is deletion only. It needs no migration or env var and changes no user-facing behaviour except removing the toast.

Slice 2 (the stale-execution recovery cron) is **out of scope**. See [§9](#9-follow-up-slice-2-pointer).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [R5 / FR-5.1 Reference Sweep](#3-r5--fr-51-reference-sweep)
4. [Files to Create / Modify / Delete](#4-files-to-create--modify--delete)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [Risks](#7-risks)
8. [Rollback](#8-rollback)
9. [Follow-up: Slice 2 pointer](#9-follow-up-slice-2-pointer)
10. [Questions for SA](#10-questions-for-sa)
11. [Implementation Results (Slice 1)](#11-implementation-results-slice-1)
12. [Part B — test command hygiene](#part-b--test-command-hygiene)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## 1. Analysis Summary

| Area | Current state (verified 2026-09-19, files identical on `main` and `5cdc5521`) |
|---|---|
| `components/PlatformShell.tsx` | Imports and renders `<SafeSystemInitializer />` inside `UserProvider`. The doc comment (L10–24) describes "the scheduler bootstrap" and the toast. 0 `console.*`. |
| `components/SafeSystemInitializer.tsx` | 106 lines, 4 `console.*`. It fetches `/api/system/health` then `POST /api/system/initialize`, and shows the success or error toast. |
| `components/SystemInitializer.tsx` | 169 lines, 4 `console.*`. It is dead: no importer. It exports `SystemInitializer` and `SystemStatus`, which polls `/api/system/status`. |
| `app/api/system/initialize/route.ts` | 41 lines, 4 `console.*`. Unauthenticated `POST`. Its only import is `initializeApplication`. |
| `app/api/system/status/route.ts` | 190 lines, 2 `console.*`. Unauthenticated service-role cross-tenant read (F4). Its only lib import is `executionCleanup.getCleanupStats`. |
| `app/api/system/health/route.ts` | 68 lines, 1 `console.*`. Runs a service-role `agents` select for anonymous callers and returns raw DB error text plus env-presence flags. It returns **HTTP 200 even when the DB check fails** (L42 has no `status`), so a status-code monitor never saw a failure anyway. |
| `lib/startup/initialize.ts` | 138 lines, 11 `console.*`. It is the only file in `lib/startup/`, and its only importer is `/initialize`. |
| `lib/cleanup/executionCleanup.ts` | 152 lines, 13 `console.*`. It is the only file in `lib/cleanup/`. Importers: `lib/startup/initialize.ts` and `/status`, both deleted here. Its write targets the non-existent `ended_at` column, so it has never succeeded (SA §A). |
| Middleware / `vercel.json` | No reference to `/api/system/*`. Middleware skips `/api`, so nothing upstream changes. |
| DB / env / migrations | None touched. |

---

## 2. Implementation Approach

1. **One commit and one release unit.** Removing the component and deleting `/initialize` must land together (SA §C). If only the route is deleted, the component's `POST` gets a 404 and every page shows the "System initialization failed" error toast. If only the component is removed, the anonymous write path stays reachable.
2. **Delete, don't convert.** All `console.*` in scope (39 calls) sits in files being deleted, so FR-4.2 needs no conversion. The two surviving touched source files (`PlatformShell.tsx`, the rewritten `/health`) will have zero `console.*`.
3. **`lib/startup/initialize.ts` is deleted.** The sweep (§3) shows its only importer is `/initialize`. Its three steps are a connectivity probe, a cleanup call that never worked, and a no-op "scheduler" flag. None of it has another caller.
4. **`lib/cleanup/executionCleanup.ts` is deleted** (FR-2.10's "or is deleted" branch, as SA ruled in §C). Slice 2 does not reuse it. SA §D-1 specifies new `ExecutionRepository` methods and a new cron route, and this file breaks that spec in three places: no repository, unscoped by-id update after a separate select (F7), and it writes `ended_at`. Keeping it for Slice 2 would mean keeping code that must not be copied. Deleting it loses no working behaviour.
5. **`/health` becomes a static liveness probe**, per SA Q6:

   **File:** `app/api/system/health/route.ts` (target shape; illustrative, not yet written)
   ```typescript
   // Liveness only: no DB, no env detail, no error text (SA Q6, F5).
   // force-dynamic so `timestamp` is per request, not frozen at build time.
   export const dynamic = 'force-dynamic';

   export function GET() {
     return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
   }
   ```
   *Superseded by SA Q-B / C-1: the shipped body is `{ success: true, data: { status: 'ok', timestamp } }`.*
   There is no try/catch and no logging, because nothing can fail and logging every probe would be noise. With no log there is no `correlationId` to attach. No input means no Zod schema, and the file header will say so. `force-dynamic` matters because a Next 14 `GET` handler that reads no request is statically rendered at build time by default (69 existing routes set it). See Q-C and Q-D in §10.
6. **Directories.** `lib/startup/`, `lib/cleanup/`, `app/api/system/initialize/` and `app/api/system/status/` become empty and are removed. `app/api/system/` stays because `health/` remains.
7. **Docs.** Update the `PlatformShell` doc comment: keep the "why it's a separate module / public pages" rationale and drop the scheduler-bootstrap and toast description. Change one line in `docs/VERCEL_ENV_SETUP.md` (L183) to say the endpoint is a liveness check only and no longer tests the DB or env vars. That doc has no header or Change History block. I will edit only that line and will not reformat a file outside my scope.
8. **Regression guard (proposed, SA to confirm Q-E).** Add a small source-level Jest guard modelled on `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`. It asserts that the deleted files do not exist and that no file under `app/`, `components/`, `lib/` or `hooks/` contains `/api/system/initialize` or `/api/system/status`. This is the automated stand-in for AC-2/AC-3, because the repo has no Playwright setup (see Q-F).

---

## 3. R5 / FR-5.1 Reference Sweep

**Method:** `grep -rnF` for each term across `app/ components/ lib/ hooks/ scripts/ tests/ __tests__/ middleware.ts vercel.json docs/ types/ next.config.js package.json`, followed by a whole-repo `grep -rlE` of all terms combined (excluding `node_modules`, `.next`, `.git`) to catch anything outside those roots. `e2e/` and `instrumentation.ts` do not exist. `.github/workflows/plugin-tests.yml` has no hit.

### 3.1 Hits and disposition

| # | Term | Hit (file:line) | Disposition |
|---|---|---|---|
| 1 | `SafeSystemInitializer` | `components/PlatformShell.tsx:7` (import), `:30` (render) | **Remove** both lines (T2) |
| 2 | `SafeSystemInitializer` | `components/SafeSystemInitializer.tsx:1,10` | **Delete file** (T3) |
| 3 | `SystemInitializer` | `components/SystemInitializer.tsx:1,19` (only hits, no importer) | **Delete file** (T4) |
| 4 | `SystemStatus` (export) | `components/SystemInitializer.tsx:108–126` (only hits, no importer) | **Delete** with file (T4) |
| 5 | `SystemStatus` (substring) | `components/v2/metrics/SystemHealthDashboard.tsx:6,144`, `components/v2/metrics/SystemStatusCard.tsx:6,11` | **False positive**: an unrelated `SystemStatusCard` component with no link to `/api/system`. No change. |
| 6 | `/api/system/initialize` | `components/SafeSystemInitializer.tsx:57`, `components/SystemInitializer.tsx:43` | Deleted with those files |
| 7 | `/api/system/initialize` | `components/PlatformShell.tsx:17` (doc comment) | **Rewrite comment** (T2) |
| 8 | `/api/system/initialize` | `app/api/system/initialize/route.ts:1` | **Delete route** (T5) |
| 9 | `/api/system/status` | `components/SystemInitializer.tsx:122` | Deleted with file |
| 10 | `/api/system/status` | `app/api/system/status/route.ts:1` | **Delete route** (T6) |
| 11 | `/api/system/health` | `components/SafeSystemInitializer.tsx:48` | Deleted with file |
| 12 | `/api/system/health` | `app/api/system/health/route.ts:1` | **Rewrite** to liveness (T8) |
| 13 | `/api/system/health` | `docs/VERCEL_ENV_SETUP.md:183` (manual deploy check) | **Keep the URL**, amend the line to "liveness only" (T10) |
| 14 | `api/system` (prefix) | `app/api/system-config/route.ts`, `app/v2/agents/new/page.tsx:534`, `lib/client/agent-api.ts:295,313`, `docs/PERFORMANCE_OPTIMIZATION_PLAN.md`, `docs/REPOSITORY_STRATEGY.md:691` | **False positive**: `/api/system-config` is a different route. No change. |
| 15 | `initializeApplication` | `app/api/system/initialize/route.ts:3,10`; `lib/startup/initialize.ts:130` | Deleted with those files |
| 16 | `getApplicationStatus` | `lib/startup/initialize.ts:137` (definition only, **zero callers**) | Deleted with file |
| 17 | `applicationInitializer` / `ApplicationInitializer` | `lib/startup/initialize.ts:22–32,125,131,138` only | Deleted with file |
| 18 | `__NEURONFORGE_INITIALIZED__` | `lib/startup/initialize.ts:9,24,39,73,120` only | Deleted with file. No other `globalThis` reader anywhere. |
| 19 | `executionCleanup` | `lib/startup/initialize.ts:3,63`; `app/api/system/status/route.ts:6,9`; `lib/cleanup/executionCleanup.ts:1,153` | All three files deleted (T5–T7) |
| 20 | `startAutomaticCleanup` / `stopAutomaticCleanup` | `lib/cleanup/executionCleanup.ts:135,146` (definitions only, **zero callers**) | Deleted with file |
| 21 | `getCleanupStats` | `app/api/system/status/route.ts:9`; `lib/cleanup/executionCleanup.ts:98` | Deleted with both files |
| 22 | `cleanupOrphanedExecutions` | `lib/cleanup/executionCleanup.ts:20,139`; `lib/startup/initialize.ts:63` | Deleted with both files |
| 23 | any term | `docs/requirements/SYSTEM_READY_TOAST_AND_STARTUP_INITIALIZER_REMOVAL_REQUIREMENT.md` | **Keep**: the historical record of the requirement |
| 24 | any term | `tsconfig.tsbuildinfo` | **Ignore**: gitignored build cache (`.gitignore:44`) that regenerates on the next build |
| 25 | any term | `.claude/worktrees/exciting-volhard-7b9da0/` (10 files, branch `fix/onboarding-price-parser`) | **Ignore** (SA §D-7): a stale worktree copy, not shipped code |
| 26 | `middleware.ts`, `vercel.json`, `scripts/`, `tests/`, `__tests__/`, `hooks/`, `types/`, `.github/` | no hits | Nothing to do |

**Toast-string check.** I also searched for `System Ready`, `scheduler is running` and `system is ready`. The only hits inside scope are in the files being deleted. Every other hit is unrelated and stays: `app/onboarding-build/page.tsx:651` (an onboarding "System Ready!" label), `components/business-os/insight/SystemReadiness.tsx`, `lib/memory/MemoryConsolidationScheduler.ts`, `app/api/admin/memory-consolidation/route.ts`, and archived docs.

### 3.2 Sweep conclusion

No importer or caller exists outside the files this slice deletes. Nothing needs re-pointing (FR-1.3), and I found no surprise consumer. The only external-facing dependency is the manual `/health` check in `docs/VERCEL_ENV_SETUP.md`, plus any uptime monitor the repo can't show us (Q-A).

---

## 4. Files to Create / Modify / Delete

| File | Action | Reason |
|---|---|---|
| `components/PlatformShell.tsx` | modify | Remove the `SafeSystemInitializer` import and render (FR-1.1). Rewrite the doc comment (FR-1.4). `SessionHandler`, `UserProvider` and `Toaster` are unchanged (AC-4). |
| `components/SafeSystemInitializer.tsx` | **delete** | FR-1.2 |
| `components/SystemInitializer.tsx` | **delete** | FR-1.3. Dead code, including `SystemStatus`. |
| `app/api/system/initialize/route.ts` | **delete** | FR-3.1 / AC-13. Must ship with the PlatformShell change. |
| `app/api/system/status/route.ts` | **delete** | FR-3.2 / SA Q6 / AC-14. Closes F4. |
| `app/api/system/health/route.ts` | rewrite | FR-3.3 / SA Q6 / AC-15. Static liveness, no DB, no env, no `console.*`. |
| `lib/startup/initialize.ts` | **delete** | FR-3.1. Unreferenced once `/initialize` is gone. |
| `lib/cleanup/executionCleanup.ts` | **delete** | FR-2.10 (delete branch) / SA §C. Unreferenced after T5 and T6. Slice 2 builds anew. |
| `app/api/system/health/__tests__/route.test.ts` | create | Asserts the minimal body and that no Supabase module is loaded (AC-15) |
| `lib/__tests__/system-initializer-removed.guard.test.ts` (name TBC) | create | Regression guard for AC-2/AC-3/AC-13/AC-14 (Q-E) |
| `docs/VERCEL_ENV_SETUP.md` | modify (1 line) | L183: `/health` is now liveness only (SA Q6) |
| `docs/workplans/SYSTEM_READY_TOAST_REMOVAL_SLICE_1_WORKPLAN.md` | this file | Audit trail |

---

## 5. Task List

- [x] ✅ **T0** RM creates `fix/system-initializer-removal` off `main`. Dev confirms with `git branch --show-current` before the first edit and records the branch in this header. *(Branch cut from `origin/main` @ `94f9cfcd`; confirmed; recorded in header.)*
- [x] ✅ **T1** Re-run the §3 sweep on the new branch. `main` may have moved, and any new hit must be added to §3.1 before deleting anything. *(`git grep` plus whole-tree `grep` on `94f9cfcd`: hits are exactly §3.1 rows 1–22 plus the requirement doc and this workplan. No new hit. This checkout has no `tsconfig.tsbuildinfo` and no `.claude/worktrees/`.)*
- [x] ✅ **T2** `components/PlatformShell.tsx`: remove the import (L7) and `<SafeSystemInitializer />` (L30). Rewrite the doc comment so it describes session listeners, user context and the toast host, and keeps the public-page and `next/dynamic` rationale without mentioning a scheduler bootstrap. *(C-5: `SessionHandler` → `UserProvider` → `{children}` → `Toaster` ordering unchanged. The `next/dynamic` / public-page paragraph is kept verbatim.)*
- [x] ✅ **T3** Delete `components/SafeSystemInitializer.tsx`.
- [x] ✅ **T4** Delete `components/SystemInitializer.tsx`.
- [x] ✅ **T5** Delete `app/api/system/initialize/route.ts` and its now-empty directory.
- [x] ✅ **T6** Delete `app/api/system/status/route.ts` and its now-empty directory.
- [x] ✅ **T7** Delete `lib/startup/initialize.ts` and `lib/cleanup/executionCleanup.ts` and their now-empty directories.
- [x] ✅ **T8** Rewrite `app/api/system/health/route.ts`: `force-dynamic`, `GET` → `200 { success: true, data: { status: 'ok', timestamp } }` (C-1 / Q-B), a header comment stating no input (so no Zod), no DB and no logging, and zero `console.*`.
- [x] ✅ **T9** Add the tests: the `/health` route test and the regression guard (§6.2). *(`app/api/system/health/__tests__/route.test.ts` has 4 tests. `lib/__tests__/system-initializer-removed.guard.test.ts` has 4 tests. All 8 pass. A throwaway probe confirmed that the throwing `jest.mock` factory really does fail on import; the probe was deleted.)*
- [x] ✅ **T10** `docs/VERCEL_ENV_SETUP.md` L183: note that the endpoint is a liveness check only.
- [x] ✅ **T11** Post-change sweep: re-run §3. Results are in §11.1.
- [x] ✅ **T12** Run `npm run build`, `npm run lint` and `npx jest` (§6.3). Results are in §11.2. `npm run lint` cannot run (pre-existing, see §11.2), so ESLint was run directly.
- [ ] **T13** Manual browser verification of AC-1, AC-2 and AC-4 on the dev server (§6.1). Hand off to SA code review. *(Skipped by Dev per TL instruction. QA owns it.)*

---

## 6. Test Plan

### 6.1 Acceptance criteria in scope for Slice 1

| AC | Criterion | How verified | Who |
|---|---|---|---|
| **AC-1** | No "System Ready" and no "System initialization failed" toast on load or hard refresh, logged in and logged out | Dev server, browser. **Logged out:** `/`, `/login`. **Logged in:** `/`, `/test-business-os`, one Business OS page (e.g. `/business-os` dashboard). Each gets a normal load plus a hard refresh (Ctrl+Shift+R), and I watch the top-centre toast area for about 3 s (the old toast fired at 500 ms). | Dev (smoke), QA (sign-off) |
| **AC-2** | No browser request to `/api/system/*` | Same page matrix with DevTools Network filtered on `api/system`, "Preserve log" on, zero entries expected. Automated backstop: the guard test in §6.2 (no `/api/system/initialize` or `/status` literal in client code). | Dev, QA |
| **AC-3** | Both component files gone, nothing references them | The T11 sweep is clean, and the guard test asserts the files do not exist | Dev |
| **AC-4** | Other toasts still render | On a logged-in Business OS page, trigger an action that raises a sonner toast (e.g. a save or a validation error) and confirm it renders top-centre | QA |
| **AC-13** | `POST /api/system/initialize` → 404 | `curl -i -X POST http://localhost:3000/api/system/initialize` returns 404. Repeat on the Vercel preview. | QA |
| **AC-14** | `/api/system/status` returns no data, unauthenticated or non-admin | `curl -i` `GET`, and `POST -d '{"agentId":"x"}'`, return 404 both unauthenticated and with a logged-in non-admin cookie | QA |
| **AC-15** | `/health` does no service-role query and returns no error or env detail | `curl -s /api/system/health` returns exactly `{"success":true,"data":{"status":"ok","timestamp":"…"}}` with HTTP 200 (C-1 / Q-B). Two calls a second apart show different timestamps, which proves `force-dynamic` took effect. Route unit test (§6.2). | Dev, QA |
| **AC-16** | No `console.*` in surviving touched files | `grep -c "console\." components/PlatformShell.tsx app/api/system/health/route.ts` returns 0 and 0 | Dev |
| **AC-17** (Slice 1 portion) | Build, lint and tests pass | §6.3 | Dev, QA |

ACs 5–12 and the recovery parts of AC-17 belong to Slice 2.

### 6.2 New automated tests

| Test | Assertions |
|---|---|
| `app/api/system/health/__tests__/route.test.ts` | (a) `GET` returns 200. (b) The body's top-level keys are exactly `['success','data']` with `success === true`, and `data`'s keys are exactly `['status','timestamp']` with `status === 'ok'` and `timestamp` a valid ISO string (C-1). (e) The module exports `dynamic === 'force-dynamic'`. (c) The body contains no `error`, `details` or `environment` key. (d) `@/lib/supabaseServer` is never loaded: `jest.mock` it with a factory that throws, so any import fails the test. Follows the existing `app/api/**/__tests__/route.test.ts` precedent. |
| Regression guard (Q-E) | (a) `components/SafeSystemInitializer.tsx`, `components/SystemInitializer.tsx`, `app/api/system/initialize/route.ts`, `app/api/system/status/route.ts`, `lib/startup/initialize.ts` and `lib/cleanup/executionCleanup.ts` do not exist. (b) No `.ts`/`.tsx` under `app/`, `components/`, `lib/` or `hooks/` contains the literal `/api/system/initialize` or `/api/system/status` (the guard file itself excluded). |

### 6.3 Build / lint / test commands

| Command | Note |
|---|---|
| `npm run build` | Must pass. `next.config.js` ignores TS errors, so a build pass alone does not prove the absence of dangling imports. |
| `npx tsc --noEmit -p .` filtered to `PlatformShell\|system/health\|SafeSystemInitializer\|startup/initialize\|cleanup/executionCleanup` | Must return no error for these paths. Checking the baseline error count repo-wide is not a goal because the repo has pre-existing errors. |
| `npm run lint` | Must pass (or show no new findings in touched files compared with baseline). |
| `npx jest` | **There is no `npm test` script** in `package.json`, so I use `npx jest` directly (the full suite, per `jest.config.js`). Minimum: the two new tests pass, and there are no new failures compared with `main`'s baseline. Known pre-existing red tests get recorded, not fixed. |
| Playwright | **Not available.** `@playwright/test` is not installed and there is no `test:e2e` script or config. AC-1/AC-2 are covered manually in §6.1 plus the §6.2 guard (Q-F). |

---

## 7. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | An external uptime monitor parses the old `/health` body (`success`, `details.database`) | Low | A status-code monitor is unaffected: the route still returns 200, and it returned 200 even on DB failure before. A body-parsing monitor would need updating. TL confirms (Q-A). |
| R-2 | Shipping the PlatformShell change without the `/initialize` deletion, or the reverse | Low (single commit) | Keep both in one commit. RM must not split it. The guard test catches **both** directions (C-4): assertion (a) requires `components/SafeSystemInitializer.tsx` **and** `app/api/system/initialize/route.ts` to be absent, so restoring either one alone fails CI. |
| R-3 | The 4 stuck `agent_executions` rows (SA §A) stay stuck | Certain, and unchanged by this slice | The deleted cleanup never succeeded (`ended_at` does not exist), so nothing regresses. Slice 2 addresses it. |
| R-4 | `main` gains a new reference between this sweep and implementation | Low | T1 re-sweep before deleting |
| R-5 | The stale worktree `.claude/worktrees/exciting-volhard-7b9da0` still contains the old files | None for shipping | Not part of the tree RM commits. Ignored per SA §D-7. |

---

## 8. Rollback

- **Mechanism:** `git revert <slice-1 merge commit>` restores all files in one step. Nothing else needs reverting: no migration, no env var, no `vercel.json` change and no data change.
- **Revert all or nothing.** A partial revert that restores the component without `/initialize` (or the reverse) brings back the error toast on every page (R-2).
- **Cost of rollback:** it reopens F4 (an unauthenticated cross-tenant read of agent names and schedules) and the anonymous service-role write path. Roll back only for a real breakage, such as a failed build or a monitor outage, and prefer a forward fix, for example restoring `/health` to 200 with a different body.
- **`/health` only:** if only a monitor breaks, fix forward by adjusting the liveness body. Never restore the DB query or env flags.

---

## 9. Follow-up: Slice 2 pointer

Slice 2 (R2 + R4: `app/api/cron/stale-execution-recovery/route.ts`, `ExecutionRepository.findStaleForRecovery` / `markStaleAsFailed`, `AGENT_RUN_AUTO_RECOVERED` audit event, ACs 5–12 and 17) gets its own workplan after Slice 1. Per SA §C, Slice 1 must not ship later than Slice 2. Slice 2 depends on `CRON_SECRET` being set on Vercel (SA §E-4), and the §F business decision (resume or pause the 3 dormant scheduled agents) must be made before it goes live. SA §E-1 to §E-3 (the missing `ExecutionRepository.create`, F9, and the dead `agentExecutionEngine.ts`) are for TL to log as separate tickets and are not touched here.

---

## 10. Questions for SA

| # | Question | Dev default if SA agrees |
|---|---|---|
| **Q-A** | `/health`: keep it as liveness (SA Q6 default) or delete it? Deleting needs TL to confirm that no external uptime monitor uses it. | Keep as liveness |
| **Q-B** | Body shape: SA specified `{ ok: true, timestamp }`, which differs from the CLAUDE.md `{ success: true, data }` envelope. Confirm that the liveness exception is intended. | `{ ok: true, timestamp }` as SA wrote |
| **Q-C** | No logging and no `correlationId` in `/health`: it has no failure path, and logging every probe would be noise. Acceptable under FR-4.1 ("Pino if it logs at all")? | No logging |
| **Q-D** | Add `export const dynamic = 'force-dynamic'` so the timestamp isn't frozen at build time (established pattern, 69 routes). | Add it |
| **Q-E** | Add the source-level regression guard test (§6.2), modelled on `no-deletion-paths.guard.test.ts`, or rely on the one-off sweep? | Add it |
| **Q-F** | AC-17's Playwright check for AC-1/AC-2 is not possible because Playwright is not installed. Accept manual QA verification plus the guard test for Slice 1, with introducing Playwright left out of scope as a new pattern? | Manual + guard |

---

## 11. Implementation Results (Slice 1)

Measured 2026-09-19 on `fix/system-initializer-removal`, uncommitted, compared with a clean `git archive` extract of `94f9cfcd` (`main`) that shares the same `node_modules`. The main checkout was not touched.

### 11.1 T11 post-change sweep

| Check | Result |
|---|---|
| All FR-5.1 terms plus `lib/startup` / `lib/cleanup`, whole tree (excluding `node_modules`, `.next`, `.git`) | Only 3 files hit: the requirement doc, this workplan, and `lib/__tests__/system-initializer-removed.guard.test.ts` (which must name the paths it guards, and excludes itself). `tsconfig.tsbuildinfo` and a stale worktree don't exist in this checkout. |
| `/api/system/health` | Only the rewritten route, its test, `docs/VERCEL_ENV_SETUP.md:183` (amended) and the docs |
| AC-16: `grep -c "console\."` | `components/PlatformShell.tsx`: 0. `app/api/system/health/route.ts`: 0. |

### 11.2 T12 build / tsc / lint / tests

| Command | Branch | `main` baseline | Verdict |
|---|---|---|---|
| `npx tsc --noEmit -p .` with `NODE_OPTIONS=--max-old-space-size=8192` (C-3) | Completed: exit 2, 2,798 output lines, **2,037** `error TS`, no OOM | exit 2, **2,038** `error TS` | The only difference is the removed `lib/cleanup/executionCleanup.ts(69,35) TS2339`, which was deleted along with its file. **0 errors** in touched or deleted paths, and no new errors. |
| Jest (C-2): `npx jest --testPathIgnorePatterns "/node_modules/" "/.next/" "/.claude/"` | Suites: 21 failed, 8 skipped, **322 passed** (351). Tests: 129 failed, 58 skipped, **4,844 passed** (5,031). | Suites: 21 failed, 8 skipped, 320 passed (349). Tests: 129 failed, 58 skipped, 4,836 passed (5,023). | The same 21 failing suites and the same 131 `●` failure entries. The +2 suites and +8 tests are the new ones, and all pass. **No new failures.** |
| New tests only | `app/api/system/health/__tests__/route.test.ts` (4) + `lib/__tests__/system-initializer-removed.guard.test.ts` (4) | n/a | 8/8 pass |
| `npm run build` | **exit 0**, "Compiled successfully" (with the existing supabase Edge-runtime warnings), 298/298 static pages. `/api/system/health` is listed as `ƒ` (dynamic), which confirms `force-dynamic`. `/api/system/initialize` and `/status` are gone from the route table. | not run | Pass |
| `npm run lint` | **Cannot run (pre-existing).** `next lint` doesn't detect the repo's flat config and opens its interactive "How would you like to configure ESLint?" prompt, then exits 1 without linting. `npx eslint` also picks up `eslint.config.js`, an eslintrc-style object that matches no files. | Same on `main` (config files unchanged) | Ran `npx eslint -c eslint.config.mjs` on the 4 touched or new source files instead: **0 problems**. The 8 original files on `main` had **6 problems (4 errors, 2 warnings)**, all removed with the deleted files. The lint setup itself is a pre-existing tooling issue for TL (see §11.3). |

### 11.3 Deviations and notes for SA / QA

| # | Item |
|---|---|
| D-1 | **Lint.** `npm run lint` is non-functional repo-wide (see §11.2), so T12's lint check was done with `npx eslint -c eslint.config.mjs` on the touched files. Not fixed here: choosing a lint config is out of scope. **For TL:** log a ticket to fix `next lint` / the duplicate `eslint.config.js` + `eslint.config.mjs`. |
| D-2 | **Guard does not strip comments**, unlike its precedent. That makes it stricter: a doc comment still naming a removed route is also stale. The header says so. |
| D-3 | **Route test adds (e)**: it asserts `dynamic === 'force-dynamic'`, so the Q-D fix can't be silently dropped. Its "no error/env detail" check (c) also covers `database` and `hasSupabase`. |
| D-4 | `PlatformShell` doc comment: the historical sentence now says public pages used to get "Supabase auth listeners and the platform's toast host", so it no longer mentions the removed POST or toast text. The `next/dynamic` paragraph is unchanged (C-5). |
| D-5 | No `npm ci` allow-scripts problem affected any tool used (tsc, jest, next build, eslint all ran). |
| QA | T13 still open: the §6.1 page matrix (AC-1, AC-2, AC-4), plus the `curl` checks for AC-13, AC-14 and AC-15 (including two calls with differing timestamps). |

---

## Part B — test command hygiene

> **Scope note.** This is a separate follow-up chore that the user asked to include on this branch (2026-09-19). SA condition C-2 said *not* to change `jest.config.js` in Slice 1. The user has since **expanded scope** to cover the out-of-scope drift that SA flagged for TL ("CLAUDE.md § Testing documents `npm test` and `npm run test:e2e`, but neither exists … `jest.config.js` does not ignore `.claude/worktrees/`"). Slice 1's baseline (§11.2) was measured with the C-2 command **before** any Part B change, so C-2 was honoured for Slice 1. Part B is a tooling/docs change only, with no runtime code.

### B.1 Files

| File | Action | Reason |
|---|---|---|
| `jest.config.js` | modify | Add `'<rootDir>/.claude/'` to `testPathIgnorePatterns` so tests are not collected from stale agent worktrees under `.claude/worktrees/`, and add `modulePathIgnorePatterns: ['<rootDir>/.claude/']` so their `__mocks__/` copies don't cause duplicate-mock warnings (SA code review, B6) |
| `package.json` | modify | Add `"test": "jest"` |
| `CLAUDE.md` | modify | § Testing: E2E/Playwright is documented as **not set up yet** (instead of adding Playwright, which is a new pattern needing SA review). Removed the non-existent `npm run test:e2e` and the `e2e/` location, and corrected the Commands block. Bumped Last Updated and added a Change History row. |

### B.2 Task list

- [x] ✅ **B1** `jest.config.js`: add `'/.claude/'` to `testPathIgnorePatterns`, with a *why* comment. *(Anchored to `'<rootDir>/.claude/'` in B6 after SA review.)*
- [x] ✅ **B2** `package.json`: add `"test": "jest"`, next to `lint`.
- [x] ✅ **B3** `CLAUDE.md` § Testing: E2E row → "Not set up yet"; drop `e2e/` from file location; replace the "Playwright test for UI flows" expectation with "QA records a manual critical-path check, optionally backed by a source-level Jest guard"; note that adding E2E needs SA review; Commands now `npm test`, `npm test -- <path>`, `npm run test:plugins`. Header Last Updated → 2026-09-19. Change History row added.
- [x] ✅ **B4** Proved the ignore works: planted a throwaway failing `.claude/worktrees/probe/__tests__/stale.test.ts`. `npm test -- --listTests` collected **0** `.claude` paths, while the old ignore list collected **1**. The probe was deleted.
- [x] ✅ **B5** Re-ran the full suite with `npm test`: exit 1. Suites: 21 failed, 8 skipped, 322 passed (343 of 351). Tests: 129 failed, 58 skipped, 4,844 passed (5,031). **Identical** to the C-2 command run in §11.2, with the same failing suites and failure entries as `main`. Part B introduces no failures.
- [x] ✅ **B6** SA code-review fixes (Part A approved; Part B needed two changes):
  - **HIGH, fixed.** `'/.claude/'` → `'<rootDir>/.claude/'`. Unanchored, it matches every path when Jest runs from *inside* a `.claude/worktrees/*` checkout, so that checkout collects 0 tests.
  - **MEDIUM, fixed.** Added `modulePathIgnorePatterns: ['<rootDir>/.claude/']` to remove the `jest-haste-map: duplicate manual mock found` warnings caused by worktree copies of `__mocks__/`.
  - **How it was verified.** This worktree has no `.claude/worktrees/*`, and the existing ones sit in the main checkout, which is off-limits for this task. So I built a faithful nested copy of this branch (4,307 files, including `jest.config.js` and `__mocks__/`) at `.claude/worktrees/probe/`, ran the checks, then deleted it.

    | Run | Tests listed | `.claude` paths listed | Duplicate-mock warnings |
    |---|---|---|---|
    | Root, **new** config (`npm test -- --listTests`) | 351 | 0 | 0 |
    | Root, **old** config (unanchored, no `modulePathIgnorePatterns`) | 351 | 0 tests (2 lines, both warnings) | **2** (`server-only`, `styleMock`; SA saw 9 with more or older worktrees) |
    | Inside the nested worktree, **new** config | **351** | n/a (all under the probe's own root) | 0 |
    | Inside the nested worktree, **old** unanchored `'/.claude/'` | **0** (the HIGH bug, reproduced) | n/a | n/a |
    | `npm test -- app/api/system/health lib/__tests__/system-initializer-removed` | 2 suites, **8/8 tests pass**, exit 0 | n/a | 0 |

  - **Measurement gotcha found along the way.** In Git Bash, MSYS path conversion rewrites CLI args like `/.claude/` into `C:\Program Files\Git\.claude\` unless `MSYS_NO_PATHCONV=1` is set. The contrast runs above used `MSYS_NO_PATHCONV=1`. The §11.2 C-2 runs (branch and `main` baseline) were affected: their ignore overrides matched nothing. The comparison still holds, because both sides ran the same way, neither tree had a `.claude/worktrees/`, and B5's `npm test` (patterns taken from the config file, not the CLI) reproduced the exact same 351 suites and results. Anyone reusing the C-2 command from Git Bash should set `MSYS_NO_PATHCONV=1`, or just use `npm test`.
  - `CLAUDE.md` wording ("`jest.config.js` ignores `.claude/` worktrees") is still accurate, so it was not changed.

### B.3 Pre-existing failures (on `main` too, not caused by Slice 1 or Part B)

21 suites. 8 of them (the first group) fail to load at all ("Test suite failed to run"). The other 13 load, but some tests fail. Grouped by first cause:

| Group | Suites | First cause |
|---|---|---|
| Missing modules (deleted/renamed V6 code) | `__tests__/DeclarativeCompiler-{comprehensive,dataflow-contract,dataflow,regression,stress}.test.ts`, `lib/agentkit/v6/__tests__/integration/v6-end-to-end.test.ts`, `lib/agentkit/v6/generation/__tests__/EnhancedPromptToIRGenerator.test.ts`, `__tests__/v6-integration.test.ts` | `Cannot find module …/DeclarativeCompiler` / `…/IRToDSLCompiler` / `…EnhancedPromptToIRGenerator_DEPRECATED` |
| V6 / V4 assertion drift | `lib/agentkit/v4/__tests__/v4-generator.test.ts`, `lib/agentkit/v6/compiler/__tests__/LogicalIRCompiler.test.ts`, `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts`, `lib/agentkit/v6/translation/__tests__/IRToNaturalLanguageTranslator.test.ts` | Expectation mismatches; `LogicalIRCompiler` also fails to resolve the `googlesheets` plugin |
| Pilot engine | `lib/pilot/__tests__/ConditionalEvaluator{,.contains_any}.test.ts`, `lib/pilot/__tests__/StructuredTransforms{,.wp33,.wp37}.test.ts` | `context.isConditionalCoercionEnabled is not a function`, undefined reads, expectation drift |
| Orchestration | `lib/orchestration/__tests__/IntentClassifier.test.ts`, `lib/orchestration/__tests__/TokenBudgetManager.test.ts` | Mock-call count; Supabase mock missing `.eq` (TokenBudgetManager also takes ~87 s) |
| Other | `lib/utils/__tests__/featureFlags.test.ts`, `lib/website-builder/__tests__/archetypes.test.ts` | Expectation drift |

**For TL:** these predate this branch and are recorded, not fixed. They are worth a separate triage ticket, because `npm test` is now red on `main`.

---

## SA Review Notes

**Reviewed by SA — 2026-09-19** (workplan review; measured on `feature/business-os-purge-slice-2` @ `5cdc5521`)
**Status:** ✅ APPROVED WITH CONDITIONS. Proceed to implementation once T0 is done. Conditions C-1 to C-5 below are part of the approval.

### Checks against the requirement's SA conditions

| Check | Result |
|---|---|
| Toast removal and `/initialize` deletion ship together (SA §C) | ✅ §2 item 1, R-2 and §8 all make it one commit and an all-or-nothing revert. **Correction to R-2:** the guard test *does* catch the reverse case too. Its assertion (a) requires **both** `components/SafeSystemInitializer.tsx` and `app/api/system/initialize/route.ts` to be absent, so restoring either one alone fails CI. |
| `/health` reduction (SA Q6) | ✅ No DB, no env flags, no error text, no `console.*`. Body shape amended by Q-B below. Dev's observation that the old route returned **200 even when its DB check failed** (L42 has no `status`) is correct. So dropping the DB probe removes **no failure signal any status-code monitor ever had**. This strengthens the case for liveness-only. |
| FR-5.1 / T1 sweep: SA spot-check | ✅ **Matches.** SA ran `git grep` over all tracked files for every FR-5.1 term plus `lib/startup` / `lib/cleanup`. The hits are exactly the §3.1 set: the 8 in-scope files, plus `docs/VERCEL_ENV_SETUP.md:183`. There are no hits in `public/`, `.github/`, `middleware.ts`, `vercel.json` or `next.config.js`. `PlatformChrome.tsx` and `app/layout.tsx` have no scheduler or initializer wording left to update. The false-positive families (`SystemStatusCard`, `/api/system-config`) are correctly dispositioned. |
| Delete `lib/startup/initialize.ts` in Slice 1 | ✅ **Confirmed.** Its only importer is `/initialize`. `getApplicationStatus` has zero callers. The `globalThis` flag has no other reader. Nothing in it is worth keeping: a one-row connectivity probe, a cleanup that never worked, and a hardcoded `scheduler: true`. |
| Delete `lib/cleanup/executionCleanup.ts` in Slice 1 | ✅ **Confirmed.** After T5/T6 it has no importers. It has never succeeded in production (`ended_at` is missing live). Slice 2's approved design (SA §D-1, Q5) replaces it wholesale: repository methods, a `created_at` basis, a conditional update, and `completed_at`. Keeping it as a "starting point" would invite copying the three defects Dev lists. `startAutomaticCleanup` cannot work on serverless anyway (FR-2.10). |
| `console.*` / Pino (FR-4.1/4.2) | ✅ All 39 calls sit in deleted files. The two surviving touched files end at 0 (AC-16). |
| Repository / Zod / RLS | ✅ Not applicable to Slice 1: it removes a service-role path and adds no DB access. `/health` takes no input, and its header comment must say so (T8). |
| Security | ✅ Closes F4 (High) and the anonymous service-role write (F6). Adds no new surface. |

### Decisions on §10 questions

| # | Decision | Rationale |
|---|---|---|
| **Q-A** | **Keep `/health` as liveness.** No TL confirmation needed. | Keeping it is harmless, and it is the only option that cannot break an unseen monitor or the documented manual deploy check. It also makes the external-monitor question moot. |
| **Q-B** | **Amend SA's earlier shape to the standard envelope: `{ success: true, data: { status: 'ok', timestamp } }`, HTTP 200.** | This supersedes the `{ ok: true, timestamp }` I wrote in the requirement's Q6. The envelope follows CLAUDE.md § Error Response Format, so no exception needs justifying. It also keeps the top-level `success: true` key the old body had, so a body-parsing monitor (R-1) keeps working unchanged. Update the §6.2 test (b): the top-level keys are exactly `['success','data']`, and `data` has exactly `['status','timestamp']`. |
| **Q-C** | **No logging, no `correlationId`. Accepted.** | FR-4.1 governs *how* a route logs, not *whether* it must. A handler with no failure path and no input has nothing worth recording, and logging every probe is noise. The header comment states this deliberately so a later reviewer doesn't "fix" it. |
| **Q-D** | **Yes, `export const dynamic = 'force-dynamic'`.** | Without it, Next 14 statically renders a request-independent `GET` at build time and freezes `timestamp`. That makes the probe lie about liveness. The AC-15 two-calls check verifies it. |
| **Q-E** | **Yes, add the guard test.** | It is the only durable automated evidence for AC-2/AC-3/AC-13/AC-14 in a repo without E2E. It follows an existing precedent (`lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`), so it is not a new pattern. Keep its scan to `app/`, `components/`, `lib/` and `hooks/` so the requirement and workplan docs don't trip it. |
| **Q-F** | **Accepted: manual QA for AC-1/AC-2/AC-4, plus the guard test. AC-17's Playwright clause is waived for Slice 1.** | Introducing Playwright is a new tooling pattern and well out of proportion for a deletion slice. QA must record the §6.1 page matrix (logged in and logged out, normal load and hard refresh, Network filter on `api/system`) in the QA report. That record stands in for the automated check. |

### Conditions (part of the approval)

| # | Condition |
|---|---|
| **C-1** | Apply the Q-B body shape in T8 and in the §6.2 route test. Update AC-15's expected body in §6.1 to match. |
| **C-2** | **Jest baseline must exclude the stale worktree.** `jest.config.js` has `roots: ['<rootDir>']` and does **not** ignore `.claude/`. The worktree is excluded only through `.git/info/exclude`, so `npx jest` will also collect `.claude/worktrees/**/__tests__` and pollute the baseline comparison. Run `npx jest --testPathIgnorePatterns "/node_modules/" "/.next/" "/.claude/"`, and run it the same way on `main` for the baseline. Do not change `jest.config.js` in this slice. |
| **C-3** | For T12's `tsc` check, run with `NODE_OPTIONS="--max-old-space-size=8192"`. Check tsc's **own** exit status or output size before trusting a filtered zero. Per the `business-os-schema-check` skill (Rule 7), tsc on this repo otherwise OOMs silently, and a grep over the crash reads as "0 errors". |
| **C-4** | In §7, correct R-2's mitigation text to reflect that the guard catches both directions. |
| **C-5** | The Toaster, `SessionHandler` and `UserProvider` ordering in `PlatformShell` stays unchanged. Only line 7 and line 30 come out, plus the comment rewrite. The rewritten comment must keep the `next/dynamic` / public-page rationale (L20–23). |

### Optimisation suggestions (non-blocking)

- The §6.2 route test's "Supabase never loaded" mock (a `jest.mock('@/lib/supabaseServer', …)` factory that throws) works because Jest evaluates mock factories lazily on first import. Add a one-line comment saying so, so a reader doesn't mistake it for dead setup.

### Out-of-scope observations for TL (do not fix here)

- CLAUDE.md § Testing documents `npm test` and `npm run test:e2e`, but neither exists (there is no `test` script, no Playwright and no `e2e/`), and `jest.config.js` does not ignore `.claude/worktrees/`. These are doc/tooling drift and deserve a separate chore ticket.

### Code Approved for QA: n/a (workplan stage). SA code review follows T13.

---

**Code Review by SA — 2026-09-19** (uncommitted worktree `neuronforge-system-initializer`, branch `fix/system-initializer-removal`, base `94f9cfcd`)
**Status:** 🔄 Fix Required. Scope: **Part B only**, two one-line `jest.config.js` fixes. **Part A (Slice 1) is Code Approved.** QA may start T13 now, because the fixes don't touch Slice 1 code.

### What SA verified independently

| Check | Result |
|---|---|
| Diff scope | 12 tracked changes plus 4 untracked, exactly the §4 + B.1 file lists. Nothing else touched. |
| Slice 1 atomicity | `SafeSystemInitializer` import and render removed **and** `/initialize` deleted in the same change set. `lib/startup/`, `lib/cleanup/`, `app/api/system/{initialize,status}/` are gone. `app/api/system/` contains only `health/`. |
| New tests | `npx jest app/api/system/health lib/__tests__/system-initializer-removed`: **8/8 pass**. |
| Guard can fail (mutation test) | SA planted `components/__sa_probe.tsx` containing `'/api/system/status'` and re-created `lib/startup/initialize.ts`. The guard went **2 failed / 2 passed**, and named both offenders. SA removed both probes afterwards. The worktree `git status` is identical to before. |
| Lint (D-1) | Confirmed that `npm run lint` opens Next's interactive "How would you like to configure ESLint?" prompt and never lints. `npx eslint -c eslint.config.mjs` on the 4 touched or new source files: **0 problems**. Accepted as a pre-existing tooling fault. |
| AC-16 | `console.*` count: `PlatformShell.tsx` 0, `health/route.ts` 0. |
| tsc / full Jest / build | Not re-run in full. Dev's numbers (tsc 2,038 → 2,037, same 21 failing suites and 129 failing tests as `main`, build exit 0 with `/api/system/health` as `ƒ`) are internally consistent with the diff. The one removed tsc error is `executionCleanup.ts(69,35)`, which is in a deleted file. Accepted. |

### Part A — Slice 1 against the workplan and C-1…C-5

| Item | Verdict |
|---|---|
| **C-1** body shape | ✅ `{ success: true, data: { status: 'ok', timestamp } }`. The route test asserts the exact top-level and `data` key sets. AC-15 in §6.1 is updated. |
| **C-2** jest baseline | ✅ Honoured for the Slice 1 measurement (§11.2, taken before Part B). It is now superseded for Part B by the user's scope change. |
| **C-3** tsc OOM | ✅ Run with 8 GB heap. Exit status and error count recorded, not a filtered zero. |
| **C-4** R-2 wording | ✅ Corrected at §7. |
| **C-5** PlatformShell | ✅ Only the import and render lines were removed. `SessionHandler` → `UserProvider` → `{children}` → `Toaster` order is unchanged. The `next/dynamic` / public-page paragraph is intact. The rewritten history sentence (D-4) is accurate. |
| `/health` route | ✅ No DB, no env, no error text, no input and no logging, each deliberate and documented in the header. `force-dynamic` is present, with a comment explaining why. It uses `NextResponse.json` per convention. |
| **D-2** guard scans comments | ✅ Accepted. It is stricter than its precedent, and a doc comment naming a removed route *is* stale. It has a scanned-file floor (`> 500`, plus each root non-empty) so it can't go green on an empty scan. Good fail-closed design. |
| **D-3** asserts `force-dynamic` | ✅ Accepted. It prevents a silent regression of Q-D. The lazy-mock comment (earlier optimisation suggestion) was added. |
| Security | ✅ F4 (High) and the anonymous service-role write path are closed. No new surface. |

### Part B — test-command hygiene

| Item | Verdict |
|---|---|
| `package.json` `"test": "jest"` | ✅ Correct. It picks up `jest.config.js` by default, and `npm test -- <path>` passes args through as documented. |
| `CLAUDE.md` § Testing | ✅ Accurate. E2E is marked as not set up, the non-existent `test:e2e` and `e2e/` are removed, the commands are real (`test:plugins` exists), adding E2E is gated on SA review, and there is a Change History row. |
| `jest.config.js` `'/.claude/'` in `testPathIgnorePatterns` | 🔄 **Two defects**, below. |

### Code Review Comments

1. **`jest.config.js:38` — the unanchored `'/.claude/'` disables the whole suite for any checkout that lives under `.claude/worktrees/`.** Priority: **High** (tooling). `testPathIgnorePatterns` is matched against the **absolute** test path. Claude Code agent worktrees are created at `<repo>/.claude/worktrees/<name>/`, and three exist in the main checkout right now. Inside such a worktree, *every* test path contains `/.claude/`. SA measured this: with this config and `--rootDir` set to `.claude/worktrees/exciting-volhard-7b9da0`, `--listTests` returned **0 tests**, versus **350** with the anchored form. `npm test` in any agent worktree would find no tests. The B4 probe only tested the opposite direction. **Fix:** `'<rootDir>/.claude/'`. SA verified the anchored form still excludes all `.claude` tests from the main checkout (303 listed, 0 under `.claude`).
2. **`jest.config.js` — the haste map still crawls `.claude/worktrees/`.** Priority: **Medium**. `testPathIgnorePatterns` stops worktree *tests* from running, but not their files from being indexed. Running from the main checkout prints **9 `jest-haste-map: duplicate manual mock found`** warnings (`server-only`, `styleMock` across the 3 worktrees), and Jest resolves duplicate root `__mocks__` arbitrarily. That undercuts the CLAUDE.md line "jest.config.js ignores .claude/ worktrees". **Fix:** add `modulePathIgnorePatterns: ['<rootDir>/.claude/']`. SA verified it: **0** duplicate-mock warnings, the same 303 tests listed, and the 8 new tests still pass.

Both are one-line edits. On re-submission SA re-checks only the `jest.config.js` diff, plus a `--listTests` run from the main checkout and one from inside a `.claude/worktrees/*` checkout.

### Optimisation Suggestions (non-blocking)

- Git reports LF→CRLF normalisation warnings on `health/route.ts` and `PlatformShell.tsx`. This is harmless, and RM should let `.gitattributes`/autocrlf handle it. Don't hand-convert.

### Out-of-scope notes for TL

- `.claude/agents/{business-analyst,developer,quality-assurance,system-architect,troubleshooter}.md` still reference Playwright as available tooling. After Part B, CLAUDE.md is correct but the agent definitions aren't, so QA may try to run a Playwright suite that doesn't exist. These are agent configuration files, so it's a user/TL decision to update them; SA does not edit them.
- D-1 (`next lint` broken, duplicate `eslint.config.js` + `eslint.config.mjs`) and the 21 pre-existing failing Jest suites (B.3) each deserve their own ticket. `npm test` is red on `main`.

### Notes for QA (T13)

- Run the §6.1 matrix: logged out on `/` and `/login`; logged in on `/`, `/test-business-os` and one Business OS page. Do a normal load and a hard refresh each time. Keep DevTools Network filtered on `api/system` with "Preserve log" on. Watch about 3 s for any toast.
- For AC-4, trigger a real sonner toast on a Business OS page (a save or a validation error).
- `curl` checks:
  - AC-13: `POST /api/system/initialize` returns 404.
  - AC-14: `GET` and `POST /api/system/status` return 404, both unauthenticated and with a non-admin cookie.
  - AC-15: the exact envelope, HTTP 200, and two calls give differing timestamps.
  - Run these on the dev server and again on the Vercel preview. The preview is the real test of `force-dynamic`.
- After Dev applies fixes 1–2, run `npm test -- --listTests` once from the main checkout (expect no `.claude` paths and no duplicate-mock warnings).

### Code Approved for QA: **Yes for Part A (Slice 1).** Part B is approved once comments 1–2 are fixed; RM must not commit until then.

**Code Re-check by SA — 2026-09-19** (after B6)
**Status:** ✅ Code Approved (Part A and Part B)

| Check | Result |
|---|---|
| `jest.config.js` diff | ✅ `testPathIgnorePatterns` uses `'<rootDir>/.claude/'`, and `modulePathIgnorePatterns: ['<rootDir>/.claude/']` is added. The *why* comments are accurate, including the reason for anchoring. Nothing else in the file changed. |
| Main checkout (read-only; worktree config via `--config`, `--rootDir` = main checkout, `MSYS_NO_PATHCONV=1`, Windows-style paths) | ✅ exit 0, **303** tests listed, **0** under `.claude/`, **0** duplicate-mock warnings (was 9 before B6). |
| From inside each existing `.claude/worktrees/*` checkout (`exciting-volhard-7b9da0`, `zen-lehmann-cfde6a`, `agent-a6ffcda45294c3050`) | ✅ exit 0, **350 / 349 / 349** tests listed (was **0** with the unanchored pattern), 0 duplicate-mock warnings. Comment 1 is fixed. |
| New tests via `npm test -- app/api/system/health lib/__tests__/system-initializer-removed` | ✅ 2 suites, 8/8 pass |
| B6 MSYS disclosure | ✅ Accepted. The §11.2 comparison stays valid: both sides were affected equally, neither tree had worktrees, and B5's config-driven `npm test` reproduced it. SA hit the same gotcha during this re-check. Note that with `MSYS_NO_PATHCONV=1`, `/c/...` path arguments are *also* no longer converted, so pass `C:/...` paths. |
| Main checkout left unmodified | ✅ Only `--listTests` was run there. Its `git status` shows only pre-existing or other-work entries. |

Code Review Comments 1–2 are resolved. **Code Approved for QA: Yes.** RM may commit after QA sign-off and user approval, as one commit for Slice 1 (atomicity per R-2). Part B may share it or be a separate `chore:` commit.

---

## QA Testing Report

**QA — 2026-09-19**
**Test mode:** full (Slice 1 ACs only; ACs 5–12 belong to Slice 2)
**Strategy used:** A (Jest: full suite plus the 8 new tests), C (`curl` scripts against the dev server on `http://localhost:3002`, run from this worktree), and manual browser checks (T13, logged-out part recorded by TL). Playwright is not set up (Q-F waiver), so the §6.2 guard test plus the manual matrix stand in for it.
**Focus:** api, security, ui
**Skipped:** Logged-in browser matrix (needs a user sign-in, PENDING). Vercel-preview `curl` checks (need a push, PENDING). `npm run build` and `tsc` were not re-run by QA; Dev's §11.2 results and SA's acceptance of them are relied on. `npm run lint` is non-functional repo-wide (D-1).
**Input source:** prompt keywords (TL task list) plus the SA "Notes for QA (T13)"

### Evidence recorded by TL (browser pane, logged OUT, port 3002)

| Check | Result |
|---|---|
| `/` normal load and reload | 0 `[data-sonner-toast]` elements, 0 `/api/system` resource entries |
| `/test-business-os` normal load and reload | 0 `[data-sonner-toast]` elements, 0 `/api/system` resource entries |
| Sonner Toaster still mounted | `section[aria-label^="Notifications"]` present |
| `/api/system/initialize`, `/api/system/status` | 404 for both GET and POST |
| `/api/system/health` | 200, `{"success":true,"data":{"status":"ok","timestamp":...}}`, a different timestamp on each of two calls |

### QA-run checks (dev server, port 3002)

| Check | Result |
|---|---|
| `GET` / `POST /api/system/initialize` (no auth) | 404 / 404 |
| `POST /api/system/initialize` with `Authorization: Bearer bogus-token-123` | 404 |
| `GET` / `POST /api/system/status` (no auth, `POST` body `{"agentId":"x"}`) | 404 / 404 |
| `GET` / `POST /api/system/status` with `Authorization: Bearer bogus-token-123` | 404 / 404 |
| 404 bodies for `/status` and `/initialize` | Next's HTML 404 page only. 0 matches for `agent_name`, `next_run`, `scheduledAgents`, `cleanup`, `executions`. |
| `GET /api/system/health` × 2, parsed with Node | HTTP 200, `content-type: application/json`. Top-level keys exactly `['data','success']`, `success === true`. `data` keys exactly `['status','timestamp']`, `status === 'ok'`. `timestamp` round-trips through `new Date(...).toISOString()`. The two timestamps differ (`…11:17:49.440Z` and `…11:17:53.631Z`). No `error`, `details`, `environment` or `database` key. |
| `POST` / `HEAD /api/system/health` | 405 / 200. Only `GET` is exported, as expected. |
| Served JS for `/` (6 initial chunks) | 0 matches for `api/system/(initialize\|status\|health)`, "NeuronForge scheduler is running" or "System initialization failed". This is supplementary only: `PlatformShell` loads through `next/dynamic`, so its chunk may not be among the initial scripts. |
| `/login` on this server | Returns HTTP 404 (no such route on this branch). The AC-1 "`/login`" row is therefore not applicable; `/` covers the logged-out marketing surface. |

### Jest

| Command (Git Bash, `MSYS_NO_PATHCONV=1`) | Result |
|---|---|
| `npm test` | Exit 1. Suites: **21 failed**, 8 skipped, 322 passed (343 of 351). Tests: **129 failed**, 58 skipped, 4,844 passed (5,031). Identical to §11.2 / B5. |
| Failing-suite set | The 21 suites are exactly the §B.3 list (5× `DeclarativeCompiler-*`, `v6-integration`, `v4-generator`, `v6-end-to-end`, `LogicalIRCompiler`, `EnhancedPromptToIRGenerator`, `logical-ir/schemas/validation`, `IRToNaturalLanguageTranslator`, `IntentClassifier`, `TokenBudgetManager`, `ConditionalEvaluator{,.contains_any}`, `StructuredTransforms{,.wp33,.wp37}`, `featureFlags`, `archetypes`). None touches this change. **No new failures compared with `main`'s pre-existing 21 suites / 129 tests.** |
| New tests (`npx jest --verbose app/api/system/health lib/__tests__/system-initializer-removed`) | 2 suites, **8/8 pass**. Route: 200 + exact envelope; valid ISO timestamp; no error/details/env; `force-dynamic`. Guard: plausible scanned-file count; removed files absent; no source reference to the removed routes; the literal check can fail on a synthetic hit. |
| `npm test -- --listTests` | Exit 0. **351** test files listed, **0** `.claude` paths, **0** `duplicate manual mock` warnings. |

### Grep verification (whole worktree, excluding `node_modules`, `.next`, `.git`)

| Check | Result |
|---|---|
| The 6 deleted files | All absent. `lib/startup/` and `lib/cleanup/` no longer exist. `app/api/system/` contains only `health/`. |
| `SafeSystemInitializer`, `SystemInitializer`, `initializeApplication`, `getApplicationStatus`, `applicationInitializer`/`ApplicationInitializer`, `__NEURONFORGE_INITIALIZED__`, `executionCleanup`, `startAutomaticCleanup`/`stopAutomaticCleanup`, `getCleanupStats`, `cleanupOrphanedExecutions`, `/api/system/initialize`, `/api/system/status`, `lib/startup`, `lib/cleanup` | Hits only in the requirement doc, this workplan, the guard test (which must name what it guards), and `tsconfig.tsbuildinfo` (gitignored by `.gitignore:44` `*.tsbuildinfo`, regenerated by Dev's build). **No source hit.** |
| `SystemStatus` as a whole word in `.ts`/`.tsx` | 0 hits (only the unrelated `SystemStatusCard` remains) |
| `/api/system/health` | Only the route, its test, `docs/VERCEL_ENV_SETUP.md:183` (amended) and the two cycle docs |
| Toast strings (`scheduler is running`, `System initialization failed`, `system is ready`) in `.ts`/`.tsx` | Only unrelated hits (memory-consolidation admin route, Business OS `SystemReadiness`, orchestration comments, a script). None are the removed toast. |
| AC-16 `console.*` count | `components/PlatformShell.tsx` 0, `app/api/system/health/route.ts` 0 |
| `/health` route source | No `supabase` import and no `process.env` read. `PlatformShell` diff removes only the import and render lines and rewrites the doc comment; the `SessionHandler` → `UserProvider` → `{children}` → `Toaster` order is unchanged (C-5). |

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| **AC-1** No "System Ready" / "System initialization failed" toast, logged in and out | ⚠️ | **Partial: PASS logged out, PENDING logged in** | Logged out: TL browser evidence for `/` and `/test-business-os` (load and reload, 0 sonner toasts). `/login` is a 404 on this branch, so it does not apply. Logged in (`/`, `/test-business-os`, a Business OS page): **PENDING user sign-in.** The code path is gone (component deleted, guard green), so the risk is low, but it has not been observed. |
| **AC-2** No browser request to `/api/system/*` | ⚠️ | **Partial: PASS logged out, PENDING logged in** | Logged out: TL recorded 0 `/api/system` resource entries on both pages. Automated backstop: the guard test passes. Logged-in check is PENDING. |
| **AC-3** Both components gone, nothing references them | ✅ | **PASS** | Files absent. Whole-tree grep has no source reference. The guard test asserts it. |
| **AC-4** Other toasts still render, Toaster intact | ⚠️ | **Partial: structural PASS, functional PENDING** | Toaster is mounted (`section[aria-label^="Notifications"]`, TL) and the `PlatformShell` diff leaves it unchanged. **A real sonner toast on a logged-in Business OS page (a save or a validation error) is PENDING the user sign-in.** |
| **AC-13** `POST /api/system/initialize` → 404 | ✅ | **PASS (dev); preview PENDING** | 404 for GET, POST, and POST with a bogus bearer. Re-run on the Vercel preview after push. |
| **AC-14** `/api/system/status` returns no data, unauthenticated or non-admin | ✅ | **PASS (dev); preview PENDING** | 404 for GET and POST, with and without a bogus bearer, and the 404 body holds no agent data. The route file does not exist, so a logged-in non-admin cookie cannot reach it either (no handler to authorise against). A literal cookie-based check is folded into the logged-in pass. |
| **AC-15** `/health` does no service-role query and leaks no error or env detail | ✅ | **PASS (dev); preview timestamp check PENDING** | Exact envelope and key sets verified, HTTP 200, differing timestamps, no Supabase import, no env read, and the route test mocks `@/lib/supabaseServer` to throw. On the dev server `force-dynamic` is not really tested (dev never statically renders), so **the Vercel-preview two-call timestamp check is the real test and stays PENDING until after push.** Build output (`ƒ` for this route, §11.2) is supporting evidence. |
| **AC-16** No `console.*` in surviving touched files | ✅ | **PASS** | 0 and 0 |
| **AC-17** (Slice 1 portion) build, lint, tests | ⚠️ | **PASS with recorded exceptions** | `npm test`: no new failures, 8/8 new pass, same 21 pre-existing failing suites as `main`. Build exit 0 (Dev §11.2, not re-run by QA). `npm run lint` is non-functional repo-wide (D-1, pre-existing); ESLint run directly on touched files gave 0 problems (Dev + SA). Playwright clause waived (Q-F). |
| **Part B** `.claude` excluded from Jest collection | ✅ | **PASS** | `--listTests`: 351 files, 0 `.claude` paths, 0 duplicate-mock warnings. `npm test` script works. |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The two 500 ms-delayed `/api/system/*` round trips are gone from page loads (0 resource entries observed).

#### Edge Cases (nice to fix)
1. **`/login` returns 404 on this branch.** AC-1 and the §6.1 matrix name `/login`, but the route does not exist, so that row is not applicable. This is not caused by Slice 1. The requirement and §6.1 text should not be read as implying a login page at that path. Severity: Low (documentation only).

#### Pre-existing / out of scope (recorded, not caused by this change)
- 21 failing Jest suites / 129 failing tests on `main` (§B.3). `npm test` exits 1 on `main` and on this branch alike.
- `npm run lint` is non-functional (D-1).

### Pending items (must close before or right after merge)

| # | Item | Owner | Blocks |
|---|---|---|---|
| P-1 | Logged-in matrix: `/`, `/test-business-os`, one Business OS page. Normal load and hard refresh, DevTools Network filtered on `api/system` with Preserve log, watch about 3 s. Expect 0 toasts and 0 requests (AC-1, AC-2). | User signs in, then QA/TL runs it | Commit sign-off |
| P-2 | AC-4 functional: trigger a real sonner toast (save or validation error) on a logged-in Business OS page and confirm it renders top-centre. | Same session as P-1 | Commit sign-off |
| P-3 | Vercel preview: `POST /api/system/initialize` → 404; `GET`/`POST /api/system/status` → 404; `GET /api/system/health` twice about a second apart → exact envelope with **different** timestamps (the real `force-dynamic` test). | QA after RM pushes | Merge to `main` |

### Test Outputs / Logs

```text
GET /api/system/initialize -> 404
POST /api/system/initialize -> 404
GET /api/system/status -> 404
POST /api/system/status -> 404
GET status bogus-bearer -> 404
POST status bogus-bearer -> 404
POST initialize bogus-bearer -> 404
HTTP/1.1 200 OK  content-type: application/json
{"success":true,"data":{"status":"ok","timestamp":"2026-09-19T11:16:35.820Z"}}
{"success":true,"data":{"status":"ok","timestamp":"2026-09-19T11:16:38.828Z"}}
POST /api/system/health 405 ; HEAD 200

npm test:
Test Suites: 21 failed, 8 skipped, 322 passed, 343 of 351 total
Tests:       129 failed, 58 skipped, 4844 passed, 5031 total

npm test -- --listTests: exit 0, 351 listed, 0 .claude, 0 duplicate-mock warnings

PASS app/api/system/health/__tests__/route.test.ts (4)
PASS lib/__tests__/system-initializer-removed.guard.test.ts (4)
Tests: 8 passed, 8 total
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Conditional pass.** No bugs found. Every Slice 1 AC that can be checked without a signed-in user or a deployed preview passes. Commit sign-off waits on **P-1 and P-2** (logged-in browser matrix and AC-4 functional toast). Merge to `main` waits on **P-3** (Vercel-preview checks).

---

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Created (Planning) | Dev workplan for Slice 1 per SA §C. FR-5.1 sweep recorded (no external importer; two false-positive families). Decided to delete both `lib/startup/initialize.ts` and `lib/cleanup/executionCleanup.ts`. Six questions for SA. |
| 2026-09-19 | SA workplan review — APPROVED WITH CONDITIONS | SA grep confirmed the §3 sweep. SA confirmed deleting both libs in Slice 1. Resolved Q-A to Q-F: keep `/health` as liveness, body amended to the standard `{ success, data }` envelope, no logging, `force-dynamic`, add the guard test, manual QA in place of Playwright. Conditions C-1 to C-5, including excluding `.claude/` from the jest baseline and the tsc OOM check. |
| 2026-09-19 | Slice 1 implemented (Code Complete) | T0–T12 done and C-1 to C-5 applied: 6 files deleted, `PlatformShell` trimmed, `/health` became a `{ success, data }` liveness probe, 2 tests added, VERCEL doc line amended. tsc 2,038 → 2,037, Jest has no new failures compared with `main`, build passes. `npm run lint` is non-functional repo-wide, so ESLint was run directly (D-1). T13 is left to QA. |
| 2026-09-19 | Part B added (user-expanded scope) | Test command hygiene: `.claude/` in Jest's `testPathIgnorePatterns`, an `npm test` script, and CLAUDE.md § Testing corrected (E2E not set up). `npm test` gives the same results as the C-2 command. |
| 2026-09-19 | SA code review: Part A approved; Part B fixes applied (B6) | Anchored the Jest ignore to `<rootDir>/.claude/` (HIGH: unanchored, it listed 0 tests from inside a nested worktree) and added `modulePathIgnorePatterns: ['<rootDir>/.claude/']` (MEDIUM: duplicate-mock warnings). Verified with a nested probe worktree: 351 tests listed from root and from inside it, 0 `.claude` paths, 0 warnings. 8/8 new tests pass. Noted that Git Bash mangled the §11.2 C-2 CLI patterns, and why the results still hold. |
| 2026-09-19 | SA code review — Fix Required (Part B only) | Slice 1 Code Approved: C-1 to C-5 met, guard mutation-tested, 8/8 new tests pass, eslint clean. Part B needs 2 one-line `jest.config.js` fixes. Anchor the ignore to `<rootDir>/.claude/` (the unanchored form lists 0 tests inside `.claude/worktrees/*` checkouts), and add `modulePathIgnorePatterns: ['<rootDir>/.claude/']` (9 duplicate-mock haste warnings). QA may start T13. |
| 2026-09-19 | SA code re-check — Code Approved | B6 fixes verified. Main checkout: 303 tests, 0 `.claude`, 0 duplicate-mock warnings. Inside all 3 `.claude/worktrees/*` checkouts: 349–350 tests (was 0). 8/8 new tests pass. Part A + Part B approved for QA. |
| 2026-09-19 | QA report — conditional pass | Dev-server `curl` checks (404s including bogus bearer, exact `/health` envelope, differing timestamps), `npm test` (same 21/129 pre-existing failures as `main`, 8/8 new pass), `--listTests` (351, 0 `.claude`), grep sweep clean. TL's logged-out browser evidence recorded. No bugs. Pending: logged-in matrix + AC-4 functional toast (P-1, P-2), Vercel-preview checks (P-3). |
