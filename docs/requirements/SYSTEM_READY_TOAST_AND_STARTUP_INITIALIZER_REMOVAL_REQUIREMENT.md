# Requirement: Remove the "System Ready" Toast and the Page-Load Startup Initializer

> **Last Updated**: 2026-09-19

**Created by:** BA
**Date:** 2026-09-19
**Status:** SA-reviewed 2026-09-19 — CLEARED WITH CONDITIONS (see [SA Review](#sa-review)); ready for Dev workplan

## Overview

Every full page load of a platform page (every Business OS page, `/test-business-os`, and also `/`, `/login` and the marketing pages) shows a toast: **"System Ready — NeuronForge scheduler is running"**. Users cannot tell what it means, and it is false. No scheduler is started. Behind the toast, the browser makes an **unauthenticated** call that runs a **service-role, cross-tenant write**: it marks other users' long-running agent executions as `failed`. This requirement removes the toast and the client-side initializer. It moves the one useful thing the initializer did, recovering genuinely orphaned executions, to an authenticated background job. It also locks down or retires the `/api/system/*` endpoints that expose service-role operations to anonymous callers.

---

## Table of Contents

1. [Evidence — what the code does today](#1-evidence--what-the-code-does-today)
2. [Findings beyond the original report](#2-findings-beyond-the-original-report)
3. [User stories](#3-user-stories)
4. [Functional requirements](#4-functional-requirements)
5. [Non-functional requirements](#5-non-functional-requirements)
6. [Acceptance criteria](#6-acceptance-criteria)
7. [Out of scope / future roadmap](#7-out-of-scope--future-roadmap)
8. [Open questions](#8-open-questions)
9. [Notes on integration points](#9-notes-on-integration-points)
10. [SA Review](#sa-review)
11. [Change History](#change-history)

---

## 1. Evidence — what the code does today

All of the following was re-read on 2026-09-19 on branch `feature/business-os-purge-slice-2`.

| # | Fact | Location |
|---|---|---|
| E1 | The root layout mounts `PlatformChrome`. On any path that is not a public customer surface (`/book`, `/c/`, `/invoice/`, `/go/`, `/proposal/`, `/payments/success`, `/payments/cancelled`), it mounts `PlatformShell`. `/`, `/login`, `/signup`, `/pricing` and similar are **not** public surfaces, so they get the shell too. | `components/PlatformChrome.tsx` L37–75 |
| E2 | `PlatformShell` renders `<SafeSystemInitializer />`. The file's own doc comment already names the toast and the anonymous POST as a defect it fixed for customer pages. | `components/PlatformShell.tsx` L14–18, L30 |
| E3 | `SafeSystemInitializer` waits 500 ms (the comment says "2 second delay"), calls `GET /api/system/health` and ignores the result, calls `POST /api/system/initialize`, and on success shows `toast.success('System Ready', { description: 'NeuronForge scheduler is running' })`. On failure it shows `toast.error('System initialization failed', { description: <raw server error> })`. | `components/SafeSystemInitializer.tsx` L30–32, L48–62, L79–82, L96–100 |
| E4 | The "once per session" guard is a module-level `let initializationAttempted`. A full page load or refresh resets it, so the toast appears on **every** full page load. | `components/SafeSystemInitializer.tsx` L8, L22–27 |
| E5 | `POST /api/system/initialize` has no auth check, no Zod validation, no correlation ID, and logs via `console.*`. It returns raw error text to the caller. Middleware skips all `/api` paths, so nothing upstream authenticates it. | `app/api/system/initialize/route.ts`; `middleware.ts` L83 |
| E6 | `initializeApplication()` (a) reads 1 row from `agents` with `supabaseServer`, (b) calls `executionCleanup.cleanupOrphanedExecutions()`, and (c) sets `steps.scheduler = true` without doing anything. The `automaticScheduler` import is removed. | `lib/startup/initialize.ts` L4, L54–70, L91–114 |
| E7 | `globalThis.__NEURONFORGE_INITIALIZED__` makes repeat calls no-ops **per server instance only**. On Vercel serverless, every cold instance re-runs the cleanup, and the toast shows on every call either way. | `lib/startup/initialize.ts` L8–10, L39–45, L73 |
| E8 | `cleanupOrphanedExecutions()` uses the service role to select **all users'** `agent_executions` with `status IN ('running','pending')` and `started_at < now − 30 min`. It then updates each one by `id` alone to `failed` / "Execution timed out after 30 minutes". There is no user scoping and no repository. | `lib/cleanup/executionCleanup.ts` L14, L28–38, L74–81 |
| E9 | `startAutomaticCleanup()` / `stopAutomaticCleanup()` (an in-process `setInterval`, which cannot work on serverless) and `getCleanupStats()` exist on the same class. I found no caller of `startAutomaticCleanup` among the files reviewed (see the §2 caveat). `getCleanupStats()` is called by `/api/system/status`. | `lib/cleanup/executionCleanup.ts` L98–149; `app/api/system/status/route.ts` L6–9 |
| E10 | `components/SystemInitializer.tsx` is an older duplicate that shows its own "NeuronForge system is ready!" toast. It **also exports a `SystemStatus` component** that polls `/api/system/status` every 30 s and reads fields (`scheduler.isRunning`, `scheduler.scheduledAgentsCount`) that the current status route does not return. | `components/SystemInitializer.tsx` L19–105, L108–170 |
| E11 | Crons are declared in `vercel.json` (14 entries). **None of them recovers stuck executions.** `process-queue` is a QStash worker, not a Vercel cron. It only updates the execution it is processing. `run-scheduled-agents` reads `pending`/`queued`/`running` executions but only to **skip** the agent. | `vercel.json`; `app/api/cron/process-queue/route.ts`; `app/api/run-scheduled-agents/route.ts` L115–133 |
| E12 | The established cron auth pattern is a `CRON_SECRET` bearer check that fails closed in production when the secret is unset, allows callers in development, and uses Pino with a correlation ID. | `app/api/cron/payment-retry/route.ts` L28–61 |
| E13 | A manual operator script, `scripts/reset-stuck-agent.ts`, already does per-agent stuck-execution reset. It uses a **1-hour** threshold on `created_at` and writes `completed_at`. | `scripts/reset-stuck-agent.ts` L59–74 |

**Conclusion:** the toast's claim is false. Anonymous page views trigger a cross-tenant service-role write. A legitimate execution running more than 30 minutes can be marked failed because someone else loaded a page.

---

## 2. Findings beyond the original report

These change the requirement. SA should confirm each one.

| ID | Finding | Evidence | Consequence for this requirement |
|---|---|---|---|
| **F1** | **Stuck executions stop scheduled agents permanently.** `run-scheduled-agents` skips any agent that has a `pending`/`queued`/`running` execution, and nothing else clears it. | E11 | Recovery is **not optional hygiene**. Without it, a scheduled agent whose worker died never runs again and gives no signal. That is why R2 moves recovery to a cron instead of deleting it. |
| **F2** | **Today's recovery does not cover `pending` or `queued` rows.** `run-scheduled-agents` inserts `pending` rows with `scheduled_at` and **no `started_at`**. The cleanup filters `started_at < threshold`, and a SQL `<` comparison with NULL never matches, so those rows are never selected. The cleanup never looks at `queued` at all, but the scheduler blocks on it. | E8; `run-scheduled-agents/route.ts` L168–178 | The effective recovery set today is `running` rows only. The new job must cover every status that blocks the scheduler (FR-2.3). |
| **F3** | **Possible column mismatch.** The cleanup writes `ended_at`. `process-queue` and `reset-stuck-agent.ts` write `completed_at`. If `ended_at` does not exist, every recovery update fails. The error goes only to `console.error`, so the failure is silent. No migration defining `agent_executions` is in `supabase/`, so I could not confirm the column from the repo. | E8 L79; `process-queue/route.ts` L53–54; E13 | Open question Q4. It is possible that recovery has **never** succeeded in production. |
| **F4** | **`/api/system/status` is an unauthenticated cross-tenant read.** `GET` returns platform-wide agent counts, recent execution stats, and the **names and `next_run` of up to 10 scheduled agents across all users**. `POST { agentId }` returns any agent's name, schedule and latest execution for any caller who supplies an id. | `app/api/system/status/route.ts` L14–28, L62–90, L126–183 | This is a **data exposure, more serious than the toast**. R3 must cover it. It is independent of the initializer. |
| **F5** | **`/api/system/health` is unauthenticated, uses the service role, and returns raw DB error text** plus environment-variable presence flags. | `app/api/system/health/route.ts` L20–45, L53–64 | Violates the "never expose internal error details" security rule. R3 covers it. |
| **F6** | **Anonymous visitors trigger it.** `/`, `/login`, `/signup` and marketing pages mount `PlatformShell` (E1), so a logged-out visitor causes the service-role write. | E1, E5 | Confirms the anonymous trigger path in the brief, and it is wider than "Business OS pages". |
| **F7** | **Recovery updates by `id` only, after a separate select.** A run that completes between the select and the update is overwritten to `failed`. | E8 L74–81 | FR-2.5: recovery must not overwrite an execution that is no longer in a recoverable state. |
| **F8** | **Legitimate long runs exist.** `/api/run-agent` has no `maxDuration` export and supports `debugMode` (step-by-step execution driven by a user). A debug session can legitimately stay "running" far longer than 30 minutes. `process-queue` is capped at 60 s. | `app/api/run-agent/route.ts` L28, L43; `process-queue/route.ts` L14 | The threshold cannot be one flat number without an SA decision (Q1). |
| **F9** | `run-scheduled-agents` checks `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``. If `CRON_SECRET` is unset, the literal header `Bearer undefined` passes. That is not fail-closed. | `run-scheduled-agents/route.ts` L59–63 | **Out of scope** here (§7). Recorded because R2 may be folded into this route, and whatever route hosts recovery must be fail-closed (FR-2.1). |

**Caveat on reference checks.** My tools in this pass could not run a repo-wide content search. I established the absence of callers for `startAutomaticCleanup`, `getApplicationStatus`, `__NEURONFORGE_INITIALIZED__`, `SystemStatus`, and the three `/api/system/*` URLs by reading the involved files and filename globs only. **FR-5.1 makes a full repo-wide search a required Dev deliverable**, including `scripts/`, `e2e/`, `__tests__/`, `docs/`, and any external monitor configuration the team knows of.

---

## 3. User stories

- As a **platform user**, I want pages to load without unexplained system messages, so that every message I see means something I can act on.
- As a **platform user**, I want my long-running or paused (debug) agent runs to not be marked failed because someone else opened a page, so that execution history is trustworthy.
- As a **platform user with a scheduled agent**, I want a run whose worker died to be recovered automatically, so that my agent keeps running on schedule instead of stopping with no signal (F1).
- As the **platform owner**, I want no unauthenticated endpoint to be able to write to, or read across, tenants' data, so that one customer's activity or an anonymous visitor cannot affect or see another customer's agents.
- As an **operator**, I want stuck-execution recovery to run on a schedule with structured logs, so that I can see how many runs were recovered and why.

---

## 4. Functional requirements

### R1 — Remove the toast and the client-side initializer

| ID | Requirement |
|---|---|
| FR-1.1 | `PlatformShell` must no longer mount any component that calls `/api/system/*` or shows a system-readiness toast. The rest of the shell (`SessionHandler`, `UserProvider`, `Toaster`) is unchanged. |
| FR-1.2 | `components/SafeSystemInitializer.tsx` is deleted. |
| FR-1.3 | `components/SystemInitializer.tsx` is deleted, **including its `SystemStatus` export**, provided FR-5.1 confirms nothing imports either symbol. If something does, Dev flags it in the workplan and does not re-point it silently. |
| FR-1.4 | Update the `PlatformShell` doc comment so it no longer describes a "scheduler bootstrap". |
| FR-1.5 | No replacement user-facing message is introduced. Platform readiness is not something users need to be told about. |

### R2 — Move orphaned-execution recovery off the page-view path

| ID | Requirement |
|---|---|
| FR-2.1 | Orphaned-execution recovery runs **only** as a server-side scheduled job, invoked by Vercel Cron, authenticated with `CRON_SECRET`, **fail-closed** in production when the secret is unset, matching the `payment-retry` pattern (E12). It may be a new cron route or folded into an existing cron (Q2). Nothing a browser does may trigger it. |
| FR-2.2 | Recovery must **not** run as a side effect of any page view, API call from a client, or cold start. |
| FR-2.3 | The recovery set must include every execution status that blocks `run-scheduled-agents` from re-queuing an agent (`pending`, `queued`, `running` today, E11). It must use an age basis that exists for each status. A `pending`/`queued` row has no `started_at` (F2), so the basis must be one that exists, such as `created_at` or `scheduled_at`. SA confirms the basis (Q3). |
| FR-2.4 | The staleness threshold must be one that a **legitimately live** execution cannot reach, including user-driven debug runs (F8). The value is **not set by this document** (Q1). Whatever value is chosen must be a named constant or config value, and it must appear in the recovered row's error message. |
| FR-2.5 | Recovery must be **conditional**: an execution is changed only if it is still in a recoverable status at the time of the write (F7). A run that finished between detection and write is left untouched. |
| FR-2.6 | Recovered executions are marked `failed`, with a user-readable reason saying the run was stopped because it stopped responding, and with the completion timestamp written to the column the rest of the platform reads (Q4). |
| FR-2.7 | Every run of the job records one structured summary: number scanned, number recovered by status, and duration. Each recovered execution is logged with `executionId`, `agentId`, `userId`, prior status, and age. |
| FR-2.8 | The job is **idempotent and safe under overlap**: two concurrent invocations must not double-process a row or produce conflicting writes. SA decides whether the `durable-queue-drain` §8.1 claim/reaper pattern applies or whether a conditional update (FR-2.5) is sufficient (Q5). |
| FR-2.9 | Recovery is a **deliberate cross-tenant system job**. Its use of the service role must be documented in code, per Security Rules. Its DB access goes through `lib/repositories/` (Mandatory Rule 1), for example the existing `ExecutionRepository`. It acts only on rows it selected itself, never on caller-supplied ids. |
| FR-2.10 | The in-process `startAutomaticCleanup` / `stopAutomaticCleanup` interval methods are removed, since they cannot work on serverless. Any other surviving part of `lib/cleanup/executionCleanup.ts` either becomes the implementation behind FR-2.1 or is deleted. Dev proposes which in the workplan. |
| FR-2.11 | Recovery must be in place **in the same release** that removes the page-view trigger (FR-1.1). There must be no deployed window in which neither mechanism exists (see F1). |

### R3 — Retire or lock down `/api/system/*`

| ID | Requirement |
|---|---|
| FR-3.1 | `POST /api/system/initialize` is **removed**, together with `lib/startup/initialize.ts` (`initializeApplication`, `getApplicationStatus`, `ApplicationInitializer`, and the `__NEURONFORGE_INITIALIZED__` global), subject to FR-5.1. Once R1 ships, the route has no legitimate caller, and its only real work moves to R2. |
| FR-3.2 | `GET /api/system/status` and `POST /api/system/status` must not be reachable by an unauthenticated or non-admin caller (F4). Either remove them, or gate them behind `AdminAccessService` (never `profiles.role`). If they are kept, Zod-validate input and follow the standard API route pattern. SA chooses (Q6). |
| FR-3.3 | `GET /api/system/health` must not perform service-role operations for anonymous callers and must not return internal error text or environment details (F5). Either remove it, reduce it to a minimal liveness response with no data or error detail, or gate it as admin-only. SA chooses (Q6). |
| FR-3.4 | After this change, **no unauthenticated request to any `/api/system/*` path can cause a database write**, and none can return data belonging to any user. |

### R4 — Logging standard on surviving code

| ID | Requirement |
|---|---|
| FR-4.1 | Every file that survives this change and is touched by it (at minimum the recovery job and any kept `/api/system/*` route) uses `createLogger` with structured `logger.*({ ...context }, 'message')`. API and cron routes attach a `correlationId`. Errors are logged as `{ err }`. No `console.*` remains in those files (Mandatory Rule 3). |
| FR-4.2 | Files that are only deleted need no conversion. Files touched only to remove an import (e.g. `PlatformShell.tsx`, which has no `console.*`) need no conversion unless they contain `console.*`. |
| FR-4.3 | If the recovery logic is folded into `run-scheduled-agents` (Q2), that route is "touched" and must be converted in full. It has about 20 `console.*` calls. Dev states this cost in the workplan so SA can weigh Q2. |

### R5 — Verification of dependents

| ID | Requirement |
|---|---|
| FR-5.1 | Before deleting anything, Dev performs and records in the workplan a repo-wide search for `SafeSystemInitializer`, `SystemInitializer`, `SystemStatus` (the export from `SystemInitializer.tsx`), `initializeApplication`, `getApplicationStatus`, `applicationInitializer`, `__NEURONFORGE_INITIALIZED__`, `executionCleanup`, `startAutomaticCleanup`, `getCleanupStats`, `/api/system/initialize`, `/api/system/health`, and `/api/system/status`. Every hit is listed with its disposition. |

---

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | Platform page loads no longer make the two `/api/system/*` requests or pay the 500 ms-delayed round trips. The recovery job completes within its route's `maxDuration`. If the backlog is large, it processes in bounded batches rather than loading every stale row in one query. |
| **Security** | No anonymous path to service-role writes or cross-tenant reads under `/api/system/*` (FR-3.4). The cron is fail-closed on `CRON_SECRET`. The service-role use is documented. No internal error details go to clients in production. |
| **Reliability** | Recovery runs on a fixed schedule regardless of traffic. Today it runs only when someone happens to load a page on a cold instance. |
| **Data integrity** | A live or finished execution is never marked failed by recovery (FR-2.4, FR-2.5). |
| **Accessibility** | Removing an auto-dismissing toast that screen readers announce on every load is a net improvement. No new UI. |
| **Observability** | One structured summary log per cron run, plus one log per recovered execution (FR-2.7). |

---

## 6. Acceptance criteria

### R1

- [ ] **AC-1** Loading or hard-refreshing any platform page (including `/`, `/login`, `/test-business-os` and a Business OS page), logged in or logged out, shows **no** "System Ready" toast and no "System initialization failed" toast.
- [ ] **AC-2** On those same loads, the browser network log shows **no** request to `/api/system/initialize`, `/api/system/health` or `/api/system/status`.
- [ ] **AC-3** `components/SafeSystemInitializer.tsx` and `components/SystemInitializer.tsx` no longer exist, and nothing references them (FR-5.1 search is clean).
- [ ] **AC-4** Other toasts on platform pages still render. The `Toaster` in `PlatformShell` is intact.

### R2

- [ ] **AC-5** The recovery job is declared in `vercel.json` (or runs inside an existing declared cron, per Q2). When invoked without a valid `CRON_SECRET` bearer in production mode, it returns 401 and performs no DB read or write. With `CRON_SECRET` unset in production mode, it also returns 401 (fail-closed).
- [ ] **AC-6** A `running` execution older than the threshold is marked `failed`, with the FR-2.6 reason and a completion timestamp in the correct column.
- [ ] **AC-7** A `pending` execution with no `started_at` and a `queued` execution, both older than the threshold, are recovered (F2 regression).
- [ ] **AC-8** An execution younger than the threshold is untouched, in every recoverable status.
- [ ] **AC-9** An execution whose status changes to `completed` between the job's detection and its write is **not** overwritten (FR-2.5).
- [ ] **AC-10** After recovery, a scheduled agent that was blocked by a stuck execution is picked up by `run-scheduled-agents` on its next due run (F1 end-to-end).
- [ ] **AC-11** Two overlapping invocations of the job produce no duplicate or conflicting writes (FR-2.8).
- [ ] **AC-12** No code path other than the cron can invoke recovery (FR-5.1 search shows no other caller).

### R3

- [ ] **AC-13** `POST /api/system/initialize` returns 404 (route removed).
- [ ] **AC-14** An unauthenticated `GET` and `POST` to `/api/system/status` return no user data: the route is gone (404), or returns 401/403 for non-admins. An authenticated non-admin gets the same result.
- [ ] **AC-15** An unauthenticated `GET /api/system/health` performs no service-role query and returns no error text or environment detail. The route is gone, or it returns a minimal liveness body, or 401/403, per the SA decision.

### R4 and general

- [ ] **AC-16** No `console.*` remains in any file this change adds or keeps-and-modifies (FR-4.1).
- [ ] **AC-17** `npm run build` and `npm run lint` pass. `npm test` passes, with new tests covering at least the AC-5 auth failure, AC-6/AC-7 happy path, AC-8, and AC-9. The Playwright suite passes. A Playwright or equivalent check covers AC-1/AC-2 on one platform page.

---

## 7. Out of scope / future roadmap

- Redesigning scheduling, QStash, or `run-scheduled-agents` claim logic.
- F9: `run-scheduled-agents` is not fail-closed when `CRON_SECRET` is unset. This should be a separate fix. It becomes **in scope only if** Q2 folds recovery into that route, because FR-2.1 then applies to it.
- Converting `run-scheduled-agents` / `process-queue` to Pino, unless Q2 makes this change touch them (FR-4.3).
- A user-visible "execution health" or admin dashboard for stuck runs. `/api/system/status` was a partial, unsafe version of this. A proper admin view is a future requirement.
- `/site` not being in `PUBLIC_PREFIXES` (noted in `PlatformChrome.tsx`). This change removes the initializer everywhere, so the gap no longer triggers it. The rest is unrelated.
- Retiring `scripts/reset-stuck-agent.ts`. It remains a manual operator tool, but its 1-hour / `created_at` / `completed_at` choices are an input to Q1, Q3 and Q4.
- Backfilling or re-labelling executions that the old page-view cleanup already marked failed.

---

## 8. Open questions

All are for SA unless stated. Each has a BA-proposed resolution.

- [x] **Q1 — Staleness threshold.** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  Is 30 minutes safe? `process-queue` is capped at 60 s, but `/api/run-agent` has no `maxDuration` and supports user-driven `debugMode` runs that can legitimately stay "running" much longer (F8). The operator script uses 1 hour.
  *Proposed:* derive the threshold per execution path from that path's provable maximum lifetime, following the §8.1 "provably-dead" reaper principle (lease > maxDuration). Exclude or separately bound debug-mode runs. SA sets the actual values. BA does not propose a number.

- [x] **Q2 — New cron or fold into an existing one?** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  No existing cron performs recovery (E11). `run-scheduled-agents` is the natural consumer because it is what stuck rows block, and it already runs every 5 minutes. Folding recovery into it, though, drags in F9 and a full Pino conversion of that route (FR-4.3).
  *Proposed:* a new dedicated cron route (for example under `app/api/cron/`) using the `payment-retry` auth pattern. That keeps the blast radius small and keeps F9 as its own fix.

- [x] **Q3 — Age basis per status.** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  `pending`/`queued` rows lack `started_at` (F2).
  *Proposed:* `started_at` for `running`, and `created_at` (or `scheduled_at` where present) for `pending`/`queued`.

- [x] **Q4 — Completion column.** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  The cleanup writes `ended_at`. Every other writer uses `completed_at` (F3). Please confirm against the live schema whether `ended_at` exists. If it does not, recovery has likely never succeeded.
  *Proposed:* write `completed_at` (and `ended_at` only if it exists and something reads it). Add the finding to the workplan's risk list.

- [x] **Q5 — Concurrency mechanism.** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  Does the §8.1 `FOR UPDATE SKIP LOCKED` claim RPC apply here? This is a sweep, not a queue drain.
  *Proposed:* a single conditional update per row (`… WHERE id = ? AND status IN (recoverable) AND <age condition>`) is sufficient, because the write is idempotent and has no side effects beyond the row. Use the §8.1 RPC only if SA wants batched atomic claiming at scale.

- [x] **Q6 — Fate of `/health` and `/status`.** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  *Proposed:* remove `/api/system/status` (F4 exposure, a stale consumer in `SystemStatus`, no known safe caller). Keep `/api/system/health` only if an external uptime monitor uses it. If so, reduce it to a no-DB, no-detail liveness response. Otherwise remove it. Dev's FR-5.1 search plus a team check for external monitors decides this.

- [x] **Q7 — Audit trail for recoveries.** (raised by: BA | status: resolved by SA 2026-09-19 — see [SA Review](#sa-review))
  Should each system-initiated `failed` transition write an `audit_trail` entry (the user's data was changed by the system)?
  *Proposed:* yes, one non-blocking entry per recovered execution, attributed to the owning `user_id` with a system actor. SA decides whether the volume warrants a per-run summary instead.

- [x] **Q8 — User-facing wording on recovered runs.** (raised by: BA | status: resolved by BA, SA concurred with an amendment 2026-09-19 — see [SA Review](#sa-review))
  This is the only point with a business angle, and it does not need user input.
  *Proposed:* "This run stopped responding and was ended automatically after {N} minutes." It is plain language, states that the platform (not the user) ended it, and states the duration.

**No questions require user escalation.** The one real business trade-off, a gap in recovery between removing the toast and shipping the cron, is closed by FR-2.11 (ship together) rather than left for the user to decide.

---

## 9. Notes on integration points

| Area | Files / tables | Impact |
|---|---|---|
| Platform shell | `components/PlatformShell.tsx`, `components/PlatformChrome.tsx` (read only) | Remove the initializer mount and update the doc comment |
| Deleted client components | `components/SafeSystemInitializer.tsx`, `components/SystemInitializer.tsx` | Deleted (FR-1.2, FR-1.3) |
| System API | `app/api/system/initialize/route.ts`, `app/api/system/status/route.ts`, `app/api/system/health/route.ts` | Remove or lock down (R3) |
| Startup lib | `lib/startup/initialize.ts` | Removed (FR-3.1) |
| Cleanup lib | `lib/cleanup/executionCleanup.ts` | Replaced by the cron implementation, or deleted (FR-2.10) |
| Cron config | `vercel.json` | New cron entry, or none if folded (Q2) |
| Scheduler | `app/api/run-scheduled-agents/route.ts` | Beneficiary of recovery (F1). Touched only if Q2 folds recovery into it |
| Worker | `app/api/cron/process-queue/route.ts` | Read only. Defines `completed_at` usage and the 60 s cap |
| Manual run | `app/api/run-agent/route.ts` | Read only. Its debug-mode runs constrain Q1 |
| Repositories | `lib/repositories/` (`ExecutionRepository`) | Recovery DB access goes through the repository (FR-2.9) |
| Admin authz | `AdminAccessService` | Only if `/status` or `/health` is kept behind admin (Q6) |
| Table | `agent_executions` (`status`, `started_at`, `created_at`, `scheduled_at`, `completed_at`/`ended_at`, `error_message`) | Written by the recovery job, cross-tenant by design |
| Env | `CRON_SECRET` | Required in production. Per project memory, it is currently **not yet set on Vercel** (delegated). Until it is, a fail-closed recovery cron stays dormant. Stuck-execution recovery therefore depends on the same pending ops action as the payment queue-drain crons. |
| Operator tool | `scripts/reset-stuck-agent.ts` | Unchanged. Its semantics inform Q1, Q3 and Q4 |

---

## SA Review

**Reviewed by SA — 2026-09-19** (code measured on `feature/business-os-purge-slice-2` @ `5cdc5521`; live DB probed read-only via `.env.local` service role, zero-row selects + counts, no writes)
**Verdict:** CLEARED WITH CONDITIONS

The direction is right: delete the toast and the page-load trigger, move recovery to a fail-closed cron, and close `/api/system/*`. Verifying against the code and the live database changed two things. (1) The existing page-load cleanup has **never succeeded once**, so FR-2.11 ("no gap") is moot and the security fix can ship first. (2) Debug runs do not hold non-terminal `agent_executions` rows, so the threshold can be one value on one basis.

### A. Verification of BA claims

| Claim | Verdict | Evidence (SA-measured) |
|---|---|---|
| **F1** — stuck rows block the scheduler permanently | ✅ **Confirmed, and it is happening in production.** | `run-scheduled-agents/route.ts` L116–133 skips on `pending`/`queued`/`running`. Live DB: 4 non-terminal rows (2 `pending` from 2026-02-26 and 2026-05-16, 2 `running` from 2026-05-27/28). They belong to **all 3** active scheduled agents (`mode=scheduled`, `status=active`, `schedule_enabled=true`). Each agent's `next_run` has been in the past since Feb/May. Every scheduled agent on the platform is blocked right now. |
| **F2** — `pending` rows have no `started_at`; `queued` not covered | ✅ **Confirmed.** | Both live `pending` rows have `started_at = null`. The cleanup filters `.in('status',['running','pending']).lt('started_at',…)` and never matches NULL. `queued` is written by `lib/database/executionHelpers.ts` L84 (`updateExecutionWithJobId`) and blocks the scheduler, but the cleanup never selects it. |
| **F3 / Q4** — `ended_at` does not exist | ✅ **Confirmed on the LIVE schema.** | Zero-row `select('ended_at')` on `agent_executions` → `42703 column agent_executions.ended_at does not exist`. `completed_at`, `started_at`, `created_at`, `scheduled_at`, `updated_at`, `error_message` all exist. **0** rows carry the cleanup's message (`Execution timed out after%`). The 2 `running` rows from May, which the cleanup's own filter matches, were never recovered. **The page-load recovery has never succeeded.** Correction to BA: `completed_at` is not the only other write. `lib/execution/agentExecutionEngine.ts` L307/L340 also writes `ended_at`, but that file has no importers (dead code, see §E). |
| **F4** — `/api/system/status` exposes cross-tenant data | ✅ **Confirmed. Severity: High.** | Unauthenticated, service-role, no `user_id` filter. `GET` returns platform-wide agent counts, the last 20 executions' status stats, and **`id`, `agent_name`, `next_run` for up to 10 scheduled agents across all users**. `POST {agentId}` returns name, schedule and latest execution (id, status, progress, timestamps) for any id. The two chain together: `GET` leaks the ids that `POST` needs, so UUID unguessability gives no protection. It is metadata, not content or credentials, so it is High rather than Critical. But agent names are user-authored and can contain customer or business names. **Ship first** (see §C). |
| **F5** — `/api/system/health` | ✅ Confirmed. Medium. | Service-role query for anonymous callers. Returns raw `error.message` from the DB in the body, plus env-presence flags. |
| **F8** — debug runs can stay "running" in `agent_executions` for a long time | ❌ **Refuted for this table.** | Pilot/debug runs keep their live state (`running`/`paused`) in **`workflow_executions`** (`lib/pilot/StateManager.ts`). They insert into `agent_executions` only at the end, already `completed`/`failed` (L502, L684). The `run-agent` AgentKit path also inserts terminal rows only (L407). The only writers of **non-terminal** `agent_executions` rows are the QStash path (`run-agent` queue branch L793, `run-scheduled-agents` L168, `process-queue` L176/L397) and `run-scheduled-agents-direct` (`maxDuration=60`). Debug mode does not constrain Q1. |
| **F9** — `Bearer undefined` accepted | ✅ **Confirmed, with a corollary.** | `run-scheduled-agents` L60 compares against the template `` `Bearer ${process.env.CRON_SECRET}` ``. With the secret unset, an attacker sending `Bearer undefined` passes. Vercel sends **no** `Authorization` header when `CRON_SECRET` is unset, so Vercel's own invocations get 401. **While `CRON_SECRET` is unset on Vercel, the scheduler never runs from the real cron, and only a forged header can trigger it.** Severity Low–Medium: it can only trigger runs of agents that are already due, and the `next_run` CAS prevents duplicates. It stays out of scope as its own fix (see §E). |
| **F6, F7, E1–E13** | ✅ Confirmed as stated. | Repo-wide search (excluding `.claude/worktrees/`) finds **no** importer of `SafeSystemInitializer` other than `PlatformShell.tsx`, and no importer of `SystemInitializer`/`SystemStatus`, `initializeApplication`, `getApplicationStatus`, `__NEURONFORGE_INITIALIZED__`, `executionCleanup`, `getCleanupStats` or `startAutomaticCleanup` outside the files being deleted. The only non-code reference to `/api/system/*` is a manual troubleshooting line in `docs/VERCEL_ENV_SETUP.md` L183 (`/api/system/health`). FR-5.1 still stands as Dev's recorded deliverable. |

### B. Decisions on open questions

| Q | Decision | Rationale |
|---|---|---|
| **Q1 — Threshold** | **One named constant, `STALE_EXECUTION_THRESHOLD_MINUTES = 120`**, measured on `created_at`. | Per the §8.1 "provably-dead" principle, the threshold must exceed the longest legitimate life of a non-terminal row. That row only exists on the QStash path (F8 refuted). Worst case: `publishJSON` with `retries: 3` (`lib/queues/qstashQueue.ts` L96). Upstash's documented default backoff is `e^(2.5n)` s, about 12 s + 148 s + 1808 s ≈ 33 min, plus 4 deliveries × 60 s `maxDuration` (`process-queue` L14), for ≈ **37 min** end to end. `run-scheduled-agents-direct` is capped at 60 s. 120 min is about 3× that bound, which leaves margin for QStash delivery lag or a later default change. The cost is that a blocked scheduled agent resumes within about 2 h instead of 30 min, which is acceptable for a recovery path. The 30-min value in the old code was **below** the retry window and would have killed rows mid-retry if its write had ever worked. **Dev pre-check:** confirm the QStash retry/backoff config in the workplan (no custom `retryDelay` is set today). If anyone later raises `retries` or `maxDuration` on the worker, this constant must be re-derived. Put a comment next to the constant that says so and names both source files. |
| **Q2 — Cron placement** | **New dedicated route `app/api/cron/stale-execution-recovery/route.ts`**, declared in `vercel.json` with schedule `*/15 * * * *`, `maxDuration = 60`. | Folding it into `run-scheduled-agents` would pull F9 and a ~22-call Pino conversion into this change, and would couple a sweep to the scheduler's 30 s budget. A 15-min cadence is well inside the 120-min threshold. Auth copies the `payment-retry` `verifyCronSecret` shape exactly (dev allow, prod fail-closed on unset secret, strict bearer compare, correlation ID, Pino). Nine cron routes already duplicate that helper. Extracting a shared one is an optional follow-up, not required here. |
| **Q3 — Age basis** | **`created_at` for every recoverable status** (`pending`, `queued`, `running`). **Not** `started_at`, **not** `scheduled_at`. | `created_at` exists on every row (verified live) and never moves. `started_at` is null for `pending`/`queued`, and `process-queue` **resets** it on every QStash redelivery (L176–178 via L397), so it cannot bound total lifetime. `scheduled_at` is client-supplied on some insert paths. One basis also makes the query a single predicate, which suits a later `(status, created_at)` index. It matches `scripts/reset-stuck-agent.ts`. |
| **Q4 — Completion column** | **Write `completed_at` and `updated_at`. Never `ended_at`.** | `ended_at` does not exist live (§A). Payload: `{ status: 'failed', error_message: <Q8 text>, completed_at: now, updated_at: now }`. Do **not** compute `execution_duration_ms` (no reliable start). Add to the workplan risk list that the old mechanism never worked, so this cron will recover the **existing 4 rows** on its first run (see §D). |
| **Q5 — Concurrency** | **Conditional update. No §8.1 claim RPC, no migration.** | §8.1 exists to stop double **effects** (send/charge/dispatch) from overlapping drains. This job has no effect beyond the row itself, and the job *is* the reaper. Shape: (1) select up to `BATCH = 100` candidate ids (`status IN ('pending','queued','running') AND created_at < threshold`, ordered by `created_at`); (2) **one** `update … .in('id', ids).in('status', RECOVERABLE).lt('created_at', threshold).select('id, agent_id, user_id, status, created_at')`. PostgREST runs this as a single `UPDATE … WHERE … RETURNING`, so row locks plus WHERE re-evaluation make it atomic per row. A run that completed in between is skipped (FR-2.5, AC-9). With two overlapping invocations, the second finds no rows (AC-11). Log and audit **only the returned rows**, not the candidates. **Note:** the `RETURNING` projection reports the row **after** the update (`status = 'failed'`), so the prior status for FR-2.7 must come from the step-1 candidate map, keyed by id and filtered to returned ids. Use an explicit allow-list `IN`, never `NOT IN`: live data contains a legacy terminal status `success` (145 rows) that must never be touched. |
| **Q6 — `/status` and `/health`** | **Delete `app/api/system/status/route.ts`** (and with it `getCleanupStats`). **Reduce `app/api/system/health/route.ts` to a static liveness response**: `GET` → `200 { success: true, data: { status: 'ok', timestamp } }` (amended by SA in the Slice 1 workplan review, Q-B; originally `{ ok: true, timestamp }`), no DB call, no env flags, no error text, Pino if it logs at all. **Delete `app/api/system/initialize/route.ts`.** | `/status` has no caller (the only consumer, `SystemStatus`, is dead and reads fields the route no longer returns). An admin view is already out of scope (§7), so gating it behind `AdminAccessService` would be keeping dead code alive. `/health` is referenced in `docs/VERCEL_ENV_SETUP.md` as a manual deploy check, and an external uptime monitor may exist that we cannot see from the repo. A no-data liveness probe is harmless and avoids breaking either. Dev updates that doc line. Deleting `/health` entirely is also acceptable if TL confirms no monitor uses it. |
| **Q7 — Audit** | **Yes, one non-blocking entry per recovered row.** `userId: row.user_id` (the owner, so it shows in their trail), no `actorId` (the service falls back to `SYSTEM_ADMIN_USER_ID` and marks `system_action`), `entityType: 'agent'`, `entityId: row.agent_id`, details `{ executionId, priorStatus, ageMinutes, reason: 'stale_execution_recovery' }`, `severity: 'warning'`. Add a new constant **`AGENT_RUN_AUTO_RECOVERED`** to `lib/audit/events.ts`, with its metadata entry. | The system changed a user's record. The owner and support should be able to see that without reading Pino logs. Volume is tiny (4 rows in the platform's whole history). A dedicated event, rather than reusing `AGENT_RUN_FAILED`, lets support tell "your agent failed" apart from "the platform cleaned up a dead run". `.catch()` so audit failure never blocks recovery. |
| **Q8 — Wording** | **Concur, with one amendment:** *"This run stopped responding and was ended automatically. It had not finished {N} minutes after it was queued."* `{N}` is rendered from the constant. | BA's wording says "after {N} minutes", which implies run time. The basis is `created_at` (Q3), so the clock starts at queueing, and the amended text matches what was measured. No user decision needed. |

### C. Delivery shape (supersedes FR-2.11)

FR-2.11 assumed the page-load cleanup provides recovery today. It does not (§A, F3), so removing it loses nothing, and holding the security fix for the cron gains nothing. **Dev delivers two slices, in order. Each can be released on its own.**

| Slice | Contents | Why |
|---|---|---|
| **1 — Security + UX (ship first, small)** | R1 in full. R3: delete `/initialize` and `/status`, reduce `/health` to liveness. Delete `lib/startup/initialize.ts` and `lib/cleanup/executionCleanup.ts` (FR-2.10's "or is deleted" branch). Update `PlatformShell` comment and `docs/VERCEL_ENV_SETUP.md`. ACs 1–4, 13–16, plus build/lint. | Closes a **High** unauthenticated cross-tenant read (F4) and an anonymous service-role write path (F6). Zero functional regression. `R1` and the `/initialize` deletion **must be in the same slice**: deleting the route alone would turn the success toast into a "System initialization failed" error toast on every page. |
| **2 — Recovery cron** | R2 + R4 for the new route, repository methods, audit event, tests (ACs 5–12, 17). | New capability. Its first run will also unblock the 3 stuck scheduled agents (§D). |

FR-2.11 is replaced by: *"Slice 1 must not ship later than Slice 2. Slice 2 may ship any time after Slice 1."*

### D. Conditions Dev must meet

1. **Repository pattern (Mandatory Rule 1).** `ExecutionRepository` exists, but it has **no** methods for this, **no** `create`, it defaults to the browser anon client, and its `findById(id)` is unscoped. Add two methods, following `.claude/skills/new-repository/SKILL.md`: `findStaleForRecovery(thresholdIso, limit)` and `markStaleAsFailed(ids, thresholdIso, errorMessage)`. The latter performs the Q5 conditional update and returns the transitioned rows. The cron constructs the repository with **`supabaseServer` explicitly** and a comment. Both methods carry the project's `⟨unscoped-by-design⟩` JSDoc marker (precedent: `PaymentAutomationRepository` L195, `LeadResponseRepository` L116). The comment must say why: *a platform-level reaper of provably-dead rows, acting only on ids it selected itself under a status+age predicate, invoked only by a `CRON_SECRET`-authenticated cron*. No direct `.from('agent_executions')` in the route.
2. **Tenant isolation (tenant-isolation-guard).** This job is cross-tenant by design, which is acceptable because it takes **no caller-supplied ids or fields**. The route accepts no body or query parameters, and has no Zod schema because it has no input (state that explicitly in the route header). Ids come only from its own select. The update payload is a fixed literal, with no spread and no `user_id` write. Every effect beyond the row (audit, logs) is attributed to **that row's** `user_id` (skill Step 6). No DB triggers on `agent_executions` were found in `supabase/migrations/`. Dev re-confirms this against the live DB in the workplan, because a trigger that fans out on `status → failed` (e.g. stats or credits) would widen the blast radius.
3. **Explicit status allow-list** `RECOVERABLE_STATUSES = ['pending','queued','running'] as const`, exported from one place. Never touch `success`, `completed`, `failed` or `cancelled`.
4. **Bounded work.** `BATCH = 100` per invocation, one batch per run. Log `hasMore` when the candidate query returns a full batch. Do not loop to exhaustion inside the 60 s budget.
5. **FR-2.7 logging** with the prior status sourced as described in Q5. Per-row log carries `executionId`, `agentId`, `userId`, `priorStatus`, `ageMinutes`. One summary log per run: `scanned`, `recovered` by status, `durationMs`, `correlationId`.
6. **Tests (AC-17).** Add to BA's list: (a) an unset `CRON_SECRET` in production returns 401, **and** a literal `Bearer undefined` returns 401 (F9 regression guard for the new route); (b) a row with legacy status `success` older than the threshold is untouched; (c) an audit failure does not fail the run.
7. **FR-5.1** is still required and must list the `.claude/worktrees/` hits as ignored (stale worktree copies, not shipped code).
8. **`console.*`:** Slice 1 touches only files that are deleted, plus `PlatformShell.tsx` (no `console.*`) and `/health`, which is rewritten on Pino. Slice 2's new route and the repository methods use Pino only.

### E. Out-of-scope findings for TL to log (do not fix here)

| # | Finding | Severity |
|---|---|---|
| E-1 | **`ExecutionRepository.create` does not exist**, but `app/api/run-agent/route.ts` calls it at L407 (AgentKit result logging) and L793 (manual **queue** path). Build ignores TS errors, so at runtime this throws `TypeError`: the queue branch returns 500, and AgentKit runs are not logged to `agent_executions`. Needs its own `fix/` ticket. | High (functional) |
| E-2 | F9: `run-scheduled-agents` should adopt the fail-closed `verifyCronSecret` shape (and then be converted to Pino, 22 `console.*`). | Low–Medium |
| E-3 | `lib/execution/agentExecutionEngine.ts` has no importers and writes the non-existent `ended_at`. Candidate for deletion. | Low |
| E-4 | `CRON_SECRET` is unset on Vercel (project memory). Until it is set, the **scheduler, the payment drains and this new recovery cron are all dormant** in production. Slice 2 changes nothing for users until then. | Ops dependency |

### F. For the user (business terms)

One genuine business decision, needed **before Slice 2 goes live**, not before the workplan:

> **Three customers' scheduled agents have been silently stopped since February–May** because an earlier run never finished. When the recovery job goes live (and the cron secret is set), those agents will **start running on their schedules again automatically**, after months of silence. Their last run will show in their history as "stopped responding".
> **Option A:** let them resume automatically (simplest; these customers expected them to be running).
> **Option B:** pause those 3 agents first and tell their owners, so nobody is surprised by, for example, emails going out again after a long gap.

Everything else in this review is a technical decision and is resolved above.

### Approval

[x] Requirement cleared for Dev workplan, subject to §D conditions and the §C two-slice delivery. SA reviews the workplan against §B–§D.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Created (Draft) | BA draft from the user's toast report and TL-verified investigation. Re-verified the evidence and added findings F1–F9: scheduler blocking, `pending`/`queued` gap, `ended_at` mismatch, unauthenticated cross-tenant `/api/system/status`. Ready for SA review. |
| 2026-09-19 | SA review — CLEARED WITH CONDITIONS | SA verified the findings against the code and the live DB. `ended_at` does not exist, so the page-load recovery never succeeded. 4 stuck rows are blocking all 3 active scheduled agents. F4 rated High. F8 refuted: debug runs live in `workflow_executions`. Resolved Q1–Q8: 120-min threshold on `created_at`, new dedicated cron, conditional update instead of §8.1, delete `/status` and `/initialize`, `/health` reduced to liveness, new audit event, amended wording. Replaced FR-2.11 with a two-slice delivery (security fix first). Logged out-of-scope findings E-1 to E-4. One business decision surfaced (resuming 3 dormant agents). |
| 2026-09-19 | SA amendment (Q6 body shape) | During the Slice 1 workplan review, changed the `/health` liveness body to the standard `{ success: true, data: { status, timestamp } }` envelope. This follows CLAUDE.md and keeps the old top-level `success` key for any body-parsing monitor. |
