# Workplan: PROD-1c F-8, Delete the Broken Run Debugger

> **Last Updated**: 2026-11-27

**Developer:** Dev
**Requirement:** Follow-up F-8 of PROD-1c A-1. The approved scope is quoted in section 1. Background: [PROD-1c A-1 workplan](/docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md) § 13.1 (typecheck row), § 16.1 (F-8 row), § 19 (F-8 row), and "SA Code Review (2026-11-27)" item 5
**Branch:** `fix/f8-delete-run-debugger` (created by RM from `origin/main` at `05732d73`, the merge of PR #694; confirmed by Dev with `git branch --show-current` before writing this file)
**Baseline read:** `05732d73`. Every file:line below is from that commit
**Date:** 2026-11-27
**Status:** Code Complete (Dev), not committed. SA approved the workplan with conditions; implemented per the rulings (D-4 overruled). The typecheck after-run (V-2), build (V-3) and render check (V-8) are left to the main session, see "Implementation Notes (Dev)"

## Overview

The step-by-step run debugger behind `/test-plugins-v2` has never worked. Its two routes (`POST /api/debug/control`, T-5; `GET /api/debug/stream`, T-6) call seven `DebugSessionManager` methods that do not exist, which A-1's typecheck found (9 errors) and QA confirmed at runtime (the stream route answers 500, `waitForSession is not a function`). The user decided to delete it rather than repair it. This slice deletes the two routes, the hook, the two components and the debugger panel in the tester page, and updates the one test and the one guard floor that count those routes. `DebugSessionManager` itself stays, because the V6 execution engine (`lib/pilot/WorkflowPilot.ts`) still imports it. The engine and the production run routes are not touched; what they still do with `debugMode` is recorded as a follow-up (section 12).

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [The DebugSessionManager decision](#3-the-debugsessionmanager-decision)
4. [Files to delete / modify](#4-files-to-delete--modify)
5. [The tester page, block by block](#5-the-tester-page-block-by-block)
6. [Guards and tests: every list or count, and its delta](#6-guards-and-tests-every-list-or-count-and-its-delta)
7. [Decisions for SA](#7-decisions-for-sa)
8. [Documentation](#8-documentation)
9. [`console.*` in files this slice modifies](#9-console-in-files-this-slice-modifies)
10. [Verification plan](#10-verification-plan)
11. [Risks and rollback](#11-risks-and-rollback)
12. [Observed, out of scope](#12-observed-out-of-scope)
13. [Task list](#13-task-list)
14. [SA Review Notes](#sa-review-notes)
15. [Implementation Notes (Dev)](#implementation-notes-dev)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

Decided by the user on 2026-11-27:

> "Slice F-8 (follow-up to PROD-1c A-1): delete the broken run debugger.
> Delete:
> - app/api/debug/control/route.ts and app/api/debug/stream/route.ts
> - hooks/useDebugStream.ts
> - components/debug/*
> - the debug-mode panel, its state and its imports in app/test-plugins-v2/page.tsx
> - lib/debug/DebugSessionManager.ts, only if nothing else imports it (grep first)
> Then update every guard or test that lists these routes. A-1's test-surface route inventory (lib/security/__tests__/testSurfaceRoutes.test.ts) and tests/helpers/source-scan.ts may count them, so make the counts drop by exactly the deleted routes. Confirm /test-plugins-v2 still builds and renders without the panel; npm run build must pass. Check the typecheck: the 9 pre-existing errors in the two debug routes should disappear, with no new ones."

Not in scope: repairing the debugger; any change under `lib/pilot/` (V6 territory, CLAUDE.md rule 8); any change to `app/api/run-agent/route.ts` or `app/api/run-agent-sandbox/route.ts`.

---

## 2. Analysis summary

What the debugger is, end to end:

| Layer | File | Lines | Role |
|---|---|---|---|
| UI | `app/test-plugins-v2/page.tsx` | 5853 | The tester page. Its Agent Execution tab has a "Step-by-Step Debug Mode" toggle that swaps the Execute button for `DebugControls`, shows a `StepVisualizer` and a "Debug Events" panel |
| Hook | `hooks/useDebugStream.ts` | 324 | Opens an `EventSource` on `/api/debug/stream`, posts commands to `/api/debug/control`, keeps step statuses |
| Components | `components/debug/DebugControls.tsx`, `StepVisualizer.tsx`, `index.ts` | 228, 371, 2 | Controls and the step timeline |
| Routes | `app/api/debug/control/route.ts` (T-5), `app/api/debug/stream/route.ts` (T-6) | 106, 103 | Gated in production by A-1; both call `DebugSessionManager.pause/resume/step/stop/waitForSession/getEvents/subscribe`, none of which exist |
| Engine | `lib/debug/DebugSessionManager.ts`, `lib/pilot/WorkflowPilot.ts` | — | The session map and the per-step hooks. **Stay** (section 3) |

**Every importer, re-grepped on `05732d73`** across `.ts`, `.tsx`, `.js`, `.json`, `.yml`, `.sh`, `.github/`, `middleware.ts`, `next.config.js`, `vercel.json`, `tsconfig.json`, the ESLint configs and `jest.config*`, plus relative-path imports and `require(...)`:

```bash
git grep -n -I -E "DebugSessionManager|useDebugStream|components/debug|api/debug/(control|stream)|DebugControls|StepVisualizer|debug/control|debug/stream" -- . ':!docs/archive'
```

| Reference to a deleted file | From |
|---|---|
| `@/hooks/useDebugStream` | `app/test-plugins-v2/page.tsx:9`, `components/debug/DebugControls.tsx:4`, `components/debug/StepVisualizer.tsx:4` |
| `@/components/debug/DebugControls`, `StepVisualizer` | `app/test-plugins-v2/page.tsx:10-11`, `components/debug/index.ts:1-2` |
| `/api/debug/stream`, `/api/debug/control` (URL strings) | `hooks/useDebugStream.ts:173`, `:224` |
| `@/app/api/debug/control/route`, `.../stream/route` | `lib/security/__tests__/testSurfaceRoutes.test.ts:115-116`, HANDLERS rows `:127-128` |
| `app/api/debug/**` (a glob in a comment) | `lib/security/testSurfaceGate.ts:8` (D-1) |
| Docs | `docs/V2_TEST_PAGE_SCOPE.md`, `docs/DEBUG_INTEGRATION_GUIDE.md`, `docs/AGENT_SANDBOX_DEBUGGER.md`, and the A-1 workplan (section 8) |

Nothing in `.github/`, `scripts/`, any config file, `middleware.ts` or any other test names these files. `components/debug` has no other consumer (no relative import, no `require`). So after the deletion the only code edits are the tester page and the routes test, plus one floor in the G-9 guard (section 6).

---

## 3. The DebugSessionManager decision

**It stays.** The scope deletes it "only if nothing else imports it". Something does:

| Importer | Use | After F-8 |
|---|---|---|
| `lib/pilot/WorkflowPilot.ts:56` | `getSession`/`createSession` `:210-212`, `cleanup` `:932`, `:1083`, `emitEvent` `:1401`, `:1769`, `:1799`, `:1932`, `checkPause` `:1418` | Still imports it. Not edited (V6 territory, CLAUDE.md rule 8) |
| `app/api/debug/control/route.ts:10` | — | Deleted |
| `app/api/debug/stream/route.ts:10` | — | Deleted |
| `lib/security/__tests__/testSurfaceRoutes.test.ts:58` | `jest.mock` only | Mock removed (D-2) |

Every method `WorkflowPilot` calls exists on the class (`lib/debug/DebugSessionManager.ts`: `getSession`, `createSession`, `cleanup`, `emitEvent`, `checkPause`), so removing the routes leaves no dangling call. The file has no import-time side effect (a static `Map`, no timer).

---

## 4. Files to delete / modify

| File | Action | Reason |
|---|---|---|
| `app/api/debug/control/route.ts` | delete | Scope. T-5 |
| `app/api/debug/stream/route.ts` | delete | Scope. T-6. `app/api/debug/` becomes empty and goes with it |
| `hooks/useDebugStream.ts` | delete | Scope |
| `components/debug/DebugControls.tsx` | delete | Scope |
| `components/debug/StepVisualizer.tsx` | delete | Scope |
| `components/debug/index.ts` | delete | Scope. `components/debug/` becomes empty |
| `app/test-plugins-v2/page.tsx` | modify | Remove the debugger imports, state, hook, handlers and JSX (section 5). The normal run and the sandbox run keep working |
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | modify | Drop the T-5 and T-6 imports and HANDLERS rows, the dead `DebugSessionManager` mock and its `debugSession` work counter, and fix the header (section 6.1) |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | G-9 R1 discovery floor 13 → 11 (section 6.2) |
| `docs/V2_TEST_PAGE_SCOPE.md` | modify | Remove the debugger from the page's living doc; changelog entry (section 8) |
| `docs/DEBUG_INTEGRATION_GUIDE.md` → `docs/archive/DEBUG_INTEGRATION_GUIDE.md` | move + banner | Describes the deleted integration as built (section 8) |
| `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md` | modify | Point its F-8 rows (§ 16.1, § 19) at this slice; Change History row (section 8) |
| `docs/workplans/prod-1c-f8-delete-run-debugger-workplan.md` | create | This file |

**Not modified:** `lib/debug/DebugSessionManager.ts`, `lib/pilot/WorkflowPilot.ts`, `app/api/run-agent/route.ts`, `app/api/run-agent-sandbox/route.ts` (section 12), `lib/security/testSurfaceGate.ts` (D-1), `tests/helpers/source-scan.ts` (section 6.3), `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (section 6.3), `docs/AGENT_SANDBOX_DEBUGGER.md` (section 8).

---

## 5. The tester page, block by block

Line numbers are `app/test-plugins-v2/page.tsx` at `05732d73`. **The page's general activity log stays**: `DebugLog` (`:35`), `debugLogs` / `setDebugLogs` / `addDebugLog` (`:928-935`) and the Debug Logs panel are the page-wide log every tab writes to, not the debugger. Only the `addDebugLog(...)` calls that sit inside removed blocks go with them.

### 5.1 Imports, types, state, hook

| Lines | Today | Action | After |
|---|---|---|---|
| `:9` | `import { useDebugStream, DebugState, StepStatus } from '@/hooks/useDebugStream';` | remove | `DebugState` and `StepStatus` are used nowhere else in the file |
| `:10-11` | `DebugControls`, `StepVisualizer` imports | remove | — |
| `:8` | `import { v4 as uuidv4 } from 'uuid';` | **keep** | 9 occurrences today; the 2 in removed blocks (`:2460`, `:2603`) go; the import and 6 uses (`:1262`, `:1274`, `:1292`, `:1293`, `:1988`, `:2053`) stay |
| `:25` | comment `// Workflow step interface for step visualization` | reword | `// Workflow steps of the agent selected in the Agent Execution tab`. The `WorkflowStep` interface stays (D-3) |
| `:897` | comment `// Step-by-step Debug Execution state` | reword | `// Selected agent state (Agent Execution tab)` |
| `:898` | `const [debugModeEnabled, setDebugModeEnabled] = useState(false);` | remove | — |
| `:899-900` | `selectedAgentDetails`, `agentWorkflowSteps` | **keep** | Still read by the "Selected:" info block (D-3) |
| `:910-925` | `// Debug stream hook` and `const debugStream = useDebugStream({...})` (3 `addDebugLog` calls inside) | remove, with the blank line after | — |

### 5.2 Handlers

| Lines | Today | Action | After |
|---|---|---|---|
| `:2334-2335` | `loadAgentDetails`: comment + `debugStream.initializeSteps(...)`, then a blank line | remove (with one of the two blank lines) | `setAgentWorkflowSteps(workflowSteps)` (`:2332`) and the success log stay |
| `:2356-2411` | `executeAgent` (the normal run): posts `/api/run-agent` with `agent_id`, `input_variables`, `override_user_prompt`, `execution_type: 'test'`, `use_agentkit` | **unchanged** | It never sent `debugMode` and still does not |
| `:2456-2457` | `executeSandbox`: `// Update workflow steps for visualization` + `setAgentWorkflowSteps(parsedSteps)` | remove (D-3) | Only fed the visualizer |
| `:2459-2475` | `executeSandbox`: `runId = debugModeEnabled ? uuidv4() : undefined` and the `if (debugModeEnabled && runId) {...}` SSE connect + 500 ms wait | remove, with the blank line after | — |
| `:2490-2491` | `executeSandbox` body fields `debugMode: debugModeEnabled,` and `debugRunId: runId,` | remove | The body is `agent_name`, `pilot_steps`, `plugins_required`, `input_variables`, `user_prompt`. Today's non-debug sandbox run sends `debugMode: false` and no `debugRunId` (`undefined` is dropped by `JSON.stringify`); the route defaults `debugMode = false` (`app/api/run-agent-sandbox/route.ts:71`), so omitting the key is the same request in effect |
| `:2498-2503` | `if (debugModeEnabled && !result.success) { debugStream.disconnect(); }` with its two comments, and the blank line after | remove | — |
| `:2522-2524` | `catch`: `if (debugModeEnabled) { debugStream.disconnect(); }` | remove | The `catch` keeps its log and `setAgentExecutionResult(...)` |
| `:2552-2553` | `importSandboxJson`: `// Also update workflow steps for visualization` + `setAgentWorkflowSteps(steps)` | remove (D-3) | `setSandboxPilotSteps(...)` stays |
| `:2587-2685` | `startDebugExecution` (posts `/api/run-agent` with `debugMode: true`, `debugRunId`, `use_agentkit: false`) and `handleDebugPause/Resume/Step/Stop/Reset` (11 `addDebugLog` calls inside), and the blank line after `:2685` | remove | — |
| `:2694` | `resetAgentExecutionForm`: `debugStream.reset();` | remove | The rest of the reset stays |

### 5.3 JSX

| Lines | Today | Action | After |
|---|---|---|---|
| `:5128` | `✓ {n} workflow steps found - Debug mode available` | reword | `✓ {n} workflow steps found`. The "⚠ No workflow steps - Standard execution only" branch (`:5132`) becomes `⚠ No workflow steps found` (D-3) |
| `:5180-5221` | "Execution Options" `<div>`: the AgentKit checkbox (DB mode only), then the "Step-by-Step Debug Mode" toggle `:5198-5220` | remove the toggle `:5198-5220` (and the blank line `:5197`); in the AgentKit checkbox, `onChange` becomes `(e) => setUseAgentKit(e.target.checked)` (drop `:5190`) and `disabled={debugModeEnabled}` (`:5192`) goes; render the whole `<div>` only when `!sandboxMode` (D-4) | AgentKit checkbox, always enabled, in DB mode; nothing in sandbox mode |
| `:5223-5259` | `{!debugModeEnabled && ( <div>Execute / Reset Form</div> )}` | unwrap: drop `:5224` and `:5259`, dedent the block by two spaces (D-5) | The Execute and Reset Form buttons always show, exactly as they do today with debug mode off |
| `:5261-5274` | `{debugModeEnabled && <DebugControls .../>}`, and the blank line before | remove | — |
| `:5277-5288` | `{debugModeEnabled && agentWorkflowSteps.length > 0 && <StepVisualizer .../>}` | remove, with the blank line after | — |
| `:5290-5354` | `{debugModeEnabled && debugStream.events.length > 0 && ( Debug Events panel )}` (1 `addDebugLog` call inside; the other of this region's 2 is in the visualizer, `:5285`) | remove, with the blank line after | "Execution Result Display" (`:5356`) follows the card directly |

### 5.4 Invariants to check after the edit

| Check | Before | After |
|---|---|---|
| `grep -c addDebugLog` | 170 | **153** (exactly the 17 in removed blocks: 3 + 1 + 11 + 2) |
| `debugLogs` / `setDebugLogs` / `DebugLog` (whole word) | 3 / 3 / 3 | 3 / 3 / 3 |
| `uuidv4` occurrences | 9 | 7 |
| Lines naming any of `debugStream`, `debugModeEnabled`, `useDebugStream`, `DebugControls`, `StepVisualizer`, `DebugState`, `StepStatus`, `startDebugExecution`, `handleDebug`, `debugMode`, `debugRunId` (one `grep -c -E` over the alternation) | 59, every one inside a removed block (checked line by line against the ranges above) | **0** |
| Lines saying "visualization" or "Debug mode" outside those blocks | 2 (`:25`, `:5128`) | 0 (both reworded) |
| `/api/run-agent` and `/api/run-agent-sandbox` fetches | 2 + 1 | 1 + 1 (the debug run's call goes) |

Edits are made with the Edit tool, one block at a time, never by rewriting the 5853-line file (the truncation hazard). `git diff --stat` must show this file with deletions plus a handful of changed lines only.

---

## 6. Guards and tests: every list or count, and its delta

### 6.1 `lib/security/__tests__/testSurfaceRoutes.test.ts`

| Item | Before | After | Delta |
|---|---|---|---|
| Route imports (`import * as … from '@/app/api/…/route'`) | 8 | 6 | −2 (`debugControl` `:115`, `debugStream` `:116`) |
| `HANDLERS` rows | 9 | **7** | −2 (`'T-5 POST /api/debug/control'` `:127`, `'T-6 GET /api/debug/stream'` `:128`) |
| Test cases (`it.each(HANDLERS)` × 4 describes: anonymous, non-admin, admin, off production) | 36 | **28** | −8 |
| `jest.mock(...)` calls | 13 | 12 | −1 (`@/lib/debug/DebugSessionManager`, `:58-75`; D-2) |
| `work` counters | 8 | 7 | −1 (`debugSession`, `:37`; D-2) |
| Header comment `:2-3`, `:7-8` | "T-3 to T-10"; "no debug session" | "T-3, T-4 and T-7 to T-10 (T-5 and T-6 were deleted in F-8)"; drop "no debug session" | wording |

### 6.2 `lib/__tests__/envConfigHardening.guard.test.ts` (G-9)

G-9 discovers the test surface by name: every `route.(ts|tsx|js)` under `app/` with a `test` or `debug` word in a segment (`TEST_SEGMENT`, `:230`). Discovered set on `05732d73`, recomputed with the same rule:

| Set | Before | After | Delta |
|---|---|---|---|
| Discovered routes (`surface.routes`) | 13 | 11 | −2 |
| of which gated (must await `testSurfaceRouteGate`, R2) | 8 routes / 9 handlers | 6 routes / 7 handlers | −2 / −2 |
| of which exempt (`TEST_SURFACE_EXEMPT`, T-12 to T-16) | 5 | 5 | 0 |
| `app/test-*` page dirs | 2 | 2 | 0 |
| **R1 floor** `expect(surface.routes.length).toBeGreaterThanOrEqual(13)` (`:673`) | 13 | **11** | −2 |

**The floor must move, or G-9 R1 goes red**: it sits exactly at today's 13, so 11 routes fails it. The floor stays a floor (`toBeGreaterThanOrEqual`), lowered by exactly the two deleted routes. No exemption, no matcher and no self-test changes; the self-test segment list (`:985`) includes `'debug'` as a pattern and stays. The number of `it` blocks in the suite is unchanged.

### 6.3 Checked, no change needed

| File | Why it does not change |
|---|---|
| `tests/helpers/source-scan.ts` | A parser library (`stripComments`, `blankStringLiterals`, `scanHandlers`, …). It contains no route list, no count and no "debug" string; it counts nothing |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | Scans `app/api/admin/**` and `app/admin/**`. Its floors (`SCANNED > 500`, `ADMIN_API_ROUTES >= 40`) and its allow-lists and caps never name a debug file; removing 6 files from a corpus of ~5,000 changes no assertion |
| `lib/security/__tests__/testSurfaceGate.test.ts` | Unit test of the gate; names no route |
| `lib/security/testSurfaceGate.ts` | Comment only (D-1) |
| `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` | No debug route in its `UNGATED` map; floor `files.length > 10` unaffected |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | `routes.length > 20` over all routes; unaffected |
| `.github/workflows/*`, `package.json` scripts, `eslint.hooks.config.mjs`, `tsconfig.json`, `scripts/typecheck-bos-llm.ts` | No file list naming these files (grep, section 2) |

No `console.*` ratchet or ceiling names `hooks/useDebugStream.ts` (its 6 `console.*` calls leave with it).

---

## 7. Decisions for SA

| # | Decision | Dev recommendation |
|---|---|---|
| D-1 | `lib/security/testSurfaceGate.ts:8` lists `app/api/debug/**` among the paths the gate guards; after F-8 that directory is empty | **Leave the comment unchanged.** The list names a class of path, and G-9 still enforces it: any future route with a `debug` segment must await the gate (`TEST_SEGMENT`). The next sentence ("Two of those had no authentication at all") is past tense and still true as history. Leaving it keeps a load-bearing module out of the diff. Alternative if SA prefers: append "(empty since F-8; kept because G-9 still gates any `debug` segment)" |
| D-2 | `testSurfaceRoutes.test.ts` mocks `DebugSessionManager` and counts `work.debugSession` | **Remove both.** After F-8 the only importer is `WorkflowPilot`, which this test already mocks (`:92-96`), and no remaining route (T-3, T-4, T-7 to T-10) imports `DebugSessionManager` directly (their imports checked). The mock would be dead and the counter could never move, which reads as coverage it is not |
| D-3 | `agentWorkflowSteps` (and the `WorkflowStep` type) were state for the visualizer | **Keep the state**; it still feeds the "Selected: … N workflow steps found" line in DB mode. **Remove its two sandbox-only writes** (`:2456-2457`, `:2552-2553`), whose comments say they exist "for visualization": with the visualizer gone nothing in sandbox mode reads them, and today they can leave a sandbox step count showing against a previously selected DB agent. Reword the info line so it no longer promises a debug mode |
| D-4 | Removing the toggle leaves the "Execution Options" `<div>` empty in sandbox mode (a 15 px spacer) | **Render the `<div>` only when `!sandboxMode`.** Alternative: keep the `<div>` and accept the spacer |
| D-5 | The unwrapped Execute / Reset Form block | **Dedent by two spaces**, so the JSX nesting reads true. Review with `git diff -w` to see that this hunk is whitespace plus the two removed wrapper lines |
| D-6 | Docs (section 8) | Edit `V2_TEST_PAGE_SCOPE.md`; archive `DEBUG_INTEGRATION_GUIDE.md`; leave `AGENT_SANDBOX_DEBUGGER.md` |

---

## 8. Documentation

| Doc | What it is | Action |
|---|---|---|
| `docs/V2_TEST_PAGE_SCOPE.md` | The living functional doc of `/test-plugins-v2` | **Edit.** Overview item 5 (`:16`, "with debug mode and step visualization"); Tab 5 purpose (`:591`); delete § 5.4 "Debug Mode Execution" (`:609-669`); the endpoint list (`:678-680`: drop the two debug endpoints and "with optional `debugMode`, `debugRunId`"); the state list (`:781-792`: drop `debugModeEnabled` and the `useDebugStream` block, keep `selectedAgentDetails` and `agentWorkflowSteps`); the key-function list (`:841-846`); delete UC-10 "Debug Agent Execution (Step-by-Step)" (`:942-955`) and leave the other UC numbers alone. Add a "Version 1.9.3" changelog entry in the doc's own changelog style, and update its closing "Last Updated" line. The Version 1.3 changelog entry (`:1314-1319`) is history and stays |
| `docs/DEBUG_INTEGRATION_GUIDE.md` | A "next steps" guide that lists the two routes and the manager as "✅ created" and shows how to call them | **Archive:** `git mv` to `docs/archive/`, with the archive banner used there (`> **ARCHIVED — 2026-11-27.** …`) saying: the debugger this guide integrates (the two debug routes, the `useDebugStream` hook, `components/debug/`) was deleted in PROD-1c F-8 because it never worked; `lib/debug/DebugSessionManager.ts` remains, used by `lib/pilot/WorkflowPilot.ts`. Nothing links to it (grep) |
| `docs/AGENT_SANDBOX_DEBUGGER.md` | The MVP summary of `app/v2/sandbox/[agentId]/page.tsx`, the product's own sandbox page, which still exists and does not use this debugger. It names the debug routes only as future work ("Next Steps … Create `app/api/debug/stream/route.ts`") | **Leave.** It does not describe a deleted thing as existing, and it is about a page this slice does not touch |
| `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md` | The A-1 workplan | **Edit two rows and add one history row.** § 16.1 F-8 and § 19 F-8: append "Slice: `docs/workplans/prod-1c-f8-delete-run-debugger-workplan.md` (branch `fix/f8-delete-run-debugger`)". A Change History row and the header "Last Updated". Everything else there (the § 5 inventory, § 13.1 "13 routes", the QA probes) is a record of A-1 and stays as written |

The TL brief mentioned "a couple of other workplans" that mention the debugger: on `05732d73` the only workplan that names these files is the A-1 workplan itself (`git grep -l` over `docs/`). `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md:4016` mentions `DebugSessionManager` in a change-history entry; history, left alone.

The new and edited docs avoid backslash sequences, because Tailwind scans `docs/` and a backslash followed by hex digits breaks `next build`.

---

## 9. `console.*` in files this slice modifies

CLAUDE.md § Logging: flag, propose, convert. Counted with `grep -c -F "console."` on `05732d73`:

| File (modified, not deleted) | `console.*` | Proposal |
|---|---|---|
| `app/test-plugins-v2/page.tsx` | 0 | None needed (already on `clientLogger`) |
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | 0 | None needed |
| `lib/__tests__/envConfigHardening.guard.test.ts` | 0 | None needed |

Deleted files do not count; for the record, `hooks/useDebugStream.ts` has 6 and the other five deleted files 0. `lib/pilot/WorkflowPilot.ts` carries many `console.*` calls (several on the debug lines in section 12) but is **not** touched by this slice; it belongs to the section 12 follow-up.

---

## 10. Verification plan

**Prerequisite:** `node_modules` linked into the worktree by TL (no `npm install`).

| # | Check | Pass when |
|---|---|---|
| V-1 | **Baseline typecheck, before the first edit.** Baseline = this worktree at `05732d73` with no edits (`git status --short` empty, `git rev-parse HEAD` = `05732d73…`). That is the same tree `git archive 05732d73` would give, and cheaper. A-1's "9 errors in the two debug routes" is a cross-check only: it was measured on the A-1 branch, not on `05732d73`. First delete `.next/types/` (git-ignored build output; this worktree holds a stale copy that still includes `.next/types/app/api/debug/{control,stream}`, which would skew both runs). Then `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json > <scratch>/tsc-before.txt 2>&1; echo "exit=$?"` | It **finished**: exit 0 or 2, the output ends in diagnostics, and contains no `FATAL ERROR`, `heap out of memory` or `Last few GCs` (a V8 crash prints no diagnostics and reads as clean). Record: the repo-wide total; the errors in the 6 deleted files (expect 9, all in the two routes); the errors in `page.tsx`, `testSurfaceRoutes.test.ts` and `envConfigHardening.guard.test.ts` (as message text, since line numbers will shift) |
| V-2 | **After typecheck.** Delete `.next/types/` again, same command into `tsc-after.txt` | Finished (same test as V-1). No error names a deleted file. For each of the three modified files, the after set of messages is a subset of the before set (**zero new errors**). Repo-wide total after = total before − (errors in deleted files) − (errors on removed `page.tsx` lines, if any). Any other difference is investigated, not explained away |
| V-3 | `npm run build`, with the CI placeholder env from `.github/workflows/build.yml` (`.invalid` hosts, placeholder keys, `NODE_OPTIONS=--max-old-space-size=6144`) | Exit 0, `Compiled successfully`, no OOM. The route table lists `/test-plugins-v2` and no longer lists `/api/debug/control` or `/api/debug/stream` |
| V-4 | **G-9 floor proof.** After the deletion, run `npx jest lib/__tests__/envConfigHardening.guard.test.ts` **before** lowering the floor | R1 is red with 11 found against a floor of 13 (proves the count is exact). Then lower to 11: green |
| V-5 | `npx jest lib/security/__tests__ lib/__tests__/envConfigHardening.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts` | `testSurfaceRoutes` 28 cases green (was 36); `testSurfaceGate` unchanged and green; `envConfigHardening` same case count, green; admin surface guard same count as on `05732d73`, green. Known exception: `publicEndpointsAreThrottled.guard.test.ts` fails 3 cases on Windows only (F-9, path separators, pre-existing); it passes on CI's Linux runner |
| V-6 | `npm run lint:hooks` | 0 warnings (the page is edited, a hook file is deleted) |
| V-7 | The section 2 grep again, and the section 5.4 invariants | Only `lib/pilot/WorkflowPilot.ts`, `lib/debug/DebugSessionManager.ts`, archived docs and historical workplan text still match. Invariants hold |
| V-8 | **Render check in the dev server** (`npm run dev`; off production, so the gate is open). Done by Dev and repeated by QA, not asked of the user | `/test-plugins-v2` renders; the browser console has no error. Agent Execution tab, DB mode: no "Step-by-Step Debug Mode" toggle, no debug controls, no "Workflow Steps" timeline, no "Debug Events" panel; the AgentKit checkbox toggles freely; selecting an agent shows "✓ N workflow steps found". **Execute Agent** runs and its request (network tab) is `POST /api/run-agent` with `agent_id`, `input_variables`, `execution_type: 'test'`, `use_agentkit`, and no `debugMode` / `debugRunId`, i.e. the same body as today. Sandbox mode: no empty options block; **Execute Sandbox** posts `/api/run-agent-sandbox` without `debugMode`. **Reset Form** works. `GET /api/debug/stream?runId=x` and `POST /api/debug/control` answer 404 |

---

## 11. Risks and rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| G-9 R1 goes red because the floor was not lowered | Certain if forgotten | Section 6.2; V-4 proves it red, then green |
| An edit in the 5853-line page removes part of the general activity log or the normal run | Low | Edit tool, block by block; the section 5.4 invariants (`addDebugLog` exactly 170 → 153, `debugLogs` unchanged); V-8 |
| A stale `.next/types/` makes the typecheck compare unlike with unlike, or report errors for the deleted routes | Present in this worktree | Delete `.next/types/` before each run (V-1, V-2) |
| A full typecheck dies of OOM and reads as clean | Medium on Windows | 8 GB heap; check for the V8 crash text and that diagnostics were printed (V-1) |
| Something outside the repo calls `/api/debug/*` | Very low | Both routes are already 404 in production for non-admins (A-1) and broken everywhere (500 / missing methods); the only caller was the deleted hook |
| A semantic conflict with a parallel branch that edits the tester page or the routes test | Low | RM syncs from `main` and re-runs V-3 and V-5 before merge |

**Rollback:** revert the single F-8 commit (`git revert <sha>` on a new branch, through a PR). Nothing in this slice touches the database, the environment or the engine, so the revert restores the files and the two counts exactly.

---

## 12. Observed, out of scope

| # | Observation | Proposed owner |
|---|---|---|
| F8-1 | **Production run routes still accept `debugMode` / `debugRunId` from the request body, unvalidated (no Zod), and pass them to the engine.** `app/api/run-agent/route.ts:44-45`, `:104-105`, `:304-305`, and `app/api/run-agent-sandbox/route.ts:34-35`, `:71-72`, `:156-157`. Both routes require a signed-in user (`:111`, `:55`). With debug on, `WorkflowPilot` creates or **reuses** an in-memory session under the caller-chosen id (`lib/pilot/WorkflowPilot.ts:205-216`), and before **every** step emits an event, waits a hardcoded 5 seconds and calls `checkPause` (`:1399-1422`), cleaning up at the end (`:931-933`, `:1082-1084`). With the UI gone nothing legitimate sends `debugMode`, but any signed-in user still can: every step of their run then costs 5 s more of serverless time, the events pile up in a map that nothing reads, and two callers choosing the same id share one session. Also `:1421` logs a `console.log` on **every** step of every normal run ("debugRunId is NOT set, skipping pause checkpoints") | **TL.** A follow-up slice that removes `debugMode` / `debugRunId` from both routes (or rejects them with Zod) and the debug hooks from `WorkflowPilot`. It touches `lib/pilot/`, so it needs the V6 Work Protocol (`v6-pipeline` skill § 4); once nothing calls it, `DebugSessionManager` can be deleted too. The three in-house callers already pass `false` (`app/api/v2/calibrate/batch/route.ts:1882`, `app/api/v6/execute-test/route.ts:157`, `lib/pilot/shadow/DryRunValidator.ts:86`) |
| F8-2 | `app/api/run-agent-sandbox/route.ts` parses its body as a typed cast (`const body: SandboxRequest = await req.json()`, `:61`) with no Zod schema (CLAUDE.md rule 2); so does `app/api/run-agent/route.ts`. Pre-existing | With F8-1 |
| F8-3 | Removing `debugMode` from the tester's sandbox body means the tester can no longer exercise the engine's debug path at all. That is intended (the path only existed for the deleted UI) and is one more reason for F8-1 | With F8-1 |

---

## 13. Task list

- ✅ 1. SA reviews this workplan; apply the rulings on D-1 to D-6
- ✅ 2. TL links `node_modules`; delete `.next/types/`; run the baseline typecheck (V-1) and record the numbers here (run by the main session; numbers in "Implementation Notes (Dev)")
- ✅ 3. Delete the two routes, the hook and `components/debug/*` (`git rm`)
- ✅ 4. Edit `app/test-plugins-v2/page.tsx` block by block (section 5); check the section 5.4 invariants
- ✅ 5. Edit `testSurfaceRoutes.test.ts` (section 6.1)
- ✅ 6. Run G-9 red at floor 13 (V-4), then lower the floor to 11 (section 6.2)
- ✅ 7. Docs: edit `V2_TEST_PAGE_SCOPE.md`, archive `DEBUG_INTEGRATION_GUIDE.md`, update the A-1 workplan's F-8 rows (section 8)
- ⬜ 8. After typecheck (V-2) and build (V-3): main session. ✅ Jest (V-5), `lint:hooks` (V-6), grep (V-7): Dev, "Implementation Notes (Dev)"
- ⬜ 9. Render and run check in the dev server (V-8): main session / QA (Dev was told not to start a dev server)
- ✅ 10. Record results and set Status to Code Complete; hand to SA for code review

---

## SA Review Notes

## SA Review (2026-11-27)

**Reviewed by SA, 2026-11-27, workplan phase, on `05732d73`**
**Status:** ✅ Approved with conditions (one decision overruled: D-4)

### What SA verified independently

| Claim | How SA checked it | Result |
|---|---|---|
| `DebugSessionManager` has one importer outside the deleted files | `git grep` for `lib/debug`, `DebugSessionManager`, relative `../debug` across the tree (not `docs/`) | ✅ Only `lib/pilot/WorkflowPilot.ts:56`, besides the two routes and the `jest.mock` in `testSurfaceRoutes.test.ts:58`. **The file stays; `lib/pilot/` is not touched** (CLAUDE.md rule 8). No import-time side effect (a static `Map`) |
| Nothing else references the hook, the components or the debug URLs | `git grep` for `api/debug`, `useDebugStream`, `components/debug`, `hooks/useDebug` excluding the files being deleted/edited | ✅ Only the comment `lib/security/testSurfaceGate.ts:8` (D-1). No CI workflow, script, ESLint/Jest/tsconfig entry, typecheck baseline (`scripts/.typecheck-business-chat.baseline`, `scripts/typecheck-bos-llm.baseline.json`) or other test names them |
| G-9 R1 set is 13 today, 11 after | Re-ran G-9's own rule outside Jest: same walk (`node_modules` and dot-dirs skipped, `__tests__` dropped), `/route\.(ts\|tsx\|js)$/`, `TEST_SEGMENT` over `split('/').slice(1, -1)` | ✅ 13 routes; the only two with a segment under `app/api/debug/` are `control/route.ts` and `stream/route.ts`. After: **11, exactly −2**. `app/api/v2/debug/data-check` stays on the surface (it is a different `debug` segment) |
| HANDLERS 9 → 7 | Read `testSurfaceRoutes.test.ts:124-134` | ✅ Exactly the T-5 and T-6 rows go; T-8's OPTIONS row stays |
| D-2: removing the mock is safe | Imports of the six remaining route files (T-3, T-4, T-7 to T-10) | ✅ None imports `lib/debug/*`. `WorkflowPilot` (the only transitive path) is already mocked at `:91-95`, and the other heavy imports are mocked too (`analyzePrompt-v3-direct`, `plugin-manager-v2`, `v5-generator`, `WorkflowPostValidator`). Even if a path did load the real module, it has no side effect |
| page.tsx block map | Read `:5-12`, `:24-27`, `:894-936`, `:2328-2340`, `:2440-2700`, `:5112-5300` | ✅ Every range matches. The page-wide log (`DebugLog`, `debugLogs`, `addDebugLog` `:926-935`) is outside every removed block. `addDebugLog` 170 today, and the 17 in removed blocks recount as 3 (hook) + 1 (`:2464`) + 11 (`:2590-2684`) + 2 (`:5285`, `:5298`). The 59-line alternation count matches |
| `uuidv4` stays used | `grep -n uuidv4` | ✅ 9 → 7: the import plus 6 uses at `:1262`, `:1274`, `:1292`, `:1293`, `:1988`, `:2053`. No import goes unused: `DebugState`/`StepStatus` exist only on `:9`; `useState`/`useEffect` etc. are used elsewhere |
| The normal run is unchanged; the sandbox body is equivalent | `executeAgent` `:2356-2411`; `run-agent-sandbox/route.ts:71` | ✅ `executeAgent` never sent `debugMode`. The sandbox route defaults `debugMode = false`, so dropping the two keys does not change behaviour |
| `.next/types/` skew | `tsconfig.json` `include` has `.next/types/**/*.ts`; `ls .next/types` | It is **absent right now** (the TL baseline appears to have been started on a clean `.next/types`). `npm run build` regenerates it, so V-2 must run **before** V-3, or after deleting it again (see B-4) |
| F8-1 line references | `WorkflowPilot.ts:203-217`, `:1396-1424`; both run routes | ✅ Accurate (see "F8-1" below) |

### Rulings on D-1 to D-6

| # | Ruling | Why |
|---|---|---|
| D-1 | **Agreed: leave `testSurfaceGate.ts:8` unchanged. Out of scope.** | It names a class of path that G-9 still enforces (`TEST_SEGMENT` includes `debug`). Keeps a load-bearing security module out of the diff |
| D-2 | **Agreed: remove the `DebugSessionManager` mock (`:58-76`) and the `work.debugSession` counter (`:38`). In scope.** Header wording as proposed (`:2-3`: "T-3, T-4 and T-7 to T-10 (T-5 and T-6 were deleted in F-8)"; `:8`: drop "no debug session") | The scope says "update every guard or test that lists these routes". A mock for methods that no longer exist anywhere, and a counter that can never move, read as coverage that is not there |
| D-3 | **Agreed. In scope.** Keep `agentWorkflowSteps` and `WorkflowStep`; remove the two sandbox-only writes `:2456-2457` and `:2552-2553`; reword `:5128` to `✓ {n} workflow steps found` and `:5132` to `⚠ No workflow steps found`; reword the comments at `:25` and `:897` | This is the panel's "state" in the user's sense: those two writes exist only for the visualizer (their own comments say so), and with the visualizer gone nothing in sandbox mode reads them. The two strings name a mode that no longer exists, so leaving them would make the page say something false. Nothing beyond these four lines |
| D-4 | **Overruled. Out of scope: do not restructure the "Execution Options" `<div>`.** Remove only the toggle (`:5197-5220`) and, in the AgentKit checkbox, the two lines that name the deleted state: `onChange` becomes `(e) => setUseAgentKit(e.target.checked)` (drop `:5190`), and `disabled={debugModeEnabled}` (`:5192`) goes. Keep the outer `<div>` and its inner `{!sandboxMode && (...)}` exactly as they are | The checkbox edits are required: they name deleted state. Moving the condition outward is a layout restructure for a 15 px spacer on an internal test page, and the user's list does not include it. Smallest diff wins. An empty flex `<div>` renders nothing visible beyond its margin |
| D-5 | **Agreed: unwrap and dedent by two spaces. In scope.** | Removing `{!debugModeEnabled && (` / `)}` is required. Leaving the 34-line block over-indented would be a readability defect this slice introduces. Condition: `git diff -w` on that hunk must show only the two removed wrapper lines |
| D-6 | **Agreed, with limits. In scope.** (a) `docs/V2_TEST_PAGE_SCOPE.md`: only the removals listed in section 8 plus a `Version 1.9.3` entry. Move the `(Current)` marker from `### Version 1.9.2 (Current)` (`:1188`) to the new entry. Update the closing `**Last Updated:**` line. Renumber `#### 5.5 Agent List` (`:671`) to `5.4`: one line, and no anchor links to it (grep). Leave UC numbers alone (UC ids are identifiers; a gap at UC-10 is fine). (b) `docs/DEBUG_INTEGRATION_GUIDE.md`: `git mv` to `docs/archive/` with a banner in the existing archive convention (`> **Archived**: 2026-11-27 (PROD-1c F-8)` plus a short "why archived" line, as in `docs/archive/BILLING_SYSTEM_COMPLETE_STATUS.md`). Nothing links to it. (c) `docs/AGENT_SANDBOX_DEBUGGER.md`: leave. (d) The A-1 workplan: the two F-8 row pointers and one Change History row only | The page's living doc must not describe a deleted feature, and CLAUDE.md § Documentation Standards moves superseded docs to `docs/archive/`. Record-keeping in the parent workplan follows the standing "always update the main requirement" rule. No other doc edits |

### Other extras in the workplan, ruled

| Extra | Ruling |
|---|---|
| Reword page strings `:5128`, `:5132` and comments `:25`, `:897` | **In** (D-3) |
| Drop the two sandbox `setAgentWorkflowSteps` writes | **In** (D-3) |
| Restructure the "Execution Options" `<div>` | **Out** (D-4) |
| G-9 R1 floor `13` → `11` (`envConfigHardening.guard.test.ts:673`) | **In.** Verified above: −2, exactly the deleted routes. It stays `toBeGreaterThanOrEqual`. No change to `TEST_SURFACE_EXEMPT`, the matchers, the `pageDirs` floor (`:674`, stays 2) or the self-test segment list (`:985`) |
| Edit `V2_TEST_PAGE_SCOPE.md`; archive `DEBUG_INTEGRATION_GUIDE.md` | **In**, limited as in D-6 |
| `tests/helpers/source-scan.ts` unchanged | **Agreed.** It is a parser library, with no list and no count |

### Conditions

**Blocking: must hold before SA code-review approval**

1. **B-1 Diff equals the plan.** `git diff --name-status origin/main` lists exactly the section 4 files: 6 `D`, 1 `R` (the archive move), and `M` on `page.tsx`, `testSurfaceRoutes.test.ts`, `envConfigHardening.guard.test.ts`, `V2_TEST_PAGE_SCOPE.md` and the A-1 workplan, plus this workplan as `A`. Nothing from the "Not modified" list. In particular: no edit to `lib/pilot/**`, `lib/debug/DebugSessionManager.ts`, either run route, or `lib/security/testSurfaceGate.ts`.
2. **B-2 No truncation.** Edit `page.tsx` with the Edit tool, block by block, never a whole-file write. After the edits: `wc -l` is about 5853 minus the removed lines, never a collapse. `git diff --stat` for the page shows deletions plus a handful of changed lines, except the D-5 dedent hunk, which `git diff -w` must reduce to the 2 removed wrapper lines. The section 5.4 invariants hold and are recorded with their numbers: `addDebugLog` 153; `debugLogs`/`setDebugLogs`/`DebugLog` 3/3/3; `uuidv4` 7; the alternation 0; fetches 1 + 1.
3. **B-3 G-9 red-then-green (V-4).** Record the actual R1 failure at floor 13 (received 11), then green at 11. Run the whole `envConfigHardening.guard.test.ts` suite, not only R1: R2 and R4 must still be green with the 6 gated and 5 exempt routes.
4. **B-4 Typecheck comparison is like for like.** Both runs finished: exit code recorded, diagnostics printed, no `FATAL ERROR` / `heap out of memory` / `Last few GCs`. Both runs have `.next/types/` absent, and the after run is taken **before** `npm run build`, or after deleting `.next/types/` again. Record: the before total, the errors in the 6 deleted files (expected 9, all in the two routes), the after total, and per touched file the message set after ⊆ before. Any unexplained difference blocks.
5. **B-5 Build (V-3)** exit 0 with the CI placeholder env. The route table lists `/test-plugins-v2` and not `/api/debug/control` or `/api/debug/stream`.
6. **B-6 Jest (V-5)** green as stated: `testSurfaceRoutes` 28 cases, with no residual reference to `work.debugSession`; `testSurfaceGate`, `envConfigHardening` and the admin authz guard unchanged in case count. The only accepted red is the known Windows-only `publicEndpointsAreThrottled` F-9 (3 cases), and it must be the same 3 cases as on `05732d73`. Also `npm run lint:hooks` reports 0 (V-6).
7. **B-7 Render check (V-8)** by Dev and repeated by QA, including that both debug URLs answer 404 and that the Execute Agent request body has no `debugMode` / `debugRunId`. In sandbox mode the empty options `<div>` (D-4) is expected and is not a defect.
8. **B-8 Docs hygiene.** No backslash sequences in the edited or moved docs. Tailwind 4 detects content outside `tailwind.config.js` `content`, so the `docs/` CSS-escape hazard applies. `next build` (B-5) is the proof.

**Non-blocking**

- **N-1 F8-1 is described correctly. It stays out of this slice; owner TL.** Two clarifications for whoever files it. (a) After F-8 there is no read path (the stream route is gone) and no control path (the control route is gone), so the session map can no longer leak one user's step config to another, and nobody can pause another user's run. The residual is: 5 s of added wall-clock per step for any signed-in caller who sends `debugMode: true` (cost, and the risk of hitting the function `maxDuration` so the run fails), events accumulating in a warm instance's memory until `cleanup`, and one caller's `cleanup` deleting a session that another caller with the same id is using. (b) `WorkflowPilot.ts:1421` writes a `console.log` on every step of every normal run, a CLAUDE.md rule 3 breach, and `run-agent/route.ts:745` echoes `debugRunId` in its response. TL files it as a GitHub issue (the ALM convention for bugs), with F8-2 (no Zod on either run route, rule 2) and F8-3 folded in. The fix is in `lib/pilot/` and needs the V6 Work Protocol (`v6-pipeline` skill § 4); `DebugSessionManager` can be deleted in that slice. Suggested priority: Medium.
- **N-2** In DB mode the AgentKit checkbox becomes always enabled. It was disabled only while debug mode was on, so this is expected; QA notes it rather than flagging it.

### Approval

- [x] Workplan approved. Proceed to implementation with D-4 as overruled above and conditions B-1 to B-8.

**Approved for implementation: Yes**

---

## Implementation Notes (Dev)

**Implemented by Dev, 2026-11-27, on `fix/f8-delete-run-debugger` at `05732d73`. Not committed.** Rulings applied as written: D-1 (gate comment untouched), D-2 (mock, counter and header wording), D-3 (state kept, two sandbox writes gone, two strings and two comments reworded), D-4 as overruled (only the toggle and the checkbox's two debug-state lines removed; the outer `<div>` and its `{!sandboxMode && (...)}` are unchanged), D-5 (unwrapped and dedented by two spaces), D-6 as limited.

### B-1 The diff equals the plan

`git diff --name-status -M HEAD`, plus `git status --short` for the untracked workplan:

| Status | File |
|---|---|
| D | `app/api/debug/control/route.ts` |
| D | `app/api/debug/stream/route.ts` |
| D | `hooks/useDebugStream.ts` |
| D | `components/debug/DebugControls.tsx` |
| D | `components/debug/StepVisualizer.tsx` |
| D | `components/debug/index.ts` |
| R094 | `docs/DEBUG_INTEGRATION_GUIDE.md` → `docs/archive/DEBUG_INTEGRATION_GUIDE.md` |
| M | `app/test-plugins-v2/page.tsx` |
| M | `lib/security/__tests__/testSurfaceRoutes.test.ts` |
| M | `lib/__tests__/envConfigHardening.guard.test.ts` |
| M | `docs/V2_TEST_PAGE_SCOPE.md` |
| M | `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md` |
| ?? (A at commit) | `docs/workplans/prod-1c-f8-delete-run-debugger-workplan.md` |

6 D, 1 R, 5 M, plus this workplan: exactly section 4. `git diff --quiet 05732d73 -- lib/pilot lib/debug app/api/run-agent app/api/run-agent-sandbox lib/security/testSurfaceGate.ts tests/helpers/source-scan.ts lib/admin docs/AGENT_SANDBOX_DEBUGGER.md` exits 0: nothing in the "Not modified" list changed.

### B-2 No truncation

| File | `wc -l` before | after | `git diff --numstat` (+ / −) |
|---|---|---|---|
| `app/test-plugins-v2/page.tsx` | 5853 | 5570 | 39 / 322 (net −283). With `-w`: 5 / 288 |
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | 224 | 200 | 2 / 26 |
| `lib/__tests__/envConfigHardening.guard.test.ts` | 1027 | 1027 | 1 / 1 |
| `docs/V2_TEST_PAGE_SCOPE.md` | 1360 | 1274 | 14 / 100 |
| `docs/archive/DEBUG_INTEGRATION_GUIDE.md` (moved) | 500 | 517 | 18 / 1 (banner; H1 prefixed "ARCHIVED —") |
| `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md` | 1183 | 1184 | 3 / 2 |

Total `git diff --stat -M HEAD`: 12 files changed, 77 insertions, 1586 deletions.

The page's 39 added lines are the 34 lines of the dedented Execute / Reset Form block plus 5 reworded lines (comments `:25` and `:897`, the strings `:5128` and `:5132`, and the one-line AgentKit `onChange`). `git diff -w` leaves exactly those 5 additions; in the D-5 hunk it shows only `{!debugModeEnabled && (` and `)}` removed (the `)}` sits in the same hunk as the adjoining `DebugControls` removal, which is its own planned block, section 5.3). Every edit was made with the Edit tool, one block at a time, bottom-up.

Section 5.4 invariants, `app/test-plugins-v2/page.tsx`:

| Check | Before | After | Expected |
|---|---|---|---|
| `grep -c addDebugLog` | 170 | 153 | 153 ✅ |
| `debugLogs` / `setDebugLogs` / `DebugLog` (`grep -cw`) | 3 / 3 / 3 | 3 / 3 / 3 | unchanged ✅ |
| `uuidv4` occurrences | 9 | 7 (import `:8` plus uses at `:1242`, `:1254`, `:1272`, `:1273`, `:1968`, `:2033`) | 7, import used ✅ |
| The 11-name alternation (`grep -c -E`) | 59 | 0 | 0 ✅ |
| Lines with "visualization" or "Debug mode" | 2 | 0 | 0 ✅ |
| `/api/run-agent` + `/api/run-agent-sandbox` fetches | 2 + 1 | 1 + 1 (`:2354`, `:2437`) | 1 + 1 ✅ |

Repo-wide, `git grep -w -E "DebugState|StepStatus|useDebugStream|DebugControls|StepVisualizer|debugModeEnabled"` outside `docs/archive` and `docs/workplans`: no code match except `components/crm/contact-drawer/BookingsTab.tsx:617` and its guard test, which declare their own unrelated local `type StepStatus` (CRM bookings). The doc matches are `docs/V2_TEST_PAGE_SCOPE.md`'s new Version 1.9.3 entry and its Version 1.3 entry, which SA ruled is history and stays.

V-7, the section 2 grep after the edit: the only code matches are `lib/debug/DebugSessionManager.ts` and `lib/pilot/WorkflowPilot.ts`. The doc matches are `docs/AGENT_SANDBOX_DEBUGGER.md` (left, D-6), `docs/V2_TEST_PAGE_SCOPE.md` (changelog), `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` (history), the A-1 workplan (record of A-1), and one more historical line not listed in section 8: `docs/workplans/BUSINESS_OS_PAYMENT_QUEUE_DRAIN_WORKPLAN.md:384`, which names `DebugSessionManager` (the class that stays) as an unrelated grep hit. Left alone.

### B-3 G-9 red, then green

After the six deletions, with the floor still at 13, `npx jest lib/__tests__/envConfigHardening.guard.test.ts`:

```text
● G-9 the test and debug surface is gated in production (PROD-1c, A6) › G-9 R1 finds the surface (floors, so a broken walk cannot pass vacuously)
    Expected: >= 13
    Received:    11
      at Object.<anonymous> (lib/__tests__/envConfigHardening.guard.test.ts:673:35)
Tests:       1 failed, 113 passed, 114 total
```

Floor lowered to 11 (still `toBeGreaterThanOrEqual`; nothing else in the guard changed): 114 passed, 114 total. R1, R2 (the 6 gated routes), R3 (both R3 cases) and R4 (the 5 exemptions) are green.

### B-6 Jest and lint

`npx jest lib/security/__tests__ lib/__tests__/envConfigHardening.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts`: 10 suites, 378 tests, 375 passed, 3 failed.

| Suite | Cases | Result |
|---|---|---|
| `testSurfaceRoutes.test.ts` | **28** (was 36 = 9 HANDLERS × 4) | ✅ all pass; no case names T-5 or T-6; no `debugSession` left in the file |
| `testSurfaceGate.test.ts` | 19 | ✅ |
| `envConfigHardening.guard.test.ts` | 114 (114 at floor 13 too) | ✅ |
| `admin-authz-surface.guard.test.ts` | 119 | ✅ |
| `onboardingVerdict`, `middlewareDoesNotAuthEveryRequest`, `publicPagesAreNeverCached`, `rateLimit`, `portalAccess` | 17, 14, 10, 13, 18 | ✅ |
| `publicEndpointsAreThrottled.guard.test.ts` | 26 | 3 fail: the known Windows-only F-9 |

The 3 F-9 cases are the `app/api/book/manage/[token]/calendar/route.ts`, `app/api/public/consent-copy/route.ts` and `app/api/public/invoice/[id]/pay/route.ts` "is throttled, or named as deliberately open" cases (Jest prints the paths with Windows separators, which is the F-9 cause; written here with forward slashes to keep backslashes out of `docs/`). They are the same as on `05732d73` by construction: the guard reads only `app/api/book/manage`, `app/api/public` and `app/api/proposal` (its `ROOTS`), and `git diff --stat 05732d73 -- app/api/book/manage app/api/public app/api/proposal lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts tests/helpers` is empty, so its input is byte-identical to the baseline. No baseline extraction was needed.

The other suites' case counts equal `05732d73`'s: their test files are unchanged and every `it.each` in them iterates a static list, not the file corpus.

`npm run lint:hooks` (`--max-warnings 0` over `app lib components hooks`): exit 0, no problem printed ✅

### B-8 Docs hygiene

`grep -c -F` for a backslash: `docs/V2_TEST_PAGE_SCOPE.md` 0 (0 at `05732d73`); `docs/archive/DEBUG_INTEGRATION_GUIDE.md` 0 (0 before); this workplan 1 line, the route regex in the SA review table (line 339): a backslash before a dot and before a pipe, neither a hex digit, so not the CSS-escape hazard; left as SA wrote it. `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md` carries 21 lines with a backslash at `05732d73` (its own regex and grep text) and still 21; the 3 added lines contain none. `next build` (B-5, main session) is the proof.

### Verification left to the main session

| # | Check | Before (`05732d73`) | After |
|---|---|---|---|
| V-1 / V-2, B-4 | Full `tsc --noEmit -p tsconfig.json`, 8 GB heap, `.next/types/` absent | Finished, exit 2, 1846 errors, no OOM. 9 in `app/api/debug/{control,stream}/route.ts`; 0 in any other file this slice touches | ⬜ main session (expected 1846 − 9 = 1837, no new error in a touched file; run before `npm run build` or with `.next/types/` deleted again) |
| V-3, B-5 | `npm run build`, CI placeholder env | n/a | ⬜ main session |
| V-8, B-7 | Render and run check in the dev server | n/a | ⬜ main session / QA (Dev was told not to start a dev server) |

### Deviations

None on scope. Two notes for SA:

1. **A-1 workplan "Last Updated" header** (`:3`, still `2026-11-26`): section 8 of this workplan listed it, but SA's D-6(d) and the TL brief limit that file to "the two F-8 row pointers and one Change History row only", so it is not changed. It was already behind the file's own 2026-11-27 history rows before F-8.
2. **Process rules held**: no `npm install`, no `git stash`, no temporary worktree, no `tsc`, build or dev server, `.next/` untouched.

---

## SA Code Review (2026-11-27)

**Code Review by SA, 2026-11-27, on `git diff -M 05732d73` (staged and unstaged) plus this untracked workplan**
**Status:** ✅ Code Approved, pending B-4, B-5 and B-7 from the main session

SA re-derived each number below from the tree, not from the Dev's notes. SA ran no `tsc`, build or dev server (a full `tsc` was running in this worktree).

### Conditions B-1 to B-8

| # | What SA checked | Result |
|---|---|---|
| B-1 | `git diff -M --name-status 05732d73`; `git diff --quiet 05732d73 -- lib/pilot lib/debug app/api/run-agent app/api/run-agent-sandbox lib/security/testSurfaceGate.ts tests/helpers lib/admin docs/AGENT_SANDBOX_DEBUGGER.md`; `HEAD` | ✅ 6 `D`, 1 `R094`, 5 `M`, and this workplan untracked: exactly section 4. The not-modified set exits 0. `HEAD` is `05732d73`. `app/api/debug/` and `components/debug/` are gone from disk and from the index |
| B-2 | Full read of the page diff, then `git diff -w`; invariants recounted on `05732d73` and on the worktree | ✅ No truncation: 5853 → 5570, numstat 39 / 322, and 5 / 288 with `-w`. The only additions under `-w` are the two comments, the two strings and the one-line `onChange`. Invariants: `addDebugLog` 170 → 153; `debugLogs` / `setDebugLogs` / `DebugLog` 3 / 3 / 3 both sides; `uuidv4` 9 → 7, import still used; the 11-name alternation 59 → 0; "visualization" or "Debug mode" 7 → 0 (7, not 2, at base because 5 sat in removed blocks; after is 0 either way); fetches 3 → 2 (`/api/run-agent`, `/api/run-agent-sandbox`). The page-wide log is intact. `executeAgent`'s body is unchanged. The sandbox body lost only `debugMode` and `debugRunId`. D-4 is honoured: the "Execution Options" `<div>` and its `{!sandboxMode && (...)}` are untouched; only the toggle `<label>`, its blank line and the checkbox's two debug-state lines go. D-5 is clean: under `-w` the Execute / Reset block shows only `{!debugModeEnabled && (` and `)}` removed. The JSX still balances: the card's closing `</div>` now follows the buttons `<div>`, and "Execution Result Display" follows the card. No unused import is left. Explicit `any` dropped 52 → 50 (two removed with the blocks), none added |
| B-3 | Dev's red-at-13 evidence, the floor diff, then a re-run | ✅ The guard diff is one line: `toBeGreaterThanOrEqual(13)` → `(11)`. `pageDirs` stays at 2; matchers, exemptions and the self-test list are unchanged |
| B-4 | Typecheck like for like (run by the main session; SA checked the reported result against the condition) | ✅ Both runs had `.next/types/` absent, and the after run came before any build. Before: exit 2, 1846 errors. After: exit 2, 1837 errors. Neither printed OOM text. The error sets were diffed with line and column numbers stripped: **nothing appears only after**. The 9 that appear only before are all in the deleted routes: 5 in `control/route.ts` (`pause`, `resume`, `step`, `stop`, `state`) and 4 in `stream/route.ts` (`waitForSession`, `getEvents`, `subscribe`, plus TS7006 on `event`). The touched files have 0 errors after. This meets B-4 exactly |
| B-5 | Build | ⬜ **Main session.** Exit 0; `/test-plugins-v2` listed; neither debug route listed |
| B-6 | `npx jest lib/security/__tests__/testSurfaceRoutes.test.ts lib/__tests__/envConfigHardening.guard.test.ts` | ✅ 2 suites, **142 passed, 142 total** = 28 (`testSurfaceRoutes`: 7 HANDLERS × 4) + 114 (`envConfigHardening`, unchanged count). No `debugSession` and no T-5 or T-6 left in the routes test. Jest printed "A worker process has failed to exit gracefully" at the end. That comes from the route modules the test loads and is not tied to this diff. Not a finding. SA did not re-run the wider V-5 set or `lint:hooks`; it takes the Dev's evidence for those, and the F-9 reasoning (byte-identical inputs) is sound |
| B-7 | Render check | ⬜ **Main session / QA** |
| B-8 | `grep -c -F` for a backslash in each edited or moved doc, and in every added `docs/` line | ✅ No added line in `docs/` contains a backslash. `V2_TEST_PAGE_SCOPE.md` 0, the archived guide 0, the A-1 workplan 21 (all pre-existing). This workplan has 1, in SA's own regex at line 339 (`\.`, `\|`), with no hex digit after it. `next build` (B-5) is the final proof |

### `testSurfaceRoutes.test.ts`

- **7 HANDLERS.** T-3, T-4, T-7, T-8 POST, T-8 OPTIONS, T-9, T-10. Only the T-5 and T-6 rows and their two imports are gone.
- **Mock and counter removed (D-2).** `noWorkRan()` iterates `Object.entries(work)`, so dropping `debugSession` only removes a counter that could never move. Every remaining handler still gets the same four assertions: anonymous 404 with one session read and no work, non-admin 404 recorded as `admin_api`, admin past the gate, and no gate off production.
- **Header** reworded as ruled.

### Docs (D-6)

| Doc | Result |
|---|---|
| `V2_TEST_PAGE_SCOPE.md` | ✅ Within D-6(a): overview item 5, the Tab 5 purpose, § 5.4 deleted, § 5.5 → 5.4, the endpoint list, the state list (its group comment reworded to "Selected agent state", which is part of that edit), the key-function list, UC-10 deleted with other UC numbers unchanged, `Version 1.9.3 (Current)` with the marker moved off 1.9.2, and the closing Last Updated line. The Version 1.3 history is untouched. No other edits |
| `docs/archive/DEBUG_INTEGRATION_GUIDE.md` | ✅ `R094` move. The banner matches the `BILLING_SYSTEM_COMPLETE_STATUS.md` convention (`# ARCHIVED —` H1, `> **Archived**:`, `> **Superseded by**:`, a "Why this is archived" section). Its facts are correct. No file links to the old path |
| A-1 workplan | ✅ Exactly the two F-8 pointers (§ 16.1, § 19) and one Change History row. **Ruling on Last Updated:** D-6(d) limited what content could change. It did not forbid the header metadata, which section 8 of the approved plan listed and CLAUDE.md § Documentation Standards requires on a living doc. The Dev's reading was conservative and defensible. However, the header (`2026-11-26`) is already behind the file's own 2026-11-27 rows, so it **should be bumped to 2026-11-27** (C-1, non-blocking) |

### CLAUDE.md rules on touched files

- **Logging (rule 3):** `console.*` is 0 in each modified code file, before and after. The page is on `clientLogger`. The 6 calls in `hooks/useDebugStream.ts` leave with the deleted file.
- **`any` (rule 6):** none added; two removed.
- **Zod, RLS, repositories, secrets:** no route, query or schema was added or changed. The only routes in the diff are deleted. No secret or identifier in any tracked text.
- **Rule 8 (V6):** `lib/pilot/**` and `lib/debug/**` byte-identical to `05732d73`.
- No dead code, no new pattern.

### Code Review Comments

1. `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md:3`: bump `Last Updated` to `2026-11-27` (ruling above). Priority: Low. Non-blocking (C-1)
2. `docs/V2_TEST_PAGE_SCOPE.md`, Version 1.9.3, third bullet: "The Execute Agent and Execute Sandbox runs no longer send `debugMode` or `debugRunId`" implies the normal Execute Agent run used to send them. It never did; only the deleted debug run and the sandbox run did. Suggested: "The Execute Sandbox run no longer sends `debugMode`, and the debug run that sent `debugMode` / `debugRunId` to `/api/run-agent` is gone". Priority: Low. Non-blocking (C-2)

### Optimisation Suggestions

- `app/test-plugins-v2/page.tsx`: the surviving comment `{/* Action Buttons - Standard Mode */}` named the non-debug mode. It is now just "Action Buttons". Optional, style only.
- `testSurfaceRoutes.test.ts:3`: the header has nested parentheses ("(PROD-1c A-1, T-3, … (T-5 and T-6 were deleted in F-8))."). Readable as is. Optional.

### Code Approved for QA: Yes (B-4 passed; pending B-5/B-7 from main session)

No required change blocks QA. C-1 and C-2 are one-line doc edits. Dev or RM may apply them before the commit without another SA pass. B-4 has passed (above). B-5 (build exit 0, debug routes absent from the route table) and B-7 (render and request-body check) must still pass. If either of them fails, this approval does not hold.

---

## QA Testing Report

**QA — 2026-11-27**
**Test mode:** full
**Strategy used:** A (Jest: the routes test and the guards), C (source checks with grep, diff and a G-9 count worked out again outside Jest), D (dev server probes; the browser walk-through was done by the main session and is recorded as evidence)
**Focus:** security (the gated test surface), ui (the tester page), and the diff itself
**Skipped:** `tsc` and `npm run build` (the brief said not to run them; QA re-diffed the main session's raw output instead); clicking Execute Agent or Execute Sandbox with a real signed-in user (the dev server runs on placeholder env, so there is no session; the request bodies were checked in the source instead)
**Input source:** prompt (TL brief) + workplan section 10 / SA conditions B-1 to B-8

### Test Coverage

| Acceptance criterion / condition | Tested? | Result | Notes |
|---|---|---|---|
| Diff equals the plan (B-1) | ✅ | Pass | `git diff --name-status -M 05732d73`: 6 `D`, 1 `R094`, 5 `M`, and this workplan untracked. Nothing else. `HEAD` = `05732d73`. `git diff --quiet 05732d73 -- lib/pilot lib/debug app/api/run-agent app/api/run-agent-sandbox lib/security/testSurfaceGate.ts tests/helpers lib/admin docs/AGENT_SANDBOX_DEBUGGER.md` exits 0. `.claude/launch.json` is ignored (`.gitignore:79`) and does not appear in `git status`. `app/api/debug/` and `components/debug/` are gone from disk |
| C-1: A-1 workplan Last Updated | ✅ | Pass | `:3` now reads `2026-11-27`. The file's diff is now 4 added and 3 removed lines: the header, the two F-8 pointers and one Change History row |
| C-2: V2_TEST_PAGE_SCOPE 1.9.3 bullet | ✅ | Pass | `:1099` now reads "The Execute Sandbox run no longer sends `debugMode` or `debugRunId` (the Execute Agent run never did)". This is accurate (see the request-body row) |
| Typecheck has no new error (B-4) | ✅ (re-diffed, not re-run) | Pass | Raw files: before has 1846 `error TS`, after has 1837. Neither has OOM text. With line and column stripped, **0 errors appear only after**. The 9 that appear only before are exactly `control/route.ts` (pause, resume, state, step, stop) and `stream/route.ts` (getEvents, subscribe, waitForSession, TS7006 `event`) |
| Build (B-5) | ✅ (log read, not re-run) | Pass | `build.txt`: `✓ Compiled successfully`. The route table has `ƒ /test-plugins-v2 31.5 kB`. No `api/debug` line |
| `testSurfaceRoutes` 28 cases (B-6) | ✅ | Pass | 28/28 (from Jest `--json`). The 7 HANDLERS are T-3, T-4, T-7, T-8 POST, T-8 OPTIONS, T-9 and T-10 |
| `envConfigHardening` 114 cases (B-6) | ✅ | Pass | 114/114 |
| Admin authz guard 119 cases (B-6) | ✅ | Pass | 119/119 |
| Wider V-5 set | ✅ | Pass (known F-9 only) | 10 suites, 378 tests: 375 pass, 3 fail. The 3 are the known Windows-only `publicEndpointsAreThrottled` F-9 cases: book/manage calendar, public/consent-copy and public/invoice pay. Every other suite is green |
| `npm run lint:hooks` (V-6) | ✅ | Pass | Runs with `--max-warnings 0`. No problem printed |
| **Failure path, G-9 floor** | ✅ | Pass | (a) QA worked the count out again from git with G-9's own rule (`route.(ts\|tsx\|js)`, `TEST_SEGMENT` over the inner segments, `__tests__` dropped): **13 routes at `05732d73`, 11 now**. Only the two `app/api/debug/*` routes left. (b) A reversible edit set the floor back to 13 and ran `-t "G-9 R1"`: `Expected: >= 13 / Received: 11`, 1 failed. The file was restored from a byte copy. `git diff --numstat 05732d73` on it is back to `1 1`, the reviewed one-line `13 → 11` change. So the guard does catch a lost route |
| Failure path, routes test still fails an ungated route | ✅ | Pass (by source) | The routes-test diff only removes the T-5/T-6 imports and rows, the dead `DebugSessionManager` mock, the `debugSession` counter and two header lines. All four `it.each(HANDLERS)` describes keep their assertions unchanged. These are: anonymous → `404 {success:false,error:'Not found'}`, `getUser` called once, `isAdmin` not called, `noWorkRan()`; non-admin → 404, refusal recorded as `admin_api`, `noWorkRan()`; admin → not the gate's 404; preview → no admin check. A handler that skips the gate would fail the 404 and `noWorkRan()` assertions |
| Sandbox request body has no `debugMode`/`debugRunId` | ✅ | Pass | `page.tsx:2437`: the body is `agent_name`, `pilot_steps`, `plugins_required`, `input_variables`, `user_prompt`. At `05732d73` (`:2481`) it also sent `debugMode: debugModeEnabled, debugRunId: runId`. The route still defaults `debugMode = false` (`run-agent-sandbox/route.ts:71`), so behaviour does not change. `grep -c -E "debugMode\|debugRunId"` on the page gives 0 |
| Execute Agent body unchanged | ✅ | Pass | QA pulled out the whole `executeAgent` function at `05732d73` and in the worktree. Both are 56 lines and `diff` finds them **identical**. The body is `agent_id`, `input_variables`, `override_user_prompt`, `execution_type: 'test'`, `use_agentkit`. The page now has two run fetches (`:2354` `/api/run-agent`, `:2437` `/api/run-agent-sandbox`), down from three at base. Only the debug run's `/api/run-agent` call (`:2623` at base) is gone |
| Nothing imports the deleted files (V-7) | ✅ | Pass | `git grep -E "hooks/useDebugStream\|components/debug\|api/debug/(control\|stream)\|useDebugStream\|DebugControls\|StepVisualizer" -- ':!docs'` finds no match. `DebugSessionManager` has one importer, `lib/pilot/WorkflowPilot.ts:56`, which is unchanged |
| Render and 404s (B-7) | ✅ | Pass | QA probed the main session's dev server on `:3019`. `GET /test-plugins-v2` → 200, and the HTML has "Agent Execution" and "Debug Logs" (the page-wide activity log, kept). `POST /api/debug/control` → 404 and `GET /api/debug/stream?runId=x` → 404. The HTML has 0 of "Step-by-Step", "Debug Mode", "Debug Events" and "StepVisualizer". This SSR check is weak, because the Agent Execution tab is not the default tab. For the tab's own content, QA relies on the main session's browser walk-through, recorded as evidence: DB mode has Execute Agent and the AgentKit checkbox, enabled (SA N-2, expected), and 0 debugger strings. Sandbox mode has 0 debugger strings, no checkbox, the execute control, and the empty options spacer (SA D-4, expected). The console shows only 401s from being signed out |
| Docs hygiene (B-8) | ✅ | Pass | The lines added to `docs/` since `05732d73` (excluding this untracked workplan) contain 0 backslashes. The build passed (B-5) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None in this diff. F8-1 (production run routes still accept `debugMode`, adding 5 s per step) is already recorded, out of scope, owner TL.

#### Edge Cases (nice to fix)
None new. Expected and not defects: the AgentKit checkbox is always enabled (N-2), and the empty "Execution Options" spacer in sandbox mode (D-4).

### Test Outputs / Logs

```text
npx jest lib/security/__tests__ lib/__tests__/envConfigHardening.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts
FAIL lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts   (3 known F-9, Windows path separators)
PASS (9 others, incl. testSurfaceRoutes, testSurfaceGate, envConfigHardening, admin-authz-surface)
Test Suites: 1 failed, 9 passed, 10 total
Tests:       3 failed, 375 passed, 378 total

Per suite (--json): testSurfaceRoutes 28/28, envConfigHardening 114/114, admin-authz-surface 119/119

G-9 R1 with floor temporarily 13 (then restored):
    Expected: >= 13
    Received:    11
Tests:       1 failed, 113 skipped, 114 total

tsc error sets (line/col stripped): only-after 0, only-before 9 (all app/api/debug/*)
dev server :3019: /test-plugins-v2 200, POST /api/debug/control 404, GET /api/debug/stream 404
```

### Final Status
- [x] All acceptance criteria pass, ready for commit
- [ ] Issues found, Dev must address before commit

**QA: PASS**

---

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Workplan created (Dev) | Fresh read of `05732d73`. `DebugSessionManager` stays (imported by `lib/pilot/WorkflowPilot.ts`). 6 files deleted; the tester page, the routes test and one G-9 floor modified. Deltas: HANDLERS 9 → 7, routes-test cases 36 → 28, G-9 discovered routes 13 → 11 and R1 floor 13 → 11; `source-scan.ts` and the admin authz guard count nothing affected. Six decisions for SA. Follow-up F8-1 (debug mode still reachable through the production run routes) recorded for TL |
| 2026-11-27 | SA workplan review | Approved with conditions B-1 to B-8. D-1, D-2, D-3, D-5, D-6 agreed (D-6 limited: `(Current)` marker moves, § 5.5 renumbered to 5.4, archive banner in the existing convention). D-4 overruled: the "Execution Options" `<div>` is not restructured; only the toggle and the checkbox's two debug-state lines go. G-9 set independently recomputed: 13 → 11, floor 13 → 11 approved. F8-1 confirmed out of scope, owner TL, to be filed as a GitHub issue |
| 2026-11-27 | Implemented, Code Complete (Dev) | 6 files deleted, the guide archived, 5 files modified, per the SA rulings (D-4 as overruled). Page 5853 → 5570 lines; `addDebugLog` 170 → 153, `uuidv4` 9 → 7, alternation 59 → 0. G-9 R1 shown red at floor 13 (received 11), green at 11. Jest: `testSurfaceRoutes` 28 cases, only the known F-9 Windows failures (3). Typecheck after-run, build and render check left to the main session. Not committed |
| 2026-11-27 | SA code review | Code approved for QA. B-4 passed: typecheck 1846 → 1837, the 9 removed errors are exactly the debug-route ones, no new error. Still pending from the main session: B-5 (build) and B-7 (render). B-1, B-2, B-3, B-6 and B-8 checked independently: the diff matches section 4; the page invariants hold; D-4 is honoured; D-5 is clean under `-w`; Jest gives 142/142 (28 + 114). Two Low, non-blocking doc nits: C-1, bump the A-1 workplan's Last Updated; C-2, correct a changelog bullet's wording |
| 2026-11-27 | QA: PASS | C-1 and C-2 verified. The diff is exactly the planned set. Jest: 375/378 (only the 3 known F-9). Per suite: 28, 114, 119. `lint:hooks` clean. G-9 shown red at floor 13 (received 11) with a reversible edit, then restored. `executeAgent` is byte-identical to `05732d73`, and the sandbox body lost only `debugMode`/`debugRunId`. No importer of a deleted file. Both debug URLs give 404 on the dev server. The typecheck re-diff shows no new error. No defects |
