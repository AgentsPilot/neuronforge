# Workplan: Business OS Export MX-4 (E7) — History, audit presentation, receipt facts, contents doc

> **Last Updated**: 2026-11-02

**Developer:** Dev (EXPORT session)
**Step:** E7 (user's numbering) = doc slice MX-4
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §6 (MX-4 row, user decision 2026-10-27), §7 (AC MX-4), §10 (XC-12, XC-19), §11 (S-3, S-12, S-14, B.4, B.6 frozen interface spec)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §3 (CC-1…CC-8, frozen interfaces, hotspot anchors), §4.6a R-5 / R-7, §4.7 (quoted in §2 below)
**Earlier slices this builds on:** [MX-1b](/docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md) (drawer, history, D-13 / MX1B-5, MX1B-9), [MX-3](/docs/workplans/BUSINESS_OS_EXPORT_MX3_WORKPLAN.md) (worker, audit constants, SA-P5), [MX-3.1](/docs/workplans/BUSINESS_OS_EXPORT_MX3_1_WORKPLAN.md) (go-live #574; QA note on stale ZIP comments), PR #596 (5 modules on, lookups independent of the module switch, SA Option A)
**Coordination:** `C:/Users/Barak/My Projects/AgentsPilot/SELF_SERVICE_EXIT_COORDINATION.md` (outside git). CC-1 read on 2026-11-01: E7 row started (last log line), CC-6 heads-up for `events.ts` / `eventAudience.ts` and the `findDeletionFacts` meaning change already posted. No lock held by either session that MX-4 needs. D7 has merged its "Export data" wording (`4bfb8ae8`)
**Branch:** `feature/bos-export-mx4-history-receipt` (RM-created, worktree `neuronforge-mx4`, off `origin/main` `eb2ee76a`). Dev confirmed it with `git branch --show-current` on 2026-11-01 before writing this file. Not `main`. **MX-4b:** `feature/bos-export-mx4b-history-paging` (worktree `neuronforge-mx4b`, off `origin/main` `26df15e5`, MX-4a merged in), confirmed by Dev on 2026-11-02
**Date:** 2026-11-01
**Status:** MX-4a merged (PR #610, 2026-11-02). MX-4b code part (tasks 5 and 6: history paging H-1, "export again at" on open N-1) Code Complete (2026-11-02), uncommitted — waits for SA code review and QA. MX-4b contents doc (task 10) is a separate part

---

## Overview

MX-4 closes the receipt gap MX-3.1 opened (R-5): from MX-3.1 module exports are live, but `findDeletionFacts` still reads only the old ZIP table, so the deletion check and the deletion receipt say "none on record". MX-4 re-sources the three receipt facts so module exports count, while the old table is still read until MX-7 (XC-12). The signature and the `DataExportDeletionFacts` type stay frozen; only the method body (and its doc comment) changes. Its merge unblocks DELETE's switch-on (B.4).

Around that core MX-4 does five smaller things: the full history in the drawer (a "Show older" page beyond the first 20 requests, MX1B-9) and the "you can export again at {time}" state on open (MX1B-5); owner presentation for the three module-export audit events (`DATA_EXPORT_REQUESTED` with `details.modules` + origin, `DATA_EXPORT_MODULE_SENT`, `DATA_EXPORT_MODULE_FAILED`) — their constants, definitions and audience entries already landed in MX-3 (SA-P5); a test that no export route is in `ENFORCEMENT_POINTS` (XC-19); the rewrite of `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` for the module export as shipped (5 modules on, 8 off); and the flags-xlsx requirement marked superseded. Two carry-overs are folded in: stale ZIP-era comments, and the missing merge commit in the MX-1b workplan.

**No lock, no migration, no manual prod gate, no switch.** Effort 🟡 2 d, at the edge (§13).

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Approved scope (plan §4.7, quoted)](#2-approved-scope-plan-47-quoted)
3. [Constraints carried into this slice](#3-constraints-carried-into-this-slice)
4. [Receipt facts: what `findDeletionFacts` returns from MX-4 (core SA decision)](#4-receipt-facts-what-finddeletionfacts-returns-from-mx-4-core-sa-decision)
5. [Full history and "export again at" on open](#5-full-history-and-export-again-at-on-open)
6. [Audit presentation](#6-audit-presentation)
7. [XC-19: no export route in `ENFORCEMENT_POINTS`](#7-xc-19-no-export-route-in-enforcement_points)
8. [Docs: contents doc, flags-xlsx marker, DE-10b section, MX-1b commit info](#8-docs-contents-doc-flags-xlsx-marker-de-10b-section-mx-1b-commit-info)
9. [Carry-over: stale ZIP-era comments](#9-carry-over-stale-zip-era-comments)
10. [Files to create / modify](#10-files-to-create--modify)
11. [Task list](#11-task-list)
12. [Test plan](#12-test-plan)
13. [Effort and fallback split](#13-effort-and-fallback-split)
14. [Coordination (CC-1 … CC-8)](#14-coordination-cc-1--cc-8)
15. [Acceptance criteria mapping](#15-acceptance-criteria-mapping)
16. [Risks](#16-risks)
17. [Open questions for SA](#17-open-questions-for-sa)
18. [Live schema checks requested](#18-live-schema-checks-requested)
19. [Business questions](#19-business-questions)
20. [SA Review Notes](#sa-review-notes)
21. [QA Testing Report](#qa-testing-report)
22. [Commit Info](#commit-info)
23. [Change History](#change-history)

---

## 1. Analysis summary

Checked against `origin/main` `eb2ee76a` on 2026-11-01.

| Area | What is there today | What MX-4 does |
|---|---|---|
| `findDeletionFacts` | `lib/repositories/BusinessOsDataExportJobRepository.ts` l.267–309. Two reads on `business_os_data_exports` by `user_id`: newest owner row with `ready_at` set (`ready_at`, `owner_downloaded_at`), and a head count of admin rows. Never throws; invalid uuid is an error with no DB call. Test: `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts` l.478–516 | Body re-sourced (§4): the two old reads stay, two new reads are added (owner module jobs sent, admin-origin requests), values combined. Type and signature unchanged |
| Callers (DELETE-owned, not edited) | `app/api/business-os/account/delete/route.ts` l.220, `app/api/business-os/account/deletion-check/route.ts` l.106 (`downloaded: Boolean(ownerExportDownloadedAt)`), `app/api/admin/test-account-cleanup/delete/route.ts` l.164; values go into `lib/business-os/account-deletion/receiptInput.ts` | None edited (SR-1). The interface notice tells DELETE `downloaded` is `false` whenever a module export is the newest |
| New tables | `business_os_export_requests` (id, user_id, origin `owner`/`admin`, admin_actor_id, modules, requested_at, requested_email_sent_at, created_at, updated_at; no status). `business_os_export_module_jobs` (… status `waiting`/`working`/`sent`/`failed`/`interrupted`, parts jsonb `{n, state sending/accepted, resend_id, at}`, sent_at set iff status `sent` and every part accepted, finished_at, …; FK `business_os_export_module_jobs_request_id_fkey`). Migration `20261095` | Read only (§4). Verified in the migration and both repositories; live check requested (§18) |
| Callers guard | `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` pins who may name the two new repository classes and `.from()` their tables. Its header already says "MX-4 adds the receipt facts … in its own diff here" | One file added to two class allow-lists (§4.4) |
| History | `GET /api/business-os/export-requests`: 20 newest requests (`HISTORY_REQUEST_LIMIT`, clamp 1..50), then all their jobs; each line already shows status, sent at and email count. Query string ignored on purpose | Keyset "Show older" page (§5.1) |
| "Export again at" | Shown only after a refused click (`409 export_daily_limit` + `retryAt`, D-13); the hook keeps Export off until then | Also on open, from a new additive field in the GET answer (§5.2) |
| Audit | Constants, `EVENT_METADATA` and `AUDIT_EVENT_AUDIENCE` entries for `DATA_EXPORT_MODULE_SENT` / `_FAILED` exist (MX-3b), pinned by `lib/audit/__tests__/dataExportSeverity.guard.test.ts`. `DATA_EXPORT_REQUESTED`'s comment and description still describe the ZIP ("Download my data", `details.job_id`). Owner reads (`GET /api/audit/query`, `/monitoring`) pass rows through `lib/audit/ownerEventPresentation.ts`, which has no export label and a stale header naming the deleted `app/api/business-os/data-exports` | Wording of the REQUESTED entry, owner labels en/he/es for the three events (§6) |
| Entitlements | `ENFORCEMENT_POINTS` is `{}` in `lib/business-os/entitlements/config/enforcementPoints.ts`. No export file imports the module. Test files are exempt from the importer guard (`enforcementPoints.test.ts` skips `__tests__/`) | New test only (§7); no `KNOWN_NON_GATE_IMPORTERS` entry needed |
| Contents doc | `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md`, 987 lines, last updated 2026-10-17, describes the ZIP (`zipExport.ts`, `data.json`, README, buckets, signed URLs, `/api/cron/data-export`), all deleted in MX-3.1 | Rewritten for modules (§8.1) |
| flags-xlsx requirement | `BUSINESS_OS_DATA_EXPORT_FLAGS_AND_SPREADSHEET_REQUIREMENT.md` was **never committed**: it is an untracked file in worktree `neuronforge-exportflags` (branch `docs/data-export-flags-xlsx`, local only, no remote, 0 commits ahead of `main`) | Q-7: where the "superseded" marker goes |
| Stale comments | `components/business-os/purge/DangerZonePanel.tsx` l.142–143 ("the same zip, copy, status line and notice"), `app/business-os/settings/page.tsx` l.1183–1185 ("Download my data (data export DE-9) … owns its request, status line and notice"). Also found: `components/settings/SecurityTab.tsx` l.445, **user-visible** copy "Your download is one zip file with your records, your files and a README" | Comments reworded (§9); SecurityTab line raised as BQ-E7-1 |
| `console.*` | None in any file this slice touches (checked: repository, route, seam, drawer files, `ownerEventPresentation.ts`, `DangerZonePanel.tsx`, settings `page.tsx`, `SecurityTab.tsx`) | Nothing to flag |

---

## 2. Approved scope (plan §4.7, quoted)

> **Changed 2026-10-27 (user decision, §4.6a).** MX-4 no longer turns a switch on … MX-4 **keeps**: full history, the "you can export again at {time}" state on open (MX1B-5), the audit owner presentation (definitions land in MX-3, SA-P5), the XC-12 receipt facts, and the `ENFORCEMENT_POINTS` test. MX-4 **gains** from the folded MX-6: the rewrite of `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` for modules, and the flags-xlsx requirement's "superseded" marker. MX-4 should start as soon as MX-3.1 merges, because it closes the receipt gap (R-5). Effort stays 🟡 2 d.

| Field | Value |
|---|---|
| Goal | Full history in the drawer; audit definitions and `eventAudience` / owner presentation for `DATA_EXPORT_MODULE_SENT` / `_FAILED` (and `DATA_EXPORT_REQUESTED` `details.modules` + origin); **XC-12 receipt facts re-sourced inside `findDeletionFacts`** (reads old and new tables until MX-7); a test that no export route is in `ENFORCEMENT_POINTS` (XC-19); contents doc rewritten for modules; flags-xlsx requirement marked superseded |
| Touches | `lib/repositories/BusinessOsDataExportJobRepository.ts` (`findDeletionFacts` body only; signature frozen) + its test; `lib/audit/events.ts`, `eventAudience.ts` (EXPORT anchors); drawer components; `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md`; new test importing `ENFORCEMENT_POINTS` (`business-os-entitlements` skill; run `npm run test:bos-entitlements`); `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` (add a section only: `ownerExportDownloadedAt` meaning; S-14) |
| Lock / migration | No / none |
| Manual prod gate | None since 2026-10-27 |
| Switches | None |
| Done when | AC MX-4; merged; `[EXPORT→DELETE] MX-4 merged — findDeletionFacts now sees module exports` sent (unblocks DELETE's switch-on, B.4) |

**Coordination checklist (MX-4, plan):** CC-1; interface notice before the PR opens (`[EXPORT→DELETE] MX-4 interface notice — findDeletionFacts meaning changes (XC-12), signature unchanged`); CC-6 for `events.ts`, `eventAudience.ts`; S-12: add only the "no export route in `ENFORCEMENT_POINTS`" test; S-14: add a section only.

**Facts decided since the plan (TL brief, 2026-11-01):** 5 modules on (`clients`, `activities_tasks`, `quotes`, `invoices_payments`, `account_business`), user decision 2026-10-31, PR #596; lookups no longer depend on the module switch (SA Option A, #596: service names appear in quotes / invoices / payments even with `services` off); export live since MX-3.1 (#574), the ZIP is gone, the old table stays until MX-7, the bucket is emptied. Folded carry-overs: stale ZIP-era comments; commit `1cd86f74` into the MX-1b workplan's Commit Info.

---

## 3. Constraints carried into this slice

| # | Constraint | Source |
|---|---|---|
| K-1 | `findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>`, path, class, method and type names unchanged; never throws; invalid uuid → error with no DB call; reads by `user_id` only (service role, documented) | Plan §3 frozen interfaces, B.6, S-3 |
| K-2 | EXPORT does not edit `receiptInput.ts` or any DELETE route; XC-12 changes only the values returned | SR-1 |
| K-3 | On any read error the method returns `{ data: null, error }` — DELETE's check route shows "none on record" and its E route refuses before anything is removed. Never return partial facts | B.6 "DELETE's side" |
| K-4 | Meaning change announced in the coordination file and to DELETE **before** the PR opens | Plan §3, CC-5 |
| K-5 | `events.ts` / `eventAudience.ts`: insert at EXPORT's anchor (after `DATA_EXPORT_DOWNLOADED_BY_ADMIN`), add only; an edit of an existing EXPORT entry is raised as a CC-6 claim first | SR-10, CC-6 |
| K-6 | S-12: add only the test; no edit to `KNOWN_NON_GATE_IMPORTERS` or `ENFORCEMENT_POINTS` | S-12 |
| K-7 | S-14: DE-10b requirement gets one new section; DELETE's sections are not rewritten | S-14 |
| K-8 | The start function stays the only authority for the daily limit; anything the drawer shows on open is a hint, the POST still decides | D-13, MX1B-5 |
| K-9 | `DownloadMyDataButton` props and exports frozen | Plan §3 |
| K-10 | Contents doc is written from code (`exportModules.ts`, `sections.ts`, `classification.ts`, `joinedCsv*.ts`, `columnLabels.ts`, `csvParts.ts`, `moduleExportSending.ts`, `moduleExportPolicy.ts`, `descriptors.ts`); no column is named that the code does not export | TL brief |
| K-11 | No backslash-hex sequences in any file (Tailwind scans docs) | Repo hazard |

---

## 4. Receipt facts: what `findDeletionFacts` returns from MX-4 (core SA decision)

### 4.1 Meaning today and the binding text

| Field | Today (old table only) | XC-12 (§10) | B.6 "Meaning from MX-4" (§11) |
|---|---|---|---|
| `ownerLastExportReadyAt` | `ready_at` of the newest owner ZIP with `ready_at` set | "the last owner module job accepted" | "the newest of (owner ZIP `ready_at`, last **owner-origin module job accepted**)" |
| `ownerExportDownloadedAt` | `owner_downloaded_at` of that same ZIP | "NULL from then on (no download exists)" | "NULL whenever a module export is the newest" |
| `adminExportExisted` | any admin ZIP row | "any admin-origin request" | "any admin ZIP **or** any admin-origin request" |

XC-12 and B.6 agree once B.6's "newest of" is read as the combination rule while the old table lives; B.6 is the more precise text and this plan follows it. Two words are open: what "a module job **accepted**" is, and whether "owner-origin" excludes MX-5's admin sends that land in the owner's inbox.

### 4.2 Proposed meaning (Dev recommendation)

| Field | From MX-4 to MX-7 | Rows and columns |
|---|---|---|
| `ownerLastExportReadyAt` | The later of **O1** and **N1**, as the database string of the winner; `null` when both are absent | **O1** (unchanged): `business_os_data_exports.ready_at`, `user_id = $1`, `requested_by_kind = 'owner'`, `ready_at IS NOT NULL`, newest. **N1** (new): `business_os_export_module_jobs.sent_at`, `user_id = $1`, `status = 'sent'`, parent request `origin = 'owner'` (inner embed on `request_id`), newest |
| `ownerExportDownloadedAt` | O1's `owner_downloaded_at` when O1 is strictly later than N1 (or N1 is absent); otherwise `null` | O1 row's `owner_downloaded_at` |
| `adminExportExisted` | **O2** or **N2** | **O2** (unchanged): head count of `business_os_data_exports` rows, `user_id = $1`, `requested_by_kind = 'admin'`. **N2** (new): head count of `business_os_export_requests` rows, `user_id = $1`, `origin = 'admin'` |

Why `status = 'sent'` / `sent_at` for "accepted": the table CHECK sets `sent_at` exactly when every part of the job was accepted by the mail provider, so it is the module-export analogue of the old `ready_at` ("the owner's data reached them"). It is also what the drawer's history calls "Sent on".

Combination rules:

- Comparison by `Date.parse` of both strings (PostgREST returns `timestamptz` as ISO with offset; the strings are not compared as text). The winner's **original string** is returned, as today ("timestamps as the database returns them").
- A tie goes to the module job, so `ownerExportDownloadedAt` is `null` (never claim a download we cannot prove). In practice a tie cannot happen: no ZIP has been made since MX-3.1.
- A value that does not parse loses, with one `warn` log carrying the field name only (Q-5 offers "error out" instead).
- All four reads must succeed; any error → `{ data: null, error }` and one `error` log, as today (K-3). The four reads run with `Promise.all` (the delete route waits on them). Each carries `.eq('user_id', userId)`.
- Today, before MX-5, N2 is always `false` (no admin route can start a request yet); the read is there so MX-5 needs no change here.

### 4.3 Alternatives where the text is ambiguous

| # | Question | A (recommended) | B | C |
|---|---|---|---|---|
| R-A | What is "a module job accepted"? | Job `status = 'sent'`, value `sent_at` (all parts accepted) | Newest **accepted part** of any owner job, including `failed` / `interrupted` jobs that sent some parts (value = the part's `at` in `parts` jsonb). More inclusive: the owner got some of their data. Costs a jsonb read and parsing every part; `at` is not proven by the SQL CHECK (QA MX-1a finding 1) | Newest owner **request** `requested_at` (the request was accepted by the start function). Cheapest, but says nothing about delivery: a request whose every module failed would count |
| R-B | Does an admin-origin request whose emails went to the owner (MX-5) count toward `ownerLastExportReadyAt`? | **No** — follow XC-12 / B.6 literally ("owner-origin"); MX-5 sends are recorded by `adminExportExisted`. Keeps the field's name honest ("owner") and matches the old meaning, where an admin ZIP never reached the owner | **Yes** — any origin, because from MX-5 the files go to the owner's login email either way, and the receipt's purpose is "did they have their data?" (DE-10b §5.1). Needs a requirement amendment (BA → SA) | — |
| R-C | Does an admin request count for `adminExportExisted` if all its modules failed? | **Yes** — "any admin-origin request" (XC-12 literal); matches the old meaning, where any admin ZIP row counted, failed or not | Only if at least one module job is `sent` | — |
| R-D | Old vs new when both exist | Newest wins; `ownerExportDownloadedAt` follows the winner (B.6) | Always `null` from MX-4 (XC-12 "NULL from then on"), even when the only export is an old downloaded ZIP. Simpler, but discards a true fact still on record until MX-7 | — |

### 4.4 Where the new reads live

| Option | How | For | Against |
|---|---|---|---|
| **D-1 (recommended)** | Two new read methods on the new repositories, called from `findDeletionFacts` with the same client: `BusinessOsExportModuleJobRepository.findLatestOwnerSentAt(userId)` and `BusinessOsExportRequestRepository.hasAdminOriginRequest(userId)`. Add `BusinessOsDataExportJobRepository.ts` and its test to the two **class** allow-lists of the callers guard | Each table stays read only by its own repository (the guard's `.from()` rules unchanged); MX-7 then only deletes the old reads; the guard header already foresees "MX-4 adds the receipt facts … here" | Touches three repository files and the guard (all EXPORT-owned) |
| D-2 | `.from('business_os_export_module_jobs')` and `.from('business_os_export_requests')` directly inside `findDeletionFacts`; add the old repository to the two `.from()` allow-lists | One file of production code | Two repositories now read each table; the guard's table rules get a second owner |

Both new methods follow the file's rules: Zod uuid first (error, no DB call), `user_id` filter, explicit columns, never throw, ids-and-codes-only logs. `findLatestOwnerSentAt` uses `select('sent_at, business_os_export_requests!inner(origin)')` with `.eq('business_os_export_requests.origin', 'owner')`, `.eq('status', 'sent')`, `.order('sent_at', { ascending: false }).limit(1)` (an `!inner` embed has precedents in `CRMContactRepository.ts` and `UserCapabilityRepository.ts`; the embed is unambiguous because exactly one FK joins the two tables). `hasAdminOriginRequest` uses `select('id', { count: 'exact', head: true })`. If SA prefers no embed, the fallback is two reads (owner request ids, then their sent jobs), bounded by the owner's request count.

### 4.5 Doc comments

The method's JSDoc is rewritten to state the meaning above and "until MX-7". The `DataExportDeletionFacts` declaration and its one-line comment are left byte-identical (Q-4 asks whether its comment may be extended — comment only, no shape change).

---

## 5. Full history and "export again at" on open

### 5.1 Full history (MX1B-9)

The history already shows every module job of every listed request with status, sent at and email count; what is missing is everything older than the 20 newest requests.

| Option | What | Notes |
|---|---|---|
| **H-1 (recommended)** | Keyset paging. `GET /api/business-os/export-requests?before=<requestedAt>&beforeId=<uuid>` returns the next 20 requests strictly older than the cursor in the existing total order (`requested_at DESC, id DESC`), plus `hasMore`. Drawer: a "Show older" button under the list, appending pages | Query validated with Zod (`.strict()`; both or neither; uuid; timestamp length cap); invalid → 400. The cursor needs no secret: it is filtered by the session user, so a foreign cursor only returns this user's older rows. `listRecentForUser` gains an optional `before` option (repository change, Zod). The route header line "the query string is ignored" is replaced. `hasMore` = a page of `limit + 1` rows read, `limit` returned |
| H-2 | One page of 50 (`HISTORY_REQUEST_LIMIT_MAX`), labelled "newest 50" | Not "full"; no paging code |
| H-3 | Keep 20 and record that 20 requests (at least 10 days at 2 per 24 h) is the history | Does not meet "full history" |

The seam (`lib/client/businessOsDataExport.ts`, the one file allowed to name the route) gets `fetchModuleExportHistory({ before? })`; `useExportDrawer` gains `loadOlder()` and `isLoadingOlder`, and a failed "Show older" read keeps the loaded list with an inline retry. Copy in `exportDrawerCopy.ts` (en/he/es): `historyShowOlder`, `historyOlderUnavailable`.

### 5.2 "You can export again at {time}" on open (MX1B-5)

D-13 deferred this because computing it in TypeScript would copy the start function's counting rule. Options:

| Option | What | Notes |
|---|---|---|
| **N-1 (recommended)** | The GET answer gains an additive `nextExportAt: string \| null` (owner origin only). The route computes it from one new repository read, `BusinessOsExportRequestRepository.findOwnerLimitAnchor(userId, since)`: owner requests with `requested_at > since` (since = now − `MODULE_EXPORT_POLICY.DAILY_WINDOW_HOURS`) that have at least one job **not** in `MODULE_JOB_NOT_COUNTED`, newest first, the row at offset `OWNER_DAILY_LIMIT − 1`; `nextExportAt` = its `requested_at` + 24 h, else `null`. A pure function `nextOwnerExportAt(anchor, policy)` in `lib/business-os/data-export/` holds the arithmetic | The rule's inputs are already mirror-tested against the SQL (`supabase/migrations/__tests__/business-os-export-requests.migration.test.ts` pins limit, window and not-counted statuses), so this does not create a second unpinned authority; a new test pins the OFFSET rule too. The POST still decides (K-8). Clock: server `Date.now()` vs DB `now()`; a few seconds of skew only moves when Export comes back on, and a click at the edge is refused by the DB with its own `retryAt` |
| N-2 | Derive it in the browser from the history page already loaded | No extra read, but wrong when more than 18 not-counted requests sit in the last 24 h, and puts the rule in client code |
| N-3 | A read-only SQL function returning the limit state | The cleanest single authority, but needs a migration and a manual gate; out of scope ("no migration") |

On open, if `nextExportAt` is in the future the hook sets the same `daily_limit` refusal and timer the refused click sets today (no new UI state, no new copy; the existing `copy.refusal.daily_limit` sentence with `{time}`). A history read that fails leaves Export enabled (the POST decides).

---

## 6. Audit presentation

What exists: `AUDIT_EVENTS`, `EVENT_METADATA` and `AUDIT_EVENT_AUDIENCE` entries for `DATA_EXPORT_MODULE_SENT` / `_FAILED` (`shared`), pinned by `dataExportSeverity.guard.test.ts`. Every export row is `entityType 'user'` on the owner's account, so it is owner-visible (`ownerVisibility.ts`) and reaches `/monitoring` through `presentOwnerAuditRow`.

| Task | File | Change |
|---|---|---|
| A-1 | `lib/audit/events.ts` | `DATA_EXPORT_REQUESTED`: comment and description describe the module export: `details.request_id`, `details.modules` (module ids), `details.origin` (`owner` / `admin`); the ZIP's `details.job_id` noted as old rows only. `DATA_EXPORT_READY` / `_DOWNLOADED` / `_EXPIRED` / `_DOWNLOADED_BY_ADMIN` / `_FAILED`: comment "ZIP export, retired in MX-3.1; constants kept for old rows" (no rename, no removal). Severity and flags unchanged, so the severity guard stays green. **Edits existing EXPORT lines** → CC-6 claim first (K-5, Q-6) |
| A-2 | `lib/audit/eventAudience.ts` | Nothing to add: both module events are already `shared`. Comment only on the old ZIP entries if SA wants it; otherwise the file is not touched (Q-6) |
| A-3 | `lib/audit/ownerEventPresentation.ts` | `OWNER_EVENT_LABELS` entries (en/he/es, he/es drafts for native review): `DATA_EXPORT_REQUESTED` "Data export requested", `DATA_EXPORT_MODULE_SENT` "Export part sent by email", `DATA_EXPORT_MODULE_FAILED` "Export part could not be sent". Not added to `OWNER_NEUTRAL_EVENTS`: the details are the owner's own facts (ids, module, counts, a code), none operator-only. Stale header lines naming `app/api/business-os/data-exports` reworded. Not in the plan's Touches list → named here for SA (Q-6) |
| A-4 | MX-5 note | When MX-5 writes `DATA_EXPORT_REQUESTED` with origin `admin` on the owner's account, it must not put the admin's id in `details` (or must neutralise it for the owner). Recorded for MX-5; no code now |
| A-5 | AC "with no content" | A guard test that the three writers (`app/api/business-os/export-requests/route.ts`, `moduleExportWorker.ts` `auditEntry`) put only the allowed detail keys: REQUESTED `{request_id, modules, origin}`; SENT `{request_id, job_id, module, origin, rows, parts, parts_accepted}`; FAILED the same plus `{failure_code, interrupted}`. Reuses the existing route and worker tests' captured audit inputs if they already assert exact objects (checked at implementation; add only what is missing) |

---

## 7. XC-19: no export route in `ENFORCEMENT_POINTS`

New test `lib/business-os/entitlements/__tests__/exportNotEnforced.test.ts` (Q-3 on location):

- A pure helper inside the test, `exportFilesIn(registry)`, returns every file in any registry value that is export code: under `app/api/business-os/export-requests/`, `app/api/cron/data-export-modules/`, `lib/business-os/data-export/`, `components/business-os/data-export/`, `lib/client/businessOsDataExport.ts`, or any path containing `export-request` / `data-export` (catches MX-5's admin send route without naming it now).
- Asserts `exportFilesIn(ENFORCEMENT_POINTS)` is empty.
- Non-vacuity: a planted registry naming the owner route returns it.
- Second assertion (XC-19 "export never imports entitlements"): no file under the export directories above imports `@/lib/business-os/entitlements` (a source scan; comments that only say "nothing is imported from …" do not match an `import … from` line).

Test files are exempt from the importer guard, so no `KNOWN_NON_GATE_IMPORTERS` entry (S-12 "add only the test" holds). `npm run test:bos-entitlements` is run before hand-over and its result recorded; that script includes `lib/business-os/entitlements` and `lib/repositories/__tests__`, so it also runs the callers guard and the repository tests of §4.

---

## 8. Docs: contents doc, flags-xlsx marker, DE-10b section, MX-1b commit info

### 8.1 `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` rewrite

Rewritten from code (K-10), header `Last Updated: 2026-11-0x`, ToC, Change History row appended (old rows kept). Proposed outline:

| § | Content | Source of truth |
|---|---|---|
| Overview | "Export data" sends one email per module part with a CSV attachment to the owner's login email; nothing downloads in the browser; the ZIP was retired in MX-3.1 (#574); old ZIP rows stay in `business_os_data_exports` until MX-7 | Requirement §3, MX-3.1 workplan |
| 1. Where the code lives | Route, seam, drawer, worker cron, worker, builder, repositories, policies | file list |
| 2. Modules | Table of all 13 modules in map order: id, en name, sections, `on` (5 on: `clients`, `activities_tasks`, `quotes`, `invoices_payments`, `account_business`; 8 off and switchable by a one-line edit of `exportModules.ts`). What "off" means: not offered in the drawer, a stored job for it is failed by the worker before any read (D-7) | `exportModules.ts` |
| 3. The module CSV | One joined CSV per module (sections combined, record type column, "Belongs to"), BOM, CRLF, header labels in the owner's language (en/he/es, values never translated, BQ-31) | `joinedCsv.ts`, `columnLabels.ts`, `csv.ts` |
| 4. Lookups | Ids that become labels (client, service, stage, invoice, payment plan, sequence, page, quote) and the ones that stay ids; **lookups do not depend on the module switch** (SA Option A, #596): service names appear in quotes, invoices and payments even with `services` off | `joinedCsvReferences.ts`, `lookupSectionsFor` |
| 5. Every section, by module | Per section: source table, columns included / excluded, row mapper — the old §7 entries re-checked one by one against `sections.ts` / `classification.ts` (not copied blind), regrouped under their module, with sections of off modules listed under "off" | `sections.ts`, `classification.ts`, `joinedCsv.ts` |
| 6. Every table not exported | Old §8 kept, re-checked against `descriptors.ts`; "the export itself" now 3 tables (`business_os_data_exports` until MX-7, `business_os_export_requests`, `business_os_export_module_jobs`) | `descriptors.ts` |
| 7. Files | Files (documents, images) are not exported; downloaded one by one (BQ-35) | Requirement §4.5 |
| 8. Parts and sizes | Part size 7,000,000 bytes, at most 10 parts (emails) per module, "too large" outcome | `moduleExportSending.ts`, `csvParts.ts` |
| 9. Delivery | Drawer, "Export requested" email, worker cron cadence, retries (3 build attempts, 5 notice attempts), statuses, failure notice, idempotency key, 2 requests per rolling 24 h and one at a time (DB authority), history, "export again at" | `moduleExportPolicy.ts`, route, worker, `vercel.json` |
| 10. Audit events | REQUESTED / MODULE_SENT / MODULE_FAILED with their detail keys; the old ZIP events (old rows only) | `events.ts` |
| 11. How to change it | Switch a module on, move a section, add a column, the CI guards that will fail | MX-0 / MX-2a / MX-2b guards |

The old ZIP-only sections (zip layout, file name, `data.json`, README, buckets, signed URLs, sweep cron) are removed, with one line in the Overview pointing to git history for the ZIP-era version (Q-8).

### 8.2 flags-xlsx requirement "superseded"

Finding: the file was never committed (§1). Options in Q-7. Dev default: **F-1** — record "superseded by the export redesign (MX-0 module map, no Excel, BQ-25)" in this repo, in the contents doc's Change History and in the main requirement's MX-4 status line (the requirement's §5 row l.164 already names the branch), and tell TL that the untracked file in `neuronforge-exportflags` can be banner-marked or deleted by whoever owns that worktree. Dev does not touch the other worktree.

### 8.3 DE-10b requirement section (S-14)

Append one section before Change History, without touching DELETE's sections: `## Export facts from the module export (EXPORT MX-4, 2026-11-0x)` — the table of §4.2 in plain words; `ownerExportDownloadedAt` is `null` whenever a module export is the newest, because the module export has no download (files arrive by email); it carries a value only for an old ZIP that is newer than every module export, and is always `null` after MX-7. Plus a Change History row. `Last Updated` bumped.

### 8.4 MX-1b workplan Commit Info

Add one row to `docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md` § Commit Info: `| Merge commit | 1cd86f74 (PR #544 merged 2026-10-27 20:12 UTC) |`, a Change History row, `Last Updated` bumped. Nothing else in that file.

---

## 9. Carry-over: stale ZIP-era comments

| File | Lines | Now | Change |
|---|---|---|---|
| `components/business-os/purge/DangerZonePanel.tsx` | l.142–143 | "The export is the one shared control (data export DE-9, BC-1): the same zip, copy, status line and notice as every other entry point." | "The export is the one shared control: `DownloadMyDataButton` opens the export drawer, the same as every other entry point (MX-3.1)." Comment only. DELETE edits this file (D7) → CC-3 claim first |
| `app/business-os/settings/page.tsx` | l.1183–1185 | "Download my data (data export DE-9): the one shared control. It owns its request, status line and notice (UI-1)…" | "Export data (MX-3.1): the one shared control. It opens the export drawer, which owns its request, history and messages; the page banner above carries no export messages." Comment only |
| `components/settings/SecurityTab.tsx` | l.445 | User-visible: "Your download is one zip file with your records, your files and a README that explains them." | **Not a comment** — copy on the AgentsPilot security page. Raised as BQ-E7-1; changed only on the user's answer |

---

## 10. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | modify | `findDeletionFacts` body + its JSDoc (§4); type untouched |
| `lib/repositories/__tests__/BusinessOsDataExportJobRepository.test.ts` | modify | New `findDeletionFacts` cases (§12) |
| `lib/repositories/BusinessOsExportModuleJobRepository.ts` | modify | `findLatestOwnerSentAt` (D-1) |
| `lib/repositories/__tests__/BusinessOsExportModuleJobRepository.test.ts` | modify | Its tests |
| `lib/repositories/BusinessOsExportRequestRepository.ts` | modify | `hasAdminOriginRequest` (D-1), `listRecentForUser` `before` option (H-1), `findOwnerLimitAnchor` (N-1) |
| `lib/repositories/__tests__/BusinessOsExportRequestRepository.test.ts` | modify | Their tests |
| `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` | modify | `BusinessOsDataExportJobRepository.ts` + its test on the two class rules; header line |
| `lib/business-os/data-export/nextOwnerExportAt.ts` + `__tests__/nextOwnerExportAt.test.ts` | create | Pure arithmetic of N-1 and the OFFSET pin |
| `app/api/business-os/export-requests/route.ts` | modify | GET: cursor (Zod), `hasMore`, `nextExportAt`; header |
| `app/api/business-os/export-requests/__tests__/route.test.ts` | modify | GET cases (§12) |
| `lib/client/businessOsDataExport.ts` + `__tests__/businessOsDataExport.moduleExport.test.ts` | modify | Cursor, `hasMore`, `nextExportAt` parsing |
| `components/business-os/data-export/useExportDrawer.ts` | modify | `loadOlder`, limit state on open |
| `components/business-os/data-export/ExportDrawer.tsx` | modify | "Show older" button and its error line |
| `components/business-os/data-export/exportDrawerCopy.ts` + `__tests__/exportDrawerCopy.test.ts` | modify | Two keys en/he/es |
| `components/business-os/data-export/__tests__/ModuleExport.render.test.tsx` | modify | Paging and limit-on-open renders |
| `lib/audit/events.ts` | modify | A-1 (CC-6 claim) |
| `lib/audit/eventAudience.ts` | none planned | A-2 (Q-6) |
| `lib/audit/ownerEventPresentation.ts` + `lib/audit/__tests__/ownerEventPresentation.test.ts` | modify | A-3 |
| `lib/audit/__tests__/dataExportAuditDetails.guard.test.ts` | create (if needed) | A-5 |
| `lib/business-os/entitlements/__tests__/exportNotEnforced.test.ts` | create | §7 |
| `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | modify (rewrite) | §8.1 |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` | modify (add a section) | §8.3 |
| `docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md` | modify (one row) | §8.4 |
| `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` | modify | MX-4 AC ticks and status at the end (always-update-main-requirement) |
| `docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md` | modify | §4.7 workplan link + status row |
| `components/business-os/purge/DangerZonePanel.tsx` | modify (comment) | §9 (CC-3 claim) |
| `app/business-os/settings/page.tsx` | modify (comment) | §9 |
| `components/settings/SecurityTab.tsx` | only on BQ-E7-1 | §9 |

Not touched: `receiptInput.ts`, any DELETE route, `DownloadMyDataButton.tsx`, `ModuleExportEntry.tsx`, translation files, migrations, `vercel.json`, `featureFlags.ts`.

---

## 11. Task list

SA Q-12 split the slice: tasks marked **(4a)** are MX-4a, **(4b)** are MX-4b.

- [ ] 1. **(4a, TL)** CC-1 re-read of the coordination file; CC-6 claim for `lib/audit/events.ts` and CC-3 claim for `DangerZonePanel.tsx`; message DELETE. TL posts these (TL brief 2026-11-01, C-6); not done by Dev
- [x] 2. **(4a)** ✅ Repository reads (D-1): `findLatestOwnerSentAt`, `hasAdminOriginRequest` + tests; callers guard class allow-lists
- [x] 3. **(4a)** ✅ `findDeletionFacts` body (§4.2, Q-5 as ruled: an unparseable time errors) + JSDoc; repository tests T-1…T-9
- [ ] 4. **(4a, TL)** Interface notice (C-8): TL posts the five SA bullets verbatim and records DELETE's acknowledgement before the PR opens
- [x] 5. **(4b)** ✅ History paging (H-1, C-4) + T-10…T-12, T-15, T-16
- [x] 6. **(4b)** ✅ "Export again at" on open (N-1, C-5) + T-13, T-14, T-16; mirror pins in the migration test
- [x] 7. **(4a)** ✅ Audit: A-1 events.ts wording, A-3 owner labels + header, A-5 exact detail keys (route test; the worker's are already pinned by T-W24)
- [x] 8. **(4a)** ✅ XC-19 test (§7); `npm run test:bos-entitlements` green (Implementation notes)
- [x] 9. **(4a)** ✅ Stale comments (§9); SecurityTab line changed on the user's BQ-E7-1 answer (2026-11-02, SA wording)
- [ ] 10. **(4b)** Contents doc rewrite (§8.1)
- [x] 11. **(4a)** ✅ DE-10b section (§8.3); MX-1b Commit Info row (§8.4). flags-xlsx (Q-7 F-1) goes with the contents doc in **(4b)**
- [x] 12. **(4a)** ✅ Main requirement + plan status rows
- [x] 13. **(4a)** ✅ Verification, Implementation notes; hand-over to SA code review

---

## 12. Test plan

### 12.1 Repository (`findDeletionFacts`, Jest with the existing fake client)

| # | Case | Expect |
|---|---|---|
| T-1 | Nothing on record | `{ null, null, false }` |
| T-2 | Old owner ZIP only (downloaded) | Old `ready_at`, old `owner_downloaded_at` (today's behaviour kept) |
| T-3 | Owner module job sent only | `sent_at`, `null` |
| T-4 | Both, ZIP newer | ZIP values |
| T-5 | Both, module newer | `sent_at`, `null` |
| T-6 | Equal instants written in different offsets | Module wins, `null` (proves `Date.parse`, not text compare) |
| T-7 | Admin: old only / new only / neither | `true` / `true` / `false` |
| T-8 | Every read filters `user_id`; N1 filters `status = 'sent'` and origin `owner`; no `*` | Recorded calls |
| T-9 | Invalid uuid → error, zero calls; any one of the four reads failing → `{ data: null, error }`, logged with method name only | — |

New methods: invalid input without a call, filters, empty result, error path. Callers guard: green with the new allow-list entries and red for a planted extra file (its existing non-vacuity test).

### 12.2 Route, seam, drawer

| # | Case |
|---|---|
| T-10 | GET without cursor: unchanged first page plus `hasMore`, `nextExportAt` |
| T-11 | GET with a valid cursor: repository called with it and the session user only |
| T-12 | GET with half a cursor, a bad uuid, an over-long timestamp or an extra key → 400 `invalid_input`; 401 without session (CLAUDE.md: happy path, auth failure, invalid input) |
| T-13 | `nextExportAt`: two counted owner requests in 24 h → second-newest + 24 h; one → `null`; failed-only requests → `null`; limit-anchor read error → `null` and a warn (history still served) |
| T-14 | `nextOwnerExportAt` pure cases + the offset pinned to `OWNER_DAILY_LIMIT − 1` |
| T-15 | Seam parses `hasMore` / `nextExportAt`; a wrong type → `error` verdict |
| T-16 | Drawer: "Show older" appears only with `hasMore`, appends, keeps the list on a failed older read with retry; Export off on open with the "export again at" sentence when `nextExportAt` is future, back on at that time (fake timers) |

### 12.3 Verification before hand-over (outputs recorded)

`npm test` on the touched suites and their neighbours (`lib/repositories/__tests__`, `app/api/business-os/export-requests`, `components/business-os/data-export`, `lib/audit/__tests__`, `app/api/audit/__tests__`, `lib/business-os/data-export`), compared with a `main` baseline (failure diff deduplicated). `npm run test:bos-entitlements`. Scoped `tsc` on touched files, checked for an OOM crash. `npm run lint:hooks`. `npm run build` once at the end. No live database rows created.

---

## 13. Effort and fallback split

| Part | Estimate |
|---|---|
| Receipt facts + repository reads + guard + tests | 0.5 d |
| Full history paging (repo, route, seam, hook, drawer, tests) | 0.5 d |
| "Export again at" on open | 0.3 d |
| Audit wording, owner labels, details guard, XC-19 test | 0.2 d |
| Contents doc rewrite (column checks against code) | 0.5 d |
| DE-10b section, MX-1b row, comments, status rows | 0.1 d |
| **Total** | **≈ 2.1 d** |

Slightly above the 2 d cap. Fallback if SA prefers smaller PRs, or if day 1.5 ends without the contents doc: **MX-4a** = receipt facts, audit, XC-19 test, carry-overs, DE-10b section (unblocks DELETE first); **MX-4b** = history paging, "export again at", contents doc. Either way the receipt part is built first.

---

## 14. Coordination (CC-1 … CC-8)

| Step | MX-4 action |
|---|---|
| CC-1 | Done 2026-11-01 (header); re-read before code |
| CC-3 | Claim `components/business-os/purge/DangerZonePanel.tsx` (comment l.142–143 only) |
| CC-4 | No migration, nothing reserved |
| CC-5 | Messages at workplan approved, interface notice, PR opened, PR merged |
| CC-6 | `lib/audit/events.ts`: rewording of EXPORT's existing data-export entries (no new constant); `eventAudience.ts` only if Q-6 says so |
| CC-7 | Frozen: `findDeletionFacts` signature + type, `DownloadMyDataButton` |
| CC-8 | Status row after merge |

**Interface notice (posted before the PR opens):** `[EXPORT→DELETE] MX-4 interface notice — findDeletionFacts meaning changes (XC-12), signature unchanged`. Body: the §4.2 table as ruled by SA; `ownerExportDownloadedAt` (and so the check route's `downloaded`) is `null` whenever a module export is the newest; `adminExportExisted` is `false` until MX-5 starts admin requests; errors unchanged (any read error → `error`); `receiptInput.ts` and DELETE's routes need no change; MX-7 drops the old-table reads. After merge: `[EXPORT→DELETE] MX-4 merged — findDeletionFacts now sees module exports` (B.4).

---

## 15. Acceptance criteria mapping

| AC MX-4 (requirement §7) | Covered by |
|---|---|
| History shows every module job with status, sent at and email count | Existing lines + H-1 paging; T-10, T-11, T-16 |
| After stage E the history and request rows are gone | Already true: both tables are removed by step B of the test-account cleanup in both modes (`descriptors.ts` l.1527–1530; latest cleanup `20261104`) and cascade on `auth.users`. Verified by the existing `descriptors.invariant` and migration tests; cited in Implementation Notes, no new code |
| Audit rows requested / module sent / module failed, no content | A-5 guard; existing route and worker tests |
| Receipt facts per XC-12; old-table facts still read; receipt schema unchanged | §4, T-1…T-9; no edit to `receiptInput.ts` |
| No export route in `ENFORCEMENT_POINTS` | §7 test |
| "Export again at {time}" shows when the drawer opens at the limit | N-1, T-13, T-16 |
| Contents doc describes the module export; flags-xlsx marked superseded | §8.1, §8.2 (Q-7) |

---

## 16. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | A wrong receipt fact is written into a receipt that is kept for years | All-or-nothing reads (K-3); T-1…T-9; SA rules the meaning before code |
| K-2 | The `!inner` embed filter is silently ignored (PostgREST syntax slip) and admin sends count as owner | T-8 asserts the filter call; live REST check requested (§18) |
| K-3 | `nextExportAt` disagrees with the database at the edge | Hint only; the POST refuses with the DB's own `retryAt` (K-8) |
| K-4 | MX-5 later changes the start function's counting rule (SA-P8) and `nextOwnerExportAt` drifts | Mirror test fails on the migration text; noted for SA-P8 |
| K-5 | Contents doc invents or drops a column | Each section checked against `sections.ts` / `joinedCsv.ts` during the rewrite; QA spot-checks one section per module |
| K-6 | `events.ts` merge conflict with DELETE's audit additions | CC-6 claim, contiguous EXPORT block, rebase before enqueue |

---

## 17. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | "A module job **accepted**" (R-A): job `sent` (`sent_at`), any accepted part, or the request? | R-A A: `status = 'sent'`, `sent_at` |
| Q-2 | Do MX-5 admin sends (files go to the owner) count toward `ownerLastExportReadyAt` (R-B)? | No (literal XC-12 / B.6); if SA prefers yes, it goes back to BA for a requirement amendment |
| Q-3 | XC-19 test location: `lib/business-os/entitlements/__tests__/` (runs in the entitlements CI job, where someone adding a gate looks) or `lib/business-os/data-export/__tests__/` (EXPORT's own directory) | Entitlements `__tests__`, add-only (S-12) |
| Q-4 | May the one-line comment on the frozen `DataExportDeletionFacts` declaration be extended (comment only)? | No: leave the type byte-identical, document in the method JSDoc |
| Q-5 | Unparseable timestamp in the combine: loses with a warn, or the whole call errors? | Loses with a warn (the other value is still a true fact) |
| Q-6 | Audit files: (a) rewording EXPORT's existing `DATA_EXPORT_REQUESTED` comment/description is an edit, not an add — CC-6 claim enough? (b) `eventAudience.ts` needs no change — confirm the plan's "EXPORT anchors" there is satisfied by MX-3b? (c) `ownerEventPresentation.ts` is not in the plan's Touches — approve adding it? (d) `MODULE_FAILED` details shown to the owner as is, or neutralised? | (a) yes, claim; (b) no change; (c) yes; (d) as is |
| Q-7 | flags-xlsx requirement is an untracked file in another worktree. (F-1) note in this repo + tell TL; (F-2) commit a copy of that file here with a "Superseded" banner (tracks it for the first time); (F-3) only record in the main requirement that it was never committed | F-1 |
| Q-8 | Contents doc: keep the ZIP-era sections in an appendix, or remove them and point at git history? | Remove, one pointer line |
| Q-9 | D-1 (new repository methods + class allow-lists) or D-2 (direct `.from()` in the old repository)? | D-1 |
| Q-10 | History: H-1 keyset "Show older", H-2, or H-3? | H-1 |
| Q-11 | "Export again at" on open: N-1 (server-computed hint from a pinned rule), N-2, or N-3 (needs a migration)? | N-1 |
| Q-12 | One PR at about 2.1 d, or the MX-4a / MX-4b split (§13)? | One PR, split trigger at day 1.5 |

---

## 18. Live schema checks requested

Read-only, for TL (or Dev via MCP if allowed) on prod before code:

| # | Check | Why |
|---|---|---|
| L-1 | `information_schema.columns` for `business_os_export_requests` and `business_os_export_module_jobs`: names, types, nullability match `20261095` | §4 / §5 column claims |
| L-2 | `pg_constraint`: exactly one FK from `business_os_export_module_jobs` to `business_os_export_requests` (`…_request_id_fkey`) | `!inner` embed is unambiguous |
| L-3 | Row counts: requests by `origin`; jobs by `status`; jobs with `status = 'sent'` and `sent_at IS NULL` (expect 0) | Sanity of N1 / N2; confirms no admin requests exist yet |
| L-4 | `business_os_data_exports`: count by `requested_by_kind`, count with `ready_at` set, newest `ready_at` | How often the old/new combine matters in practice |
| L-5 | One REST probe with the service role: `GET /rest/v1/business_os_export_module_jobs?select=sent_at,business_os_export_requests!inner(origin)&business_os_export_requests.origin=eq.owner&status=eq.sent&limit=1` returns 200 | Proves the embed syntax against the live API (or SA accepts the fallback of two reads) |

---

## 19. Business questions

| # | Question | Suggestion |
|---|---|---|
| BQ-E7-1 ✅ **Answered: user 2026-11-02, SA wording** ("Your export arrives by email as spreadsheet (CSV) files, one for each area you choose. A large area may come in several emails. Documents and images are not included; you can download them one by one."). Done in MX-4a | The AgentsPilot security page still says "Your download is one zip file with your records, your files and a README that explains them." There is no zip any more: data arrives by email, one part per area, and files are downloaded one by one. Change it? | Yes: "Your export arrives by email: one file per part you choose. Documents and images are downloaded one by one." One line in `components/settings/SecurityTab.tsx`; no manual test asked of the user (AgentsPilot app parked) |

The ambiguities in §4.3 (R-A, R-B, R-C) are technical readings of an approved requirement and go to SA; only R-B, if SA wants "yes", would go to the user through BA.

---

## Implementation notes — MX-4a (Dev, 2026-11-02)

**Branch:** `feature/bos-export-mx4-history-receipt` (worktree `neuronforge-mx4`). Uncommitted. No migration, no live rows written.

### What was built

| Area | Files | Notes |
|---|---|---|
| Receipt facts (§4.2 as ruled) | `lib/repositories/BusinessOsDataExportJobRepository.ts` | `findDeletionFacts` body and JSDoc only. Signature, `DataExportDeletionFacts` and its comment byte-identical (Q-4). Four reads in `Promise.all`, all `user_id`; O1/O2 unchanged; N1/N2 through the new methods with the same client (D-1). Newest wins by `Date.parse`, tie to the module job; any read error, a missing fact, or an unparseable time (Q-5) → `{ data: null, error }`, one log with the method name, field name only |
| N1 | `BusinessOsExportModuleJobRepository.findLatestOwnerSentAt` | Select `MODULE_JOB_OWNER_SENT_COLUMNS` = `sent_at, business_os_export_requests!inner(origin)` (C-1: a real column). Filters `user_id`, `status = 'sent'`, `business_os_export_requests.origin = 'owner'`, newest `sent_at`, limit 1. The returned row is Zod-parsed: `sent_at` non-empty and the embed an object with `origin` literally `owner`; anything else → new code `unexpected_row`, an error (C-1 fail closed) |
| N2 | `BusinessOsExportRequestRepository.hasAdminOriginRequest` | Head count, `user_id` + `origin = 'admin'`. A missing count is `unexpected_result`, never "no" |
| Callers guard | `exportRequestRepositories.callers.guard.test.ts` | `BusinessOsDataExportJobRepository.ts` + its test added to the two **class** rules only; `.from()` rules unchanged; header updated. Existing planted negative fixtures still fail (C-9) |
| Audit | `lib/audit/events.ts`, `lib/audit/ownerEventPresentation.ts` | A-1: REQUESTED comment and description describe the module export (`request_id`, `modules`, `origin`; ZIP rows carry `job_id`); comment that the five ZIP events are kept for old rows. Severity and flags unchanged. A-3: owner labels en/he/es for REQUESTED / MODULE_SENT / MODULE_FAILED (he/es drafts), details not neutralised (Q-6 d); stale header reworded. `eventAudience.ts` not touched (Q-6 b) |
| A-5 | `app/api/business-os/export-requests/__tests__/route.test.ts` | Exact REQUESTED detail keys `{modules, origin, request_id}`. SENT / FAILED exact keys were already pinned by `moduleExportWorker.test.ts` T-W24, so no new guard file |
| XC-19 | `lib/business-os/entitlements/__tests__/exportNotEnforced.test.ts` (new) | `exportFilesIn(ENFORCEMENT_POINTS)` is empty; planted registry (made-up capability ids) catches the owner route, the worker and an MX-5-shaped admin path, not an unrelated gate; a source scan finds no import of the module from the export code (alias, relative resolved from the file, require, dynamic, side-effect, re-export), with 12 planted cases. No edit to `ENFORCEMENT_POINTS` or `KNOWN_NON_GATE_IMPORTERS` (S-12) |
| Carry-overs | `DangerZonePanel.tsx` l.142–144, `app/business-os/settings/page.tsx` l.1183–1185 | Comments only |
| BQ-E7-1 | `components/settings/SecurityTab.tsx` l.445 + `agentPlatformEntryPoints.render.test.tsx` | The SA wording, English only (C-7 satisfied by the user's answer 2026-11-02). New test pins the sentence and that no "zip file" / "README" text remains. No test pinned the old text |
| Docs | DE-10b requirement (new section, S-14), MX-1b workplan (merge commit row), main requirement (§6 MX-4 row note, §7 bullet notes, Change History), plan (status line, §4.7 note, Change History) | — |

### Select strings sent (for the C-2 REST probe)

| Method | Table | select | Filters |
|---|---|---|---|
| `findLatestOwnerSentAt` | `business_os_export_module_jobs` | `sent_at, business_os_export_requests!inner(origin)` | `user_id=eq.<uuid>`, `status=eq.sent`, `business_os_export_requests.origin=eq.owner`, `order=sent_at.desc`, `limit=1` |
| `hasAdminOriginRequest` | `business_os_export_requests` | `id` with `count=exact`, `head=true` (HEAD request, `Prefer: count=exact`) | `user_id=eq.<uuid>`, `origin=eq.admin` |
| Old reads (unchanged) | `business_os_data_exports` | `ready_at, owner_downloaded_at` / `id` head count | `user_id`, `requested_by_kind` owner + `ready_at not.is.null`, order `ready_at.desc`, limit 1 / `requested_by_kind` admin |

### Deviations

- **X-1** `findLatestOwnerSentAt` returns `{ sentAt: string | null }` rather than a bare `string | null`, so "none" and an error cannot be confused.
- **X-2** A-5 is one assertion in the route test, not a new `lib/audit` guard file: the worker's keys were already pinned exactly (workplan §6 A-5 "add only what is missing").
- **X-3** The XC-19 scan uses lookbehinds instead of word-boundary escapes, so no backslash precedes a hex digit (repo Tailwind hazard).
- **X-4** One file (the callers guard) was edited with a short script that rewrote it in place instead of the Edit tool; the diff was checked (10 insertions, 4 deletions) and line endings stay CRLF.
- **X-5** The labels keep the approved "Export part …" wording; SA noted "part" is also the size split. A rename is one line if SA wants "area".

### Verification (2026-11-02)

- Touched repository suites: 4 suites, 185 tests pass.
- `npx jest lib/business-os/data-export lib/repositories app/api/business-os components/business-os/data-export lib/audit lib/business-os/entitlements app/api/admin/test-account-cleanup components/business-os/purge app/business-os/settings`: **296 suites, 7,006 tests, all pass** (includes DELETE's delete / deletion-check / test-account-cleanup route suites, unchanged).
- `npm run test:bos-entitlements` (C-9): **346 suites, 10,016 tests, all pass.**
- tsc: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` ran to completion (exit 2, 1,916 pre-existing `error TS` lines in other files, no heap or fatal message). **0 errors in the 15 touched `.ts` / `.tsx` files** and the new test. The run started before the X-3 regex edit to the new test; the repo's existing lookbehind regexes (e.g. `catalogueDrift.guard.test.ts`) draw no diagnostic under the same target, and its flags are only `gm`.

## Implementation notes — MX-4b (Dev, 2026-11-02)

**Branch:** `feature/bos-export-mx4b-history-paging` (worktree `neuronforge-mx4b`, off `origin/main` `26df15e5`). Uncommitted. Scope: tasks 5 (H-1) and 6 (N-1) only; the contents doc (task 10) is another Dev's part and `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` was not touched here. No migration, no live rows written, `DownloadMyDataButton` and `findDeletionFacts` untouched.

### What was built

| Area | Files | Notes |
|---|---|---|
| Cursor (C-4) | `lib/business-os/data-export/exportHistoryCursor.ts` (new, pure) | `HISTORY_PAGE_SIZE` (20), the timestamp pattern (date, `T` or space, time, up to 6 fraction digits, `Z` or offset; character classes only, no backslash escapes), cap 40, `historyCursorSchema` (strict `{ requestedAt, id }`), `historyQuerySchema` (strict, `.partial()`, both or neither). Only digits and `-:.+TZ ` and a space pass, so a value cannot close the `.or()` quote |
| Repository (H-1) | `BusinessOsExportRequestRepository.listRecentForUser(userId, { limit?, before? })` | Cursor Zod-parsed first (invalid → `invalid_input`, no call). Keyset after `.eq('user_id')`: `.or('requested_at.lt."<t>",and(requested_at.eq."<t>",id.lt."<id>")')`, values double-quoted, `<t>` the exact string the database returned (never through `Date`). Order and limit unchanged. `HISTORY_REQUEST_LIMIT` is now `HISTORY_PAGE_SIZE` (same 20) |
| Repository (N-1) | `BusinessOsExportRequestRepository.findOwnerLimitAnchor(userId, since)` | `select('requested_at, business_os_export_module_jobs!inner(status)')` (a real column, MX-4a C-1 rule), `.eq('user_id')`, `.eq('origin', 'owner')`, `.gt('requested_at', since)`, `.not('business_os_export_module_jobs.status', 'in', '(failed,interrupted)')` (from `MODULE_JOB_NOT_COUNTED`), `.order('requested_at', desc)`, `.range(1, 1)` (offset = `ownerLimitAnchorOffset()` = `OWNER_DAILY_LIMIT - 1`). Returns `{ requestedAt: string \| null }`. The returned row is Zod-parsed and must carry at least one counted job, else new code `unexpected_row` (fail closed). New error code `EXPORT_REQUEST_ERROR.UNEXPECTED_ROW` |
| Pure arithmetic | `lib/business-os/data-export/nextOwnerExportAt.ts` (new) | `ownerLimitAnchorOffset(policy)`, `ownerLimitWindowStart(nowMs, policy)`, `nextOwnerExportAt(anchor, policy)` = anchor + `DAILY_WINDOW_HOURS`, null for no anchor or an unparseable one; a sub-millisecond fraction rounds up 1 ms so the hint is never earlier than the database's own `retryAt` |
| Route | `app/api/business-os/export-requests/route.ts` GET | Header line "The query string is ignored" replaced. Order: session (401) → query: repeated key or `historyQuerySchema` fail → 400 `invalid_input` → throttle → in parallel `listRecentForUser(user.id, { limit: 21, before? })` and the hint read → `hasMore = rows > 20`, page = first 20, jobs of exactly those ids. Answer `{ requests, hasMore, nextExportAt }`. The hint read (`readNextExportAt`) never throws: an error result or a throw → `nextExportAt: null` and a warn `limit_anchor_unreadable`; history still 200. POST untouched |
| Seam | `lib/client/businessOsDataExport.ts` | `fetchModuleExportHistory({ before?: { requestedAt, requestId } })` builds `?before=…&beforeId=…` with `URLSearchParams` (a `+` offset is encoded). The ok verdict carries `hasMore` and `nextExportAt`; either missing or of the wrong type → `error` |
| Hook | `components/business-os/data-export/useExportDrawer.ts` | `loadOlder()`, `isLoadingOlder`, `isOlderUnavailable`. History `ok` state carries `hasMore`. Append drops request ids already shown (C-4). A first-page reload discards an older read in flight (generation counter). On the open's read (and its Try again) a future `nextExportAt` sets the same `daily_limit` refusal and `blockedUntil` timer a refused click sets; an existing database refusal is kept. Reloads after a start or an `in_progress` refusal do not apply the hint |
| Drawer + copy | `ExportDrawer.tsx`, `exportDrawerCopy.ts` | "Show older" button under the list only with `hasMore` (busy while loading); a failed older read shows `historyOlderUnavailable` with Try again, the list kept. Keys `historyShowOlder` / `historyOlderUnavailable` en/he/es (he/es drafts). "Export again at" reuses `copy.dailyLimit` with `{time}`: no new UI state, no new words |
| Tests | see Verification | T-10…T-16 below; mirror pins in the migration test (C-5) |

### C-5: the start function's counting predicate (migration `20261095`, quoted)

```sql
  v_limit := CASE WHEN p_origin = 'owner' THEN 2 ELSE 2 END;

  v_retry_from := (
    SELECT req.requested_at FROM public.business_os_export_requests AS req
     WHERE req.user_id = p_user_id
       AND req.origin = p_origin
       AND req.requested_at > now() - interval '24 hours'
       AND EXISTS (SELECT 1 FROM public.business_os_export_module_jobs AS job
                    WHERE job.request_id = req.id AND job.status NOT IN ('failed', 'interrupted'))
     ORDER BY req.requested_at DESC
     OFFSET (v_limit - 1) LIMIT 1);
  IF v_retry_from IS NOT NULL THEN
    RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, v_retry_from + interval '24 hours';
```

**Admin requests do not count toward the owner's limit.** The predicate filters `req.origin = p_origin`, and the owner route always starts with `p_origin = 'owner'`, so only owner-origin requests are counted (admin ones are counted apart, XC-20). `findOwnerLimitAnchor` matches it with `.eq('origin', 'owner')`. The SQL orders by `requested_at` only; the repository does the same (with ties the value at the offset is the same either way).

Pins: `supabase/migrations/__tests__/business-os-export-requests.migration.test.ts` gains "MX-4b N-1 mirror (SA C-5)": the predicate above is contained verbatim in the start body (one `v_retry_from` site), it carries `AND req.origin = p_origin`, `ownerLimitAnchorOffset()` equals the SQL owner literal minus 1 and `OWNER_DAILY_LIMIT - 1`, the window and retry use `DAILY_WINDOW_HOURS`, and a negative control (the origin line removed, or `OFFSET (v_limit)`) no longer matches. That file may not name the repository (callers guard), so the repository side is pinned call-for-call in `BusinessOsExportRequestRepository.test.ts` (origin `owner`, never `admin`; `range(1, 1)`; the `not in` filter; the real-column embed).

### Tests added (T-10…T-16)

| # | Where | What |
|---|---|---|
| T-10 | `route.test.ts` | 21 rows → 20 returned, `hasMore` true, jobs of those 20 only; exactly 20 → `hasMore` false; happy path now `{ requests, hasMore: false, nextExportAt: null }`, repository called with `(USER.id, { limit: 21 })` |
| T-11 | `route.test.ts`, `route.qa.test.ts` | A microsecond `+00:00` cursor reaches the repository byte for byte, with the session user only (also end to end through the seam) |
| T-12 | `route.test.ts` | 400 `invalid_input` and nothing read for: half a cursor (both ways), bad uuid, not a timestamp, over-long, a quote injection, empty `before`, `?userId=`, an extra key beside a valid cursor, a repeated key. 401 without a session before the query check |
| T-13 | `route.test.ts` | Anchor read with `(USER.id, now - 24 h)`; anchor + 24 h returned; no anchor → null; error result or rejection → null + `limit_anchor_unreadable` warn, history still 200 |
| T-14 | `nextOwnerExportAt.test.ts` (new) | Offset = `OWNER_DAILY_LIMIT - 1` (and follows the policy), window start, + window, sub-ms rounds up, unparseable → null, file purity |
| T-15 | `businessOsDataExport.moduleExport.test.ts` | ok verdict with both fields; missing / wrong-type `hasMore` or `nextExportAt` → error; cursor query string keys and untouched time |
| T-16 | `ModuleExport.render.test.tsx` | No button without `hasMore`; append in order with a repeated id dropped and the cursor taken from the last request untouched; failed older read keeps the list with retry; busy button ignores a second click; opened at the limit → Export off with the sentence, back on at the time (fake timers); a past hint or a failed read leaves Export on |
| Repo | `BusinessOsExportRequestRepository.test.ts` | Keyset `.or()` exact string; no cursor no `.or()`; 7 refused cursors with zero calls; 5 accepted time shapes; `findOwnerLimitAnchor` exact calls, null, 5 fail-closed shapes, mixed statuses, invalid input, DB error without `details` in logs |

### Deviations

- **Y-1** New pure file `exportHistoryCursor.ts` (not in §10): the route tests mock the repository module wholesale, so the shared schema and page size cannot live in the repository. The repository imports it; `HISTORY_REQUEST_LIMIT` stays exported with the same value.
- **Y-2** `hasMore` is worked out in the route (the existing `limit` option asked for 21), not inside the repository, so `listRecentForUser` keeps its return type. Edge: a row dropped by the per-row parse (already logged as an error) could make `hasMore` read false; the table CHECKs make such a row practically impossible.
- **Y-3** The hook also returns `isOlderUnavailable` (needed for the inline retry line).
- **Y-4** `nextExportAt` is read on every GET (also older pages), in parallel with the history read; the hook uses it only on the open's read and its Try again.
- **Y-5** Callers of the changed seam verdict type: three other component tests (`DownloadMyDataButton.test.tsx`, both `ExportDrawer.stacking*.test.tsx`) and QA's `route.qa.test.ts` had their ok literals extended (and the QA mock gained `findOwnerLimitAnchor`, plus one cursor round-trip test). The old `GET ?userId=` happy-path call in `route.test.ts` is now a T-12 400 case.
- **Y-6** One `sed -i` on `route.ts` stripped its CRs; restored to CRLF with a temp file and `os.replace`. Every touched file is uniformly CRLF (new files LF; `core.autocrlf` is true, so blobs are LF either way).
- **Y-7** Callers guard not edited: no new file names either repository class or `.from()`s a table.
- **Recommended before merge (as MX-4a C-2):** one read-only REST probe that the embedded `not.in` filter really filters parents: on an account with a failed-only owner request in the last 24 h, `GET /rest/v1/business_os_export_requests?select=requested_at,business_os_export_module_jobs!inner(status)&business_os_export_module_jobs.status=not.in.(failed,interrupted)&origin=eq.owner&user_id=eq.<uuid>` must not list that request. If the filter were ignored, a failed-only request could shift the offset and show a false "export again at" (the code checks the anchor row itself, not the rows above it). The POST still decides either way (K-8).

### Verification (2026-11-02)

- `npx jest lib/repositories/__tests__ app/api/business-os/export-requests components/business-os/data-export lib/client lib/business-os/data-export supabase/migrations/__tests__/business-os-export`: **177 suites, 4,237 tests, all pass.** (A first parallel run of a narrower set had 2 first-test timeouts in `ExportDrawer.stacking.qa.test.tsx` and `ModuleExport.render.test.tsx` under load; both suites pass alone (23/23) and in the full run above.)
- `npm run lint:hooks`: exit 0, no warnings.
- tsc, full: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` ran to completion (exit 2, 1,923 pre-existing `error TS` lines, semantic codes such as TS2339 / TS2345 present, no heap or fatal message). It **did fail on this slice**: 4 errors in `nextOwnerExportAt.test.ts` (the `as const` literal types in `OwnerLimitPolicy`), fixed by typing the policy as plain numbers.
- tsc, scoped after the fix: a tsconfig extending the root with the 19 touched `.ts` / `.tsx` files plus one planted file (`const planted: number = nextOwnerExportAt(null)`): exit 2 with **exactly 1 error, the planted one**; 0 in the touched files and everything they import.
- Line endings and the Tailwind hazard: no backslash followed by a hex digit in any added line or new file; no `console.*` in any touched source file.

### CR-1 fix (Dev, 2026-11-02, after SA code review)

| Change | Where | Notes |
|---|---|---|
| CR-1 guard 1 | `useExportDrawer.ts` | A new ref `isFirstPageInFlight`. `loadFirstPage` sets it, and the current generation's answer clears it. `loadOlder` does nothing while it is set, so no cursor is taken from a list that is about to be replaced |
| CR-1 guard 2 | `useExportDrawer.ts` (append updater) | An older answer is appended only if the list still ends with the cursor's `requestId`; otherwise the answer is dropped. This also covers any future cause of a list swap |
| CR-1 test | `ModuleExport.render.test.tsx` "SA CR-1: …" | Deferred promises: a list two pages deep, then a start whose first-page reload is held open, then a click on "Show older", then the first page resolves, then the older page. Expect the first page only, with no gap. **Run on the unfixed hook first: it failed** (received the older row appended after the new first page, the exact SA sequence); passes with the fix |
| Optimisation (SA) | `route.ts` GET, `route.test.ts` | With a cursor, the limit-hint read is skipped and `nextExportAt` is `null` (new test: anchor not called, null returned). Replaces Y-4's "read on every GET" |
| Contents doc | `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` §9.1, GET row only | The strict query step (400 `invalid_input` before the throttle), and `hasMore` / `nextExportAt` in the 200 answer |
| Y-2 | — | Left as is (SA) |

**Live probe of the embedded filter (TL, read-only, prod, service role; no keys or ids recorded):** select `requested_at,business_os_export_module_jobs!inner(status)`, `origin=eq.owner`, on the one account with owner requests:
- `business_os_export_module_jobs.status=not.in.(failed,interrupted)` returned 200 with 1 row (Content-Range `0-0/1`, job statuses `[sent]`).
- The discriminator `status=not.in.(sent)` returned 200 with 0 rows (`*/0`).

So the embedded `not.in` filter does drop parent rows with no matching job, and the offset is taken over counted requests only. Prod has no failed-only owner request, so that case could not be tested directly. This closes the "recommended before merge" probe above.

**Re-verification (2026-11-02):**
- Same Jest scope as above: **177 suites, 4,239 tests, all pass** (+2: the CR-1 case, and the skipped hint read on an older page).
- Scoped tsc, same tsconfig plus the planted file: exit 2 with exactly 1 error, the planted one; 0 in the touched files.
- `npm run lint:hooks`: exit 0.

## SA Review Notes

_SA will populate this section._

---

## QA Testing Report

_QA will populate this section._

---

## Commit Info

_RM will populate this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-01 | Created (EXPORT Dev, E7) | Workplan for MX-4 on `feature/bos-export-mx4-history-receipt` (off `origin/main` `eb2ee76a`). Plan §4.7 quoted. Core decision §4: `findDeletionFacts` combines the old ZIP reads with two new reads (owner module jobs `sent`, admin-origin requests), newest wins, `ownerExportDownloadedAt` follows the winner, all-or-nothing; alternatives R-A…R-D, placement D-1/D-2. Full history by keyset "Show older" (H-1); "export again at" on open from a server hint pinned to the start function's rule (N-1). Audit wording, owner labels, details guard; XC-19 test in entitlements `__tests__`. Contents doc rewrite outline for 5 modules on / 8 off and lookups independent of the switch. Findings: flags-xlsx requirement never committed (Q-7); user-visible "one zip file" line in `SecurityTab.tsx` (BQ-E7-1). Open questions Q-1…Q-12; live checks L-1…L-5. No migration, no lock |
| 2026-11-02 | MX-4a code complete (EXPORT Dev), uncommitted | Built per SA review C-1…C-9 / Q-1…Q-12 (split, Q-12): `findDeletionFacts` re-sourced (four reads, newest wins, Q-5 errors on an unparseable time), `findLatestOwnerSentAt` (real-column `!inner` embed + origin checked in code, C-1) and `hasAdminOriginRequest`, callers guard class allow-lists; audit wording and owner labels; exact REQUESTED detail keys; XC-19 test; stale comments; **BQ-E7-1 answered (user 2026-11-02, SA wording)**: SecurityTab line replaced and pinned; DE-10b section; MX-1b merge commit; requirement and plan status. Task list split 4a / 4b. Jest 296 suites / 7,006 tests and `test:bos-entitlements` 346 / 10,016 green. Deviations X-1…X-5. C-2 probe, C-6 claims and C-8 notice are TL's |
| 2026-11-02 | MX-4b code part complete (EXPORT Dev), uncommitted | MX-4a merged as PR #610. On `feature/bos-export-mx4b-history-paging` (off `26df15e5`): tasks 5 and 6 ticked. H-1 keyset "Show older" (strict cursor query, exact database time, quoted `.or()`, `hasMore` from 21 rows, duplicate ids dropped, failed older read keeps the list) per C-4; N-1 `nextExportAt` from `findOwnerLimitAnchor` + `nextOwnerExportAt` per C-5, with the start function's predicate quoted (owner-origin only; admin requests do not count) and pinned in the migration test. Jest 177 suites / 4,237 tests green, `lint:hooks` clean, tsc 0 errors in touched files (scoped run proven by a planted error). Deviations Y-1…Y-7; one embed-filter REST probe recommended before merge. Contents doc (task 10) not part of this change |
| 2026-11-02 | MX-4b CR-1 fixed (EXPORT Dev), uncommitted | SA code review CR-1: "Show older" refused while a first-page read is open, and an older page appended only to the list its cursor came from. A deferred-promise T-16 case failed on the old hook and passes now. SA optimisation: an older page skips the limit-hint read (`nextExportAt: null`). Contents doc §9.1 GET row updated (strict query 400, `hasMore` / `nextExportAt`). TL's live probe of the embedded `not.in` filter recorded (filter drops parents). Jest 177 / 4,239 green, scoped tsc 0 in touched files, `lint:hooks` clean |

---

## SA Workplan Review — 2026-11-01

**Reviewed by SA — 2026-11-01**
**Status:** Approved with conditions (C-1…C-9). Code may start once Dev has read the conditions; no re-review of the workplan needed.

Live facts used (TL, read-only on prod, 2026-11-01): L-1 columns match `20261095` as the workplan states; L-2 exactly one FK jobs to requests (`business_os_export_module_jobs_request_id_fkey`, ON DELETE CASCADE), so the embed is unambiguous; L-3 owner/sent jobs 3, sent with null `sent_at` 0, owner requests 1, admin requests 0; L-4 the old table's kind column is `requested_by_kind` (the workplan uses that name correctly in §4.2 and the current code), rows owner/ready 2 (both downloaded, newest `ready_at` 2026-10-30 12:48 UTC), owner/expired 3, owner/failed 1, no admin rows; the bucket was emptied 2026-10-31. L-5 not run (see C-2).

### Core decision: the new `findDeletionFacts` meaning

Approved as written in §4.2 (R-A A, R-B A, R-C A, R-D A). It matches B.6 exactly and XC-12 read as the end state after MX-7. What DELETE's receipt and D6 must be told in the interface notice (C-8):

- `ownerLastExportReadyAt`: the later of the newest owner ZIP `ready_at` and the newest `sent_at` of an owner-origin module job with `status = 'sent'`. It is per job, not per request: one module sent out of five counts. It means "some owner data reached the owner by email at this time", not "a complete export".
- `ownerExportDownloadedAt`: a value only when an old ZIP is strictly newer than every sent owner module job; `null` otherwise, and always `null` after MX-7. On prod today the newest module job is expected to be after 2026-10-30 12:48, so this already reads `null` for the one live owner. DELETE must not build on `downloaded` (already in the coordination log, 2026-10-27).
- `adminExportExisted`: any admin ZIP row or any admin-origin request, whatever its outcome. `false` everywhere until MX-5.
- An old "ready" ZIP whose file was removed with the bucket still counts: the fact recorded is that it was delivered, which stays true.
- Errors: any of the four reads failing returns `{ data: null, error }`; never partial facts.

### Rulings

| Q | Ruling | Why |
|---|---|---|
| Q-1 | A: `status = 'sent'`, value `sent_at` | The table CHECK ties `sent_at` to every part accepted; part `at` values are not CHECK-proven, and `requested_at` says nothing about delivery |
| Q-2 | No | "Owner-origin" is the binding text; a yes is a requirement change and MX-5 sends are already recorded by `adminExportExisted` |
| Q-3 | `lib/business-os/entitlements/__tests__/` | Runs in the required entitlements job, where whoever adds a gate will see it; add-only per S-12 |
| Q-4 | No; type and its comment byte-identical | B.6 frozen; its existing comment ("always null for module exports") is already right; the JSDoc carries the meaning |
| Q-5 | **Changed: the whole call errors** (not "loses with a warn") | A dropped value silently makes the older fact the "last export" in a receipt kept for years; fail closed like any read error (K-3) |
| Q-6 | (a) yes, CC-6 claim is enough; (b) confirmed, no change to `eventAudience.ts`; (c) approved; (d) as is | (a) wording only, severity unchanged; (b) MX-3b already added both `shared`; (c) the owner label is the AC's presentation; (d) details are ids, module, counts and a code, all the owner's own |
| Q-7 | F-1 | This repo cannot mark a file it never tracked; committing a superseded draft adds noise |
| Q-8 | Remove; one pointer line to git history | The doc must describe what ships (K-10); the ZIP code is deleted |
| Q-9 | D-1 | Each table keeps a single reading repository; MX-7 then deletes only old reads |
| Q-10 | H-1, with C-4 | Only option that meets "full history" |
| Q-11 | N-1, with C-5 | Hint only, POST stays the authority; N-3 needs a migration this slice does not have |
| Q-12 | **Changed: split now.** MX-4a = receipt facts, audit, XC-19 test, carry-overs, DE-10b section, MX-1b row; MX-4b = paging, "export again at", contents doc | The receipt gap is live and DELETE's switch-on waits on it; 2.1 d is over the cap; two small PRs each from `main` (XC-17, not stacked) |

### Conditions

- **C-1** The embed selects a real column, `business_os_export_requests!inner(origin)`, never an aggregate: `CRMContactRepository.ts` l.464–480 documents that `!inner` on an aggregate-only embed is silently inert. The read also checks in TypeScript that the returned row's embedded `origin` is `owner`; any other value is an error (fail closed), not a fact.
- **C-2** L-5: a mocked unit test cannot prove the filter is applied. Before MX-4a merges, QA (or TL) runs one discriminating read-only REST probe with the service role against prod: `origin=eq.owner` returns at least one row and `origin=eq.admin` returns `[]` (if the filter were ignored both would return rows). Record both results in the QA report without keys or ids. If the probe cannot be run, use the two-read fallback of §4.4 instead.
- **C-3** T-8 asserts the exact select string and the exact `.eq('business_os_export_requests.origin', 'owner')` and `.eq('status', 'sent')` calls; T-9 gains the unparseable-timestamp case returning an error (Q-5).
- **C-4** (MX-4b) The cursor timestamp is passed back to the database exactly as it was returned (validated by Zod against a timestamp pattern, length-capped), never re-serialised through `Date`: `toISOString` drops microseconds and would skip or repeat rows at a page edge. The keyset filter's values are quoted inside `.or()`. The hook drops duplicate request ids when appending.
- **C-5** (MX-4b) The Implementation Notes quote the start function's counting predicate from the migration, and the mirror test pins the OFFSET and that only owner-origin requests count toward the owner's limit. If the SQL counts admin requests too, `findOwnerLimitAnchor` must match it.
- **C-6** CC-3 claim on `DangerZonePanel.tsx` and the CC-6 claim on `events.ts` are posted before those edits; insert only at EXPORT's anchor.
- **C-7** `SecurityTab.tsx` changes only on the user's answer to BQ-E7-1, with the copy below; it is a single English string (the file has no he/es).
- **C-8** The interface notice states the five bullets above verbatim and is posted, and DELETE's acknowledgement recorded, before the MX-4a PR opens.
- **C-9** `npm run test:bos-entitlements` output recorded; the callers guard stays green and its non-vacuity case still fails a planted file.

### Proposed BQ-E7-1 copy

The module export sends one CSV spreadsheet per chosen area by email, split into more emails when large; documents and images are not included. Dev's "one file per part you choose" is ambiguous ("part" is also the size split). Proposed:

"Your export arrives by email as spreadsheet (CSV) files, one for each area you choose. A large area may come in several emails. Documents and images are not included; you can download them one by one."

### Approval
[x] Workplan approved with conditions C-1…C-9, as two PRs (MX-4a then MX-4b)

---

## SA Code Review — MX-4a — 2026-11-02

**Reviewed by SA — 2026-11-02**
**Status:** Code approved with one condition (CR-1). Diff reviewed uncommitted against `origin/main` `eb2ee76a` (HEAD = `origin/main`).

### Checks against the workplan review

| Item | Result |
|---|---|
| Q-4 frozen interface | `DataExportDeletionFacts` (l.99) is outside every hunk; the `findDeletionFacts` signature line is unchanged |
| Four reads on `user_id` | O1/O2 unchanged; N1 `.eq('user_id')` + `status sent` + embedded origin `owner`; N2 head count `user_id` + `origin admin`. All pinned call-for-call in the tests |
| Ties | `zipIsNewest` only when `zipTime > moduleTime`; the tie and offset tests (T-6) prove instant comparison, not text |
| Q-5 | An unparseable `ready_at` or `sent_at` throws, so the result is `{ data: null, error }`; the log names the field only |
| C-1 | Real-column embed `!inner(origin)`; the Zod row schema requires `origin` literally `owner`, otherwise `unexpected_row` (4 fail-closed cases) |
| C-2 | Satisfied by TL's prod probe 2026-11-02 (owner filter 1 row, admin filter `[]`). QA copies it into the QA report without ids |
| C-3 | Select string and both `.eq` filters pinned exactly; T-9 has the unparseable case |
| C-6 / C-8 | Recorded by TL in the coordination file (DELETE ack: all 5 points) |
| C-9 / guard | Guard 176 to 182 lines; content diff is the header and two class allow-lists only, `.from()` rules untouched |
| X-4 line endings | Every touched file is all-CRLF, the same as its `origin/main` blob (CRLF lines equal total lines on both sides) |
| XC-19 | Can fail: the registry is `Record<string, string[]>`, planted registries and 12 planted import cases check both directions, and a separate test proves the scan reads the real export files |
| SecurityTab | `SecurityTab.tsx:445` is exactly the approved sentence; the test pins it |
| Logging | No `console.*` in any touched file |
| Jest (SA run) | Requested paths: 170 suites, 3,619 tests, all pass |

### Code Review Comments

1. **CR-1** `lib/audit/ownerEventPresentation.ts:40-41` (X-5): the wording should be **area**. A `DATA_EXPORT_MODULE_SENT` / `_FAILED` row covers one module job, which is one area. "Part" is the size split, the word the SecurityTab line now uses for a different thing ("A large area may come in several emails"). Change en to "One area of your export was sent by email" / "One area of your export could not be sent", update he/es to match, and update the it.each in `ownerEventPresentation.test.ts:33-45`. This is a condition: make the change before the PR, then QA checks it. No SA re-review needed. Priority: Medium.

### Optimisation Suggestions

- `exportNotEnforced.test.ts` exports helpers from a test file. Harmless, but `export` is not needed.
- `findDeletionFacts` creates two repositories on each call. That is fine at one call per account delete.

### Code Approved for QA: Yes, with CR-1 done before the PR

---

## QA Report — MX-4a — 2026-11-02

**Test mode:** full · **Strategy:** A (Jest, in memory, mocked client) + consumer regression · **Focus:** api, security, ui copy · **Skipped:** live writes (none allowed) · **Input source:** TL prompt

### Test coverage

| Check | Result | Evidence |
|---|---|---|
| 1 Only old ZIP ready: ZIP `ready_at` + `owner_downloaded_at` | Pass | temp QA suite |
| 2 Module job newer: job `sent_at`, downloaded null | Pass | uses the live value shape `2026-10-31T17:35:52.018+00:00` |
| 3 Tie (same instant, different text and offset): module wins, downloaded null | Pass | proves `Date.parse`, not text compare |
| 4 ZIP strictly newer (text order says the opposite): ZIP + its downloaded | Pass | also: module only, and no rows at all, both correct |
| 5 Admin request, no admin ZIP: `adminExportExisted` true | Pass | admin ZIP alone also true |
| 6 Each of the four reads failing alone: `{data:null,error}` | Pass | missing request count is also an error |
| 7 Unparseable ZIP `ready_at` / job `sent_at`, or null `sent_at`: error | Pass | error message does not contain the bad value |
| 8 Embed origin `admin` (and array-shaped embed): error | Pass | |
| 9 Invalid uuid: error, zero `from()` calls | Pass | |
| 10 Each of the 4 reads has exactly one `user_id` filter = caller | Pass | module read also filters `status=sent`, `business_os_export_requests.origin=owner`, `!inner(origin)` select, `sent_at desc` |
| DELETE consumers | Pass | account/delete (3 suites), account/deletion-check (2), admin/test-account-cleanup (2): 9 suites / 219 tests with QA suite |
| SecurityTab copy | Pass | exact sentence rendered and asserted in `agentPlatformEntryPoints.render.test.tsx` (E3); no "zip file"/"README" |
| Owner labels en/he/es (after CR-1) | Pass | all three events give non-empty en/he/es and keep details; old `DATA_EXPORT_READY` stays unlabelled; CR-1 text matches the SA wording |
| Requested suites | Pass | `lib/repositories lib/audit lib/business-os/data-export components/business-os/data-export app/api/business-os lib/business-os/entitlements`: 277 suites / 6702 tests; after CR-1, lib/audit + data-export rerun 24 / 273 |
| `npm run test:bos-entitlements` | Pass | 347 suites / 10041 tests |

### Live facts (read-only, from TL, no user ids)

Newest owner module job sent 2026-10-31T17:35:52Z; newest old ZIP `ready_at` 2026-10-30 12:48. The module job is later, so the expected receipt is lastReadyAt `2026-10-31T17:35:52.018+00:00`, downloadedAt null, adminExportExisted false. This is the case scenario 2 tests. C-2 REST probe: the owner-origin filter returned 1 row and the admin-origin filter returned `[]`, so the `!inner` embed filter does filter.

### Issues found

**Bugs:** none.

**Edge cases (nice to fix):**
1. Old ZIP admin head count: `admin.count ?? 0` turns a missing count with no error into `false`. The new request count fails closed instead. This was already there before MX-4a, but the two reads now handle a missing count differently. Low. File: `lib/repositories/BusinessOsDataExportJobRepository.ts`.

### Cleanup

Temp `lib/repositories/__tests__/zz-qa-mx4a.test.ts` deleted. `git status` shows Dev's 19 modified + 2 new files only.

### Final status
- [x] All acceptance criteria pass, ready for commit

---

## SA Code Review — MX-4b — 2026-11-02

**Reviewed by SA — 2026-11-02**
**Status:** Code approved with one condition (CR-1). Diff reviewed uncommitted in worktree `neuronforge-mx4b`, branch `feature/bos-export-mx4b-history-paging`, off `main` `26df15e5` (20 modified + 3 new files).

### Checks against the workplan review

| Item | Result |
|---|---|
| C-4 cursor not through `Date` | The route hands `before` from the query straight to the repository; the hook takes `last.requestedAt` from the server answer; the seam builds the query with `URLSearchParams` (a `+` offset goes out as `%2B`). No `Date` anywhere on the cursor path. T-11 pins a microsecond `+00:00` value byte for byte, also through the seam |
| C-4 `.or()` quoted, injection | Both values double-quoted. The time passes an anchored pattern (JS `$` without `m` matches only at end of input) of digits, `-:.+TZ` and a space, capped at 40; the id is a Zod uuid. Neither can hold `"`, `,`, `(`, `)` or a backslash, so a value cannot close its quote or add a condition. The repository parses the cursor again before the call (refusal = `invalid_input`, no query sent). Safe |
| C-4 dedupe | The append drops ids already shown, and ids repeated inside the new page. Pinned in T-16 |
| C-5 predicate | Quoted verbatim in the Implementation Notes; the mirror test asserts it is contained exactly in the start body, one `v_retry_from` site, `AND req.origin = p_origin`, OFFSET = owner literal − 1 = `ownerLimitAnchorOffset()`, window and retry from `DAILY_WINDOW_HOURS`. The negative controls are not vacuous: the first assertion proves the predicate is present, so a replace that did not apply would fail the control |
| C-5 owner origin only | The SQL counts `req.origin = p_origin`, so admin requests do not count against the owner; the repository sends `.eq('origin', 'owner')`, pinned call for call. SQL orders by `requested_at` only and so does the repository: correct (with ties, the value at the offset is the same) |
| PostgREST `!inner` + embedded `not.in` | Correct, if the TL probe confirms what the PostgREST docs describe. A filter on an embedded resource narrows the embedded rows; `!inner` then drops a parent whose filtered embed is empty, and LIMIT/OFFSET apply to the parents left after that. So a request with only `failed` / `interrupted` jobs is not a parent row, and does not shift the offset. The embed selects a real column (MX-4a C-1), and the Zod row check requires at least one counted job. That check covers the anchor row only, not the rows above it, so the probe still matters: a filter that was ignored would give a false "export again at". The POST still decides either way (K-8) |
| Route order and rules | 401 (session) → 400 (repeated key, or strict `historyQuerySchema`) → throttle → reads. The 400 uses the standard error shape, with `details` only in development. The account comes from the session only, and `?userId=` is a 400. Pino `requestLogger` with correlationId, no `console.*` in any touched file. DB access only through the two repositories, each with `.eq('user_id')` first. A failed hint read is `nextExportAt: null` plus one warn, and the history is still served |
| Hook race: first page vs older | A first-page reload bumps `historyCall`, so an older read **started before** it is discarded. An older read **started during** a first-page read is not discarded. See CR-1 |
| Y-2 | Acceptable. A row dropped by the per-row parse is already logged as an error, and the table CHECKs make one practically impossible. The only effect is that "Show older" ends one page early, with nothing shown wrong. An optional fix is under Optimisation Suggestions |
| Y-1, Y-3…Y-7 | Accepted. Y-1 is a pure file with Zod only and no I/O. It is a sound place for the shared schema, and it adds no new pattern |
| Contents doc spot-check | §2: the 13 modules, their sections and on/off match `EXPORT_MODULES` exactly. §4: the `lookupSectionsFor` output for all 13 modules (run with tsx) matches the §4.4 table, and `STAYS_ID`, `CROSS_MODULE_TARGET_SECTIONS` (clients/services/pipeline_stages) and the 100,000 ceiling match. §5: a script compared every section block with `PURGE_DESCRIPTORS`. All 38 include sections match: table, included columns in order, and the count of excluded columns. 164 descriptors (38 include, 126 exclude), and every excluded table is named in §6. §9: cron `*/5 * * * *`, `RATE_LIMITS.read` 120/300 s and `create` 10/900 s, lease 420, 3 build attempts, 5 notice attempts, cutoff 90, budget 270, 45 s part timeout, 5 s margin, 600 ms gap, 7,000,000 bytes, 10 parts: all match. The three ⚠️ stale code strings are correctly quoted, not copied as fact. Header, ToC and Change History are present; Q-8 removed the ZIP sections and left a git-history pointer; the F-1 note is in Change History |
| Line endings / Tailwind hazard | Every modified file is all-CRLF (CR count = line count, the same as its `HEAD` blob). The 3 new files are CRLF too. No backslash before a hex digit in any added line |
| Jest (SA run) | `lib/repositories/__tests__ app/api/business-os/export-requests components/business-os/data-export lib/client lib/business-os/data-export supabase/migrations/__tests__/business-os-export-requests.migration.test.ts`: **177 suites, 4,237 tests, all pass** (51.6 s) |

### Code Review Comments

1. **CR-1 (must fix before the PR)** `components/business-os/data-export/useExportDrawer.ts:145-175` (`loadOlder`): an older page can be appended to the wrong list. `loadFirstPage` keeps the old `ok` list on screen while it reads (l.126), and that list can be several pages deep with `hasMore` true. So "Show older" stays enabled during the read. A click then captures `call = historyCall.current`, which is already the new generation, with the deep list's last request as the cursor. If the first page answers first, it replaces the list with 20 rows. The older answer then passes the `call` check and appends rows older than the deep cursor to those 20 rows. Every request in between silently disappears from the history until the next reload. The paths are the reload after a start (l.238) and after an `in_progress` refusal (l.243), and every open if the hook outlives a close. Fix (Dev's choice): (a) in the `setHistory` updater, append only when `previous.requests` still ends with the cursor's `requestId`, otherwise drop the answer; or (b) refuse `loadOlder` while a first-page read is in flight (a ref set and cleared by `loadFirstPage`). Option (a) also covers any future cause. Add one T-16 case with deferred promises: deep list, start → reload pending, click "Show older", first page resolves, then the older page resolves. The list must be the first page only (or first page plus its true next page), with no gap. QA checks it; no SA re-review needed. Priority: Medium.

### Optimisation Suggestions

- `app/api/business-os/export-requests/route.ts:224`: Y-4 reads the limit anchor on older pages too, and the hook ignores it there. One extra indexed read per "Show older". Harmless, but `nextExportAt: null` without the read when a cursor is present would save it (the seam already accepts null).
- Y-2: `listRecentForUser` could also return the raw row count, or the route could ask for 21 and work out `hasMore` before the parse drops anything. Not needed now.
- `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md:1058` (§9.1, GET row): add the strict query step (400 `invalid_input` before the throttle) and the `hasMore` / `nextExportAt` fields, so §9.1 agrees with §9.6 and §9.2. This can be done with CR-1.
- Follow-up, not this slice: the three stale strings the docs Dev flagged live in `lib/business-os/purge/descriptors.ts`: `EXPORT_COLUMN_REASON.OWNER_ID` (l.117, `export_metadata.user_id`), `DOCUMENT_STORAGE` ('Your files', DE-8b) and the two `STORAGE_DESCRIPTORS` buckets marked `include` with ZIP folders. Raise them as an MX-7 carry-over, because they are purge-classification strings with tests of their own.

### Code Approved for QA: Yes, with CR-1 done before the PR

---

## QA Report — MX-4b — 2026-11-02

**Test mode:** full · **Strategy:** A (Jest, in memory, mocked client) plus temporary QA suites, all deleted afterwards · **Focus:** api, security, ui, schema · **Skipped:** live rows (not allowed), browser check (the TL prompt asked for Jest evidence; the live REST probe of the embedded filter is TL's, recorded above) · **Input source:** TL prompt

Diff checked uncommitted in worktree `neuronforge-mx4b`, off `main` `26df15e5`: 20 modified files and 3 new ones.

### Test coverage

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | T-10…T-16 present and assert what they claim | Pass | T-10: 21 rows give 20 back, `hasMore` true and jobs for those 20 only; exactly 20 give `hasMore` false. T-11: a microsecond `+00:00` cursor reaches the repository byte for byte, with `USER.id`. T-12: 10 × 400 `invalid_input` with zero reads and no throttle call (half cursor both ways, bad uuid, not a timestamp, over-long, quote injection, empty `before`, `?userId=`, extra key beside a valid cursor, repeated key); 401 without a session, ahead of the query check. T-13: anchor read with `now - 24 h`, result anchor + 24 h; no anchor gives null; error and rejection give null, a `limit_anchor_unreadable` warn, and the history is still 200. T-14: offset, window, sub-ms rounding up, unparseable gives null, purity. T-15: ok with both fields; 5 wrong shapes give `error`; cursor keys. T-16: see 5 and 6 |
| 2 | C-4: the cursor never goes through `Date`; `.or()` quoted; dedupe | Pass | Code read: the route passes `before` straight on; the repository row schema is `z.string()`; `assembleExportHistory` copies `requestedAt`; the hook takes `last.requestedAt`; the seam uses `URLSearchParams`. The only `Date` uses are on `nextExportAt`, `blockedUntil` and the older POST email code. **QA end-to-end suite** (seam, fetch bridge, real GET, REAL repository, recording Supabase client), with `2026-10-31T17:35:52.018123+00:00`, `2026-10-31 17:35:52.018123+00` and `2026-10-31T17:35:52.000001-05:30`: the DB string comes out of the seam unchanged, and goes back as `requested_at.lt."<t>",and(requested_at.eq."<t>",id.lt."<id>")` exactly. `user_id` is applied before the keyset, the page reads 21 rows, and an older page makes no `range` (hint) call: 4/4. **QA render suite**: the hook through the real seam puts the microsecond `+00:00` time into the URL byte for byte. Dedupe is pinned by T-16 |
| 3 | C-5 mirror and its negative controls | Pass | QA loaded the REAL migration test against an in-memory mutated copy of `20261095` (`fs.readFileSync` mocked, disk untouched). Mutations at the counting site: origin line dropped; origin replaced by `IS NOT NULL`; `OFFSET (v_limit)`; owner literal 3; `NOT IN ('failed')`; `ASC`; 12 h window; 12 h retry. **All 8 turn the mirror red** (1 failed / 4 passed each). The unmutated copy gives 5/5. Note: `AND req.origin = p_origin` appears twice in the start body (l.207 `in_progress`, l.219 counting). A mutation of the first site leaves the mirror green, which is correct because it is a different query. Dev's own control targets the second site (with `AND req.requested_at` as context), so it is not vacuous |
| 4 | CR-1 guards | Pass, with one gap (E-1) | Hook backed up, then edited with the Edit tool and restored. SHA-256 of the file and of `git diff` were identical before and after (`d032579d…`, `7d0c14fe…`); 273/273 CRLF. Results of the "SA CR-1" test: both guards removed → **fails** (received `88888888…` appended after the new first page); guard 1 (`isFirstPageInFlight`) removed only → passes; guard 2 ("list still ends with the cursor id") removed only → passes. So the test proves that the pair closes the race, but neither guard is pinned on its own (E-1) |
| 5 | N-1 behaviour | Pass | T-16: a future hint on open turns Export off with "You can export again at {time}", and fake timers turn it back on at that time; a past hint leaves Export on; a failed read leaves Export on. QA render suite adds: hint `null` → Export on, no alert; a seam 500 → on; a future hint on the **reload after a start** is not applied (only on the open). Route: a hint failure serves the history, `nextExportAt` null, warn logged (T-13); with a cursor the anchor read is skipped (route test, plus QA e2e: no `range` call) |
| 6 | Copy keys, RTL | Pass | `historyShowOlder` / `historyOlderUnavailable` are in en/he/es (`exportDrawerCopy.test.ts` plus QA). QA Hebrew render: the button shows `he.historyShowOlder` inside the `dir="rtl"` container; a failed read shows the Hebrew line with Hebrew Try again, and the list is kept (2); the retry appends (3) and the button goes |
| 7 | Contents doc | Pass | 1,212 lines, 1,212 CRLF, ends with `\r\n`. All 12 ToC anchors resolve to headings (script over 94 headings). `## Change History` is last, and the old 2026-10-17 row is kept above the new 2026-11-02 row. No backslash followed by a hex digit in the doc, in any added diff line, or in the 3 new files. The §9.1 GET row matches `route.ts`: 401 → strict query 400 `invalid_input` → throttle `RATE_LIMITS.read` 120/300 s, key `export-request-history` → 200 `{ requests, hasMore, nextExportAt }`, 21 read / 20 returned, hint on the first page only. §9.6 agrees |
| 8 | Regression | Pass | Jest, 8 requested paths: **250 suites, 7,232 tests, all pass** (107 s), nothing to compare against `main`. `npm run test:bos-entitlements`: **346 suites, 10,045 tests, all pass**. (A first run while QA's temporary e2e file existed failed the callers guard, which named that file. The guard works; the rerun after deletion was green) |
| 9 | Logging, DB access | Pass | No `console.*` in any added line or touched source file. The route uses the Pino `requestLogger` (correlationId child) and the seam uses `createLogger`. DB access in route and components only goes through the two repositories; both new reads `.eq('user_id')` first |
| — | Every touched file uniformly CRLF | Pass | CR count = line count for all 23 files |

### Issues found

**Bugs:** none.

**Edge cases (nice to fix):**
1. **E-1** No CR-1 guard is pinned on its own: the "SA CR-1" test still passes with either guard removed. Add `expect(mockHistory).not.toHaveBeenCalledWith({ before: expect.anything() })` right after the click during the held reload; that pins guard 1. Guard 2 cannot be reached from the UI today, because every list swap bumps the generation. It is defence in depth, and only a hook-level test could pin it. Low. File: `components/business-os/data-export/__tests__/ModuleExport.render.test.tsx`.
2. **E-2** The test "a nextExportAt already past, or none, leaves Export on" only exercises "past". QA covered `null` in its temporary suite (it passes). Split the test, or add the null case. Low. Same file.
3. **E-3** The T-12 401 case asserts the status only. Add `mockListRecent` / `mockLimitAnchor` not called, as the 400 cases do. QA's e2e suite showed that no DB call is made. Low. File: `app/api/business-os/export-requests/__tests__/route.test.ts`.

### Cleanup

The temporary suites were deleted: `app/api/business-os/export-requests/__tests__/zz-qa-mx4b.e2e.test.ts`, `supabase/migrations/__tests__/zz-qa-mx4b-mut.test.ts` and `components/business-os/data-export/__tests__/zz-qa-mx4b.render.test.tsx`. `useExportDrawer.ts` was restored byte-identical. `git status` shows only Dev's 20 modified and 3 new files. No live rows, no build run, `.next` untouched.

### Final status
- [x] All acceptance criteria pass, ready for commit (E-1…E-3 optional, Low)
