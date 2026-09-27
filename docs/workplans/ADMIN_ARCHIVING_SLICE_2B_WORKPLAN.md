# Workplan: Admin Archiving, Slice 2b (runs, POST, dialog, audit)

> **Last Updated**: 2026-09-26

**Developer:** Dev
**Requirement:** [ADMIN_ARCHIVING_MODULE_REQUIREMENT.md](/docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md), §13.3 Slice 2, D-1, C-1, C-5, C-7, C-9f, C-12, C-15, C-16, TQ-1, TQ-3
**Parent workplan:** [ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md](/docs/workplans/ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md). Its §2 design, SA review (R-1 to R-6, Q-1 to Q-14) and 2a record stay authoritative. This file replaces only its §7 "Slice 2b" task list (T-b0 to T-b10) and the 2b rows of §8 and §9, re-verified against the code now on `main`.
**Branch:** `feature/admin-archiving-s2b`, cut from `origin/main` at `12ffede3` (PR #116, the 2a merge).
**Process:** Full cycle: Dev workplan → SA workplan review → Dev implement → SA code review → QA → user → RM.
**Date:** 2026-09-26
**Status:** **Code Complete; SA code review: approved for QA** (4 Low comments, non-blocking). SA workplan review: approved with changes R-1, R-2 (both applied) and O-1 (applied). Not committed: RM commits after user approval. **No migration in 2b** (§1.2).

## Overview

2b adds the write side of archiving on top of what 2a delivered: the three audit events, the run request schema, the repository run methods, a time-boxed runner, `POST /api/admin/archiving/runs`, and the confirm dialog with Continue on `/admin/archiving`. Runs stay refused on the server (`ARCHIVE_RUNS_ENABLED = false`, 409 `runs_not_enabled`) until Slice 3. So on PROD, 2b is observable only as: the dialog opens with the right numbers, Confirm is disabled, and a hand-made POST gets 409.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Differences From the Original T-b Plan](#3-differences-from-the-original-t-b-plan)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Task List](#5-task-list)
- [6. Test Plan](#6-test-plan)
- [7. Manual QA (PROD, runs off)](#7-manual-qa-prod-runs-off)
- [8. How the Live Flow Is Proven in Slice 3](#8-how-the-live-flow-is-proven-in-slice-3)
- [9. Tenant Isolation Review](#9-tenant-isolation-review)
- [10. Documentation](#10-documentation)
- [11. Open Questions for SA](#11-open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Measured on `feature/admin-archiving-s2b` at `12ffede3`.

### 1.1 What 2a actually built (and 2b builds on)

| Area | As built on `main` | 2b impact |
|---|---|---|
| `lib/archiving/config.ts` | `ARCHIVE_SOURCES` (`audit_trail`, `batchSize: 1000`), `ARCHIVE_SOURCE_KEYS`, `ARCHIVE_RUNS_ENABLED = false`, `ARCHIVE_RUN_STATUSES`, `STALE_RUN_AFTER_MS`, `RUN_HISTORY_LIMIT`, `cutoffFor()` | Nothing to add |
| `lib/archiving/types.ts` | `ArchiveRunSummary`, `ArchiveSourceOverview` (with `archivedTotal`, `latestCutoff`, `lastRun`), `ArchivingOverview.runs`, `runsEnabled` | Add the POST result type only |
| `lib/validation/archiving.ts` | `retentionDaysSchema` (`z.custom` over `isRetentionDays`), `archiveSourceKeySchema` | Add `archiveRunRequestSchema` |
| `ArchiveRepository` | 6 read methods; `ArchiveRunRow` and `ARCHIVE_RUN_COLUMNS` exported; header says "READ-ONLY in Slice 2a"; `toError()` helper; `{ data, error }`, never throws | Add 5 run methods; header rewritten |
| `GET /api/admin/archiving` | Returns `runsEnabled`, `runs` (with `isStale`), per-source `lastRun`. `toRunSummary()` and the admin-label lookup are **private to this route file** | **Not modified** (see §3, D-1) |
| Page | One `'use client'` file, 380 lines. Archive button is `disabled` with no handler, described by "Not switched on yet". Header badge "Read-only". No POST anywhere | Dialog + Continue |
| Page source guard | Walks every file under `app/admin/archiving/` (not only `page.tsx`); forbids any `method: 'POST'`; allows only `fetch('/api/admin/archiving')`; allows any `@/lib/archiving/*` import | Three rules change deliberately (§6.5) |
| Audit catalogue | `lib/audit/eventAudience.ts` (added by admin reorganisation slice 2c, **after** the Slice 2 workplan was written) is an exhaustive map: every event must be tagged `bos`, `shared` or `agentspilot`, and `eventAudience.test.ts` pins **157 events = 15 / 58 / 84** | New events need a tag and the pin moves (§3, D-3) |
| `adminGate.writes.test.ts` | `CASES` pinned at **58**. The fake client records `from`/`rpc` touches, and `@/lib/supabaseServer` is mocked, so `ArchiveRepository` is covered | 58 → 59 |
| Admin handler census | Measured: **53 route files, 82 handlers, 76 with `requireAdmin`, 6 inline** (`agents`, `business-os/llm-usage`, `business-os/llm-usage/businesses`, `chat-usage`, `users/[id]/audit-logs`, `users/[id]/login-stats`). Matches `ADMIN_IDENTIFICATION_AND_ACCESS.md` | After 2b: **54 / 83 / 77 / 6** |

### 1.2 No migration needed (checked against M1 as applied)

| 2b needs | M1 provides |
|---|---|
| Insert a run, read it back | `archive_runs` `GRANT SELECT, INSERT, UPDATE` to `service_role` |
| Claim, takeover, finish | `UPDATE` grant; `last_batch_at`, `finished_at`, `error_code` columns |
| `error_code` values `batch_failed`, `interrupted` | CHECK `^[a-z_]{1,64}$`: both pass |
| 409 on a second running run | Partial unique index `archive_runs_one_running_per_source` → `23505` |
| Move a batch | `archive_audit_trail_batch(uuid, timestamptz, integer)` returns one row `(selected_count, inserted_count, deleted_count)`; `EXECUTE` to `service_role`; refuses batch size outside 1..5,000 and any run that is not `running` with exactly `p_cutoff` |

---

## 2. Implementation Approach

The flow is the parent workplan's §2.1, unchanged in substance:

```
POST /api/admin/archiving/runs        (runtime nodejs, dynamic force-dynamic, maxDuration 60)
  requireAdmin                                      first statement (C-1)
  body = request.json().catch(() => null)
  archiveRunRequestSchema.safeParse                 400 invalid_body
  ARCHIVE_RUNS_ENABLED?                             409 runs_not_enabled   (nothing read or written, C-5)
  takeOverStaleRuns(now)                            stale running → partial / 'interrupted' (TQ-1)
  start:    createRun(source, days, cutoffFor(days, now), startedBy = admin)
                                                    conflict → 409 run_in_progress
            audit ARCHIVE_RUN_STARTED
  continue: claimRunForContinue(runId, now)         not_continuable → 409 run_not_continuable
                                                    conflict → 409 run_in_progress
  runArchive({ run, batchSize, budgetMs: 45_000 })
  terminal audit: COMPLETED (succeeded) / FAILED (failed); nothing on partial (C-9f)
  await auditTrail.flush()
  200 { runId, outcome, rowsArchived, batches }  |  500 archive_batch_failed + runId
                                                 |  500 run_unfinished + runId (SA O-1: rows may
                                                    have moved but the finish was not recorded)
```

### 2.1 Validation (`lib/validation/archiving.ts`)

```typescript
export const archiveRunRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), source: archiveSourceKeySchema, retentionDays: retentionDaysSchema }).strict(),
  z.object({ action: z.literal('continue'), runId: z.string().uuid() }).strict(),
]);
export type ArchiveRunRequest = z.infer<typeof archiveRunRequestSchema>;
```

`.strict()` is the field allow-list: `cutoff`, `startedBy`, `status`, `batchSize` in the body are a 400, not silently dropped. Built from the Slice 1 schemas, so the three retention values are still written once.

### 2.2 Repository run methods (`ArchiveRepository`)

Q-7 naming: plain names on `archive_runs` (no `user_id`); `…AllAccounts` on the method that moves `audit_trail` rows. All return a result and never throw. The header is rewritten: it now writes, still only from `requireAdmin` routes, still never selects `payload`.

| Method | Query | Result |
|---|---|---|
| `takeOverStaleRuns(now)` | **Two** plain updates, both `.eq('status', 'running')` and `update({ status: 'partial', error_code: 'interrupted', finished_at: now })`: (a) `.lt('last_batch_at', t)`; (b) `.is('last_batch_at', null).lt('started_at', t)`, with `t = now − STALE_RUN_AFTER_MS`. `.select('id')` on each | `{ data: string[] }` ids flipped |
| `createRun({ source, retentionDays, cutoff, startedBy })` | `insert({ source, retention_days, cutoff: cutoff.toISOString(), status: 'running', started_by })`, field by field, `.select(ARCHIVE_RUN_COLUMNS).single()` | `{ kind: 'created', run }` · `{ kind: 'conflict' }` on `23505` · error |
| `claimRunForContinue(runId, now)` | `update({ status: 'running', last_batch_at: now, finished_at: null, error_code: null }).eq('id', runId).in('status', ['partial', 'failed']).select(ARCHIVE_RUN_COLUMNS)` | `{ kind: 'claimed', run }` · `{ kind: 'not_continuable' }` on 0 rows · `{ kind: 'conflict' }` on `23505` · error |
| `runBatchAllAccounts(source, runId, cutoff, batchSize)` | `rpc(BATCH_FUNCTIONS[source], { p_run_id, p_cutoff, p_batch_size })`. `BATCH_FUNCTIONS: Record<ArchiveSourceKey, string>` lives here, server-only (Q-6). Reply must be exactly one row of three non-negative integers, else error | `{ data: { selected, inserted, deleted } }` · error |
| `finishRun(runId, { status, errorCode, now })` | `update({ status, error_code, finished_at: now }).eq('id', runId).eq('status', 'running').select(ARCHIVE_RUN_COLUMNS)` | `{ data: run }` · error on 0 rows |

Notes:
- **Two updates instead of one `.or(...)` string** for the takeover (a change from the parent plan): a PostgREST `or` filter needs the ISO timestamps quoted by hand, and two plain filters are easier to read and to test. Each update is atomic on its own, and a run can match at most one of them.
- **The cutoff passed to the RPC is the stored string** from the created or claimed row, never re-derived. The function compares `cutoff = p_cutoff` exactly; the stored value is the one that is guaranteed to match.
- **`claimRunForContinue` writes `last_batch_at`** so a just-claimed run that was `partial` for days does not look stale to a concurrent request (parent §2.1).

### 2.3 Runner (`lib/archiving/server/runArchive.ts`, new)

```typescript
export async function runArchive(deps: {
  repo: Pick<ArchiveRepository, 'runBatchAllAccounts' | 'finishRun'>;
  run: ArchiveRunRow;       // created or claimed; its cutoff is the only one used
  batchSize: number;        // ARCHIVE_SOURCES entry
  budgetMs: number;         // 45_000
  clock: () => number;
  logger: Logger;
}): Promise<{ outcome: 'succeeded' | 'partial' | 'failed'; run: ArchiveRunRow | null }>;
```

- Loop: check the budget **before** each batch; call the RPC; stop on `selected = 0` (→ `succeeded`), on a batch error (→ `failed`, `batch_failed`) or when the budget is spent (→ `partial`). Then one `finishRun`.
- One structured log line per batch: `runId`, `source`, `retentionDays`, `selected`, `inserted`, `deleted`, `elapsedMs`.
- If `finishRun` fails it is logged and `run: null` is returned, never thrown. The run stays `running`, becomes stale after 5 minutes, and the next POST's takeover flips it to `partial` so Continue can finish it (parent §2.1: no second recovery path).
- 45 s budget inside `maxDuration = 60`: worst case is 45 s + one batch (1–2 s, `lock_timeout` 5 s) + finish + audit flush, well under 60 s.
- It lives under `lib/archiving/server/` so the page guard can forbid that folder by path.

### 2.4 Route (`app/api/admin/archiving/runs/route.ts`, new)

- `POST` only. Order exactly as the diagram. `ARCHIVE_RUNS_ENABLED` is read **inside** the handler, not copied into a module-level value, so a test can switch it (§6.3).
- The source's `batchSize` comes from `ARCHIVE_SOURCES` by `run.source`. An unknown source on a claimed row is a 500 (the DB and registry disagree; do not guess).
- **Audit (C-16, Q-8).** `entityType: 'archive_run'`, `entityId: run.id`, `userId` and `actorId` = `gate.user.id`, `details: { source, retentionDays, cutoff, rowsArchived, batches, correlationId }`, `request`. Severity from `EVENT_METADATA`: `warning` for started and completed, `critical` for failed. `STARTED` only after `createRun` succeeds (never on Continue); `COMPLETED` / `FAILED` only on those outcomes; nothing on `partial` or on an unfinished run.
- **`await auditTrail.log(...).catch(...)` then `await auditTrail.flush().catch(...)`**, as in the entitlements route (WC-7). `log()` enqueues only after an awaited hash, so an un-awaited `log()` followed by `flush()` can flush an empty queue. `log()` never throws (it catches internally), so awaiting it cannot fail the request. See Q-b2.
- **Responses.** 200 `{ success: true, data: { runId, outcome, rowsArchived, batches } }` for `succeeded` and `partial`. 500 `{ success: false, error: 'archive_batch_failed', runId }` for `failed`. 500 `Internal server error` for a thrown error or an unfinished run. `details` only in development.
- Nothing is logged except ids, counts and codes. No email, no payload.

### 2.5 Page

- **Archive button** is enabled and opens a Radix `Dialog` (C-15, Q-1). The dialog lives in `app/admin/archiving/components/ArchiveConfirmDialog.tsx` so `page.tsx` stays readable; the source guard already walks the whole folder.
- **Dialog content:** source label; "Keep records live for N days"; cutoff "about <UTC>; the exact time is fixed when you confirm"; rows that will move (the selected option's `eligibleRows`); "Archived records can't be viewed or restored from the product" (K-2); and at 180 or 90 only, **"Business owners will see only the last N days of their own activity history from now on."** (K-1, AC-8).
- **Confirm** posts `{ action: 'start', source, retentionDays }`. **While `runsEnabled` is false, Confirm is disabled and described by "Not switched on yet"**, and no request is made.
- **Continue** appears in the run-history row of a `partial` run, a `failed` run, or a `running` run with `isStale`. It posts `{ action: 'continue', runId }` without a dialog (it resumes an already confirmed run on its stored cutoff). Disabled with the same note while runs are off.
- After any POST the overview is refetched. Response codes map to plain sentences: `runs_not_enabled` "Archiving is not switched on yet"; `run_in_progress` "Another run is in progress"; `run_not_continuable` "This run can't be continued"; `archive_batch_failed` "A batch failed and nothing was lost. Press Continue to retry"; anything else "The run could not be started". Raw error text is never shown.
- The Dialog primitive falls back to light `--v2-*` colours on the admin shell, as `Select` did; the same `!` overrides are used (the `DARK_SELECT` precedent), without editing the primitive.
- The header badge "Read-only" becomes "Runs off" while `runsEnabled` is false and disappears when true: the page is no longer read-only in principle, and the badge should say what is actually true.

---

## 3. Differences From the Original T-b Plan

Caused by how 2a was built, or found while re-verifying against `main`.

| # | Original plan | Now | Why |
|---|---|---|---|
| **D-1** | POST returns `{ run: ArchiveRunSummary, outcome }` | Returns `{ runId, outcome, rowsArchived, batches }` (`ArchiveRunResult` in `types.ts`) | `toRunSummary()` and the admin-label lookup are private to the GET route. Returning a full summary would mean moving them into a shared server module and changing the GET, for a response the page discards: it refetches the overview after every POST anyway |
| **D-2** | Takeover as one update with an `.or(...)` filter string | Two plain updates | No hand-quoted timestamps inside a PostgREST `or` string; same effect, simpler tests |
| **D-3** | New `lib/audit/__tests__/archivingEvents.test.ts` | **No new audit test file.** Tag the 3 events in `eventAudience.ts` and move the `eventAudience.test.ts` pin **157 → 160 events, shared 58 → 61** | `eventAudience.ts` did not exist when the plan was written; its exhaustive test already fails on an untagged event, `filterOptions.test.ts` already proves every registered event is selectable (AC-9), and `CLIENT_WRITABLE_EVENTS` / `_ENTITY_TYPES` are allow-lists, so the new values are server-only by construction. A new file would pin the same facts twice (SA simplicity rule) |
| **D-4** | Runner test X-5 (no payload or email in logs) | Dropped | The RPC returns three integers; the runner never holds a payload or an email. The route test keeps one "logs no email" assertion |
| **D-5** | Route P-3 (admin check throws → 403) in the route test | Covered only by `adminGate.writes.test.ts` | That file already runs all four denial cases (401, 403, throws → 403, auth throws → 401) with "touched nothing". The route test keeps one 401 and one 403, as briefed |
| **D-6** | Source guard: "allow `@/lib/archiving/*`" | Allow `@/lib/archiving/config` and `@/lib/archiving/types` only | 2b creates `lib/archiving/server/`; the current prefix rule would let the page import it |
| **D-7** | Dialog inline in `page.tsx` | Separate `components/ArchiveConfirmDialog.tsx` | `page.tsx` is 380 lines already; the guard walks the folder, so no rule is lost |
| **D-8** | Header badge unspecified | "Runs off" while runs are off | See §2.5 |
| — | Handler counts "81 → 82 / 52 → 53 / 75 → 76" | **82 → 83 / 53 → 54 / 76 → 77**, 6 inline | Measured on `main` after the health-summary merge |

Everything else (T-b1 to T-b10 content, Q-1 to Q-14 answers, the 45 s / 5 min / 1,000 numbers, the naming) is unchanged.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/audit/events.ts` | modify | `ARCHIVE_RUN_STARTED`, `ARCHIVE_RUN_COMPLETED`, `ARCHIVE_RUN_FAILED` + `EVENT_METADATA` (C-16) |
| `lib/audit/types.ts` | modify | `archive_run` in `AUDIT_ENTITY_TYPES` |
| `lib/audit/eventAudience.ts` | modify | The 3 events tagged `shared` (Q-b1) |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | Pin 157 → 160, shared 58 → 61 (deliberate) |
| `lib/validation/archiving.ts` + `__tests__/archiving.test.ts` | modify | `archiveRunRequestSchema` |
| `lib/archiving/types.ts` | modify | `ArchiveRunResult` |
| `lib/repositories/ArchiveRepository.ts` | modify | 5 run methods, `BATCH_FUNCTIONS`, header |
| `lib/repositories/__tests__/ArchiveRepository.test.ts` | modify | Run-method cases; U-R10 renamed "read methods do not write"; method pin 6 → 11 |
| `lib/archiving/server/runArchive.ts` + `__tests__/runArchive.test.ts` | create | Runner |
| `app/api/admin/archiving/runs/route.ts` + `__tests__/route.test.ts` | create | POST |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | One case; `toHaveLength(58)` → `59` and its comment |
| `app/admin/archiving/page.tsx` | modify | Archive opens the dialog; Continue; POST; badge |
| `app/admin/archiving/components/ArchiveConfirmDialog.tsx` | create | The dialog |
| `app/admin/archiving/format.ts` | create | `formatUtc` / `formatCount`, moved out of `page.tsx` so the dialog can share them (Implementation Notes I-1) |
| `lib/repositories/index.ts` | modify | Export the new result types |
| `app/admin/archiving/__tests__/page.render.test.tsx` | modify | Dialog and Continue cases; the two "disabled Archive" / "no way to start" pins replaced |
| `app/admin/archiving/__tests__/source.guard.test.ts` | modify | §6.5 |
| `docs/REPOSITORY_STRATEGY.md` | modify | Run methods (§10) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Counts and register row 83 (§10) |
| `docs/workplans/ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md` | modify | One pointer line under its §7 "Slice 2b" to this file, plus a Change History row |
| `CLAUDE.md` | **flagged, not edited** | §10 |

**Not modified:** `app/api/admin/archiving/route.ts` (GET), `lib/archiving/config.ts` (`ARCHIVE_RUNS_ENABLED` stays `false`), `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (C-1), `components/ui/*`, `lib/services/AuditTrailService.ts`, `supabase/**`.

**Logging compliance:** `console.` count in every file above that already exists: **0**. New files use `createLogger`; the page and dialog do not log.

---

## 5. Task List

- [x] ✅ **T-b0** Branch `feature/admin-archiving-s2b` cut from `origin/main` `12ffede3` (created in this worktree on TL's instruction; RM to confirm it is the branch of record).
- [x] ✅ **T-b1** Audit catalogue: 3 events + metadata, `archive_run`, audience tags, `eventAudience` pin move. `lib/audit/__tests__` and `app/admin/audit-trail/__tests__` green.
- [x] ✅ **T-b2** `archiveRunRequestSchema` + tests.
- [x] ✅ **T-b3** Repository run methods + tests.
- [x] ✅ **T-b4** Runner + tests.
- [x] ✅ **T-b5** POST route + tests. Admin-authz guard green with **no** edit (C-1).
- [x] ✅ **T-b6** `adminGate.writes.test.ts` case, 58 → 59.
- [x] ✅ **T-b7** Dialog, Continue, badge + page tests; source guard updated.
- [x] ✅ **T-b8** Docs (§10); flag the CLAUDE.md line to the user.
- [x] ✅ **T-b9** Checks: `npm test -- lib/archiving lib/validation/__tests__/archiving lib/repositories app/api/admin app/admin lib/admin lib/audit`; `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`, judged by **0 errors in touched files**; ESLint on touched files 0 errors; `npm run lint:hooks`; `npx next build` with the CI placeholder env. The four mutation checks in §6.6, each reverted and hash-checked.
- [x] ✅ **T-b10** Self-review against §9 and the skills' checklists; `console.` in touched files 0; status → Code Complete; notify TL.

---

## 6. Test Plan

Jest only. No test touches a database. Numbering continues the parent plan where a case survives.

### 6.1 Validation (`lib/validation/__tests__/archiving.test.ts`)

| # | Case |
|---|---|
| V-1 | Valid start (each of 365/180/90) and valid continue parse |
| V-2 | Rejected: `retentionDays` 30, `"365"`, missing; unknown `source`; `action` missing or unknown; `runId` not a uuid; `start` carrying `runId`; each of `cutoff`, `startedBy`, `status`, `batchSize` added to an otherwise valid body |

### 6.2 Repository (`ArchiveRepository.test.ts`, existing fake builder)

| # | Method | Case |
|---|---|---|
| R-4 | `takeOverStaleRuns` | Two updates, both on `status = 'running'`, at `now − 300,000 ms`: one on `last_batch_at`, one on `last_batch_at IS NULL` + `started_at`; sets `partial` / `interrupted` / `finished_at`; returns the ids; error path |
| R-5 | `createRun` | Insert payload is **exactly** `{ source, retention_days, cutoff, status: 'running', started_by }` and every key is a column of `archive_runs` as written in M1 (parsed from the migration file: the `.insert()` blind spot of `schema:check`); `23505` → `conflict`; other error → error |
| R-7 | `claimRunForContinue` | `.eq('id')`, `.in('status', ['partial', 'failed'])`, sets `running` + `last_batch_at = now`, clears `finished_at` / `error_code`; 0 rows → `not_continuable`; `23505` → `conflict` |
| R-8 | `runBatchAllAccounts` | `rpc('archive_audit_trail_batch', { p_run_id, p_cutoff, p_batch_size })` with the cutoff string unchanged; a reply that is not one row of three non-negative integers → error; supabase error → error |
| R-9 | `finishRun` | `.eq('status', 'running')`; 0 rows → error |
| R-10 | all | Read methods still issue no write call; no select names `payload` or `*`; method pin **11** |

### 6.3 Runner (`runArchive.test.ts`, fake repo and clock)

| # | Case |
|---|---|
| X-1 | Batches until `selected = 0`, then `finishRun('succeeded')` |
| X-2 | Clock passes 45 s before the next batch → `finishRun('partial')`; no batch starts after the budget |
| X-3 | A batch error → `finishRun('failed', 'batch_failed')`; no further batch |
| X-4 | Every batch gets the run's stored cutoff string and the registry `batchSize` |
| X-6 | `finishRun` failing is logged and returned as `run: null`, not thrown |

### 6.4 `POST /api/admin/archiving/runs` (mocks as in the GET route test)

`ARCHIVE_RUNS_ENABLED` is mocked through a getter over a test variable (`jest.mock('@/lib/archiving/config', () => ({ ...actual, get ARCHIVE_RUNS_ENABLED() { return mockRunsEnabled; } }))`), default `false`. `config.test.ts` still pins the real constant to `false`.

| # | Case | Expect |
|---|---|---|
| P-1 | Signed out | 401, repository not called |
| P-2 | Non-admin | 403, repository not called |
| P-4 | Invalid bodies (a representative set from V-2, including each injected field) and malformed JSON | 400 `invalid_body`, repository not called |
| P-5 | Valid body, runs off | 409 `runs_not_enabled`, **no repository call at all**; an invalid body with runs off is still 400 |
| *(runs on from here)* | | |
| P-6 | Start, batches drain | 200 `succeeded`; `createRun` got `cutoffFor(days, now)` and `startedBy` = admin id; `STARTED` then `COMPLETED`, `userId` = `actorId` = admin, `entityType: 'archive_run'`; flush awaited before the response |
| P-7 | Start, budget runs out | 200 `partial`; `STARTED` only |
| P-8 | 409 table: start → `conflict`; continue → `not_continuable`; continue → `conflict` | 409 `run_in_progress` / `run_not_continuable` / `run_in_progress`; no batch; no audit |
| P-11 | Continue from `partial` and from `failed` (each) | 200; batches use the **stored** cutoff; no `STARTED` |
| P-12 | A batch fails | 500 `archive_batch_failed` with `runId`; `FAILED` audited |
| P-13 | Repository throws / `finishRun` fails | 500 `Internal server error`; `details` only in development; no terminal audit for the unfinished run |
| P-14 | Takeover runs before `createRun` and before `claimRunForContinue`, and never on a 400/409 `runs_not_enabled` path | call order |
| P-15 | Source rules: first statement of `POST` is `await requireAdmin(`; `maxDuration = 60`; `POST` is the only exported verb; no `AdminAccessService`, `profiles`, `app_metadata`, `supabase`, `console.` in the file. **R-1:** `.runBatchAllAccounts(` is called only in `lib/archiving/server/runArchive.ts` and `runArchive(` only in this route, after the `ARCHIVE_RUNS_ENABLED` check (as are the takeover, create and claim). ~~No logged argument contains `@`~~ (dropped by SA R-2) | |

### 6.5 Page and dialog (jsdom) and source guard

| # | Case |
|---|---|
| G-3 | Archive opens the dialog; it shows source, retention, cutoff and the eligible count for the selected option; Escape closes it |
| G-4 | **AC-8:** at 180 and 90 the K-1 sentence shows that number; at 365 it does not |
| G-5 | `runsEnabled: false`: Confirm and Continue are disabled with "Not switched on yet"; `fetch` is only ever called with the overview URL |
| G-6 | `runsEnabled: true`: Confirm posts exactly `{ action: 'start', source: 'audit_trail', retentionDays }`, then refetches |
| G-7 | Continue shows for `partial`, `failed`, stale `running`; not for `succeeded` or live `running`; posts `{ action: 'continue', runId }` |
| G-8 | Each error code maps to its sentence; raw text never shown |

Pins replaced deliberately: "Archive is disabled and described by 'Not switched on yet'" (the note moves to Confirm) and "still offers no way to start or continue a run in Slice 2a".

**Source guard** (three rule changes, all deliberate): imports under `@/lib/archiving/` limited to `config` and `types` (negative control: `@/lib/archiving/server/runArchive` is refused); the only write is `method: 'POST'` in a `fetch` to `/api/admin/archiving/runs`; `fetch` URLs are exactly the overview and the runs route. Everything else unchanged.

### 6.6 Mutation checks (Dev only, 4, SA R-3)

| # | Mutation | Must fail |
|---|---|---|
| MU-3 | `requireAdmin` moved below `request.json()` | P-15 |
| MU-4 | The `ARCHIVE_RUNS_ENABLED` check removed | P-5 |
| MU-5 | `.strict()` removed from the start schema | V-2 / P-4 injected-field case |
| MU-6 | Continue uses `cutoffFor(...)` instead of the claimed row's cutoff | P-11 |

### 6.7 Gate oracle and existing suites

- `adminGate.writes.test.ts`: `{ name: 'POST /api/admin/archiving/runs', call: () => archivingRuns.POST(req('/api/admin/archiving/runs', 'POST', { action: 'start', source: 'audit_trail', retentionDays: 365 })) }`; pin 58 → 59 with the comment extended (`+ 1 archiving/runs#POST, gated from birth`).
- Must stay green, unedited: `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/admin/audit-trail/__tests__/*`, `lib/audit/__tests__/filterOptions.test.ts`, `app/api/admin/archiving/__tests__/route.test.ts`, `lib/archiving/__tests__/config.test.ts`.

---

## 7. Manual QA (PROD, runs off)

After 2b deploys. **Nothing here starts a run.**

| # | Step | Expected |
|---|---|---|
| M-b1 | `/admin/archiving`, press Archive at 365, 180 and 90 (keyboard only) | Dialog opens; retention, cutoff and row count match the card; K-1 sentence only at 180 and 90; Escape closes |
| M-b2 | Confirm in the dialog | Disabled, "Not switched on yet" |
| M-b3 | DevTools: `fetch('/api/admin/archiving/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', source: 'audit_trail', retentionDays: 365 }) }).then(r => r.json().then(b => [r.status, b]))` | `409`, `runs_not_enabled` |
| M-b4 | `SELECT count(*) FROM public.archive_runs;` | `0` |
| ~~M-b5~~ | *Dropped by SA R-2: `filterOptions.test.ts` already proves the events are selectable* | — |

401/403/400 are covered by Jest (P-1, P-2, P-4, the gate oracle); QA does not repeat them by hand.

---

## 8. How the Live Flow Is Proven in Slice 3

Real runs cannot happen on PROD in 2b. The move function itself is already proven on PROD data by 2a's dry run (AC-5, and AC-4/AC-6 in rolled-back form). What remains unproven live is the TypeScript path end to end. Slice 3 flips `ARCHIVE_RUNS_ENABLED` to `true`, and its workplan owns a short live runbook, run by the user after that deploy:

| Step | Proves |
|---|---|
| 1. Record `count(*)` of `audit_trail` and `archived_records`, and the 365-day eligible count on the page | Baseline |
| 2. Start a 365-day run from the dialog | Route, runner, RPC through PostgREST as `service_role` |
| 3. Run row is `succeeded`; `rows_archived` = eligible = archived count; live + archived = baseline; 0 rows left before the stored cutoff | AC-4 live |
| 4. `/admin/audit-trail` shows `ARCHIVE_RUN_STARTED` and `ARCHIVE_RUN_COMPLETED` for the run | AC-9 live |
| 5. Start again at 365 | A new run moves 0 rows, no duplicates (AC-6 live) |

**Partial and Continue live** happen only if a run exceeds 45 s (roughly 20,000+ eligible rows at 1–2 s per 1,000). If PROD has fewer, Continue stays proven by the runner and route tests (X-2, P-7, P-11) and by 2a's dry run of the function, and Slice 3 says so in its QA report instead of forcing a partial. The one-running-run 409 (AC-7) stays proven by the index (M-8, QA X10) and P-8; it is not reproduced by hand.

---

## 9. Tenant Isolation Review

Applied with the `tenant-isolation-guard` skill: service role, and `runId` comes from the body.

| Skill step | Finding |
|---|---|
| 1. Applies? | Yes. But `archive_runs` has no `user_id` and holds no tenant data, and the caller must be a platform admin. The batch is **cross-account by design**; what bounds it is the run's stored cutoff |
| 2. Ownership pre-check | No owner exists to check against. The equivalent: the caller's `runId` is used only through `claimRunForContinue` (`WHERE id = $1 AND status IN ('partial','failed')`), which returns the stored row or nothing (409). No batch runs for an unclaimed id, and the function re-checks run, source, `running` and the exact cutoff in the same transaction as the move |
| 3. Field allow-list | `.strict()` schemas; `createRun` builds its insert field by field (`source` from the enum, `retention_days` from the enum, `cutoff` server-computed, `status: 'running'`, `started_by = gate.user.id`). Nothing from the body is spread. V-2 and P-4 inject `cutoff`, `startedBy`, `status`, `batchSize` |
| 4. Scope-defeating three | **Trigger:** none on `archive_runs` / `archived_records`; `audit_trail`'s only trigger is `BEFORE INSERT` (2a pre-check P02), and the move never inserts there. **Upsert:** none in TypeScript; the function's `ON CONFLICT DO NOTHING` uses fixed columns and values from the row. **Payload injection:** closed by `.strict()` and the field-by-field insert |
| 5. Global catalogue | n/a |
| 6. Runner | Deliberately unscoped by account (FR: cross-account maintenance); bounded by the stored cutoff, enforced inside the function |
| 7. Tests | V-2 / P-4 (injection), P-8 (unclaimable id → 409, no batch), P-11 + MU-6 (stored cutoff) |

---

## 10. Documentation

| Doc | Change |
|---|---|
| [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) § ArchiveRepository | Add the 5 run methods to the table; replace "Still read-only after slice 2a. Planned (slice 2b): …" with: writes `archive_runs` and moves `audit_trail` rows only through `archive_audit_trail_batch`, only from `requireAdmin` routes; the function name stays server-side. Keep the Slice 3 line |
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) | **82 → 83 handlers, 53 → 54 route files, 76 → 77 `requireAdmin`, 6 inline, 0 open** at lines 43–44, 56–59 (add a "82 → 83" note), 69, 85, 88 (heading), 95, 218 and 483 (as of `12ffede3`); register row **83** `archiving/runs` `POST`, ✅ gated, `requireAdmin` first statement (pinned by its route test), new in Admin Archiving slice 2b; Change History row; Last Updated. **Re-measure on the branch before editing**, since `main` may move |
| `CLAUDE.md` § Key Documentation, admin row | **Flagged to the user at diff review, not edited.** On `main` it reads "82 admin handlers (53 route files) … 76 via `requireAdmin` … 6 handlers still hand-roll" (current as of 2026-09-26). After 2b: **83 / 54 / 77**, 6 inline, plus a Change History row |

---

## 11. Open Questions for SA

Two, both small. Everything else is decided above.

| # | Question | Dev's proposal |
|---|---|---|
| **Q-b1** | Which audience in `eventAudience.ts` for the three `ARCHIVE_RUN_*` events? | **`shared`.** Archiving is platform maintenance, neither a Business OS feature nor the parked agent platform, and `shared` keeps the events in the operator filter list, which AC-9 needs. `bos` would also show them; `agentspilot` would hide them |
| **Q-b2** | The `new-api-route` skill says never to await the audit `log()`, but the WC-7 precedent awaits `log().catch()` and then `flush()`. Follow the precedent? | **Yes.** `log()` enqueues only after an awaited hash, so without awaiting it the flush can run on an empty queue and the entry is lost when the instance freezes. `log()` never throws, so awaiting it cannot fail the request. The skill line is about not blocking on audit errors, which `.catch()` still ensures |

---

## SA Review Notes

**Reviewed by SA — 2026-09-26**
**Status:** ✅ **APPROVED WITH CHANGES.** The changes are small; SA checks them at code review, so no re-review is needed.

The plan follows the parent workplan's §2 design and the SA answers to Q-1 to Q-14. It is consistent with 2a as merged, needs no migration (checked against M1's grants, CHECK and index), leaves the admin-authz guard file untouched (C-1), and keeps `ARCHIVE_RUNS_ENABLED = false`.

### Focus areas

| Area | Finding |
|---|---|
| **POST order** | ✅ `requireAdmin` → body → Zod (400) → runs-off 409 → takeover → create/claim. The 409 comes **before** the takeover, so with runs off the route reads and writes nothing (P-5 asserts "no repository call at all"; P-14 asserts the takeover never runs on a 400/409 path) |
| **No real run while the flag is false** | ✅ by design: the only caller of the RPC is `runArchive`, and the only caller of `runArchive` is the POST, after the flag check. **R-1** below pins that call graph so a future caller cannot bypass the flag. The GET does not write (unchanged). The flag is read inside the handler, and `config.test.ts` still pins the real value to `false` |
| **Tenant isolation on `runId`** | ✅ The caller's `runId` is used only through `claimRunForContinue` (`WHERE id = $1 AND status IN ('partial','failed')`). An unknown, succeeded or running id gets 409, with no batch. The move function re-checks run, source, `running` and the exact stored cutoff in the same transaction. `.strict()` plus the field-by-field insert closes injection. There is no owner to check against: `archive_runs` holds no tenant data, and the batch is cross-account by design, bounded by the stored cutoff |
| **Time budget** | ✅ The budget is checked before each batch: 45 s + one batch (at most 5 s lock timeout + about 2 s) + finish + audit flush, inside `maxDuration = 60` |
| **"A failed finish heals via takeover"** | ✅ Correct. The run stays `running` with a fresh `last_batch_at`. After 5 minutes the next POST flips it to `partial`, and Continue's first batch selects 0 rows and finishes it `succeeded`. The cost is that new Starts get 409 for up to 5 minutes, which is acceptable. Optional (O-1 below): give that 500 its own sentence |
| **Source-guard narrowing** | ✅ D-6 is correct and needed: once `lib/archiving/server/` exists, the old `@/lib/archiving/*` prefix rule would let the page import the runner. The negative control is good |

### Rulings on the eight deviations (§3)

| # | Ruling |
|---|---|
| **D-1** Slim POST result | ✅ Approved. The page refetches the overview anyway; moving `toRunSummary` would change the GET for nothing |
| **D-2** Two takeover updates | ✅ Approved. `last_batch_at IS NULL` and `last_batch_at < t` are disjoint, so no run matches both, and each update is atomic |
| **D-3** No new audit test file | ✅ Approved. `eventAudience.test.ts` (exhaustive tag + pin), `filterOptions.test.ts` (selectable) and the client allow-lists already cover it. Pin 157 → 160 / shared 58 → 61 is intended |
| **D-4** Drop runner X-5 | ✅ Approved. The runner never holds a payload or an email |
| **D-5** P-3 only in `adminGate.writes` | ✅ Approved. That oracle already runs "admin check throws → 403, touched nothing" |
| **D-6** Guard imports narrowed to `config` / `types` | ✅ Approved (see above) |
| **D-7** Dialog in `components/ArchiveConfirmDialog.tsx` | ✅ Approved. The guard walks the folder, so no rule is lost |
| **D-8** Badge "Runs off" | ✅ Approved. It states what is true |
| — Counts 82 → 83 / 53 → 54 / 76 → 77 | ✅ Matches `main` at `12ffede3` (see the CLAUDE.md fact below) |

### Answers

- **Q-b1: `shared`, approved.** Archiving is platform maintenance, not a Business OS feature. `shared` is in `OPERATOR_AUDIENCES`, so the events stay selectable (AC-9), and the file's own rule says hiding is the costlier mistake.
- **Q-b2: follow the WC-7 precedent (`await log().catch()` then `await flush().catch()`), approved.** SA checked `AuditTrailService` at `12ffede3`. `log()` wraps its body in `try/catch → handleError`, and `flush()` wraps the insert the same way. Neither can reject, so **awaiting cannot fail the admin's response**, and the `.catch()` is belt and braces. **Can it block?** It adds one `audit_trail` insert round-trip (typically tens to hundreds of ms) before the response. There is no retry loop, and the worst case (a hung insert) is bounded by `maxDuration = 60`, with about 10 s of headroom after the 45 s budget. That is the accepted cost of not losing the entry when the instance freezes. The skill's "never await" means "never let audit fail or gate the business result", and that still holds. One known edge, the same as the precedent: if a timer-driven flush is already in flight, `flush()` returns at once. This is accepted and not a finding for this slice.

### Required changes

1. **R-1 (Medium) Pin "no run without the flag".** In the existing P-15 source rules (no new file), assert that `runBatchAllAccounts(` appears only in `lib/archiving/server/runArchive.ts` (and its test), and that `runArchive(` appears only in `app/api/admin/archiving/runs/route.ts`, **after** the `ARCHIVE_RUNS_ENABLED` check. This is the property the user cares most about in this slice, and today it rests on nobody adding a second caller.
2. **R-2 (Low) Cut two redundant checks.** Drop "no logged argument contains `@`" from P-15, for the same reason as parent R-6: the route logs only ids and counts. Drop manual QA M-b5, because `filterOptions.test.ts` already proves the events are selectable. QA runs M-b1 to M-b4.

Mutation checks: the four in §6.6 stand. Do not add R-1 as a fifth; P-15 covers it.

### Optimisation suggestion (not blocking)

- **O-1** For a 500 on an **unfinished** run (a batch moved rows but `finishRun` failed), return a distinct code (e.g. `run_unfinished`) that the page maps to "The run stopped before it was recorded. You can continue it in about 5 minutes." "The run could not be started" would be untrue there.

### CLAUDE.md fact-check

`git show 12ffede3:CLAUDE.md`: the admin row on `main` reads **"82 admin handlers (53 route files) … 76 via `requireAdmin` … 6 handlers still hand-roll"**. Its Change History records the re-measure after Health slice 4 and Archiving slice 1 merged. The workplan's §10 states exactly this. **The "72 … 7" figure appears nowhere in this workplan and is not what `main` says.** After 2b, the row should read 83 / 54 / 77 / 6. **Editing CLAUDE.md remains the user's decision at diff review. It is not an implementation task.**

### Approval

- [x] Workplan approved, conditional on R-1 and R-2
- [x] 2b code review (below)

---

**Code Review by SA — 2026-09-26**
**Status:** ✅ **Code Approved for QA.** No High or Medium findings. The Low items below are not blocking. Dev may fold them in before RM commits or park them; none changes behaviour while runs are off.

Reviewed: `git diff` against `12ffede3` (17 tracked files) plus the 5 untracked paths, read-only. SA re-ran 11 suites (runs route, runner, config, `ArchiveRepository`, validation, `eventAudience`, admin-authz guard, `adminGate.writes`, page render, source guard, GET route): **665 tests, all green**. QA was mutating files in parallel, so this run confirms the state SA read, not QA's.

### Focus areas

| Area | Finding |
|---|---|
| **Route order** | ✅ `const gate = await requireAdmin(` is the first statement (P-15 pins it); body parse → `safeParse` of a `.strict()` discriminated union (400 `invalid_body`, issues only in development) → `if (!ARCHIVE_RUNS_ENABLED)` 409 before any repository call → `takeOverStaleRuns(now, STALE_RUN_AFTER_MS)` → `createRun` / `claimRunForContinue` → `runArchive` → terminal audit → flush. The flag is read inside the handler |
| **Three 500 codes** | ✅ `archive_batch_failed` + `runId` (failed; `FAILED` audited), `run_unfinished` + `runId` (O-1: `finishRun` failed; no terminal audit; flush still awaited), `Internal server error` (thrown; `details` only in development). Nothing is logged beyond ids, counts and codes |
| **Audit** | ✅ `userId` = `actorId` = `gate.user.id`, `entityType: 'archive_run'`, `entityId` = run id, details are counts/dates/`correlationId`. `STARTED` only after a created run (never on Continue), `COMPLETED` / `FAILED` only on those outcomes, nothing on `partial` or unfinished. `await log().catch()` then `await flush().catch()` on the success, unfinished **and** catch paths. Severity comes from `EVENT_METADATA` via `buildLogEntry` (warning / warning / critical) |
| **Repository writes** | ✅ All five build their payloads field by field; nothing from the body is spread. `23505` → `conflict` on `createRun` and on `claimRunForContinue`. The claim is `.eq('id').in('status', ['partial','failed'])` and returns the stored row, whose `cutoff` string is the only cutoff the runner passes on. The takeover threshold is an argument (I-2). `finishRun` is `.eq('status','running')`, zero rows is an error. The RPC reply is validated as exactly one row of three non-negative integers. `BATCH_FUNCTIONS` is a full `Record<ArchiveSourceKey, string>` in the server-only file |
| **Tenant isolation (`tenant-isolation-guard`)** | ✅ Service role, caller-supplied `runId`: uuid-validated, used only in the claim's `WHERE id = $1 AND status IN (...)`, 0 rows → 409 with no batch. No owner exists (`archive_runs` has no `user_id`); the batch is cross-account by design and bounded by the stored cutoff that `archive_audit_trail_batch` re-checks in the same transaction. Scope-defeating three: no trigger on `archive_runs`, no upsert in TypeScript, payload injection closed by `.strict()` (V-2/P-4 inject `cutoff`, `startedBy`, `status`, `batchSize`). EXECUTE on the function is REVOKE ALL from PUBLIC/anon/authenticated/service_role then GRANT to service_role only (M1 line 459) |
| **Runner** | ✅ Budget checked before each batch (`clock() - startedAt < budgetMs`), batch size from the registry (1,000), unknown source → `failed` without calling any function, one `finishRun`, and a failed finish is logged and returned as `run: null`, never thrown. One log line per batch with counts and timings only |
| **R-1 pins** | ✅ `callers('runBatchAllAccounts')` = the runner only and `callers('runArchive')` = the route only, over every non-test `.ts/.tsx` under `app lib components hooks scripts`, comments stripped, declarations excluded by the look-behind. The second case asserts the flag check precedes `takeOverStaleRuns(`, `createRun(`, `claimRunForContinue(` and `runArchive(`. MU-4 (flag removed) is caught behaviourally by P-5 |
| **A real run while `ARCHIVE_RUNS_ENABLED = false`?** | ✅ **No path found.** The only writers of `archive_runs` and the only RPC caller are reached solely through the route after the flag (grepped: no other caller of `createRun`, `claimRunForContinue`, `takeOverStaleRuns`, `finishRun`, `runBatchAllAccounts`, `runArchive`; `archive_audit_trail_batch` appears in code only in the repository). The GET is unchanged. The function refuses any run that is not `running` with the exact cutoff, and no run row can be created while the flag is off. The page's `sendRun` returns before `fetch` when runs are off. `config.test.ts` still pins the real constant to `false` |
| **Page and dialog** | ✅ Confirm `disabled={!runsEnabled \|\| busy \|\| !option}`, Continue `disabled={!runsEnabled \|\| busy}`, both described by "Not switched on yet". K-1 sentence only when retention < 365, i.e. 180 and 90, naming the number (G-4). Radix `Dialog` (C-15), keyboard and Escape. `!` overrides confined to `DARK_DIALOG` and two header classes in `ArchiveConfirmDialog.tsx`; `components/ui/*` untouched. Client imports: React, `lucide-react`, `@/components/ui/*`, `@/lib/archiving/config`, `@/lib/archiving/types`, `./format`, `./components/*` only; the narrowed source guard (D-6) refuses `@/lib/archiving/server/*` with a negative control. Exactly one POST in the folder, to the runs route. Raw error text is never shown |
| **Counts** | ✅ `eventAudience` 160 = 15 / 61 / 84; `adminGate.writes` `CASES` 59; census re-measured by SA on the branch: **54 route files, 83 handlers, 6 without `requireAdmin`** → 77 gated, matching `ADMIN_IDENTIFICATION_AND_ACCESS.md` (register row 83, Change History, Last Updated). CLAUDE.md admin row still reads 82 / 53 / 76: the user's call at diff review, as agreed |
| **Standards** | ✅ `console.` 0 in every touched file; Pino `createLogger` + `{ err }`; no `any`; no new pattern beyond those approved in the workplan review |

### Code Review Comments

1. `app/api/admin/archiving/runs/route.ts:164-165` — An unknown `run.source` throws **after** the run was created or claimed, so the row stays `running`, the admin gets a generic 500 (not `run_unfinished`), the source is blocked for 5 minutes, and a later Continue repeats the same throw. `archive_runs.source` has no CHECK, so only a hand-written row can reach this, and the runner already fails closed on an unknown source (finishing the run `failed`). Suggest letting the runner own that case (move the `batchSize` lookup into the runner, or call `finishRun(failed)` before throwing) so the run is recorded as `failed` instead of being left open. — Priority: Low
2. `app/admin/archiving/components/ArchiveConfirmDialog.tsx:60` — `shortensOwnerHistory = retentionDays < DEFAULT_RETENTION_DAYS` couples K-1 to the **preselected** value. K-1 is about any retention shorter than the longest option; if the default ever changes to 180, the sentence would silently disappear at 180. Compare with `Math.max(...RETENTION_DAYS_OPTIONS)` instead. G-4 pins today's behaviour either way. — Priority: Low
3. `app/admin/archiving/page.tsx` (`RUN_FAILED`) — "The run could not be started." is also shown for a failed **Continue** and for `invalid_body`. Consider "The run could not be started or continued." — Priority: Low
4. `app/api/admin/__tests__/adminGate.writes.test.ts:~330` — the pre-existing comment still says "the 7 correct-but-inline copies"; the census is 6. Not introduced by 2b; fix only if the line is touched anyway. — Priority: Low

### Optimisation Suggestions

- **R-1 extension (optional).** P-15 pins the **method** call graph, but a future server file could call `.rpc('archive_audit_trail_batch', …)` directly and skip both the runner and the flag. One more assertion in the same P-15 block, "the string `archive_audit_trail_batch` appears in non-comment code only in `ArchiveRepository.ts`", would close that too. Not a mutation check; no new file.

### Rulings on Dev's implementation notes

| # | Ruling |
|---|---|
| **I-1** `format.ts` | ✅ Approved. Pure, import-free, and the guard already allowed `./format`; the page and dialog share one UTC formatter |
| **I-2** threshold as an argument | ✅ Approved. Keeps policy out of the repository and makes R-4 explicit about the 300,000 ms |
| **I-3** `ArchiveRunErrorCode` | ✅ Approved. `RUN_MESSAGES: Record<Exclude<…, 'invalid_body'>, string>` makes a new code without a sentence a compile error, which is the point |
| **I-4** flush on the catch path | ✅ Approved. A queued `STARTED` must survive a later throw; `flush()` cannot reject |
| **I-5** one P-11 | ✅ Approved. The continuable statuses are the claim's filter (R-7); the route sees only the claimed row. MU-6 still bites P-11 |
| **I-6** `Object.defineProperty` flag mock | ✅ Approved, and a good catch: the spread form would have left runs off and made every "runs on" test vacuous. `config.test.ts` still pins the real value |

### Code Approved for QA: **Yes**

- Not to be committed: `.claude/settings.local.json`.
- QA: M-b1 to M-b4 after deploy (§7); Jest coverage per §6.

---

## Implementation Notes

**Dev, 2026-09-26.** Slice 2b code complete on `feature/admin-archiving-s2b` (base `12ffede3`). Not committed. No migration. `ARCHIVE_RUNS_ENABLED` is still `false`; CLAUDE.md not edited.

### SA changes applied

| Item | Where |
|---|---|
| **R-1** no run without the flag | Route test P-15, two new cases: a walk of `app lib components hooks scripts` (non-test files) finds `.runBatchAllAccounts(` called only in `lib/archiving/server/runArchive.ts` and `runArchive(` called only in the runs route; and in the route, `if (!ARCHIVE_RUNS_ENABLED)` comes before `takeOverStaleRuns(`, `createRun(`, `claimRunForContinue(` and `runArchive(` |
| **R-2** | P-15 has no "`@` in logs" check; manual QA M-b5 struck through (§7) |
| **O-1** | New code `run_unfinished` (500 + `runId`) when `finishRun` fails after batches ran; the page says "The run stopped before it was recorded. You can continue it in about 5 minutes." Route test P-13 (O-1), page test G-8 |
| **Q-b1 / Q-b2** | Events tagged `shared`; `await log().catch()` then `await flush().catch()` |

### Verification

| Check | Result |
|---|---|
| Affected suites: `app/admin/archiving app/api/admin lib/archiving ArchiveRepository.test lib/validation/__tests__/archiving lib/audit lib/admin app/admin/audit-trail` | **45 suites, 1,269 tests, all passing** (includes `adminGate.writes` 59 cases, the admin-authz guard unchanged, `eventAudience` 160 / 15 / 61 / 84, `filterOptions`) |
| New or changed in 2b | POST route 30 (new); runner 5 (new); repository 34 (+15); validation +16; page render 26 (G-3 to G-8 replace P-4 and the 2a "no way to start" pin); source guard (import rule narrowed, one POST allowed, two fetch targets) |
| Mutation checks (§6.6), each restored and SHA-256 verified | **MU-3** gate below `request.json()` → P-15 first-statement red (13 red); **MU-4** runs-off check disabled → P-5 ×2 + R-1 order red; **MU-5** `.strict()` off the start schema → V-2 ×5 + P-4 ×4 red; **MU-6** Continue with a fresh cutoff → P-11 red. All 4 caught |
| `tsc --noEmit` (8 GB, `--typeRoots` at the parent `node_modules/@types`: the worktree has none) | Exit 2 with 2,069 errors, the same pre-existing count as 2a; **0 in touched files** |
| ESLint on the 20 touched TS/TSX files | **0 errors**; 6 warnings, all pre-existing lines (`any` in `lib/audit/types.ts`, an unused `_` in `events.ts`) |
| `npm run lint:hooks` | Pass |
| `next build` (CI placeholder env from `build.yml`) | **Pass** (exit 0); `/admin/archiving` 9.49 kB, `/api/admin/archiving/runs` listed |
| Admin census | 54 route files, 83 handlers, 6 without `requireAdmin` |
| `console.` in touched files | 0 |
| `git diff --stat` | 17 tracked files changed (974 insertions, 108 deletions), all proportionate; plus 5 new paths. No deletion-only file |

### Deviations from the plan (small)

| # | What | Why |
|---|---|---|
| I-1 | `formatUtc` / `formatCount` moved from `page.tsx` to `app/admin/archiving/format.ts` | The dialog needs them; the guard already allowed `./format` |
| I-2 | `takeOverStaleRuns(now, staleAfterMs)` takes the threshold as an argument | Keeps the repository free of policy; the route passes `STALE_RUN_AFTER_MS` |
| I-3 | `ArchiveRunErrorCode` type in `types.ts` | One list of codes shared by route and page, so a new code without a sentence is a compile error |
| I-4 | The catch path also awaits `flush()` | A queued `STARTED` must not be lost when an error follows it |
| I-5 | P-11 is one test, not one per status | Which statuses may be continued is the claim's filter, pinned by R-7; the route only sees the claimed row |
| I-6 | Route test mocks the flag with `Object.defineProperty` | The ES2017 target lowers `{ ...actual, get X() {} }` to `Object.assign`, which reads the getter once; found when the first attempt kept runs off |

### For SA and QA

- `app/api/admin/archiving/runs/route.ts`: order (gate → Zod → flag → takeover → create/claim → runner), the three 500 codes, audit only on start/succeeded/failed.
- `lib/repositories/ArchiveRepository.ts`: the five writes are field by field; `23505` → `conflict`; the RPC reply is validated as one row of three non-negative integers.
- `lib/archiving/server/runArchive.ts`: budget checked before each batch; unknown source → `failed`, never a guessed function.
- The page: Confirm and Continue disabled with "Not switched on yet" while runs are off, and `sendRun` returns early too, so no request can leave.
- QA manual checks after deploy: M-b1 to M-b4 (§7).
- `.claude/settings.local.json` was modified before this work and must not be committed.

### Post-review fixes (Dev, 2026-09-26)

SA's low findings after the code review, and QA's missing G-8 row. No behaviour change on PROD: runs are still off.

| Item | Fix | Test |
|---|---|---|
| **L-1** unknown `run.source` | The runner now owns the registry lookup (the `batchSize` dependency is gone). An unknown source runs no batch and is finished `failed` / `batch_failed`, so the route answers 500 `archive_batch_failed` with a `FAILED` audit instead of throwing after create/claim and leaving the run `running` for 5 minutes. The route's own lookup and throw are removed | Runner X-7 |
| **L-2** K-1 comparison | `ArchiveConfirmDialog` compares against the longest option (`Math.max(...RETENTION_DAYS_OPTIONS)`), not `DEFAULT_RETENTION_DAYS` | G-4 (180, 90, 365) green |
| **L-3** fallback wording | The unrecognised-failure sentence depends on the action: "The run could not be continued." for Continue, "…started." for Confirm. QA's missing `runs_not_enabled` row added to G-8 | G-8 (6 rows) + one Confirm fallback case |
| **L-4** stale comment | `adminGate.writes.test.ts`: "the 7 correct-but-inline copies" → 6 (7 until `audit-trail#GET` moved on 2026-09-25) | — |
| **Optional** | P-15: `archive_audit_trail_batch` is named only in `lib/repositories/ArchiveRepository.ts` across `app lib components hooks scripts` | New P-15 case |

Re-verified: affected suites **45 suites, 1,273 tests** (was 1,269, +4) all passing; ESLint on the 8 touched files 0 findings; `next build` (CI placeholder env) exit 0.

---

## QA Testing Report

**QA — 2026-09-26**
**Test mode:** full
**Strategy used:** A + B (Jest suites, re-run unedited) + mutation testing + C (a script that drives the real TypeScript repository, runner and POST route against PGlite with M1 applied, as `service_role`)
**Focus:** api, security, ui (via jsdom tests), pipeline of the run lifecycle
**Skipped:** Playwright (not installed, per CLAUDE.md). Live PROD checks M-b1 to M-b4 are owed to the user after deploy (below)
**Input source:** TL prompt + this workplan's §6, §7

### Test Coverage

| Acceptance criterion / item | Tested? | Result | Notes |
|---|---|---|---|
| Runs refused while `ARCHIVE_RUNS_ENABLED = false` (C-5): 409 `runs_not_enabled`, nothing read or written | ✅ | Pass | P-5 (Jest) and E2E S0 against real M1: `archive_runs` stays 0, nothing moved, no audit. `config.ts` still `false` on disk |
| Gate first, Zod `.strict()` before the flag | ✅ | Pass | P-1/P-2/P-4/P-15, `adminGate.writes` (59); E2E S0: an injected `cutoff` is 400 even with runs off |
| Start drains to `succeeded`; live + archived = baseline; nothing left before the stored cutoff (AC-4 shape) | ✅ | Pass | E2E S1: 28 eligible → 28 archived, 3 batches of ≤10, `user_email` from the trigger kept in `payload` (8/8), `user_id` column matches |
| A second start moves 0, no duplicates (AC-6 shape) | ✅ | Pass | E2E S1 |
| Budget runs out → `partial`, only STARTED audited (C-9f); Continue on the **stored** cutoff | ✅ | Pass | E2E S2: 1 ms budget → partial after 4 rows; a row inserted 1 ms after the stored cutoff is left in place by Continue; cutoff unchanged; no second STARTED |
| One running run per source (AC-7): start and Continue get 409 `run_in_progress`, nothing written | ✅ | Pass | E2E S3, including two genuinely interleaved POSTs (one 200, one 409) |
| Stale takeover (TQ-1) | ✅ | Pass | E2E S4: never-batched run started 6 min ago and a run with last batch 6 min ago both → `partial`/`interrupted`; last batch 4 min ago is alive (409); an interrupted run continues to `succeeded` and `error_code` clears |
| Continue refused on `succeeded` / unknown id | ✅ | Pass | E2E S5: 409 `run_not_continuable`, row byte-identical, no audit |
| Batch failure → `failed` / `batch_failed`, 500 `archive_batch_failed` + `runId`, FAILED audited, nothing lost; Continue on `failed` | ✅ | Pass | E2E S5 (DB refuses batch size 5001): 0 rows moved; Continue → `succeeded`, COMPLETED only |
| Audit shape (C-16): admin is `userId` and `actorId`, `entityType: 'archive_run'`, counts only, no email | ✅ | Pass | E2E S1 + P-6. Logs of the whole E2E contain no `@` |
| `run_unfinished` (O-1) | ⚠️ | Pass (Jest only) | P-13 and G-8. Not reproduced on PGlite (would need `finishRun` to fail after a batch) |
| Page: runs off → Confirm and Continue disabled, "Not switched on yet", no POST | ✅ | Pass | G-5 |
| Page: K-1 sentence at 180 and 90, not at 365 (AC-8) | ✅ | Pass | G-4 ×3 |
| Page: Continue for `partial`, `failed`, stale `running`; not for `succeeded` or live `running` | ✅ | Pass | G-7 |
| Page: each code to a sentence, including `run_unfinished`; raw text never shown | ✅ | Pass | G-8 ×5 |
| Only the runner calls the batch, only the route calls the runner, after the flag (SA R-1) | ✅ | Pass | P-15 R-1; mutation MQ4 below |

### Suite counts (re-run, unedited)

`npx jest app/admin/archiving app/api/admin lib/archiving lib/repositories/__tests__/ArchiveRepository.test lib/validation/__tests__/archiving lib/audit lib/admin app/admin/audit-trail` → **45 suites, 1,269 tests, all pass** (matches Dev).

| Suite | Tests |
|---|---|
| `app/api/admin/archiving/runs/__tests__/route.test.ts` (new) | 30 |
| `lib/archiving/server/__tests__/runArchive.test.ts` (new) | 5 |
| `lib/repositories/__tests__/ArchiveRepository.test.ts` | 37 |
| `lib/validation/__tests__/archiving.test.ts` | 41 |
| `app/admin/archiving/__tests__/page.render.test.tsx` | 26 |
| `app/admin/archiving/__tests__/source.guard.test.ts` | 22 |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | 298 (59 cases) |
| `lib/audit/__tests__/eventAudience.test.ts` | 21 |
| `app/api/admin/archiving/__tests__/route.test.ts` (GET, unchanged) | 38 |
| `lib/archiving/__tests__/config.test.ts` (unchanged) | 28 |

### Mutation checks (QA, different from Dev's MU-3 to MU-6)

Each applied by script, the targeted suite run, the file restored from a backup and its SHA-256 compared: all four match the pre-mutation hash.

| # | Mutation | Caught by | Result |
|---|---|---|---|
| MQ1 | `claimRunForContinue` also accepts `succeeded` (`.in('status', [..., 'succeeded'])`) | R-7 (repository) | ✅ 1 red |
| MQ2 | Runner ignores its budget (`while (... \|\| true)`) | X-2 (runner) | ✅ 1 red |
| MQ3 | Route audits COMPLETED on `partial` too (`outcome !== 'failed'`) | P-7 | ✅ 1 red |
| MQ4 | `runArchive(` called before `if (!ARCHIVE_RUNS_ENABLED)` | P-15 R-1 order | ✅ 1 red |

### End-to-end on PGlite (how it was driven)

The real `ArchiveRepository`, `runArchive` and `POST` were bundled with esbuild from the worktree. Stubbed: `supabaseServer` (a small PostgREST-shaped adapter over PGlite: `from/update/insert/eq/lt/is/in/select/single`, `rpc`; rows returned via `to_jsonb`, so timestamps come back in PostgREST's ISO form), the logger, `requireAdmin` (fixed admin id), `AuditTrailService` (records flushed entries) and `NextResponse`. Three in-memory rewrites of the route **inside the bundle only**: the flag reads `globalThis.__RUNS_ON ?? ARCHIVE_RUNS_ENABLED`, and budget and batch size can be overridden. No source file was changed. M1 was applied from `supabase/migrations/20261010_admin_archiving_runs.sql`; `audit_trail` has the `user_email` trigger; every query ran after `SET ROLE service_role`, so M1's grants were exercised. **34 checks, all pass** (S0 runs off; S1 complete; S2 partial + Continue; S3 conflicts; S4 stale takeover; S5 Continue refused, failed + Continue; final invariants: live + archived = every row ever inserted, no duplicate archive row, no run left `running`, `sum(rows_archived)` = archived count). Harness: scratchpad `pgcheck/qa2b-e2e.mjs`, bundle config `qa2b/build.mjs`.

Limits: PGlite is one connection, so "concurrent" means interleaved at `await` points (the two-start race did interleave and hit the index). PostgREST itself was not in the loop; the adapter mirrors only the calls the repository makes.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **G-8 has no row for `runs_not_enabled`** — `app/admin/archiving/__tests__/page.render.test.tsx` — Low. The sentence exists in `RUN_MESSAGES`, but the page never sends while runs are off, so it is reachable only if the overview says on and the POST says off (a deploy skew). One more `it.each` row would pin it.
2. **Workplan count nit** — Implementation Notes say the repository suite is 34 tests; QA measured 37. Documentation only.

### Test Outputs / Logs

```text
Test Suites: 45 passed, 45 total
Tests:       1269 passed, 1269 total
MQ1 Tests: 1 failed, 36 passed, 37 total   restored, sha match
MQ2 Tests: 1 failed, 4 passed, 5 total     restored, sha match
MQ3 Tests: 1 failed, 29 passed, 30 total   restored, sha match
MQ4 Tests: 1 failed, 29 passed, 30 total   restored, sha match
PASS  S0 runs off: 409 runs_not_enabled
PASS  S1 rowsArchived = eligible (28) = archive count; batches = 3
PASS  S2 1 ms budget: 200 partial   {"outcome":"partial","rowsArchived":4,"batches":1}
PASS  S2 Continue: 200 succeeded, all 15 moved, cutoff unchanged
PASS  S3 two interleaved starts: one 200, one 409 run_in_progress
PASS  S4b run with last batch 4 min ago is alive: 409, still running
PASS  S5 Continue on succeeded: 409 run_not_continuable, row unchanged, no audit
PASS  S5 refused batch: 500 archive_batch_failed + runId; run failed / batch_failed; nothing moved
PASS  FINAL ... {"c":{"live":20,"arch":59,"runs":10},"dup":{"n":0},"running":{"n":0},"logged":{"n":59}}
ALL PASS
```

### Live checks owed to the user after deploy (runs stay off)

| # | Check | Expected |
|---|---|---|
| M-b1 | `/admin/archiving`, Archive at 365, 180, 90 (keyboard) | Dialog opens; retention, cutoff, rows match the card; K-1 sentence only at 180 and 90; Escape closes |
| M-b2 | Confirm in the dialog | Disabled, "Not switched on yet"; badge reads "Runs off" |
| M-b3 | DevTools POST from §7 | `409`, `runs_not_enabled` |
| M-b4 | `SELECT count(*) FROM public.archive_runs;` | `0` |

### Final Status
- [x] All acceptance criteria testable in 2b pass — ready for commit (after the user's diff review); M-b1 to M-b4 owed after deploy
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | Created | Slice 2b workplan split out of the Slice 2 workplan (1,178 lines). Every 2b task re-verified against `main` at `12ffede3`. No migration needed (checked against M1's grants, columns, CHECK and index). Eight differences from the original T-b plan recorded (§3), the main ones: a slim POST result instead of a run summary, two plain takeover updates, no new audit test file because `eventAudience.ts` now exists (pin 157 → 160), and handler counts re-measured to 82 → 83. Two open questions for SA. No code written |
| 2026-09-26 | SA workplan review: APPROVED WITH CHANGES | All eight deviations approved. Q-b1 `shared`; Q-b2: WC-7 await pattern approved (neither `log()` nor `flush()` can reject; it adds one insert round-trip, bounded by `maxDuration`). R-1: pin the RPC → runner → POST-after-flag call graph in P-15. R-2: drop the "@" log assertion and QA M-b5. O-1 optional. CLAUDE.md fact-checked: `main` reads 82 / 53 / 76 / 6, as the workplan says; the edit stays with the user |
| 2026-09-26 | Dev: Slice 2b Code Complete | T-b1 to T-b10 done. SA R-1 (P-15 pins the call graph: batch only from the runner, runner only from the route after the flag check), R-2 (no `@` check, M-b5 dropped) and O-1 (`run_unfinished`) applied. 45 suites / 1,269 tests green; 4 mutations caught and restored; ESLint 0 errors; `lint:hooks` and `next build` pass. Docs: REPOSITORY_STRATEGY, ADMIN_IDENTIFICATION_AND_ACCESS (83 / 77 / 6 / 54). CLAUDE.md not edited |
| 2026-09-26 | QA: PASS | 45 suites / 1,269 tests re-run green. 4 QA mutations (claim accepts `succeeded`, runner ignores budget, COMPLETED on partial, runner before the flag) all caught, files restored by SHA-256. Real repository + runner + route driven against PGlite with M1 as `service_role`: 34 checks pass (complete, partial + Continue on the stored cutoff, conflicts, stale takeover, Continue refused, failed + Continue). No bugs; 2 low edge notes. M-b1 to M-b4 owed after deploy |
| 2026-09-26 | SA code review of Slice 2b: CODE APPROVED FOR QA | Route order, three 500 codes, audit (admin as userId/actorId, nothing on partial or unfinished, awaited log + flush on every path), five field-by-field repository writes, `23505` → conflict, claim limited to partial/failed with the stored cutoff, runner budget and fail-closed paths, and the R-1 call-graph pins all verified. No path to a real run while `ARCHIVE_RUNS_ENABLED = false`. Counts re-measured: 54 / 83 / 77 / 6, `adminGate.writes` 59, `eventAudience` 160 / 15 / 61 / 84. I-1 to I-6 approved. Four Low comments (unknown source after claim leaves a run open; K-1 keyed to the default; "started" wording on Continue failures; a stale "7 inline" comment) and one optional R-1 extension (pin the function name to the repository). SA re-ran 11 suites / 665 tests: green |
| 2026-09-26 | Dev: post-review fixes (SA L-1 to L-4 + optional) | Runner owns the source lookup and fails an unknown source (X-7); K-1 compared against the longest option; Continue/Start-specific fallback sentence and the `runs_not_enabled` G-8 row; inline count comment 7 -> 6; P-15 pins the batch function name to the repository. 45 suites / 1,273 tests, ESLint 0, `next build` pass |
