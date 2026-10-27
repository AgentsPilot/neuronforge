# Workplan: Business OS Export — MX-1b (E5) Request route, export drawer, "Export requested" email, switch

> **Last Updated**: 2026-10-27

**Developer:** Dev (EXPORT session)
**Step:** E5 (user's numbering) = doc slice MX-1b
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §3 (what the owner sees), §4.3, §4.4, §4.5 (BQ-35 answered: files are not exported), §6.2 MX-1b, §7 MX-1b, §10 XC-8, XC-13, XC-15, XC-19, XC-21, §11 (B.1, S-4, S-5, S-7, S-8, S-17, B.6, B.7, B.8), `## SA Split Review — 2026-10-25` (SR-2, SR-9, SR-10, SR-11)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §2, §3 (CC-1, CC-5, CC-6, CC-7, frozen interfaces, hotspot anchors), §4.5, §5, §7
**Previous slice:** [BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md) (§3.1 to §3.5 tables and start function, §4.2 / §4.3 repositories, SA MX1A-11, MX1A-12, MX1A-16, SA code review comments 1 and 2, QA finding 1)
**Coordination:** `C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md`: E5 row started 2026-10-27. No lock, no migration number, no S-10 claim (this slice sends no attachment and needs no idempotency key, §2 D-9)
**Branch:** `feature/bos-export-mx1b-route-drawer` (RM-created from `origin/main` `4e75ed9f`, which holds MX-0 #515, MX-2a #531 and MX-1a #533; 20261095 and 20261096 are applied on prod). Dev confirmed it with `git branch --show-current` on 2026-10-27 before writing this file
**Worktree:** `neuronforge-mx1b`
**Date:** 2026-10-27
**Status:** Code Complete (2026-10-27), uncommitted, awaiting SA code review and QA. SA workplan review ⚠️ approved with conditions C-1…C-12 (all addressed, see Implementation notes). BQ-E5-1, BQ-E5-2 and BQ-E5-3 answered by the user on 2026-10-27

---

## Overview

MX-1b is the first slice an owner could see, and it ships switched off. It adds a request route: an owner ticks modules, the route checks them against the MX-0 module map, and it calls the MX-1a database start function, which holds the daily limit. The route also reads the export history. It adds the export drawer (a tick box per module, Select all, the files sentence, the "started" sentence and a history list), the one "Export requested" email, and a new server-only switch, `isModuleExportEnabled()`, which is off by default. Finally, it makes the existing `DownloadMyDataButton` open the drawer when the switch is on. Settings, the Danger Zone, the AgentPilot security tabs and DELETE's deletion drawer then switch over without anyone editing them (SR-9). While the switch is off, both new route methods answer 404, and the button does exactly what it does today: it builds the ZIP. There is no migration, no worker and no module email. The module jobs created in a local test stay `waiting` until MX-3.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Decisions and their reasons](#2-decisions-and-their-reasons)
3. [The switch](#3-the-switch)
4. [Route: `app/api/business-os/export-requests/route.ts`](#4-route-appapibusiness-osexport-requestsroutets)
5. [History read and its tie-break](#5-history-read-and-its-tie-break)
6. [Repository additions](#6-repository-additions)
7. [The "Export requested" email](#7-the-export-requested-email)
8. [Browser seam: `lib/client/businessOsDataExport.ts`](#8-browser-seam-libclientbusinessosdataexportts)
9. [`DownloadMyDataButton`: one entry, two paths](#9-downloadmydatabutton-one-entry-two-paths)
10. [The export drawer](#10-the-export-drawer)
11. [Copy (en / he / es)](#11-copy-en--he--es)
12. [Tests and guards](#12-tests-and-guards)
13. [Files to create / modify](#13-files-to-create--modify)
14. [Task list](#14-task-list)
15. [Acceptance criteria](#15-acceptance-criteria)
16. [QA plan](#16-qa-plan)
17. [Coordination](#17-coordination)
18. [Risks](#18-risks)
19. [Open items for SA](#19-open-items-for-sa)
20. [Business questions for the user](#20-business-questions-for-the-user)
21. [Implementation notes](#implementation-notes)
22. [SA Review Notes](#sa-review-notes)
23. [QA Testing Report](#qa-testing-report)
24. [Commit Info](#commit-info)
25. [Change History](#change-history)

---

## 1. Analysis summary

Read on the branch at `4e75ed9f`.

| Area | Today (on `main`) | MX-1b |
|---|---|---|
| Module map (MX-0) | `lib/business-os/data-export/exportModules.ts`: pure; `EXPORT_MODULE_IDS` (13, drawer order), `EXPORT_MODULES` with `{en, he, es}` names and `on`, `enabledModules()`, `isModuleEnabled()`. `exportModuleSchema.ts`: `ExportModuleIdSchema` and `requestedModulesSchema(map)` (min 1, max map length, no duplicates, every id switched on) | **Read only.** The route's body schema is `z.object({ modules: requestedModulesSchema() }).strict()`. The drawer lists `enabledModules()` |
| Tables (MX-1a, 20261095, live) | `business_os_export_requests` (`id`, `user_id`, `origin`, `admin_actor_id`, `modules text[]`, `requested_at`, `requested_email_sent_at`, `created_at`, `updated_at`); `business_os_export_module_jobs` (`request_id`, `user_id`, `module`, `status`, `parts`, `sent_at`, …). Server-write-only: RLS on, no policy | No schema change. MX-1b is the first writer of `requested_email_sent_at` (SA MX1A-11) |
| Start function | `business_os_export_request_start(uuid, text, uuid, text[])` → `started` / `in_progress` / `daily_limit` + `retry_at`. 2 per rolling 24 h, one not finished at a time, fully failed or interrupted not counted, per origin (BQ-29, XC-20) | Called once per POST through `startForOwner(sessionUserId, modules)` |
| `BusinessOsExportRequestRepository` | `startForOwner`, `startForAdmin`, `findByIdForUser` | **Add** `listRecentForUser` and `markRequestedEmailSent` (§6) |
| `BusinessOsExportModuleJobRepository` | `listHistoryForUser` (limits **job rows**, orders by `created_at` only, parses the whole page at once: SA code review comments 1 and 2, QA finding 1), `claimDue`, `reapStale` | **Add** `listForRequestsOfUser` (per-row parse); **remove** `listHistoryForUser` and its tests (no caller, wrong unit of limit; §5, MX1B-4) |
| Callers guard | `exportRequestRepositories.callers.guard.test.ts`: allow-list, MX-1b "adds the owner route" | Add the route file (and its test) to the two class rules only |
| Entry control | `DownloadMyDataButton` (props frozen, SR-2/SR-9), the hook `useDownloadMyData` (ZIP routes), copy `downloadMyDataCopy.ts` (own file, works outside a `LanguageProvider`) | The button probes the switch and branches (§9). The ZIP body moves to an internal component, unchanged |
| Browser seam | `lib/client/businessOsDataExport.ts`: the only client file that may name `/api/business-os/data-exports` (`oneExportControl.guard.test.ts` check 4) | Add `MODULE_EXPORT_URL` and two verdict functions. Guard check 4 is **extended** to the new URL (EXPORT owns the guard, B.8) |
| Settings drawer shell | `components/business-os/settings/SettingsDrawer.tsx` on `components/ui/sheet` (Radix Dialog): direction-aware side, busy refusal, focus return. Its header says "Settings-only by SA ruling (rule 7)" | Reused for the export drawer **if SA rules so** (MX1B-2); otherwise the same shell built from `Sheet` in the data-export folder |
| Flags | `lib/utils/featureFlags.ts` ends with `isEarlySessionOutcomeEnabled()`; the self-delete precedent `isAccountSelfDeleteEnabled()` is server-only, exactly `'true'` | Add `isModuleExportEnabled()` at the end of the file (B.7) |
| Flags doc | `docs/FEATURE_FLAGS.md` v1.14.0; env table ends with the upgrade-modal demo row | One row at the end of the env table, one detail section, one Change History row, version 1.15.0 |
| Audit | `AUDIT_EVENTS.DATA_EXPORT_REQUESTED` exists (definition: "A data export (Download my data) was started by the owner or an admin"; audience `shared`) | **Reused** with `details: { request_id, modules, origin: 'owner' }` (XC-13). No edit to `events.ts` or `eventAudience.ts` in this slice (§2 D-8) |
| Rate limit | `RATE_LIMITS.read` / `.create`, keyed per route name by `rateLimit(request, '<name>', rule)` | Reuse both with two new names. **No edit to `rateLimit.ts`** |
| Email | `sendEmail` (`lib/notifications/emailTransport.ts`), `platformSenderAddress()`, `isInvalidDomainRecipient()`. Pure builder precedent: `lib/business-os/account-deletion/deletionEmail.ts` (DELETE-owned, read only) | A new pure builder `lib/business-os/data-export/exportRequestedEmail.ts` (EXPORT-owned folder) |
| Owner clock and language | `ownerClock(userId, log)` (`data-export/ownerClock.ts`): zone + `isSet`; `UserPreferencesRepository.findPreferredLanguage` (null = nothing usable) | Read at send time (SA MX1A-12) |
| Entitlements | — | No import from `lib/business-os/entitlements/` in any touched file (XC-19). Checked by grep before hand-over |

**Phase (CLAUDE.md rule 8):** not V6, pilot or plugin work.

**`console.*` in touched existing files:** `grep -c "console\."` returned **0** for each of `DownloadMyDataButton.tsx`, `useDownloadMyData.ts`, `lib/client/businessOsDataExport.ts`, `lib/utils/featureFlags.ts`, both export repositories, `oneExportControl.guard.test.ts`, `exportRequestRepositories.callers.guard.test.ts` and `SettingsDrawer.tsx` (read only). It is re-run on every file before its first edit.

**Skills followed:** `new-api-route` (getUser first, Zod `.strict()`, repository access only, Pino child logger with `correlationId`, non-blocking audit, error format with the development-only `details`), `tenant-isolation-guard` (service-role repositories; the only account id is the session's; every read and the one update carry `.eq('user_id', userId)`), `business-os-schema-check` (every column named here was checked against `supabase/migrations/20261095_business_os_export_requests.sql` and the MX-1a §3 tables; no new column). `new-repository` for the three new methods. `bos-llm-call-standards` does not apply (no LLM). `business-os-entitlements` does not apply (no import).

**Files EXPORT does not edit (SR-10, plan §7), confirmed untouched by this plan:** `components/business-os/purge/DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `app/admin/users/components/BusinessDetail.tsx`, `app/admin/users/page.tsx`, `DeleteAccountDrawer.tsx`, everything under `lib/business-os/account-deletion/**`, and every S-1 cleanup-regeneration file (generator, generated SQL, version file, drift test, `no-deletion-paths.guard.test.ts`, `FUNCTION_REQUIRED_TABLES`). **No DELETE-owned file is needed.**

---

## 2. Decisions and their reasons

| # | Decision | Why | Needs |
|---|---|---|---|
| D-1 | **One route file, `app/api/business-os/export-requests/route.ts`, with POST (start) and GET (history).** Both answer **404 before anything else** while the switch is off: no `getUser`, no body read, no database call | Requirement §7 MX-1b: "with the switch off, the route answers 404". Checking the switch first also means the route does not advertise itself to signed-out callers. Precedent: `account/delete` answers 404 while `isAccountSelfDeleteEnabled()` is off | — |
| D-2 | **The switch is server-only** (`BUSINESS_OS_MODULE_EXPORT_ENABLED`, on only for the exact string `true`). The browser learns its state only from the GET: a 404 means off | It is the precedent for both sibling switches (`isAccountSelfDeleteEnabled`, XC-15), and there is then one reader. A `NEXT_PUBLIC_` copy would be compiled into the bundle and could disagree with the server after a partial redeploy | SA (MX1B-1) |
| D-3 | **`DownloadMyDataButton` branches on that GET** (§9). While the answer is unknown it renders today's ZIP control unchanged. A click before the answer arrives waits for it (at most 5 s) and then branches. A 404, a timeout or an error takes the ZIP path | With the switch off, nothing the owner sees changes (no flash, no disabled button), which is the "ZIP flow is unchanged" half of the AC. The one visible difference is one extra GET per mount, which answers 404 |
| D-4 | **The history is limited by requests, not by job rows, with a total order** (§5) | SA MX-1a code review comment 1: the old read limited job rows, so the 100th row could cut a request's module lines in half, and jobs of one request share one `created_at`. The carry-over note asks for this explicitly | SA (MX1B-4) |
| D-5 | **The history read parses one row at a time:** a malformed job row is logged by id and dropped, never fails the whole history | SA MX-1a code review comment 2 and QA finding 1: the SQL CHECK on `parts` is looser than the Zod part schema, so one odd row would otherwise blank the owner's history | — |
| D-6 | **The "Export requested" email is sent by the route after `started`, awaited, best effort.** On success the route marks `requested_email_sent_at` (compare-and-set). On failure the request still stands (its jobs are queued) and the response says `requestedEmailSent: false`. No retry in this slice | The request is the durable fact. The module emails are what the owner needs, and they come from MX-3 regardless. A durable retry would be a second queue, and that belongs with the MX-3 worker, which can claim requests where `requested_email_sent_at IS NULL` (MX1B-6). The column exists for exactly this (SA MX1A-11) | SA (MX1B-6) |
| D-7 | **The recipient is the session user's login email at request time.** No email address is ever taken from the request. With no usable login email (none, or a `deleted.invalid` address), the POST refuses with `409 export_no_login_email` **before** the start, and nothing is written | Requirement §4.3 "To". A request whose emails can never arrive would still use one of the owner's 2 a day | — |
| D-8 | **Audit: reuse `DATA_EXPORT_REQUESTED`** with `details: { request_id, modules, origin: 'owner' }`, non-blocking (`.catch` → log). Refusals (`in_progress`, `daily_limit`, 400) are not audited, the same as the ZIP route. No change to `events.ts` / `eventAudience.ts` | XC-13: reuse, `details.modules`, origin. The existing description already says "started by the owner or an admin". The owner presentation of the new details shape is MX-4's job (plan §4.7) | — |
| D-9 | **No idempotency key and no S-10 claim.** The route sends one email per `started` outcome, and the start function answers `started` once per request | S-10 is needed by MX-3 (parts) and DL-3. Building it here would take a shared claim for no benefit | — |
| D-10 | **Drawer and email copy live in EXPORT's own copy files** (`exportDrawerCopy.ts` for the browser, `exportRequestedEmail.ts` for the server), **not** in `lib/business-os/translations/{en,he,es}.ts` | The drawer opens from `/settings` and `/v2/settings`, which have no `LanguageProvider`. `downloadMyDataCopy.ts` was put in its own file for this reason (DE-9 SA C-10). A plan deviation: plan §4.5 lists the translation files, so **no edit to the shared S-7 hotspot** results | SA (MX1B-3) |
| D-11 | **The drawer reuses `SettingsDrawer`** (props only: side from `isRTL`, close label, busy refusal, focus return), if SA rules it may be used outside `components/business-os/settings/` | One drawer look across the product (its own header says so). The busy refusal is exactly what a POST in flight needs | SA (MX1B-2) |
| D-12 | **Rate limits: `RATE_LIMITS.create` under the name `export-request-start`, `RATE_LIMITS.read` under `export-request-history`.** No edit to `rateLimit.ts` | The database already holds the real limit (2 a day). The throttle only stops hammering. Reusing the existing rules keeps S-17 untouched | — |
| D-13 | **No "you can export again at" state on open in this slice.** The drawer shows the limit sentence after a refused click (`409 export_daily_limit` with `retryAt`) and keeps Export off until that time. The state shown on open (requirement §3.8) comes in MX-4 with the full history | Showing it on open would mean copying the start function's counting rule into TypeScript (a second authority). The AC for MX-1b does not ask for it | SA (MX1B-5) |
| D-14 | **Response `201` for a started request**, with `{ requestId, sentTo, requestedEmailSent }`. `sentTo` is the session user's own address, shown in the "started" sentence. It is never logged | The drawer says "at {login email}" (requirement §3.3). This is the owner's own address, sent to the owner | — |
| D-15 | **The ZIP hook and ZIP routes are not touched.** `useDownloadMyData.ts`, `app/api/business-os/data-exports/**` and `downloadMyDataCopy.ts` keep their bytes | "With the switch off, the ZIP flow is unchanged" (AC). The ZIP start answers 404 only from MX-4 (XC-15) | — |

---

## 3. The switch

**File:** `lib/utils/featureFlags.ts`. Appended at the **end of the file** (B.7 EXPORT anchor), after `isEarlySessionOutcomeEnabled()`:

```typescript
/**
 * Module export's switch (export redesign MX-1b, XC-15): may an owner use the
 * per-module export drawer and its request route?
 *
 * SERVER-ONLY. Default off. On only for the exact string `true`. Off: POST and
 * GET /api/business-os/export-requests answer 404, and "Download my data"
 * builds the ZIP as before. The browser learns the state only from that GET.
 *
 * Do NOT switch it on in Preview before MX-4: Preview and Production share one
 * database, and the deletion receipt reads only the old table until MX-4
 * (SA MX1A-16). The worker (MX-3) runs regardless of this switch.
 */
export function isModuleExportEnabled(): boolean {
  return process.env.BUSINESS_OS_MODULE_EXPORT_ENABLED === 'true';
}
```

Not added to `getFeatureFlags()` (it is the debug helper, and the sibling server-only switches are not in it).

**File:** `docs/FEATURE_FLAGS.md`
- Env table: one row **at the end of the table** (B.7): `| **Business OS: module export** | BUSINESS_OS_MODULE_EXPORT_ENABLED | **Server only** | false (unset = off; only the exact string true is on) | POST/GET /api/business-os/export-requests; "Download my data" opens the export drawer when on |`.
- One detail section after the self-delete section's neighbours, at the end of the Business OS block: what it gates, what off means (404 and the ZIP unchanged), the Preview warning above, rollback (unset and redeploy; no data changes).
- Version 1.14.0 → 1.15.0, `Last Updated` 2026-10-27, one Change History row.

---

## 4. Route: `app/api/business-os/export-requests/route.ts`

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` (one RPC, three short reads and one email). `Cache-Control: no-store` on every answer (ZIP route precedent). Logger `createLogger({ module: 'BusinessOsExportRequestsAPI' })`, `logger.child({ correlationId })`, with `correlationId` from `x-correlation-id` or `crypto.randomUUID()`.

### 4.1 POST: start an export

| # | Step | Answer on failure |
|---|---|---|
| 1 | `if (!isModuleExportEnabled())` | `404 { success: false, error: 'Not found' }`. Nothing else runs |
| 2 | `getUser()` (session; the only account id) | `401 { success: false, error: 'Unauthorized' }` |
| 3 | Read the body as text. Blank or invalid JSON → 400. Parse with `startBody = z.object({ modules: requestedModulesSchema() }).strict()` | `400 { success: false, code: 'invalid_input', error: 'Invalid input', details: dev only }`. An unknown key (a `userId` included), an unknown module, a switched-off module, a duplicate, an empty list or a non-array are all this 400 |
| 4 | `rateLimit(request, 'export-request-start', RATE_LIMITS.create)` | `tooManyRequests(...)` (429) |
| 5 | Login email: `user.email`, trimmed. Missing, or `isInvalidDomainRecipient(email)` | `409 { success: false, code: 'export_no_login_email', error: … }`, nothing written (D-7) |
| 6 | `new BusinessOsExportRequestRepository().startForOwner(user.id, modules)` | `error` → `500` (`details` dev only; the error code is logged, never returned in production). `in_progress` → `409 { code: 'export_in_progress' }`. `daily_limit` → `409 { code: 'export_daily_limit', retryAt }` |
| 7 | Audit `DATA_EXPORT_REQUESTED`, `entityType 'user'`, `entityId user.id`, `userId user.id`, `resourceName 'Data export'`, `details { request_id, modules, origin: 'owner' }`, `severity 'info'`, `complianceFlags ['GDPR', 'SOC2']`, `.catch(err => log)` | Never fails the request |
| 8 | Send the "Export requested" email (§7) with a 10 s guard. On `success`, `markRequestedEmailSent(requestId, user.id)` | A failed or timed-out send is logged as `{ requestId, code }` at `warn`; the answer is still 201 with `requestedEmailSent: false` (D-6) |
| 9 | `201 { success: true, data: { requestId, sentTo: email, requestedEmailSent } }` | — |

Unexpected throw: `500 { success: false, error: 'Internal server error', details: dev only }`.

**Logging:** ids, outcome, module **count** and codes only. Never the email address, never the module list (requirement §12 privacy; the repository already follows that rule).

**Lifecycle state:** the route checks no plan, tier or lifecycle state, and imports nothing from entitlements (XC-19): export works when active, read-only, paused or in DELETE stage C.

### 4.2 GET: the history

| # | Step | Answer on failure |
|---|---|---|
| 1 | Switch off | `404` (as POST) |
| 2 | `getUser()` | `401` |
| 3 | The query string is **ignored** (`?userId=` changes nothing; ZIP route precedent) | — |
| 4 | `rateLimit(request, 'export-request-history', RATE_LIMITS.read)` | 429 |
| 5 | §5 read | `500` |
| 6 | `200 { success: true, data: { requests: ExportHistoryRequest[] } }` | — |

No audit (a read of the owner's own status, ZIP GET precedent).

---

## 5. History read and its tie-break

The carry-over note from MX-1a asks for a deterministic order, with the limit applied to requests rather than job rows. The design:

1. **Requests first, limited and totally ordered.** `requestRepo.listRecentForUser(userId, { limit: HISTORY_REQUEST_LIMIT })` selects `id, origin, modules, requested_at` with `.eq('user_id', userId).order('requested_at', { ascending: false }).order('id', { ascending: false }).limit(n)`. `id DESC` is the tie-break. Two requests can share a `requested_at` only in theory (the start function serialises per account, and `now()` is the transaction time), but a total order means the page never shuffles between two reads. `HISTORY_REQUEST_LIMIT = 20`, clamped 1..50. With the 2-a-day limit, 20 covers at least 10 days. The same index (`business_os_export_requests_user_requested` on `(user_id, requested_at DESC)`) serves it.
2. **Then all the job rows of exactly those requests.** `jobRepo.listForRequestsOfUser(userId, requestIds)` selects `id, request_id, module, status, parts, sent_at` with `.eq('user_id', userId).in('request_id', requestIds)`. There is **no limit on job rows**: the request limit bounds it (at most 20 × 32 rows by the CHECK; 20 × 13 in practice), so no request is ever cut in half. An empty `requestIds` returns `[]` with no call.
3. **Assembled by a pure function**, `assembleExportHistory(requests, jobs)`, in `lib/business-os/data-export/exportHistory.ts`. Requests keep the order of step 1. Inside a request, module lines follow **the request's own `modules` array order** (the drawer order at the time of the click), not `created_at`, which all jobs of one request share. A job whose module is not in the array (it cannot happen, because the start function inserts from that array) is appended after the others, ordered by `module` then `id`, and logged once. A module in the array with no job row is left out and logged (also not expected).
4. **Each line** is `{ module, status, sentAt, emailCount }`, where `emailCount` = the parts in state `accepted`. Each request is `{ requestId, requestedAt, origin, modules: line[] }`. No Resend id, claim field, error code or failure code reaches the browser (the MX-1a DTO rule). `failed` and `interrupted` are statuses, and that is all the drawer shows.

The removed `listHistoryForUser` (MX1B-4) had no caller. Its tests go with it, and the callers guard needs no change for it.

---

## 6. Repository additions

Same rules as MX-1a: service role documented in the header, constructor injection, never throws, `{ data, error }`, Zod on every argument, Pino with ids and counts only, types in the file (S-16), no barrel export.

### 6.1 `BusinessOsExportRequestRepository`

| Method | Query | Notes |
|---|---|---|
| `listRecentForUser(userId, { limit })` | §5 step 1 | Invalid uuid → `invalid_input`, no call. Rows parsed **one at a time** with a narrow schema (`id`, `origin`, `modules` shape-only per SA MX1A-10, `requested_at`); a bad row is logged by id and dropped. Returns `ExportRequestSummary[]` |
| `markRequestedEmailSent(requestId, userId)` | `.update({ requested_email_sent_at: now, updated_at: now }, { count: 'exact' }).eq('id', requestId).eq('user_id', userId).is('requested_email_sent_at', null)` | Compare-and-set; returns `{ data: { updated: boolean } }`. **No `.select()` after the update and no `.or()`** (the PostgREST 42703 hazard). `count = 0` is not an error (already marked, or not this account's) and is logged at `debug` |

### 6.2 `BusinessOsExportModuleJobRepository`

| Method | Query | Notes |
|---|---|---|
| `listForRequestsOfUser(userId, requestIds)` | §5 step 2 | `requestIds`: an array of 0..50 uuids, deduplicated. Per-row parse (D-5) with a **history-only** part schema that reads `state` only, so a part without `resend_id` / `at` is still counted correctly (QA finding 1). Returns `ModuleJobHistoryRow[]` |
| ~~`listHistoryForUser`~~ | removed | MX1B-4 |

The callers guard (T-5 of MX-1a) gets the route file and its test added to the `BusinessOsExportRequestRepository` and `BusinessOsExportModuleJobRepository` rules. The `.from(...)` and SQL-function rules are unchanged: the route names neither.

---

## 7. The "Export requested" email

**File:** `lib/business-os/data-export/exportRequestedEmail.ts` (pure, `server-only` not needed since it has no secrets; no imports except `exportModules.ts` and `supportContact.ts`). Builder shape follows `deletionEmail.ts` (read, not edited).

```typescript
export interface ExportRequestedEmailInput {
  language: 'en' | 'he' | 'es';
  modules: readonly ExportModuleId[];   // the request's order
  requestedAt: Date;
  timezone: string;                     // ownerClock().timezone
  isTimezoneSet: boolean;               // false → the time is labelled "UTC"
}
export function buildExportRequestedEmail(input: ExportRequestedEmailInput): { subject: string; html: string; text: string };
```

| Part | Text (en; he and es in §11) |
|---|---|
| Subject | "Your data export has started" |
| Line 1 | "You asked for an export of your AgentPilot data on {date} at {time}." (`{time}` gets " (UTC)" when no timezone is set, `ownerClock.ts` rule) |
| List | One bullet per module, the module's name in the owner's language from `EXPORT_MODULES` |
| Line 2 | "Each part will arrive in its own email, with a CSV file attached, within a few minutes." |
| Line 3 (files) | "Files (client documents, website pictures) are not included. Download client documents from each client's record." |
| Line 4 | "If you did not ask for this, contact us at {support}." (`PLACEHOLDER_ERASURE_CONTACT`, the one support contact) |

- `dir="rtl"` and `lang` on the wrapper for Hebrew; every interpolated value HTML-escaped; `text` alternative built alongside.
- **No** business name, owner name, email address, row count or file name in the body or subject (requirement §12).
- Sending, in the route: `sendEmail({ kind: 'transactional', to: [email], from: platformSenderAddress(), subject, html, text })`. No `unsubscribeUrl` (the owner's own action asked for it). No attachment, so the F-7 filename log does not apply.
- Language: `UserPreferencesRepository.findPreferredLanguage(user.id)`; `null` or an error → `en` (logged at `warn` with the code). Time: `ownerClock(user.id, requestLogger)`. Both are read at send time (SA MX1A-12). `requestedAt` is the request's `requested_at` read back with `findByIdForUser`, so the email shows the database time, not the server clock; if that read fails, the route uses its own `new Date()` and logs it.
- **Not** recorded in `email_sends` (`recordEmailSend`): that table exists for delivery webhooks against business mail, and bounces are not tracked for export mail (XC-9). SA may rule otherwise (MX1B-7).

---

## 8. Browser seam: `lib/client/businessOsDataExport.ts`

Added below the ZIP functions; the ZIP functions are unchanged.

```typescript
export const MODULE_EXPORT_URL = '/api/business-os/export-requests';

export type ModuleExportHistoryVerdict =
  | { kind: 'off' }                                   // 404: the switch is off
  | { kind: 'ok'; requests: ExportHistoryRequest[] }
  | { kind: 'unavailable' };                          // 401, 429, 5xx, network, timeout, bad body

export type ModuleExportStartVerdict =
  | { kind: 'started'; requestId: string; sentTo: string; requestedEmailSent: boolean }
  | { kind: 'refused'; code: 'in_progress' | 'daily_limit' | 'no_login_email' | 'invalid' | 'off'
        | 'throttled' | 'unauthorized' | 'network' | 'failed'; retryAt?: string };

export function fetchModuleExportHistory(options?: { timeoutMs?: number }): Promise<ModuleExportHistoryVerdict>;
export function startModuleExport(modules: readonly ExportModuleId[]): Promise<ModuleExportStartVerdict>;
```

- Never throws. Each body is Zod-parsed; a body of the wrong shape is `unavailable` / `failed`.
- Refusals are read from the body's `code`; 401, 404 and 429 are read from the status (the DE-9 rule).
- `fetchModuleExportHistory` uses `AbortController` + `setTimeout` (fake-timer friendly, DE-9 C-5), default 5 s (D-3).
- No function takes a user id or an email address. `sentTo` is never logged.
- `ExportHistoryRequest` is a client-side type (a copy of the route DTO shape, Zod-parsed), so the seam does not import a repository.

---

## 9. `DownloadMyDataButton`: one entry, two paths

Props, name and path stay frozen (SR-2, B.6): `{ variant: 'row' | 'button'; className?: string }`.

| File | Change |
|---|---|
| `components/business-os/data-export/DownloadMyDataButton.tsx` | Becomes a small switch: it calls `useModuleExportSwitch()` and renders `<ZipDownloadControl variant className />` (state `unknown` or `off`) or `<ModuleExportEntry variant className />` (state `on`). The exported function and interface keep their names |
| `components/business-os/data-export/ZipDownloadControl.tsx` (new) | **Today's button body moved byte for byte** (the `TooLargeText`, `NoticeText` and render code). Only its own name changes. One addition: an optional internal `onBeforePrepare?: () => Promise<boolean>` hook from the switch (D-3), which, when it answers `true`, means "the switch turned out to be on: open the drawer instead" |
| `components/business-os/data-export/useModuleExportSwitch.ts` (new) | On mount, `fetchModuleExportHistory()` once: `off` / `unavailable` → `off`; `ok` → `on` (the history goes to the drawer as its first page). Exposes `state`, `history`, `whenKnown(): Promise<'on' \| 'off'>` (resolves at once once known; after the 5 s timeout → `off`), and `reload()`. A ref guards against setState after unmount |
| `components/business-os/data-export/ModuleExportEntry.tsx` (new) | The same two looks as today (`row`: settings row with chevron, mirrored in RTL; `button`: bordered button), with the label "Export data" (§11), plus the `ExportDrawer`. The trigger's ref is passed to the drawer as `returnFocusRef` |

Why a click before the probe answers is safe: `ZipDownloadControl`'s `prepare` first awaits `onBeforePrepare()`. While the switch is off, that answers `false` within the probe time (usually already known at click time), and the ZIP starts as today. While the switch is on, it answers `true` and the drawer opens. No ZIP starts.

**Entry points switched over with no edit to them (SR-9, XC-15):** `app/business-os/settings/page.tsx` (`row`), `DangerZonePanel.tsx` (`button`), `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` (`button`), and DL-2's deletion drawer when it renders `<DownloadMyDataButton variant="button" />`. `oneExportControl.guard.test.ts` check 3 still passes for all four (they keep rendering the button).

---

## 10. The export drawer

**File:** `components/business-os/data-export/ExportDrawer.tsx` (`'use client'`), with `useExportDrawer.ts` for its state (hooks in their own file).

**Shell:** `SettingsDrawer` (D-11, MX1B-2) with `title` "Export data", `isRTL` from `useOptionalLanguage()` (default `false`), `closeLabel`, `returnFocusRef` (the trigger), `isBusy` while the POST is in flight. Fallback if SA refuses: the same classes on `Sheet` directly, side `isRTL ? 'left' : 'right'`.

**Body, top to bottom:**

1. **Intro line:** "Choose what to export. Each part arrives by email as a CSV file."
2. **Files sentence (BQ-35 answered, final):** "Files (client documents, website pictures) are not included. Download client documents from each client's record." Shown as a muted info line, always visible.
3. **Select all:** nothing is pre-ticked (BQ-E5-3). One `Checkbox` (`components/ui/checkbox`, Radix) with a visible `<label>`. Checked when every offered module is ticked. Clicking it ticks all, or, if all are ticked, clears all. It uses `true` / `false` only, never `indeterminate`, because the shared indicator draws a tick for "mixed" too and would mislead.
4. **Module list:** `enabledModules()` in map order, one `Checkbox` + `<label htmlFor>` per module with its name in the current language. The list is a `<fieldset>` with a visually hidden `<legend>` ("Modules to export"). Nothing is ticked on open.
5. **Export button:** disabled while nothing is ticked, while the POST runs, and after a `daily_limit` refusal until its `retryAt`. Shows a spinner and `aria-busy` while busy.
6. **Result:** after a started request the confirmation is the **app's pop-up** (BQ-E5-3, user 2026-10-27): `toast.success` from `sonner`, whose `Toaster` is mounted in `components/PlatformShell.tsx` for every platform page (the `NeedsYouCard` / CRM contact drawer precedent). Text, the user's wording: "Export started. The exported files will be sent to {login email} once ready." The ticks are cleared and the history reloads, so the new request shows at the top. Inside the drawer: `role="status"` (polite) and `role="alert"` regions exist from first paint (the DE-9 C-9 pattern), and text goes into exactly one.
   - `started` with `requestedEmailSent` false: the status region adds "The confirmation email could not be sent, but your export is on its way."
   - `in_progress`: "An export is already running. You can start another when it has finished."
   - `daily_limit`: "You can export again at {time}." (`formatExportTime`, owner's clock, UTC labelled).
   - `no_login_email`, `throttled`, `unauthorized`, `network`, `failed`, `invalid`, `off`: one sentence each (§11). `off` (the switch went off between probe and click) says "Export is not available right now. Please try again later."
7. **History** ("Your exports"): newest request first; for each request a small heading "Requested {date}" and one line per module: name, status word, "sent {date}" when sent, and "{n} emails" when `n > 0`. Status words: Waiting, Working, Sent, Failed, Interrupted, **never "Delivered"** (XC-9). Empty: "You have not exported anything yet." Unavailable: "Your export history could not be loaded." with a Try again button. **The list looks and behaves like the invites list (`InviteFriendsSection`) and the boost purchases list (`BoostPurchasesList`)** (BQ-E5-1, user 2026-10-27): divided rows (`divide-y divide-[var(--v2-border)]`), the name on the left and a status chip on the right (`rounded bg-[var(--v2-bg)] px-2 py-0.5 text-xs`, orange for failed / interrupted, primary for sent), a muted line of dates under it, a plain empty line, and a failed read as a line with Try again. A request an admin sent carries a small "Sent by AgentPilot support" tag (BQ-E5-1); none can exist before MX-5, and the list keeps `origin` so MX-5 needs no shape change.

**Keyboard and focus:** Tab order is close X, Select all, modules, Export, history Try again. The `SettingsDrawer` / Radix focus scope keeps focus inside. Escape closes (refused while busy). Focus returns to the trigger on close.

**Stacking inside the deletion drawer / Danger Zone dialog (SR-9):** the `ExportDrawer` is rendered **inside `ModuleExportEntry`'s React tree**, which sits inside the Danger Zone's `DialogContent` (and DL-2's drawer content). Radix then treats it as a nested layer, the mechanism `SettingsDrawer` already relies on for its discard prompt: Escape and an outside press go to the export drawer only, and a press inside it does not dismiss the outer dialog. Both layers use `z-50` portals, and the later portal is painted on top. One test proves it (T-9).

**RTL:** the side follows direction; the row variant's chevron is mirrored (today's code); the list uses logical spacing (`ms-` / `me-`, `text-start`); dates and the email address are wrapped in `<bdi>`.

**Tokens:** V2 tokens only (`var(--v2-text-primary)`, `--v2-text-muted`, `--v2-border`, `--v2-primary`, `--v2-radius-button`), Radix primitives from `components/ui/`, `cn()` for conditional classes. No hardcoded colours except the existing notice styles reused from `DataExportNotice`.

---

## 11. Copy (en / he / es)

**File:** `components/business-os/data-export/exportDrawerCopy.ts`. This is pure data and a typed `Record<'en' | 'he' | 'es', ExportDrawerCopy>`, so a missing key in any language is a compile error (the `downloadMyDataCopy.ts` pattern). Hebrew and Spanish are drafts for native review. Status words, module names (from `exportModules.ts`) and every sentence of §10 are here. Numbers and dates are interpolated, never typed into a sentence.

| Key | en | he (draft) |
|---|---|---|
| `entryLabel` (switch on only, BQ-E5-2) | Export data | ייצוא נתונים |
| `startedToast` (BQ-E5-3, the user's wording) | Export started. The exported files will be sent to {email} once ready. | הייצוא התחיל. הקבצים המיוצאים יישלחו לכתובת {email} כשיהיו מוכנים. |
| `title` | Export data | ייצוא נתונים |
| `intro` | Choose what to export. Each part arrives by email as a CSV file. | בחרו מה לייצא. כל חלק יגיע במייל כקובץ CSV. |
| `filesNotIncluded` (**final, BQ-35**) | Files (client documents, website pictures) are not included. Download client documents from each client's record. | קבצים (מסמכי לקוחות, תמונות האתר) אינם כלולים. אפשר להוריד מסמכי לקוח מהכרטיס של כל לקוח. |
| `selectAll` | Select all | בחירת הכול |
| `export` | Export | ייצוא |
| `started` | Your export has started. Each part will arrive in its own email at {email} within a few minutes. | הייצוא התחיל. כל חלק יגיע במייל נפרד לכתובת {email} תוך כמה דקות. |
| `dailyLimit` | You can export again at {time}. | אפשר לייצא שוב ב-{time}. |
| `inProgress` | An export is already running. You can start another when it has finished. | ייצוא כבר מתבצע. אפשר להתחיל ייצוא נוסף כשהוא יסתיים. |
| status words | Waiting · Working · Sent · Failed · Interrupted | ממתין · בעבודה · נשלח · נכשל · נקטע |

The `es` column and the remaining keys (`noLoginEmail`, `throttled`, `unauthorized`, `network`, `failed`, `invalid`, `off`, `historyTitle`, `historyEmpty`, `historyUnavailable`, `tryAgain`, `requestedOn`, `sentOn`, `emailCount`, `confirmationNotSent`, `close`, `modulesLegend`) are written in the file and reviewed by SA. Test T-10 asserts parity, no "delivered" / "נמסר" / "entregado" word, and that every `{placeholder}` appears in all three languages.

The email copy (§7) is in `exportRequestedEmail.ts`, with the same parity test.

---

## 12. Tests and guards

All Jest in the existing job, small fixtures, no network (no added CI time).

| # | Test | File | Asserts (each with a negative control where it guards) |
|---|---|---|---|
| T-1 | Switch reader | `lib/utils/__tests__/featureFlags.moduleExport.test.ts` (new) | Only `'true'` is on; unset, `''`, `'1'`, `'TRUE'`, `'true '` are off; the source has no `NEXT_PUBLIC_BUSINESS_OS_MODULE_EXPORT` |
| T-2 | Route integration | `app/api/business-os/export-requests/__tests__/route.test.ts` (new) | **Switch off:** POST and GET → 404 and `getUser`, the repositories, `rateLimit` and `sendEmail` are never called. **Auth:** 401 for both. **Invalid input (POST):** blank body, invalid JSON, `{}`, `{ modules: [] }`, a duplicate, an unknown id, a switched-off id (the map mocked with one module `on: false`), an extra key `userId` → 400, no start call. **Happy path:** 3 modules → 201, `startForOwner(session id, ['clients','quotes','website'])` exactly; email to the session address with the 3 names; `markRequestedEmailSent(requestId, session id)`; audit with `{ request_id, modules, origin: 'owner' }`. **Refusals:** `in_progress` → 409 code; `daily_limit` → 409 with `retryAt`; no email, no audit. **No login email** / `deleted.invalid` → 409 and no start. **Email fails / times out** → 201 with `requestedEmailSent: false`, no mark. **Audit rejects** → still 201. **Repository error** → 500 with no `details` when `NODE_ENV=production`. **Throttle** → 429. **Privacy:** no logger call carries the email address or a module id list. **GET:** the assembled history; `?userId=<other>` ignored; repository error → 500. **XC-19:** the route source imports nothing from `lib/business-os/entitlements` |
| T-3 | Request repository additions | `lib/repositories/__tests__/BusinessOsExportRequestRepository.test.ts` (extend) | `listRecentForUser`: `.eq('user_id')`, `order('requested_at' desc)` **then** `order('id' desc)`, limit clamp (0 → 1, 999 → 50, default 20), bad row dropped and logged by id, invalid uuid → no call. `markRequestedEmailSent`: the `.is('requested_email_sent_at', null)` + `.eq('id')` + `.eq('user_id')` chain, `{ count: 'exact' }`, no `.select()`, `count 0` → `updated: false` and no error, DB error → `{ error }` |
| T-4 | Job repository additions | `lib/repositories/__tests__/BusinessOsExportModuleJobRepository.test.ts` (extend; `listHistoryForUser` cases removed) | `listForRequestsOfUser`: `.eq('user_id')` + `.in('request_id', ids)`, no `.limit`; empty ids → `[]` with no call; > 50 ids or a bad uuid → `invalid_input`; a part with no `resend_id` / `at` still counts; a malformed row is dropped, the rest returned |
| T-5 | History assembler (pure) | `lib/business-os/data-export/__tests__/exportHistory.test.ts` (new) | Requests keep their input order; module lines follow `request.modules`; jobs given shuffled → same output (determinism); a job of an unknown module appended after, by module then id; a module with no job left out; `emailCount` = accepted parts; no `resend_id` / `failure_code` key in the output; **a request is never split** (21 requests in → 21 out, each complete) |
| T-6 | Email builder | `lib/business-os/data-export/__tests__/exportRequestedEmail.test.ts` (new) | en / he / es: subject, module names in that language and order, `dir="rtl"` for he, the files sentence, the UTC label when not set and a zone-correct time when set (Asia/Jerusalem across a DST date), HTML escaping, no `@` except the support address, parity of placeholders |
| T-7 | Browser seam | `lib/client/__tests__/businessOsDataExport.moduleExport.test.ts` (new) | 404 → `off`; 200 parsed → `ok`; 401 / 429 / 500 / non-JSON / timeout (fake timers) → `unavailable`; start 201 → `started`; each 409 code mapped; 400 → `invalid`; never throws; never calls a logger with `sentTo` |
| T-8 | Button and drawer | `components/business-os/data-export/__tests__/ModuleExport.render.test.tsx` (new) | **Off / unknown:** probe `off` or `unknown` → the ZIP control renders with today's label and a click calls the ZIP start (existing `DownloadMyDataButton.test.tsx` green, only the probe mock added). **Click before the probe answers:** spinner + `aria-busy`, then the ZIP when it answers off, or the drawer and no ZIP when it answers on (C-12). **On:** both variants show "Export data" (BQ-E5-2); a probe `error` still opens the drawer with "history could not be loaded" + Try again (C-1); nothing ticked on open, Export off, files sentence (BQ-E5-3, BQ-35); Select all ticks all / clears all; Export sends the ticks in map order, the **pop-up** confirms with the address (BQ-E5-3), the ticks clear and the history reloads; `confirmationNotSent`; busy refusal; `in_progress` inline; `daily_limit` sentence in the owner clock and Export off until `retryAt` (fake timers); the history with status words, sent date, email count, never "delivered"; empty history; the support-sent tag (BQ-E5-1); Hebrew: drawer side left, `dir="rtl"`, a history date in Asia/Jerusalem inside `<bdi>` (C-8), the row chevron mirrored |
| T-9 | Stacking and focus inside a dialog (SR-9, one test) | `components/business-os/data-export/__tests__/ExportDrawer.stacking.test.tsx` (new) | A Radix `Dialog` (from `components/ui/dialog`) holding `<DownloadMyDataButton variant="button" />`, switch on: click → the export drawer opens and focus is inside it; **Escape closes only the drawer** (the dialog stays open); focus returns to the button; a press inside the drawer does not close the dialog; then Escape closes the dialog. Real Radix, no stand-ins |
| T-10 | Copy parity | `components/business-os/data-export/__tests__/exportDrawerCopy.test.ts` (new) | Same keys and placeholders in en / he / es; non-empty; no delivered-word in any language; the `filesNotIncluded` en text equals requirement §3.2's sentence |
| T-11 | One export control guard (extended) | `components/business-os/data-export/__tests__/oneExportControl.guard.test.ts` | Check 4 now also refuses `/api/business-os/export-requests` outside `app/api/` and `lib/client/businessOsDataExport.ts`, with a planted-file negative control (LF and CRLF). Checks 1, 2, 3 and 5 unchanged and green |
| T-12 | Callers guard (allow-list) | `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` | The route and its test added to the two class rules; the header line "MX-1b adds the owner route" becomes past tense; existing negative fixtures still fail |
| T-13 | Runs before hand-over | — | `npm test -- app/api/business-os/export-requests components/business-os/data-export lib/business-os/data-export lib/repositories/__tests__ lib/client lib/utils`, then `npm test`; `npm run lint`; `npx tsc --noEmit` with `NODE_OPTIONS=--max-old-space-size=8192`, filtered to touched files, exit code checked (no OOM trace); `npm run build`. `grep -rn "business-os/entitlements"` on every touched file must be empty (so `test:bos-entitlements` is not required); `grep -c "console\."` on every touched file must be 0 |

---

## 13. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/export-requests/route.ts` | create | §4 |
| `app/api/business-os/export-requests/__tests__/route.test.ts` | create | T-2 |
| `lib/repositories/BusinessOsExportRequestRepository.ts` | modify (add 2 methods) | §6.1 |
| `lib/repositories/BusinessOsExportModuleJobRepository.ts` | modify (add 1, remove 1) | §6.2, MX1B-4 |
| `lib/repositories/__tests__/BusinessOsExportRequestRepository.test.ts`, `BusinessOsExportModuleJobRepository.test.ts` | modify | T-3, T-4 |
| `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` | modify (allow-list add) | T-12 |
| `lib/business-os/data-export/exportHistory.ts` + `__tests__/exportHistory.test.ts` | create | §5, T-5 |
| `lib/business-os/data-export/exportRequestedEmail.ts` + `__tests__/exportRequestedEmail.test.ts` | create | §7, T-6 |
| `lib/client/businessOsDataExport.ts` | modify (append) | §8 |
| `lib/client/__tests__/businessOsDataExport.moduleExport.test.ts` | create | T-7 |
| `components/business-os/data-export/DownloadMyDataButton.tsx` | modify (internals only; props frozen) | §9 |
| `components/business-os/data-export/ZipDownloadControl.tsx` | create (moved body) | §9 |
| `components/business-os/data-export/useModuleExportSwitch.ts`, `ModuleExportEntry.tsx`, `ExportDrawer.tsx`, `useExportDrawer.ts`, `exportDrawerCopy.ts` | create | §9, §10, §11 |
| `components/business-os/data-export/__tests__/ModuleExport.render.test.tsx`, `ExportDrawer.stacking.test.tsx`, `exportDrawerCopy.test.ts` | create | T-8, T-9, T-10 |
| `components/business-os/data-export/__tests__/oneExportControl.guard.test.ts` | modify (check 4 extended) | T-11 |
| `components/business-os/data-export/__tests__/DownloadMyDataButton.test.tsx` | modify (mock the probe as 404 only) | T-8 |
| `app/business-os/settings/__tests__/accountCard.guard.test.ts` | modify (one assertion) | Its S-5 check read the RTL chevron from `DownloadMyDataButton.tsx`; the chevron is now drawn by `ZipDownloadControl.tsx` (off) and `ModuleExportEntry.tsx` (on), so it reads both, and that the button renders both. A test file about an EXPORT-owned component; `app/business-os/settings/page.tsx` itself is not touched (Implementation notes, deviation X-1) |
| `lib/utils/featureFlags.ts` | modify (append at end of file) | §3, B.7 |
| `lib/utils/__tests__/featureFlags.moduleExport.test.ts` | create | T-1 |
| `docs/FEATURE_FLAGS.md` | modify (row at end of env table, section, history) | §3, B.7 |
| `docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md` | create / modify | this file |

**Not touched:** `lib/business-os/translations/{en,he,es}.ts` (D-10), `lib/security/rateLimit.ts` (D-12), `lib/audit/events.ts` and `eventAudience.ts` (D-8), `lib/notifications/emailTransport.ts` (D-9), `useDownloadMyData.ts`, `downloadMyDataCopy.ts`, `app/api/business-os/data-exports/**` (D-15), `lib/repositories/BusinessOsDataExportJobRepository.ts` (`findDeletionFacts`, frozen), `lib/repositories/types.ts` / `index.ts`, `vercel.json`, every migration, and every file in plan §7 (DELETE-owned or S-1). The requirement's §6 status line is spliced by BA or a general-purpose agent after each stage, not by Dev.

---

## 14. Task list

- [x] 1. ✅ `isModuleExportEnabled()` at the end of `featureFlags.ts` + T-1; `docs/FEATURE_FLAGS.md` row, section and history (v1.15.0).
- [x] 2. ✅ `BusinessOsExportRequestRepository.listRecentForUser` + `markRequestedEmailSent` + T-3.
- [x] 3. ✅ `BusinessOsExportModuleJobRepository.listForRequestsOfUser`; `listHistoryForUser` removed with its dead code (C-3) and tests; T-4.
- [x] 4. ✅ `exportHistory.ts` (pure assembler, no repository import, C-4) + T-5.
- [x] 5. ✅ `exportRequestedEmail.ts` (pure builder) + T-6.
- [x] 6. ✅ Route POST and GET + T-2 (audit with `logAndFlush`, C-2; `email_timeout` vs `email_failed`, C-7); callers guard allow-list (T-12).
- [x] 7. ✅ Browser seam additions (four probe verdicts, C-1) + T-7; guard checks 3 and 4 extended (T-11, C-5).
- [x] 8. ✅ `exportDrawerCopy.ts` (incl. `entryLabel` "Export data", BQ-E5-2, and `startedToast`, BQ-E5-3) + T-10.
- [x] 9. ✅ ZIP body moved to `ZipDownloadControl.tsx` (move evidence in Implementation notes, C-12) with `onBeforePrepare`; existing `DownloadMyDataButton.test.tsx` green with only the probe mock added.
- [x] 10. ✅ `useModuleExportSwitch`, `ModuleExportEntry`, the switch in `DownloadMyDataButton` (props frozen).
- [x] 11. ✅ `useExportDrawer` + `ExportDrawer` (`SettingsDrawer` shell per MX1B-2, not edited, C-11; pop-up confirmation, BQ-E5-3; list pattern of invites / boost purchases, BQ-E5-1) + T-8.
- [x] 12. ✅ Stacking and focus test T-9 with real Radix, incl. the C-6 case.
- [x] 13. ✅ T-13 runs; `console.*` and entitlements greps; `git diff --numstat` checked (no deletion-only file).
- [ ] 14. ⬜ Hand to SA (code review) and QA; changes left **uncommitted** for the user's diff review.

---

## 15. Acceptance criteria

From requirement §7 MX-1b and plan §4.5:

- [ ] With the switch off, POST and GET `/api/business-os/export-requests` answer 404, and "Download my data" builds the ZIP exactly as before (T-2, T-8, QA 1).
- [ ] Ticking 3 modules creates one request and 3 module jobs; one "Export requested" email lists them with the date and time (T-2, QA 3).
- [ ] No module name from the browser is trusted: an unknown or switched-off module is refused with 400 and nothing is written (T-2).
- [ ] The only account id is the session's; a body or query `userId` is refused (POST) or ignored (GET) (T-2).
- [ ] The history is newest-first by request, never splits a request, and is stable between reads (T-3, T-5).
- [ ] The export drawer opened from inside the Danger Zone dialog handles focus and stacking (T-9, SR-9).
- [ ] Keyboard-only and Hebrew RTL checks recorded by QA (QA 5, QA 6).
- [ ] `oneExportControl.guard.test.ts` green, and check 4 now covers the new route (T-11).
- [ ] No import from `lib/business-os/entitlements/`; no `console.*`; no email address or module list in logs or audit except `details.modules` ids.

---

## 16. QA plan

Local only (`npm run dev` with `BUSINESS_OS_MODULE_EXPORT_ENABLED=true` in `.env.local`). **Never switch it on in Preview or Production** (§3; SA MX1A-16). Local dev uses the shared database, so QA uses a `+test` account and records the request ids it created. Module jobs stay `waiting` (no worker before MX-3). Cleanup is the normal test-account cleanup, which removes both tables in step B (MX-1a D-2). No SQL is written by hand.

| # | Check | How |
|---|---|---|
| 1 | Switch off | Unset: the four entry points show "Download my data" and build the ZIP as today; `curl` POST and GET → 404 signed in and signed out |
| 2 | Switch on, entry points | `/business-os/settings` row, Danger Zone button, `/settings` and `/v2/settings` buttons all open the drawer; none of those files changed in the diff |
| 3 | Happy path | Tick 3 → started sentence with the login address; one "Export requested" email arrives (subject, 3 names, date and time in the account's zone or "(UTC)", files sentence); history shows 3 lines "Waiting" under one request |
| 4 | Limits | A second Export at once → "already running" (the first request's jobs are still `waiting`). The daily limit cannot be reached locally without the worker; T-2 covers its route mapping and MX-1a QA 3 its SQL |
| 5 | Keyboard only | Tab / Shift-Tab through the drawer, Space ticks, Enter exports, Escape closes and focus returns to the trigger; inside the Danger Zone dialog Escape closes only the drawer |
| 6 | Hebrew RTL | Language he: drawer from the left, text right-aligned, the address and dates read whole, chevron mirrored, Hebrew email `dir="rtl"` |
| 7 | Screen reader spot check | Labels on every tick box, the fieldset legend, the started text announced politely and refusals as alerts |
| 8 | Failure path | Stop the network (DevTools offline) and press Export → the network sentence, ticks kept |
| 9 | Privacy | Server log lines for the requests carry ids, counts and codes only; no address, no module list; the audit row's `details` holds `request_id`, `modules` ids and `origin` |

---

## 17. Coordination

- **CC-1:** coordination file read on 2026-10-27; E5 rows present; no lock or number needed.
- **CC-5:** `[EXPORT→DELETE] MX-1b workplan approved`, `… PR opened`, `… merged — DownloadMyDataButton now opens the export drawer when isModuleExportEnabled() is on` (plan §4.5), so DL-2 knows the link target changes with no edit on its side.
- **CC-6:** `featureFlags.ts` (end of file) and `docs/FEATURE_FLAGS.md` (end of env table) are the only shared hotspots edited. Rebase on `main` just before enqueue; on a conflict keep both sides.
- **CC-7:** frozen interfaces kept: `DownloadMyDataButton` (name, path, props) and `findDeletionFacts` (not touched).
- **S-7 note:** D3 also adds en/he/es copy at DELETE's anchor. MX-1b adds **nothing** to the translation files (D-10), so there is no merge with D3 there.
- **Plan deviation to log:** the drawer copy lives in `exportDrawerCopy.ts`, not in the translation bundles (D-10), so EXPORT's S-7 anchor is unused in this slice.

---

## 18. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | Someone switches it on in Preview before MX-4, and the deletion receipt misses module exports (shared database) | Warning in the reader's doc comment and the flags doc; QA plan says local only |
| K-2 | The probe adds one GET per mount on four pages | It answers 404 fast before any auth or database work. It goes away when MX-6 retires the ZIP (the button then always opens the drawer) |
| K-3 | A click lands before the probe answers and waits up to 5 s | It is usually answered at click time. After the timeout the ZIP path runs, which is today's behaviour |
| K-4 | Local QA writes real request rows into the shared production database, and sends a real "Export requested" email, while MX-3 is not built (SA C-10) | `+test` account only; QA records every request id in the QA report. **MX-3 carry-over gate:** those rows are removed through the test-account cleanup **before MX-3 merges**, or the worker would claim and send them. Until then that account's own `in_progress` refusal is expected. Dev ran nothing against the live database (mocked tests only), so Dev created no rows |
| K-5 | The "Export requested" email fails and the owner gets no confirmation | The drawer says so (`confirmationNotSent`), and the module emails still come. MX1B-6 proposes a durable retry in MX-3 |
| K-6 | The moved ZIP body drifts during the move | Task 9 is a pure move reviewed as such; the existing ZIP tests run unchanged |
| K-7 | **Duplicate hazard for MX1B-6 (SA C-7).** When the 10 s guard wins, the send is not cancelled: the "Export requested" mail may still arrive while `requested_email_sent_at` stays NULL (logged `email_timeout`, not `email_failed`). A mark that fails after a successful send (`mark_failed`) leaves the same state | Recorded for the MX-3 workplan: if MX-3 ever retries the requested email from `requested_email_sent_at IS NULL`, these rows can get a second copy, because the MX-1b send carries no idempotency key. SA's current leaning is no retry at all |
| K-8 | **SA C-9, MX-4 must-do.** `ModuleExportEntry` renders no ZIP status line. Once the switch is on, an owner who still has a ready ZIP loses the only "Download again" link to it, which breaks XC-15 and the MX-4 AC ("ready ZIPs stay downloadable until they expire") | Not reachable in MX-1b (switch off, never on in Preview). Written into `ModuleExportEntry.tsx`'s header and §19 MX1B-10; TL relays it into plan §4.7 |

---

## 19. Open items for SA

| # | Item | Proposal |
|---|---|---|
| MX1B-1 | Server-only switch with a 404 probe, vs a `NEXT_PUBLIC_` switch read in the browser | Server-only (D-2, D-3): one reader, the sibling precedent, no bundle exposure. Cost: one extra GET per mount until MX-6 |
| MX1B-2 | May `SettingsDrawer` (header: "Settings-only by SA ruling") be used by the export drawer in `components/business-os/data-export/`? | Yes: one drawer look, the busy refusal and focus return come for free, and it is props-only. Otherwise the same shell is built on `Sheet` in the data-export folder |
| MX1B-3 | Drawer copy in `exportDrawerCopy.ts` instead of the translation bundles (plan §4.5 lists the bundles) | Own file (D-10): the drawer opens where there is no `LanguageProvider`, the DE-9 precedent, and it leaves the S-7 hotspot untouched |
| MX1B-4 | Remove `listHistoryForUser` (no caller; limits job rows) in favour of the two-step read | Remove now, so there is one history reader. The alternative is to keep it marked `@deprecated` until MX-4 |
| MX1B-5 | The "you can export again at {time}" state on open (requirement §3.8) | MX-4 (D-13). MX-1b shows it after a refused click only |
| MX1B-6 | A durable retry of the "Export requested" email | Not in MX-1b. MX-3's worker may claim requests where `requested_email_sent_at IS NULL` and `requested_at` is older than a few minutes; it needs the S-10 idempotency key (`export-requested:{request_id}`). SA to rule in the MX-3 workplan |
| MX1B-7 | Record the "Export requested" email in `email_sends` (`recordEmailSend`)? | No: bounces are not tracked for export mail (XC-9), and that table serves business delivery webhooks |
| MX1B-8 | Status code for a started request | `201` with `{ requestId, sentTo, requestedEmailSent }` (D-14) |
| MX1B-9 | `HISTORY_REQUEST_LIMIT` = 20 requests per read | 20 (at least 10 days at the owner's limit). MX-4 may add paging if it shows "full history" |
| MX1B-10 | **MX-4 must-do (SA C-9):** keep the ZIP "Last export … Download again" status line on the switch-on path until the last ready ZIP has expired (XC-15) | MX-4 renders the ZIP status line (from `useDownloadMyData`'s `lastExport`) under `ModuleExportEntry`, or in the drawer, until MX-6. Not built in MX-1b |
| MX1B-11 | **MX-4 note (BQ-E5-2):** the "Export data" label | Already in `exportDrawerCopy.ts` (`entryLabel`) and shown on the switch-on path in MX-1b, so it costs MX-4 nothing. While the switch is off, every button keeps "Download my data" |

---

## 20. Business questions for the user

BQ-35 is **answered** (files are not exported; the drawer's sentence above is final). The other questions in requirement §9 are not decided here. **BQ-E5-1, BQ-E5-2 and BQ-E5-3 were answered by the user on 2026-10-27** (recorded by TL in requirement §9):

- **BQ-E5-1: yes.** The history list looks and behaves like the invites list and the boost purchases list (row, empty state, status chip). Support-sent exports (MX-5) will show there labelled "Sent by AgentPilot support". MX-1b builds nothing for MX-5, but the list keeps `origin` and already renders the tag (§10 item 7).
- **BQ-E5-2: yes.** Once the switch is on, the button reads "Export data". MX-1b puts the label in `exportDrawerCopy.ts` and shows it on the switch-on path; "Download my data" stays while the switch is off.
- **BQ-E5-3:** nothing is pre-ticked; the owner ticks what they want ("Select all" is available) and presses Export, which is disabled while nothing is ticked. After a successful request the owner gets a pop-up confirmation, "Export started. The exported files will be sent to {login email} once ready." (the app's `sonner` toast), and then the history list shows the new request. Refusals (in progress, daily limit) stay inline in the drawer.

The questions as first asked:

| # | Question | Suggested answer | Needed before |
|---|---|---|---|
| BQ-E5-1 | When our support team sends an owner their export (the later admin "send export" step), should it show in the owner's export history, and with what label? | Yes, shown like any other, labelled "Sent by AgentPilot support" | MX-5 |
| BQ-E5-2 | The button in Settings and the Danger Zone says "Download my data" today. Once the new export is switched on, should it read "Export data" (it no longer downloads anything in the browser)? | "Export data", matching the drawer's title. While the switch is off it keeps "Download my data" | MX-4 switch-on (wording can change before then) |
| BQ-E5-3 | (SA's.) Should every part start ticked or unticked? | Unticked, with "Select all" | MX-4 switch-on |

The Hebrew and Spanish texts in §11 are drafts for native review, the same as every earlier export slice.

---

## Implementation notes

Dev, 2026-10-27, on `feature/bos-export-mx1b-route-drawer` at `4e75ed9f`. Everything is **uncommitted**. No `git stash`, no migration, no database access: every test mocks its collaborators, so Dev created **no live rows** (C-10).

### How each SA condition was met

| # | Condition | Met by |
|---|---|---|
| C-1 | Only the route's own 404 means off | `fetchModuleExportHistory` has four verdicts: `off` (404 **with our JSON error body**), `ok`, `error` (any other JSON answer of our route: 401, 429, 500, a 200 of the wrong shape), `unknown` (network, 5 s timeout, non-JSON page, or a 404 that is not ours). `useModuleExportSwitch` maps `ok` / `error` to on and `off` / `unknown` to off. Tests: T-7 (each case, incl. an HTML 404 and a JSON 404 of another shape → `unknown`), T-8 (a probe `error` still opens the drawer, which says "history could not be loaded" with Try again) |
| C-2 | `DATA_EXPORT_REQUESTED` with `logAndFlush`, after `started`, before the email | `route.ts` POST awaits `logAndFlush(entry, requestLogger, { reason, continues })`. T-2 asserts one flushed entry with ids only, the audit-before-email order, and that a slow flush still ends in 201 with the email sent |
| C-3 | Remove the dead history code | `MODULE_JOB_HISTORY_SELECT`, `HISTORY_LIMIT_MAX`, the old `historyRowSchema`, `ModuleJobHistoryItem` and `listHistoryForUser` are gone, with their test imports; the header bullet now names `listForRequestsOfUser`. `modulePartSchema` is kept (the claim parse uses it) |
| C-4 | `exportHistory.ts` imports neither repository | It has no import at all; its inputs are structural interfaces. T-5 asserts it by source scan |
| C-5 | Guard check 3 extended too | `entryFileProblems` also flags `fetch(` of `export-requests`; planted LF and CRLF negative controls. Check 4 covers both routes; its non-vacuity check now also requires the seam to name the new route |
| C-6 | Escape while the POST is in flight closes neither layer | T-9 second case, real `components/ui/dialog` host, real Radix |
| C-7 | `email_timeout` vs `email_failed` | The 10 s guard resolves `email_timeout`; a refused or throwing send is `email_failed`; a failed mark after a sent email logs `mark_failed`. T-2 covers all three. The duplicate hazard is recorded as §18 K-7 |
| C-8 | Every drawer date in the owner's clock, in `<bdi>` | "Requested {date}", "Sent {date}" and the `retryAt` sentence all go through `formatExportTime` + `useBusinessTimezone` (UTC labelled by `timeZoneName` outside a provider), each inside `<bdi>`. T-8 checks a Hebrew history date in Asia/Jerusalem and the `daily_limit` time |
| C-9 | MX-4 carry-over written down | §18 K-8, §19 MX1B-10, and the header of `ModuleExportEntry.tsx`. No code |
| C-10 | `+test` only, record ids, cleanup before MX-3 | §18 K-4 is now a gate for MX-3. Dev used no live database, so there are no ids to list. QA records any it creates |
| C-11 | No edit to `SettingsDrawer.tsx` | Untouched (`git status`). `ExportDrawer.tsx`'s header cites SA MX1B-2 |
| C-12 | The move is verifiable; spinner while waiting | Evidence below. `DownloadMyDataButton.test.tsx` gained only the probe mock (3 lines); its 31 tests pass unchanged. While a click waits on the probe, the button shows the existing spinner, `aria-busy` and `disabled` (T-8) |

### C-12 move evidence

`git diff --no-index <main's DownloadMyDataButton.tsx> components/business-os/data-export/ZipDownloadControl.tsx` (saved to the session scratchpad as `mx1b-zip-move.diff`). Every changed line is one of:

- the header comment (new name, the MX-1b note);
- `import React` → `import React, { useCallback, useEffect, useRef, useState }`;
- `DownloadMyDataButtonProps` → `ZipDownloadControlProps`, plus the optional `onBeforePrepare`;
- the function name and the default export;
- `isPreparing` from the hook renamed `isZipPreparing`, the `handlePrepare` block (about 30 lines), and `isPreparing = isZipPreparing || isWaitingForSwitch`;
- `onClick={prepare}` → `onClick={handlePrepare}` (both variants);
- the two live regions read `isZipPreparing`, so waiting on the probe shows the spinner but not the "Preparing your export" sentence.

Nothing else differs: the notice texts, the status line, "Download again", the classes and the two live regions are byte for byte.

### Deviations

| # | Deviation | Why |
|---|---|---|
| X-1 | **`app/business-os/settings/__tests__/accountCard.guard.test.ts` edited (one assertion).** Its S-5 check read the RTL chevron from `DownloadMyDataButton.tsx`, which now only switches. It now reads `ZipDownloadControl.tsx` and `ModuleExportEntry.tsx`, and checks that the button renders both | The test failed otherwise. It guards an EXPORT-owned component; the DELETE-owned `app/business-os/settings/page.tsx` is **not** touched, and the file is not on the B.1 / B.7 / B.8 lists. **TL: please log it in the coordination file** with the E5 PR line, in case DELETE also edits that test |
| X-2 | The confirmation after a start is a `sonner` toast, not the inline "started" sentence of §10 | BQ-E5-3 (user). The inline status region keeps only `confirmationNotSent` |
| X-3 | The "Sent by AgentPilot support" tag is already rendered for `origin = 'admin'` | BQ-E5-1 (user): free, and it proves the list takes an origin label. No admin row can exist before MX-5 |
| X-4 | The probe has four verdicts, not three (§8 had `off` / `ok` / `unavailable`) | C-1 |
| X-5 | The browser seam takes the history type with `import type` from `lib/business-os/data-export/exportHistory.ts` instead of a hand-written copy; the runtime shape is still Zod-checked in the seam | That file is pure with no imports, so nothing server-side reaches the bundle, and the route and the browser cannot drift apart. C-4 is about the repositories, which the seam still never names |
| X-6 | The drawer reloads its history every time it opens; the checkbox is restyled with V2 tokens through `className` | SA optimisation suggestions, taken. `components/ui/checkbox.tsx` is not edited |
| X-7 | Copy keys added beyond §11: `close`, `exporting`, `startedToast`, `emailCountOne` / `emailCountMany`, `origin.admin`; the inline `started` key dropped | X-2, X-3, and plural-safe email counts |
| X-8 | `ModuleExportEntry` opens the drawer from an effect when the open request arrives one render after the switch turns on | A click that waited on the probe sets the request in the microtask after the switch state; `useState(initial)` alone would miss it (caught by T-8) |

### Test results

| Run | Result |
|---|---|
| The 17 new and changed suites (route, both repositories, callers guard, history, email, both seam suites, flag, the seven `components/business-os/data-export` suites, account card guard) | **17 suites, 294 tests, all pass** |
| Affected areas: `app/api/business-os/export-requests`, `app/api/business-os/data-exports`, `components/business-os/data-export`, `lib/business-os/data-export`, `lib/repositories/__tests__`, `lib/client`, `lib/utils`, `components/business-os/{purge,account-deletion,settings}`, `app/business-os/settings`, `components/settings`, `components/v2/settings`, the 20261095 migration test | **245 suites, 5,416 tests: 5,415 pass, 1 fails.** The one failure is `lib/utils/__tests__/oneAddressPolicy.guard.test.ts`, which is **pre-existing**: it fails the same way on the `main` checkout (it lists files this branch does not touch, with Windows paths) |
| `npx tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=8192`) | Completed, no OOM trace. **0 errors in touched files.** 1,849 pre-existing errors elsewhere (`next.config.js` ignores them). The first run found 2 in `useExportDrawer.ts` (a `.catch` fallback narrowed the union); fixed, and the second run's output was shorter by exactly those lines |
| `npx eslint` on every touched file | Clean (after renaming two `module` loop variables, `@next/next/no-assign-module-variable`) |
| `grep -c "console\."` and entitlements import grep on every touched `.ts` / `.tsx` | 0 and 0 |
| `git diff --numstat` | No deletion-only file. `DownloadMyDataButton.tsx` shows 44 / 140 because its body moved to `ZipDownloadControl.tsx` |

### Files changed

**New:** `app/api/business-os/export-requests/route.ts`, `app/api/business-os/export-requests/__tests__/route.test.ts`, `lib/business-os/data-export/exportHistory.ts`, `lib/business-os/data-export/exportRequestedEmail.ts` (+ their two tests), `lib/client/__tests__/businessOsDataExport.moduleExport.test.ts`, `lib/utils/__tests__/featureFlags.moduleExport.test.ts`, `components/business-os/data-export/{ZipDownloadControl.tsx, ModuleExportEntry.tsx, ExportDrawer.tsx, useExportDrawer.ts, useModuleExportSwitch.ts, exportDrawerCopy.ts}`, `components/business-os/data-export/__tests__/{ModuleExport.render.test.tsx, ExportDrawer.stacking.test.tsx, exportDrawerCopy.test.ts}`.

**Modified:** `components/business-os/data-export/DownloadMyDataButton.tsx` (internals only; name, path, props and default export frozen), `components/business-os/data-export/__tests__/{DownloadMyDataButton.test.tsx, oneExportControl.guard.test.ts}`, `lib/client/businessOsDataExport.ts` (appended), `lib/repositories/BusinessOsExportRequestRepository.ts`, `lib/repositories/BusinessOsExportModuleJobRepository.ts`, `lib/repositories/__tests__/{BusinessOsExportRequestRepository.test.ts, BusinessOsExportModuleJobRepository.test.ts, exportRequestRepositories.callers.guard.test.ts}`, `lib/utils/featureFlags.ts` (end of file), `docs/FEATURE_FLAGS.md` (end of env table, section, v1.15.0), `app/business-os/settings/__tests__/accountCard.guard.test.ts` (X-1), this workplan.

**Not touched:** translations, `rateLimit.ts`, `lib/audit/*`, `emailTransport.ts`, `useDownloadMyData.ts`, `downloadMyDataCopy.ts`, the ZIP routes, `BusinessOsDataExportJobRepository.ts`, `SettingsDrawer.tsx`, `components/ui/*`, `vercel.json`, any migration, and every DELETE-owned or S-1 file. `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` shows as modified in the worktree: that is TL's BQ record, not Dev's.

---

## SA Review Notes

**Reviewed by SA — 2026-10-27** (workplan only; worktree `neuronforge-mx1b`, branch `feature/bos-export-mx1b-route-drawer` at `4e75ed9f`; no code, no database access). **Status:** ⚠️ Approved with conditions. The full review is the next section.

---

## SA Workplan Review — 2026-10-27

### What was checked

| Area | Read against | Result |
|---|---|---|
| Scope | Plan §4.5; requirement §6.2 MX-1b, §7 MX-1b AC, §4.5 R-5 (BQ-35 answered: files are not exported), §11 S-4 / SR-9, B.6, B.7, B.8; XC-8, XC-9, XC-13, XC-15, XC-19, XC-21 | Matches. Every MX-1b AC item maps to a test or a QA check (§15). There is no kick to the worker from the route (XC-8). The ZIP routes are untouched (XC-15: the ZIP start's 404 belongs to MX-4) |
| Columns | `supabase/migrations/20261095_business_os_export_requests.sql` | Every column named exists. Requests: `id`, `user_id`, `origin`, `modules`, `requested_at`, `requested_email_sent_at`, `updated_at`. Jobs: `id`, `request_id`, `user_id`, `module`, `status`, `parts`, `sent_at`. The parts CHECK proves only `n` and `state`, so the history-only part schema that reads `state` alone is correct (it closes MX-1a QA finding 1). The tables have no trigger, so the compare-and-set update fires nothing |
| Tenant isolation (tenant-isolation-guard) | Route, three new repository methods | The only account id is `getUser().id`. The body is `.strict()` and holds `modules` only, and the GET ignores the query. `listRecentForUser` and `listForRequestsOfUser` both filter on `user_id`. The job read also takes only ids returned by the user-scoped request read, so it is scoped twice. `markRequestedEmailSent` filters `id` + `user_id` + `IS NULL`, with an explicit two-field payload. `requestId` always comes from the start function's answer, never from the caller. No caller-supplied id reaches a service-role path |
| Switch-off order | §4.1 step 1, §4.2 step 1, T-2 | `isModuleExportEnabled()` is the first statement of both methods. It runs before `getUser`, before the body is read, before `rateLimit` (so no rate-limit row is written) and before any repository call. T-2 asserts that none of these is called. This matches the `account/delete` precedent (`route.ts:150`) |
| Skills | `new-api-route` final checklist, `new-repository`, `business-os-schema-check` | All pass except the audit flush (C-2). Zod runs before business logic. Errors use the development-only `details`. Pino child logger with `correlationId`. Integration tests cover the happy path, 401 and 400 |
| DELETE-owned files | B.1, B.7, B.8, plan §7 | None is in §13. `DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `BusinessDetail.tsx`, `app/admin/users/page.tsx`, `DeleteAccountDrawer.tsx`, `lib/business-os/account-deletion/**` and every S-1 cleanup-regen file are untouched. Every DELETE test that renders an entry point (`DeleteAccountDrawer.*.test.tsx`, `DangerZonePanel.*.test.tsx`, `agentPlatformEntryPoints.render.test.tsx`, `downloadMyData.render.test.tsx`) already mocks `DownloadMyDataButton`, so the new probe touches none of them |
| Frozen `DownloadMyDataButton` | B.6, SR-2, SR-9 | Name, path, props and default export are kept. Only the internals change. The four entry files keep passing guard check 3 |
| Focus and stacking | S-4 / SR-9, `SettingsDrawer` nested-layer mechanism, T-9 | Sound: the export drawer is rendered inside the outer `DialogContent`'s React tree, which is the mechanism the settings discard prompt already relies on. The test uses real Radix. One case is added (C-6) |
| Hebrew RTL | §10, §11, T-8, QA 6 | The side follows direction, logical spacing is used, the address and dates are wrapped in `<bdi>`, the chevron is mirrored and the email has `dir="rtl"`. The history dates need the owner's clock (C-8) |
| Logging and privacy | §4.1, T-2, T-7, requirement §12 | Logs carry ids, counts and codes only. The address and module list are never logged. `sentTo` is returned only to its owner and never logged. Audit `details` holds `request_id`, `modules` (ids) and `origin` only (XC-13). `grep -c "console\."` = 0 on every touched file, re-run before each edit |
| Entitlements | XC-19, `business-os-entitlements` | No import in any touched file. The "no export route in `ENFORCEMENT_POINTS`" test correctly stays in MX-4 (it imports that module, so it brings the entitlements registration with it) |
| Effort | Plan §4.5 (2 d), requirement XC-17 (≤ 2.5 d) | About 2 to 2.5 days: at the top of the band, but inside the cap. The two items most likely to overrun are T-9 and the ZIP body move. If T-9 cannot be made to pass with real Radix, stop and escalate to SA. Do not stub the layers |

### The history tie-break (user's carry-over note)

Correct and deterministic. Ruled ✅.

- `id` is the primary key, so `ORDER BY requested_at DESC, id DESC` is a total order. The limit counts **requests**, so a request can never be cut in half. That fixes MX-1a code review comment 1.
- The second read has no limit and is bounded by the first: at most 20 × 13 rows today, and 20 × 32 by the CHECK.
- The start function inserts a request and all its jobs in **one transaction**, so any request the first read sees already has every job. A request started between the two reads is not in the id list, so it cannot appear half-built.
- Inside a request, lines follow the stored `modules` array, which is stable. The fallback for an unexpected module orders by `module`, then `id`. So the output does not depend on the order the database returns the rows in, and T-5 proves it by shuffling the input.
- supabase-js appends each `.order()` call, so the two calls produce `order=requested_at.desc,id.desc`. T-3 asserts the call order. The `(user_id, requested_at DESC)` index serves the first read, and the `UNIQUE (request_id, module)` index serves the `.in('request_id', …)` read.

### Rulings on the open items

| # | Ruling |
|---|---|
| MX1B-1 | ✅ **Server-only switch; the browser learns it from the GET's 404.** The AC already requires the route to answer 404 while the switch is off, so the probe adds no second route and no `NEXT_PUBLIC_` copy that could disagree with the server. The sibling `isAccountSelfDeleteEnabled()` has a separate check route that answers `{ enabled: false }`. A separate route is not needed here. **Subject to C-1:** only the route's own 404 may mean "off" |
| MX1B-2 | ✅ **`SettingsDrawer` may be used by `ExportDrawer` only.** This is the SA ruling its header asks for. It is a named exception for this one drawer, not a general opening of the folder. Props only. Do not pass `isDirty` / `discardCopy`, because the drawer has nothing to discard. **Do not edit `SettingsDrawer.tsx`** (C-11). Its header stays true as written, and `ExportDrawer`'s own header cites "SA MX1B-2" |
| MX1B-3 | ✅ **Approved deviation: the copy lives in `exportDrawerCopy.ts`.** `/settings` and `/v2/settings` have no `LanguageProvider`, and the DE-9 C-10 precedent applies. The S-7 hotspot is left untouched, which removes the merge risk with DELETE's D3. Log the deviation in the coordination file and have BA splice it into the requirement §6 status line, as §17 says. The ZIP label stays in `downloadMyDataCopy.ts`, unchanged |
| MX1B-4 | ✅ **Remove `listHistoryForUser` now.** It has no caller, limits the wrong unit, and keeping it would leave two history readers. The rest of the removal is C-3 |
| MX1B-5 | ✅ "Export again at {time}" when the drawer opens moves to MX-4. Computing it in TypeScript would create a second authority for the start function's counting rule. The MX-1b AC does not ask for it |
| MX1B-6 | ✅ **No retry in MX-1b.** The MX-3 workplan rules on it. SA's current leaning, to be confirmed there: **no retry at all**, because the module emails themselves confirm the export, and a retry would be a second queue. If MX-3 does retry, it must accept the duplicate risk in C-7: a send from MX-1b carries no idempotency key, so a later keyed retry cannot dedupe against it |
| MX1B-7 | ✅ **Not recorded in `email_sends`.** That table feeds business-mail delivery webhooks and automation statistics. The account-deletion emails (`account/delete/route.ts`) are not recorded there either, and bounces are not tracked for export mail (XC-9) |
| MX1B-8 | ✅ `201` with `{ requestId, sentTo, requestedEmailSent }`. A new resource row is created, so 201 is the correct status. Refusals stay 409 with a `code` (the ZIP route's shape) |
| MX1B-9 | ✅ 20 requests, clamped to 1..50. This matches `listForRequestsOfUser`'s 50-id cap. Paging is MX-4's call |
| Guard check 4 | ✅ **Extend it** to `/api/business-os/export-requests`, with the planted LF and CRLF negative controls. EXPORT owns the guard (B.8). Check 3 needs the same extension (C-5) |
| `RATE_LIMITS.create` | ✅ **Reuse it**, as the ZIP start does (`data-export-start`). The database holds the real limit, and reusing the rule keeps `rateLimit.ts` (S-17) unedited. Note that the throttle is per IP (10 per 15 min) and fails open. That is acceptable for an abuse brake |
| Best-effort "requested" email | ✅ **Awaited, best effort, with the request kept on failure.** This is correct: the request is the durable fact. The timeout semantics are in C-7 |

### Conditions

| ID | Condition | Severity | Where |
|---|---|---|---|
| C-1 | **Only the route's own 404 means "off".** Map the probe's results as follows. A 404 means `off`. A 200 with a valid body means `on` with the history. Any other HTTP answer **with a JSON body from our route** (401, 429, 500, or a body of the wrong shape) means `on`, and the drawer shows "Your export history could not be loaded" with Try again. A network error, the 5 s timeout, or a non-JSON platform page (502 / 504) means `unknown`, and the button falls back to the ZIP path, as today. The reason: from MX-4 the ZIP start answers 404 while the switch is on, so treating a server error as "off" would send the owner into a flow that refuses them. Split today's `unavailable` verdict into these two cases | Medium | §8 verdict type, §9 `useModuleExportSwitch`, T-7, T-8 |
| C-2 | **Write `DATA_EXPORT_REQUESTED` with `logAndFlush`** (`lib/audit/boundedAuditFlush.ts`: bounded, never rejects), after `started` and before the email is sent. It is the only audit row this request produces. The route responds within seconds and has no later flush, so a queued `log()` can be lost when the instance freezes (new-api-route WC-7). The ZIP route flushes its READY and FAILED rows the same way. T-2 must assert that the flush is called, and that a flush that times out or fails still returns 201 | Medium | §4.1 step 7, D-8, T-2 |
| C-3 | **Remove the dead code together with `listHistoryForUser`:** `MODULE_JOB_HISTORY_SELECT`, `HISTORY_LIMIT_MAX`, `historyRowSchema` and `ModuleJobHistoryItem`, plus their test imports. Rewrite the file-header bullet (line 16) that names `listHistoryForUser` so it names `listForRequestsOfUser`. Keep `modulePartSchema`, because the claim parse still uses it | Low | §6.2, T-4 |
| C-4 | **`exportHistory.ts` must not import either repository file**, not even a type. The callers guard pattern `\bBusinessOsExport(Request\|ModuleJob)Repository\b` matches the import path. Instead, declare its input interfaces in the file, structurally, and let the route pass the repository rows in. The browser seam does the same (§8, a client copy of the DTO) | Low | §5 step 3, T-12 |
| C-5 | **Extend guard check 3 as well:** an entry file that fetches `/api/business-os/export-requests` is a problem, in the same way as the existing `data-export` fetch pattern. Give it a planted negative control | Low | T-11 |
| C-6 | **T-9 gains one case: Escape while the POST is in flight closes neither layer.** `SettingsDrawer` prevents the Escape, and Radix must not pass it on to the outer dialog. Keep the real `components/ui/dialog` host: that is DL-2's actual shape, because `DeleteAccountDrawer` renders inside the Danger Zone's `DialogContent`. QA 5 also checks a pointer press on the outer dialog's area in a real browser, because jsdom does not model `pointer-events` | Low | T-9, QA 5 |
| C-7 | **Distinguish an email timeout from a failure.** When the 10 s guard wins, log `email_timeout` rather than `email_failed`. Losing the race does not cancel the send, so the mail may still arrive while `requested_email_sent_at` stays NULL. Record this in §18 as the duplicate hazard for MX1B-6. A mark that fails after a successful send leaves the same state | Low | §4.1 step 8, §18 |
| C-8 | **Every date in the drawer uses the owner's clock:** the "Requested {date}" heading, "sent {date}" and `retryAt` all go through `formatExportTime` with `useBusinessTimezone()`, with UTC labelled when no zone is set. Each value is wrapped in `<bdi>`. T-8 covers one history date in Hebrew | Low | §10 items 6 and 7, T-8 |
| C-9 | **Carry-over for MX-4, written into this workplan now.** `ModuleExportEntry` renders no ZIP status line. Once the switch is on, an owner who still has a ready ZIP loses the only "Download again" link to it. That breaks XC-15 and the MX-4 AC ("ready ZIPs stay downloadable until they expire"). MX-1b cannot reach this state, because the switch is off and never on in Preview. Add it to §18 and as a new row in §19, marked as an MX-4 must-do, so it is not lost. TL relays it into plan §4.7 | Medium (record only, no code now) | §18, §19 |
| C-10 | **Local QA writes real rows into the shared production database and sends a real email.** Use the `+test` account only, and record the request ids in the QA report. Those rows must be removed through test-account cleanup **before MX-3 merges**, or the worker would claim and send them. Add this as an MX-3 carry-over line in §18 (K-4 already describes it; make it a gate). Until then, the test account's own `in_progress` refusal is expected | Low | §16, §18 K-4 |
| C-11 | **No edit to `SettingsDrawer.tsx`.** The settings components are neither EXPORT-owned nor listed in B.8, so any edit would first need a claim in the coordination file. The ruling lives in this workplan and in `ExportDrawer`'s header | Low | §10, §13 |
| C-12 | **The ZIP body move must be verifiable as a move.** At hand-over, show `git diff --color-moved` (or `-M`) evidence that `ZipDownloadControl.tsx` equals the old body, apart from the name and the `onBeforePrepare` hook. Keep the assertions in `DownloadMyDataButton.test.tsx` unchanged, apart from the probe mock. While a click waits on the probe, show the existing spinner and `aria-busy`, so the click does not look dead | Low | §9, task 9 |

### Optimisation suggestions (not blocking)

- **Reload the history when the drawer opens.** The first page comes from the mount-time probe and may be minutes old by the time the owner opens the drawer. One GET per open is cheap.
- **MX-4: avoid the label flash once the switch is on.** While the probe is unknown, the ZIP control renders "Download my data" and then swaps to "Export data". That is right while the switch is off (nothing changes), but at MX-4 consider a neutral state while the probe is unknown. MX-6 removes the probe entirely.
- **Restyle the checkbox through `className`.** `components/ui/checkbox` hard-codes `bg-blue-600` / `border-gray-300`. Override them with V2 tokens (`--v2-primary`, `--v2-border`) in `className`, and do not edit the primitive.
- **Return `requested_at` from the start function at MX-3 or MX-7, if either touches it.** That would save the `findByIdForUser` read-back. It is not worth a migration on its own.

### Business questions for the user (plain terms)

| # | Question | Suggested answer | Needed before |
|---|---|---|---|
| BQ-E5-1 | (Dev's, kept.) When our support team sends an owner their export, should it appear in the owner's export history, and how should it be labelled? | Yes, labelled "Sent by AgentPilot support" | MX-5 |
| BQ-E5-2 | (Dev's, narrowed.) The requirement already says the Settings row reads **"Export data"**. The open part is the other buttons: the Danger Zone, the AgentPilot security pages and the deletion window. Today they say "Download my data". Once the new export is on, should they also say "Export data"? | Yes, "Export data" everywhere, because nothing downloads in the browser any more. While the new export is off, every button keeps "Download my data" | MX-4 switch-on |
| BQ-E5-3 | (New.) When the owner opens the export window, should every part start **ticked** (one press of Export sends everything) or **unticked** (the owner picks)? | Unticked, with "Select all" one press away, as the workplan has it. This is a one-line change either way | MX-4 switch-on |

None of the three blocks MX-1b.

### Approval

[x] Workplan approved, proceed to implementation. **Approved with conditions:** C-1, C-2 and C-9 (record only) before hand-over to code review; C-3 to C-8 and C-10 to C-12 are checked in code review.

**Verdict: ⚠️ approved with conditions**

---

## SA Code Review — 2026-10-27

**Reviewed by SA — 2026-10-27** (worktree `neuronforge-mx1b`, branch `feature/bos-export-mx1b-route-drawer` at `4e75ed9f`, uncommitted; no commit, no stash, no database access). **Status:** ✅ Code Approved, with one condition (CR-1) to fix before QA starts.

### What was checked

| Area | How | Result |
|---|---|---|
| Diff scope | `git status`, `git diff`, every untracked file read | 13 modified, 17 new files (§13 list plus X-1). No DELETE-owned file: `DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `BusinessDetail.tsx`, `app/admin/users/page.tsx`, `DeleteAccountDrawer.tsx`, `lib/business-os/account-deletion/**` and the cleanup-regen files are all untouched. `SettingsDrawer.tsx`, `components/ui/*`, `useDownloadMyData.ts`, `downloadMyDataCopy.ts`, the ZIP routes, `rateLimit.ts`, `lib/audit/*`, `emailTransport.ts` and the translation bundles are also untouched. `docs/requirements/...REQUIREMENT.md` holds only TL's BQ records |
| Switch-off order | `route.ts:149`, `:191`; T-2 `switch off` and the `source rules` test | `if (!isModuleExportEnabled()) return notFound();` is the first statement of both handlers. It runs before the correlation id, `getUser`, the body read, `rateLimit` and every repository call. T-2 covers five off values and asserts that none of those collaborators is called, and that the repository constructor is never called |
| Tenant isolation | `route.ts`, both repositories | The only account id is `getUser().id`. The body is `z.object({ modules: requestedModulesSchema() }).strict()`, so a `userId` key is a 400 (tested). The GET ignores `?userId=` (tested). `listRecentForUser`: `.eq('user_id')`. `listForRequestsOfUser`: `.eq('user_id')` + `.in('request_id', ids from the user-scoped read)`. `markRequestedEmailSent`: `.eq('id').eq('user_id').is('requested_email_sent_at', null)`, `{ count: 'exact' }`, no `.select()`. `findByIdForUser`: id + user_id. `requestId` comes only from the start function's answer |
| `new-api-route` checklist | Skill final checklist against `route.ts` | Auth first (after the switch, as ruled), Zod `.strict()` before business logic, repositories only, Pino child logger with `correlationId`, `Cache-Control: no-store`, the error format with `details` only under `NODE_ENV === 'development'` (all three sites, `devDetails` and the 400 `flatten()`). The production-500 test asserts no `details` and no DB text. Audit: `logAndFlush` (C-2) |
| `logAndFlush` before the email | `route.ts:251-273`; T-2 "C-2 order" and "slow flush" | Awaited after `started` and before `sendRequestedEmail`. The order test records `['audit', 'email']`. Refusals write no audit |
| Privacy of logs | Every logger call in `route.ts`, the repositories and the seam; T-2 privacy test | Ids, counts and codes only. `moduleCount`, never the list. The login email is never logged (`sentTo` is returned only to its owner), and `sendEmail` gets `redactRecipientInLogs: true`. The seam logs status codes only. The audit `details` holds `request_id`, the module ids and `origin`, as XC-13 allows |
| `console.*` / entitlements | grep on every touched `.ts`/`.tsx` | 0 and 0. The route's source test pins both |
| ZIP body move (C-12) | Re-derived the diff myself: `git show 4e75ed9f:…/DownloadMyDataButton.tsx` against `ZipDownloadControl.tsx`, and checked that Dev's scratchpad base file equals `main` byte for byte | 69 changed lines in total, all of them in Dev's list: the header, the React import, the props name plus `onBeforePrepare`, the function name, the `handlePrepare` block, `onClick` ×2, the two live regions reading `isZipPreparing`, and the default export. Notices, the status line, "Download again" and the classes are unchanged. `DownloadMyDataButton` keeps its name, path, props (`variant`, `className?`) and default export |
| Probe verdicts (C-1) | `fetchModuleExportHistory`, `useModuleExportSwitch`; T-7, T-8 | Four verdicts. `off` only for a 404 **with our `{ success: false }` JSON**. An HTML or foreign-shape 404 → `unknown`. Non-JSON → `unknown`. Any other JSON status → `error` (maps to **on**). A 200 of the wrong shape → `error`. Network or 5 s abort → `unknown`. **No server error with our JSON body falls back to the ZIP.** The only server-side failures that reach the ZIP are non-JSON platform pages (a function crash, a 502/504), which C-1 assigns to `unknown` on purpose. The route's own catch-all always answers JSON |
| Click before the probe answers | `DownloadMyDataButton`, `ZipDownloadControl.handlePrepare`, `ModuleExportEntry` (X-8); T-8 | Spinner, `aria-busy` and `disabled` while it waits. On `on`, the ZIP control unmounts, and its continuation is guarded by `isMountedRef`, so no ZIP starts. The drawer opens through the effect (X-8, needed and tested). On `off`/`unknown`, `prepare()` runs as today |
| Nested Radix layer (SR-9, C-6) | `ExportDrawer` inside `ModuleExportEntry`'s tree; T-9 with real `components/ui/dialog` | Focus moves inside the drawer, Escape closes only the drawer, focus returns to the entry, a press inside does not close the dialog, and a second Escape closes the dialog. While the POST is in flight, Escape closes neither layer. No stand-ins. A pointer press on the outer area is QA 5 (jsdom has no `pointer-events`) |
| Hebrew RTL and clock (C-8) | `ExportDrawer.tsx`, `ModuleExportEntry.tsx`; T-8 Hebrew block | The side follows `isRTL`. `dir` is set on the body, with `text-start`. The chevron is mirrored (accountCard guard + T-8). "Requested {date}", "Sent {date}" and the `retryAt` time all go through `formatExportTime(…, timeZoneOptions)` from `useBusinessTimezone()` inside `<bdi>`. T-8 asserts an Asia/Jerusalem date inside `<bdi>`. The toast's email is not isolated (CR-3) |
| History read (§5) | Both repositories, `exportHistory.ts`; T-3, T-4, T-5 | `order('requested_at', desc)` **then** `order('id', desc)`, then `limit` (1..50, default 20). The call order is asserted. The job read has no limit. The assembler orders lines by `request.modules`, and extras by module then id. A shuffle test over five seeds gives identical output, and 21 requests in gives 21 complete requests out. Rows are parsed one at a time and a bad row is dropped by id (both repositories). The history-only part schema reads `state` only |
| `exportHistory.ts` has no imports (C-4) | File + T-5 source scan (`/^import /m`) | Zero imports. Structural input interfaces |
| Guard checks 3 and 4 (C-5) | `oneExportControl.guard.test.ts` | Check 3 flags a `fetch(` of `export-requests`, with planted LF and CRLF negative controls. Check 4 covers both routes, with five negative and positive controls (a second client, LF/CRLF, the seam, `app/api/`, a comment). The non-vacuity check now requires the seam to name both routes |
| Callers guard (T-12) | `exportRequestRepositories.callers.guard.test.ts` | Route + its test are added to the two class rules only. Table and SQL-function rules are unchanged. `exportHistory.ts` does not name either class |
| Copy (BQ-E5-1/2/3, BQ-35) | `exportDrawerCopy.ts`, `exportRequestedEmail.ts`; T-6, T-10 | "Export data" appears only on the switch-on path. Nothing is pre-ticked, and Export is disabled with zero ticks. The toast uses the user's wording. The history follows the invites / boost-purchases list pattern (divided rows, status chip, muted date line, plain empty line, a failed read with Try again). "Sent by AgentPilot support" is shown for `origin = 'admin'`. No "delivered" word in any language (tested). The files sentence is final |
| X-1 `accountCard.guard.test.ts` | Diff | **Acceptable.** It is test-only, keeps the S-5 assertion at full strength (both controls must mirror, and the button must render both), and touches no DELETE-owned or B-list file. TL logs it in the coordination file with the E5 PR line, as Dev asks |
| X-2…X-8 | Diff | All acceptable. X-5 (`import type` from the pure, import-free `exportHistory.ts` in the client seam) is safe: the import is erased at compile time, the runtime shape is still Zod-checked, and C-4 concerns the repositories, which the seam never names |

### Per-condition result

| # | Condition | Result |
|---|---|---|
| C-1 | Only the route's own 404 means off | ✅ Met (see "Probe verdicts" above; T-7 covers an HTML 404 and a foreign JSON 404) |
| C-2 | `logAndFlush`, after `started`, before the email | ✅ Met (`route.ts:251`; order + slow-flush tests) |
| C-3 | Dead history code removed | ✅ Met. `MODULE_JOB_HISTORY_SELECT`, `HISTORY_LIMIT_MAX`, the old row schema, `ModuleJobHistoryItem`, `listHistoryForUser` and the now-unused `EXPORT_REQUEST_ORIGINS` / `ExportRequestOrigin` imports are all gone. The header bullet is rewritten, and `modulePartSchema` is kept |
| C-4 | `exportHistory.ts` imports neither repository | ✅ Met (no imports at all; source test) |
| C-5 | Guard check 3 extended | ✅ Met (plus check 4, with negative controls) |
| C-6 | Escape while in flight closes neither layer | ✅ Met (T-9 second case, real Radix) |
| C-7 | `email_timeout` vs `email_failed`, `mark_failed` | ✅ Met (`route.ts:136-137`, `:280`; three tests; §18 K-7) |
| C-8 | Every drawer date on the owner's clock, in `<bdi>` | ✅ Met for every date. See CR-3 for the toast's address |
| C-9 | MX-4 carry-over recorded | ✅ Met (§18 K-8, §19 MX1B-10, `ModuleExportEntry.tsx` header) |
| C-10 | `+test` only, ids recorded, MX-3 gate | ✅ Met for Dev (no live rows). The gate is in §18 K-4. **QA owns the id list** |
| C-11 | No edit to `SettingsDrawer.tsx` | ✅ Met (untouched; `ExportDrawer` header cites MX1B-2) |
| C-12 | Move verifiable; spinner while waiting | ✅ Met (independently re-derived; T-8) |

### Code Review Comments

| ID | Finding | Severity | File:line | Fix |
|---|---|---|---|---|
| CR-1 | **The "started" confirmation is not announced to screen-reader users.** sonner 2.0.7 renders its `Toaster` in place (no portal) inside `PlatformShell`. While the export drawer is open, Radix's modal `Dialog` (the `Sheet`) runs `hideOthers(content)`, which sets `aria-hidden` on the app root. That root contains the Toaster's live region, so the toast is painted but not announced. After a successful start, the drawer's own `role="status"` region stays empty, unless the confirmation email failed. QA 7 ("the started text announced politely") would fail | Medium | `components/business-os/data-export/ExportDrawer.tsx:121-127`, `:202-204`; `useExportDrawer.ts:159-164` | Keep the toast (BQ-E5-3). **Also** put the same sentence into the drawer's `role="status"` region after a `started` verdict, with the email in `<bdi>`, and clear it on the next open or submit. Add one T-8 assertion that the status region holds the address after a start. About 5 lines plus 1 assertion. **Fix before QA** |
| CR-2 | `daily_limit` without `retryAt` is mapped to `in_progress`, which shows "An export is already running", a false sentence. It is unreachable today, because the repository type makes `retryAt` a required string for `daily_limit` | Low | `lib/client/businessOsDataExport.ts` (`startModuleExport`, the `export_daily_limit` branch) | Map it to `failed` (or a time-less limit sentence). Optional |
| CR-3 | The toast's `{email}` is a plain string. In Hebrew, the LTR address sits inside RTL text with no isolation. Every other drawer value is in `<bdi>` | Low | `ExportDrawer.tsx:124` | Wrap the address in U+2068 / U+2069 (FSI/PDI) when filling `startedToast`, or render the toast body as JSX with `<bdi>`. This folds into CR-1 |
| CR-4 | The Hebrew email interpolates `{date}` and `{time} (UTC)` with no isolation, so the bidi algorithm can flip the parentheses and the `(UTC)` around a time in RTL | Low | `lib/business-os/data-export/exportRequestedEmail.ts:117`, `:125` | Wrap the interpolated date and time in `<bdi>` in the HTML, and in FSI/PDI in the text part. QA 6 checks the real rendering in Gmail |
| CR-5 | `(result.data as ExportEmailLanguage \| null)`: the cast is redundant, because `SupportedLanguage` is the same three-language union | Low (style) | `app/api/business-os/export-requests/route.ts:101` | Drop the cast, or type the helper on `SupportedLanguage`. Optional |

No High findings. The SA did not fix any finding directly: CR-1 and CR-3 belong together and are behavioural, so they go back to Dev.

### Tests run (SA, 2026-10-27)

| Run | Result |
|---|---|
| The new and changed suites (route, both repositories, callers guard, history, email, both seam suites, flag, every `components/business-os/data-export` suite, account card guard) | **22 suites, 358 tests, all pass** (Dev's 17 plus 5 sibling suites in the same folders) |
| Entry-point neighbours: `components/business-os/{purge,account-deletion}`, `components/settings`, `components/v2/settings`, `app/business-os/settings`, `app/admin/users` data-export block + source guard | **26 suites, 488 tests, all pass.** None of them broke on the new probe |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` | Ran to completion with no heap / V8 trace. 1,849 errors in total (exit 1), the same count Dev reported. **0 errors in any touched file.** The one data-export hit is `exportClassification.test.ts:2029`, which this branch does not touch (pre-existing) |
| `npx eslint` on the route, the data-export folder, the two lib files, the seam, both repositories, `featureFlags.ts` | Clean |
| `oneAddressPolicy.guard.test.ts` | **Confirmed pre-existing.** It fails identically in the `main` checkout (`neuronforge` at `1baf1f9b`): 1 of 4 tests, listing 8 files as Windows backslash paths (an allow-list compared against `\`-separated paths, a Windows-only artefact). The branch touches none of those 8 files, nor the test |

### Optimisation Suggestions

- **MX-4:** the probe answers 404 before auth, so it is cheap while the switch is off. Once the switch is on, every mount of the button on four pages pays for an auth check, a throttle hit and two reads. If MX-4 keeps the probe until MX-6, consider a lighter `?probe=1` answer that skips the history read. Not needed now.
- **MX-4 (repeat of the workplan-review note):** use a neutral label while the probe is `unknown`, so the label does not flash from "Download my data" to "Export data" once the switch is on.
- `ModuleExportEntry` and `ZipDownloadControl` now carry two copies of the row and button markup. MX-6 deletes the ZIP control, so no shared component is needed before then.

### QA focus

1. **CR-1 fixed first.** Then a screen-reader spot check that "Export started … {address}" is announced (QA 7).
2. **Switch off on all four entry points:** the ZIP behaves exactly as today. Use `curl` for POST and GET → 404, signed in and signed out.
3. **Click during the probe:** throttle the network in DevTools, click before the GET answers, and confirm the spinner, then either the drawer opens (switch on) or the ZIP starts (switch off). There must never be both.
4. **Inside the Danger Zone dialog (QA 5):** Escape closes only the drawer. A **pointer press on the outer dialog's visible area** does not close both layers (jsdom cannot test this). Focus returns to "Export data".
5. **Hebrew (QA 6):** the drawer opens from the left, history dates are in the owner's zone and read whole, and the toast's address reads whole (CR-3). In the Hebrew email, check the date and time line with "(UTC)" in a real client (CR-4).
6. **Probe `error` path:** with the switch on and the session expired (or the GET forced to answer 500), the drawer must still open, with "history could not be loaded" + Try again. It must not fall back to the ZIP.
7. **C-10:** use the `+test` account only, and record every request id created. Those rows must be cleaned up before MX-3 merges.

### Code Approved for QA: Yes, conditional on CR-1 (and CR-3 with it) being fixed first. CR-2, CR-4 and CR-5 are optional and do not block.

**SA ruling, post-QA, 2026-10-27:** ✅ QA's `OWNER_ROUTE_QA_TEST` allow-list entry is accepted. `route.qa.test.ts` is a test that mocks both repositories as `route.test.ts` does, it is added to the two class rules only, and the table and SQL-function rules are unchanged. E-2 is fixed by the SA: guard check 4's title now reads "export routes (ZIP and module export)", a title-only change. Re-run: the callers guard, `oneExportControl` and both route suites pass (4 suites, 122 tests).

### Dev fixes (2026-10-27)

All five findings are fixed. The work is still uncommitted; there was no stash and no database access.

| # | Fix | Where | Test |
|---|---|---|---|
| CR-1 | Fixed by Dev: after a started request, the drawer's own polite `role="status"` region shows the same sentence as the toast, "Export started. The exported files will be sent to {email} once ready.", with the address in `<bdi dir="ltr">`. The sonner toast is kept. `useExportDrawer` now exposes `startedTo` (the login email from the 201), which is cleared on every open and on the next Export | `useExportDrawer.ts`, `ExportDrawer.tsx` (`WithEmail`, status region) | `ModuleExport.render.test.tsx`, "Export sends the ticked modules…": the status region holds the sentence, and its `<bdi>` holds exactly the address |
| CR-3 | Fixed by Dev: the toast's `{email}` is wrapped in U+2068 FSI / U+2069 PDI | `ExportDrawer.tsx` (`onStarted`) | Same test: the toast is called with `⁨{email}⁩` |
| CR-2 | Fixed by Dev: a `409 export_daily_limit` with no `retryAt` (missing or `null`) maps to `failed`, never `in_progress`, and is logged at `error` | `lib/client/businessOsDataExport.ts` (`startModuleExport`) | `businessOsDataExport.moduleExport.test.ts`: two new rows (missing and `null` `retryAt`) → `failed` |
| CR-4 | Fixed by Dev: in the Hebrew email the date and "time (UTC)" are isolated, `<bdi>` in the HTML and FSI/PDI in the text part. Left-to-right emails (en, es) are unchanged. The HTML sentence is now built from the escaped template with escaped, isolated values | `lib/business-os/data-export/exportRequestedEmail.ts` | `exportRequestedEmail.test.ts`, new test: Hebrew without a zone has `<bdi>{date}</bdi>`, `<bdi>{time (UTC)}</bdi>` and FSI/PDI in the text; English has neither |
| CR-5 | Fixed by Dev: the redundant `as ExportEmailLanguage \| null` cast is dropped (`SupportedLanguage` is the same union) | `app/api/business-os/export-requests/route.ts:101` | Route suite unchanged and green |

**Re-run after the fixes:**
- **The 17 new and changed suites:** 17 suites, **297 tests, all pass**. That is 294, plus the two CR-2 rows and the CR-4 test; CR-1 and CR-3 added assertions to an existing test.
- **ESLint** on the eight CR-touched files: clean. `console.*` count is 0 in each.
- **tsc** (`NODE_OPTIONS=--max-old-space-size=8192`): completed with no OOM trace and **0 errors in touched files**. The repo-wide total is unchanged at 1,849, all pre-existing. One of them is in `lib/business-os/data-export/__tests__/exportClassification.test.ts`, which this slice does not touch.

---

## QA Testing Report

See `## QA Report — 2026-10-27` below.

## QA Report — 2026-10-27

**QA — 2026-10-27** (worktree `neuronforge-mx1b`, branch `feature/bos-export-mx1b-route-drawer` at `4e75ed9f`, uncommitted. No commit, no `git stash`, no live database, the app was not run, no email sent.)
**Test mode:** full
**Strategy used:** A (unit) + B (integration, every collaborator mocked) + in-memory harnesses: the real route handlers bridged to the real browser seam through a fake `fetch`, and the real button / drawer / seam rendered in jsdom with only `fetch` mocked. Real Radix for the stacking checks. Option D (browser) was not possible under the no-database rule, so the browser items are listed under "Not verified" for TL.
**Focus:** api, ui, security, schema
**Skipped:** the manual browser and screen-reader checks (QA plan rows 1–9, live parts). Local dev shares the production database and TL ruled no app run and no email.
**Input source:** prompt keywords (TL brief) + workplan §16 + the "QA focus" list in SA's code review

### QA test files added (all pass)

| File | Tests | What it adds |
|---|---|---|
| `app/api/business-os/export-requests/__tests__/route.qa.test.ts` | 44 | Route ↔ seam round trip: `global.fetch` calls the real `GET`/`POST`, so each seam verdict comes from a Response the real route built. 12 "off" values (incl. `'true '`, `' true'`, `'True'`, `'on'`, `'yes'`), with spies proving the body (`text`/`json`), the headers, the session, the throttle, both repository constructors, preferences, clock, transport and audit are never touched. Every refusal mapped end to end, incl. the daily limit with, without and with `null` `retryAt` (CR-2). Email trimmed. The email is sent once even when the mark fails. A query-string `userId` on POST is ignored. Invalid bodies do not use up the throttle. History tie-break, a dropped job row and an empty history through the route |
| `components/business-os/data-export/__tests__/ModuleExport.probe.qa.test.tsx` | 20 | The real seam and the real `useModuleExportSwitch` in the button (only `fetch`, the ZIP calls, sonner and the language context are mocked). C-1: our JSON 500 / 401 / 429 / wrong-shape 200 → "Export data" + "could not be loaded" + Try again, never the ZIP. Our 404, an HTML 404, a foreign JSON 404, a non-JSON 502 / 504, a network error and the 5 s timeout → the ZIP, which starts once, with no POST to the new route. A click during a hung probe: spinner + `aria-busy` + disabled, nothing at 4.9 s, the ZIP once at 5 s (double click included). A double click before an "on" answer: one drawer, no ZIP, no POST, and Escape returns focus to the new "Export data" trigger. The history keeps the server order on a `requested_at` tie, and only the admin request is tagged. Hebrew: the status line holds the Hebrew sentence with the address alone in `<bdi dir="ltr">`, and the toast gets FSI…PDI. The daily-limit time is on the Asia/Jerusalem clock in `<bdi>` inside the alert region. Requested and sent dates each sit in their own `<bdi>` |
| `components/business-os/data-export/__tests__/ExportDrawer.stacking.qa.test.tsx` | 1 | Inside a real `components/ui/dialog`: while the request is in flight, the shell's X is disabled and two Escapes close neither layer. The request then **starts**: the status line confirms and one toast fires. Escape then closes only the drawer, and focus returns to the entry. Re-opening clears the old confirmation and the ticks. Escape twice closes the drawer, then the dialog |

**Mutation check (the QA tests fail when they should):** with `useModuleExportSwitch` temporarily changed to map `error` → off, 6 of the 20 probe tests failed. The file was restored byte for byte (`cmp`).

**Guard negative controls on real planted files (all removed afterwards; `git diff` clean for the touched tracked file):**
- check 4: a new client file `fetch('/api/business-os/export-requests')` → red, with LF and with CRLF;
- check 3: the same `fetch` appended to `components/settings/SecurityTab.tsx` → red (checks 3 and 4);
- callers guard: a planted `lib/` file naming `BusinessOsExportRequestRepository` → red.

### Results per item (TL brief)

| # | Item | Tested? | Result | Notes |
|---|---|---|---|---|
| 1a | Switch off: GET and POST 404, nothing runs, for every "off" value | ✅ | Pass | 12 values, plus a signed-out caller (404, not 401). No body read, no header read, no `getUser`, no throttle, no repository, no email, no audit |
| 1b | Switch off: the button renders the ZIP control unchanged | ✅ | Pass | `DownloadMyDataButton.test.tsx`: only the 3-line probe mock was added, and its 31 tests pass. QA: our 404 → "Download my data", and a click starts the ZIP once |
| 2a | Happy path: 201, audit flushed before the email, email once, status line + toast with the address | ✅ | Pass | Order `['audit','email']`. `sendEmail` ×1, `logAndFlush` ×1, mark ×1. Status region + toast verified in en (T-8) and he (QA) |
| 2b | Refusals: in progress, daily limit with / without `retryAt`, unknown module, switched-off module, empty, duplicate, `userId` body, 401, rate limit | ✅ | Pass | Each mapped route → seam. None of them audits or emails. 400s do not use up the throttle. No `retryAt` → `failed`, never "already running" (CR-2) |
| 3 | Four probe outcomes (C-1) | ✅ | Pass | Our JSON 500/401/429 → drawer, never the ZIP. Non-JSON 502/504, network error, 5 s timeout → the ZIP. Also an HTML or foreign JSON 404 → the ZIP |
| 4 | Click while the probe is pending | ✅ | Pass | Spinner, `aria-busy` and disabled while waiting, then exactly one path: the ZIP ×1 on off or timeout, or the drawer ×1 with no ZIP on on. Double clicks included |
| 5 | History: tie-break and determinism, a malformed row skipped, the origin tag, empty state | ✅ | Pass | Repository: `requested_at DESC, id DESC`, per-row parse (T-3/T-4). Route: the order is kept and the output is the same when job rows are reversed. A dropped job leaves only its line out. UI: server order kept, the tag only on `origin='admin'`, the empty sentence. See E-1 for the seam's all-or-nothing parse |
| 6 | Nested Radix: Escape, focus return, Escape in flight | ✅ | Pass | T-9 (2 cases) + QA (1 case, the in-flight request **started**). jsdom cannot model a pointer press on the outer dialog's own area (browser) |
| 7 | Hebrew / RTL: `<bdi>` dates on the owner's clock, the address isolated in the toast and the status line, the Hebrew email's date and "(UTC)" | ✅ | Pass | Drawer: QA + T-8. Email: `exportRequestedEmail.test.ts` (CR-4: `<bdi>` in the HTML, FSI/PDI in the text, en unchanged). Real bidi rendering → browser / Gmail |
| 8 | Guards 3 and 4 with negative controls; `oneExportControl`, callers guard, `accountCard` (X-1) | ✅ | Pass | 14/14, 24/24, accountCard green. Real planted violations turn them red (above) |
| 9 | Regression neighbourhood | ✅ | Pass (1 pre-existing) | See counts. `oneAddressPolicy.guard.test.ts` fails identically on the `main` checkout (`1baf1f9b`): Windows `\` paths against a `/` allow-list. The branch touches none of the listed files, nor the test |

### Counts

| Run | Result |
|---|---|
| The 3 QA files | **3 suites, 65 tests, all pass** |
| Dev's new / changed suites + their folder siblings (35 suites) | **926 / 926 pass** (before the QA files) |
| Regression: `app/api/business-os/{export-requests,data-exports}`, `components/business-os/{data-export,purge,account-deletion,settings}`, `lib/business-os/{data-export,account-deletion}`, `lib/repositories/__tests__`, `lib/client`, `lib/utils`, `app/business-os/settings`, `components/settings`, `components/v2/settings`, `app/admin/users`, the 20261095 migration test | **286 suites, 6,297 tests: 6,296 pass, 1 fails** (`oneAddressPolicy`, pre-existing on `main`) |
| `npx tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=8192`) | Completed, no OOM trace. 1,849 errors in total (the same count as Dev and SA, all pre-existing). **0 in any touched file or QA file** |
| `npx eslint` on the 3 QA files | Clean |
| CRLF on Windows | No CRLF flake seen. The worktree checks files out as CRLF (`git` warns "LF will be replaced by CRLF" for 6 touched files), and every guard passed on CRLF. The guard's own LF/CRLF plants both fail as they should |

### Issues Found

#### Bugs (must fix before commit)
None.

#### QA change to a Dev-owned guard (SA please confirm)
1. **`lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts`: one allow-list entry added by QA.** `route.qa.test.ts` mocks the two repositories by module path, exactly as `route.test.ts` does, so the guard (correctly) flagged it. QA added `OWNER_ROUTE_QA_TEST` to the two **class** rules only. The table and SQL-function rules are unchanged, and the planted negative control still fails. If SA prefers not to widen the list, delete `route.qa.test.ts` and the entry together. Severity: Low (process)

#### Performance Issues (should fix)
None for MX-1b. SA's optimisation note stands for MX-4: once the switch is on, every mount of the button does an auth check, a throttle hit and two reads.

#### Edge Cases (nice to fix)
1. **E-1: the browser seam parses the history all or nothing.** One row with a status the seam does not know (for example one added by MX-3 without updating `HISTORY_STATUSES` in `lib/client/businessOsDataExport.ts`) makes the whole drawer say "could not be loaded". The repositories avoid this by parsing row by row. It cannot happen today: the route builds the DTO from Zod-parsed rows, and the DB CHECK equals the enum. Carry to MX-3: keep the two status lists in lockstep, or parse per row in the seam. Pinned by a QA test. Severity: Low
2. **E-2: the title of guard check 4 still says "only the client seam names the zip routes"**, though it now covers the module export route too. Cosmetic. Severity: Low
3. **E-3: in jsdom the drawer has two "Close" buttons**: the shell's X and the sheet primitive's built-in X, which `SettingsDrawer` hides with `[&>button]:hidden`. This is the existing `SettingsDrawer` pattern and is not new. The browser check should confirm that only one X is visible and reachable by Tab. Severity: Low (verify only)

### Not verified (and why) — for TL in a real browser / screen reader

Local dev uses the shared production database, and TL ruled no app run, no email and no live rows. So QA created **no request ids** (C-10: nothing to clean up). Still open:

1. **Switch off, live:** the four entry points (`/business-os/settings` row, the Danger Zone button, the `/settings` and `/v2/settings` buttons) show "Download my data" and build the ZIP. `curl` GET / POST → 404, signed in and signed out (QA plan 1).
2. **Switch on, live:** all four entry points open the drawer (QA plan 2). A real "Export requested" email arrives with the subject, the names, the date and time in the owner's zone or "(UTC)", and the files sentence. The history shows "Waiting" lines (QA plan 3). Request ids to be recorded and cleaned up before MX-3 merges (C-10).
3. **Pointer press on the outer Danger Zone dialog's visible area** while the drawer is open: it must not close both layers (jsdom has no `pointer-events`; C-6 / QA 5).
4. **Keyboard only:** Tab / Shift-Tab order (X, Select all, modules, Export, Try again), Space ticks, Enter exports, focus trapped, Escape closes and focus returns (QA 5). Only one X is visible and reachable (E-3).
5. **Screen reader (QA 7):** "Export started … {address}" is announced politely from the drawer's status region (CR-1), and refusals are announced as alerts. Every tick box has a label and the fieldset has its legend. Confirm whether the sonner toast is silent under the modal's `aria-hidden`, as SA predicted. It is harmless now that the status line carries the sentence.
6. **Hebrew RTL rendering (QA 6):** the drawer comes in from the left, the text is right-aligned and the chevron is mirrored. The address and dates read whole in the status line, the toast (FSI/PDI) and the history. In **Gmail**, the Hebrew email's date and "time (UTC)" line keeps its parentheses in place (CR-4).
7. **DevTools network throttling:** a click before the probe answers shows the spinner, then exactly one of the drawer or the ZIP (SA focus 3). Covered in jsdom, not in a browser.
8. **Probe `error` live:** an expired session, or a forced 500, still opens the drawer with "history could not be loaded" + Try again (SA focus 6). Covered in jsdom.
9. **Visual:** the history list matches the invites / boost purchases lists (dividers, chip colours: orange for failed / interrupted, primary for sent) (BQ-E5-1).
10. **Server logs and the audit row, live (QA plan 9):** jsdom and the route tests prove that no address and no module list appear in the logs, and that the audit `details` holds only `request_id`, `modules` and `origin`. That is not checked on a real Pino stream or a real `audit_trail` row.

### Final Status
- [x] All acceptance criteria that can be tested in Jest pass. No High or Medium bug is open
- [ ] Issues found — Dev must address before commit

**Final: PASS** (Jest / in-memory scope). This is conditional on SA accepting the QA allow-list entry above, and on TL's browser and screen-reader checks 1–10. E-1…E-3 are Low and do not block.

---

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/bos-export-mx1b-route-drawer` |
| Commit | `88648e6c` (feature), merge of `origin/main` `f60ea30b` |
| PR | [#544](https://github.com/AgentsPilot/neuronforge/pull/544), merge commit via auto-merge + merge queue |
| Date | 2026-10-27 |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Workplan created (Dev, EXPORT session) | E5 / MX-1b: `app/api/business-os/export-requests` POST (start through `startForOwner`, Zod `.strict()` with `requestedModulesSchema()`, session user only, 404 while the switch is off) and GET (history: requests limited and ordered `requested_at DESC, id DESC`, then all their jobs, assembled in the request's module order); "Export requested" email (pure builder, best effort, marks `requested_email_sent_at`); `isModuleExportEnabled()` server-only, default off, with a `FEATURE_FLAGS.md` row; `DownloadMyDataButton` probes the switch and opens the new export drawer when it is on (props frozen; the ZIP body moved unchanged); drawer copy in its own file. BQ-35 answered by the user: the files sentence is final. Open items MX1B-1…MX1B-9; business questions BQ-E5-1, BQ-E5-2. No migration, no lock, no DELETE-owned file |
| 2026-10-27 | SA workplan review (⚠️ approved with conditions) | History tie-break ruled correct and deterministic. MX1B-1 to MX1B-9 all approved (MX1B-2: `SettingsDrawer` for `ExportDrawer` only, no edit to its file; MX1B-6: no retry in MX-1b, MX-3 rules). Guard check 4 extension, `RATE_LIMITS.create` reuse, 201 and the best-effort email approved. Conditions C-1 to C-12: C-1 only the route's 404 means off; C-2 `logAndFlush` for `DATA_EXPORT_REQUESTED`; C-9 MX-4 carry-over for ready-ZIP "Download again". Business questions BQ-E5-1, BQ-E5-2 (narrowed), BQ-E5-3 (new), none blocking |
| 2026-10-27 | User answered BQ-E5-1, BQ-E5-2, BQ-E5-3 (Dev, recorded here) | BQ-E5-1 yes: the history list follows the invites and boost purchases lists, and a support-sent export (MX-5) is labelled "Sent by AgentPilot support". BQ-E5-2 yes: "Export data" once the switch is on, "Download my data" while off. BQ-E5-3: nothing pre-ticked, Select all available, Export off while nothing is ticked; after a start a pop-up says "Export started. The exported files will be sent to {login email} once ready." and the history shows the new request; refusals stay inline. §10, §11, T-8 and §20 updated |
| 2026-10-27 | Implemented (Dev), Code Complete, uncommitted | Tasks 1–13 done. C-1…C-12 met (Implementation notes). 17 new and changed suites, 294 tests pass; 245 affected suites, 5,415 / 5,416 pass, the one failure pre-existing on `main`. tsc: 0 errors in touched files, no OOM. Deviations X-1…X-8, incl. one assertion in `accountCard.guard.test.ts` (X-1, for TL to log in the coordination file). No live database rows |
| 2026-10-27 | SA code review (✅ approved for QA, conditional on CR-1) | C-1…C-12 all verified in code. The ZIP move was re-derived independently against `main`. 22 + 26 suites green. tsc: 0 errors in touched files, no OOM. eslint clean. `oneAddressPolicy` failure confirmed pre-existing on `main` (Windows paths). X-1 accepted. CR-1 (Medium): the started toast is under the modal's `aria-hidden`, so it must also go into the drawer's status region. CR-2…CR-5 are Low |
| 2026-10-27 | Dev fixes for SA code review CR-1…CR-5 | CR-1: the "started" sentence also goes into the drawer's polite status region, with the address in `<bdi>`, and the toast is kept. CR-3: the toast address is wrapped in FSI/PDI. CR-2: a daily limit with no `retryAt` maps to `failed`. CR-4: the Hebrew email isolates the date and "time (UTC)" (`<bdi>` in the HTML, FSI/PDI in the text). CR-5: the redundant cast is dropped. 17 suites, 297 tests pass. tsc: 0 errors in touched files, no OOM. ESLint clean. Uncommitted |
| 2026-10-27 | QA report (full, Jest + in-memory harnesses) | PASS for the Jest scope. 3 QA files, 65 tests (route ↔ seam round trip, real-seam probe outcomes, stacking with a started in-flight request). 286 suites, 6,297 tests: 1 failure, `oneAddressPolicy`, pre-existing on `main`. tsc: 0 errors in touched files. Guards 3/4 and the callers guard proved with real planted files. QA added its route test to the callers-guard class allow-list (SA to confirm). Edge cases E-1…E-3 (Low). Browser and screen-reader items 1–10 left for TL. No live rows, no email |
| 2026-10-27 | SA post-QA ruling | QA's `OWNER_ROUTE_QA_TEST` callers-guard entry is accepted (class rules only). E-2: guard check 4's title is fixed by the SA (title only). Both guard suites and both route suites pass, 122 tests |
| 2026-10-27 | Committed and PR opened (RM) | `88648e6c` on `feature/bos-export-mx1b-route-drawer`, `origin/main` merged in cleanly (`f60ea30b`), slice suites 43 / 1,055 pass; PR #544 on auto-merge |
