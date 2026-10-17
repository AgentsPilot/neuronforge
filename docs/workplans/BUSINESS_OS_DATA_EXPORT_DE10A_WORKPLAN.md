# Workplan: Data export DE-10a — Admin: export status, prepare, audited download

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) — §0.2 DX-4 / DX-7, §0.3.4, §0.3.5, §0.4.1 B / F / H, §0.12 (Q-2, Q-9, B-2), §0.13 (Q-8, Q-12), §0.14 (C-4 forward notes); DE-8b workplan D-7
**Branch:** `feature/data-export-de10a` (worktree `neuronforge-de10a`, cut from `origin/main` `4e10ebba`, which carries DE-8a #451 and DE-8b #453)
**Depends on:** DE-9 (uncommitted in worktree `neuronforge-de9`). This plan is written against DE-9's end state. **Implementation starts only after DE-9 merges**; the branch then merges `origin/main` first.
**Depends on PR #454 (DE-9), as built (2026-10-17):** DE-9 is committed on `origin/feature/data-export-de9` (`e7fbc24a`, PR #454, held until T-14) and is not on `main` yet. TL directed implementation now: this branch merged `origin/main` (already up to date) and then `origin/feature/data-export-de9` (a fast-forward to `e7fbc24a`; merges only, never a rebase). **The DE-10a PR targets `main` and must merge only after #454 has landed on `main`** (no stacked PR into the DE-9 branch: the stacked-PR trap). Until then its diff against `main` also shows DE-9's commit; after #454 merges, merge `origin/main` into this branch and the diff is DE-10a only.
**Date:** 2026-10-17
**Status:** SA code-approved + QA PASS 2026-10-17; committed by RM; MERGE HELD until #454 (DE-9) is on main

## Overview

The last Phase 1 slice of "Download my data". An admin, on `/admin/users`, opens a business, and in a new **Data export** box placed directly **above the Danger area** sees the account's exports (when, by whom, ready / expired / failed, downloaded by the owner or not), can **prepare** an export of that account, and can **download** a ready one after typing a reason. The download is recorded with the admin's identity **before** the link is issued; if the record cannot be written, nothing is downloaded. The owner is never told (BQ-SA-2). There is no "send to owner" (Phase 2, §0.4.1 H). The zip is exactly the owner's (same `runZipExport`, same ceilings).

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Binding inputs and how this plan meets them](#2-binding-inputs-and-how-this-plan-meets-them)
3. [Audit placement: the Q-8 resolution](#3-audit-placement-the-q-8-resolution)
4. [The two C-4 forward notes](#4-the-two-c-4-forward-notes)
5. [Routes](#5-routes)
6. [Repository and engine changes](#6-repository-and-engine-changes)
7. [UI: the Data export box](#7-ui-the-data-export-box)
8. [Files to create / modify](#8-files-to-create--modify)
9. [Tests](#9-tests)
10. [Task list](#10-task-list)
11. [Business calls (TL defaults)](#11-business-calls-tl-defaults)
12. [Questions for SA](#12-questions-for-sa)
13. [Read-only SQL for TL](#13-read-only-sql-for-tl)
14. [Effort, risk, rollout](#14-effort-risk-rollout)

---

## 1. Analysis summary

| Area | What exists (verified on `origin/main` `4e10ebba` + DE-9 worktree) | DE-10a touches it how |
|---|---|---|
| Jobs table `business_os_data_exports` (20261074) | `requested_by`, `requested_by_kind` (`owner` / `admin`), CHECK `kind <> 'owner' OR requested_by = user_id`, `owner_downloaded_at`. Service-role only, RLS on, no policy | Read and written through the repository only. **No migration** |
| Start function | Takes `(p_user_id, p_requested_by, p_requested_by_kind)`. The one-at-a-time index and the 3-per-24 h count have **no kind predicate**, so admin-started jobs already count against the target (DX-4) | Called via the existing `startForAdmin(targetUserId, adminUserId)`. Unchanged; a source pin added |
| `BusinessOsDataExportJobRepository` | `startForAdmin`, `findById(id, userId)`, `listForUser`, `markOwnerDownloaded`, `expireOtherReady(userId, keepJobId)`, sweep reads returning `{ id, user_id }` | `findOwnerJobById` added; `markOwnerDownloaded` owner-only; `expireOtherReady` scoped by kind; sweep reads also return `requested_by_kind` (§6) |
| `runZipExport` (DE-8b) | Takes `ExportContext { userId, authUser }`; step 9 calls `expireOtherReady(userId, jobId)` | Same call from the admin route with the target's context; step 9 passes the ready job's own kind (§4.2) |
| Owner download-again route | `findById(jobId, user.id)`: an admin-kind job of the same account is reachable by an owner who learns its id (DE-9 C-4 note 1) | Uses `findOwnerJobById`: an admin job is a 404 (§4.1) |
| Owner status route (DE-9) | `findLatestCompletedForUser` already filters `requested_by_kind = 'owner'` | Unchanged |
| Cron sweep (`exportSweep.ts`) | Reap and expiry rows written with `userId` = the row's `user_id` (the owner) | For admin-kind jobs, written with `userId: null` (§3.3), so the owner never reads them |
| `AuditTrailService` | `writeNow` (confirmed write, AD-2a); `buildLogEntry`: `actor_id = actorId \|\| userId \|\| SYSTEM_ADMIN_USER_ID` (D-7) | **Unchanged** (§3.4) |
| Owner audit readers | RLS `auth.uid() = user_id AND entity_type NOT IN (5 operator types)` (20261035); `AuditTrailRepository.listOwnerEntries` filters `.eq('user_id', userId)` + the same hidden list | Unchanged. Admin rows are kept off the owner's `user_id` (§3) |
| Health page | `/api/admin/health-summary` counts `severity = 'critical'` over all accounts (no user or entity filter) for the "Critical audit events" tile; the tile links to the audit trail | Unchanged. `DATA_EXPORT_DOWNLOADED_BY_ADMIN` is `critical` (DE-8a Q-9, B-2), so each admin download raises the tile for 24 h |
| `/admin/users` drawer | `BusinessDetail.tsx`: Business OS panel → Account & security → Activity (`BusinessAuditSection`) → `danger-area` (hard delete `TestAccountCleanupPanel`, AD-1 entry hidden by `SHOW_AD1_DELETE_ENTRY = false`). Five `DrawerBox` sections, BD-4 order, BD-16 boxes + purpose lines; layout tests pin five groups and "danger last" | A sixth boxed section **Data export**, between Activity and the Danger area (§7) |
| Admin hard delete | `runCleanupDelete` empties the storage objects the check lists; the generated 20261075 check lists `business-data-exports` under `{user_id}/` | **Verified: the hard delete already removes the export prefix.** No code change (§0.3.5 "if needed"); a pin added (T-22) |
| Admin authz | `requireAdmin` first statement; `test:authz-guard` (required job) scans by shape; `adminGate.writes.test.ts` probes every admin handler for 401/403 | Three new handlers, gated from birth and registered in the gate oracle |
| Entitlements | — | No import from `lib/business-os/entitlements/`; `test:bos-entitlements` not affected |
| Admin i18n | Admin console copy is English constants per screen (`boostCopy.ts`, `creditCopy.ts`) | `dataExportCopy.ts`, English only |

**Not touched:** the zip content, the ceilings, the start function, the bucket, the owner's UI, `DataExportNotice` (owner tone, en/he/es; the admin box uses the admin `AdminNotice` / admin dark tone instead), `AuditTrailService`, any RLS policy.

---

## 2. Binding inputs and how this plan meets them

| Input | Met by |
|---|---|
| User 2026-10-16: in `/admin/users`, business area, just above the Danger Zone, last slice | §7: a boxed section mounted immediately before `danger-area`; render test T-30 |
| DX-7: owner and admins may download; every admin download audited with the admin's identity | §5.3 write-ahead `DATA_EXPORT_DOWNLOADED_BY_ADMIN`, `user_id = actor_id = admin`, reason in details |
| BQ-SA-2: no owner notice | §3: no admin-path row lands on the owner's `user_id`; owner routes never return an admin job (§4.1) |
| §0.3.4: POST download, Zod `{ reason }` 5–500, confirmed audit (`writeNow`) else 503, then a 60 s URL; target only from the path; job read with `.eq('user_id', <path id>)` | §5.3 |
| §0.4.1 B: `POST …/data-exports` with `{ reason }` prepares (same builder, target's limit, non-blocking `DATA_EXPORT_REQUESTED`, admin as actor) | §5.2 |
| §0.4.1 H: no email; ask the owner or download and hand over; delete never blocked | No send button; the box's warning line (§7.3); the Danger area is untouched and never gated by the box |
| DE-8a Q-2: `requested_by` = admin's auth id from the session | `startForAdmin(targetId, gate.user.id)` |
| DE-8a Q-9 / B-2: `DOWNLOADED_BY_ADMIN` critical → Health flag + 7-year class | Severity `critical` passed explicitly and pinned (T-12); no Health code change (§1) |
| DE-8b Q-8 (binding): admin `REQUESTED` and `DOWNLOADED_BY_ADMIN` under an operator-only entity type **or otherwise proven hidden** | §3: proven hidden by placement (admin-owned rows), extended to every row about an admin job; tests T-14 / T-15. SA question SA-1 |
| DE-8b D-7 (binding follow-up): admin rows need real actor semantics | §3.4: every admin-path row passes `actorId = adminId` explicitly (pinned); system rows on admin jobs use the N-6 null/null precedent; no service change. SA question SA-3 |
| DE-9 C-4 note 1: owner download-again 404 on an admin job | §4.1, T-17 |
| DE-9 C-4 note 2: decide `expireOtherReady` across kinds | §4.2 (kind-scoped), T-19 / T-20; business call BC-3 |
| DX-4: admin counts toward the owner's 3/day | Start function unchanged (no kind predicate); route maps the 409; T-9, T-21 |
| `tenant-isolation-guard` | §5.4 |
| No added CI time | §9: Jest only, in the existing Tests and authz-guard jobs |

---

## 3. Audit placement: the Q-8 resolution

### 3.1 The risk

The owner reads `audit_trail` rows where `user_id = owner` (RLS and `listOwnerEntries`), except five operator-only entity types. DE-8b's owner rows use `entityType 'user'`, `userId = owner`. If the admin path did the same, the owner would read "DATA_EXPORT_REQUESTED", "DATA_EXPORT_READY", "DATA_EXPORT_DOWNLOADED_BY_ADMIN" (with the admin's reason). Q-8 names REQUESTED and DOWNLOADED_BY_ADMIN; **the same leak exists for every row about an admin job**: READY, FAILED, the replaced-export EXPIRED rows, and the cron's reap FAILED and retention EXPIRED rows. This plan covers all of them.

### 3.2 Dev recommendation: admin-owned rows (no new entity type, no migration)

Every row the **admin routes** write is placed exactly as the existing admin-on-target rows are (`BUSINESS_DELETION_PREVIEWED` in AD-1b, `BUSINESS_DELETION_STARTED` in AD-2a, and §0.3.4's own wording for this event):

| Field | Value |
|---|---|
| `userId` | **the admin's auth id** (`gate.user.id`) |
| `actorId` | **the admin's auth id**, always passed explicitly |
| `entityType` / `entityId` | `'user'` / the target account id |
| `details` | `target_user_id`, `job_id`, `requested_by_kind: 'admin'` (or the downloaded job's kind), `surface: 'admin'`, `correlationId`, plus per event: `reason` (REQUESTED, DOWNLOADED_BY_ADMIN), `part_no` (DOWNLOADED_BY_ADMIN), counts / bytes as the owner rows carry (READY, FAILED). Never the URL, the file name, the business name or an email |

One pure builder module, `lib/business-os/data-export/adminExportAudit.ts`, is the only place these inputs are built, so the placement cannot drift between the two routes.

**Why it is hidden from the owner:** the owner RLS policy is `auth.uid() = user_id AND …`, and `listOwnerEntries` / the `/monitoring` reader both filter `.eq('user_id', userId)`. A row whose `user_id` is the admin cannot match the owner. This is the same proof the platform already relies on for AD-1b / AD-2a ("so it never lands on the owner's account").

**Why not the new operator entity type** (Q-8's first option):

| | Admin-owned rows (recommended) | New operator type `business_os_data_export` |
|---|---|---|
| Migration | None | `ALTER POLICY` on `audit_trail` (hand-applied on PROD), `AUDIT_ENTITY_TYPES` + `AUDIT_ENTITY_OWNER_VISIBILITY` + policy test |
| Precedent | AD-1b, AD-2a, §0.3.4 text | `business_os_credit_lot`, `bos_queue_item` |
| Release window | None | Rows written before the policy is applied would be owner-readable (mitigated only by applying first) |
| Evidence after the account is deleted | `user_id` = admin survives; `entity_id` = target | `user_id` → NULL on delete (`audit_trail.user_id ON DELETE SET NULL`); `entity_id` must then carry the target |
| Shows in the business's drawer Activity | No (that list reads `user_id = target`) — business call BC-7 | Yes |

The trade-off for the business is only BC-7 (the admin download does not appear in that business's Activity list; it appears in the Audit trail and on the Health tile). If SA prefers the operator type, §8 gains one migration, two registry entries and their tests (+0.5 d) and §3.3 changes to `userId = target`.

### 3.3 Rows written by the cron for admin jobs

`exportSweep.ts` writes the reap `DATA_EXPORT_FAILED` and the retention `DATA_EXPORT_EXPIRED` with `userId` = the row's `user_id`. For an **admin-kind** job they become:

- `userId: null`, `actorId: null`, `entityType 'user'`, `entityId` = the target, `details` += `target_user_id`, `requested_by_kind: 'admin'`, `actor_kind: 'system'`.

This is the invites N-6 precedent (`championSubscribedNotification.ts`, `redemptionDeps.ts`): "no owner policy and no owner reader can return a row whose `user_id` is not the reader". The stored `user_id` is NULL, or the platform account when `SYSTEM_ADMIN_USER_ID` is set; never the owner. Owner-kind rows are unchanged. The sweep needs the kind, so `listDueForExpiry` and `listStaleRunning` also return `requested_by_kind` (§6).

### 3.4 D-7 ruling for DE-10a

`buildLogEntry` substitutes `userId` when `actorId` is null/undefined. **DE-10a does not change `AuditTrailService`:**

- Every admin-route row passes `actorId = adminId` explicitly, so the substitution never applies to an admin action. Pinned: T-14 asserts `actorId === adminId && userId === adminId` for every `AuditLogInput` either admin route builds, on every branch.
- Admin-job system rows (§3.3) pass `userId: null, actorId: null`: the substitution yields `SYSTEM_ADMIN_USER_ID` or NULL, never the owner and never an admin.
- Owner-job cron rows keep the DE-8b behaviour (`actor_id` reads as the owner; `details.actor_kind: 'system'` tells them apart), as SA ruled at DE-8b. Changing "explicit null means no actor" in the service touches four other callers (invites validate, inviter notification, redemption, the sweep) and is not needed for DE-10a's correctness. Proposed as a separate follow-up (SA-3).

---

## 4. The two C-4 forward notes

### 4.1 Owner download-again answers 404 for an admin job

- New repository method `findOwnerJobById(jobId, userId)`: `.eq('id').eq('user_id').eq('requested_by_kind', 'owner')`. The owner route `POST /api/business-os/data-exports/[jobId]/parts/[partNo]/download` switches from `findById` to it. An admin job of the same account is then exactly a missing one: 404, no 410 hint, no audit row.
- `markOwnerDownloaded` gains `.eq('requested_by_kind', 'owner')` (defence in depth: an admin download can never set `owner_downloaded_at`, and nothing else can stamp an admin job as owner-downloaded).
- `findById` stays for the admin route and `runZipExport`'s re-read (both legitimately see either kind).

### 4.2 `expireOtherReady`: kind-scoped replacement

**Rule (Dev default, BC-3):** a newer export replaces only older ready exports **of the same kind**. An owner export never expires an admin-prepared export, and an admin export never expires the owner's.

- Why: the admin may be holding a prepared export to hand over before a delete; the owner pressing "Download my data" must not destroy it, and an admin preparing one must not destroy the file the owner is about to fetch with "Download again" (and which the owner's status line, DE-9, still offers).
- Consequence: at most **two** ready objects per account (one per kind) for up to 72 hours, both under `{user_id}/` and both removed by Purge, the admin delete, the hard delete and the 3-day sweep. The 50 MB bucket limit is per object, so this changes no limit.
- Implementation: `expireOtherReady(userId, keepJobId, kind)` with `kind` Zod-checked and applied as `.eq('requested_by_kind', kind)`. In `runZipExport` step 9 the kind is **taken from the job row `markReady` returned** (`job.requested_by_kind`), never from a caller argument, so the owner route cannot pass the wrong kind.
- The orphan sweep is unaffected (it keeps `running` / `ready` objects of either kind).

---

## 5. Routes

All three follow `new-api-route` (admin variant): `requireAdmin` is the first statement, then `correlationId` + `logger.child`, Zod on path and body, structured JSON, `Cache-Control: no-store`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, the development-only `details` guard. Target id: path only, Zod uuid, lower-cased (the AD-1b canonical form). Admin id: `gate.user.id` only. Body read as text: empty → `{}`, malformed → 400.

### 5.1 `GET /api/admin/users/[id]/data-exports` — status

`requireAdmin` → path → throttle (`admin-data-export-status`, `RATE_LIMITS.read`) → `listForUser(targetId, { limit: 10 })` → 200:

```json
{ "success": true, "data": {
  "exports": [{ "jobId", "requestedByKind": "owner|admin", "requestedByShort": "ab12cd34|null",
                "isRequestedByYou": true, "status", "failureReason", "createdAt", "readyAt",
                "expiresAt", "ownerDownloadedAt", "isDownloadable", "bytes", "fileCount", "rowCount" }],
  "ownerDownloadedLatest": false,
  "dailyLimit": 3 } }
```

- `requestedByShort` = the admin's short id (the CreditsBlock "admin {shortId}" precedent; no extra identity read, no email). `null` for owner jobs.
- `isDownloadable` = `ready` and `expires_at` in the future (the server clock decides, as the owner routes do).
- `ownerDownloadedLatest` = the newest **owner-kind** job has `owner_downloaded_at` set (feeds the warning, BC-4).
- No URL, no file name, no business name. Not audited (metadata only, as the drawer's other reads; SA-8). 500 on a read error (never an empty list).

### 5.2 `POST /api/admin/users/[id]/data-exports` — prepare

`maxDuration = 60` (below the 90 s stale rule, DE-8a). Body `z.object({ reason: z.string().trim().min(5).max(500) }).strict()`.

1. `requireAdmin` → path → body → throttle (`admin-data-export-start`, `RATE_LIMITS.create`).
2. Own account (`targetId === adminId`) → 403 `own_account` (BC-6).
3. `authAccountRepository.findUserIdentity(targetId)`: `null` → 404; error, or no `createdAt` → 500 `identity_read_failed` (never 404, AD-1b D-1).
4. `startForAdmin(targetId, adminId)`: error → 500; `in_progress` / `daily_limit` → 409 with `code` and `retryAt` (the target's limit, DX-4).
5. `DATA_EXPORT_REQUESTED` (admin-owned, §3.2, with `reason`), non-blocking `log().catch()` as §0.4.1 B rules.
6. `runZipExport({ ctx: { userId: targetId, authUser: { id, email, created_at } }, jobId, startedAt }, zipExportDeps(log), log)`.
7. Not ready → `logAndFlush` `DATA_EXPORT_FAILED` (admin-owned) → 413 `export_too_large` / 503 `export_timeout` / 500 `export_failed` (admin wording: "This account holds more than Phase 1 can package…").
8. Ready → `logAndFlush` `DATA_EXPORT_READY` (admin-owned) → one non-blocking `DATA_EXPORT_EXPIRED` per replaced **admin** job (§4.2) → 200 `{ jobId, expiresAt, bytes, fileCount, rowCount, failedSections, missingFiles }`.

**No URL is returned.** The only route that mints an admin URL is §5.3, so every admin download, including the first one after a prepare, passes the write-ahead audit and its reason (BC-1).

### 5.3 `POST /api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download` — audited download

Path `{ id: uuid, jobId: uuid, partNo: literal '1' }`; body `{ reason }` as §5.2.

1. `requireAdmin` → path → body → throttle (`admin-data-export-download`, `RATE_LIMITS.read`).
2. Own account → 403 `own_account`.
3. `findById(jobId, targetId)` (either kind, BC-2): error → 500; `null` → 404 (a job of another account is a 404, the same as a missing one).
4. Not `ready`, or `expires_at` passed → 410 `export_expired`.
5. **Write-ahead:** `AuditTrailService.getInstance().writeNow(...)` `DATA_EXPORT_DOWNLOADED_BY_ADMIN`, admin-owned (§3.2), `severity: 'critical'`, `complianceFlags ['GDPR','SOC2']`, details `{ target_user_id, job_id, part_no: 1, requested_by_kind: job.requested_by_kind, reason, surface: 'admin', correlationId }`, `request`. `written === false` → **503** `audit_unavailable`: "The download could not be recorded, so it was not started." Nothing is signed.
6. File name: the target's timezone and business name, re-derived through the shared `exportDownloadNames(userId, createdAt, log)` (§6.4) — the owner gets the same name.
7. `storage.sign(targetId, jobId, EXPORT_JOB_POLICY.ADMIN_SIGNED_URL_TTL_SECONDS /* 60 */, fileName)`: failure → 500 (the write-ahead row stays; a STARTED-without-outcome row is the AD-2a precedent, SA-7).
8. 200 `{ downloadUrl, fileName, asciiFileName, expiresAt }`. **No `markOwnerDownloaded`.** URL and file name never logged or audited (DE-8b C-3).

### 5.4 Tenant isolation (`tenant-isolation-guard`)

| Check | How |
|---|---|
| Service role + caller-supplied id | Yes: target id (path), job id (path). Guard applies |
| Ownership pre-check before the effect | §5.3 step 3: `findById(jobId, targetId)` before the audit write and the sign; the sign path is rebuilt by `exportObjectPath(targetId, jobId)` from two uuids, never from the request |
| Every supplied id checked | target via the path schema + identity read (§5.2) / job row scope (§5.3); `jobId` via `(id, user_id)`; `partNo` literal `'1'` |
| Payload allow-list | Bodies carry `reason` only (`.strict()`: a `userId`, `targetUserId` or `jobId` in the body is a 400). Every row field is built in the repository / builder |
| Scope-defeating three | No trigger, no upsert, no spread |
| Test (Step 7) | T-6: a job id of account B on account A's path → 404, `writeNow` and `sign` never called; T-7: body `userId` injection → 400 before any repository call |

---

## 6. Repository and engine changes

| # | Change | Why |
|---|---|---|
| 6.1 | `findOwnerJobById(jobId, userId)` | §4.1 |
| 6.2 | `markOwnerDownloaded`: `+ .eq('requested_by_kind', 'owner')` | §4.1 |
| 6.3 | `expireOtherReady(userId, keepJobId, kind)`; `runZipExport` step 9 passes `job.requested_by_kind`; `ZipExportDeps.jobs` type follows | §4.2 |
| 6.4 | `lib/business-os/data-export/downloadName.ts`: `exportDownloadNames(userId, createdAt, log)` = `ownerTimezone` + `findCompanyName` → `cleanBusinessName` → `exportZipFileNames`; a failed read gives the fallback name and a `warn`. A pure move of the owner download route's local `businessName()` plus its three-line caller, so both routes name the file one way | One rule for the file name (DX-10) |
| 6.5 | `DataExportJobRef` gains `requested_by_kind`; `listDueForExpiry` and `listStaleRunning` select it | §3.3 |
| 6.6 | `exportSweep.ts`: `systemFailedEntry` / `expiredEntry` take the ref and place admin-kind rows per §3.3 | §3.3 |

No new table, column, function, bucket, policy or dependency.

---

## 7. UI: the Data export box

### 7.1 Placement

`BusinessDetail.tsx`: `<DataExportBlock … />` is mounted between `<BusinessAuditSection …/>` and the `danger-area` div, so the order becomes strip → Credits & billing → Plan & entitlements → AI usage → Account & security → Activity → **Data export** → Danger area. It is a `DrawerBox` section (key `export`, title "Data export", test id `drawer-section-export`) with its BD-16 purpose line: *"This account's exports. Prepare one, or download a ready one; every admin download is recorded with your name and reason."* This amends BD-4 (fixed order) and the "five groups" pins to six, at the user's request (SA-9). Shown for every login, with or without a Business OS business (BC-5): the export works for both.

### 7.2 Content (English only, `app/admin/users/dataExportCopy.ts`)

- **Status list** (from §5.1, newest first, first three shown, the rest behind the existing `ShowMoreList` fold): UTC time with age line (`formatUtc` / `ageLine`), "by the owner" / "by admin ab12cd34" / "by you", and a `StatusChip`-style word: *Ready until {time}*, *Expired*, *Failed — too large / timed out / error*, *Being prepared*; for owner exports also *Downloaded by the owner {time}* or *Not downloaded by the owner*. Sizes as "{files} files, {MB} MB". "No exports yet." when empty. A failed read says "The exports could not be read." with Retry, never an empty list.
- **Warning line** (BC-4), shown when `ownerDownloadedLatest` is false, in the danger tone used by the Danger area's text: *"The owner has not downloaded an export. Deleting now deletes any export. Download it now if you need to hand it over."* (§0.4.1 B wording.) Informational only; nothing is blocked.
- **Action bar:** "Prepare export" (`ADMIN_BUTTON`); on each downloadable row "Download (audited)…". Hidden on the admin's own account with the line "Use Download my data in your own settings." (BC-6; the server refuses regardless).
- **Reason dialog** (`DataExportReasonDialog.tsx`, OR-3: `ui/dialog` + `ADMIN_DIALOG_CLASS`, focus on the reason field, one send, no close while in flight, focus returns to the opener or the section heading, BD-15): one component, two modes.
  - *Prepare*: "Why are you preparing this account's export?" Counter 5–500. Sending shows "Preparing… this can take up to a minute." Success: dialog closes, status line *"Export prepared. Ready until {time}. Download it below."*, the list reads again.
  - *Download*: "This download is recorded with your name and this reason. The owner is not notified." Reason pre-filled with this session's prepare reason when the admin just prepared it (BC-1), editable. Success: the browser is sent to the signed URL through DE-9's `isSafeDownloadUrl` / `browserNavigation` (https only, SA DE-9 C-6), and a status line says *"Download started. The link works for one minute."*
  - Refusals map `code` / status to one admin sentence each: 409 in progress / daily limit (with `retryAt` as UTC), 410 expired, 413 too large, 503 timeout, **503 `audit_unavailable`** ("The download could not be recorded, so it was not started. Try again."), 403 `own_account`, 401/403 session.
- **Client timeout:** 75 s on prepare (AbortController + timer cleared in `finally`, the DE-9 C-5 shape), then "Still preparing or failed. Refresh the list in a minute."
- Fetches go through `readAdminResponse` (the admin screens' reader); no `console.*`; `clientLogger` on unexpected failure.

### 7.3 Admin look

Admin dark tone only: `SECTION_BOX` / `PART_BOX`, `PURPOSE_LINE`, `ADMIN_BUTTON`, `AdminNotice`, `StatusChip`, slate text; no decorative green (T-6); colour never the only signal (the word says the state). `DataExportNotice` (owner tone, three languages) is **not** reused; only DE-9's URL-safety helpers are.

---

## 8. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/admin/users/[id]/data-exports/route.ts` | create | §5.1 GET, §5.2 POST |
| `app/api/admin/users/[id]/data-exports/__tests__/route.test.ts` | create | T-1…T-11, T-21 |
| `app/api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download/route.ts` | create | §5.3 |
| `app/api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download/__tests__/route.test.ts` | create | T-1…T-13 |
| `lib/business-os/data-export/adminExportAudit.ts` (+ `__tests__/adminExportAudit.test.ts`) | create | §3.2 builders; T-14 |
| `lib/business-os/data-export/downloadName.ts` (+ test) | create | §6.4 |
| `app/api/business-os/data-exports/[jobId]/parts/[partNo]/download/route.ts` (+ its test) | modify | §4.1, §6.4; T-17 |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` (+ test) | modify | §6.1, 6.2, 6.3, 6.5; T-18, T-19 |
| `lib/repositories/types.ts` | modify | `DataExportJobRef.requested_by_kind` |
| `lib/business-os/data-export/zipExport.ts` (+ `zipExport.test.ts`) | modify | §6.3; T-20 |
| `lib/business-os/data-export/exportSweep.ts` (+ `exportSweep.test.ts`) | modify | §3.3; T-15 |
| `app/admin/users/components/DataExportBlock.tsx` | create | §7 |
| `app/admin/users/components/DataExportReasonDialog.tsx` | create | §7.2 |
| `app/admin/users/dataExportCopy.ts` | create | English copy |
| `app/admin/users/components/BusinessDetail.tsx` | modify | mount above the danger area |
| `app/admin/users/components/DrawerBox.tsx` | modify | `DrawerSectionKey` + `'export'`, purpose line |
| `app/admin/users/__tests__/dataExportBlock.render.test.tsx` | create | T-23…T-29 |
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | modify | six sections, order, `role="group"` count 6, BOXED_SECTIONS; T-30 |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | the two new screen files in its file lists; fetch-count pins for the new block |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | three handlers + the count note |
| `supabase/migrations/__tests__/business-os-data-exports.migration.test.ts` | modify | T-21 pin: the daily count and the in-progress check carry no `requested_by_kind` predicate |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | §0.15 DE-10a splice (status, SA rulings, TL defaults, supersessions: §0.3.4 `entity_type`, BD-4 order) |
| `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10A_WORKPLAN.md` | this file | — |

**`console.*` check:** none of the files to modify use `console.*` (checked by grep before editing; flagged if found).

---

## 9. Tests

All Jest, co-located or in `__tests__/`, running in the existing required Tests job; the gate-oracle entries run in the existing `test:authz-guard` job. No new job, no new step, no PGlite run in CI: **no added CI time**.

| # | Test | Where |
|---|---|---|
| T-1 | Each handler: signed out → 401, signed in non-admin → **403**, and no repository / storage / audit call happened (requireAdmin mocked as the oracle does) | both route tests + `adminGate.writes` |
| T-2 | `requireAdmin` is the first awaited call (a mocked body reader and repository record call order) | both |
| T-3 | Path id not a uuid → 400; `partNo` other than `'1'` → 400 | both |
| T-4 | Reason missing, `"   "`, 4 chars, 501 chars → 400; 5 and 500 → accepted; extra key → 400 | both POSTs |
| T-5 | Malformed JSON → 400, never 500 | both POSTs |
| T-6 | **Cross-target isolation:** job of account B under A's path → 404; `writeNow`, `sign` never called; `findById` called with `(jobId, A)` | download |
| T-7 | Body `{ reason, userId: B }` → 400 before any repository call | both POSTs |
| T-8 | Own account → 403 `own_account`, nothing started / signed | both POSTs |
| T-9 | Prepare: `startForAdmin(target, admin)` called with the path id and the **session** admin id; 409 `in_progress` / `daily_limit` mapped with `retryAt` | prepare |
| T-10 | Prepare ready → 200 with **no `downloadUrl`**; storage `sign` never called | prepare |
| T-11 | Prepare failures: over ceiling 413, timeout 503, error 500; FAILED row written; identity 404 / 500 split | prepare |
| T-12 | **Audit before URL:** `writeNow` resolves before `sign` is called (ordered call log); `writeNow → { written: false }` → 503, `sign` never called; severity `critical` on the row | download |
| T-13 | Expired / not ready → 410, no audit, no sign; 60 s TTL passed to `sign`; `markOwnerDownloaded` never called on the admin path; URL and file name absent from every log and audit call | download |
| T-14 | **Placement:** every `AuditLogInput` either admin route builds, on every branch (requested, ready, failed, replaced, downloaded), has `userId === adminId`, `actorId === adminId`, `entityId === targetId`, `details.target_user_id === targetId`, and never `userId === targetId` | builder test + both route tests |
| T-15 | **Sweep:** an admin-kind stale run and an admin-kind expiry write rows with `userId: null, actorId: null`, `details.requested_by_kind 'admin'`; owner-kind rows unchanged (existing assertions kept) | `exportSweep.test.ts` |
| T-16 | **Owner cannot read the admin rows:** `listOwnerEntries(owner)` against a fake client holding the admin-path rows returns none of them, because its query is `.eq('user_id', owner)`; and the latest owner policy still begins `auth.uid() = user_id` (existing migration pin referenced, not duplicated) | `adminExportAudit.test.ts` |
| T-17 | **Owner download-again on an admin job → 404**; the query carried `requested_by_kind = 'owner'`; no sign, no audit | owner download route test |
| T-18 | `markOwnerDownloaded` filters `requested_by_kind = 'owner'`; `findOwnerJobById` filters id, user_id, kind | repository test |
| T-19 | `expireOtherReady(user, keep, 'owner')` filters the kind; an invalid kind is an error without a database call | repository test |
| T-20 | `runZipExport` passes the **ready job's own** `requested_by_kind` to `expireOtherReady` (an admin job → `'admin'`, an owner job → `'owner'`) | `zipExport.test.ts` |
| T-21 | **Rate limit counts admin:** migration source pin — the daily-count and in-progress statements of `business_os_data_export_start` contain no `requested_by_kind` predicate; route maps the target's `daily_limit` 409 | migration test + prepare test |
| T-22 | Hard delete covers the export bucket: the generated cleanup check's storage section lists `business-data-exports` (pin on the 20261075 source, if the drift test does not already assert it; Dev checks first and only adds what is missing) | migration / cleanup test |
| T-23 | Block renders the list (owner / admin / you, each status word, sizes), the empty state, the read-error state with Retry | `dataExportBlock.render.test.tsx` |
| T-24 | Warning shows when `ownerDownloadedLatest` is false, hidden when true | same |
| T-25 | Prepare dialog: reason under 5 disables Send; one request per send; no close in flight; success re-reads the list | same |
| T-26 | Download dialog: pre-filled reason after a prepare; 200 navigates via the safe-URL helper only for `https:`; 503 `audit_unavailable` shows its sentence and does not navigate | same |
| T-27 | Each refusal code shows its sentence | same |
| T-28 | Own account: no actions, the pointer line | same |
| T-29 | The block sends nothing until the drawer is open (mounted only inside the open drawer) and one GET per open | same |
| T-30 | **Placement:** in the drawer the Data export box comes after Activity and **immediately before** `danger-area`; the danger area is still the last element; six boxed sections; six `role="group"`; purpose line straight after the heading | layout test |

Local runs before handover: the touched test files, `npm run test:authz-guard`, scoped `tsc --noEmit` on the touched files, `npm run lint` on them. `npm run test:bos-entitlements` is not required (no entitlements import), run once anyway as a cheap check.

---

## 10. Task list

- [x] ✅ 0. Merged `origin/main` (up to date) and `origin/feature/data-export-de9` (`e7fbc24a`, PR #454) into `feature/data-export-de10a`; §1 re-verified against the merged code (DE-9 names unchanged: `findLatestCompletedForUser`, `lib/client/businessOsDataExport.ts`)
- [x] ✅ 1. Repository: §6.1, 6.2, 6.3, 6.5 + tests T-18, T-19
- [x] ✅ 2. `runZipExport` step 9 kind + T-20; `exportSweep` placement + T-15 (incl. the unknown-kind case, W10-6)
- [x] ✅ 3. `downloadName.ts` (pure move) + test; owner download route uses `findOwnerJobById` + T-17
- [x] ✅ 4. `adminExportAudit.ts` builders + T-14, T-16
- [x] ✅ 5. Admin status + prepare route + tests
- [x] ✅ 6. Admin download route + tests (T-6, T-12, T-13)
- [x] ✅ 7. Gate oracle entries (65 → 68); `test:authz-guard` green
- [x] ✅ 8. Migration source pin T-21; T-22: the drift tests did not assert the export bucket in the 20261075 storage count / listing, so one assertion was added (W10-8)
- [x] ✅ 9. `dataExportCopy.ts`, `DataExportReasonDialog.tsx`, `DataExportBlock.tsx`, `DrawerBox` key, mount in `BusinessDetail` + T-23…T-29
- [x] ✅ 10. Layout and source-guard test updates + T-30
- [x] ✅ 11. Local verification (§9); `git diff --numstat` reviewed (no deletion-only file)
- [x] ✅ 12. Requirement §0.15 splice; workplan status → Code Complete; changes left **uncommitted**

### Implementation notes (Dev, 2026-10-17)

**Deviations from the plan, each small:**

| # | Plan said | Built | Why |
|---|---|---|---|
| D-1 | `DataExportJobRef` gains `requested_by_kind` | A new `DataExportSweepRef extends DataExportJobRef` with `requested_by_kind`, returned by the two sweep reads; `DataExportJobRef` / `DataExportJobState` (the orphan sweep's `findJobsByIds`) unchanged | Keeps the orphan read's select and its pinned test unchanged |
| D-2 | Purpose line "This account's exports. Prepare one, or download a ready one; every admin download is recorded with your name and reason." | "This account's exports; admin downloads are recorded with your name and reason." | `drawerBox.render` DB-3 pins every purpose line at 1 to 12 words |
| D-3 | Status GET payload as §5.1 | Adds `isOwnAccount` (BC-6) | The box hides its actions on the admin's own account from the server's answer, the CreditsBlock pattern |
| D-4 | Download 200 `{ downloadUrl, fileName, asciiFileName, expiresAt }` | Adds `linkSeconds: 60` | The success line says "one minute" from the policy, not a literal |
| D-5 | `ownerDownloadedLatest` from the list | From the list's newest delivered owner export; when a full page of 10 holds none, one extra `findLatestCompletedForUser` read | BC-4 must not say "never exported" because ten admin jobs pushed the owner's out of the page |
| D-6 | (not in plan) | `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts`: the prepare route and its test added to the R-4 allow-list | The prepare reads the target's identity (`findUserIdentity`, path id, admin-gated), as AD-1b / AD-2a do; the guard rightly asked for it to be argued |
| D-7 | (not in plan) | `ExportContext.userId` doc comment in `sections.ts` now names the admin path | The comment said "always getUser().id", no longer true |
| D-8 | Per-open read pins | `businessDrawer.pins.dangerReads` READS-1…4 gain the one status read (nine → ten, seven → eight); the whole-page render tests gain one route-table line for it | The box reads once per open for every login (BC-5); a new request is the intended change, not drift |

**Not done (SA optimisation, non-blocking):** the download route does not count its 404 / 410 answers in the `failure` throttle bucket. The write rule (20 per 5 min) already bounds probing.

**`console.*` check:** none of the modified files use `console.*`.

## SA Review Notes

_SA populates._

### SA workplan review DE-10a — 2026-10-17

**Reviewed by SA — 2026-10-17**
**Status:** ✅ Approved with conditions (W10-1 to W10-12 below are binding on the implementation and checked at code review)

**Verified against the code** (`origin/main` `4e10ebba` + the `neuronforge-de9` worktree): `requireAdmin(logger)` in `lib/admin/requireAdminRoute.ts`; `startForAdmin`, `findById`, `listForUser({ limit })`, `markOwnerDownloaded`, `expireOtherReady(userId, keepJobId)` (no kind today), `listDueForExpiry` / `listStaleRunning` in the job repository; `EXPORT_JOB_POLICY.ADMIN_SIGNED_URL_TTL_SECONDS = 60`; `DATA_EXPORT_DOWNLOADED_BY_ADMIN` metadata `critical` + `['GDPR','SOC2']`; `buildLogEntry` `user_id = userId || SYSTEM_ADMIN_USER_ID || null`, `actor_id = actorId || userId || SYSTEM_ADMIN_USER_ID || null` (D-7); `/api/admin/health-summary` counts `severity = 'critical'` with no user filter; 20261075 cleanup counts and deletes `business-data-exports` objects under `{user_id}/` and deletes `audit_trail` by `user_id` only; the cleanup's own outcome row is already `user_id = actor_id = admin`; owner audit readers are exactly the RLS policy (TL §13.1) and `listOwnerEntries` / `countOwnerActionsSince` (both `.eq('user_id')`), kept closed by `lib/audit/__tests__/ownerAuditReads.guard.test.ts`; the zip reads no audit rows (DX-1d); `rateLimit` keys `ok|fail:{route}:{hashed caller}`.

#### Rulings

| # | Ruling |
|---|---|
| SA-1 | **Approved: admin-owned rows** (`userId = actorId = admin`, `entityType 'user'`, `entityId = target`, `details.target_user_id`) satisfy Q-8's "otherwise proven hidden" branch. Proof is two-sided and both sides are verified: (a) the only non-service SELECT policy is `auth.uid() = user_id AND …` (TL §13.1, no other policy); (b) every in-app owner reader filters `.eq('user_id', <session id>)` and the guard test forbids a new one. It matches the platform's established admin-on-target placement (AD-1b, AD-2a, the 20261075 cleanup outcome row), survives the target's purge and hard delete (both scope `audit_trail` by `user_id`), and needs no migration or release window. Coverage confirmed for **every** row about an admin job: REQUESTED, READY, FAILED (route), replaced EXPIRED (route; with BC-3 only admin jobs are ever replaced by an admin run), cron reap FAILED and retention EXPIRED (SA-2), DOWNLOADED_BY_ADMIN; and, with BC-3 + §4.1, the owner route can no longer write an owner-visible EXPIRED row about an admin job. No operator entity type |
| SA-2 | **Approved:** cron rows on admin-kind jobs `userId: null, actorId: null`, `details.actor_kind 'system'`, `requested_by_kind 'admin'`, `target_user_id`. Stored `user_id` is NULL or `SYSTEM_ADMIN_USER_ID`, never the owner and never the requesting admin (writing `requested_by` would forge an admin action through D-7). Owner-kind rows unchanged |
| SA-3 | **Approved:** `AuditTrailService` untouched. D-7 is **closed for admin-path rows** by explicit `actorId = adminId` on every input (T-14). "Explicit null means no actor" stays open as its own follow-up across the four null-actor callers; record it in §0.15 |
| SA-4 | **Approved:** `expireOtherReady(userId, keepJobId, kind)`; `kind` comes from the row `markReady` returned, never a `runZipExport` parameter; an invalid kind is an error before any query (T-19/T-20) |
| SA-5 | **Approved:** `findOwnerJobById` (owner route, kind `'owner'`), `findById` unchanged for the admin route and the engine re-read; `markOwnerDownloaded` gains the owner-kind filter. Owner download-again on an admin job id = 404, no 410 hint, no audit, no sign (T-17) |
| SA-6 | **Approved:** `downloadName.ts` as a pure move; the owner route's file-name output must be byte-identical (keep the existing owner name assertions, do not rewrite them) |
| SA-7 | **Approved:** sign failure after a written DOWNLOADED_BY_ADMIN → 500, no compensating row; the row means "an admin was authorised and the link was requested". Log the failure with `jobId`, `targetUserId`, `correlationId` (never the path or URL) |
| SA-8 | **Approved:** status GET unaudited (metadata only, like the drawer's other reads); REQUESTED non-blocking `log().catch()` per §0.4.1 B; READY / FAILED via `logAndFlush`. DOWNLOADED_BY_ADMIN is the only write-ahead (`writeNow`) row |
| SA-9 | **Approved:** sixth boxed section `export` between Activity and `danger-area`, at the user's request; BD-4 and the L-12 "five groups" pins amended to six in the same PR (layout standard), danger area still last, purpose line straight after the heading, six `role="group"`, L-12f (non-BOS login) also six |
| SA-10 | **Approved:** prepare returns no URL; the download route is the only admin URL minter (T-10) |
| SA-11 | **Approved with one change:** status `admin-data-export-status` on `RATE_LIMITS.read`; prepare `admin-data-export-start` on `RATE_LIMITS.create`; **download `admin-data-export-download` on `RATE_LIMITS.write`** (not `read`): every call writes a critical row and raises the Health tile, so 120 per 5 min is too loose for an operator action. Throttle after `requireAdmin` (the gate stays the first statement) |

**§14.1 TL defaults confirmed** (BC-1 to BC-8). Each is consistent with the binding inputs: BC-1/SA-10 make every admin download pass the write-ahead row; BC-2 is DX-7; BC-3 is required for SA-1 completeness; BC-4 is informational and never gates the Danger area (§0.4.1 H); BC-6 is enforced server-side; BC-7 is the accepted cost of SA-1; BC-8 is DX-4. Accepted side effect, recorded for the user in §0.15: because DX-4 shares the limit, an owner can infer that *something* used their daily allowance or is running (409 `in_progress` / `daily_limit` on their own start). That reveals no admin identity, reason or file and is not an owner notice in the BQ-SA-2 sense; no change.

#### Conditions (binding)

1. **W10-1 Gate.** `requireAdmin(logger)` is the first statement of all three handlers (GET, POST prepare, POST download), nothing awaited before it; all three registered in `adminGate.writes.test.ts` and green under `npm run test:authz-guard`. No hand-rolled `AdminAccessService`, no `profiles.role`.
2. **W10-2 Ids.** Target id from the path only (Zod uuid, lower-cased), `jobId` Zod uuid, `partNo` literal `'1'`; admin id from `gate.user.id` only. Bodies `.strict()` `{ reason: trim().min(5).max(500) }`. No id is ever read from body, query or header (T-3, T-4, T-7).
3. **W10-3 Download order is fixed:** gate → path → body → throttle → own-account 403 → `findById(jobId, targetId)` (404 for another account's job) → 410 for not-ready/expired → `writeNow` DOWNLOADED_BY_ADMIN (`severity 'critical'` passed explicitly, complianceFlags, reason) → `written === false` or throw → 503 `audit_unavailable`, nothing signed → file name → `sign(targetId, jobId, ADMIN_SIGNED_URL_TTL_SECONDS)` → 200. T-12 proves the order with one ordered call log, and the 503 branch proves `sign` is never called. `markOwnerDownloaded` is not imported by the admin route (source pin, not only a mock assertion).
4. **W10-4 Single placement builder.** Every admin-route audit input is built by `adminExportAudit.ts`; neither route constructs an `AuditLogInput` inline (source pin). T-14 covers every branch including the replaced-EXPIRED loop; it asserts `userId !== targetId` **and** `actorId === adminId` on each. The builder must not contain the `audit_trail` literal (the owner-read guard would correctly fail).
5. **W10-5 No secrets in records.** URL, signed token, object path, file name, business name and email never appear in any log or audit call on the admin path (T-13 scans every logger and audit mock call).
6. **W10-6 Sweep.** `exportSweep.ts` placement keyed on the ref's `requested_by_kind`; an unknown/missing kind is treated as admin placement (null/null), never as owner placement, so a schema surprise fails toward hidden. T-15 covers both kinds and the unknown case.
7. **W10-7 Owner route.** Switch to `findOwnerJobById` and the shared `downloadName.ts`; existing owner tests stay green unmodified except where they name the repository method.
8. **W10-8 Hard delete pin (T-22).** Dev first checks whether the 20261075 drift test already asserts `business-data-exports` in both the storage count and the delete; add only the missing assertion. No SQL change.
9. **W10-9 Health.** Add one assertion (route test or builder test) that the DOWNLOADED_BY_ADMIN input carries `severity: 'critical'`, which is what the unfiltered Health count needs. No Health code change.
10. **W10-10 UI.** Admin dark tone only; `isSafeDownloadUrl` before navigation; one GET per drawer open; no `console.*`; the box never disables or hides anything in the Danger area (T-30 asserts the danger area's controls are unchanged).
11. **W10-11 No new infrastructure.** No migration, flag, dependency, CI job or step; tests run in the existing Tests and authz-guard jobs. Scoped `tsc --noEmit` on touched files clean.
12. **W10-12 Requirement splice (§0.15).** Record: SA-1 placement (supersedes nothing; §0.3.4 already says `user_id = admin`), SA-11 change, BD-4 → six sections, BC-7, the DX-4 side effect above, and the two follow-ups below.

#### Follow-ups (not DE-10a scope; record in §0.15)

- **F-1 (Medium, pre-existing class).** Admin-owned rows live under the admin's `user_id`, so the admin's **own** Purge "activity history" option (`descriptors.ts`, scope `user_id`) or a hard delete of the admin's own account would delete the record of their admin actions on other accounts. This already applies to AD-1b, AD-2a and the cleanup outcome rows. Purge is inert today; resolve before Purge goes live (for example, exclude rows where `entity_id <> user_id` and the action is an admin action, or move admin-on-target rows to `user_id NULL`, `actor_id = admin`). Platform-wide decision, not a DE-10a blocker.
- **F-2 (Low).** The admin sees these rows in their own `/monitoring` (target id and reason in `details`). It is their own action, same as AD-1b; revisit with F-1.
- **F-3.** D-7 "explicit null means no actor" (SA-3).

#### Optimisation suggestions (non-blocking)

- Consider `rateLimit(..., 'failure')` on the download route's 404/410 answers so job-id probing hits the failure bucket, as the token routes do.
- `requestedByShort` for admin jobs: keep the derivation in the route mapper, not the client, so no full admin id reaches the browser.

### Approval
[x] Workplan approved — proceed to implementation **after DE-9 merges** (task 0), subject to W10-1 to W10-12.

### SA code review DE-10a — 2026-10-17

**Code Review by SA — 2026-10-17**
**Status:** ✅ Code Approved

**Verified locally (worktree `neuronforge-de10a`, uncommitted):** the touched suites (65 suites, 1888 tests) plus both download-route suites (53 tests) green; `npm run test:authz-guard` green (203); scoped `tsc --noEmit` over the three admin routes, the owner download route, `adminExportAudit.ts`, `downloadName.ts`, `exportSweep.ts`, `zipExport.ts`, `DataExportBlock.tsx`, `BusinessDetail.tsx`: 0 errors. No `console.*` in any touched file (the one grep hit is the word "console" in a `dataExportCopy.ts` comment). No migration, flag, dependency, CI job or step. Requirement diff is insert-only (+55/−0).

#### Conditions check

| # | Result |
|---|---|
| W10-1 | ✅ `requireAdmin` is the first statement of GET, POST prepare and POST download; nothing awaited before it (route tests assert the order log starts `getUser, isAdmin`); three handlers in `adminGate.writes` (65 → 68, comment updated) |
| W10-2 | ✅ Target from the path (Zod uuid, lower-cased), `jobId` uuid, `partNo` literal `'1'`, `.strict()` path schema; admin from `gate.user.id`; bodies `.strict()` `{ reason: trim().min(5).max(500) }`; injected `userId` / `jobId` → 400 before throttle or any read |
| W10-3 | ✅ Download order exactly gate → path → body → throttle (`RATE_LIMITS.write`, SA-11) → own-account 403 → `findById(jobId, targetId)` → 410 → `writeNow` (critical) → 503 `audit_unavailable` on `written !== true` **or** a throw, nothing signed → `exportDownloadNames` → `sign(…, 60, …)` → 200. Ordered call-log test plus a source-order pin. `markOwnerDownloaded` absent from the route source, comments included (pin) |
| W10-4 | ✅ Every admin-route input built by `adminExportAudit.ts`, through one `placed()` helper: `userId = actorId = admin`, `entityType 'user'`, `entityId = target`, shared fields spread **last** so no detail can overwrite `target_user_id`. Inline-construction source pins on both routes; no `audit_trail` literal in the builder (pinned) |
| W10-5 | ✅ No URL, token, path, file name, business name or email in any logger or audit mock call (scans in both route tests); `downloadName.ts` warns with ids only |
| W10-6 | ✅ `isOwnerJob` is an exact `=== 'owner'`; anything else (missing included) → `userId: null, actorId: null`, `target_user_id`, `requested_by_kind 'admin'`; `it.each` covers the unknown cases; owner rows byte-for-byte as DE-8b |
| W10-7 | ✅ Owner route on `findOwnerJobById` and the shared name helper; `downloadName.ts` is a pure move (same reads, same `Promise.all`, same fallback, same warn text), existing owner name assertions untouched |
| W10-8 | ✅ One missing assertion added (export bucket in the 20261075 storage count/listing); no SQL change |
| W10-9 | ✅ `critical` asserted on the DOWNLOADED_BY_ADMIN input (builder and route), and "only the downloaded row is critical" |
| W10-10 | ✅ Dark tone only, `isSafeDownloadUrl` before `browserNavigation.assign`, link never logged or kept in state, one GET per open (mounted inside the open drawer, `key={user.id}`), the box renders nothing into `danger-area` |
| W10-11 | ✅ See above |
| W10-12 | ✅ §0.15 records SA-1, SA-11, BD-4 → six, BC-7, the DX-4 side effect, F-1 … F-3 |

#### Rulings on the items raised

| Item | Ruling |
|---|---|
| D-1 `DataExportSweepRef` | ✅ Accepted: narrower than widening `DataExportJobRef`, leaves the orphan read and its pin unchanged |
| D-2 purpose line | ✅ Accepted; DB-3's 12-word rule wins over the workplan's wording |
| D-3 `isOwnAccount` | ✅ Accepted; computed server-side from the session, display only, the server refuses regardless (BC-6) |
| D-4 `linkSeconds` | ✅ Accepted |
| D-5 extra `findLatestCompletedForUser` | ✅ Accepted: owner-kind filter already in that method; a read error is a 500, never a false "not downloaded" |
| D-6 R-4 allow-list | ✅ Accepted: one account's identity, for an admin-gated path id, identity error/no `createdAt` → 500 (never 404); same justification as AD-1b / AD-2a; the email goes into the zip only, never a log/audit row (route test) |
| D-7 `ExportContext` comment | ✅ Accepted |
| D-8 read-count pins +1 | ✅ Accepted: the new request is the intended change (BC-5), pinned rather than loosened |
| SA-9 six sections | ✅ Layout tests pin six boxes in order, six groups, Data export immediately before `danger-area`, danger last |
| Replaced EXPIRED row | ✅ Correct: with BC-3 the replaced jobs are admin-kind only; the row sits on the admin whose run replaced them (they caused it), `replaced_by_job_id` set, target as entity. Owner runs can no longer write an EXPIRED row about an admin job |
| `request` on admin rows (IP/UA) | ✅ Acceptable: it is the **admin's** request metadata on an **admin-owned** row, the owner cannot read it, and it matches AD-1b / AD-2a admin rows. It is useful evidence for a critical action |
| Download `expiresAt` = export expiry | ✅ Acceptable: same meaning as the owner route's `expiresAt` (consistency wins), and the link lifetime is carried separately by `linkSeconds`. Optional rename only if a later slice touches both routes |

#### Code Review Comments

None blocking.

#### Optimisation Suggestions (non-blocking)

- Prepare route: if `runZipExport` itself threw (outside its own failure invariant), the outer catch answers 500 without an admin FAILED row; the job is left `running` and the cron reaps it with a null/null row. Acceptable; a `logAndFlush` of `adminExportFailedEntry` in that catch (when `jobId` is known) would close the evidence gap.
- Still open from the workplan review: count the download route's 404/410 in the `failure` bucket.
- Copy says "recorded with your name"; the row stores the admin's id (resolved to a name in the Audit trail). Fine as wording.

### Code Approved for QA: Yes

## QA Testing Report

_QA populates. Manual check after deploy (TL): on `/admin/users`, open a test business: the Data export box sits directly above the Danger area; Prepare with a reason; Download with a reason opens the zip; the Health "Critical audit events" tile shows 1; signed in as that owner, `/monitoring` and the owner's "Last export" show nothing of it; owner "Download again" on the admin job id returns 404._

### QA — DE-10a — 2026-10-17

**Test mode:** full
**Strategy used:** A + B (Jest unit and route tests with mocked Supabase, storage and audit), mutation-style negative controls on a scratch copy, a full-suite before/after comparison. D (browser) not possible locally (the local env points at PROD); covered by the TL manual list below.
**Focus:** api, security, ui, schema
**Skipped:** live browser check (prod env); E2E (not installed)
**Input source:** TL prompt keywords

#### 1. Suites (worktree, uncommitted code)

| Run | Result | Time |
|---|---|---|
| New + touched suites (`app/admin/users`, `app/api/admin/users`, `adminGate.writes`, `lib/business-os/data-export`, `app/api/business-os/data-exports`, `lib/audit`, job repository, `authAccountRepository.callers.guard`, data-exports migration test) | ✅ 71 suites, 1,980 tests, 0 failed | 103 s jest (121 s wall) |
| `npm run test:authz-guard` | ✅ 2 suites, 203 tests | 56 s jest (90 s wall) |
| `npm run test:bos-entitlements` (no entitlements import; run anyway) | ✅ 285 suites, 8,625 tests | 158 s jest (172 s wall) |
| Scoped `tsc --noEmit` (28 touched / new files) | ✅ 0 errors in any touched file (68 pre-existing errors in unrelated transitively imported files: Stripe invoice, website blocks, embeddings) | 60 s |
| `.github/` | ✅ unchanged; no new job or step | — |

#### 2. Full `npx jest --ci` against the DE-9 baseline

Baseline: `git archive origin/feature/data-export-de9` (`e7fbc24a`) + `git init`, outside the worktree.

| | Suites | Failed suites | Tests | Failed | Passed | Skipped | Wall |
|---|---|---|---|---|---|---|---|
| Baseline DE-9 | 1,532 | 20 | 38,573 | 140 | 38,368 | 65 | 1,070 s |
| DE-10a | 1,537 | 20 | 38,746 | 140 | 38,541 | 65 | 1,074 s |

**New failures caused by DE-10a: 0.** The failing sets are identical by suite and full test name (0 new, 0 fixed). +5 suites / +173 tests, all of them the new DE-10a files. The 140 shared failures are pre-existing (V4/V6 agentkit, pilot transforms, TokenBudgetManager, plugin integration suites that need credentials, a few CRM / onboarding guards). None is in data export or admin.

#### 3. Negative controls (scratch copy; each mutation reverted before the next)

| # | Mutation | Result |
|---|---|---|
| a1 | GET: a repository read before `requireAdmin` | ✅ red (12: T-1/T-2 + source pin) |
| a2 | Download: body read before `requireAdmin` | ✅ red (source pin "requireAdmin is the first statement") |
| a3 | Download: `requireAdmin` removed | ✅ red in each of three places on its own: route tests (25), authz-surface R1, gate oracle (4) |
| a4 | Download case removed from the gate oracle (count lowered to 67) | ⚠️ green. Nothing notices an admin handler that is missing from the oracle. **Pre-existing, documented gap** in the hand-registered oracle (`admin-authz-surface.guard` "KNOWN GAPS"). R1 and the route tests still catch a missing gate (a3). Not a DE-10a defect |
| b1/b2 | `.strict()` dropped on the prepare / download body (body `userId`, `targetUserId`, `jobId`) | ✅ red (3 / 2) |
| b6 | GET target from `?userId=` | ✅ red |
| b4/b5 | Prepare / download target from `?userId=` | ⚠️ green. No POST test sends a query id (Edge case 1). The code is correct today |
| c1 | Download `findById(jobId, adminId)` (not the path account) | ✅ red (T-6 + order) |
| c3 | Repository `findById` without the user filter | ✅ red (4) |
| c2 | `sign(job.user_id, …)` | green, but an equivalent mutant (the job is already scoped to the path id) |
| d1 | `sign` before `writeNow` | ✅ red (5) |
| d2 | `written === false` ignored (signs after an audit failure) | ✅ red (2: not written, and throw) |
| d3 | `writeNow` throw treated as written | ✅ red |
| d4 | `writeNow` swapped for the queued `log` | ✅ red (7) |
| e1 | `markOwnerDownloaded` called from the admin route | ✅ red (order + source pin) |
| e2 | `markOwnerDownloaded` loses the owner-kind filter | ✅ red |
| f0 | Builder sets `userId = target` / omits `actorId` | ✅ red (12 / 10) |
| f (×5) | One branch at a time placed on the owner: REQUESTED, READY, FAILED, replaced EXPIRED, DOWNLOADED_BY_ADMIN | ✅ each red (builder T-14, T-16, and the route's every-branch test) |
| f | Route overrides the replaced row with `userId: target`; route base `adminId = target` | ✅ red (1 / 4) |
| f | Sweep: admin job row on the owner; unknown kind placed as owner; actor = the job's user | ✅ red (5 / 3 / 5) |
| g1 | Owner reader uses `.or(user_id, entity_id)` instead of `.eq('user_id')` | ✅ red (6: T-16, ownerAuditReads, repository) |
| h1 | Owner download route back on `findById` | ✅ red (9) |
| h2 | `findOwnerJobById` loses the kind filter | ✅ red (repository T-18) |
| i1 | `expireOtherReady` loses the kind filter | ✅ red (2) |
| i2/i3 | `runZipExport` passes a constant `'owner'` / `'admin'` | ✅ red (3 / 2) |
| i4 | Invalid kind reaches the database | ✅ red |
| j1/j2/j6 | URL / file name in the download success or sign-failure log | ✅ red |
| j3 | File name in a second audit call | ✅ red (4) |
| j4/j5 | Email in a prepare log / in the REQUESTED row | ✅ red |
| k1/k2/k4/k5 | A 4-character or 501-character reason accepted (prepare, download) | ✅ red |
| k6 | Download without `.trim()` | ✅ red |
| k3 | Prepare without `.trim()` | ⚠️ green (Edge case 2) |
| l1/l2/l3 | Own account allowed (prepare, download); case-sensitive own-account check | ✅ red |
| m1/m2 | Download on `RATE_LIMITS.read` / under the wrong key | ✅ red |
| m3/m4 | Prepare not on `create`; status not on `read` | ✅ red |
| n1/n2 | Data export box above Activity (added / moved) | ✅ red (13 / 6) |
| n3 | Box after the Danger area (danger not last) | ✅ red (6, incl. DANGER-1) |

#### 4. Edge cases

| Case | Result |
|---|---|
| Account with no exports | ✅ "No exports yet." (T-23). GET with no owner job gives `ownerDownloadedLatest: false`, so the warning shows (BC-4 "never exported") |
| Non-BOS login layout | ✅ L-12f: six boxes including Data export (BC-5) |
| Owner never downloaded → warning; downloaded → hidden; own account → no warning | ✅ T-24, T-28 |
| Daily limit (admin counts toward 3/day) | ✅ The start function has no kind predicate (T-21 migration pin). The route returns 409 `export_daily_limit` with `retryAt`. The UI shows its sentence with the UTC time, plus the limit note "Up to 3 exports per 24 hours … the owner's and admins' together" |
| Expired job → 410 | ✅ `expired` / `failed` / `running` status and a past `expires_at` all give 410, with no audit and no sign |
| D-5: 10 admin jobs push the owner's out of the page | ✅ One extra `findLatestCompletedForUser` read; if it errors, a 500 |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. No added CI time (Jest only, in existing jobs).

**Edge cases (nice to fix, Low):**
1. **POST query-id injection is untested** (W10-2 "never from query"). The GET has a `?userId=` test; the prepare and download POSTs do not, so a future change that reads `searchParams` would pass (b4/b5). Add one `?userId=<other>` case to each POST test, asserting the path id is used.
2. **Prepare with a whitespace-padded reason is untested.** Removing `.trim()` from the prepare schema stays green (k3); the download test has this case. Add `'     '` / `'  abc  '` to the prepare T-4 table.
3. Cosmetic: the daily-limit sentence reads "has used its exports of the last 24 hours"; the number appears only in the limit note. Consider "its 3 exports", from `dailyLimit`.
4. Pre-existing (not DE-10a): the gate oracle is hand-registered, so an admin handler missing from it goes unnoticed (a4).

#### Manual check list (TL, after deploy): Dev's list confirmed, plus additions

Dev's list (above) covers placement, prepare, download, the Health tile, the owner's `/monitoring`, the owner's "Last export", and owner download-again 404. **Add:**
- After the admin download, the box row still says *Not downloaded by the owner* (the admin path sets no `owner_downloaded_at` stamp).
- `/admin/audit-trail` shows `DATA_EXPORT_DOWNLOADED_BY_ADMIN` (critical) and `DATA_EXPORT_REQUESTED` under the **admin's** user, with the reason and `target_user_id`. The business's drawer **Activity** does not show them (BC-7).
- If the owner had a ready export before the admin prepared, the owner can still download it (BC-3).
- On the admin's own account the box shows only the pointer line; on a non-Business OS login the box is present.
- The download link stops working after about one minute.

#### Final Status
- [x] All acceptance criteria pass, ready for commit (no High or Medium bug; two Low test gaps for Dev to fix or not)
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM populates._

---

## 11. Business calls (TL defaults)

Plain business terms; each is a default the TL may apply in the autonomous run, user may change.

| # | Question | Default |
|---|---|---|
| BC-1 | Is preparing and downloading one action or two? | **Two:** "Prepare export" (with a reason), then "Download (audited)" (with a reason, pre-filled from the prepare). Every download goes through the same recorded step |
| BC-2 | May an admin download an export the **owner** made (still within its 3 days), not only one an admin prepared? | **Yes**, recorded the same way (DX-7: admins may download an account's export) |
| BC-3 | Should an owner's new export and an admin's new export replace each other? | **No.** Each replaces only its own kind, so neither side silently deletes the other's file. An account can hold two ready files for up to 3 days |
| BC-4 | When does the box warn "the owner has not downloaded an export…"? | Whenever the owner's **most recent** own export was not downloaded by them, or they never exported. Shown in the Data export box (above the Danger area). The hidden AD-2 delete preview gets its line when AD-2 is switched on (follow-up) |
| BC-5 | Show the box for a login that has no Business OS business? | **Yes**: their export still holds their profile details |
| BC-6 | May an admin use the admin path on their **own** account? | **No**: it is refused; they use "Download my data" like any owner |
| BC-7 | Must an admin download appear in that business's **Activity** list in the drawer? | **No**: it is in the Audit trail and raises the Health page flag (B-2). (Choosing "yes" means a database policy change, +0.5 day) |
| BC-8 | (Consequence, already decided by DX-4) An admin's prepared export uses one of the owner's 3 exports per day | Noted for the user; no new decision |

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| SA-1 | Q-8: accept **admin-owned rows** (`user_id = actor_id = admin`, `entity_type 'user'`, `entity_id = target`; AD-1b / AD-2a / §0.3.4 placement) as the "otherwise prove hidden" branch, extended to every row about an admin job, instead of a new operator entity type + owner-policy migration? | Yes (§3.2): no migration, no release window, survives account deletion. Supersedes nothing in §0.3.4 (it already says `user_id = admin`) |
| SA-2 | Cron rows on admin jobs: `userId: null, actorId: null` (invites N-6 precedent) rather than `userId = requested_by` (which would show a system expiry as the admin's action through the D-7 fallback)? | Yes (§3.3) |
| SA-3 | D-7: no `AuditTrailService` change in DE-10a (admin rows always carry an explicit `actorId`, pinned by T-14). Close D-7 for admin rows, and open "explicit null means no actor" as its own follow-up touching the four null-actor callers? | Yes |
| SA-4 | `expireOtherReady(userId, keep, kind)` with the kind read from `markReady`'s returned row, never a parameter of `runZipExport`? | Yes (§4.2) |
| SA-5 | `findOwnerJobById` as a separate method (owner route) and `findById` unchanged (admin + re-read), plus the owner-kind filter on `markOwnerDownloaded`? | Yes (§4.1) |
| SA-6 | Extract `downloadName.ts` from the owner download route (pure move) so both routes name the file one way? | Yes (§6.4) |
| SA-7 | Sign failure after a written `DOWNLOADED_BY_ADMIN`: 500 with no compensating row (AD-2a STARTED-without-outcome precedent), the row meaning "an admin was authorised to download"? | Yes; the log carries ids |
| SA-8 | The status GET is not audited; the admin `REQUESTED` stays non-blocking (§0.4.1 B); READY / FAILED use `logAndFlush` | Yes |
| SA-9 | BD-4 / L-12 amendment: a sixth boxed section between Activity and the Danger area; the "five groups" pins become six | Yes (user request) |
| SA-10 | Prepare returns no URL, so §5.3 is the only admin URL minter | Yes (§5.2) |
| SA-11 | Throttle keys `admin-data-export-status` (read), `admin-data-export-start` (create), `admin-data-export-download` (read), on the existing `rateLimit` | Yes |

---

## 13. Read-only SQL for TL

Optional, PROD, read-only, before SA review. Expected results in comments.

**File:** run in the Supabase SQL editor

```sql
-- Q1: no admin-kind job exists yet, so kind-scoped replacement and the sweep
-- change affect no existing row. Expected: 0.
SELECT count(*) AS admin_jobs
FROM public.business_os_data_exports
WHERE requested_by_kind = 'admin';

-- Q2: no audit row about an admin export exists yet. Expected: 0.
SELECT count(*) AS admin_export_rows
FROM public.audit_trail
WHERE action LIKE 'DATA_EXPORT%'
  AND (action = 'DATA_EXPORT_DOWNLOADED_BY_ADMIN' OR details->>'requested_by_kind' = 'admin');

-- Q3: the owner audit policy still reads by user_id first (the proof in §3.2).
-- Expected: one row whose qual starts with (auth.uid() = user_id).
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'audit_trail'
  AND policyname = 'Users can view their own audit logs';

-- Q4: no other SELECT policy on audit_trail lets an authenticated user read
-- rows that are not their own. Expected: review every row; none without a
-- user_id or admin predicate.
SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'audit_trail' AND cmd IN ('SELECT', 'ALL');
```

---

## 14. Effort, risk, rollout

**Effort:** 🟡 about **2 days** (requirement estimate 1.5 d; +0.5 d for the two C-4 notes, the sweep placement and the six-section layout pins). +0.5 d if SA picks the operator entity type (SA-1).

**Risks:**

| Risk | Mitigation |
|---|---|
| An admin-path row lands on the owner's `user_id` | One builder module; T-14 over every branch; T-15 for the cron |
| Owner reaches an admin job | `findOwnerJobById` (T-17); status route already owner-only |
| A download without a record | Write-ahead `writeNow` before `sign`, 503 otherwise (T-12) |
| Layout pins drift | Updated in the same PR; T-30 |
| DE-9 changes names before merge | Task 0 re-verifies §1 after the merge |

**Rollout:** no migration, no env flag, no new dependency. Merging is the switch (as DE-9). The routes are admin-only from birth. Post-deploy: the TL manual check in the QA section.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Workplan created | Dev, against origin/main `4e10ebba` + the DE-9 worktree end state; awaiting SA workplan review |
| 2026-10-17 | Code complete (Dev) | Built on `origin/feature/data-export-de9` `e7fbc24a` (PR #454; this PR merges only after #454 lands on main). Tasks 0–12 done; deviations D-1…D-8 in the implementation notes; uncommitted, awaiting SA code review |

### 13.1 TL results — 2026-10-17 (read-only, prod)
| Q | Result |
|---|---|
| Q1 admin-kind jobs | **0** |
| Q2 audit rows with action LIKE 'DATA_EXPORT%' | 7 (owner-side, incl. legacy DATA_EXPORTED from the JSON route) |
| Q3/Q4 audit_trail SELECT policies | exactly two: `Users can view their own audit logs` [public] = `auth.uid() = user_id AND (entity_type IS NULL OR entity_type NOT IN ('ai_action','bos_queue_item','business_os_account_plan','business_os_credit_lot','business_os_credit_period'))`; `service_role_bypass_rls` [service_role] = true. **No policy lets a user read rows whose user_id is not theirs** → admin-owned rows (user_id = admin) are invisible to the owner; SA-1 premise holds |

### 14.1 Business calls — TL defaults 2026-10-17 (autonomous run; user may change)
All Dev defaults accepted: BC-1 two steps (prepare, download), each with a reason; download reason pre-filled; BC-2 admin may download an owner-made ready export (audited); BC-3 owner and admin exports don't replace each other; BC-4 "owner has not downloaded an export" warning in the new box (delete-preview line waits for AD-2); BC-5 box shown for every login; BC-6 admin can't use the admin path on their own account; BC-7 admin downloads NOT in the business's Activity list (Audit trail + Health tile only); BC-8 admin-prepared export uses one of the owner's 3/day (DX-4).
