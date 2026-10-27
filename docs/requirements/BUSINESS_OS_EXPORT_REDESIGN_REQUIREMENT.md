# Requirement: Business OS — Export Redesign (per-module export, delivered by email)

> **Last Updated**: 2026-10-25

**Created by:** BA
**Date:** 2026-10-25
**Status:** Draft (split scope). The parent requirement was approved by SA with conditions XC-1 to XC-21 on 2026-10-25. This file is not Approved on its own: the business questions in §9 still need the user's answers, and TL or the user must sign off on the split.
**Parent / index:** [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) (v2 + `## SA Review — 2026-10-25`, binding). Where this file and the parent disagree, the parent's SA review wins and this file gets fixed.
**Sibling scope:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) (DELETE: lifecycle A–E, Keep my account, plan cancel). A separate Claude session builds it at the same time. See §11 for the boundary.
**Source brief:** [BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md) item 4, TL notes R-5 to R-10.

---

## Overview

This scope replaces today's instant "Download my data" ZIP with a **per-module export**. The owner ticks the modules they want. Each module runs as its own background job and arrives as **its own email with one joined CSV attached**, split into "email 1 of X" when it is large. The drawer keeps a history of every export. An admin can send the same export to the owner's own login email. Once this is live, the ZIP, the 72 h link, "download again" and the DE-8a job table are retired and then dropped. One live safety bug in the CRM / Orders list export (LX-1) is fixed first, in a different branch.

---

## Table of Contents

1. [Scope](#1-scope)
2. [User stories](#2-user-stories)
3. [What the owner sees](#3-what-the-owner-sees)
4. [Rules](#4-rules)
5. [What is retired and what is reused](#5-what-is-retired-and-what-is-reused)
6. [Delivery slices and effort](#6-delivery-slices-and-effort)
7. [Acceptance criteria](#7-acceptance-criteria)
8. [Scenarios](#8-scenarios)
9. [Business questions for this scope](#9-business-questions-for-this-scope)
10. [SA conditions that apply](#10-sa-conditions-that-apply)
11. [Boundary and coordination with the other scope](#11-boundary-and-coordination-with-the-other-scope)
12. [Non-functional requirements](#12-non-functional-requirements)
13. [Out of scope / future roadmap](#13-out-of-scope--future-roadmap)
14. [Notes on integration points](#14-notes-on-integration-points)
15. [Change History](#change-history)

---

## 1. Scope

| In scope (EXPORT) | Not in this scope |
|---|---|
| Module map and per-module switches (MX-0) | Deletion lifecycle A–E, Keep my account, lock, ready list (DELETE) |
| New export request + module-job tables, DB start function, claim/reap RPCs, descriptors, cleanup regeneration (MX-1a) | Plan cancel / keep, Stripe Connect fixes (DELETE: SX-1/2/3/5) |
| Export drawer, "Export requested" email, `isModuleExportEnabled()` (MX-1b) | The deletion drawer itself (DELETE). It only **links** to the export drawer (§11) |
| Joined CSV builder, lookups, header labels en/he/es (MX-2a, MX-2b) | Per-list export from the screen the owner is on (later) |
| Cron worker, part splitting, never-duplicate sends, failed / interrupted / too-large emails (MX-3) | Exporting files (client documents, website pictures) |
| History, per-module audit, **receipt export facts re-sourced** (XC-12), switch on (MX-4) | Excel (`.xlsx`) |
| Admin "Send export to owner" (MX-5, XC-20) | |
| Retire the ZIP code, routes, cron, bucket (MX-6) | |
| Drop `business_os_data_exports` + its start function, regenerate cleanup (MX-7) | |
| **LX-1** CRM / Orders list export safety fix: **done elsewhere** (§6.1) | |

---

## 2. User stories

- As an **owner**, I want to choose which parts of my data to export and get each part by email, so that I can move to another tool.
- As an **owner**, I want to see what I exported and when, so that I know I have everything before I leave.
- As an **owner in the 14-day grace, read-only or paused**, I want export to keep working, so that I can take my data on my way out.
- As an **admin**, I want to send an owner their export without ever receiving their client data myself.
- As the **product owner**, I want every export request, module sent and module failed in the audit trail, with no content in it.

---

## 3. What the owner sees

1. Settings → **"Export data"** opens a side drawer. The Danger Zone's "Download my data" opens the same drawer. The deletion drawer (DELETE scope) links to it.
2. The drawer lists the modules (§4.1), each with a tick box, plus **"Select all"**. One line: "Files (client documents, website pictures) are not included. Download client documents from each client's record."
3. **"Export"**. The drawer says: "Your export has started. Each part will arrive in its own email at {login email} within a few minutes." (cron-only worker, XC-8). No download in the browser.
4. One **"Export requested"** email lists the chosen modules with the request date and time.
5. Each module arrives in **its own email** with **one CSV attached** (split into "email 1 of X" when large). The email names the module and says when it was requested and when it was produced, in the account's timezone (UTC, labelled, if not set).
6. If a module fails, the others still arrive, and the failed one sends **"This part of your export failed. Please try again"**. A module interrupted halfway through sending sends **"This part was interrupted. Please export it again"** (BQ-43). A module over the maximum sends **"This part is too large to email. Please contact support"**.
7. The drawer shows the **export history**: module, requested at, status (waiting, working, sent, failed, interrupted), sent at, number of emails. Newest first. The word is "sent", never "delivered": bounces are not tracked (XC-9).
8. When the limit is reached (§4.4), the Export button is off with "You can export again at {time}".

Export works in **every** lifecycle state: active, read-only, paused, DELETE stage C, and (admin-started only) stage D.

---

## 4. Rules

### 4.1 The modules

Built from the export classification (`export` field in `lib/business-os/purge/descriptors.ts`) and a **module map** in config (one pure file, MX-0), never written in the UI. Each `include` section belongs to exactly one module; a CI test fails otherwise. Module names in en/he/es.

| # | Module | Sections (today's ids) |
|---|---|---|
| 1 | Clients | `clients`, `pipeline_stages` (as a label), `client_documents` (document details only, no files) |
| 2 | Activities & tasks | `client_activities`, `client_tasks` |
| 3 | Bookings | `bookings`, `time_off` |
| 4 | Services | `services` |
| 5 | Quotes | `quotes` |
| 6 | Invoices & payments | `invoices`, `payments`, `refunds`, `client_payment_methods` |
| 7 | Payment plans | `payment_plans`, `client_payment_plans`, `installments` |
| 8 | Forms | `intake_settings`, `intake_forms` |
| 9 | Email campaigns | `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments` |
| 10 | Newsletter subscribers | `newsletter_subscribers`, `consent_records`, `consent_settings`, `email_unsubscribes` |
| 11 | Website | `website_content`, `website_pages`, `website_blocks`, `images` (picture details only, no files) |
| 12 | Smart links | `smart_links` |
| 13 | Account & business details (BQ-27) | `account_identity`, `user_profile`, `preferences`, `notification_settings`, `business_profile`, `business_addresses`, `payment_account`, `payment_providers` |

The placement is a BA default; the user can move any line (BQ-27). What a section holds (columns, allow-lists, row filters) does not change.

### 4.2 One joined CSV per module (BQ-26, XC-10)

| Column group | What |
|---|---|
| Record type | "Client", "Document", "Activity", "Task", … in the owner's language |
| Belongs to | For child records, the parent's readable name (client name and email, page title), repeated on every row |
| The record's own columns | Union of column keys in module section order, at their first appearance. The same key always maps to the same column. A column another type does not have is blank |
| Lookups | Ids become labels only for the module's own sections and for stage, service and client name, read through the classified reader. When the target is excluded or switched off, the id stays |
| IDs | Record ID and parent ID last |

A one-table module (Services, Quotes, Smart links) is that table with friendly headers. Formula rule: the BC-1 rule in `data-export/csv.ts` (a string starting with `=` `+` `-` `@` TAB or CR gets an apostrophe; typed numbers untouched) is **the** rule. Header labels live in a server-only pure file `data-export/columnLabels.ts`, not in the client translation bundles.

### 4.3 Emails and splitting

| Rule | Value |
|---|---|
| To | The account's **login email** at send time. Never an address from the request |
| From | `RESEND_FROM_EMAIL`, `notifications@agentspilot.ai` for now (open issue 1); domain verified first (R-8) |
| Attachment | One CSV per email: UTF-8 with BOM, CRLF, every text cell formula-neutralised |
| Byte budget | **7 MB of CSV per email** (SA recommendation, about 9.4 MB after base64), or 10 MB if the user picks it (BQ-42). A constant either way |
| Split | At row boundaries. Every part repeats the header row and the BOM. `parts_total` fixed before the first send. Subject and body say "email {n} of {X}". File name `{module}_{YYYY-MM-DD}_part-{n}-of-{X}.csv` (business date, no user data in the name) |
| Maximum | 10 emails per module. Above that the module fails with the "too large" email (BQ-28) |
| Sending | Sequential, at least 600 ms apart, `retry-after` honoured on a 429 inside the run budget (XC-8). Resend idempotency key `export:{module_job_id}:{n}` (XC-9) |
| Language | Email text and CSV headers in the owner's language (en/he/es; Spanish as a draft). Cell values stay as stored, except lookups and "Record type" names (BQ-31) |
| Dates | Requested-at and produced-at in `user_preferences.timezone`; NULL shows "UTC" (`ownerClock.ts`) |
| Money | Amount next to its own currency on every row; no totals |

### 4.4 Limits, history and audit

| Rule | Value |
|---|---|
| Owner limit (BQ-29) | **2 requests per rolling 24 h**, any number of modules each; **one request not yet terminal at a time**. A request where every module failed or was interrupted does not count. Enforced in the DB start function as SQL literals, mirrored by constants with a migration test (XC-7) |
| Admin-started | Do not count against the owner. Their own limit: **2 per owner per 24 h** (XC-20) |
| Module job | One per module, picked up by a cron-only claim-pattern worker every 5 minutes (XC-8). Retried only while no part has reached `sending`; after that, a crash ends it as `interrupted` (XC-9) |
| Ceiling | `ROW_CEILING` (100,000) applies **per module** (XC-8) |
| History | One row per module job: module, requested at, status, sent at, email count. Kept until the account is deleted and removed with it at stage E |
| Audit | `DATA_EXPORT_REQUESTED` (reused, `details.modules`, origin), new `DATA_EXPORT_MODULE_SENT` and `DATA_EXPORT_MODULE_FAILED` (`details`: module code, rows, parts, failure code, `interrupted` flag). `user_id` = owner; they go with the account. **Never** content, email address or file names with user data (XC-13) |
| Storage | No CSV is stored. Built, sent, dropped. No bucket, no link |

### 4.5 Files are not exported (R-5, BQ-35)

- **Decision change, recorded:** on 2026-10-14 the user decided "content including files". On 2026-10-25 (brief v2) the user decided files are **not** exported. Client documents are downloaded one by one from each contact's record; website pictures are not offered.
- Document and picture **details** (name, date, type) stay in the Clients and Website CSVs.
- **Legal open issue 2 stays open** (shared with DELETE).

---

## 5. What is retired and what is reused

| Piece | Fate | Slice |
|---|---|---|
| Export classification (`export` field, columns, allow-lists, row filters, CI checks) | Reused unchanged | — |
| Section readers (`listOwnedRowsForExport`, paging) | Reused; each module job reads its sections through them | MX-3 |
| `data-export/csv.ts` (BOM, CRLF, BC-1 formula rule) | Extended with a line helper; no second writer (XC-10) | MX-2a |
| `ownerClock.ts` | Reused | MX-2a / MX-3 |
| Module map + switches from the export switches requirement (its slice 1) | Folded in as MX-0 with 13 modules | MX-0 |
| Excel writer (export switches requirement slices 2–3, SA-1, SA-12) | Dropped; branch `docs/data-export-flags-xlsx` marked superseded | MX-6 |
| DE-8a table `business_os_data_exports` + start function (`20261074`) | Not reused (XC-7). Read-only after MX-4 switch-on; dropped in MX-7 | MX-7 |
| Bucket `business-data-exports`, sweep cron, 72 h retention | Sweep keeps running until the bucket is empty; then the cron is removed (MX-6) and the bucket deleted through the Storage API (MX-7) | MX-6 / MX-7 |
| ZIP builder (`zipExport.ts`, `zipExportDeps.ts`, `zipEntries.ts`, `zipWriter.ts`, `fileManifest.ts`, `readme.ts`) | Removed | MX-6 |
| Owner routes `app/api/business-os/data-exports/**` (start, download, download again); ready email | Start refused at MX-4 switch-on (XC-15); removed in MX-6 | MX-4 / MX-6 |
| Admin export DE-10a `app/api/admin/users/[id]/data-exports/**` | Prepare refused once MX-5 is live; replaced by "Send export to owner"; removed in MX-6 | MX-5 / MX-6 |
| ZIP-specific CI guards | Deleted with their subjects, never loosened in place (XC-16) | MX-6 |
| `BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | Rewritten for modules | MX-6 |

---

## 6. Delivery slices and effort

Each slice is its own PR from `main`, never stacked, at most 2.5 days. A slice with a migration is a manual prod gate. The user sees the diff before commit unless a fast-track is agreed for this stream. Effort is SA's XC-17 numbers.

### 6.1 Done elsewhere

| # | Slice | Status | Effort |
|---|---|---|---|
| **LX-1** | CRM / Orders list export safety fix (XC-18): CRM export through `toCsvFile` from `lib/payments/csv.ts` with the documented phone `="…"` exception; button "Export this page ({n} rows)"; MoneyList reads the route's existing `truncated` and tells the owner. Client-only | **Being built in the DELETE session** on branch `fix/crm-export-safety-lx1`, merged **before** the split. Not this session's work. After it merges, the CRM / Orders list export code is owned by EXPORT (§11) | 🟢 1 d (not counted below) |

### 6.2 This scope

| # | Slice | Delivers | Depends on | Migration | Effort |
|---|---|---|---|---|---|
| **MX-0** | Module map + switches | Pure config: 13 modules, section → module, en/he/es names, on/off per module; Zod enum of module ids built from the map (XC-21); CI test: every `include` section in exactly one module, no unknown section | — | — | 🟢 1.5 d |
| **MX-1a** | Schema + start function | Migration: `business_os_export_requests`, `business_os_export_module_jobs` (claim columns, `parts_total`, per-part status array, row count, failure code), DB start function with the limits as SQL literals, claim / reap RPCs, mirror constants + migration test; repositories; descriptors (`export: exclude`); **cleanup function regenerated in the same PR** (XC-11, serialised, §11) | MX-0 | ✅ manual gate | 🟡 2.5 d |
| **MX-1b** | Route + drawer | Request route (session user, Zod `.strict()`, module ids from the enum, switch-off → 404); export drawer with ticks, Select all, history list (reads); "Export requested" email; `isModuleExportEnabled()` off + `FEATURE_FLAGS.md` row; the drawer's open action exposed for Settings, Danger Zone and the deletion drawer (§11) | MX-1a | — | 🟡 2 d |
| **MX-2a** | Joined CSV builder | Line helper in `csv.ts`; column union by key, ids last; "Record type", "Belongs to"; lookups to labels per XC-10. Pure, unit-tested | MX-0 | — | 🟡 2 d |
| **MX-2b** | Header labels | `data-export/columnLabels.ts` (server-only, `{en, he, es}` per `section.column`); CI test: every `include` column has en and he (es may be draft); CI test: no two keys in one module share a label | MX-2a | — | 🟢 1.5 d |
| **MX-3** | Worker + email split | Cron worker route every 5 min, `maxDuration = 300`, lease 420 s, 270 s internal budget, reaper first; part cutting by byte budget; `sending` / `accepted` per part; Resend idempotency key (additive `idempotencyKey` on `SendEmailParams`, §11); failed / interrupted / too-large emails; per-module audit; status updates; `vercel.json` cron entry | MX-1b, MX-2b | — | 🟡 2.5 d |
| **MX-4** | History, receipt facts, switch on | Full history in the drawer; **XC-12 receipt export facts re-sourced** in `findDeletionFacts` (reads old and new tables until MX-7); audit definitions + `eventAudience` entries; test that no export route is in `ENFORCEMENT_POINTS` (XC-19); ZIP start answers 404 when the switch is on (XC-15); QA; switch on | MX-3 | — | 🟡 2 d |
| **MX-5** | Admin "Send export to owner" | `requireAdmin` first, authz registry entry, owner id from the path, recipient = owner's login email at send time, own limit 2 per owner per 24 h, does not count to the owner; works for a locked account; admin ZIP prepare refused (XC-20, XC-16 step 2) | MX-4 | — | 🟢 1.5 d |
| **MX-6** | Retire the ZIP | At least 72 h and one sweep run after MX-5 is live: "Download my data" opens the drawer for good; owner and admin ZIP routes and UI removed; ZIP builder files and ready email removed; `/api/cron/data-export` route and its `vercel.json` entry removed; ZIP guards deleted with their subjects; contents doc rewritten; flags-xlsx requirement marked superseded | MX-5 + bucket empty | — | 🟢 1.5 d |
| **MX-7** | Drop the old table | Migration drops the `20261074` start function and `business_os_data_exports`; removes it from `FUNCTION_REQUIRED_TABLES` and the plan; **cleanup function regenerated** (serialised, §11); `findDeletionFacts` reads only the new tables; bucket removed through the Storage API once empty | MX-6 | ✅ manual gate | 🟢 1 d |

**Total: 18 working days** (MX-0 1.5 · MX-1a 2.5 · MX-1b 2 · MX-2a 2 · MX-2b 1.5 · MX-3 2.5 · MX-4 2 · MX-5 1.5 · MX-6 1.5 · MX-7 1). LX-1 (1 d) is done elsewhere and not counted. **Per-module export is live after MX-4.** Manual prod gates: 2 migrations (MX-1a, MX-7).

**Suggested order:** MX-0 → (MX-1a → MX-1b) in parallel with (MX-2a → MX-2b) → MX-3 → MX-4 (switch on) → MX-5 → [≥ 72 h, bucket empty] → MX-6 → MX-7.

**Ops gates before MX-4 switch-on (not builds):** `agentspilot.ai` verified in Resend (SPF, DKIM, DMARC) and `RESEND_FROM_EMAIL` set (R-8); Resend sending limit and plan quota checked against 13 modules × up to 10 emails (XC-21).

---

## 7. Acceptance criteria

**All slices:** integration tests for happy path, auth failure and invalid input; session user only; Zod `.strict()`; Pino with `correlationId`, ids and codes only; no added CI time; QA records a manual check of the critical path.

**LX-1** (done elsewhere; listed so QA can confirm it is on `main` before MX-6)
- [ ] A contact named `=HYPERLINK("x")` opens as text in Excel; an Israeli phone keeps its leading zero.
- [ ] The Contacts button says how many rows it exports, and the file holds exactly those.
- [ ] An Orders export that hit a read cap tells the owner; it never cuts silently.

**MX-0**
- [ ] Every `include` section is in exactly one module; an unknown or missing section fails CI.
- [ ] A module switched off is not offered in the drawer and is refused by the route.

**MX-1a**
- [ ] The new tables are server-write-only: RLS on, no anon or authenticated policy, access only through repositories.
- [ ] The start function refuses a third request inside 24 h and a second while one is not terminal; fully failed or interrupted requests do not count; admin-started requests do not count to the owner.
- [ ] The mirror constants test fails when the SQL literals and the constants differ.
- [ ] The regenerated cleanup function passes the drift test; applied to prod and merged back to back; checker run (XC-11).

**MX-1b**
- [ ] With the switch off, the route answers 404 and the ZIP flow is unchanged.
- [ ] Ticking 3 modules creates one request and 3 module jobs; one "Export requested" email lists them with the date and time.
- [ ] No module name from the browser is trusted: unknown or switched-off modules are refused.

**MX-2a / MX-2b**
- [ ] The Clients CSV holds client, document and stage rows in one table, with "Record type" and the client name on each child row.
- [ ] Headers are in the owner's language; every exported column has a label in en and he (CI); no two keys in one module share a label (CI).
- [ ] Every text cell starting with `=`, `+`, `-`, `@`, TAB or CR is neutralised; numbers stay numbers.
- [ ] No column outside the classification appears; no secret, token or bank detail (DX-1).

**MX-3**
- [ ] Each module arrives in its own email with the CSV attached, module name, requested-at and produced-at in the owner's timezone.
- [ ] A module larger than the byte budget arrives as several emails marked "1 of X" … "X of X", each under the budget, each with the header row and BOM.
- [ ] One module forced to fail sends the failed email; the others arrive.
- [ ] A worker killed before any part reached `sending` is retried; a worker killed after a part reached `sending` ends the module as `interrupted` with one email, and no part is ever sent twice.
- [ ] Over 10 emails the module fails with the "too large" email.
- [ ] A module at the 100,000-row ceiling finishes inside the 270 s budget locally (QA measurement, local only).

**MX-4**
- [ ] The history shows every module job with status, sent at and email count.
- [ ] After stage E (DELETE scope, or the existing admin anonymise today), the history and request rows for the account are gone.
- [ ] Audit rows: requested, module sent, module failed, with no content.
- [ ] The deletion receipt's `ownerLastExportReadyAt` = last owner module job accepted; `ownerExportDownloadedAt` = NULL; `adminExportExisted` = any admin-origin request; old-table facts still read until MX-7; receipt schema unchanged (XC-12).
- [ ] No export route is in `ENFORCEMENT_POINTS` (test).
- [ ] With the switch on, the owner ZIP start answers 404; ready ZIPs stay downloadable until they expire.

**MX-5**
- [ ] Only an admin can start it; the CSVs go to the owner's login email, never to the admin.
- [ ] It works for a locked account, does not use the owner's limit, and refuses a third admin send inside 24 h for the same owner.
- [ ] The admin ZIP prepare answers 404.

**MX-6**
- [ ] "Download my data" opens the drawer; the old start, download and download-again routes and the admin data-export routes answer 404.
- [ ] No ZIP is built anywhere; the bucket is empty; the data-export cron is gone from `vercel.json`.

**MX-7**
- [ ] `business_os_data_exports` and its start function are gone; the regenerated cleanup function passes the drift test and the checker; `findDeletionFacts` reads only the new tables.

---

## 8. Scenarios

| # | Situation | Expected |
|---|---|---|
| X-1 | Selects all 13 modules | One "requested" email, then 13 module emails (more if any split); history shows 13 rows |
| X-2 | Clients module is 25 MB | 4 emails at 7 MB (or 3 at 10 MB, BQ-42), "1 of X" … "X of X" |
| X-3 | Invoices module fails | "Failed" email for it; others arrive; history "failed"; the request still counts unless all failed |
| X-4 | Hebrew owner | Hebrew email text and headers; values as stored |
| X-5 | Admin sends the export for a locked account | CSVs go to the owner's login email |
| X-6 | Server restarts after email 2 of 5 of one module | One "interrupted, please export again" email; history "interrupted"; no duplicates (BQ-43) |
| X-7 | Exports 5 modules on the 11th and 3 more on the 12th, then tries again on the 12th | Two requests used; the third refused until 24 h after the first |
| X-8 | Owner in DELETE stage C (paused account) | Export works as normal |

---

## 9. Business questions for this scope

Plain language; each has a suggested answer. **Bold = needed before the slice it names.** "Shared" = also listed in the DELETE file; one answer serves both.

- [ ] **BQ-25 The export switches + Excel requirement: keep the switches, drop Excel?** (R-6) **Suggestion: yes.** The switches become the module list (MX-0). (status: pending user input; **before MX-0**)
- [x] **BQ-26 What "one joined CSV" looks like.** **Suggestion:** one table with a "Record type" column and the client's name on every row (§4.2). (status: ✅ **answered 2026-10-26 by the user: one table per module** — "Record type" column, "Belongs to" with the parent's name on child rows, blank where a type lacks a column, as §4.2. Not one CSV per record type)
- [ ] **BQ-27 The module list.** **Suggestion:** the brief's 12 plus "Account & business details", placed as in §4.1. (status: pending user input; **before MX-0**)
- [ ] **BQ-28 How many emails may one module take?** **Suggestion:** at most 10; bigger → "please contact support". (status: pending user input; before MX-3)
- [ ] **BQ-29 The limit.** **Suggestion:** 2 requests per rolling 24 hours, one running at a time; a request that fully failed doesn't count. (status: pending user input; **before MX-1a**, because the limit is written into the database)
- [ ] **BQ-30 The admin export.** **Suggestion:** the admin can only send the same module export to the owner's email (also when locked), at most 2 a day per owner; the admin ZIP is retired. The admin never receives client data. (status: pending user input; before MX-5)
- [ ] **BQ-31 Translate only the column headers, or the values too?** **Suggestion:** headers, record types and lookup labels only. (status: pending user input; before MX-2b)
- [ ] **BQ-35 (shared) Files reversal, confirm the record.** On 2026-10-14 you decided "content including files"; v2 says files are not exported. **Suggestion:** confirm; the export drawer and the deletion drawer say so plainly; legal open issue 2 stays open. (status: pending user input; before MX-1b)
- [ ] **BQ-37 Fix the CRM export bug now?** **Answered in practice:** yes; LX-1 is being built in the DELETE session and merged before the split. Kept here for the record. (status: in progress elsewhere)
- [ ] **BQ-42 Export email size.** **Suggestion:** about 7 MB of data per email so it gets through almost every business mail server; at most 10 emails per module. Alternative: 10 MB, fewer emails, some owners not receiving them. (raised by: SA; status: pending user input; **before MX-3**)
- [ ] **BQ-43 An export interrupted halfway.** **Suggestion:** one "this part was interrupted, please export it again" email rather than resending. (raised by: SA; status: pending user input; **before MX-3**)
- [ ] **Open issue 1 / BQ-3 (shared) Sender and support address.** **Suggestion:** `notifications@agentspilot.ai` as sender and support contact for now. (status: open; before MX-4 switch-on)
- [ ] **Open issue 2 (shared) Legal confirmation on leaving files out** (Art. 28(3)(g)). **Suggestion:** legal confirms that one-by-one document download plus the typed deletion statement is enough; bulk download stays on the later list. (status: open, with legal; before MX-4 switch-on)

Closed by the v2 brief and relevant here: BQ-2 (login email, owner's language) · BQ-4, BQ-13, BQ-14 (per-list export moved to later).

---

## 10. SA conditions that apply

Copied from the parent's `## SA Review — 2026-10-25`. Binding. Where a condition is shared with DELETE, only the EXPORT part is acted on here; the full text is kept so nothing is lost.

| # | Condition (verbatim) |
|---|---|
| **XC-7** | **Export job model: a new pair** (answers SA-Q7). `business_os_export_requests` (one per click: origin `owner` / `admin`, admin actor id, modules, requested_at) and `business_os_export_module_jobs` (one per module: the durable-queue-drain claim columns, `parts_total`, a per-part status array of `{n, state: 'sending' / 'accepted', resend_id}`, row count, failure code). A new DB start function carries the limits as SQL literals, as 20261074 does: 2 per rolling 24 h, one request not yet terminal, a request whose every module failed or was interrupted not counted, admin-started not counted. `jobPolicy.ts`-style mirror constants with a migration test that fails CI when they differ. **DE-8a's table is not reused:** its columns, statuses and start-function counting are ZIP-shaped (part paths, ready/expiry, downloaded). It stays read-only until MX-7 drops it |
| **XC-8** | **Worker** (answers SA-Q7 trigger and SA-Q10). **Cron only**, every 5 minutes. No "kick" from the request route: a fire-and-forget fetch on serverless is unreliable, and it would be a new pattern (rule 7). The owner copy says the emails arrive "within a few minutes". The worker route uses `maxDuration = 300` (4 routes already do; Vercel Pro), lease 420 s, and an internal budget of 270 s checked before each part is sent. This is a **ruled exception** to the skill's default of 60 s, because a module at the 100,000-row ceiling (about 100 sequential pages, plus up to 10 sends of about 9 to 13 MB) does not fit in 60 s. The ceiling becomes **per module** (`ROW_CEILING`, unchanged value). The CSV is built from an array of lines and cut into parts. It is never one 100 MB string, and each part buffer is dropped after its send. Expected peak memory is under 1 GB. Sends are sequential, spaced at least 600 ms apart (Resend's default team limit is 2 per second, shared with every other platform email), and a 429 honours `retry-after` inside the budget. QA's ceiling measurement is local only, because preview and production share one database (C-10 §2), and the database read time remains an accepted risk |
| **XC-9** | **Split and send** (answers SA-Q9). Parts are cut at row boundaries, each repeating the header row and the BOM. `parts_total` is fixed before the first send, so "1 of X" is always true. **Never a duplicate part:** before each send the part is marked `sending`; after Resend accepts, `accepted` with the message id. Idempotency key `export:{module_job_id}:{n}` (additive optional `idempotencyKey` on `SendEmailParams`, honoured by the Resend transport only). **A module is retried only while no part has reached `sending`.** Once any part has, a crash ends the module as `interrupted`, with one email ("this part was interrupted, please export it again", BQ-43). Rebuilt data could otherwise shift the part boundaries. "Sent" means Resend accepted the message: the history says "sent", never "delivered", because bounces are not tracked. **Byte budget: SA recommends 7 MB of CSV per email** (about 9.4 MB after base64), so the email fits the 10 MB limit that many business mail servers keep. 10 MB is technically fine against Resend's 40 MB. It is a constant either way (BQ-42). Maximum 10 emails per module stays |
| **XC-10** | **Joined CSV builder** (answers SA-Q8). Extend `data-export/csv.ts` with a line helper next to `cellText` / `quoteCell`; do not write a second writer. The BC-1 rule (a string starting with `=` `+` `-` `@` TAB or CR gets an apostrophe; typed numbers untouched) is **the** rule for the module export. Column union: "Record type", "Belongs to", then each column key in module section order at its first appearance, then the ids last. The same key always maps to the same column. A CI test fails when two different keys in one module get the same header label. Lookups become labels only for the module's own sections and for stage, service and client name, read through the classified reader (never a column outside the classification). When the target section is excluded or switched off, the id stays. **Header labels live in a server-only pure file** (`data-export/columnLabels.ts`, `{en, he, es}` per `section.column`), **not** in the client translation bundles: several hundred strings times 3 would ship to every browser. A CI test checks that every `include` column has en and he, and es may be a draft. `ownerClock.ts` formats the dates |
| **XC-11** (shared) | **New tables and the cleanup function** (answers SA-Q12). Yes, it must be regenerated: the descriptor, the generator output and the drift test move together, in the **same PR** as the table. Two regenerations: MX-1a (export tables) and DL-1a (closure table). They are separate PRs merged one after the other, never stacked; the second regenerates on top of the first. A third at MX-7 (drop of `business_os_data_exports`: remove it from `FUNCTION_REQUIRED_TABLES` and the plan). Add a new table to `FUNCTION_REQUIRED_TABLES` only if the generated SQL names it statically. Numbers: **20261093 is next free today**, taken when each PR opens; 20261089 is never back-filled. **Deploy order:** a new `CLEANUP_FUNCTION_VERSION` makes the check and E answer `function_out_of_date` until DB and code agree. That fails closed, but it pauses admin deletes and test-account cleanup, so apply and merge back to back and run the checker. Each is a manual prod gate |
| **XC-12** | **Receipt export facts** re-sourced in MX-4, before the switch goes on. `ownerLastExportReadyAt` = the last owner module job accepted; `ownerExportDownloadedAt` = NULL from then on (no download exists; document the meaning in the DE-10b requirement); `adminExportExisted` = any admin-origin request. Read both the old and the new tables until MX-7. No receipt schema change |
| **XC-13** (shared; EXPORT acts on the export half) | **Audit** (answers SA-Q13). New: `ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_DELETION_KEPT` (`details.source` owner / admin / stripe), `ACCOUNT_GRACE_STARTED`, `ACCOUNT_CLOSURE_EMAIL_SENT` (`details.email`: requested / grace / reminder / closed / kept; one event, not five), `ACCOUNT_CLOSURE_BLOCKED` (guard codes only), `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`. "Ready" is derived, so it has no event. These are written with `user_id` NULL (rewritten to the system user, as `ACCOUNT_PSEUDONYMISED` is) and `entity_type 'user'`, `entity_id` = subject, `actor_id` = the admin for unlock: they survive E, which deletes `audit_trail` rows **by `user_id` only**. Refusals keep B-1 (`user_id` = subject). Export: reuse `DATA_EXPORT_REQUESTED` (`details.modules`, origin), plus new `DATA_EXPORT_MODULE_SENT` and `DATA_EXPORT_MODULE_FAILED` (`details`: module code, rows, parts, failure code, `interrupted` flag). "Completed" and "delivered" are one moment, so they are one event. These carry `user_id` = owner and go with the account. Keep the ZIP constants for old rows, with no new writes after MX-6. Definitions and `eventAudience` / owner presentation entries for each |
| **XC-15** (shared; EXPORT acts on the export switch) | **Switches** (answers SA-Q15). `isPlanSelfCancelEnabled()`, `isAccountSelfDeleteEnabled()` (now the lifecycle **request** switch, XC-4), and a new `isModuleExportEnabled()`, each with a `feature_flags.md` row and the `is…Enabled` naming. While the export switch is off, nothing changes. When it is on: "Download my data" opens the drawer, and the ZIP **start** routes (owner and admin prepare) answer 404 at once. Ready ZIPs stay downloadable until they expire. MX-6 removes the code. The export worker and the sweep run regardless of their switches |
| **XC-16** | **Retirement order** (answers SA-Q11). (1) MX-4 switch on: owner ZIP start refused. (2) MX-5 live: admin prepare refused; DE-10a becomes "Send export to owner". (3) At least 72 h and one sweep run later: the bucket is empty (the sweep expires and removes the objects). (4) MX-6 removes the start, download and download-again routes, the admin data-exports routes and UI, the ZIP builder files, the ready email, and the `/api/cron/data-export` route and its `vercel.json` entry. ZIP-specific CI guards are deleted with their subjects, never loosened in place. (5) **MX-7** (new, 1 d, manual gate): one migration drops the start function and `business_os_data_exports` and regenerates the cleanup function. The bucket is removed through the Storage API once it is empty |
| **XC-17** (shared; export rows) | **Slices re-cut** (each ≤ 2.5 d, from `main`, not stacked). MX-1 → **MX-1a** schema + start function + claim/reap RPCs + descriptors + regen (2.5 d) and **MX-1b** route + drawer + "requested" email + switch (2 d). MX-2 → **MX-2a** builder and lookups (2 d) and **MX-2b** header labels en/he/es + CI test (1.5 d). MX-4 2 d (adds XC-12). MX-5 1.5 d (XC-20). **MX-7** 1 d (new) |
| **XC-18** | **LX-1** (answers SA-Q16): client-only. The CRM page's export goes through `toCsvFile` from `lib/payments/csv.ts` (client-safe, F-11), with **one documented exception**: the phone column keeps its `="…"` text form outside `csvCell` (inner quotes doubled, so it cannot carry a formula), because otherwise Israeli numbers lose their leading zero. The button says "Export this page ({n} rows)". MoneyList reads the `truncated` the route already returns and tells the owner. No server route is touched, so C-11c (the rule-1 move) does not apply. If the Dev finds a server change is needed, C-11c applies to that route. *(Done elsewhere, §6.1.)* |
| **XC-19** (shared; EXPORT acts on the export sentence) | **Entitlements** (answers SA-Q17). … **Export never imports entitlements: it is available in every tier and state. Add a test asserting that no export route is in `ENFORCEMENT_POINTS`, so future enforcement cannot block it during grace or pause.** (The `planEndingView` and registration part belongs to DELETE.) |
| **XC-20** | **Admin "Send export to owner"**: `requireAdmin` as the first statement, an entry in the authz registry, owner id from the path (tenant-isolation-guard), recipient = the owner's login email read at send time, and **its own limit (2 per owner per 24 h)** so an admin cannot flood an owner's mailbox. It does not count against the owner's limit |
| **XC-21** (shared) | **Standards across slices:** rule 1 (closure, export and auth-admin access only through repositories; cron claim/complete methods marked `⟨unscoped-by-design⟩`); rule 2 (Zod `.strict()`; module ids validated against a Zod enum built from the module map); rule 3 (Pino; flag and convert any touched file with `console.*`); rule 4 (service-role paths documented; ids from the session, a claimed row or an admin path, never a body); rule 5 (no LLM involved); rule 7 (the exceptions ruled here: the 300 s worker, the session-cut function, the idempotency key option; nothing else new); CI (pure Jest, small fixtures, inside the existing job; the regen drift tests already exist, so **no added CI time**). Ops gates in §9.5 stand, plus: the Resend sending limit and plan quota checked against 13 modules × up to 10 emails, and the support address used in the banned-login copy |

Relevant SA findings: F-5 (receipt facts read the DE-8a table), F-7 (`emailTransport` has no idempotency key and logs the attachment filename at `info`), F-8 (today's ZIP is built inside the POST; this is the first export worker), F-9 (100,000 rows ≈ 62 MB CSV, 3.6 s build; DB read time unmeasured), F-10, F-11 (LX-1), F-14 (next free migration 20261093), F-15 (no flag gates today's ZIP). Carried v1 conditions that still apply: C-6 (adapted: formula safety via MX-2 / LX-1), C-8 (migration numbers), C-11 (standards).

---

## 11. Boundary and coordination with the other scope

> **This section is identical** in [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) (EXPORT) and [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) (DELETE). Change it in both files in the same PR, or not at all.

Two Claude sessions build in parallel. **EXPORT** builds MX-0 to MX-7. **DELETE** builds SX-1, SX-2, SX-3, SX-5, DL-1a to DL-5 and DL-4b, and also built LX-1 before the split. Every reservation, claim, hand-off and question between them goes through the shared coordination file (B.5).

### B.1 Ownership

"Owns" = only that scope edits it. The other scope may **import or call** it read-only, never edit it. More files are assigned in B.8 (SR-11). Anything not listed: raise it in the coordination file before touching it.

| Area | EXPORT owns | DELETE owns |
|---|---|---|
| **Code dirs / files** (SR-1, SR-3, 2026-10-25) | `lib/business-os/data-export/**` (module map, `csv.ts`, `columnLabels.ts`, worker, ZIP files until removed) · `lib/repositories/BusinessOsDataExportJobRepository.ts` **including `findDeletionFacts` and the `DataExportDeletionFacts` type** (frozen, B.6) · new export request / module-job repositories · CRM / Orders list export code after LX-1 merges (`app/business-os/crm/page.tsx` export handler, `components/payments/MoneyList.tsx` export). **EXPORT does not edit `receiptInput.ts`**: XC-12 changes only the values `findDeletionFacts` returns (SR-1) | `lib/business-os/account-deletion/**` **including `receiptInput.ts`** (SR-1: DELETE may add builders, e.g. the DL-5 "admin runs an owner's stored request" builder; it may **not** change `receiptShape`, `DELETION_RECEIPT_INPUT_KEYS` or the `superRefine` without the S-1 cleanup-regen lock, because a key change is a regeneration) (incl. the DE-10b.2 files `acknowledgement.ts`, `schemas.ts`, `sessionSubject.ts`, `blockerCopy.ts`, `deletionEmail.ts`, `runAccountAnonymise.ts`, `closedAccount.ts`, `reason.ts`, `receiptFingerprint.ts`) · closure repository and the auth-admin lock seam · `lib/business-os/billing/**` (`planCancellation.ts`, `planSubscriptionMirror.ts`, `planPurchaseOffer` refusal) · `lib/stripe/StripeService.ts` cancel / keep / OAuth deauthorize methods · `planEndingView` in `lib/business-os/entitlements/` · `lib/business-os/purge/adminDeletionRefusals.ts` · the **rules** in `no-deletion-paths.guard.test.ts` (the anonymise-import guard of XC-6); its older-version allow-list entries go with whoever holds the S-1 lock (SR-3). DL-1a adds its session-cut migration to `SQL_AUTH_WRITE_ALLOW_LIST`, because `DELETE FROM auth.sessions` matches the guard (SR-3) |
| **Tables / DB objects** | `business_os_export_requests`, `business_os_export_module_jobs`, their start function and claim / reap RPCs · `business_os_data_exports` and the `20261074` start function (read-only, then dropped in MX-7) · bucket `business-data-exports` | `business_os_account_closures`, its claim RPC, the session-cut `SECURITY DEFINER` function · Supabase Auth ban / unban (through the repository seam) |
| **Routes** | New export request + history routes · export worker cron route · `app/api/business-os/data-exports/**` (retired in MX-6) · `app/api/admin/users/[id]/data-exports/**` (retired) and the new admin "Send export to owner" route · `/api/cron/data-export` (retired) | `app/api/business-os/account/delete` (becomes the request route) · keep route · deletion-check route · plan cancel / keep routes · lifecycle cron route · admin unlock, ready list and E routes · existing `app/api/admin/test-account-cleanup/**` (EXPORT changes receipt facts only inside `findDeletionFacts`, never in these routes) · `app/api/payments/stripe-connect/{disconnect,delete}` · the four XC-14 public "closed" call sites and `siteCache` revalidation |
| **UI** (SR-9, 2026-10-25) | Export drawer and its open action, which is `DownloadMyDataButton` (frozen, B.6) · admin "Send export to owner" button component | `DeleteAccountDrawer.tsx` · cancel drawer · pending-deletion banner · plan card wording · Keep screens · banned-login copy · `/account-deleted` · admin ready list / Unlock / run-delete components |
| **Emails** | Export requested · module part · failed · interrupted · too large | Deletion requested · grace started · reminder · closed · kept · blocked · plan cancelled / kept / reminder |
| **Flags** | `isModuleExportEnabled()` | `isPlanSelfCancelEnabled()`, `isAccountSelfDeleteEnabled()` |
| **Docs** | `BUSINESS_OS_DATA_EXPORT_CONTENTS.md` · flags-xlsx requirement "superseded" marker | `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` · plan-payments P-7a note (C-1) |
| **Migrations** | MX-1a, MX-7 | DL-1a (and SX-5 only if it needs one) |

### B.2 Shared surfaces and how changes to them are serialised

| # | Shared surface | Who changes it | Rule |
|---|---|---|---|
| S-1 (SR-3, SR-4, SR-5, 2026-10-25) | **Test-account cleanup generator and every regenerated cleanup migration** (the files under the cleanup-regen lock): `scripts/generate-test-account-cleanup-sql.ts`, the pasted `CHECK_FILE` / `DELETE_FILE` SQL, the generated cleanup-function migration and its `supabase/SQL Scripts/<N>_rollback.sql`, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` (`CLEANUP_FUNCTION_VERSION`), `scripts/__tests__/testAccountCleanupSql.test.ts` (drift test, the `APPLIED` / `APPLIED_TARGET` sha256 pins and the "chains on …" test), the older-version allow-list entries in `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`, `FUNCTION_REQUIRED_TABLES` | MX-1a, DL-1a, MX-7 (each regenerates it) | **Strictly one after another, never in parallel.** Before starting a regenerating slice, take the "cleanup regen" claim in the coordination file; only one claim may be open. Branch from a `main` that already holds the previous regeneration and regenerate on top of it. Each PR is **applied to prod and merged back to back** and the checker is run (XC-11: a version mismatch pauses admin deletes and test-account cleanup). Release the claim only after merge + apply + checker. **Order: DL-1a, then MX-1a, then MX-7** (SR-4). DL-1a takes the lock first; precondition: `20261092` is applied on prod and the checker is green, otherwise stop and tell TL. EXPORT runs MX-0 → MX-2a → MX-2b → MX-1a → MX-1b → MX-3 → …, and may build MX-1a's tables, repositories and start function on a branch while the lock is held, but does not regenerate or apply until it is released. **Pre-apply check for every regeneration** (SR-5): (a) branch rebased on current `origin/main` and green; (b) `origin/main`'s `FUNCTION_MIGRATION` equals the PR's `PREVIOUS_FUNCTION_MIGRATION`; (c) apply, then enqueue at once; (d) run the checker; (e) release the lock in the log. No new CI guard is needed for the race on `main` |
| S-2 (SR-3, 2026-10-25) | **Purge descriptors / export classification** (`lib/business-os/purge/descriptors.ts`, `exportClassification.test.ts`, `lib/business-os/businessOwnedTables.ts`) | EXPORT (export tables, `export` semantics, module-map test), DELETE (closure table) | Each scope adds descriptors **only for its own tables**, in the same PR as the table and its regeneration (S-1). The closure table is `export: exclude`. DELETE never changes an existing `export` entry; EXPORT never changes a non-export table's purge behaviour. `businessOwnedTables.ts` is add only |
| S-3 (SR-1, 2026-10-25) | **`BusinessOsDataExportJobRepository.findDeletionFacts` + `DataExportDeletionFacts`** | **EXPORT only** (XC-12, MX-4 and MX-7) | **DELETE must not touch either.** Signature frozen through MX-7 (B.6). DELETE's routes and DL-5's E route call `findDeletionFacts` through it. `receiptInput.ts` is no longer a shared surface: DELETE owns it (B.1, SR-1) and EXPORT does not edit it. Any change is announced in the coordination file before its PR opens and keeps the signature |
| S-4 (SR-9, 2026-10-25) | **Deletion drawer → export drawer link** | EXPORT provides, DELETE consumes | The export entry point is the existing `DownloadMyDataButton` (frozen, B.6). Before and after MX-1b, DL-2's drawer renders `<DownloadMyDataButton variant="button" />` and nothing else for export; it never names an export route (guard check 4 refuses that outside `lib/client/businessOsDataExport.ts`). In MX-1b, EXPORT makes that same component open the export drawer when `isModuleExportEnabled()` is on, so Settings, the Danger Zone, the AgentPilot security tabs and the deletion drawer switch over without being edited (XC-15). EXPORT's MX-1b handles focus and stacking when the export drawer opens inside the deletion drawer, and tests it once |
| S-5 (SR-10, 2026-10-25) | `components/business-os/purge/DangerZonePanel.tsx` and `app/business-os/settings/page.tsx` | **DELETE only** | **EXPORT does not edit them** (SR-9: the button switches itself). DELETE edits the "Delete my account" block, the plan card and the pending state. Keep diffs small, rebase on `main` just before enqueue |
| S-6 (SR-10, 2026-10-25) | `/admin/users` (`app/admin/users/page.tsx`, `app/admin/users/components/BusinessDetail.tsx`) | **DELETE only** | **EXPORT does not edit them**: MX-5 replaces the inside of `DataExportBlock`, which is already mounted. DELETE adds the ready list, Unlock and run-delete mounts. Never edit the other's component |
| S-7 (SR-10, 2026-10-25) | **Translations** `lib/business-os/translations/{en,he,es}.ts` | Both | **Add keys only, never edit or delete the other's keys**, in one block at your own anchor (B.7). Each scope keeps to its own key namespace (EXPORT: export drawer and export email keys; DELETE: closure, keep and plan-cancel keys). CSV header labels are not here (XC-10, EXPORT's `columnLabels.ts`) |
| S-8 (SR-10, 2026-10-25) | `lib/utils/featureFlags.ts` + `docs/FEATURE_FLAGS.md` (`feature_flags.md` rows) | Both | Add only your own reader and row, at your own anchor (B.7); `is…Enabled` naming |
| S-9 (SR-10, 2026-10-25) | **Audit events**: `lib/audit/events.ts`, the event definitions, `lib/audit/eventAudience.ts` | Both (XC-13 split) | Add only your own constants, definitions and audience entries, at your own anchor (B.7); never rename or remove an existing one. EXPORT keeps the ZIP constants for old rows |
| S-10 | **`emailTransport` idempotency key** (`lib/notifications/emailTransport.ts`, optional `idempotencyKey` on `SendEmailParams`, Resend only) | Whoever needs it first (EXPORT MX-3 per XC-9; DELETE DL-3 per XC-4) | Claim it in the coordination file before starting; the first builds it as an additive optional field in its own slice; **the other reuses it and never builds a second.** If both need it in the same week, the claim decides |
| S-11 (SR-10, 2026-10-25) | `vercel.json` crons | Both | Add or remove only your own entries, at your own anchor (B.7) (EXPORT: worker every 5 min, removes `/api/cron/data-export` in MX-6; DELETE: lifecycle job hourly at :50) |
| S-12 | Entitlements registries (`KNOWN_NON_GATE_IMPORTERS`, `ENFORCEMENT_POINTS` tests) | DELETE registers its importers (XC-19); EXPORT adds only the "no export route in `ENFORCEMENT_POINTS`" test | Add only |
| S-13 | Admin authz registry | Both | Add only your own route entries |
| S-14 | `BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` | EXPORT (the `ownerExportDownloadedAt` note, XC-12); DELETE (DE-10b.3 superseded note, E route) | Add a section only; never rewrite the other's |
| S-15 | Parent requirement `BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md` | **TL only** | Neither session edits it |
| S-16 (SR-11, 2026-10-25) | `lib/repositories/types.ts` and `lib/repositories/index.ts` | Both | Add only. **Prefer keeping new types in the repository file itself** (as `DataExportDeletionFacts` is) and not adding to the barrel |
| S-17 (SR-10, SR-11, 2026-10-25) | `lib/security/rateLimit.ts` (`RATE_LIMITS`) | Both | Add only, your keys in one block at your own anchor, not adjacent to the other's (B.7) |

### B.3 Migration-number reservation

- The next free number is **20261093** (SA F-14). Each scope **reserves its number in the coordination file before writing the migration**: first come, first served, one number per migration.
- At PR open, check `origin/main` and the coordination file again; if the number was taken, reserve the next free one and rename (C-8).
- An abandoned migration releases its number in the coordination file.
- **20261089 is never used or back-filled.**
- Expected migrations: EXPORT MX-1a and MX-7; DELETE DL-1a (and SX-5 only if it needs one). MX-1a, DL-1a and MX-7 also follow S-1.
- (SR-7, 2026-10-25) Each reservation row records **number, slice and branch**. DL-1a takes the first number, `20261093`.
- (SR-6, 2026-10-25) **MX-7 is two migrations and reserves both numbers at once:** first the regenerated function (N), which no longer names `business_os_data_exports` (its descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR), then the DROP (N+1). Never drop first.
- (SR-7, 2026-10-25) DL-1a adds a pure Jest guard: no two `supabase/migrations/*.sql` files with a prefix of `20261093` or above share an 8-digit prefix. It runs in the existing job (no added CI time) and also covers other streams that do not read the coordination file.

### B.4 Dependencies between the scopes

| Dependency | Rule |
|---|---|
| **DELETE switch-on waits for EXPORT MX-4 switch-on** | Stage C promises "you can export your data", so `isAccountSelfDeleteEnabled()` (DL-5) is not switched on before `isModuleExportEnabled()` is on (MX-4). DELETE may build and merge everything with its switch off before then |
| **DL-5 receipt reads export facts through the EXPORT interface** (SR-1, 2026-10-25) | The E route calls `findDeletionFacts` (S-3, B.6) and passes the values to DELETE's own `receiptInput.ts` builders. Before MX-4 it reads the old table; from MX-4 the new tables (and the old one until MX-7). DELETE changes nothing either way |
| DL-2 links to the export drawer (SR-9, 2026-10-25) | Soft; never blocking. DL-2 renders `<DownloadMyDataButton variant="button" />` (S-4) |
| **Regeneration order** (SR-4, 2026-10-25) | DL-1a → MX-1a → MX-7 (S-1) |
| **EXPORT MX-6 / MX-7 wait for nothing from DELETE** | Apart from the S-1 serialisation of MX-7's regeneration |
| MX-5 "works in stage D" | Tested against a banned user directly; does not wait for DL-4 |
| LX-1 | Built in the DELETE session on `fix/crm-export-safety-lx1` and merged **before** the split; afterwards the CRM / Orders list export code belongs to EXPORT |
| Ops gates | Resend domain verification and the sender / support address (open issue 1) serve both scopes; whoever reaches switch-on first raises them in the coordination file |

### B.5 Coordination file

`C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md`. It sits outside any worktree and is not in git. It holds the migration reservations (B.3), the cleanup-regen claim (S-1), the idempotency-key claim (S-10), interface-change notices (S-3) and switch-on hand-offs (B.4). **The messaging rule between the two sessions is defined there, not here; follow it.**

### B.6 Frozen interfaces (SR-1, SR-2, SR-9, 2026-10-25)

**File:** `lib/repositories/BusinessOsDataExportJobRepository.ts` (owner: EXPORT)

```typescript
export interface DataExportDeletionFacts {
  ownerLastExportReadyAt: string | null;   // ISO or DB timestamp; null = none on record
  ownerExportDownloadedAt: string | null;  // always null for module exports (XC-12)
  adminExportExisted: boolean;
}

// new BusinessOsDataExportJobRepository(client?: SupabaseClient)
findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>;
```

Path, class, method and type names do not change in this stream, **including MX-6 and MX-7** (after MX-7 it reads only the new tables). Full contract: `## SA Split Review — 2026-10-25`, "Frozen interface spec".

**File:** `components/business-os/data-export/DownloadMyDataButton.tsx` (owner: EXPORT)

```typescript
export interface DownloadMyDataButtonProps { variant: 'row' | 'button'; className?: string; }
export function DownloadMyDataButton(props: DownloadMyDataButtonProps): JSX.Element;
```

Name, path and props stay frozen through MX-6. The visible label may change (EXPORT's `downloadMyDataCopy.ts`).

### B.7 Hotspot anchors (SR-10, 2026-10-25)

Own anchor, add only, rebase just before enqueue. Each scope inserts in **one contiguous block at its own anchor**, never at the end of a shared list.

| File | EXPORT inserts | DELETE inserts |
|---|---|---|
| `lib/audit/events.ts` (`AUDIT_EVENTS` and `EVENT_METADATA`) | Directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN` in each map | Directly after `ACCOUNT_DELETION_REFUSED` in each map |
| `lib/audit/eventAudience.ts` | After `DATA_EXPORT_DOWNLOADED_BY_ADMIN` | After the last `ACCOUNT_*` / test-account entry |
| `lib/business-os/translations/{en,he,es}.ts` | One block, prefix `settings.data_export.*` / `export_module.*`, after the last existing data-export key | One block, prefixes `settings.account_delete.*` (extend in place), `settings.plan_cancel.*`, `account_closure.*` |
| `lib/utils/featureFlags.ts` | `isModuleExportEnabled()` at the end of the file | `isPlanSelfCancelEnabled()` directly after `isAccountSelfDeleteEnabled()` |
| `docs/FEATURE_FLAGS.md` | Its row at the end of the env-flag table | Its row directly after the `isAccountSelfDeleteEnabled` row |
| `vercel.json` `crons` | The worker entry directly after `/api/cron/data-export` (MX-6 then removes the neighbour, same owner) | The `:50` entry directly after `/api/cron/payment-reminders` |
| `lib/security/rateLimit.ts` `RATE_LIMITS` | Its keys in one block at its own anchor | Its keys in one block at its own anchor (not adjacent) |

**Files EXPORT does not edit:** `components/business-os/purge/DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `app/admin/users/components/BusinessDetail.tsx`, `app/admin/users/page.tsx`. If EXPORT finds it must edit one, it records a short claim in the coordination file first.

### B.8 More file assignments (SR-11, 2026-10-25)

| Surface | Owner |
|---|---|
| `components/business-os/data-export/**`, `lib/client/businessOsDataExport.ts`, `oneExportControl.guard.test.ts`, `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` (AgentPilot security tabs, export entry only) | EXPORT |
| `app/admin/users/components/DataExportBlock.tsx`, `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts` and their tests | EXPORT |
| After LX-1 merges: `components/crm/ContactsExportButton.tsx`, `components/payments/MoneyCapNotice.tsx` (EXPORT does not touch any LX-1 file until LX-1 is on `main`) | EXPORT |
| `lib/business-os/account-deletion/receiptInput.ts` (SR-1) | DELETE |
| `lib/business-os/account-deletion/selfServiceDeletion.ts`, `authCookies.ts` (part of `account-deletion/**`, named so nobody misses them) | DELETE |
| `lib/business-os/test-account-cleanup/**` except the generated version file (S-1), `lib/repositories/TestAccountCleanupRepository.ts`, `components/business-os/purge/TestAccountCleanupPanel.tsx`, `app/admin/users/deletionCopy.ts`, `app/admin/users/page.tsx`, `useBusinessDetails.ts`, `types.ts`, `usersFilters.ts` | DELETE |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` (S-16) | Shared, add only |
| `lib/security/rateLimit.ts` (S-17), `lib/business-os/businessOwnedTables.ts` (S-2) | Shared, add only |

---

## 12. Non-functional requirements

- **Security:** session user only (`getUser()`), never an id from the body; Zod `.strict()`; module ids checked against the Zod enum from the module map; admin route `requireAdmin` first and in the authz registry; emails only to the login email at send time; owner and admin limits in the database.
- **Privacy:** CSVs never stored; logs and audit hold ids, codes and counts only; file names carry no user data (F-7: the transport logs the filename at `info`); DX-1 exclusions unchanged; export history removed at stage E.
- **Idempotent:** retried jobs and crashes never send a part twice (XC-9).
- **Logging:** Pino `createLogger` with `correlationId`; no `console.*` (flag and convert any touched file).
- **Money:** no sums across currencies; each amount next to its own currency.
- **Time:** every date in `user_preferences.timezone`; NULL shown with "UTC".
- **Accessibility:** keyboard only, labelled controls, focus kept in the drawer, errors announced.
- **Languages:** en and he (right-to-left) at launch; es as a draft.
- **CI:** Jest only, small fixtures, inside the existing job: no added CI time.

---

## 13. Out of scope / future roadmap

- Exporting a filtered list from the screen the owner is on (v1 EX-1 to EX-3; only LX-1 now).
- A bulk download of client documents and website pictures.
- Excel export.
- Bounce tracking ("delivered" status).
- A "kick" that starts the worker at once (cron only, XC-8).

---

## 14. Notes on integration points

| System | Impact |
|---|---|
| `lib/business-os/purge/descriptors.ts` | Descriptors for the two new tables (MX-1a); module map reads `export` (MX-0) |
| `scripts/generate-test-account-cleanup-sql.ts` + cleanup migration | Regenerated in MX-1a and MX-7 (S-1) |
| `lib/business-os/data-export/` | `csv.ts` extended, `columnLabels.ts` new, readers and `ownerClock.ts` reused, ZIP files removed (MX-6) |
| `lib/repositories/BusinessOsDataExportJobRepository.ts` | `findDeletionFacts` re-sourced (MX-4, MX-7) |
| ~~`lib/business-os/account-deletion/receiptInput.ts`~~ | Not EXPORT's (SR-1, 2026-10-25): DELETE owns it; EXPORT changes only what `findDeletionFacts` returns (XC-12) |
| `lib/notifications/emailTransport.ts` | Optional `idempotencyKey` (S-10) |
| `lib/audit/events.ts`, `eventAudience.ts` | `DATA_EXPORT_MODULE_SENT`, `DATA_EXPORT_MODULE_FAILED` |
| `vercel.json` | Worker cron added; data-export cron removed |
| `/admin/users` | "Send export to owner" |
| Supabase Storage | Bucket `business-data-exports` removed after it is empty |
| Resend / `RESEND_FROM_EMAIL` | Domain verification, sending limit and quota (ops) |

---

## SA Split Review — 2026-10-25

**Reviewed by SA — 2026-10-25** (split of the parent into EXPORT and DELETE; checked against `origin/main` at `7e51af5b`, PR #504 merged)
**Status:** ⚠️ Approved with conditions SR-1 to SR-12. **This section is identical in the EXPORT and DELETE files.** Where it disagrees with §11, this section wins until BA splices it into §11 of both files (SR-12).

Verdict in one line: the split is sound, and both sessions can start today. However, §11 gives `receiptInput.ts` to the wrong scope, misses about ten files that both scopes' slices will edit, and leaves the cleanup-regeneration order open. The rulings below fix that.

### What was checked

| Area | Evidence on `origin/main` |
|---|---|
| Receipt facts | `receiptInput.ts` holds the receipt **schema** and the pure builders (`buildAdminReceipt`, `buildOwnerReceipt`, `withFilesRemoved`). The export facts reach it only as arguments. The single read of the export tables is `BusinessOsDataExportJobRepository.findDeletionFacts(userId)`. Its callers are `account/delete/route.ts`, `account/deletion-check/route.ts` and `admin/test-account-cleanup/delete/route.ts`, all owned by DELETE |
| Receipt table | `20261080` CHECKs: `(origin = 'owner') = (executor_kind = 'self_service')`, `(executor_kind = 'admin') = (executor_admin_id IS NOT NULL)`, and statement language and text both set or both NULL. An admin-run delete of an owner request (XC-6: origin `admin`, reason `customer_asked`, statement rebuilt from the stored language) fits neither existing builder: `buildAdminReceipt` forces the statement to NULL, and `buildOwnerReceipt` forces origin `owner` |
| Cleanup regeneration | The generator holds **one** `FUNCTION_MIGRATION` (`20261092_…meeting_links`) and **one** `PREVIOUS_FUNCTION_MIGRATION` (`20261081`). The drift test pins the committed SQL, the migration, the rollback and `cleanupFunctionVersion.generated.ts` to the generator output, and pins applied files by sha256 (`APPLIED`, `APPLIED_TARGET`). `no-deletion-paths.guard.test.ts` imports `MIGRATION_FILE` / `PREVIOUS_MIGRATION_FILE` and keeps hand-listed allow entries for older applied versions |
| Migration numbers | Highest on main is `20261092`. No local or remote branch holds `20261093`+. No open PR. **No test refuses two migrations with the same number** (historical duplicates exist before 20261093) |
| Export entry points | `oneExportControl.guard.test.ts` requires the four entry files (`app/business-os/settings/page.tsx`, `DangerZonePanel.tsx`, `components/settings/SecurityTab.tsx`, `components/v2/settings/SecurityTabV2.tsx`) to render `DownloadMyDataButton`. It also allows only `lib/client/businessOsDataExport.ts` to name the export route outside `app/api/` |
| Admin page | `BusinessDetail.tsx` mounts `<DataExportBlock>` (export) and `TestAccountCleanupPanel` / `DeleteBusinessDialog` (deletion) in separate places. The ready list belongs in `page.tsx` |
| Anchors | `events.ts`: `DATA_EXPORT_*` (l.122–127, 923–952) and `ACCOUNT_PSEUDONYMISED` / `ACCOUNT_DELETION_REFUSED` (l.184–190, 1263–1272). `eventAudience.ts` `DATA_EXPORT_*` l.109–114. Translations are flat keys (`settings.account_delete.*` l.4300+). `vercel.json` crons are one array, with `/api/cron/data-export` at l.86 |
| LX-1 | Still **uncommitted** in `neuronforge-lx1`. It touches `crm/page.tsx`, `MoneyList.tsx`, en/he/es, a CRM guard, and adds `components/crm/ContactsExportButton.tsx` and `components/payments/MoneyCapNotice.tsx` |

### Conditions

| # | Ruling | Applies to |
|---|---|---|
| **SR-1** | **`receiptInput.ts` belongs to DELETE, not EXPORT** (BA flag XC-6 vs ownership: ruled for XC-6). XC-12 needs **no** edit to that file: it changes the values `findDeletionFacts` returns, and "no receipt schema change" stands. DL-5 needs a builder for "an admin runs an owner's stored request" (origin `admin`, executor `admin`, reason `customer_asked`, statement language and text rebuilt from the server list). That builder can only live there. Rules: DELETE may add builders. DELETE may **not** change `receiptShape`, `DELETION_RECEIPT_INPUT_KEYS` or the `superRefine`, because the generator test compares those keys with the SQL (S-1). A key change is a regeneration and needs the S-1 lock. EXPORT owns only `findDeletionFacts` and the `DataExportDeletionFacts` type. Amend B.1 (move `receiptInput.ts` to DELETE's column), S-3 (now covers `findDeletionFacts` only), the XC-6 split note and the coordination file | Both |
| **SR-2** | **Frozen interface: the one DELETE can rely on from today to the end of this stream.** See "Frozen interface spec" below. EXPORT does not move, rename or re-sign it, **including in MX-6 and MX-7**. After MX-7 it reads only the new tables but keeps its class, path and name. A rename is a follow-up after DELETE's DL-5 has merged. With that rule, EXPORT never has to edit a DELETE-owned route | Both |
| **SR-3** | **S-1 covers more files than §11 lists.** A regeneration also edits: the pasted `CHECK_FILE` / `DELETE_FILE` SQL, `supabase/SQL Scripts/<N>_rollback.sql`, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts`, the `APPLIED` / `APPLIED_TARGET` pins and the "chains on …" test in `testAccountCleanupSql.test.ts`, and the **older-version allow-list entries in `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`** (each regeneration moves the previous file into "older applied"). B.1's "`no-deletion-paths.guard.test.ts`: DELETE owns" is amended. DELETE owns its rules (the anonymise-import guard of XC-6). Its regeneration allow-list entries go with whoever holds the S-1 lock. DL-1a also adds its session-cut migration to `SQL_AUTH_WRITE_ALLOW_LIST`, because `DELETE FROM auth.sessions` matches the guard. S-2 also covers `lib/business-os/businessOwnedTables.ts` (add only) | Both |
| **SR-4** | **Regeneration order: DL-1a, then MX-1a, then MX-7.** DL-1a has no dependency and no bold business question, so it takes the S-1 lock **today**. EXPORT reorders its pure slices first: **MX-0 → MX-2a → MX-2b → MX-1a → MX-1b → MX-3 → …**. MX-3 needs both MX-1b and MX-2b, so EXPORT's critical path does not change, and DL-1a gets about 5 working days of slack before MX-1a needs the lock. If the lock is still held when MX-2b is done, EXPORT may build MX-1a's tables, repositories and start function on a branch. It does not regenerate or apply until the lock is released, then rebases on `main` and regenerates. **Precondition for DL-1a:** `20261092` is applied on prod and the checker is green, because DL-1a's `PREVIOUS_FUNCTION_MIGRATION` becomes `20261092`. If it is not applied, stop and tell TL | Both |
| **SR-5** | **S-1: the markdown lock is still needed, but no new CI guard is.** On `main`, existing CI already blocks the race. Both regenerating PRs edit the same generator lines (`FUNCTION_MIGRATION`, `PREVIOUS_FUNCTION_MIGRATION`, the purpose/consequence arrays), the one-line version file and the same pin block. The second PR **always** has a textual conflict, which the merge queue cannot resolve. A wrong hand resolution fails the drift test (the committed SQL lacks the other PR's table), the sha256 pins, or "the generator writes a newer file than every applied one". See "Both regenerations open at once" below. What CI cannot see is **prod**: a regeneration applied from a stale branch. So every regeneration follows a **pre-apply check**: (a) the branch is rebased on current `origin/main` and green; (b) `origin/main`'s `FUNCTION_MIGRATION` equals the PR's `PREVIOUS_FUNCTION_MIGRATION`; (c) apply, then enqueue at once; (d) run the checker; (e) release the lock in the log | Both |
| **SR-6** | **MX-7 is two migrations, in this order:** first the regenerated function (number N), which no longer names `business_os_data_exports` (descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR), and only then the DROP (N+1). Dropping first makes every check and delete fail with 42P01 until the function is replaced (closed, but admin deletes are paused). Reserve both numbers at once | EXPORT |
| **SR-7** | **Migration numbers.** B.3 stands, with additions. Each reservation row records number, slice and branch. MX-7 reserves two. DL-1a (the first migration slice) adds a pure Jest guard: no two `supabase/migrations/*.sql` files with a prefix of `20261093` or above share an 8-digit prefix. It reads one directory, takes milliseconds and runs in the existing job, so it adds no CI time. This is the only CI guard added by this review. It closes the gap where two sessions both take the "next free" number and both PRs merge cleanly, because the file names differ. It also covers other streams (other worktrees are open today), which take numbers without reading the coordination file. No worktree or branch held `20261093`+ at review time | DELETE (DL-1a) |
| **SR-8** | **XC-4 vs BQ-41 (BA flag): XC-4 is amended to defer to BQ-41.** New text: "a 'closed' email that Resend refuses is retried hourly, and the lock waits until it is accepted **or the BQ-41 cap is reached**". Both answers are technically sound. SA has no objection to the suggested 24 h cap: the requested, grace and reminder emails have already told the owner the date, and an unbounded wait would let a dead mailbox keep an account open forever. So that the schema does not depend on the answer, **DL-1a adds `closed_email_attempts int` and `closed_email_first_attempt_at`** whatever is decided. BQ-41 stays "before DL-4". A lock without an accepted email writes `ACCOUNT_LOCKED` with `details.closed_email = 'not_accepted'`, and the ready list shows it. A message Resend accepted counts as sent. Bounces are not tracked | DELETE |
| **SR-9** | **The export entry point DELETE links to (S-4)** is the existing `DownloadMyDataButton` (frozen, see below). Before and after MX-1b, DL-2's drawer renders `<DownloadMyDataButton variant="button" />` and nothing else for export. It never names an export route: guard check 4 refuses that anywhere outside `lib/client/businessOsDataExport.ts`. In MX-1b, EXPORT makes that **same component** open the export drawer when `isModuleExportEnabled()` is on. Settings, the Danger Zone, the AgentPilot security tabs and the deletion drawer then switch over without anyone editing them. When the export drawer opens from inside the deletion drawer, EXPORT's MX-1b handles focus and stacking and tests it once | Both |
| **SR-10** | **Rule for the merge-conflict hotspots: own anchor, add only, rebase just before enqueue.** Each scope inserts in **one contiguous block at its own anchor**, never at the end of a shared list. Two inserts at different anchors merge cleanly. Two inserts at the end of a file conflict every time. See the anchor table below | Both |
| **SR-11** | **Surfaces missing from B.1, now assigned.** See the table below. Anything else that is not listed: raise it in the coordination file first, as B.1 already says | Both |
| **SR-12** | **BA splices SR-1, SR-3, SR-9, SR-10 and SR-11 into §11 of both files, identically,** before either session's first Dev workplan is approved. TL re-checks that the two §11 sections are byte-identical. Until then, this section is the binding text. The coordination file's "Shared items" table was updated by SA today to match | BA / TL |

### Frozen interface spec (SR-2, SR-9)

**File:** `lib/repositories/BusinessOsDataExportJobRepository.ts` (owner: EXPORT)

```typescript
export interface DataExportDeletionFacts {
  ownerLastExportReadyAt: string | null;   // ISO or DB timestamp; null = none on record
  ownerExportDownloadedAt: string | null;  // always null for module exports (XC-12)
  adminExportExisted: boolean;
}

// new BusinessOsDataExportJobRepository(client?: SupabaseClient)
findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>;
```

| Contract | Value |
|---|---|
| Import | `import { BusinessOsDataExportJobRepository, type DataExportDeletionFacts } from '@/lib/repositories/BusinessOsDataExportJobRepository'`. The path, class, method and type names do not change in this stream |
| Behaviour | Never throws. Returns `{ data, error }`. An invalid uuid is an error with no DB call. Reads by `user_id` only (service role, documented) |
| Meaning before MX-4 | Today's: newest owner ZIP `ready_at`, its `owner_downloaded_at`, any admin ZIP |
| Meaning from MX-4 (XC-12) | `ownerLastExportReadyAt` = the newest of (owner ZIP `ready_at`, last **owner-origin module job accepted**). `ownerExportDownloadedAt` = NULL whenever a module export is the newest. `adminExportExisted` = any admin ZIP **or** any admin-origin request. After MX-7: new tables only |
| DELETE's side | Treats the values as opaque receipt and display facts. Tests mock the repository and never assert which table a value came from. Copy shown to the owner says "last export" (not "ready" or "downloaded"), so the change in meaning at MX-4 needs no DELETE change. On `error`: the check route shows "none on record" (as today), and the E route refuses before anything is removed (as today's routes do) |
| Change control | Any change is announced in the coordination file **before** its PR opens and must keep this signature. A signature change is out of this stream |

**File:** `components/business-os/data-export/DownloadMyDataButton.tsx` (owner: EXPORT)

```typescript
export interface DownloadMyDataButtonProps { variant: 'row' | 'button'; className?: string; }
export function DownloadMyDataButton(props: DownloadMyDataButtonProps): JSX.Element;
```

The name, path and props stay frozen through MX-6. The visible label may change, because it lives in EXPORT's `downloadMyDataCopy.ts`.

### Both regenerations open at once (SR-5)

A = DL-1a, B = MX-1a, both branched from the same `main` (M), both regenerating on top of `20261092`.

| Order | On `main` (CI) | On prod |
|---|---|---|
| A merges, then B is enqueued | B conflicts on the generator constants, the version file and the pin block, so the queue refuses it. Resolved correctly (rebase, regenerate, B's `PREVIOUS` = A's file, A's pair moved into `APPLIED`, the guard allow-list updated): B's migration is the A+B function and goes green. Resolved by hand without regenerating: the drift test or the sha256 pins fail. Nothing wrong can merge | Safe only if B is **applied after** the rebase. If B was applied from its stale branch, prod has the M+B function (no closure table in the plan) while `main` has M+A, so the version stamps differ and the check and E answer `function_out_of_date`. That fails closed: admin deletes and test-account cleanup pause until a fresh regeneration (a **new** number, since B's applied bytes are now history) is applied. No data is lost, but a closure row could outlive a test-account cleanup if anyone bypassed the version check. The pre-apply check (b) prevents this |
| B merges, then A is enqueued | The same, the other way round | The same, the other way round (the prod function would lack the export tables) |
| Both applied on prod from stale branches | Unreachable on `main`: the second PR still conflicts | The last one applied wins on prod, the stamp matches neither `main`, and everything pauses until a fresh regeneration. This is the case the lock exists for |

### Hotspot anchors (SR-10)

| File | EXPORT inserts | DELETE inserts |
|---|---|---|
| `lib/audit/events.ts` (`AUDIT_EVENTS` and `EVENT_METADATA`) | Directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN` in each map | Directly after `ACCOUNT_DELETION_REFUSED` in each map |
| `lib/audit/eventAudience.ts` | After `DATA_EXPORT_DOWNLOADED_BY_ADMIN` | After the last `ACCOUNT_*` / test-account entry |
| `lib/business-os/translations/{en,he,es}.ts` | One block, prefix `settings.data_export.*` / `export_module.*`, after the last existing data-export key | One block, prefixes `settings.account_delete.*` (extend in place), `settings.plan_cancel.*`, `account_closure.*` |
| `lib/utils/featureFlags.ts` | `isModuleExportEnabled()` at the end of the file | `isPlanSelfCancelEnabled()` directly after `isAccountSelfDeleteEnabled()` |
| `docs/FEATURE_FLAGS.md` | Its row at the end of the env-flag table | Its row directly after the `isAccountSelfDeleteEnabled` row |
| `vercel.json` `crons` | The worker entry directly after `/api/cron/data-export` (MX-6 then removes the neighbour, same owner) | The `:50` entry directly after `/api/cron/payment-reminders` |
| `lib/security/rateLimit.ts` `RATE_LIMITS` | Its keys in one block at its own anchor | Its keys in one block at its own anchor (not adjacent) |
| `DangerZonePanel.tsx`, `app/business-os/settings/page.tsx` | **No edit** (SR-9: the button switches itself) | Its own blocks |
| `app/admin/users/components/BusinessDetail.tsx`, `page.tsx` | **No edit**: MX-5 replaces the inside of `DataExportBlock` | The ready list, Unlock and run-delete mounts |

If EXPORT finds it must edit a file that this table says it does not, it records a short claim in the coordination file first.

### Surfaces added to ownership (SR-11)

| Surface | Owner |
|---|---|
| `components/business-os/data-export/**`, `lib/client/businessOsDataExport.ts`, `oneExportControl.guard.test.ts`, `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` (export entry only) | EXPORT |
| `app/admin/users/components/DataExportBlock.tsx`, `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts` and their tests | EXPORT |
| After LX-1 merges: `components/crm/ContactsExportButton.tsx`, `components/payments/MoneyCapNotice.tsx` (EXPORT does not touch any LX-1 file until LX-1 is on `main`) | EXPORT |
| `lib/business-os/account-deletion/receiptInput.ts` (SR-1) | DELETE |
| `lib/business-os/account-deletion/selfServiceDeletion.ts`, `authCookies.ts` (part of `account-deletion/**`, named so nobody misses them) | DELETE |
| `lib/business-os/test-account-cleanup/**` except the generated version file (S-1), `lib/repositories/TestAccountCleanupRepository.ts`, `components/business-os/purge/TestAccountCleanupPanel.tsx`, `app/admin/users/deletionCopy.ts`, `app/admin/users/page.tsx`, `useBusinessDetails.ts`, `types.ts`, `usersFilters.ts` | DELETE |
| `lib/repositories/types.ts` and `lib/repositories/index.ts` | Shared, add only. **Prefer keeping new types in the repository file itself** (as `DataExportDeletionFacts` is) and not adding to the barrel |
| `lib/security/rateLimit.ts`, `lib/business-os/businessOwnedTables.ts` | Shared, add only (SR-10, SR-3) |

### First slice for each session

| Session | Starts today with | In parallel (optional, separate worktree) | Takes a shared lock? |
|---|---|---|---|
| **EXPORT** | **MX-0** (pure config, no migration) | MX-2a after MX-0 merges (pure) | No. The S-1 lock is needed only at MX-1a, after MX-2b |
| **DELETE** | **DL-1a** (the GoTrue spike is task 1; migration; regeneration) | **SX-1** (it shares only add-only registries with DL-1a) | **Yes: the S-1 "cleanup regen" lock, today**, plus the first migration number, `20261093` |

**Business-question timing changed by this review:** BQ-25 and BQ-27 move from "before MX-0" to "**before MX-4 switch-on**". MX-0 is one pure config file with no migration, so moving a section between modules later is a one-line change. EXPORT can start MX-0 today on BA's default. BQ-29 stays before MX-1a, and MX-1a now starts later, so there is more time for it. BQ-41 stays before DL-4 (SR-8 makes DL-1a independent of the answer). No new business question.

### Optimisation suggestions (not blocking)

- Both crons send through one Resend team limit (2 per second), and EXPORT's 5-minute worker also runs at :50. DL-3 should honour `retry-after` on a 429 the same way XC-8 asks of EXPORT.
- Whoever builds the S-10 idempotency key also fixes F-7 (the transport logs the attachment filename at `info`) in the same slice, since it is the same file.

### Approval

[x] Split approved with conditions SR-1 to SR-12. Both sessions may start: EXPORT with MX-0, DELETE with DL-1a (holding the S-1 lock) and optionally SX-1. No Dev workplan is approved until SR-12 is done.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (BA), split from the parent | EXPORT scope cut out of `BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md` v2 + SA review 2026-10-25 so two sessions can build in parallel. Slices MX-0, MX-1a, MX-1b, MX-2a, MX-2b, MX-3, MX-4 (incl. XC-12 receipt facts), MX-5 (XC-20), MX-6, MX-7: 18 d. LX-1 listed as done elsewhere (DELETE session, `fix/crm-export-safety-lx1`). BQ-25…BQ-31, BQ-35 (shared), BQ-37, BQ-42, BQ-43, open issues 1 and 2 (shared). SA conditions XC-7…XC-12, XC-13/15/17/19/21 (shared parts), XC-16, XC-18, XC-20 copied. Identical boundary section with the DELETE file (ownership, shared surfaces S-1…S-15, migration reservation from 20261093, dependencies, coordination file) |
| 2026-10-25 | SA Split Review (SA) | `## SA Split Review — 2026-10-25` added, identical in the EXPORT and DELETE files: ⚠️ approved with conditions SR-1…SR-12. `receiptInput.ts` moves to DELETE, and EXPORT owns only `findDeletionFacts` (frozen interface spec). S-1 covers more files (`no-deletion-paths.guard.test.ts` allow-list, version file, pins). Regeneration order DL-1a → MX-1a → MX-7, with a pre-apply check. MX-7 is two migrations. Duplicate-number Jest guard in DL-1a. XC-4 now defers to BQ-41 (cap columns in DL-1a). `DownloadMyDataButton` is the frozen export entry. Hotspot anchors. Unlisted surfaces assigned. BQ-25 and BQ-27 move to before MX-4 switch-on. First slices: EXPORT MX-0, DELETE DL-1a (+ SX-1) |
| 2026-10-25 | §11 updated with SA split rulings SR-1/3/9/10/11 (SR-12) | Spliced identically into §11 of the EXPORT and DELETE files; changed rows marked "(SR-n, 2026-10-25)". B.1: `receiptInput.ts` moved to DELETE (SR-1), guard rules vs regen allow-list and `SQL_AUTH_WRITE_ALLOW_LIST` (SR-3). B.2: S-1 lists every file under the cleanup-regen lock, order DL-1a → MX-1a → MX-7 and the pre-apply check (SR-3/4/5); S-2 adds `businessOwnedTables.ts`; S-3 now `findDeletionFacts` only; S-4 `DownloadMyDataButton variant="button"` (SR-9); S-5/S-6 DELETE only, EXPORT does not edit; S-7/8/9/11 own anchor (SR-10); new S-16/S-17 shared add-only (SR-11). B.3: reservation fields, MX-7 two migrations, duplicate-prefix guard (SR-6/7). B.4: rows updated. New B.6 frozen interfaces, B.7 hotspot anchors, B.8 more file assignments |
| 2026-10-26 | BQ-26 answered (user) | One joined table per module as §4.2 ("Record type", "Belongs to", union of columns, ids last); the one-CSV-per-record-type alternative was declined. Unblocks the E2 (MX-2a) workplan |
